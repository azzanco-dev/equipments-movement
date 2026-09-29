-- Admin home: the fleet mini tables under the state cards (owner-approved
-- design, 2026-09-30).
--
-- What changes here
-- =========================================================================
--   1. `admin_equipment_state` (0094, last replaced in 0102) gains three
--      columns, APPENDED after `status`: `last_movement_id`,
--      `last_company_id` and `last_project_id` of the same latest movement
--      the view already picks. The "داخل المواقع" mini table shows the
--      company and project the unit is in and opens the movement it entered
--      with, and the view is the one definition of "current state" the whole
--      page shares, so the extra columns belong here rather than in a second
--      lateral lookup. CREATE OR REPLACE VIEW only allows new columns at the
--      end, so every existing column keeps its name, type and position and no
--      current consumer changes shape.
--   2. `get_admin_fleet_equipment` returns one page of the active equipment
--      in one fleet state: `inside_site`, `workshop` (the three workshop
--      states, optionally narrowed by `p_purpose` to `maintenance`, `parking`
--      or `unclassified`) or `available`. It serves the three state mini
--      tables in their 7-row form and in their expanded, paginated form, and
--      the Excel export walks it page by page.
--   3. `get_admin_outside_equipment` (0101 / 0102) is DROPPED: its only
--      caller was the "معدات بلا حركة" section, which the "متاحة" mini table
--      replaces, and `get_admin_fleet_equipment('available', ...)` returns
--      exactly its row set in exactly its order. A grep of `src/` shows no
--      other caller.
--   4. One focused index for the "اخر المعدات المضافة" mini table, which
--      reads `equipment` ordered by `(created_at DESC, id DESC)`.
--
-- Security model - identical to 0094 / 0095 / 0101
-- =========================================================================
--   * The view keeps `security_invoker = true` (repeated, because a replace
--     would otherwise drop the option and run the view with the owner's
--     rights), so `equipment` and `entry_exit_logs` RLS stay authoritative.
--   * The function is SECURITY INVOKER, spelled out, and fails closed on the
--     caller's role: `current_user_role()` must be `admin` or `monitor`, and a
--     NULL role (no profile row) is rejected explicitly - `NULL NOT IN (...)`
--     alone evaluates to NULL and would let it through. The joined
--     `companies` / `projects` rows are read under the caller's RLS as well.
--   * `SET search_path = public, pg_temp`, so a caller-created temp object can
--     never shadow a referenced table.
--   * `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO
--     authenticated`; the view keeps the same REVOKE / GRANT.
--   * Every argument is validated or clamped: `p_state` and `p_purpose` are
--     allowlisted (a purpose is only accepted with `workshop`), the owner
--     array goes through `admin_home_owner_filter` (0095), `p_limit` is
--     clamped to 1..500 and `p_offset` to >= 0, so no caller can request an
--     unbounded result or a negative offset.

-- ===========================================================================
-- 1. The shared state view (definition from 0102, three columns appended)
-- ===========================================================================
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
  e.status,
  -- Appended in 0107. They describe the same latest movement as the columns
  -- above; all three are NULL for equipment that has never moved.
  m.id AS last_movement_id,
  m.company_id AS last_company_id,
  m.project_id AS last_project_id
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.company_id,
    l.project_id
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
  '(is_active AND status = ''active''). last_movement_id, last_company_id and '
  'last_project_id (0107) identify that same latest movement.';

-- ===========================================================================
-- 2. The replaced list function
-- ===========================================================================
DROP FUNCTION IF EXISTS public.get_admin_outside_equipment(text[], int, int);

-- ===========================================================================
-- 3. One page of the equipment in one fleet state
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_admin_fleet_equipment(
  p_state text,
  p_owners text[] DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_limit int DEFAULT 7,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  total_count int,
  id uuid,
  code text,
  type text,
  ownership_status text,
  state text,
  since timestamptz,
  last_movement_id uuid,
  last_movement_type text,
  last_movement_context text,
  workshop_purpose text,
  company_name_ar text,
  company_name_en text,
  project_name_ar text,
  project_name_en text
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
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 7), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_states text[];
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_state IS NULL
     OR p_state NOT IN ('inside_site', 'workshop', 'available') THEN
    RAISE EXCEPTION 'unknown fleet state' USING ERRCODE = '22023';
  END IF;
  IF p_purpose IS NOT NULL THEN
    IF p_state <> 'workshop' THEN
      RAISE EXCEPTION 'a workshop purpose requires the workshop state'
        USING ERRCODE = '22023';
    END IF;
    IF p_purpose NOT IN ('maintenance', 'parking', 'unclassified') THEN
      RAISE EXCEPTION 'unknown workshop purpose' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  -- The `state` values of `admin_equipment_state` this request covers.
  -- "workshop" is the union of the three workshop states, exactly as the
  -- "في الورشة الان" card counts it.
  v_states := CASE
    WHEN p_state = 'workshop' AND p_purpose IS NULL THEN ARRAY[
      'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
    ]
    WHEN p_state = 'workshop' THEN ARRAY['workshop_' || p_purpose]
    ELSE ARRAY[p_state]
  END;

  RETURN QUERY
  SELECT
    -- Window functions are evaluated before LIMIT / OFFSET, so this is the
    -- size of the whole filtered set and is identical on every returned row.
    count(*) OVER ()::int AS total_count,
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.state,
    -- The latest movement's time: the entry for a unit inside a site or in
    -- the workshop, the exit for an available one, NULL if it never moved.
    s.last_movement_at AS since,
    s.last_movement_id,
    s.last_movement_type,
    s.last_movement_context,
    s.last_workshop_purpose AS workshop_purpose,
    c.name_ar AS company_name_ar,
    c.name_en AS company_name_en,
    p.name_ar AS project_name_ar,
    p.name_en AS project_name_en
  FROM public.admin_equipment_state s
  LEFT JOIN public.companies c ON c.id = s.last_company_id
  LEFT JOIN public.projects p ON p.id = s.last_project_id
  WHERE s.is_active
    AND s.status = 'active'
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    AND s.state = ANY(v_states)
  -- Most recent movement first, and equipment that has never moved last (it
  -- has no date to sort by). `id` breaks ties so paging is deterministic and
  -- a row can never appear on two pages or on none.
  ORDER BY s.last_movement_at DESC NULLS LAST, s.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int) IS
  'Admin home: one page of the active equipment (is_active AND status = '
  '''active'') in one fleet state - inside_site, workshop (optionally one '
  'purpose: maintenance, parking or unclassified) or available - with the '
  'company and project of its latest movement. Ordered by the latest movement '
  'descending with never-moved rows last, and every row carries total_count, '
  'the size of the whole filtered set. p_state and p_purpose are allowlisted, '
  'p_limit is clamped to 1..500, p_offset to >= 0 and p_owners is validated. '
  'SECURITY INVOKER plus an admin/monitor role check.';

-- ===========================================================================
-- 4. "اخر المعدات المضافة"
-- ===========================================================================
-- The mini table reads `equipment` directly (RLS applies), filtered by owner
-- and the fleet predicate and ordered `(created_at DESC, id DESC)`. This index
-- serves that order so the first page is an index scan instead of a sort of
-- the whole table; `id` keeps the order deterministic for paging.
CREATE INDEX IF NOT EXISTS equipment_created_at_id_idx
  ON public.equipment (created_at DESC, id DESC);

-- ===========================================================================
-- Query plan notes
-- ===========================================================================
--   * `get_admin_fleet_equipment` reads `admin_equipment_state`, one lateral
--     "latest movement" lookup per equipment row (served by
--     `idx_entry_exit_logs_equipment_time`, 0043), then an in-memory filter
--     and sort over one row per equipment - the same plan as 0101. The two
--     joins are primary-key lookups on the page's rows.
--   * "اخر الدخوليات" reads `movement_log_search` with `movement_type =
--     'entry'` ordered `(recorded_at DESC, id DESC)`, which
--     `entry_exit_logs_recorded_id_idx` already serves; no index is added for
--     it.
