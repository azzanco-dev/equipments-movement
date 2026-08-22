/*
# Add bilingual name columns to projects

## Summary
- Adds `name_ar` and `name_en` to the `projects` table.
- Drops the old `name` and `company` text columns (no longer used after
  the previous migration that unlinked companies from projects).
- Recreates the `equipment_visits` view to expose `project_name_ar` and
  `project_name_en` instead of the old `project_name`.
*/

-- Drop the view first since it depends on projects.name
DROP VIEW IF EXISTS equipment_visits;

-- ============ Add name_ar / name_en to projects ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'name_ar'
  ) THEN
    ALTER TABLE projects ADD COLUMN name_ar text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'name_en'
  ) THEN
    ALTER TABLE projects ADD COLUMN name_en text;
  END IF;
END $$;

-- Backfill new columns from old name if they are null
UPDATE projects
  SET name_ar = name,
      name_en = name
WHERE (name_ar IS NULL OR name_en IS NULL)
  AND name IS NOT NULL;

-- Make them NOT NULL after backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'name_ar'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE projects ALTER COLUMN name_ar SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'name_en'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE projects ALTER COLUMN name_en SET NOT NULL;
  END IF;
END $$;

-- ============ Drop old name and company columns ============
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'name'
  ) THEN
    ALTER TABLE projects DROP COLUMN name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'company'
  ) THEN
    ALTER TABLE projects DROP COLUMN company;
  END IF;
END $$;

-- ============ Recreate equipment_visits view ============
CREATE VIEW equipment_visits AS
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
