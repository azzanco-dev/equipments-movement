-- 0118: the purpose of a site EXIT in the lists (wave 12).
--
-- Owner request 2026-10-05. Since migrations 0111 / 0115 a site EXIT carries
-- `entry_exit_logs.exit_purpose` = 'maintenance' (للصيانة) or
-- 'work_completed' (انتهاء عمل); entries, workshop rows, the admin Excel
-- import and exits recorded before 0111 keep NULL. Until now only the movement
-- detail page showed it. This migration exposes it to the lists that are read
-- through views and the admin home fleet function, so they can show it, filter
-- by it and export it:
--   * the visits lists and the `/logs` visits view      (movement_visits)
--   * the `/logs` movement view, the home log tab and
--     the equipment inquiry timeline                    (movement_log_search)
--   * the admin home «المتاحة» mini table               (get_admin_fleet_equipment)
-- The equipment detail page reads `entry_exit_logs` directly, which already
-- has the column, so it needs nothing here.
--
-- Nothing is computed differently and no rule changes: every object below is
-- its latest definition VERBATIM with columns APPENDED at the end.
--
-- ===========================================================================
-- Recreated objects (each body copied verbatim from its latest migration)
-- ===========================================================================
--   `public.movement_log_search`   latest: 0116. Verbatim, plus ONE column
--       APPENDED after `project_name_ar_search`:
--         exit_purpose          the row's own `l.exit_purpose`
--   `public.movement_visits`       latest: 0116. Verbatim, plus ONE column
--       APPENDED after `driver_name_search`:
--         exit_purpose          the purpose of the EXIT that closed the visit,
--                               returned only when the next row of the visit
--                               window is an exit, with the same CASE pattern
--                               as `exit_id`, `exit_at` and
--                               `exit_supervisor_id`; NULL for an open visit.
--       To read it, the internal `paired` CTE gains one window column,
--       `LEAD(l.exit_purpose) OVER visit_order AS next_exit_purpose`, after
--       `next_supervisor_id`. The CTE is not part of the view's output; the
--       window, its partition and its `(recorded_at, id)` order are unchanged,
--       so every visit is paired exactly as before.
--   `public.admin_equipment_state` latest: 0107. Verbatim, plus ONE column
--       APPENDED after `last_project_id`:
--         last_exit_purpose     `exit_purpose` of the same latest movement
--                               the view already picks; the lateral lookup
--                               selects `l.exit_purpose` as its last column.
--       Non-NULL only when that latest movement is a site exit (the 0111
--       CHECK), i.e. for an «available» unit that left a project after 0111.
--   `public.get_admin_fleet_equipment(text, text[], text, int, int)`
--       latest: 0107. The body is 0107's verbatim — the fail-closed
--       admin/monitor check, the allowlisted p_state / p_purpose, the owner
--       filter, the clamped p_limit / p_offset, the fleet predicate, the
--       order and SECURITY INVOKER with the fixed search_path — plus ONE
--       column APPENDED to RETURNS TABLE and to the select list:
--         last_exit_purpose     `s.last_exit_purpose`
--       Adding an OUT column changes the function's result type, which
--       `CREATE OR REPLACE FUNCTION` cannot do, so the function is dropped and
--       created again inside this migration (one transaction), and its REVOKE,
--       GRANT and COMMENT are repeated. The argument list is identical.
--
-- ===========================================================================
-- Compatibility with the deployed UI (rollout: this migration first, then UI)
-- ===========================================================================
--   * Views: `CREATE OR REPLACE VIEW` only allows new columns at the end, and
--     every existing column keeps its name, position and type, so every
--     current select list (`MOVEMENT_LOG_*_SELECT`, `EQUIPMENT_VISITS_SELECT`,
--     the inquiry select, `fetchMovementRecorderNames`, the latest entries
--     mini table) is unaffected. `security_invoker = true`, `REVOKE ALL ...
--     FROM PUBLIC, anon` and `GRANT SELECT ... TO authenticated` are repeated.
--   * The function: the deployed client calls it through PostgREST `rpc()`
--     with the same five named arguments, and receives JSON objects that it
--     reads key by key (`parseFleetEquipmentRows`); an extra
--     `last_exit_purpose` key is ignored by it. The name and the argument
--     types are unchanged, so PostgREST resolves the same function, and the
--     schema cache is reloaded at the end of the file.
--   * Security is unchanged: both views stay security_invoker, so
--     entry_exit_logs RLS decides which rows and purposes a caller sees; the
--     function stays SECURITY INVOKER with its own role check.
--
-- ===========================================================================
-- Indexes
-- ===========================================================================
--   None. The new `/logs` filter is an equality on a two-value column that is
--   NULL for every entry and workshop row: an index on it would not be
--   selective, and the list is already driven by the `(recorded_at, id)`
--   order index (`entry_exit_logs_recorded_id_idx`). On `movement_visits` the
--   purpose is a window output, which no index can serve; the filter is
--   applied after the window, like the existing `is_open` filter.

-- ===========================================================================
-- 1. The movement log (`/logs`, the home log tab, the inquiry timeline)
-- ===========================================================================
-- 0116's definition verbatim; `exit_purpose` is APPENDED.
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
  e.ownership_status AS equipment_ownership_status,
  -- 0116: appended search-only columns; everything above is 0099 verbatim.
  e.type_search AS equipment_type_search,
  public.normalize_search_text(l.driver_name) AS driver_name_search,
  c.name_ar_search AS company_name_ar_search,
  p.name_ar_search AS project_name_ar_search,
  -- 0118: appended; everything above is 0116 verbatim. The purpose of a site
  -- EXIT (0111); NULL for entries, workshop rows and older exits.
  l.exit_purpose AS exit_purpose
FROM public.entry_exit_logs l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.companies c ON c.id = l.company_id
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profile_names s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;

-- 0116's comment, with the exit purpose described.
COMMENT ON VIEW public.movement_log_search IS
  'Movement rows flattened with the equipment/company/project/foreman/driver '
  'fields the movement log and reports display and search. security_invoker, '
  'so entry_exit_logs RLS stays authoritative for which movements are '
  'returned; the foreman name comes from profile_names (migration 0099), so '
  'it is shown on every movement the caller may read. Search covers equipment '
  'code, type, plate (raw plus normalized digits/letters), chassis number, '
  'the driver_name snapshot, and contractor_equipment_code; movement notes '
  'and the foreman name are deliberately not searchable. Since 0116 the '
  'Arabic text is searched through the *_search columns '
  '(normalize_search_text): equipment type, driver snapshot, company and '
  'project Arabic names. exit_purpose (0118) is the row''s own site exit '
  'purpose (maintenance or work_completed, migration 0111), NULL otherwise.';

-- ===========================================================================
-- 2. Visits (the foreman and workshop home lists, the `/logs` visits view)
-- ===========================================================================
-- 0116's definition verbatim; the CTE gains `next_exit_purpose` and the view
-- gains `exit_purpose`, APPENDED.
CREATE OR REPLACE VIEW public.movement_visits
WITH (security_invoker = true)
AS
WITH paired AS (
  SELECT
    l.id,
    l.equipment_id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.company_id,
    l.project_id,
    l.supervisor_id,
    l.driver_id,
    l.driver_name,
    l.recorded_at,
    l.contractor_equipment_code,
    LEAD(l.id) OVER visit_order AS next_id,
    LEAD(l.movement_type) OVER visit_order AS next_movement_type,
    LEAD(l.recorded_at) OVER visit_order AS next_recorded_at,
    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id,
    -- 0118: the purpose of the next row, read only when it is the exit.
    LEAD(l.exit_purpose) OVER visit_order AS next_exit_purpose
  FROM public.entry_exit_logs l
  WINDOW visit_order AS (
    PARTITION BY l.equipment_id, l.movement_context
    ORDER BY l.recorded_at, l.id
  )
)
SELECT
  p.id AS entry_id,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_id END AS exit_id,
  p.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number AS equipment_plate_number,
  -- Normalized digits, so a digits-only search term can probe the plate the
  -- same way `buildMovementSearchFilter()` does on `movement_log_search`.
  e.plate_digits AS equipment_plate_digits,
  p.movement_context,
  -- The purpose is the ENTRY's, always: a workshop EXIT has no purpose column
  -- of its own (migration 0076 blanks it), so this view is how an exit row
  -- inherits the classification of the visit it closed.
  p.workshop_purpose,
  p.company_id,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  p.supervisor_id AS entry_supervisor_id,
  s.full_name AS entry_supervisor_name,
  CASE
    WHEN p.next_movement_type = 'exit' THEN p.next_supervisor_id
  END AS exit_supervisor_id,
  p.driver_id,
  -- The ENTRY's snapshot. Legacy rows carry only this and no driver record,
  -- so it stays the display value; the list resolves later driver changes the
  -- same way the movement log does.
  p.driver_name,
  p.recorded_at AS entry_at,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at END AS exit_at,
  (p.next_movement_type IS DISTINCT FROM 'exit') AS is_open,
  GREATEST(
    0,
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          CASE
            WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at
            ELSE now()
          END
        ) - p.recorded_at
      ) / 60
    )
  )::int AS duration_minutes,
  -- 0106: appended columns only; everything above is 0099 verbatim.
  -- The ENTRY's company number, searchable from every visits list.
  p.contractor_equipment_code,
  -- The owner, so the admin log's owner filter applies to visits as well.
  e.ownership_status AS equipment_ownership_status,
  -- 0116: appended search-only columns; everything above is 0106 verbatim.
  e.type_search AS equipment_type_search,
  public.normalize_search_text(p.driver_name) AS driver_name_search,
  -- 0118: appended; everything above is 0116 verbatim. The purpose of the
  -- EXIT that closed the visit (0111), like exit_id / exit_at; NULL for an
  -- open visit, a workshop visit and an exit recorded before 0111.
  CASE
    WHEN p.next_movement_type = 'exit' THEN p.next_exit_purpose
  END AS exit_purpose
FROM paired p
LEFT JOIN public.equipment e ON e.id = p.equipment_id
LEFT JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN public.profile_names s ON s.id = p.supervisor_id
-- Applied after the window: an EXIT is never a visit of its own, it is the end
-- of the ENTRY before it. A lone legacy EXIT therefore does not appear here at
-- all; the equipment inquiry timeline is the screen that still shows those.
WHERE p.movement_type = 'entry';

REVOKE ALL ON public.movement_visits FROM PUBLIC, anon;
GRANT SELECT ON public.movement_visits TO authenticated;

-- 0116's comment, with the exit purpose described.
COMMENT ON VIEW public.movement_visits IS
  'One row per visit: each ENTRY paired with the EXIT that follows it in the '
  'same (equipment, movement_context) sequence, ordered deterministically by '
  '(recorded_at, id). is_open is true when no EXIT is visible directly after '
  'the ENTRY, and duration_minutes then runs to now(). workshop_purpose, '
  'company, project and contractor_equipment_code are the ENTRY''s, which is '
  'how a workshop EXIT inherits its visit classification; '
  'equipment_ownership_status is the equipment owner (migration 0106) so the '
  'admin log can filter visits by owner. security_invoker, so entry_exit_logs '
  'RLS stays authoritative and a caller never sees a visit built from a '
  'movement the movement log would hide; entry_supervisor_name comes from '
  'profile_names (migration 0099), so the recorder is named on every visit '
  'the caller may read. Search covers equipment code, type, plate (raw plus '
  'normalized digits), the driver_name snapshot and contractor_equipment_code; '
  'since 0116 the type and the driver snapshot are searched through '
  'equipment_type_search and driver_name_search (normalize_search_text). '
  'exit_purpose (0118) is the purpose of the EXIT that closed the visit '
  '(maintenance or work_completed, migration 0111), NULL while it is open.';

-- ===========================================================================
-- 3. The admin home's shared state view (definition from 0107, one column
--    appended)
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
  m.project_id AS last_project_id,
  -- Appended in 0118: the site exit purpose (0111) of that same latest
  -- movement; NULL unless it is a site exit recorded with a purpose.
  m.exit_purpose AS last_exit_purpose
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.company_id,
    l.project_id,
    l.exit_purpose
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
  'last_project_id (0107) identify that same latest movement; '
  'last_exit_purpose (0118) is its site exit purpose, if any.';

-- ===========================================================================
-- 4. One page of the equipment in one fleet state (body from 0107, one OUT
--    column appended)
-- ===========================================================================
-- The result type gains a column, which CREATE OR REPLACE cannot change: the
-- function is dropped and created again in this same transaction.
DROP FUNCTION IF EXISTS public.get_admin_fleet_equipment(text, text[], text, int, int);

CREATE FUNCTION public.get_admin_fleet_equipment(
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
  project_name_en text,
  last_exit_purpose text
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
    p.name_en AS project_name_en,
    -- 0118: appended. The purpose of the site exit that made a unit
    -- available; NULL for every other row.
    s.last_exit_purpose
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
  'SECURITY INVOKER plus an admin/monitor role check. last_exit_purpose '
  '(0118) is the site exit purpose of the latest movement, if any.';

NOTIFY pgrst, 'reload schema';
