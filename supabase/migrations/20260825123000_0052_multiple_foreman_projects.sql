CREATE TABLE public.profile_projects (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, project_id)
);

CREATE INDEX profile_projects_project_id_idx ON public.profile_projects(project_id);

INSERT INTO public.profile_projects(profile_id,project_id)
SELECT id,project_id FROM public.profiles WHERE project_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET project_id=NULL WHERE project_id IS NOT NULL;

ALTER TABLE public.profile_projects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profile_projects TO authenticated;
CREATE POLICY "select_profile_projects" ON public.profile_projects FOR SELECT TO authenticated
  USING (profile_id=auth.uid() OR public.is_admin());
CREATE POLICY "insert_profile_projects" ON public.profile_projects FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "update_profile_projects" ON public.profile_projects FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "delete_profile_projects" ON public.profile_projects FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text := 'supervisor';
BEGIN
  IF NEW.raw_user_meta_data->>'admin_created'='true'
     AND NEW.raw_user_meta_data->>'role' IN ('admin','supervisor','workshop','assistant_workshop_manager','workshop_manager') THEN
    v_role:=NEW.raw_user_meta_data->>'role';
  END IF;
  INSERT INTO public.profiles(id,full_name,role,project_id)
  VALUES(NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.email),v_role,NULL);
  RETURN NEW;
END; $$;

-- Project assignments are stored for future scoping, but they intentionally do
-- not filter or restrict site movement creation at this stage.
CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_before text; v_after text; v_last_entry record; v_role text;
BEGIN
  NEW.created_at:=now();
  SELECT role INTO v_role FROM public.profiles WHERE id=auth.uid();
  IF NEW.movement_type NOT IN ('entry','exit') OR NEW.movement_context NOT IN ('site','workshop') THEN RAISE EXCEPTION 'invalid movement'; END IF;
  IF NEW.recorded_at>now() THEN RAISE EXCEPTION 'movement time cannot be in the future'; END IF;
  IF NEW.movement_context='workshop' THEN
    IF v_role NOT IN ('admin','workshop','assistant_workshop_manager','workshop_manager') THEN RAISE EXCEPTION 'workshop role required'; END IF;
    NEW.company_id:=NULL; NEW.project_id:=NULL; NEW.contractor_equipment_code:=NULL; NEW.driver_id:=NULL; NEW.driver_name:=NULL;
  ELSE
    IF v_role NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'foreman role required'; END IF;
    IF NEW.movement_type='entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
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
    NEW.company_id:=v_last_entry.company_id; NEW.project_id:=v_last_entry.project_id; NEW.contractor_equipment_code:=v_last_entry.contractor_equipment_code;
    IF NEW.movement_context='site' THEN
      SELECT c.new_driver_id,c.new_driver_name INTO NEW.driver_id,NEW.driver_name FROM public.movement_driver_changes c WHERE c.entry_log_id=v_last_entry.id ORDER BY c.changed_at DESC,c.id DESC LIMIT 1;
      IF NOT FOUND THEN NEW.driver_id:=v_last_entry.driver_id; NEW.driver_name:=v_last_entry.driver_name; END IF;
    END IF;
    IF v_last_entry.movement_context='workshop' AND v_last_entry.workshop_purpose='maintenance' THEN
      UPDATE public.equipment SET operational_status=COALESCE(v_last_entry.previous_operational_status,'operational') WHERE id=NEW.equipment_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
