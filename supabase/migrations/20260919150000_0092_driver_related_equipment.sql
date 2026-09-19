-- Related equipment on the driver detail page, derived from movements.
--
-- Owner decision (2026-09-19): the driver page should answer "which equipment
-- does this driver actually drive?" without a new master-data relation. The
-- answer is derived from the movement history, so it is always current and
-- nothing has to be maintained by hand.
--
-- One row per (driver_id, equipment_id):
--   * times_driven    how many distinct site ENTRY visits this driver drove the
--                     equipment on — either as the ENTRY driver, or because a
--                     `movement_driver_changes` row handed the equipment to him
--                     during that open visit. A driver who appears twice on the
--                     same ENTRY (entry driver, handed away, handed back) is
--                     counted once for that ENTRY: the UNION below dedupes on
--                     (equipment_id, driver_id, entry_log_id).
--   * last_driven_at  the ENTRY `recorded_at` of the most recent of those
--                     visits, with `last_entry_log_id` resolving ties
--                     deterministically by (recorded_at, id) — the same
--                     ordering every movement rule in this schema uses.
--   * is_current      the equipment's latest movement (across both contexts,
--                     ordered by (recorded_at DESC, id DESC)) is a site ENTRY
--                     that is still open, and the driver of that visit after
--                     any auditable changes is this driver.
--
-- Legacy rows: movements recorded before `driver_id` existed carry only the
-- `driver_name` snapshot. They cannot be attributed to a driver id without
-- guessing from a text name, so they are deliberately ignored here — the
-- counts below are "movements linked to this driver record", not "every
-- movement that ever named someone with this name". The movement log keeps
-- displaying those legacy rows unchanged; only this summary skips them.
--
-- Security model: `security_invoker = true`, so the caller's own RLS decides
-- everything the view returns. `entry_exit_logs` stays authoritative for which
-- movements are visible (a foreman therefore only sees equipment from visits he
-- may read), `movement_driver_changes` keeps its `can_access_movement()`
-- policy, and `drivers` / `equipment` keep theirs. `equipment` is LEFT JOINed
-- exactly as in `movement_log_search` (migration 0086): an equipment row the
-- caller may not read turns into NULL display columns instead of silently
-- dropping the movement. No SECURITY DEFINER is involved, and the view is
-- revoked from PUBLIC/anon and granted only to `authenticated`.
--
-- One consequence of `security_invoker` worth stating: `is_current` is computed
-- from the latest movement the *caller* can see. A caller who may read an ENTRY
-- but not the later EXIT that closed it would see that visit as still open.
-- That is the same visibility trade-off `equipment_current_state` (0071) and
-- `movement_log_search` (0086) already make.

CREATE OR REPLACE VIEW public.driver_equipment_summary
WITH (security_invoker = true)
AS
SELECT
  attributed.driver_id,
  attributed.equipment_id,
  eq.code AS equipment_code,
  eq.type AS equipment_type,
  eq.plate_number AS equipment_plate_number,
  count(*)::integer AS times_driven,
  (array_agg(
     attributed.recorded_at
     ORDER BY attributed.recorded_at DESC, attributed.entry_log_id DESC
   ))[1] AS last_driven_at,
  (array_agg(
     attributed.entry_log_id
     ORDER BY attributed.recorded_at DESC, attributed.entry_log_id DESC
   ))[1] AS last_entry_log_id,
  COALESCE(current_visit.driver_id = attributed.driver_id, false) AS is_current
FROM (
  -- The driver the site ENTRY was recorded with.
  SELECT l.equipment_id, l.driver_id, l.id AS entry_log_id, l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND l.driver_id IS NOT NULL
  UNION
  -- Any driver who took the equipment over while that visit was still open.
  SELECT l.equipment_id, c.new_driver_id, l.id, l.recorded_at
  FROM public.entry_exit_logs l
  JOIN public.movement_driver_changes c ON c.entry_log_id = l.id
  WHERE l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND c.new_driver_id IS NOT NULL
) attributed
LEFT JOIN public.equipment eq ON eq.id = attributed.equipment_id
LEFT JOIN LATERAL (
  -- Current driver of this equipment, but only while its latest movement is an
  -- open site ENTRY. Correlated so it runs for the equipment in hand instead of
  -- scanning every equipment row.
  SELECT COALESCE(latest_change.new_driver_id, latest.driver_id) AS driver_id
  FROM (
    SELECT l.id, l.movement_type, l.movement_context, l.driver_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = attributed.equipment_id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) latest
  LEFT JOIN LATERAL (
    SELECT c.new_driver_id
    FROM public.movement_driver_changes c
    WHERE c.entry_log_id = latest.id
    ORDER BY c.changed_at DESC, c.id DESC
    LIMIT 1
  ) latest_change ON true
  WHERE latest.movement_type = 'entry'
    AND latest.movement_context = 'site'
) current_visit ON true
GROUP BY
  attributed.driver_id,
  attributed.equipment_id,
  eq.code,
  eq.type,
  eq.plate_number,
  current_visit.driver_id;

REVOKE ALL ON public.driver_equipment_summary FROM PUBLIC, anon;
GRANT SELECT ON public.driver_equipment_summary TO authenticated;

COMMENT ON VIEW public.driver_equipment_summary IS
  'Equipment a driver actually drove, derived from site ENTRY movements plus '
  'movement_driver_changes hand-overs: times_driven, last_driven_at (ties '
  'broken by (recorded_at, id)) and is_current for an open site visit. '
  'security_invoker, so entry_exit_logs / movement_driver_changes RLS stays '
  'authoritative. Legacy movements that carry only the driver_name snapshot '
  'have no driver_id and are deliberately not attributed to any driver.';

-- Query plan notes.
--   * The driver page filters `driver_id = ?` and orders by
--     (is_current DESC, last_driven_at DESC) with LIMIT 20. `driver_id` and
--     `equipment_id` are grouping columns, so the predicate is pushed below the
--     aggregate and into both UNION branches.
--   * Branch 1 uses `idx_entry_exit_logs_driver_id` (0033). The new partial
--     index below narrows it to the site ENTRY rows this view reads and carries
--     the (recorded_at, id) ordering, so the branch is an index-only-ish scan
--     of just that driver's entries.
--   * Branch 2 needs `movement_driver_changes` by `new_driver_id`; only
--     `movement_driver_changes_entry_time_idx` (entry_log_id, changed_at, id)
--     existed, so a focused index is added. The table is small today, but the
--     branch would otherwise seq-scan it on every driver page.
--   * The correlated `current_visit` lateral uses
--     `idx_entry_exit_logs_equipment_time` (equipment_id, recorded_at, id) from
--     0043, and the inner change lookup uses
--     `movement_driver_changes_entry_time_idx` from 0040.

CREATE INDEX IF NOT EXISTS entry_exit_logs_site_entry_driver_idx
  ON public.entry_exit_logs (driver_id, recorded_at DESC, id DESC)
  WHERE movement_type = 'entry' AND movement_context = 'site';

CREATE INDEX IF NOT EXISTS movement_driver_changes_new_driver_idx
  ON public.movement_driver_changes (new_driver_id, entry_log_id);
