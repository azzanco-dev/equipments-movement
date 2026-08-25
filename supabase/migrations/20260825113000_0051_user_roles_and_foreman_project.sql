ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_project_id_idx ON public.profiles(project_id);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := 'supervisor'; v_project_id uuid;
BEGIN
  IF NEW.raw_user_meta_data->>'admin_created' = 'true'
     AND NEW.raw_user_meta_data->>'role' IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
    v_role := NEW.raw_user_meta_data->>'role';
  END IF;
  IF v_role='supervisor' THEN v_project_id := NULLIF(NEW.raw_user_meta_data->>'project_id','')::uuid; END IF;
  INSERT INTO public.profiles (id, full_name, role, project_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), v_role, v_project_id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  IF p_role NOT IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot change your own role'; END IF;
  UPDATE public.profiles SET role=p_role,project_id=CASE WHEN p_role='supervisor' THEN project_id ELSE NULL END WHERE id=p_user_id;
END; $$;

DROP POLICY IF EXISTS "select_profiles" ON public.profiles;
CREATE POLICY "select_profiles" ON public.profiles FOR SELECT TO authenticated USING (
  auth.uid()=id OR public.is_admin()
  OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager') AND role IN ('workshop','workshop_manager','assistant_workshop_manager'))
);

DROP POLICY IF EXISTS "select_entry_exit_logs" ON public.entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON public.entry_exit_logs FOR SELECT TO authenticated USING (
  supervisor_id=auth.uid() OR public.is_admin()
  OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager') AND movement_context='workshop')
);

CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entry_exit_logs l WHERE l.id=p_movement_id
      AND (l.supervisor_id=auth.uid() OR public.is_admin()
        OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager') AND l.movement_context='workshop'))
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.quick_create_workshop_equipment(p_numbering_status text, p_code text, p_plate_number text)
RETURNS public.equipment LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_equipment public.equipment; v_plate text := upper(btrim(p_plate_number)); v_code text; v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id=auth.uid();
  IF v_role NOT IN ('admin','workshop','assistant_workshop_manager','workshop_manager') OR p_numbering_status NOT IN ('numbered','unnumbered') OR v_plate='' THEN RAISE EXCEPTION 'invalid_workshop_equipment'; END IF;
  SELECT * INTO v_equipment FROM public.equipment WHERE upper(btrim(plate_number))=v_plate LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;
  IF p_numbering_status='numbered' THEN
    v_code:=upper(btrim(p_code));
    IF v_code='' THEN RAISE EXCEPTION 'equipment code required'; END IF;
    IF EXISTS(SELECT 1 FROM public.equipment WHERE upper(btrim(code))=v_code) THEN RAISE EXCEPTION 'duplicate equipment code'; END IF;
  ELSE
    LOOP v_code:='U'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)); EXIT WHEN NOT EXISTS(SELECT 1 FROM public.equipment WHERE code=v_code); END LOOP;
  END IF;
  INSERT INTO public.equipment(code,type,plate_number,operational_status,ownership_status,qr_value,master_data_complete,numbering_status)
  VALUES(v_code,'غير محدد',v_plate,'operational','alazani',gen_random_uuid()::text,false,p_numbering_status) RETURNING * INTO v_equipment;
  RETURN v_equipment;
END; $$;
REVOKE ALL ON FUNCTION public.quick_create_workshop_equipment(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_workshop_equipment(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_workshop_equipment(p_movement_type text,p_search text DEFAULT NULL,p_ownership_status text DEFAULT NULL)
RETURNS TABLE(id uuid,code text,type text,plate_number text,ownership_status text,qr_value text,is_active boolean,master_data_complete boolean,numbering_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id=auth.uid();
  IF v_role NOT IN ('admin','workshop','assistant_workshop_manager','workshop_manager') OR p_movement_type NOT IN ('entry','exit') THEN RAISE EXCEPTION 'workshop role required'; END IF;
  IF p_ownership_status IS NOT NULL AND p_ownership_status NOT IN ('alazani','takween','third_party_f','third_party_partnership_b','external_supplier') THEN RAISE EXCEPTION 'invalid ownership status'; END IF;
  RETURN QUERY SELECT e.id,e.code,e.type,e.plate_number,e.ownership_status,e.qr_value,e.is_active,e.master_data_complete,e.numbering_status
  FROM public.equipment e LEFT JOIN LATERAL (
    SELECT l.movement_type,l.supervisor_id FROM public.entry_exit_logs l WHERE l.equipment_id=e.id ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1
  ) last_movement ON true
  WHERE e.is_active AND (p_ownership_status IS NULL OR e.ownership_status=p_ownership_status)
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
    AND (p_movement_type='entry' OR (p_movement_type='exit' AND last_movement.movement_type='entry'
      AND (v_role IN ('admin','workshop_manager','assistant_workshop_manager') OR last_movement.supervisor_id=auth.uid())))
  ORDER BY e.code LIMIT 20;
END; $$;
REVOKE ALL ON FUNCTION public.search_workshop_equipment(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.classify_workshop_entry(p_entry_log_id uuid,p_purpose text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text; v_entry public.entry_exit_logs; v_current_status text; v_is_open boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id=auth.uid();
  IF v_role NOT IN ('admin','workshop_manager','assistant_workshop_manager') THEN RAISE EXCEPTION 'workshop manager required'; END IF;
  IF p_purpose NOT IN ('maintenance','parking') THEN RAISE EXCEPTION 'invalid workshop purpose'; END IF;
  SELECT * INTO v_entry FROM public.entry_exit_logs WHERE id=p_entry_log_id AND movement_context='workshop' AND movement_type='entry' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workshop entry not found'; END IF;
  v_is_open:=NOT EXISTS(SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=v_entry.equipment_id AND (l.recorded_at,l.id)>(v_entry.recorded_at,v_entry.id));
  IF NOT v_is_open THEN UPDATE public.entry_exit_logs SET workshop_purpose=p_purpose,previous_operational_status=NULL WHERE id=v_entry.id; RETURN; END IF;
  SELECT operational_status INTO v_current_status FROM public.equipment WHERE id=v_entry.equipment_id FOR UPDATE;
  IF v_entry.workshop_purpose='maintenance' AND p_purpose='parking' THEN
    UPDATE public.equipment SET operational_status=COALESCE(v_entry.previous_operational_status,'operational') WHERE id=v_entry.equipment_id;
    UPDATE public.entry_exit_logs SET workshop_purpose='parking',previous_operational_status=NULL WHERE id=v_entry.id;
  ELSIF v_entry.workshop_purpose IS DISTINCT FROM 'maintenance' AND p_purpose='maintenance' THEN
    UPDATE public.entry_exit_logs SET workshop_purpose='maintenance',previous_operational_status=v_current_status WHERE id=v_entry.id;
    UPDATE public.equipment SET operational_status='maintenance' WHERE id=v_entry.equipment_id;
  ELSE UPDATE public.entry_exit_logs SET workshop_purpose=p_purpose WHERE id=v_entry.id;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.classify_workshop_entry(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_workshop_entry(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_before text; v_after text; v_last_entry record; v_role text; v_profile_project_id uuid;
BEGIN
  NEW.created_at:=now();
  SELECT role,project_id INTO v_role,v_profile_project_id FROM public.profiles WHERE id=auth.uid();
  IF NEW.movement_type NOT IN ('entry','exit') OR NEW.movement_context NOT IN ('site','workshop') THEN RAISE EXCEPTION 'invalid movement'; END IF;
  IF NEW.recorded_at>now() THEN RAISE EXCEPTION 'movement time cannot be in the future'; END IF;
  IF NEW.movement_context='workshop' THEN
    IF v_role NOT IN ('admin','workshop','assistant_workshop_manager','workshop_manager') THEN RAISE EXCEPTION 'workshop role required'; END IF;
    NEW.company_id:=NULL; NEW.project_id:=NULL; NEW.contractor_equipment_code:=NULL; NEW.driver_id:=NULL; NEW.driver_name:=NULL;
  ELSE
    IF v_role NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'foreman role required'; END IF;
    IF v_role='supervisor' AND v_profile_project_id IS NULL THEN RAISE EXCEPTION 'foreman project required'; END IF;
    IF NEW.movement_type='entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      IF v_role='supervisor' AND NEW.project_id<>v_profile_project_id THEN RAISE EXCEPTION 'foreman project mismatch'; END IF;
      IF NEW.driver_id IS NULL THEN RAISE EXCEPTION 'driver_id is required for an entry'; END IF;
      SELECT d.full_name INTO NEW.driver_name FROM public.drivers d WHERE d.id=NEW.driver_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text,0));
  SELECT l.movement_type INTO v_before FROM public.entry_exit_logs l WHERE l.equipment_id=NEW.equipment_id AND (l.recorded_at,l.id)<(NEW.recorded_at,NEW.id) ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
  SELECT l.movement_type INTO v_after FROM public.entry_exit_logs l WHERE l.equipment_id=NEW.equipment_id AND (l.recorded_at,l.id)>(NEW.recorded_at,NEW.id) ORDER BY l.recorded_at,l.id LIMIT 1;
  IF v_before IS NOT NULL AND v_before=NEW.movement_type OR v_after IS NOT NULL AND v_after=NEW.movement_type THEN RAISE EXCEPTION 'sequence would be invalid'; END IF;
  IF NEW.movement_type='exit' AND v_before IS NULL THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
  IF NEW.movement_type='exit' THEN
    SELECT l.* INTO v_last_entry FROM public.entry_exit_logs l WHERE l.equipment_id=NEW.equipment_id AND l.movement_type='entry' AND (l.recorded_at,l.id)<(NEW.recorded_at,NEW.id) ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
    IF NEW.movement_context='workshop' AND v_role='workshop' AND v_last_entry.supervisor_id<>auth.uid() THEN RAISE EXCEPTION 'workshop exit must be registered by entry user'; END IF;
    IF NEW.movement_context='site' AND v_role='supervisor' AND v_last_entry.project_id<>v_profile_project_id THEN RAISE EXCEPTION 'foreman project mismatch'; END IF;
    NEW.company_id:=v_last_entry.company_id; NEW.project_id:=v_last_entry.project_id; NEW.contractor_equipment_code:=v_last_entry.contractor_equipment_code;
    IF NEW.movement_context='site' THEN
      SELECT c.new_driver_id,c.new_driver_name INTO NEW.driver_id,NEW.driver_name FROM public.movement_driver_changes c WHERE c.entry_log_id=v_last_entry.id ORDER BY c.changed_at DESC,c.id DESC LIMIT 1;
      IF NOT FOUND THEN NEW.driver_id:=v_last_entry.driver_id; NEW.driver_name:=v_last_entry.driver_name; END IF;
    END IF;
    IF v_last_entry.movement_context='workshop' AND v_last_entry.workshop_purpose='maintenance' THEN UPDATE public.equipment SET operational_status=COALESCE(v_last_entry.previous_operational_status,'operational') WHERE id=NEW.equipment_id; END IF;
  END IF;
  RETURN NEW;
END; $$;
