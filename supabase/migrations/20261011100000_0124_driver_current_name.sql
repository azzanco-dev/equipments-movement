-- 0124: the driver's CURRENT name in the movement and visit lists (wave 19).
--
-- Owner report 2026-10-11. A driver record reads «شرفت علي» while some screens
-- show «سارفات علي». Every movement stores a `driver_name` SNAPSHOT when it is
-- recorded (`entry_exit_logs.driver_name`, and `new_driver_name` /
-- `previous_driver_name` on `movement_driver_changes`); the driver record was
-- corrected afterwards. Screens that read the record (the driver page, the
-- selectors) show the new name, screens that read the snapshot (the logs, the
-- visits, the exports, the movement detail) still show the old one. There is
-- one driver record, so this is purely a display question.
--
-- Owner decision: when a movement is linked to a driver record (`driver_id`
-- is not NULL) the screens show the record's CURRENT `drivers.full_name`. The
-- snapshot stays in the database untouched: no data is rewritten, and it is
-- still the value shown for legacy rows that carry only a name (no
-- `driver_id`). The driver-name SEARCH keeps matching the snapshot
-- (`driver_name_search`, migration 0116); the owner asked for no search
-- change.
--
-- This migration only exposes the record's name to the two list views; the
-- screens show `driver_full_name`, else the `driver_name` snapshot (and a
-- later driver change, resolved to its own record, wins over both). Screens
-- that read `entry_exit_logs` directly resolve the name with an embed or a
-- lookup and need nothing here.
--
-- Nothing is computed differently and no rule changes: both objects below are
-- their latest definition VERBATIM with ONE column APPENDED at the end.
--
-- ===========================================================================
-- Recreated objects (each body copied verbatim from its latest migration)
-- ===========================================================================
--   `public.movement_log_search`   latest: 0118. Verbatim, plus ONE column
--       APPENDED after `exit_purpose`:
--         driver_full_name      `d.full_name` of the row's own `driver_id`;
--                               the view already LEFT JOINs `drivers d` for
--                               `driver_mobile_number`, so no join is added.
--                               NULL for a legacy name-only row, a driverless
--                               entry and every workshop row.
--   `public.movement_visits`       latest: 0118. Verbatim, plus ONE column
--       APPENDED after `exit_purpose`:
--         driver_full_name      the current `full_name` of the ENTRY's
--                               `driver_id`, through ONE new join APPENDED at
--                               the end of the FROM clause:
--                                 LEFT JOIN public.drivers dv
--                                   ON dv.id = p.driver_id
--                               `drivers.id` is the primary key, so the join
--                               matches at most one row and never multiplies
--                               a visit. The `paired` CTE, its window (same
--                               partition, same `(recorded_at, id)` order) and
--                               the `WHERE p.movement_type = 'entry'` filter
--                               are unchanged, so every visit is paired
--                               exactly as before.
--   Not recreated: `admin_equipment_state` and `get_admin_fleet_equipment`
--   carry no driver name; `get_last_movement` and `get_entry_report_summary`
--   return `driver_id` next to their snapshot and the client resolves it.
--
-- ===========================================================================
-- Compatibility with the deployed UI (rollout: this migration first, then UI)
-- ===========================================================================
--   * `CREATE OR REPLACE VIEW` only allows new columns at the end, and every
--     existing column keeps its name, position and type, so every current
--     select list (`MOVEMENT_LOG_*_SELECT`, `EQUIPMENT_VISITS_SELECT`, the
--     inquiry select, the latest entries mini table) keeps working against
--     this migration: the live UI simply does not read the new column yet.
--   * The new UI selects `driver_full_name`, so it must be deployed AFTER this
--     migration is applied; against an older database its list requests would
--     fail with an unknown column.
--   * Security is unchanged: both views stay `security_invoker = true`, so
--     entry_exit_logs RLS decides which rows a caller sees and drivers RLS
--     (SELECT for every authenticated user, migration 0033) decides whether
--     the name is returned; `REVOKE ALL ... FROM PUBLIC, anon` and
--     `GRANT SELECT ... TO authenticated` are repeated.
--
-- ===========================================================================
-- Indexes
-- ===========================================================================
--   None. The new join is on `drivers.id`, the primary key; nothing filters,
--   searches or sorts on the new column.

-- ===========================================================================
-- 1. The movement log (`/logs`, the home log tab, the inquiry timeline)
-- ===========================================================================
-- 0118's definition verbatim; `driver_full_name` is APPENDED.
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
  l.exit_purpose AS exit_purpose,
  -- 0124: appended; everything above is 0118 verbatim. The CURRENT name of
  -- the row's driver record, shown instead of the `driver_name` snapshot.
  -- NULL for a legacy name-only row, a driverless entry and workshop rows.
  d.full_name AS driver_full_name
FROM public.entry_exit_logs l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.companies c ON c.id = l.company_id
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profile_names s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;

-- 0118's comment, with the driver's current name described.
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
  'purpose (maintenance or work_completed, migration 0111), NULL otherwise. '
  'driver_full_name (0124) is the CURRENT name of the row''s driver record, '
  'displayed instead of the driver_name snapshot when present; NULL for a '
  'legacy row that carries only the snapshot.';

-- ===========================================================================
-- 2. Visits (the foreman and workshop home lists, the `/logs` visits view)
-- ===========================================================================
-- 0118's definition verbatim; the view gains `driver_full_name`, APPENDED,
-- through one LEFT JOIN on the drivers primary key APPENDED to the FROM list.
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
  END AS exit_purpose,
  -- 0124: appended; everything above is 0118 verbatim. The CURRENT name of
  -- the ENTRY's driver record, shown instead of the `driver_name` snapshot.
  -- NULL for a legacy name-only entry, a driverless one and workshop visits.
  dv.full_name AS driver_full_name
FROM paired p
LEFT JOIN public.equipment e ON e.id = p.equipment_id
LEFT JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN public.profile_names s ON s.id = p.supervisor_id
-- 0124: appended. `drivers.id` is the primary key, so this matches at most
-- one row and never multiplies a visit.
LEFT JOIN public.drivers dv ON dv.id = p.driver_id
-- Applied after the window: an EXIT is never a visit of its own, it is the end
-- of the ENTRY before it. A lone legacy EXIT therefore does not appear here at
-- all; the equipment inquiry timeline is the screen that still shows those.
WHERE p.movement_type = 'entry';

REVOKE ALL ON public.movement_visits FROM PUBLIC, anon;
GRANT SELECT ON public.movement_visits TO authenticated;

-- 0118's comment, with the driver's current name described.
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
  '(maintenance or work_completed, migration 0111), NULL while it is open. '
  'driver_full_name (0124) is the CURRENT name of the ENTRY''s driver record, '
  'displayed instead of the driver_name snapshot when present; NULL for a '
  'legacy visit whose entry carries only the snapshot.';

NOTIFY pgrst, 'reload schema';
