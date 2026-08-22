CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last text;
BEGIN
  IF NEW.movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  -- Non-admin callers may not backdate or postdate a movement.
  IF NOT public.is_admin() THEN
    NEW.recorded_at := now();
  END IF;

  -- Serialize concurrent inserts for the same equipment so the
  -- sequence check below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  SELECT l.movement_type INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  IF NEW.movement_type = 'entry' AND v_last = 'entry' THEN
    RAISE EXCEPTION 'equipment is already inside the gate';
  END IF;

  IF NEW.movement_type = 'exit' AND (v_last IS NULL OR v_last = 'exit') THEN
    RAISE EXCEPTION 'equipment is not inside the gate';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_movement_sequence ON public.entry_exit_logs;
CREATE TRIGGER enforce_movement_sequence
  BEFORE INSERT ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_movement_sequence();