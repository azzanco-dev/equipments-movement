-- Allow an open legacy site entry without a driver to receive its first driver
-- while preserving the append-only driver change history.

ALTER TABLE public.movement_driver_changes
  ALTER COLUMN previous_driver_id DROP NOT NULL,
  ALTER COLUMN previous_driver_name DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.change_active_movement_driver(
  p_entry_log_id uuid,
  p_new_driver_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.movement_driver_changes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.entry_exit_logs;
  v_previous record;
  v_new public.drivers;
  v_change public.movement_driver_changes;
BEGIN
  SELECT * INTO v_entry
  FROM public.entry_exit_logs
  WHERE id = p_entry_log_id
    AND movement_type = 'entry'
    AND movement_context = 'site';

  IF NOT FOUND OR NOT public.can_access_movement(p_entry_log_id) THEN
    RAISE EXCEPTION 'entry_not_accessible';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_entry.equipment_id::text || ':site', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_entry.equipment_id
      AND l.movement_context = 'site'
      AND l.movement_type = 'exit'
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  ) THEN
    RAISE EXCEPTION 'visit_is_closed';
  END IF;

  SELECT d.id, d.full_name INTO v_new
  FROM public.drivers d
  WHERE d.id = p_new_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_driver_id'; END IF;

  SELECT c.new_driver_id AS id, c.new_driver_name AS full_name
  INTO v_previous
  FROM public.movement_driver_changes c
  WHERE c.entry_log_id = p_entry_log_id
  ORDER BY c.changed_at DESC, c.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT v_entry.driver_id AS id, v_entry.driver_name AS full_name
    INTO v_previous;
  END IF;

  IF v_previous.id = v_new.id THEN
    RAISE EXCEPTION 'driver_unchanged';
  END IF;

  INSERT INTO public.movement_driver_changes (
    entry_log_id,
    previous_driver_id,
    previous_driver_name,
    new_driver_id,
    new_driver_name,
    changed_by,
    note
  ) VALUES (
    p_entry_log_id,
    v_previous.id,
    v_previous.full_name,
    v_new.id,
    v_new.full_name,
    auth.uid(),
    NULLIF(btrim(p_note), '')
  )
  RETURNING * INTO v_change;

  RETURN v_change;
END;
$$;

REVOKE ALL ON FUNCTION public.change_active_movement_driver(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_active_movement_driver(uuid, uuid, text)
  TO authenticated;
