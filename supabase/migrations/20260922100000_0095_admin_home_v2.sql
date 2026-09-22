-- Admin home v2: the changes the product owner asked for after reviewing the
-- page that migration 0094 shipped.
--
-- What changes here
-- =========================================================================
--   1. The owner filter became a MULTI-select, so every function that took a
--      single `p_owner text` now takes `p_owners text[]`. The old single-owner
--      signatures are DROPPED rather than kept alongside the new ones: a grep
--      of the repository shows `src/lib/adminHomeData.ts` is their only caller
--      and it moves to the array form in the same change, so a second code
--      path would only be a second thing to keep secure. Dropping also keeps
--      `get_admin_owner_state_matrix` unambiguous - it had no arguments at
--      all, so an added `p_owners text[] DEFAULT NULL` overload would have
--      made a no-argument call ambiguous instead of defaulting.
--   2. `get_admin_entries_yearly` is new. The entries chart gained a يوم /
--      شهر / سنة granularity switch; day and month still fold the daily series
--      on the client, but five years of days is far past the 400-day cap in
--      `get_admin_entries_series`. Raising that cap would make every caller
--      able to request ~1800 rows, so the yearly view gets its own function
--      that aggregates Saudi years in SQL and returns at most 20 rows.
--   3. `get_admin_foreman_recent_movements` is new: the last N movements per
--      foreman for the side-by-side mini tables that replace the single
--      "busiest foremen" table.
--
-- `get_admin_foreman_discipline` (0094) is deliberately left in place: it is
-- correct and secured, it is simply no longer called by the page. Dropping it
-- is a separate decision from this UI change.
--
-- Security model - identical to migration 0094, restated per function
-- =========================================================================
--   * SECURITY INVOKER, spelled out. `equipment` and `entry_exit_logs` RLS
--     stay authoritative; nothing here can read a movement the movement log
--     would hide.
--   * Every function fails closed on the caller's role: `current_user_role()`
--     must be `admin` or `monitor`, and a NULL role (no profile row) is
--     rejected. Without it a foreman calling the RPC would get their own
--     partial rows back presented as fleet-wide totals.
--   * `SET search_path = public, pg_temp` on every function, so a
--     caller-created temp object can never shadow a referenced table.
--   * `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO
--     authenticated`.
--   * Text arguments are validated against a closed list (`ownership_status`,
--     `movement_context`) and integer arguments are clamped, so no argument
--     reaches a query as free text and none can request an unbounded result.
--     For the new array argument that means EVERY element is validated, not
--     just the first, and NULL elements are rejected - `= ANY(array)` with a
--     NULL element would silently match nothing rather than erroring.
--   * NULL or an empty array means "every owner", so the page's "الكل" state
--     and a cleared filter are the same request.
--
-- Day boundaries
-- =========================================================================
--   Saudi Arabia is UTC+03:00 all year, so a Saudi day and a Saudi year are
--   computed with a fixed interval offset exactly as 0090/0094 do:
--   `(ts AT TIME ZONE INTERVAL '+03:00')`. The interval form is used rather
--   than a zone name so the POSIX sign convention ('UTC+3' meaning UTC-3) can
--   never apply. The browser's timezone is never involved.

-- ---------------------------------------------------------------------------
-- Shared validation for the owner array
-- ---------------------------------------------------------------------------
-- IMMUTABLE and argument-only: it touches no table, so it needs no role check
-- of its own; it is only ever reached from a function that has already made
-- one. It still fixes `search_path` and is revoked from PUBLIC/anon like
-- everything else here.
CREATE OR REPLACE FUNCTION public.admin_home_owner_filter(p_owners text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- "no filter" has exactly one internal representation, so every caller
  -- below can test `IS NULL` and never also test cardinality.
  IF p_owners IS NULL OR cardinality(p_owners) = 0 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_owners) AS o(value)
    WHERE o.value IS NULL
       OR o.value NOT IN (
         'alazani',
         'takween',
         'third_party_f',
         'third_party_partnership_b',
         'external_supplier'
       )
  ) THEN
    RAISE EXCEPTION 'unknown ownership_status' USING ERRCODE = '22023';
  END IF;
  RETURN p_owners;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_home_owner_filter(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_home_owner_filter(text[])
  TO authenticated;

COMMENT ON FUNCTION public.admin_home_owner_filter(text[]) IS
  'Validates an admin-home owner filter: every element must be a known '
  'ownership_status, NULL elements are rejected, and NULL or an empty array '
  'normalizes to NULL ("every owner").';

-- ---------------------------------------------------------------------------
-- The single-owner signatures from 0094
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_admin_fleet_state(text);
DROP FUNCTION IF EXISTS public.get_admin_no_movement_equipment(text, int, int);
DROP FUNCTION IF EXISTS public.get_admin_availability_by_type(text);
DROP FUNCTION IF EXISTS public.get_admin_entries_series(
  timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.get_admin_owner_state_matrix();

-- ---------------------------------------------------------------------------
-- 1. Fleet state right now
-- ---------------------------------------------------------------------------
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
    WHERE s.is_active
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

REVOKE ALL ON FUNCTION public.get_admin_fleet_state(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_state(text[]) TO authenticated;

COMMENT ON FUNCTION public.get_admin_fleet_state(text[]) IS
  'Admin home: how many active equipment are inside sites, in the workshop '
  '(split maintenance / parking / not classified) and available right now, '
  'the 30/60/90-day no-movement breakdown, and the same counts per owner and '
  'per equipment type. p_owners is a validated list of ownership_status '
  'values; NULL or empty means every owner. SECURITY INVOKER plus an '
  'admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 2. Equipment that has not moved for a while
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_no_movement_equipment(
  p_owners text[] DEFAULT NULL,
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
  v_owners text[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

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
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
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

REVOKE ALL ON FUNCTION
  public.get_admin_no_movement_equipment(text[], int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_no_movement_equipment(text[], int, int) TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_no_movement_equipment(text[], int, int) IS
  'Admin home: active equipment with no movement for at least p_days, longest '
  'idle first and never-moved equipment before everything else. Days are '
  'counted on Saudi calendar days (UTC+03:00). p_days and p_limit are '
  'clamped and p_owners is validated. SECURITY INVOKER plus an admin/monitor '
  'role check.';

-- ---------------------------------------------------------------------------
-- 3. Availability per equipment type
-- ---------------------------------------------------------------------------
-- The owned / rented split that 0094 returned is gone: the owner filter above
-- the page now answers that question directly, and the product owner asked for
-- the sub-lines to be removed rather than shown twice. Column order follows
-- the table: inside sites, workshop, available, total.
CREATE OR REPLACE FUNCTION public.get_admin_availability_by_type(
  p_owners text[] DEFAULT NULL
)
RETURNS TABLE(
  type text,
  inside_sites int,
  in_workshop int,
  available int,
  total int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_owners text[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN QUERY
  SELECT
    s.type,
    count(*) FILTER (WHERE s.state = 'inside_site')::int,
    count(*) FILTER (WHERE s.state IN (
      'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
    ))::int,
    count(*) FILTER (WHERE s.state = 'available')::int,
    count(*)::int
  FROM public.admin_equipment_state s
  WHERE s.is_active
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
  GROUP BY s.type
  ORDER BY count(*) DESC, s.type
  -- Every type is returned (the master list is small and capped here only as
  -- a safety net): the page shows the top 10 and reveals the rest behind
  -- "عرض الكل", and its type search must be able to find any of them without
  -- a second request.
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_availability_by_type(text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_availability_by_type(text[])
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_availability_by_type(text[]) IS
  'Admin home: per equipment type, how many active units are inside sites, in '
  'the workshop and available, and the total. p_owners is a validated list of '
  'ownership_status values; NULL or empty means every owner. SECURITY '
  'INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 4a. Entries / exits per Saudi day
-- ---------------------------------------------------------------------------
-- Still deliberately daily: the client aggregates days into the يوم and شهر
-- views with `src/lib/chartBuckets.ts`, so switching between them costs no
-- request and the SQL has exactly one definition of a day. Movements of
-- deactivated equipment are included, because the movement still happened.
CREATE OR REPLACE FUNCTION public.get_admin_entries_series(
  p_from timestamptz,
  p_to timestamptz,
  p_owners text[] DEFAULT NULL,
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
  v_owners text[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  -- One day per returned row, so the range stays bounded and so does the
  -- chart. The يوم view asks for 30 days and the شهر view for 12 months; the
  -- سنة view does NOT raise this cap, it uses get_admin_entries_yearly below.
  IF p_to > p_from + interval '400 days' THEN
    RAISE EXCEPTION 'period longer than 400 days' USING ERRCODE = '22023';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'unknown movement_context' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN QUERY
  SELECT
    (l.recorded_at AT TIME ZONE INTERVAL '+03:00')::date AS day,
    count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
    count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.recorded_at >= p_from
    AND l.recorded_at <= p_to
    AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    AND (p_context IS NULL OR l.movement_context = p_context)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text[], text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_entries_series(timestamptz, timestamptz, text[], text) IS
  'Admin home: entries and exits per Saudi calendar day (UTC+03:00) over a '
  'period of at most 400 days, optionally narrowed to a validated list of '
  'ownership_status values and one movement_context. The client aggregates '
  'days into the day and month views. SECURITY INVOKER plus an admin/monitor '
  'role check.';

-- ---------------------------------------------------------------------------
-- 4b. Entries / exits per Saudi year
-- ---------------------------------------------------------------------------
-- The سنة view needs five years, which is ~1825 daily rows - far past the cap
-- above. Rather than raising that cap (which every caller of the daily series
-- would inherit), the yearly view aggregates in SQL and returns at most 20
-- rows. A year boundary is the Saudi one: 1 January 00:00 UTC+03:00.
CREATE OR REPLACE FUNCTION public.get_admin_entries_yearly(
  p_years int DEFAULT 5,
  p_owners text[] DEFAULT NULL,
  p_context text DEFAULT NULL
)
RETURNS TABLE(year int, entries int, exits int)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_years int := LEAST(GREATEST(COALESCE(p_years, 5), 1), 20);
  v_owners text[];
  v_current_year int;
  v_from timestamptz;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'unknown movement_context' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  v_current_year :=
    EXTRACT(YEAR FROM (now() AT TIME ZONE INTERVAL '+03:00'))::int;
  -- Built as text with an explicit ISO offset rather than make_timestamptz, so
  -- the POSIX sign convention can never turn +03:00 into -03:00. Comparing
  -- `recorded_at` (a timestamptz) against a timestamptz keeps the range scan
  -- on idx_logs_recorded_at usable.
  v_from := ((v_current_year - v_years + 1)::text || '-01-01 00:00:00+03:00')
    ::timestamptz;

  RETURN QUERY
  SELECT
    EXTRACT(YEAR FROM (l.recorded_at AT TIME ZONE INTERVAL '+03:00'))::int
      AS year,
    count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
    count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.recorded_at >= v_from
    AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    AND (p_context IS NULL OR l.movement_context = p_context)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_entries_yearly(int, text[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_entries_yearly(int, text[], text)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_entries_yearly(int, text[], text) IS
  'Admin home: entries and exits per Saudi calendar year (UTC+03:00) for the '
  'last p_years years (clamped to 1..20, so at most 20 rows). Only years that '
  'actually have movements are returned. Optionally narrowed to a validated '
  'list of ownership_status values and one movement_context. SECURITY '
  'INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 5. Owner x state matrix for the two donuts
-- ---------------------------------------------------------------------------
-- One result serves both donuts and both cross-filter directions (owner ->
-- states and state -> owners), so clicking a slice never costs a request and
-- the two charts can never be drawn from two different snapshots.
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
    WHERE s.is_active
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
  'Admin home donuts: active equipment counted per (ownership_status, state) '
  'right now, so the owner donut, the state donut and the cross-filter '
  'between them all come from one snapshot. p_owners is a validated list of '
  'ownership_status values; NULL or empty means every owner. SECURITY '
  'INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 6. The last N movements per foreman
-- ---------------------------------------------------------------------------
-- Replaces the single "busiest foremen" table with one mini table per foreman.
-- Two caps, both enforced here rather than in the browser: at most 20 foremen
-- (the busiest ones) and at most 20 movements each, so the payload is bounded
-- whatever the caller asks for.
CREATE OR REPLACE FUNCTION public.get_admin_foreman_recent_movements(
  p_limit_per_foreman int DEFAULT 7
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  total_movements int,
  movement_rank int,
  movement_id uuid,
  equipment_id uuid,
  equipment_code text,
  movement_type text,
  movement_context text,
  recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit_per_foreman, 7), 1), 20);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      l.id,
      l.supervisor_id AS sid,
      l.equipment_id,
      l.movement_type,
      l.movement_context,
      l.recorded_at,
      -- Deterministic exactly like every other movement ordering in this
      -- system: recorded_at first, then id, so two movements sharing a
      -- timestamp still resolve to one order.
      row_number() OVER (
        PARTITION BY l.supervisor_id
        ORDER BY l.recorded_at DESC, l.id DESC
      )::int AS rn,
      count(*) OVER (PARTITION BY l.supervisor_id)::int AS total
    FROM public.entry_exit_logs l
    WHERE l.supervisor_id IS NOT NULL
  ),
  busiest AS (
    SELECT r.sid, max(r.total) AS total
    FROM ranked r
    GROUP BY r.sid
    ORDER BY max(r.total) DESC, r.sid
    LIMIT 20
  )
  SELECT
    r.sid,
    pr.full_name,
    b.total,
    r.rn,
    r.id,
    r.equipment_id,
    e.code,
    r.movement_type,
    r.movement_context,
    r.recorded_at
  FROM ranked r
  JOIN busiest b ON b.sid = r.sid
  -- LEFT JOINed: a profile or an equipment row the caller cannot read becomes
  -- NULL and never drops the movement from the foreman's list.
  LEFT JOIN public.profiles pr ON pr.id = r.sid
  LEFT JOIN public.equipment e ON e.id = r.equipment_id
  WHERE r.rn <= v_limit
  ORDER BY b.total DESC, r.sid, r.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_foreman_recent_movements(int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_foreman_recent_movements(int)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_foreman_recent_movements(int) IS
  'Admin home: the last p_limit_per_foreman movements (clamped to 1..20) of '
  'each of the 20 busiest foremen, ordered by (recorded_at DESC, id DESC) '
  'inside each foreman, with that foreman total movement count repeated on '
  'every row. SECURITY INVOKER plus an admin/monitor role check.';

-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * The owner predicate moved from `= p_owner` to `= ANY(v_owners)`. On
--     `admin_equipment_state` it is applied to an in-memory row set (one row
--     per equipment) either way, so the plan is unchanged. On
--     `get_admin_entries_series` and `get_admin_entries_yearly` it is applied
--     after the primary-key join to `equipment`, exactly as before; an index
--     on `ownership_status` was rejected again because the column has five
--     values and no query here filters equipment by owner alone.
--   * `get_admin_entries_yearly` is a single range scan on
--     `idx_logs_recorded_at` (migration 0001) from 1 January of the earliest
--     requested Saudi year, then a hash aggregate over at most 20 groups. The
--     year is derived from `recorded_at` in the SELECT list only, so the
--     WHERE clause stays index-friendly.
--   * `get_admin_foreman_recent_movements` scans `entry_exit_logs` once and
--     sorts it by (supervisor_id, recorded_at DESC, id DESC) for the two
--     window functions. There is no (supervisor_id, recorded_at) index today;
--     at the current log size one sort is cheaper than an index that no other
--     query would use, and the movement log's own foreman filter is served by
--     the view's existing predicates. If the log grows by an order of
--     magnitude, `(supervisor_id, recorded_at DESC, id DESC)` is the index to
--     add in a follow-up migration.
