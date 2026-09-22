-- The recorder's name on every movement a user may already read.
--
-- `select_profiles` (migration 0076) lets a user read their own profile row,
-- lets admin and monitor read all of them, and lets the workshop roles read
-- workshop-role profiles. Every movement-facing object joins `public.profiles`
-- for the display name under `security_invoker`, so that policy decides the
-- name column too:
--   * a foreman sees their own name and NULL for every other foreman;
--   * since migration 0098 the workshop roles read site movements, and every
--     one of them shows an empty "recorded by" because the foreman's profile
--     row is still hidden from them.
-- The movement itself is readable in both cases — only the name is missing —
-- so the list reads "someone recorded this" and the owner cannot tell who.
--
-- Owner decision (2026-09-22): the recorder's name is display data, not
-- sensitive data. It must appear on every movement row the caller is already
-- allowed to read.
--
-- ===========================================================================
-- Security model
-- ===========================================================================
--   * `public.profile_names` is the ONLY object here that does not run with
--     the caller's rights. It is a deliberate, reviewed exception, and it is
--     narrowed twice over:
--       - by columns: `id`, `full_name`, `role` and nothing else, ever. Email,
--         phone, `project_id`, `must_change_password` and every future column
--         of `profiles` stay behind `select_profiles`. A view cannot widen
--         itself later either: `CREATE OR REPLACE VIEW` can only append
--         columns, so adding one would have to be a new reviewed migration.
--       - by grant: `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT SELECT ...
--         TO authenticated`, so an anonymous PostgREST request cannot reach it
--         at all. Only a signed-in user can read a display name.
--     `security_invoker = false` is spelled out rather than left implicit, so
--     the exception is visible in the definition itself and a later
--     `CREATE OR REPLACE` cannot silently change which rights apply.
--   * `profiles` itself is untouched: `select_profiles`, the role column lock
--     (0014/0015/0084), the user-management functions and every write path
--     keep exactly the behaviour they have today. Nothing in this migration
--     writes.
--   * The movement objects below stay `security_invoker = true` (repeated in
--     each `CREATE OR REPLACE`, because a replace drops the option otherwise).
--     `entry_exit_logs` RLS therefore remains authoritative for WHICH
--     movements are returned; this migration only changes whether the name
--     column of an already-visible movement is populated.
--   * Every join stays a LEFT JOIN on the primary key, so nothing can drop a
--     movement, and `REVOKE`/`GRANT` are repeated after each recreate.
--
-- ===========================================================================
-- What changed
-- ===========================================================================
--   * NEW: `public.profile_names` (id, full_name, role).
--   * `public.movement_log_search` — 0094's definition verbatim (0086 plus the
--     `equipment_ownership_status` column 0094 appended), with the single line
--     `LEFT JOIN public.profiles s` changed to `public.profile_names s`. The
--     column list, its order and its types are identical, so
--     `MOVEMENT_LOG_*_SELECT` and every consumer are unchanged.
--   * `public.movement_visits` — 0096's definition verbatim, with the same one
--     join swapped. Column list identical.
--   * Nothing else. In particular:
--       - `public.get_last_movement` (0091) DOES join `profiles` for
--         `supervisor_name`, but it is `SECURITY DEFINER` and therefore
--         already bypasses `select_profiles`; the exit form's "last entry"
--         summary shows the foreman name for every role today. Recreating a
--         security-sensitive function for a no-op was rejected.
--       - The admin-home functions (0094/0095) and `get_entry_report_summary`
--         (0083) serve admin/monitor screens only, and those roles read every
--         profile row already.
--       - `public.equipment_visits` (0056) does expose
--         entry/exit supervisor names under invoker rights, but no consumer
--         reads those columns any more (the only caller,
--         `get_entry_report_summary`, selects the equipment/company/project
--         columns). It is left as the legacy view it is.

-- ---------------------------------------------------------------------------
-- The display-name view
-- ---------------------------------------------------------------------------
-- Supabase's Security Advisor reports a view that does not run with invoker
-- rights (`security_definer_view`). That entry is EXPECTED here: the
-- exception is the point of this view, and the three-column list below is
-- what keeps it safe.
CREATE OR REPLACE VIEW public.profile_names
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.full_name,
  p.role
FROM public.profiles p;

REVOKE ALL ON public.profile_names FROM PUBLIC, anon;
GRANT SELECT ON public.profile_names TO authenticated;

COMMENT ON VIEW public.profile_names IS
  'Display names only: id, full_name, role. DELIBERATE, REVIEWED EXCEPTION - '
  'this is the one view that runs with owner rights (security_invoker = '
  'false), so a signed-in user can resolve the name of the person who '
  'recorded a movement they may already read, which select_profiles (0076) '
  'would otherwise hide. Never add a column: email, phone and every other '
  'profile field stay behind select_profiles. Readable by authenticated only; '
  'anon is revoked.';

-- ---------------------------------------------------------------------------
-- The movement log (`/logs`, the home movements card, the inquiry timeline)
-- ---------------------------------------------------------------------------
-- 0094's definition, unchanged except for the `profiles s` -> `profile_names s`
-- join. security_invoker = true is repeated so the replace does not drop it.
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
LEFT JOIN public.profile_names s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;

-- 0086's comment, with the foreman-name sentence corrected: the name is no
-- longer restricted by select_profiles, the movement rows still are.
COMMENT ON VIEW public.movement_log_search IS
  'Movement rows flattened with the equipment/company/project/foreman/driver '
  'fields the movement log and reports display and search. security_invoker, '
  'so entry_exit_logs RLS stays authoritative for which movements are '
  'returned; the foreman name comes from profile_names (migration 0099), so '
  'it is shown on every movement the caller may read. Search covers equipment '
  'code, type, plate (raw plus normalized digits/letters), chassis number, '
  'the driver_name snapshot, and contractor_equipment_code; movement notes '
  'and the foreman name are deliberately not searchable.';

-- ---------------------------------------------------------------------------
-- Visits (the foreman and workshop home lists)
-- ---------------------------------------------------------------------------
-- 0096's definition, unchanged except for the `profiles s` -> `profile_names s`
-- join. security_invoker = true is repeated so the replace does not drop it.
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
    LEAD(l.id) OVER visit_order AS next_id,
    LEAD(l.movement_type) OVER visit_order AS next_movement_type,
    LEAD(l.recorded_at) OVER visit_order AS next_recorded_at,
    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id
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
  )::int AS duration_minutes
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

-- 0096's comment, with one sentence added for the name source.
COMMENT ON VIEW public.movement_visits IS
  'One row per visit: each ENTRY paired with the EXIT that follows it in the '
  'same (equipment, movement_context) sequence, ordered deterministically by '
  '(recorded_at, id). is_open is true when no EXIT is visible directly after '
  'the ENTRY, and duration_minutes then runs to now(). workshop_purpose, '
  'company and project are the ENTRY''s, which is how a workshop EXIT '
  'inherits its visit classification. security_invoker, so entry_exit_logs '
  'RLS stays authoritative and a caller never sees a visit built from a '
  'movement the movement log would hide; entry_supervisor_name comes from '
  'profile_names (migration 0099), so the recorder is named on every visit '
  'the caller may read.';

-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * `profile_names` is a one-table view with no predicate of its own, so the
--     planner inlines it and the join is the same primary-key lookup on
--     `profiles` it was before. The only difference is that no RLS qualifier
--     is attached to that scan, which makes the plan cheaper, not dearer.
--   * `profiles` is a small master table (one row per user), so both views
--     keep the nested-loop / hash-join shapes described in 0086, 0094 and
--     0096. Nothing here changes the row counts those plans were chosen for.
