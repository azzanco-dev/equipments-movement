-- Admin home v3: the product owner's third review of the page (2026-09-22).
--
-- What changes here
-- =========================================================================
--   1. "معدات بلا حركة" stops being an idle-time report and becomes "what is
--      outside right now". The owner's reasoning: a long idle time is normal
--      for this fleet and says nothing on its own, while "this unit is not
--      inside any site and not in the workshop" is the state an admin acts
--      on. `get_admin_no_movement_equipment` (0095) is therefore DROPPED and
--      replaced by `get_admin_outside_equipment`, which returns exactly the
--      equipment whose latest movement (either context, ordered
--      `recorded_at DESC, id DESC`) is not an ENTRY, plus the equipment that
--      has never moved at all - that is precisely `state = 'available'` on
--      `admin_equipment_state`, so "outside" keeps the one definition of
--      current state the whole page already shares.
--      The p_days threshold is gone with it: nothing filters by age any more,
--      and the row order is newest exit first (never-moved rows last), which
--      is the order the table is read in.
--   2. Both list functions become server-side paginated. The page now uses
--      the shared `DataListPagination` (20 rows per page) instead of a
--      top-N slice, and the Excel export of the outside list walks the same
--      function in pages, so the browser never holds the whole equipment
--      table to sort or filter it. Each function returns `total_count` from
--      `count(*) OVER ()`, the same value on every row, so one request gives
--      both the page and the number of pages.
--   3. `get_admin_availability_by_type` gains `p_search`, so the type search
--      works across every page instead of only the rows already downloaded.
--      The term is matched with a plain ILIKE on `equipment.type` after LIKE
--      wildcards and the LIKE escape character are stripped, so a search term
--      can never widen its own match.
--
-- `get_admin_fleet_state` is NOT touched: it already takes `p_owners` and
-- already returns `total`, which is the new "اجمالي المعدات" card. Its
-- idle_30 / idle_60 / idle_90 / never_moved members stay in the payload and
-- are simply no longer read by the page - removing them is a separate
-- decision from this UI change, exactly as 0095 left
-- `get_admin_foreman_discipline` in place.
--
-- Security model - identical to 0094 / 0095, restated per function
-- =========================================================================
--   * SECURITY INVOKER, spelled out. `equipment` and `entry_exit_logs` RLS
--     stay authoritative through `admin_equipment_state` (itself
--     security_invoker), so nothing here can read a movement the movement log
--     would hide.
--   * Both functions fail closed on the caller's role:
--     `current_user_role()` must be `admin` or `monitor`, and a NULL role (no
--     profile row) is rejected - `NULL NOT IN (...)` alone evaluates to NULL
--     and would let it through.
--   * `SET search_path = public, pg_temp`, so a caller-created temp object can
--     never shadow a referenced table.
--   * `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO
--     authenticated`.
--   * The owner array is validated element by element by
--     `admin_home_owner_filter` (0095): NULL or an empty array means "every
--     owner", any unknown value raises. `p_limit` and `p_offset` are clamped
--     here, so no caller can request an unbounded result or a negative
--     offset, and `p_search` is length-capped and wildcard-stripped, so no
--     argument reaches a query as free text.

-- ---------------------------------------------------------------------------
-- The signatures this migration replaces
-- ---------------------------------------------------------------------------
-- Dropped rather than kept alongside the new ones: a grep of the repository
-- shows `src/lib/adminHomeData.ts` is the only caller of either, and it moves
-- to the new shapes in this same change, so a second code path would only be
-- a second thing to keep secure. The availability signature must be dropped
-- (not replaced in place) because its RETURNS TABLE gains a column.
DROP FUNCTION IF EXISTS public.get_admin_no_movement_equipment(text[], int, int);
DROP FUNCTION IF EXISTS public.get_admin_availability_by_type(text[]);

-- ---------------------------------------------------------------------------
-- 1. Equipment that is outside right now
-- ---------------------------------------------------------------------------
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
  -- 500 is the largest page size the shared list system offers, and the
  -- Excel export walks the function in pages of 500.
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
    -- Window functions are evaluated before LIMIT / OFFSET, so this is the
    -- size of the whole filtered set and is identical on every returned row.
    -- One request therefore gives the page and its page count.
    count(*) OVER ()::int AS total_count,
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.last_movement_at,
    s.last_movement_type,
    s.last_movement_context
  FROM public.admin_equipment_state s
  WHERE s.is_active
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    -- "available" in `admin_equipment_state` is exactly "the latest movement
    -- is not an ENTRY, or there is no movement at all", i.e. the unit is
    -- neither inside a site nor in the workshop right now.
    AND s.state = 'available'
  -- Most recent exit first, and equipment that has never moved last: it has
  -- no date to sort by, and it is the tail of the list rather than an alarm.
  -- `id` breaks ties so paging is deterministic and a row can never appear on
  -- two pages or on none.
  ORDER BY s.last_movement_at DESC NULLS LAST, s.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_outside_equipment(text[], int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_outside_equipment(text[], int, int)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_outside_equipment(text[], int, int) IS
  'Admin home: one page of the active equipment that is outside right now - '
  'its latest movement across both contexts is not an ENTRY, or it has never '
  'moved. Ordered by last movement date descending with never-moved rows '
  'last, and every row carries total_count, the size of the whole filtered '
  'set. p_limit is clamped to 1..500, p_offset to >= 0 and p_owners is '
  'validated. SECURITY INVOKER plus an admin/monitor role check.';

-- ---------------------------------------------------------------------------
-- 2. Availability per equipment type, paginated and searchable
-- ---------------------------------------------------------------------------
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
  -- LIKE wildcards and the LIKE escape character are stripped so a search
  -- term can never widen its own match; chr(92) is the backslash. The length
  -- cap keeps a pathological term out of the pattern. An empty term is NULL,
  -- which means "no search" rather than "match the empty string".
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
    -- Counted over the grouped rows, so it is the number of matching TYPES,
    -- which is what the pagination divides into pages.
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
    WHERE s.is_active
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
      AND (v_term IS NULL OR s.type ILIKE '%' || v_term || '%')
    GROUP BY s.type
  ) grouped
  -- Biggest type first, then alphabetically, so paging is deterministic.
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
  'Admin home: one page of the per-type availability - how many active units '
  'of each equipment type are inside sites, in the workshop and available, '
  'and the type total - biggest type first. p_search is a wildcard-stripped '
  'ILIKE on the type and applies across every page; every row carries '
  'total_count, the number of matching types. p_limit is clamped to 1..500, '
  'p_offset to >= 0 and p_owners is validated. SECURITY INVOKER plus an '
  'admin/monitor role check.';

-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * Both functions read `admin_equipment_state`, which is one lateral
--     "latest movement" lookup per equipment row (served by
--     `idx_entry_exit_logs_equipment_time` from 0043) and then an in-memory
--     filter and sort over one row per equipment. Neither the new `state =
--     'available'` predicate nor the ILIKE on `type` changes that: they are
--     applied to that same derived row set, so an index on `equipment.type`
--     would never be reached through the view. At the current fleet size the
--     whole set is a few thousand rows and the sort is milliseconds.
--   * The pagination is LIMIT/OFFSET on that already-materialized set, so a
--     deep page costs no extra scan of `entry_exit_logs`; the deterministic
--     `ORDER BY ... , s.id` (and `total DESC, type` for the availability
--     table) is what keeps a row from appearing on two pages.
--   * If `equipment` grows by an order of magnitude, the change worth making
--     is a materialized "current state per equipment" table maintained by the
--     movement trigger, not an index on this view - that is a separate
--     decision and is deliberately not made here.
