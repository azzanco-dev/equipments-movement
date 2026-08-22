/*
# Separate movement time from record creation time

- `recorded_at` is the actual movement time supplied by the supervisor.
- `created_at` is the immutable server-side record creation time.
- Historical movements are allowed, but future movement times are rejected.
- Existing chronological entry/exit sequence validation remains unchanged.
*/

ALTER TABLE public.entry_exit_logs
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- The exact creation instant was not stored for legacy rows; recorded_at is
-- the closest reliable value available for a safe historical backfill.
UPDATE public.entry_exit_logs
SET created_at = recorded_at
WHERE created_at IS NULL;

ALTER TABLE public.entry_exit_logs
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entry_exit_logs_created_at
  ON public.entry_exit_logs(created_at);

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
  -- Always use the database clock for the audit timestamp.
  NEW.created_at := now();

  IF NEW.movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  IF NEW.movement_type = 'entry' THEN
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'company_id is required for an entry';
    END IF;
    IF NEW.project_id IS NULL THEN
      RAISE EXCEPTION 'project_id is required for an entry';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at ASC, l.id ASC
  LIMIT 1;

  IF v_before IS NOT NULL AND v_before = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement before this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  IF v_after IS NOT NULL AND v_after = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement after this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  IF NEW.movement_type = 'exit' AND v_before IS NULL AND v_after IS NULL THEN
    RAISE EXCEPTION 'equipment is not inside the gate';
  END IF;

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
