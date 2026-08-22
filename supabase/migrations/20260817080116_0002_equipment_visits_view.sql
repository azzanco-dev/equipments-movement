CREATE OR REPLACE VIEW equipment_visits AS
SELECT
  e.id AS equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number,
  e.project_id,
  p.name AS project_name,
  p.company,
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
LEFT JOIN projects p ON p.id = e.project_id
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

CREATE OR REPLACE FUNCTION public.get_last_movement(p_equipment_id uuid)
RETURNS TABLE (
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.movement_type, l.recorded_at, l.supervisor_id
  FROM entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC
  LIMIT 1;
$$;
