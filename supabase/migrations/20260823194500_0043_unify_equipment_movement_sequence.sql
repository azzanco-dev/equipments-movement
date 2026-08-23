-- Keep one deterministic ENTRY/EXIT sequence per equipment across site and workshop registration.

CREATE INDEX IF NOT EXISTS idx_entry_exit_logs_equipment_time
  ON public.entry_exit_logs(equipment_id, recorded_at, id);

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text; v_after text; v_last_entry record; v_role text;
BEGIN
  NEW.created_at := now();
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF NEW.movement_type NOT IN ('entry', 'exit') OR NEW.movement_context NOT IN ('site', 'workshop') THEN RAISE EXCEPTION 'invalid movement'; END IF;
  IF NEW.recorded_at > now() THEN RAISE EXCEPTION 'movement time cannot be in the future'; END IF;
  IF NEW.movement_context = 'workshop' THEN
    IF v_role NOT IN ('admin', 'workshop') THEN RAISE EXCEPTION 'workshop role required'; END IF;
    NEW.company_id := NULL; NEW.project_id := NULL; NEW.contractor_equipment_code := NULL; NEW.driver_id := NULL; NEW.driver_name := NULL;
  ELSE
    IF v_role NOT IN ('admin', 'supervisor') THEN RAISE EXCEPTION 'supervisor role required'; END IF;
    IF NEW.movement_type = 'entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      IF NEW.driver_id IS NULL THEN RAISE EXCEPTION 'driver_id is required for an entry'; END IF;
      SELECT d.full_name INTO NEW.driver_name FROM public.drivers d WHERE d.id = NEW.driver_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
  SELECT l.movement_type INTO v_before FROM public.entry_exit_logs l
   WHERE l.equipment_id = NEW.equipment_id AND (l.recorded_at,l.id) < (NEW.recorded_at,NEW.id)
   ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
  SELECT l.movement_type INTO v_after FROM public.entry_exit_logs l
   WHERE l.equipment_id = NEW.equipment_id AND (l.recorded_at,l.id) > (NEW.recorded_at,NEW.id)
   ORDER BY l.recorded_at,l.id LIMIT 1;
  IF v_before IS NOT NULL AND v_before = NEW.movement_type OR v_after IS NOT NULL AND v_after = NEW.movement_type THEN RAISE EXCEPTION 'sequence would be invalid'; END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
  IF NEW.movement_type = 'exit' THEN
    SELECT l.* INTO v_last_entry FROM public.entry_exit_logs l
     WHERE l.equipment_id = NEW.equipment_id AND l.movement_type = 'entry'
       AND (l.recorded_at,l.id) < (NEW.recorded_at,NEW.id) ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
    NEW.company_id := v_last_entry.company_id; NEW.project_id := v_last_entry.project_id; NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
    IF NEW.movement_context = 'site' THEN
      SELECT c.new_driver_id, c.new_driver_name INTO NEW.driver_id, NEW.driver_name
      FROM public.movement_driver_changes c WHERE c.entry_log_id = v_last_entry.id ORDER BY c.changed_at DESC,c.id DESC LIMIT 1;
      IF NOT FOUND THEN NEW.driver_id := v_last_entry.driver_id; NEW.driver_name := v_last_entry.driver_name; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.get_last_movement(p_equipment_id uuid, p_movement_context text DEFAULT 'site')
RETURNS TABLE(movement_type text, recorded_at timestamptz, supervisor_id uuid, company_id uuid, project_id uuid, contractor_equipment_code text, driver_id uuid, driver_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.movement_type,l.recorded_at,
    CASE WHEN public.is_admin() THEN l.supervisor_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.company_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.project_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.contractor_equipment_code ELSE NULL END,
    COALESCE(c.new_driver_id,l.driver_id),COALESCE(c.new_driver_name,l.driver_name)
  FROM public.entry_exit_logs l
  LEFT JOIN LATERAL (SELECT x.new_driver_id,x.new_driver_name FROM public.movement_driver_changes x WHERE x.entry_log_id=l.id ORDER BY x.changed_at DESC,x.id DESC LIMIT 1) c ON l.movement_type='entry'
  WHERE l.equipment_id=p_equipment_id
  ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.search_workshop_equipment(p_movement_type text, p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text, ownership_status text, qr_value text, is_active boolean, master_data_complete boolean, numbering_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'workshop') OR p_movement_type NOT IN ('entry', 'exit') THEN RAISE EXCEPTION 'workshop role required'; END IF;
  RETURN QUERY
  SELECT e.id,e.code,e.type,e.plate_number,e.ownership_status,e.qr_value,e.is_active,e.master_data_complete,e.numbering_status
  FROM public.equipment e
  LEFT JOIN LATERAL (
    SELECT l.movement_type FROM public.entry_exit_logs l
    WHERE l.equipment_id=e.id
    ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
    AND ((p_movement_type='entry' AND (last_movement.movement_type IS NULL OR last_movement.movement_type='exit'))
      OR (p_movement_type='exit' AND last_movement.movement_type='entry'))
  ORDER BY e.code LIMIT 20;
END; $$;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text) TO authenticated;
