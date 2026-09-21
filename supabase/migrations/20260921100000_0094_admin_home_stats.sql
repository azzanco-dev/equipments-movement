-- Admin home (the real page behind the owner-approved mockup) and its data.
--
-- The admin home answers "where is my fleet, what has stopped moving, and how
-- busy were we" in one screen. Every number below used to be either impossible
-- (the fleet state per owner) or computed by pulling whole tables into the
-- browser, so each section gets one server-side function and the page loads
-- them independently.
--
-- ===========================================================================
-- Security model
-- ===========================================================================
--   * Everything here is SECURITY INVOKER (spelled out, never the implicit
--     default). `entry_exit_logs` RLS and `equipment` RLS stay authoritative,
--     so nothing can read a movement the movement list would hide. No
--     SECURITY DEFINER is needed: migration 0072/0076 already give `admin`
--     and `monitor` SELECT on every `entry_exit_logs` row, which is exactly
--     the audience of this page.
--   * Every function additionally fails closed on the caller's role:
--     `current_user_role()` must be `admin` or `monitor`, and a NULL role (no
--     profile row) is rejected. This is defense in depth rather than the
--     access control itself — without it a foreman calling the RPC would get
--     their own partial rows back *presented as fleet-wide totals*, which is
--     worse than an error.
--   * `search_path` is fixed to `public, pg_temp` on every function, so a
--     caller-created temp object can never shadow a referenced table.
--   * Execution is revoked from PUBLIC and anon and granted to
--     `authenticated` only.
--   * Text arguments are validated against a closed list (`ownership_status`,
--     `movement_context`) and integer arguments are clamped, so no argument
--     reaches a query as free text and no argument can request an unbounded
--     result.
--
-- ===========================================================================
-- Day boundaries
-- ===========================================================================
--   Saudi Arabia is UTC+03:00 all year, so a Saudi day is computed with a
--   fixed interval offset exactly as migration 0090 does:
--   `(ts AT TIME ZONE INTERVAL '+03:00')::date`. The interval form is used
--   rather than a zone name so the POSIX sign convention (`'UTC+3'` meaning
--   UTC-3) can never apply. The browser's timezone is never involved.
--
-- ===========================================================================
-- Current state of one equipment
-- ===========================================================================
--   `admin_equipment_state` derives the state from the latest movement across
--   BOTH contexts, ordered deterministically by (recorded_at DESC, id DESC) —
--   the same rule `equipmentStateFromLastMovement()` already applies on the
--   client, so the home page and the equipment cards can never disagree, and
--   two movements sharing a timestamp still resolve to one answer.
--
--   States: inside_site / workshop_maintenance / workshop_parking /
--   workshop_unclassified / available. "available" covers both "the last
--   movement is an EXIT" and "this equipment has never moved", because in
--   both cases it is not inside anything right now; `last_movement_at IS NULL`
--   tells the two apart wherever the difference matters (the no-movement
--   table shows it in red).
--
--   A future `equipment.status` column (batch 3) is not referenced yet; the
--   functions scope to `is_active = true`, which is what the rest of the
--   codebase treats as "part of the fleet".

-- ---------------------------------------------------------------------------
-- The shared state view
-- ---------------------------------------------------------------------------
-- security_invoker, so the caller's own RLS decides both halves: `equipment`
-- is readable by every authenticated user already (policy `select_equipment`,
-- USING (true)), and the lateral movement lookup is filtered by
-- `select_entry_exit_logs`. The view therefore exposes nothing a caller could
-- not already assemble with two queries; it exists so the six functions below
-- share one definition of "current state" instead of copying it.
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
  END AS state
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
  'admin home functions so "current state" has exactly one definition.';

-- ---------------------------------------------------------------------------
-- 1. Fleet state right now
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_fleet_state(
  p_owner text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NOT NULL AND p_owner NOT IN (
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier'
  ) THEN
    RAISE EXCEPTION 'unknown ownership_status' USING ERRCODE = '22023';
  END IF;

  WITH scoped AS (
    SELECT s.ownership_status, s.type, s.state, s.last_movement_at
    FROM public.admin_equipment_state s
    WHERE s.is_active
      AND (p_owner IS NULL OR s.ownership_status = p_owner)
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
  -- Equipment types are a small admin-managed master list; the cap is a
  -- safety net so a mis-imported list can never return an unbounded payload.
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
    -- Nested by construction: idle_90 is a subset of idle_60 is a subset of
    -- idle_30, and equipment that never moved is counted in all three plus
    -- `never`, because "no movement for 30 days" is true of it as well.
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

REVOKE ALL ON FUNCTION public.get_admin_fleet_state(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_state(text) TO authenticated;

COMMENT ON FUNCTION public.get_admin_fleet_state(text) IS
  'Admin home: how many active equipment are inside sites, in the workshop '
  '(split maintenance / parking / not classified) and available right now, '
  'the 30/60/90-day no-movement breakdown, and the same counts per owner and '
  'per equipment type. Optional single ownership_status filter. SECURITY '
  'INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 2. Equipment that has not moved for a while
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_no_movement_equipment(
  p_owner text DEFAULT NULL,
  p_days int DEFAULT 30,
  p_limit int DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  ownership_status text,
  last_movement_at timestamptz,
  last_movement_type text,
  last_movement_context text,
  days_since int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_days int := LEAST(GREATEST(COALESCE(p_days, 30), 0), 3650);
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NOT NULL AND p_owner NOT IN (
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier'
  ) THEN
    RAISE EXCEPTION 'unknown ownership_status' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.last_movement_at,
    s.last_movement_type,
    s.last_movement_context,
    CASE
      WHEN s.last_movement_at IS NULL THEN NULL
      ELSE (
        (now() AT TIME ZONE INTERVAL '+03:00')::date
        - (s.last_movement_at AT TIME ZONE INTERVAL '+03:00')::date
      )::int
    END AS days_since
  FROM public.admin_equipment_state s
  WHERE s.is_active
    AND (p_owner IS NULL OR s.ownership_status = p_owner)
    AND (
      s.last_movement_at IS NULL
      OR s.last_movement_at < now() - make_interval(days => v_days)
    )
  -- Equipment with no movement history at all is the worst case, so it sorts
  -- first; the rest follow oldest movement first. `id` breaks ties so paging
  -- and repeated loads are deterministic.
  ORDER BY s.last_movement_at ASC NULLS FIRST, s.id
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_no_movement_equipment(text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_no_movement_equipment(text, int, int)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_no_movement_equipment(text, int, int) IS
  'Admin home: active equipment with no movement for at least p_days, longest '
  'idle first and never-moved equipment before everything else. Days are '
  'counted on Saudi calendar days (UTC+03:00). p_days and p_limit are '
  'clamped. SECURITY INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 3. Availability per equipment type, owned vs rented
-- ---------------------------------------------------------------------------
-- "Owned" is derived, never stored twice: Al-Azani is owned and every other
-- ownership_status is rented, exactly as `isOwnedEquipment()` decides on the
-- client. The rented figures are the difference, so the two halves can never
-- drift apart.
CREATE OR REPLACE FUNCTION public.get_admin_availability_by_type(
  p_owner text DEFAULT NULL
)
RETURNS TABLE(
  type text,
  total int,
  inside_sites int,
  in_workshop int,
  available int,
  owned_total int,
  owned_inside_sites int,
  owned_in_workshop int,
  owned_available int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NOT NULL AND p_owner NOT IN (
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier'
  ) THEN
    RAISE EXCEPTION 'unknown ownership_status' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    s.type,
    count(*)::int,
    count(*) FILTER (WHERE s.state = 'inside_site')::int,
    count(*) FILTER (WHERE s.state IN (
      'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
    ))::int,
    count(*) FILTER (WHERE s.state = 'available')::int,
    count(*) FILTER (WHERE s.ownership_status = 'alazani')::int,
    count(*) FILTER (
      WHERE s.ownership_status = 'alazani' AND s.state = 'inside_site')::int,
    count(*) FILTER (
      WHERE s.ownership_status = 'alazani' AND s.state IN (
        'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
      ))::int,
    count(*) FILTER (
      WHERE s.ownership_status = 'alazani' AND s.state = 'available')::int
  FROM public.admin_equipment_state s
  WHERE s.is_active
    AND (p_owner IS NULL OR s.ownership_status = p_owner)
  GROUP BY s.type
  ORDER BY count(*) DESC, s.type
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_availability_by_type(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_availability_by_type(text)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_availability_by_type(text) IS
  'Admin home: per equipment type, how many active units are inside sites, in '
  'the workshop and available, with the owned (Al-Azani) share of each column; '
  'rented is the difference. SECURITY INVOKER plus an admin/monitor role '
  'check.';

-- ---------------------------------------------------------------------------
-- 4. Entries / exits per Saudi day
-- ---------------------------------------------------------------------------
-- Deliberately daily: the client aggregates days into weeks or months with
-- `src/lib/chartBuckets.ts`, so the granularity switch costs no request and
-- the SQL has exactly one definition of a day. Movements of deactivated
-- equipment are included, because the movement still happened.
CREATE OR REPLACE FUNCTION public.get_admin_entries_series(
  p_from timestamptz,
  p_to timestamptz,
  p_owner text DEFAULT NULL,
  p_context text DEFAULT NULL
)
RETURNS TABLE(day date, entries int, exits int)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  -- One day per returned row, so the range is bounded to keep the payload
  -- and the chart bounded too (the widest preset is 12 months).
  IF p_to > p_from + interval '400 days' THEN
    RAISE EXCEPTION 'period longer than 400 days' USING ERRCODE = '22023';
  END IF;
  IF p_owner IS NOT NULL AND p_owner NOT IN (
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier'
  ) THEN
    RAISE EXCEPTION 'unknown ownership_status' USING ERRCODE = '22023';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'unknown movement_context' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    (l.recorded_at AT TIME ZONE INTERVAL '+03:00')::date AS day,
    count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
    count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.recorded_at >= p_from
    AND l.recorded_at <= p_to
    AND (p_owner IS NULL OR e.ownership_status = p_owner)
    AND (p_context IS NULL OR l.movement_context = p_context)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text, text) IS
  'Admin home: entries and exits per Saudi calendar day (UTC+03:00) over a '
  'period of at most 400 days, optionally narrowed to one ownership_status '
  'and one movement_context. The client aggregates days into weeks/months. '
  'SECURITY INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 5. Owner x state matrix for the interactive donut
-- ---------------------------------------------------------------------------
-- One result serves both drill directions (owner -> states and state ->
-- owners), so clicking a slice never costs a request and the two directions
-- can never be computed from two different snapshots.
CREATE OR REPLACE FUNCTION public.get_admin_owner_state_matrix()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;

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
    WHERE s.is_active
    GROUP BY s.ownership_status, s.state
  ) cells;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_owner_state_matrix()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_owner_state_matrix()
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_owner_state_matrix() IS
  'Admin home donut: active equipment counted per (ownership_status, state) '
  'right now, so owner -> states and state -> owners both come from one '
  'snapshot. SECURITY INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 6. Foreman activity over a period
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_foreman_discipline(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  entries int,
  exits int,
  open_visits int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH period AS (
    SELECT
      l.supervisor_id AS sid,
      count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
      count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
    FROM public.entry_exit_logs l
    WHERE l.recorded_at >= p_from
      AND l.recorded_at <= p_to
    GROUP BY l.supervisor_id
  ),
  -- Open site visits are a "right now" number, not a period number: the
  -- latest site movement of the equipment is an ENTRY and that entry is the
  -- foreman's. Deterministic by (recorded_at DESC, id DESC).
  open_now AS (
    SELECT latest.supervisor_id AS sid, count(*)::int AS open_visits
    FROM (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id, l.supervisor_id, l.movement_type
      FROM public.entry_exit_logs l
      WHERE l.movement_context = 'site'
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ) latest
    WHERE latest.movement_type = 'entry'
    GROUP BY latest.supervisor_id
  )
  SELECT
    p.sid,
    pr.full_name,
    p.entries,
    p.exits,
    COALESCE(o.open_visits, 0)
  FROM period p
  LEFT JOIN open_now o ON o.sid = p.sid
  LEFT JOIN public.profiles pr ON pr.id = p.sid
  ORDER BY (p.entries + p.exits) DESC, pr.full_name, p.sid
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_foreman_discipline(timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_foreman_discipline(timestamptz, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_foreman_discipline(timestamptz, timestamptz) IS
  'Admin home: the 20 busiest foremen over a period - entries and exits they '
  'recorded, plus how many site visits they have open right now. The name is '
  'LEFT JOINed from profiles, so a row the caller may not read becomes NULL '
  'and never drops the counts. SECURITY INVOKER plus an admin/monitor role '
  'check.';

-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * `admin_equipment_state` is one sequential scan of `equipment` (a small
--     master table) with a LIMIT 1 nested-loop lookup per row served by
--     `idx_entry_exit_logs_equipment_time` (equipment_id, recorded_at, id)
--     from migration 0043. The per-equipment ORDER BY ... LIMIT 1 is the
--     shape that index exists for.
--   * The no-movement list filters and sorts on `last_movement_at`, which is
--     computed by that lateral join, so it is sorted in memory over one row
--     per equipment - a few thousand rows at most, well under work_mem. A
--     materialized "last movement" column would be the follow-up if the
--     equipment master ever grows by an order of magnitude; it is not worth
--     the write-path complexity today.
--   * `get_admin_entries_series` is a range scan on `idx_logs_recorded_at`
--     (migration 0001) joined to `equipment` on its primary key. The
--     `ownership_status` predicate is applied after that join; adding an
--     index on it was rejected because the column has five values and no
--     query here filters equipment by owner alone.
--   * `get_admin_foreman_discipline` uses `idx_logs_recorded_at` for the
--     period half and `idx_entry_exit_logs_equipment_context_time`
--     (equipment_id, movement_context, recorded_at, id) from migration 0040
--     for the DISTINCT ON half.

-- ---------------------------------------------------------------------------
-- `movement_log_search`: one added column for the movement log's owner filter
-- ---------------------------------------------------------------------------
-- The full movement log (`/logs`) filters by owner. Without the column the
-- filter would have to resolve owners to equipment ids in the browser and push
-- them back as an `equipment_id.in.(...)` list - exactly the pattern migration
-- 0086 removed, with the same silent truncation.
--
-- CREATE OR REPLACE VIEW can only append columns, so every existing column
-- keeps its name, type and position and no consumer of
-- `MOVEMENT_LOG_*_SELECT` changes. The definition below is 0086's, unchanged,
-- plus the last line. `security_invoker = true` is repeated because a replace
-- would otherwise drop the option and make the view run with the owner's
-- rights.
CREATE OR REPLACE VIEW public.movement_log_search
WITH (security_invoker = true)
AS
SELECT
  l.id,
  l.equipment_id,
  l.supervisor_id,
  l.movement_type,
  l.movement_context,
  l.workshop_purpose,
  l.registration_method,
  l.driver_id,
  l.driver_name,
  l.odometer_reading,
  l.notes,
  l.photo_url,
  l.company_id,
  l.project_id,
  l.contractor_equipment_code,
  l.recorded_at,
  l.created_at,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.plate_letters_en AS equipment_plate_letters_en,
  e.chassis_number AS equipment_chassis_number,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  p.name_ar AS project_name_ar,
  p.name_en AS project_name_en,
  s.full_name AS supervisor_name,
  d.mobile_number AS driver_mobile_number,
  e.ownership_status AS equipment_ownership_status
FROM public.entry_exit_logs l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.companies c ON c.id = l.company_id
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profiles s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;
