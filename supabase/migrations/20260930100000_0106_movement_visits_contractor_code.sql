-- Visits: the entry's contractor code and the equipment owner.
--
-- Two owner requests on the visits lists (wave 7):
--   * EM-198: the visits search (foreman home, workshop home, and the new
--     visits view of the admin log) must also find a visit by the company
--     number the foreman typed on the ENTRY (`contractor_equipment_code`),
--     exactly like the movement log already does through
--     `movement_log_search` (migration 0086).
--   * EM-197: the full log page (`/logs`) gets a visits view next to the
--     movement log, and the log's owner filter must work there too. The owner
--     filter reads `equipment_ownership_status`, which `movement_log_search`
--     has carried since migration 0094 but `movement_visits` never did.
--
-- ===========================================================================
-- What changed
-- ===========================================================================
--   * `public.movement_visits` — 0099's definition verbatim (0096 with the
--     `profile_names` join), plus:
--       - `l.contractor_equipment_code` read inside the `paired` CTE (an
--         internal column; the CTE is not part of the view's output), and
--       - two output columns APPENDED at the end of the select list, after
--         `duration_minutes`:
--           contractor_equipment_code   -- the ENTRY's own value
--           equipment_ownership_status  -- equipment.ownership_status
--     Every existing output column keeps its name, position and type, which
--     is what `CREATE OR REPLACE VIEW` requires, so `EQUIPMENT_VISITS_SELECT`
--     and every current consumer are unaffected.
--   * Nothing else.
--
-- The contractor code is the ENTRY's. An EXIT inherits it from that ENTRY
-- (migration 0027 and the sequence triggers after it), so the ENTRY value is
-- the visit's value.
--
-- ===========================================================================
-- Security model (unchanged)
-- ===========================================================================
--   * `security_invoker = true` is repeated, because a replace would drop the
--     option otherwise. `entry_exit_logs` RLS therefore stays authoritative
--     for which visits are returned; the two new columns only expose fields of
--     rows the caller may already read (`contractor_equipment_code` is on the
--     movement itself, `ownership_status` on the equipment row that is already
--     joined for code/type/plate and is readable under `equipment` RLS).
--   * The joins stay LEFT JOINs on primary keys, so nothing drops a visit.
--   * `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT SELECT ... TO authenticated`
--     are repeated after the recreate.
--
-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * The window is unchanged, so it is still fed by
--     `idx_entry_exit_logs_equipment_context_time` (0040) and a
--     `movement_context` predicate is still pushed into the WindowAgg input.
--   * The new ILIKE on `contractor_equipment_code` is one more OR branch of
--     the search, evaluated after the window over one row per ENTRY, like the
--     existing code/type/plate/driver branches (see 0096's notes).
--   * An `equipment_ownership_status` predicate filters the joined equipment
--     column after the window as well; `equipment` is a master table joined on
--     its primary key.

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
  )::int AS duration_minutes,
  -- 0106: appended columns only; everything above is 0099 verbatim.
  -- The ENTRY's company number, searchable from every visits list.
  p.contractor_equipment_code,
  -- The owner, so the admin log's owner filter applies to visits as well.
  e.ownership_status AS equipment_ownership_status
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

-- 0099's comment, with the two appended columns described.
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
  'normalized digits), the driver_name snapshot and contractor_equipment_code.';
