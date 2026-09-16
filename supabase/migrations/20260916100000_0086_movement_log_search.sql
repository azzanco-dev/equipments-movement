-- Movement log / report search must run in the database.
--
-- Before this migration the movement log, the movement reports tab, the
-- foreman list, and the workshop report searched equipment on the client
-- (`SELECT id FROM equipment ... LIMIT 100`) and then pushed the ids back as an
-- `equipment_id.in.(...)` filter. That capped every search at the first 100
-- matching equipment rows (silently wrong rows *and* wrong `count`), produced
-- very long request URLs, and made the workshop report return an empty page
-- whenever the term matched no equipment even if it matched a driver snapshot.
--
-- `movement_log_search` flattens the columns those screens display and search
-- onto each movement row so PostgREST can filter, count, sort, and paginate the
-- whole set in one request.
--
-- Security model: `security_invoker = true`, so the caller's RLS is what
-- decides visibility. `entry_exit_logs` stays authoritative for which movements
-- are returned, and every joined table keeps its own policy (`profiles` in
-- particular stays restricted, exactly as the previous `supervisor:profiles`
-- embed was). All joins are LEFT JOINs on primary keys, so a row the caller may
-- not read turns into NULL display columns and never drops a movement.

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
  d.mobile_number AS driver_mobile_number
FROM public.entry_exit_logs l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.companies c ON c.id = l.company_id
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profiles s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;

COMMENT ON VIEW public.movement_log_search IS
  'Movement rows flattened with the equipment/company/project/foreman/driver '
  'fields the movement log and reports display and search. security_invoker, '
  'so entry_exit_logs RLS stays authoritative. Search covers equipment code, '
  'type, plate (raw plus normalized digits/letters), chassis number, the '
  'driver_name snapshot, and contractor_equipment_code; movement notes and the '
  'foreman name are deliberately not searchable.';

-- Query plan notes (no new index is added):
--   * Paging/ordering keeps using entry_exit_logs_recorded_id_idx
--     (recorded_at DESC, id DESC) from migration 0035; the screens still order
--     by (recorded_at DESC, id DESC) / (created_at DESC, id DESC).
--   * Every join is to a primary key, so the un-searched page load is a set of
--     nested-loop index lookups, and the `count` subquery — which references no
--     joined column — is eligible for Postgres LEFT JOIN removal.
--   * The search predicate is one OR spanning entry_exit_logs and equipment, so
--     it cannot be answered by a single bitmap scan. The existing trigram
--     indexes (equipment code/type/plate_number/chassis_number from 0035 and
--     0085, entry_exit_logs driver_name/contractor_equipment_code from 0035)
--     still help when only one side is probed; otherwise the planner hash-joins
--     equipment, which is a small master table, and filters. Adding trigram
--     indexes on plate_digits / plate_letters_en was considered and rejected:
--     both columns hold 1–4 characters, so pg_trgm cannot extract a usable
--     trigram from a contained-pattern search on them.
--   * If entry_exit_logs later grows past what this comfortably scans, the
--     follow-up is a maintained denormalized search column on the table, not a
--     wider view.
