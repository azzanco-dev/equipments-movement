/*
# Unlink companies from projects; link company + project to entry_exit_logs

## Summary
- Removes the `company_id` FK from `projects` (projects are now standalone).
- Adds `company_id` and `project_id` to `entry_exit_logs` so each entry/exit
  record captures which company and project the equipment was serving.
- Recreates the `equipment_visits` view to read company/project from the
  entry log instead of the equipment's project.

## Data Safety
- `projects.company_id` column is dropped (nullable FK, no user data lost
  since the `company` text column on projects remains intact).
- `entry_exit_logs` new columns are nullable so existing rows are unaffected.
*/

-- ============ Drop company_id from projects ============
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE projects DROP COLUMN company_id;
  END IF;
END $$;

-- ============ Add company_id + project_id to entry_exit_logs ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_exit_logs' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE entry_exit_logs ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_exit_logs' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE entry_exit_logs ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_logs_company_id ON entry_exit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_logs_project_id ON entry_exit_logs(project_id);

-- ============ Recreate equipment_visits view ============
DROP VIEW IF EXISTS equipment_visits;

CREATE VIEW equipment_visits AS
SELECT
  e.id AS equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number,
  ent.project_id,
  p.name AS project_name,
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
