/*
# Scope the equipment_visits reporting view to the caller

## Problem
`equipment_visits` was created without `security_invoker`, so PostgreSQL evaluated
it with the view owner's rights and the row level security policy on
`entry_exit_logs` (`supervisor_id = auth.uid() OR is_admin()`) was never applied.
SELECT was also granted to `anon`, so an unauthenticated caller holding the public
anon key could read every gate movement ever recorded.

## Change
- Recreate the view `WITH (security_invoker = true)` so the querying user's
  policies apply: admins keep seeing everything, supervisors see only their own.
- Revoke every privilege on the view from `anon` and drop the write privileges
  that were granted to `authenticated` (the view is not writable and the app
  only reads it).
*/

DROP VIEW IF EXISTS public.equipment_visits;

CREATE VIEW public.equipment_visits
WITH (security_invoker = true) AS
SELECT
  e.id AS equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number,
  ent.project_id,
  p.name_ar AS project_name_ar,
  p.name_en AS project_name_en,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  ent.id AS entry_log_id,
  ent.recorded_at AS entry_recorded_at,
  ent.supervisor_id AS entry_supervisor_id,
  pe.full_name AS entry_supervisor_name,
  ent.driver_name,
  ent.odometer_reading,
  ent.notes,
  ent.photo_url,
  ent.registration_method,
  ex.id AS exit_log_id,
  ex.recorded_at AS exit_recorded_at,
  ex.supervisor_id AS exit_supervisor_id,
  px.full_name AS exit_supervisor_name,
  ex.odometer_reading AS exit_odometer,
  ex.notes AS exit_notes,
  ex.photo_url AS exit_photo_url,
  ex.registration_method AS exit_registration_method
FROM entry_exit_logs ent
JOIN equipment e ON e.id = ent.equipment_id
LEFT JOIN projects p ON p.id = ent.project_id
LEFT JOIN companies c ON c.id = ent.company_id
LEFT JOIN profiles pe ON pe.id = ent.supervisor_id
LEFT JOIN LATERAL (
  SELECT l.*
  FROM entry_exit_logs l
  WHERE l.equipment_id = ent.equipment_id
    AND l.movement_type = 'exit'
    AND l.recorded_at >= ent.recorded_at
  ORDER BY l.recorded_at ASC
  LIMIT 1
) ex ON true
LEFT JOIN profiles px ON px.id = ex.supervisor_id
WHERE ent.movement_type = 'entry';

REVOKE ALL ON public.equipment_visits FROM anon;
GRANT SELECT ON public.equipment_visits TO authenticated;
