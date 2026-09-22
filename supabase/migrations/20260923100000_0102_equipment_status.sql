-- Equipment status (owner decision, 2026-09-23): the "deactivate" toggle is
-- replaced by an explicit lifecycle status, and "part of the fleet" becomes a
-- single predicate every reading path shares.
--
-- ===========================================================================
-- 1. What the status means
-- ===========================================================================
--   `active`      نشطة          — in the fleet, counted everywhere
--   `sold`        مباعة         — left the fleet permanently
--   `scrapped`    مشطوبة        — written off
--   `rented_out`  مؤجرة للغير   — rented to a third party, not ours to operate
--
-- Only `active` counts as part of the fleet. The other three keep their full
-- history, stay in the equipment list behind a status filter and stay visible
-- on the inquiry page, but they are excluded from the home stats, the admin
-- home, the movement equipment selectors and the current-state reports.
--
-- ===========================================================================
-- 2. Backfill: every existing row becomes `active`
-- ===========================================================================
-- What today's `is_active = false` rows actually mean has NOT been decided by
-- the product owner — a deactivated row could be sold, scrapped, rented out or
-- simply parked by an admin. Guessing here would write an unrecoverable
-- business fact into every one of those rows, so this migration does not
-- guess:
--
--   * every row is backfilled to `status = 'active'` (the column default), and
--   * `is_active` keeps its current value untouched, so nothing that is
--     deactivated today silently comes back into the fleet.
--
-- The two flags are held consistent in one direction by a trigger (a status
-- other than `active` forces `is_active = false`; see below) and every fleet
-- predicate in this file is `is_active AND status = 'active'`, so a row is in
-- the fleet only when BOTH agree. When the owner tells us what the currently
-- deactivated rows are, a later migration can set their status in one
-- statement without touching anything else.
--
-- ===========================================================================
-- 3. "Under maintenance" is NOT stored here
-- ===========================================================================
-- Owner decision: the operational state "تحت الصيانة" is derived from the
-- latest movement (an open WORKSHOP entry whose purpose is `maintenance`) and
-- returns to normal on exit. `admin_equipment_state.state` already yields
-- `workshop_maintenance`, and `search_entry_equipment` /
-- `search_workshop_equipment` already return the open visit's workshop
-- purpose, so no column is added for it and nothing in this file stores it.
-- (`equipment.operational_status` is an older, separate field maintained by
-- the workshop classification function; it is not touched here.)
--
-- ===========================================================================
-- 4. Security
-- ===========================================================================
-- Every object below is re-created from its current definition with ONLY the
-- fleet predicate changed (plus the new report arguments in section 8). Each
-- keeps its existing security properties verbatim: SECURITY INVOKER or
-- SECURITY DEFINER exactly as before, the same fail-closed role checks with
-- the explicit `v_role IS NULL` test, the same fixed `search_path`, and the
-- same `REVOKE ALL ... FROM PUBLIC, anon` / `GRANT EXECUTE ... TO
-- authenticated`. No grant is widened and no role check is relaxed.
--
-- Writing the status needs no new function: the `update_equipment` policy
-- (migration 0004) is `USING (public.is_admin()) WITH CHECK
-- (public.is_admin())` for the whole row and is not column-restricted, so the
-- admin equipment form updates the column through the policy that already
-- governs every other equipment field. Non-admins cannot update `equipment`
-- at all.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_status_check
  CHECK (status IN ('active', 'sold', 'scrapped', 'rented_out'));

COMMENT ON COLUMN public.equipment.status IS
  'Equipment lifecycle status: active (in the fleet), sold, scrapped or '
  'rented_out. Only ''active'' counts as part of the fleet, and every fleet '
  'predicate is (is_active AND status = ''active''). Backfilled to ''active'' '
  'for every existing row; what today''s is_active = false rows mean is a '
  'separate owner decision.';

-- No index is added on `status`.
--   * The admin home reads `admin_equipment_state`, where the predicate is
--     applied to an already-materialized derived row set (one lateral lookup
--     per equipment), so an index on `equipment.status` is never reached
--     through the view — exactly the reasoning migration 0101 recorded for
--     `equipment.type`.
--   * The equipment list filters `status` from the browser through PostgREST,
--     but it pages 20 rows out of a few thousand and already sorts on
--     `updated_at`; `equipment_active_idx` (0035) covers the companion
--     `is_active` predicate.
--   * The equipment selectors (`search_*_equipment`) are already bounded by
--     `LIMIT 20` after an ILIKE scan of the same small table.
-- If `equipment` grows by an order of magnitude the change worth making is a
-- composite index on the whole fleet predicate, which is a decision to take
-- with a real query plan rather than speculatively here.

-- ---------------------------------------------------------------------------
-- Keeping `is_active` and `status` from disagreeing
-- ---------------------------------------------------------------------------
-- One direction only, and deliberately so:
--
--   status <> 'active'  =>  is_active is forced to false.
--
-- The reverse is NOT applied: `is_active = false` with `status = 'active'`
-- stays exactly as written (that is every currently deactivated row after this
-- migration), because inventing a business status from a soft-delete flag is
-- the guess section 2 refuses to make. Such a row is simply not in the fleet,
-- since every predicate requires both.
--
-- Setting the status back to `active` does NOT flip `is_active` back on by
-- itself: an admin re-activating a record sets both through the equipment form
-- (the form always sends `is_active`), so the trigger never has to reverse a
-- decision an admin made for another reason.
CREATE OR REPLACE FUNCTION public.equipment_status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.equipment_status_sync() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.equipment_status_sync() IS
  'Keeps equipment.is_active consistent with equipment.status: any status '
  'other than ''active'' forces is_active = false. The reverse is not applied, '
  'so a deactivated row keeps whatever status it has.';

DROP TRIGGER IF EXISTS equipment_status_sync ON public.equipment;
CREATE TRIGGER equipment_status_sync
  BEFORE INSERT OR UPDATE OF status, is_active ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.equipment_status_sync();

-- ===========================================================================
-- 5. The shared state view (definition from 0094)
-- ===========================================================================
-- `status` is appended as the LAST column, which is all CREATE OR REPLACE VIEW
-- allows: every existing column keeps its name, type and position, `is_active`
-- stays, and no current consumer changes shape. `security_invoker = true` is
-- repeated because a replace would otherwise drop the option and run the view
-- with the owner's rights.
CREATE OR REPLACE VIEW public.admin_equipment_state
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.code,
  e.type,
  e.ownership_status,
  e.is_active,
  m.recorded_at AS last_movement_at,
  m.movement_type AS last_movement_type,
  m.movement_context AS last_movement_context,
  m.workshop_purpose AS last_workshop_purpose,
  CASE
    WHEN m.id IS NULL THEN 'available'
    WHEN m.movement_type <> 'entry' THEN 'available'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'maintenance' THEN 'workshop_maintenance'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'parking' THEN 'workshop_parking'
    WHEN m.movement_context = 'workshop' THEN 'workshop_unclassified'
    ELSE 'inside_site'
  END AS state,
  e.status
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = e.id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) m ON true;

REVOKE ALL ON public.admin_equipment_state FROM PUBLIC, anon;
GRANT SELECT ON public.admin_equipment_state TO authenticated;

COMMENT ON VIEW public.admin_equipment_state IS
  'Every equipment row with the state derived from its latest movement across '
  'both contexts, ordered by (recorded_at DESC, id DESC). security_invoker, '
  'so equipment and entry_exit_logs RLS stay authoritative. Shared by the '
  'admin home functions so "current state" has exactly one definition. '
  'Carries both is_active and status; the fleet predicate is '
  '(is_active AND status = ''active'').';

-- ===========================================================================
-- 6. The admin home functions (definitions from 0095 / 0101)
-- ===========================================================================
-- Each body below is the current one verbatim; the only edit is
-- `WHERE s.is_active` becoming `WHERE s.is_active AND s.status = 'active'`.

CREATE OR REPLACE FUNCTION public.get_admin_fleet_state(
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_owners text[];
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  WITH scoped AS (
    SELECT s.ownership_status, s.type, s.state, s.last_movement_at
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
  ),
  owners AS (
    SELECT jsonb_agg(row_to_json(o)::jsonb ORDER BY o.total DESC, o.owner) AS v
    FROM (
      SELECT
        c.ownership_status AS owner,
        count(*)::int AS total,
        count(*) FILTER (WHERE c.state = 'inside_site')::int AS inside_sites,
        count(*) FILTER (WHERE c.state IN (
          'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
        ))::int AS in_workshop,
        count(*) FILTER (WHERE c.state = 'available')::int AS available
      FROM scoped c
      GROUP BY c.ownership_status
    ) o
  ),
  types AS (
    SELECT jsonb_agg(row_to_json(y)::jsonb ORDER BY y.total DESC, y.type) AS v
    FROM (
      SELECT
        c.type,
        count(*)::int AS total,
        count(*) FILTER (WHERE c.state = 'inside_site')::int AS inside_sites,
        count(*) FILTER (WHERE c.state IN (
          'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
        ))::int AS in_workshop,
        count(*) FILTER (WHERE c.state = 'available')::int AS available
      FROM scoped c
      GROUP BY c.type
      ORDER BY count(*) DESC, c.type
      LIMIT 30
    ) y
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM scoped),
    'inside_sites',
      (SELECT count(*) FILTER (WHERE state = 'inside_site')::int FROM scoped),
    'in_workshop',
      (SELECT count(*) FILTER (WHERE state IN (
        'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
      ))::int FROM scoped),
    'workshop_maintenance',
      (SELECT count(*) FILTER (WHERE state = 'workshop_maintenance')::int
       FROM scoped),
    'workshop_parking',
      (SELECT count(*) FILTER (WHERE state = 'workshop_parking')::int
       FROM scoped),
    'workshop_unclassified',
      (SELECT count(*) FILTER (WHERE state = 'workshop_unclassified')::int
       FROM scoped),
    'available',
      (SELECT count(*) FILTER (WHERE state = 'available')::int FROM scoped),
    'idle_30', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '30 days')::int FROM scoped),
    'idle_60', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '60 days')::int FROM scoped),
    'idle_90', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '90 days')::int FROM scoped),
    'never_moved',
      (SELECT count(*) FILTER (WHERE last_movement_at IS NULL)::int
       FROM scoped),
    'by_owner', COALESCE((SELECT v FROM owners), '[]'::jsonb),
    'by_type', COALESCE((SELECT v FROM types), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_fleet_state(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_state(text[]) TO authenticated;

COMMENT ON FUNCTION public.get_admin_fleet_state(text[]) IS
  'Admin home: how many fleet equipment (is_active AND status = ''active'') '
  'are inside sites, in the workshop (split maintenance / parking / not '
  'classified) and available right now, the 30/60/90-day no-movement '
  'breakdown, and the same counts per owner and per equipment type. p_owners '
  'is a validated list of ownership_status values; NULL or empty means every '
  'owner. SECURITY INVOKER plus an admin/monitor role check.';

CREATE OR REPLACE FUNCTION public.get_admin_outside_equipment(
  p_owners text[] DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  total_count int,
  id uuid,
  code text,
  type text,
  ownership_status text,
  last_movement_at timestamptz,
  last_movement_type text,
  last_movement_context text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN QUERY
  SELECT
    count(*) OVER ()::int AS total_count,
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.last_movement_at,
    s.last_movement_type,
    s.last_movement_context
  FROM public.admin_equipment_state s
  WHERE s.is_active AND s.status = 'active'
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    AND s.state = 'available'
  ORDER BY s.last_movement_at DESC NULLS LAST, s.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_outside_equipment(text[], int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_outside_equipment(text[], int, int)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_outside_equipment(text[], int, int) IS
  'Admin home: one page of the fleet equipment (is_active AND status = '
  '''active'') that is outside right now - its latest movement across both '
  'contexts is not an ENTRY, or it has never moved. Ordered by last movement '
  'date descending with never-moved rows last, and every row carries '
  'total_count, the size of the whole filtered set. p_limit is clamped to '
  '1..500, p_offset to >= 0 and p_owners is validated. SECURITY INVOKER plus '
  'an admin/monitor role check.';

CREATE OR REPLACE FUNCTION public.get_admin_availability_by_type(
  p_owners text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  type text,
  inside_sites int,
  in_workshop int,
  available int,
  total int,
  total_count int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_term text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);
  v_term := NULLIF(
    btrim(translate(left(COALESCE(p_search, ''), 80), '%_' || chr(92), '')),
    ''
  );

  RETURN QUERY
  SELECT
    grouped.type,
    grouped.inside_sites,
    grouped.in_workshop,
    grouped.available,
    grouped.total,
    count(*) OVER ()::int AS total_count
  FROM (
    SELECT
      s.type AS type,
      count(*) FILTER (WHERE s.state = 'inside_site')::int AS inside_sites,
      count(*) FILTER (WHERE s.state IN (
        'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
      ))::int AS in_workshop,
      count(*) FILTER (WHERE s.state = 'available')::int AS available,
      count(*)::int AS total
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
      AND (v_term IS NULL OR s.type ILIKE '%' || v_term || '%')
    GROUP BY s.type
  ) grouped
  ORDER BY grouped.total DESC, grouped.type
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int) IS
  'Admin home: one page of the per-type availability - how many fleet units '
  '(is_active AND status = ''active'') of each equipment type are inside '
  'sites, in the workshop and available, and the type total - biggest type '
  'first. p_search is a wildcard-stripped ILIKE on the type and applies across '
  'every page; every row carries total_count, the number of matching types. '
  'p_limit is clamped to 1..500, p_offset to >= 0 and p_owners is validated. '
  'SECURITY INVOKER plus an admin/monitor role check.';

CREATE OR REPLACE FUNCTION public.get_admin_owner_state_matrix(
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_owners text[];
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  SELECT jsonb_build_object(
    'total', COALESCE(sum(cells.count), 0)::int,
    'cells', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'owner', cells.owner,
          'state', cells.state,
          'count', cells.count
        )
        ORDER BY cells.owner, cells.state
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM (
    SELECT
      s.ownership_status AS owner,
      s.state AS state,
      count(*)::int AS count
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    GROUP BY s.ownership_status, s.state
  ) cells;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_owner_state_matrix(text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_owner_state_matrix(text[])
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_owner_state_matrix(text[]) IS
  'Admin home donuts: fleet equipment (is_active AND status = ''active'') '
  'counted per (ownership_status, state) right now, so the owner donut, the '
  'state donut and the cross-filter between them all come from one snapshot. '
  'p_owners is a validated list of ownership_status values; NULL or empty '
  'means every owner. SECURITY INVOKER plus an admin/monitor role check.';

-- ===========================================================================
-- 7. The home stats (definitions from 0090 / 0097)
-- ===========================================================================
-- Both functions counted movement rows without ever reading `equipment`, so
-- the fleet predicate is introduced as a join on the movement source CTE.
-- Applying it there rather than only to the "inside now" number keeps the
-- three cards of a home page internally consistent: a unit that leaves the
-- fleet disappears from the day counts and the state counts together, instead
-- of an entry being counted today while the same unit is missing from
-- "inside now".
--
-- The join is INNER on purpose: `entry_exit_logs.equipment_id` references
-- `equipment`, so it drops no readable movement of a fleet unit.

CREATE OR REPLACE FUNCTION public.get_foreman_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH saudi_day AS (
  SELECT date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00')
           AT TIME ZONE INTERVAL '+03:00' AS starts
),
mine AS (
  SELECT l.id, l.equipment_id, l.movement_type, l.recorded_at
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.movement_context = 'site'
    AND l.supervisor_id = auth.uid()
    AND e.is_active
    AND e.status = 'active'
),
today AS (
  SELECT m.movement_type, count(*)::int AS total
  FROM mine m, saudi_day d
  WHERE m.recorded_at >= d.starts
    AND m.recorded_at < d.starts + interval '1 day'
  GROUP BY m.movement_type
),
latest AS (
  SELECT DISTINCT ON (m.equipment_id) m.equipment_id, m.movement_type
  FROM mine m
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
)
SELECT jsonb_build_object(
  'entries_today',
    COALESCE((SELECT total FROM today WHERE movement_type = 'entry'), 0),
  'exits_today',
    COALESCE((SELECT total FROM today WHERE movement_type = 'exit'), 0),
  'inside_now',
    (SELECT count(*)::int FROM latest WHERE movement_type = 'entry')
);
$$;

REVOKE ALL ON FUNCTION public.get_foreman_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_foreman_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_foreman_home_stats() IS
  'Foreman home stats: site entries/exits recorded today in Saudi time '
  '(UTC+03:00) by the caller, and the equipment still inside sites from the '
  'caller''s own site movements. Only fleet equipment (is_active AND status = '
  '''active'') is counted. SECURITY INVOKER, so entry_exit_logs RLS stays '
  'authoritative, and scoped to supervisor_id = auth.uid().';

CREATE OR REPLACE FUNCTION public.get_workshop_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH today AS (
  SELECT date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00')
           AT TIME ZONE INTERVAL '+03:00' AS starts
),
fleet_movements AS (
  SELECT l.id, l.equipment_id, l.movement_type, l.workshop_purpose,
         l.recorded_at
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.movement_context = 'workshop'
    AND e.is_active
    AND e.status = 'active'
),
latest AS (
  SELECT DISTINCT ON (m.equipment_id)
    m.id, m.equipment_id, m.movement_type, m.workshop_purpose, m.recorded_at
  FROM fleet_movements m
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
),
inside AS (
  SELECT id, equipment_id, workshop_purpose, recorded_at
  FROM latest
  WHERE movement_type = 'entry'
),
latest_yesterday AS (
  SELECT DISTINCT ON (m.equipment_id)
    m.equipment_id, m.movement_type, m.workshop_purpose
  FROM fleet_movements m, today
  WHERE m.recorded_at < today.starts
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
),
inside_yesterday AS (
  SELECT equipment_id, workshop_purpose
  FROM latest_yesterday
  WHERE movement_type = 'entry'
),
pending AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'equipment_id', p.equipment_id,
      'equipment_code', e.code,
      'equipment_type', e.type,
      'recorded_at', p.recorded_at
    )
    ORDER BY p.recorded_at DESC, p.id DESC
  ) AS value
  FROM (
    SELECT id, equipment_id, recorded_at
    FROM inside
    WHERE workshop_purpose IS NULL
    ORDER BY recorded_at DESC, id DESC
    LIMIT 10
  ) p
  LEFT JOIN public.equipment e ON e.id = p.equipment_id
)
SELECT jsonb_build_object(
  'inside_now', (SELECT count(*)::int FROM inside),
  'maintenance',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'maintenance'),
  'parking',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'parking'),
  'pending_classification',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose IS NULL),
  'inside_yesterday', (SELECT count(*)::int FROM inside_yesterday),
  'maintenance_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'maintenance'),
  'parking_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'parking'),
  'pending', COALESCE((SELECT value FROM pending), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.get_workshop_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workshop_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_workshop_home_stats() IS
  'Workshop home stats: fleet equipment (is_active AND status = ''active'') '
  'whose latest visible workshop movement is an ENTRY, split into maintenance '
  '/ parking / not classified yet, the same three counts as of the start of '
  'today (Saudi midnight) for the change since yesterday, plus the latest 10 '
  'unclassified open entries as `pending`. SECURITY INVOKER, so '
  'entry_exit_logs RLS stays authoritative.';

-- ===========================================================================
-- 8. The movement equipment selectors (definitions from 0088 / 0089 / 0100)
-- ===========================================================================
-- Equipment that has left the fleet must not be offered on a movement form at
-- all: registering a movement for a sold unit is the mistake this status
-- exists to prevent. All three keep SECURITY DEFINER and their existing
-- fail-closed role checks exactly as they are.

CREATE OR REPLACE FUNCTION public.search_entry_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_term text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose
  FROM public.equipment e
  -- The latest movement per equipment, ordered deterministically by
  -- (recorded_at, id) exactly like the sequence trigger and 0087/0088.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  WHERE e.is_active
    AND e.status = 'active'
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_entry_equipment(text, text, text) IS
  'Site ENTRY equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes.';

REVOKE ALL ON FUNCTION public.search_entry_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_entry_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_site_exit_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_admin boolean;
  v_term text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;
  v_is_admin := v_role = 'admin';

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status
  FROM public.equipment e
  JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.supervisor_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND e.status = 'active'
    -- Only equipment currently inside, i.e. with an open visit.
    AND last_movement.movement_type = 'entry'
    -- A site exit closes a site entry only; equipment inside the workshop is
    -- never offered here (2026-09-19).
    AND last_movement.movement_context = 'site'
    AND (v_is_admin OR last_movement.supervisor_id = auth.uid())
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_site_exit_equipment(text, text, text) IS
  'Site EXIT equipment list: fleet equipment (is_active AND status = ''active'') whose latest movement is a site ENTRY the caller may close. SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes.';

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_workshop_equipment(
  p_movement_type text,
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  ownership_status text,
  qr_value text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_term text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
    RAISE EXCEPTION 'workshop role required';
  END IF;

  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.ownership_status,
    e.qr_value,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose
  FROM public.equipment e
  -- The latest movement per equipment in ANY context: this is the state the
  -- badge reports, the same source 0089 uses.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  -- The latest WORKSHOP movement, which decides what a workshop EXIT may
  -- close. Kept separate from the state above on purpose.
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_workshop_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  WHERE e.is_active
    AND e.status = 'active'
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
    )
    AND (
      p_movement_type = 'entry'
      OR (
        p_movement_type = 'exit'
        AND last_workshop_movement.movement_type = 'entry'
      )
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_workshop_equipment(text, text, text) IS
  'Workshop ENTRY/EXIT equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). EXIT lists only equipment whose latest workshop movement is an entry. SECURITY DEFINER so the state does not depend on the movement read policy; returns no supervisor identity and no notes.';

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;

-- ===========================================================================
-- 9. The Excel update path (definition from 0074)
-- ===========================================================================
-- The admin equipment update workbook gains an optional status column. It is
-- optional in the strict sense: a sheet without it, or with the cell left
-- blank, keeps the record's current status, so an older exported workbook can
-- still be uploaded unchanged. An unknown value is rejected per row with the
-- existing per-row error mechanism rather than failing the whole upload.
CREATE OR REPLACE FUNCTION public.update_equipment_from_excel(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_equipment public.equipment;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_version timestamptz;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'invalid_update_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := (v_row->>'record_id')::uuid;
      v_version := (v_row->>'record_version')::timestamptz;
      SELECT * INTO v_equipment FROM public.equipment WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found'; END IF;
      IF v_equipment.updated_at IS DISTINCT FROM v_version THEN
        RAISE EXCEPTION 'record_changed';
      END IF;
      IF NULLIF(btrim(v_row->>'code'), '') IS NULL OR NULLIF(btrim(v_row->>'type'), '') IS NULL THEN
        RAISE EXCEPTION 'required_value_missing';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.equipment_types et WHERE et.name = btrim(v_row->>'type')) THEN
        RAISE EXCEPTION 'equipment_type_not_found';
      END IF;

      -- Absent or blank keeps the current status; anything else must be one of
      -- the four known values.
      v_status := COALESCE(
        NULLIF(btrim(v_row->>'status'), ''),
        v_equipment.status
      );
      IF v_status NOT IN ('active', 'sold', 'scrapped', 'rented_out') THEN
        RAISE EXCEPTION 'invalid_equipment_status';
      END IF;

      UPDATE public.equipment SET
        code = btrim(v_row->>'code'),
        type = btrim(v_row->>'type'),
        plate_number = NULLIF(btrim(v_row->>'plate_number'), ''),
        operational_status = (v_row->>'operational_status')::text,
        ownership_status = (v_row->>'ownership_status')::text,
        status = v_status,
        project_id = NULLIF(v_row->>'project_id', '')::uuid,
        lessor_id = CASE WHEN v_row->>'ownership_status' = 'external_supplier'
          THEN NULLIF(v_row->>'lessor_id', '')::uuid ELSE NULL END,
        brand = NULLIF(btrim(v_row->>'brand'), ''),
        model = NULLIF(btrim(v_row->>'model'), ''),
        manufacture_year = NULLIF(v_row->>'manufacture_year', '')::integer,
        chassis_number = NULLIF(btrim(v_row->>'chassis_number'), ''),
        registration_type = NULLIF(v_row->>'registration_type', '')::text,
        last_maintenance_date = NULLIF(v_row->>'last_maintenance_date', '')::date,
        registration_expiry = NULLIF(v_row->>'registration_expiry', '')::date,
        insurance_expiry = NULLIF(v_row->>'insurance_expiry', '')::date,
        master_data_complete = true
      WHERE id = v_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_id, 'status', 'updated'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_row->>'record_id', 'status', 'error',
        'error_code', CASE
          WHEN SQLERRM LIKE '%record_not_found%' THEN 'record_not_found'
          WHEN SQLERRM LIKE '%record_changed%' THEN 'record_changed'
          WHEN SQLERRM LIKE '%required_value_missing%' THEN 'required_value_missing'
          WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found'
          WHEN SQLERRM LIKE '%invalid_equipment_status%' THEN 'invalid_equipment_status'
          WHEN SQLERRM LIKE '%invalid_plate_number%' THEN 'invalid_plate_number'
          ELSE 'update_failed' END
      ));
    END;
  END LOOP;
  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.update_equipment_from_excel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_equipment_from_excel(jsonb) TO authenticated;

-- ===========================================================================
-- 10. The reports: fleet predicate plus the owner / context filter
-- ===========================================================================
-- Owner decision 4: the four report screens get a shared owner + context
-- filter, applied server-side. `p_owners` is validated element by element by
-- `admin_home_owner_filter` (0095), the same closed list the admin home uses,
-- so no report argument reaches a query as free text.
--
-- Where the fleet predicate is applied, and where it is deliberately NOT:
--   * Current-state answers (what is open right now, what needs attention) are
--     about the fleet, so they exclude non-active equipment.
--   * Historical counts inside a date range are NOT rewritten. Dropping the
--     movements a unit really made before it was sold would silently change
--     an audit trail that was correct when it was recorded, and would make the
--     same report return different totals for the same past month depending on
--     what an admin did to a record afterwards. The owner filter does apply to
--     them, because an owner classification does not change what happened.
--   This split is the one judgement call in this file and is worth confirming
--   with the product owner.

DROP FUNCTION IF EXISTS public.get_entry_report_summary(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_entry_report_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_owners text[] DEFAULT NULL,
  p_context text DEFAULT 'site'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owners text[];
  -- NULL means "both contexts"; the default keeps 0081/0083's site-only
  -- behaviour for any caller that does not pass the argument.
  v_context text;
  v_result jsonb;
BEGIN
  v_owners := public.admin_home_owner_filter(p_owners);
  IF p_context IS NULL OR p_context = 'all' THEN
    v_context := NULL;
  ELSIF p_context IN ('site', 'workshop') THEN
    v_context := p_context;
  ELSE
    RAISE EXCEPTION 'unknown movement context' USING ERRCODE = '22023';
  END IF;

  WITH entries AS (
    SELECT
      l.id, l.equipment_id, l.supervisor_id, l.movement_type, l.movement_context,
      l.driver_id, l.driver_name, l.contractor_equipment_code, l.registration_method,
      l.odometer_reading, l.notes, l.photo_url, l.company_id, l.project_id,
      l.recorded_at, l.created_at, e.code equipment_code, e.type equipment_type,
      e.plate_number, e.chassis_number, c.name_ar company_name_ar,
      c.name_en company_name_en, p.name_ar project_name_ar, p.name_en project_name_en,
      pr.full_name supervisor_name, d.mobile_number driver_mobile
    FROM public.entry_exit_logs l
    LEFT JOIN public.equipment e ON e.id = l.equipment_id
    LEFT JOIN public.companies c ON c.id = l.company_id
    LEFT JOIN public.projects p ON p.id = l.project_id
    LEFT JOIN public.profiles pr ON pr.id = l.supervisor_id
    LEFT JOIN public.drivers d ON d.id = l.driver_id
    WHERE (v_context IS NULL OR l.movement_context = v_context)
      AND l.movement_type = 'entry'
      AND l.recorded_at >= p_from
      AND l.recorded_at <= p_to
      AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
  ), open_rows AS (
    -- Current state, so the fleet predicate applies here.
    SELECT v.equipment_code, v.equipment_type, v.company_name_ar,
           v.company_name_en, v.project_name_ar, v.project_name_en,
           v.driver_name, v.entry_recorded_at
    FROM public.equipment_visits v
    JOIN public.equipment e ON e.id = v.equipment_id
    WHERE (v_context IS NULL OR v.movement_context = v_context)
      AND v.exit_log_id IS NULL
      AND e.is_active
      AND e.status = 'active'
      AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
  ), ranked AS (
    SELECT COALESCE(company_name_ar, company_name_en, '—') name, count(*)::int count
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), projects AS (
    SELECT COALESCE(project_name_ar, project_name_en, '—') name, count(*)::int count
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), foremen AS (
    SELECT COALESCE(supervisor_name, '—') name, count(*)::int count, max(recorded_at) last_entry
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), open_visits AS (
    SELECT jsonb_agg(jsonb_build_object(
      'equipment_code', equipment_code, 'equipment_type', equipment_type,
      'company_name', COALESCE(company_name_ar, company_name_en),
      'project_name', COALESCE(project_name_ar, project_name_en),
      'driver_name', driver_name, 'entry_recorded_at', entry_recorded_at
    ) ORDER BY entry_recorded_at DESC) value
    FROM (
      SELECT equipment_code, equipment_type, company_name_ar, company_name_en,
        project_name_ar, project_name_en, driver_name, entry_recorded_at
      FROM open_rows
      ORDER BY entry_recorded_at DESC LIMIT 5
    ) v
  ), latest AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'equipment_id', equipment_id, 'supervisor_id', supervisor_id,
      'movement_type', movement_type, 'movement_context', movement_context,
      'driver_name', driver_name, 'driver_id', driver_id, 'recorded_at', recorded_at,
      'created_at', created_at, 'contractor_equipment_code', contractor_equipment_code,
      'registration_method', registration_method, 'odometer_reading', odometer_reading,
      'notes', notes, 'photo_url', photo_url,
      'equipment', jsonb_build_object(
        'id', equipment_id, 'code', equipment_code, 'type', equipment_type,
        'plate_number', plate_number, 'chassis_number', chassis_number
      ),
      'company', CASE WHEN company_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', company_id, 'name_ar', company_name_ar, 'name_en', company_name_en
      ) END,
      'project', CASE WHEN project_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', project_id, 'name_ar', project_name_ar, 'name_en', project_name_en
      ) END,
      'supervisor', jsonb_build_object('id', supervisor_id, 'full_name', supervisor_name),
      'driver', CASE WHEN driver_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', driver_id, 'mobile_number', driver_mobile
      ) END
    ) ORDER BY recorded_at DESC, id DESC) value
    FROM (SELECT * FROM entries ORDER BY recorded_at DESC, id DESC LIMIT 10) x
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM entries),
    'equipment', (SELECT count(DISTINCT equipment_id)::int FROM entries),
    'companies', (SELECT count(DISTINCT company_id)::int FROM entries WHERE company_id IS NOT NULL),
    'projects', (SELECT count(DISTINCT project_id)::int FROM entries WHERE project_id IS NOT NULL),
    'open', (SELECT count(*)::int FROM open_rows),
    'latest', COALESCE((SELECT value FROM latest), '[]'::jsonb),
    'open_visits', COALESCE((SELECT value FROM open_visits), '[]'::jsonb),
    'top_companies', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM ranked r), '[]'::jsonb),
    'top_projects', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM projects r), '[]'::jsonb),
    'foremen', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM foremen r), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text) IS
  'Entry report summary for a Saudi-time range. p_owners is a validated list '
  'of ownership_status values (NULL or empty means every owner); p_context is '
  '''site'' (the default, the previous behaviour), ''workshop'' or ''all''. '
  'The entry counts are the movements as they were recorded; the open-visit '
  'count and list are current state and therefore only fleet equipment '
  '(is_active AND status = ''active''). SECURITY INVOKER, so entry_exit_logs '
  'RLS stays authoritative.';

DROP FUNCTION IF EXISTS public.get_equipment_attention_report(integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_equipment_attention_report(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(p_search), '');
  v_owners text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN (
    WITH latest AS (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id,
        l.id AS movement_id,
        l.movement_type,
        l.movement_context,
        l.recorded_at,
        l.project_id
      FROM public.entry_exit_logs l
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ),
    classified AS (
      SELECT
        e.id AS equipment_id,
        e.code AS equipment_code,
        e.type AS equipment_type,
        e.plate_number,
        latest.movement_id,
        latest.movement_type,
        latest.movement_context,
        latest.recorded_at AS last_movement_at,
        p.name_ar AS project_name_ar,
        p.name_en AS project_name_en,
        CASE
          WHEN latest.movement_id IS NULL THEN 'no_movement'
          WHEN latest.movement_type = 'entry' THEN 'open_visit'
          WHEN latest.movement_type = 'exit' THEN 'outside_sites'
          ELSE 'unclassified_history'
        END AS attention_reason
      FROM public.equipment e
      LEFT JOIN latest ON latest.equipment_id = e.id
      LEFT JOIN public.projects p ON p.id = latest.project_id
      -- This report is entirely current state, so it is the fleet only.
      WHERE e.is_active = true
        AND e.status = 'active'
        AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    ),
    filtered AS (
      SELECT *
      FROM classified
      WHERE attention_reason <> 'unclassified_history'
        AND (
          v_search IS NULL
          OR equipment_code ILIKE '%' || v_search || '%'
          OR equipment_type ILIKE '%' || v_search || '%'
          OR plate_number ILIKE '%' || v_search || '%'
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY
        CASE attention_reason
          WHEN 'open_visit' THEN 1
          WHEN 'outside_sites' THEN 2
          WHEN 'no_movement' THEN 3
          ELSE 4
        END,
        last_movement_at NULLS LAST,
        equipment_code,
        equipment_id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::integer FROM filtered),
      'summary', jsonb_build_object(
        'no_movement', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'no_movement'),
        'open_visit', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'open_visit'),
        'outside_sites', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'outside_sites')
      ),
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(paged))
        FROM paged
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_equipment_attention_report(integer, integer, text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_equipment_attention_report(integer, integer, text, text[])
  TO authenticated;

COMMENT ON FUNCTION
  public.get_equipment_attention_report(integer, integer, text, text[]) IS
  'Admin-only equipment attention report over the fleet (is_active AND status '
  '= ''active''), server-paginated. p_owners is a validated list of '
  'ownership_status values; NULL or empty means every owner. SECURITY DEFINER '
  'with an explicit is_admin() check and a fixed search_path.';
