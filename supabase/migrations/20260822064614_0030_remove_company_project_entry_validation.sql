/*
# Step 3 adjustment — remove company-project pair validation from ENTRY

## What this migration does (plain English)

Removes the database-level check that required an ENTRY's (company_id, project_id)
pair to exist in the `company_projects` join table. ENTRY movements are now valid
as long as both `company_id` and `project_id` are non-null and all existing
movement-sequence rules pass.

The `company_projects` table, its RLS policies, indexes, and constraints are
all left intact for future use — only the trigger validation is removed.

## What changed

- `public.enforce_movement_sequence()` — recreated WITHOUT the
  `company_projects` existence check. All other rules are unchanged:
    - movement type validation
    - non-admin recorded_at pinning to now()
    - ENTRY requires non-null company_id and project_id
    - advisory xact lock for concurrency
    - before/after movement sequence enforcement
    - EXIT with no prior movement rejection
    - EXIT inheritance of company_id, project_id, contractor_equipment_code

## What is NOT changed

- `company_projects` table — not dropped, not altered.
- RLS policies on `company_projects` — not removed.
- Indexes and unique constraint — not removed.
- All other movement rules — unchanged.
- Existing data — untouched.

## Notes

1. Safe to re-run (CREATE OR REPLACE FUNCTION).
2. The `company_projects` relationship remains available for future use but
   no longer restricts Equipment ENTRY movements.
*/

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_before      text;
  v_after       text;
  v_last_entry  record;
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