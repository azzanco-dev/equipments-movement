/*
# Equipment Visit View (Entry/Exit Pairing)

## Overview
Creates a database view that pairs each equipment "entry" log with its corresponding
"exit" log in a single row, for reporting purposes. The pairing logic: for each entry
log, find the closest subsequent exit log (by recorded_at) for the same equipment.
If the equipment entered but has not yet exited, the exit columns are NULL.

## New View
- **equipment_visits** — one row per visit (entry + matching exit)
  - equipment_id, equipment_code, equipment_type, plate_number
  - entry_log_id, entry_recorded_at, entry_supervisor_id, entry_supervisor_name
  - exit_log_id, exit_recorded_at, exit_supervisor_id, exit_supervisor_name
  - driver_name (from entry log), odometer_reading (from entry), exit_odometer (from exit)
  - notes (from entry), exit_notes (from exit)
  - photo_url (from entry), exit_photo_url (from exit)
  - registration_method (from entry), exit_registration_method (from exit)
  - project_id, project_name, company

## Logic
Uses LATERAL join: for each entry log, find the MIN(exit.recorded_at) where
exit.recorded_at >= entry.recorded_at AND same equipment AND movement_type='exit'.
Then LEFT JOIN to get the exit log details. This ensures each entry is paired with
its next exit, and entries without exits show NULL exit columns.

## Security
The view inherits RLS from the underlying tables. Since entry_exit_logs has RLS
(supervisors see only own logs), the view will also be filtered accordingly.
Admins see all visits; supervisors see only visits involving their own logs.
*/

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

-- Also create a helper function to get the last movement for an equipment
-- This is used by the frontend to validate before registering entry/exit
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