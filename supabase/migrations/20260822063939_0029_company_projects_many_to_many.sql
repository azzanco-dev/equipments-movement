/*
# Step 3 — Company ↔ Project many-to-many relationship

## What this migration does (plain English)

1. Creates a new join table `company_projects` that links companies to projects
   many-to-many. A project can belong to multiple contractor companies, and a
   contractor company can be linked to multiple projects.

2. Adds a unique constraint on `(company_id, project_id)` to prevent duplicate
   links, plus indexes on both foreign-key columns for fast lookups.

3. Enables RLS on `company_projects`:
   - Admins can read, insert, and delete links.
   - Authenticated (non-admin) users can read links (needed for the ENTRY form
     to filter projects by company).
   - Anonymous access is blocked.

4. Updates the existing `enforce_movement_sequence()` trigger to validate that
   an ENTRY's `(company_id, project_id)` pair exists in `company_projects`.
   If it does not, the ENTRY is rejected. This check runs only for ENTRY
   movements; EXIT inherits its company/project from the latest ENTRY and
   does not need a separate check.

## New table

- `company_projects`
  - `id` (uuid, primary key)
  - `company_id` (uuid, not null, references `companies.id` ON DELETE CASCADE)
  - `project_id` (uuid, not null, references `projects.id` ON DELETE CASCADE)
  - `created_at` (timestamptz, default now())
  - Unique constraint on `(company_id, project_id)`

## Functions changed

- `public.enforce_movement_sequence()` — adds a company-project validation
  check for ENTRY movements, inserted after the existing company_id/project_id
  null checks and before the advisory lock (so a bad pair fails fast).

## Security

- RLS enabled on `company_projects`.
- No changes to existing RLS policies on other tables.
- The trigger function stays callable only by the table trigger (EXECUTE was
  revoked from all roles in migration 0025 and is not re-granted here).

## Legacy fields

- `equipment.project_id` is a legacy column that implies a single project per
  equipment. It is NOT used as the source of truth for current equipment
  location (the movement history in `entry_exit_logs` is). It is not removed
  or modified in this migration.
- `projects` has no `company_id` column — the relationship is now many-to-many
  through `company_projects`.

## Notes

1. No existing data is deleted or reset.
2. `company_projects` starts empty; the admin populates it via the UI.
3. No relationships are inferred from `entry_exit_logs`.
4. Safe to re-run (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE).
*/

-- 1. Create the join table
CREATE TABLE IF NOT EXISTS public.company_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Unique constraint to prevent duplicate links
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_projects_company_id_project_id_key'
      AND conrelid = 'public.company_projects'::regclass
  ) THEN
    ALTER TABLE public.company_projects
      ADD CONSTRAINT company_projects_company_id_project_id_key
      UNIQUE (company_id, project_id);
  END IF;
END $$;

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_company_projects_company_id
  ON public.company_projects (company_id);

CREATE INDEX IF NOT EXISTS idx_company_projects_project_id
  ON public.company_projects (project_id);

-- 4. Enable RLS
ALTER TABLE public.company_projects ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies
-- Admins: full CRUD. Authenticated non-admins: read-only. Anon: blocked.
DROP POLICY IF EXISTS "select_company_projects" ON public.company_projects;
CREATE POLICY "select_company_projects"
  ON public.company_projects FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_company_projects" ON public.company_projects;
CREATE POLICY "insert_company_projects"
  ON public.company_projects FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_company_projects" ON public.company_projects;
CREATE POLICY "update_company_projects"
  ON public.company_projects FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_company_projects" ON public.company_projects;
CREATE POLICY "delete_company_projects"
  ON public.company_projects FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 6. Update the trigger to validate company-project pair for ENTRY
CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before      text;
  v_after       text;
  v_last_entry  record;
  v_link_exists boolean;
BEGIN
  IF NEW.movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  -- Non-admin callers may not backdate or postdate a movement.
  IF NOT public.is_admin() THEN
    NEW.recorded_at := now();
  END IF;

  -- ENTRY must carry company_id and project_id.
  IF NEW.movement_type = 'entry' THEN
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'company_id is required for an entry';
    END IF;
    IF NEW.project_id IS NULL THEN
      RAISE EXCEPTION 'project_id is required for an entry';
    END IF;

    -- Validate that the (company_id, project_id) pair exists in company_projects.
    SELECT EXISTS(
      SELECT 1 FROM public.company_projects cp
      WHERE cp.company_id = NEW.company_id
        AND cp.project_id = NEW.project_id
    ) INTO v_link_exists;

    IF NOT v_link_exists THEN
      RAISE EXCEPTION 'company-project pair is not linked';
    END IF;
  END IF;

  -- Serialize concurrent inserts for the same equipment.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  -- Movement immediately BEFORE the new row's chronological position.
  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- Movement immediately AFTER the new row's chronological position.
  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at ASC, l.id ASC
  LIMIT 1;

  -- Rule: no two adjacent movements of the same type.
  IF v_before IS NOT NULL AND v_before = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement before this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  IF v_after IS NOT NULL AND v_after = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement after this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  -- An exit with no prior movement at all is invalid.
  IF NEW.movement_type = 'exit' AND v_before IS NULL AND v_after IS NULL THEN
    RAISE EXCEPTION 'equipment is not inside the gate';
  END IF;

  -- EXIT inherits company / project / contractor_equipment_code
  -- from the latest ENTRY *before* this exit's recorded_at.
  IF NEW.movement_type = 'exit' THEN
    SELECT l.company_id, l.project_id, l.contractor_equipment_code
      INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no prior entry found for this equipment';
    END IF;

    NEW.company_id                := v_last_entry.company_id;
    NEW.project_id                := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
  END IF;

  RETURN NEW;
END;
$$;