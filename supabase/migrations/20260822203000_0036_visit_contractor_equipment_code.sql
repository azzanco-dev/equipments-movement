-- Expose the contractor's equipment numbering on visit reports while keeping
-- the view security-invoker and existing column order intact.
CREATE OR REPLACE VIEW public.equipment_visits
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
  ex.registration_method AS exit_registration_method,
  ent.contractor_equipment_code
FROM public.entry_exit_logs ent
JOIN public.equipment e ON e.id = ent.equipment_id
LEFT JOIN public.projects p ON p.id = ent.project_id
LEFT JOIN public.companies c ON c.id = ent.company_id
LEFT JOIN public.profiles pe ON pe.id = ent.supervisor_id
LEFT JOIN LATERAL (
  SELECT l.* FROM public.entry_exit_logs l
  WHERE l.equipment_id = ent.equipment_id
    AND l.movement_type = 'exit'
    AND (l.recorded_at, l.id) > (ent.recorded_at, ent.id)
  ORDER BY l.recorded_at ASC, l.id ASC
  LIMIT 1
) ex ON true
LEFT JOIN public.profiles px ON px.id = ex.supervisor_id
WHERE ent.movement_type = 'entry';

REVOKE ALL ON public.equipment_visits FROM anon;
GRANT SELECT ON public.equipment_visits TO authenticated;
