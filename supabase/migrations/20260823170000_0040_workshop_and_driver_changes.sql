-- Workshop movements, short internal equipment codes, and auditable driver changes.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'supervisor', 'workshop'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := 'supervisor';
BEGIN
  IF NEW.raw_user_meta_data->>'admin_created' = 'true'
     AND NEW.raw_user_meta_data->>'role' IN ('admin', 'supervisor', 'workshop') THEN
    v_role := NEW.raw_user_meta_data->>'role';
  END IF;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), v_role);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  IF p_role NOT IN ('admin', 'supervisor', 'workshop') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot change your own role'; END IF;
  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS master_data_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS numbering_status text NOT NULL DEFAULT 'numbered';
ALTER TABLE public.equipment DROP CONSTRAINT IF EXISTS equipment_numbering_status_check;
ALTER TABLE public.equipment ADD CONSTRAINT equipment_numbering_status_check
  CHECK (numbering_status IN ('numbered', 'unnumbered'));

CREATE SEQUENCE IF NOT EXISTS public.equipment_short_code_seq START WITH 1;
REVOKE ALL ON SEQUENCE public.equipment_short_code_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_short_equipment_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  LOOP
    v_code := 'U' || lpad(nextval('public.equipment_short_code_seq')::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.equipment WHERE upper(code) = upper(v_code));
  END LOOP;
  RETURN v_code;
END; $$;
REVOKE ALL ON FUNCTION public.next_short_equipment_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quick_create_foreman_equipment(p_plate_number text, p_type text)
RETURNS public.equipment LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_equipment public.equipment; v_plate text := upper(btrim(p_plate_number)); v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'supervisor') OR v_plate = '' OR btrim(p_type) = '' THEN
    RAISE EXCEPTION 'invalid_quick_equipment';
  END IF;
  SELECT * INTO v_equipment FROM public.equipment WHERE upper(btrim(plate_number)) = v_plate LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment_types WHERE name = btrim(p_type)) THEN
    RAISE EXCEPTION 'invalid_equipment_type';
  END IF;
  INSERT INTO public.equipment(code, type, plate_number, operational_status, ownership_status, qr_value, master_data_complete, numbering_status)
  VALUES (public.next_short_equipment_code(), btrim(p_type), v_plate, 'operational', 'alazani', gen_random_uuid()::text, false, 'unnumbered')
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END; $$;
REVOKE ALL ON FUNCTION public.quick_create_foreman_equipment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_foreman_equipment(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.quick_create_workshop_equipment(p_numbering_status text, p_code text, p_plate_number text)
RETURNS public.equipment LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_equipment public.equipment; v_plate text := upper(btrim(p_plate_number)); v_code text; v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'workshop') OR p_numbering_status NOT IN ('numbered', 'unnumbered') OR v_plate = '' THEN
    RAISE EXCEPTION 'invalid_workshop_equipment';
  END IF;
  SELECT * INTO v_equipment FROM public.equipment WHERE upper(btrim(plate_number)) = v_plate LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;
  IF p_numbering_status = 'numbered' THEN
    v_code := upper(btrim(p_code));
    IF v_code = '' THEN RAISE EXCEPTION 'equipment_code_required'; END IF;
    IF EXISTS (SELECT 1 FROM public.equipment WHERE upper(code) = v_code) THEN RAISE EXCEPTION 'duplicate_equipment_code'; END IF;
  ELSE
    v_code := public.next_short_equipment_code();
  END IF;
  INSERT INTO public.equipment(code, type, plate_number, operational_status, ownership_status, qr_value, master_data_complete, numbering_status)
  VALUES (v_code, 'غير محدد', v_plate, 'operational', 'alazani', gen_random_uuid()::text, false, p_numbering_status)
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END; $$;
REVOKE ALL ON FUNCTION public.quick_create_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_workshop_equipment(text, text, text) TO authenticated;

ALTER TABLE public.entry_exit_logs ADD COLUMN IF NOT EXISTS movement_context text NOT NULL DEFAULT 'site';
ALTER TABLE public.entry_exit_logs DROP CONSTRAINT IF EXISTS entry_exit_logs_movement_context_check;
ALTER TABLE public.entry_exit_logs ADD CONSTRAINT entry_exit_logs_movement_context_check
  CHECK (movement_context IN ('site', 'workshop'));
CREATE INDEX IF NOT EXISTS idx_entry_exit_logs_equipment_context_time
  ON public.entry_exit_logs(equipment_id, movement_context, recorded_at, id);

CREATE OR REPLACE FUNCTION public.protect_workshop_required_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.id=OLD.entry_exit_log_id AND l.movement_context='workshop')
     AND (SELECT count(*) FROM public.entry_exit_photos p WHERE p.entry_exit_log_id=OLD.entry_exit_log_id) <= 1 THEN
    RAISE EXCEPTION 'workshop movement requires one photo';
  END IF;
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION public.protect_workshop_required_photo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_workshop_required_photo_trigger ON public.entry_exit_photos;
CREATE TRIGGER protect_workshop_required_photo_trigger BEFORE DELETE ON public.entry_exit_photos
FOR EACH ROW EXECUTE FUNCTION public.protect_workshop_required_photo();

CREATE TABLE public.movement_driver_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_log_id uuid NOT NULL REFERENCES public.entry_exit_logs(id) ON DELETE RESTRICT,
  previous_driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  previous_driver_name text NOT NULL,
  new_driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  new_driver_name text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);
CREATE INDEX movement_driver_changes_entry_time_idx ON public.movement_driver_changes(entry_log_id, changed_at, id);
ALTER TABLE public.movement_driver_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_movement_driver_changes ON public.movement_driver_changes FOR SELECT TO authenticated
  USING (public.can_access_movement(entry_log_id));

CREATE OR REPLACE FUNCTION public.change_active_movement_driver(p_entry_log_id uuid, p_new_driver_id uuid, p_note text DEFAULT NULL)
RETURNS public.movement_driver_changes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_entry public.entry_exit_logs; v_previous record; v_new public.drivers; v_change public.movement_driver_changes;
BEGIN
  SELECT * INTO v_entry FROM public.entry_exit_logs WHERE id = p_entry_log_id AND movement_type = 'entry' AND movement_context = 'site';
  IF NOT FOUND OR NOT public.can_access_movement(p_entry_log_id) THEN RAISE EXCEPTION 'entry_not_accessible'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text || ':site', 0));
  IF EXISTS (
    SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id = v_entry.equipment_id AND l.movement_context = 'site'
      AND l.movement_type = 'exit' AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  ) THEN RAISE EXCEPTION 'visit_is_closed'; END IF;
  SELECT d.id, d.full_name INTO v_new FROM public.drivers d WHERE d.id = p_new_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_driver_id'; END IF;
  SELECT c.new_driver_id AS id, c.new_driver_name AS full_name INTO v_previous
  FROM public.movement_driver_changes c WHERE c.entry_log_id = p_entry_log_id ORDER BY c.changed_at DESC, c.id DESC LIMIT 1;
  IF NOT FOUND THEN SELECT v_entry.driver_id AS id, v_entry.driver_name AS full_name INTO v_previous; END IF;
  IF v_previous.id IS NULL OR v_previous.id = v_new.id THEN RAISE EXCEPTION 'driver_unchanged'; END IF;
  INSERT INTO public.movement_driver_changes(entry_log_id, previous_driver_id, previous_driver_name, new_driver_id, new_driver_name, changed_by, note)
  VALUES (p_entry_log_id, v_previous.id, v_previous.full_name, v_new.id, v_new.full_name, auth.uid(), NULLIF(btrim(p_note), ''))
  RETURNING * INTO v_change;
  RETURN v_change;
END; $$;
REVOKE ALL ON FUNCTION public.change_active_movement_driver(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_active_movement_driver(uuid, uuid, text) TO authenticated;

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
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text || ':' || NEW.movement_context, 0));
  SELECT l.movement_type INTO v_before FROM public.entry_exit_logs l
   WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context AND (l.recorded_at,l.id) < (NEW.recorded_at,NEW.id)
   ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
  SELECT l.movement_type INTO v_after FROM public.entry_exit_logs l
   WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context AND (l.recorded_at,l.id) > (NEW.recorded_at,NEW.id)
   ORDER BY l.recorded_at,l.id LIMIT 1;
  IF v_before IS NOT NULL AND v_before = NEW.movement_type OR v_after IS NOT NULL AND v_after = NEW.movement_type THEN RAISE EXCEPTION 'sequence would be invalid'; END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
  IF NEW.movement_type = 'exit' THEN
    SELECT l.* INTO v_last_entry FROM public.entry_exit_logs l
     WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context AND l.movement_type = 'entry'
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

DROP FUNCTION IF EXISTS public.get_last_movement(uuid);
CREATE FUNCTION public.get_last_movement(p_equipment_id uuid, p_movement_context text DEFAULT 'site')
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
  WHERE l.equipment_id=p_equipment_id AND l.movement_context=p_movement_context
  ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_workshop_equipment(p_movement_type text, p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text, ownership_status text, qr_value text, is_active boolean, master_data_complete boolean, numbering_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_role NOT IN ('admin', 'workshop') OR p_movement_type NOT IN ('entry', 'exit') THEN RAISE EXCEPTION 'workshop role required'; END IF;
  RETURN QUERY
  SELECT e.id,e.code,e.type,e.plate_number,e.ownership_status,e.qr_value,e.is_active,e.master_data_complete,e.numbering_status
  FROM public.equipment e
  LEFT JOIN LATERAL (
    SELECT l.movement_type FROM public.entry_exit_logs l
    WHERE l.equipment_id=e.id AND l.movement_context='workshop'
    ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
    AND ((p_movement_type='entry' AND (last_movement.movement_type IS NULL OR last_movement.movement_type='exit'))
      OR (p_movement_type='exit' AND last_movement.movement_type='entry'))
  ORDER BY e.code LIMIT 20;
END; $$;
REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text) TO authenticated;

CREATE OR REPLACE VIEW public.equipment_visits WITH (security_invoker = true) AS
SELECT e.id equipment_id,e.code equipment_code,e.type equipment_type,e.plate_number,ent.project_id,p.name_ar project_name_ar,p.name_en project_name_en,
 c.name_ar company_name_ar,c.name_en company_name_en,ent.id entry_log_id,ent.recorded_at entry_recorded_at,ent.supervisor_id entry_supervisor_id,
 pe.full_name entry_supervisor_name,ent.driver_name,ent.odometer_reading,ent.notes,ent.photo_url,ent.registration_method,
 ex.id exit_log_id,ex.recorded_at exit_recorded_at,ex.supervisor_id exit_supervisor_id,px.full_name exit_supervisor_name,ex.odometer_reading exit_odometer,
 ex.notes exit_notes,ex.photo_url exit_photo_url,ex.registration_method exit_registration_method,ent.contractor_equipment_code,
 ex.driver_name exit_driver_name,ent.movement_context
FROM public.entry_exit_logs ent JOIN public.equipment e ON e.id=ent.equipment_id
LEFT JOIN public.projects p ON p.id=ent.project_id LEFT JOIN public.companies c ON c.id=ent.company_id LEFT JOIN public.profiles pe ON pe.id=ent.supervisor_id
LEFT JOIN LATERAL (SELECT l.* FROM public.entry_exit_logs l WHERE l.equipment_id=ent.equipment_id AND l.movement_context=ent.movement_context AND l.movement_type='exit' AND (l.recorded_at,l.id)>(ent.recorded_at,ent.id) ORDER BY l.recorded_at,l.id LIMIT 1) ex ON true
LEFT JOIN public.profiles px ON px.id=ex.supervisor_id WHERE ent.movement_type='entry';
REVOKE ALL ON public.equipment_visits FROM anon;
GRANT SELECT ON public.equipment_visits TO authenticated;
