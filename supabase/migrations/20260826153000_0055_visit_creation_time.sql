-- Expose the entry row creation time for compact relative time in visit lists.
CREATE OR REPLACE VIEW public.equipment_visits WITH (security_invoker = true) AS
SELECT
  e.id equipment_id,
  e.code equipment_code,
  e.type equipment_type,
  e.plate_number,
  ent.project_id,
  p.name_ar project_name_ar,
  p.name_en project_name_en,
  c.name_ar company_name_ar,
  c.name_en company_name_en,
  ent.id entry_log_id,
  ent.recorded_at entry_recorded_at,
  ent.supervisor_id entry_supervisor_id,
  pe.full_name entry_supervisor_name,
  ent.driver_name,
  ent.odometer_reading,
  ent.notes,
  ent.photo_url,
  ent.registration_method,
  ex.id exit_log_id,
  ex.recorded_at exit_recorded_at,
  ex.supervisor_id exit_supervisor_id,
  px.full_name exit_supervisor_name,
  ex.odometer_reading exit_odometer,
  ex.notes exit_notes,
  ex.photo_url exit_photo_url,
  ex.registration_method exit_registration_method,
  ent.contractor_equipment_code,
  ex.driver_name exit_driver_name,
  ent.movement_context,
  ent.created_at entry_created_at
FROM public.entry_exit_logs ent
JOIN public.equipment e ON e.id = ent.equipment_id
LEFT JOIN public.projects p ON p.id = ent.project_id
LEFT JOIN public.companies c ON c.id = ent.company_id
LEFT JOIN public.profiles pe ON pe.id = ent.supervisor_id
LEFT JOIN LATERAL (
  SELECT l.*
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = ent.equipment_id
    AND l.movement_context = ent.movement_context
    AND l.movement_type = 'exit'
    AND (l.recorded_at, l.id) > (ent.recorded_at, ent.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1
) ex ON true
LEFT JOIN public.profiles px ON px.id = ex.supervisor_id
WHERE ent.movement_type = 'entry';

REVOKE ALL ON public.equipment_visits FROM anon;
GRANT SELECT ON public.equipment_visits TO authenticated;
