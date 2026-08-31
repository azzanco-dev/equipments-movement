-- Read-only role with access to every movement and its evidence.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','supervisor','workshop','assistant_workshop_manager','workshop_manager','monitor'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text := 'supervisor';
BEGIN
  IF NEW.raw_user_meta_data->>'admin_created'='true'
     AND NEW.raw_user_meta_data->>'role' IN ('admin','supervisor','workshop','assistant_workshop_manager','workshop_manager','monitor') THEN
    v_role:=NEW.raw_user_meta_data->>'role';
  END IF;
  INSERT INTO public.profiles(id,full_name,role,project_id)
  VALUES(NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.email),v_role,NULL);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  IF p_role NOT IN ('admin','supervisor','workshop','assistant_workshop_manager','workshop_manager','monitor') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;
  IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'cannot change your own role'; END IF;
  UPDATE public.profiles
  SET role=p_role,project_id=CASE WHEN p_role='supervisor' THEN project_id ELSE NULL END
  WHERE id=p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text) TO authenticated;

DROP POLICY IF EXISTS "select_profiles" ON public.profiles;
CREATE POLICY "select_profiles" ON public.profiles FOR SELECT TO authenticated USING (
  auth.uid()=id OR public.is_admin() OR public.current_user_role()='monitor'
  OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager')
      AND role IN ('workshop','workshop_manager','assistant_workshop_manager'))
);

DROP POLICY IF EXISTS "select_entry_exit_logs" ON public.entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON public.entry_exit_logs FOR SELECT TO authenticated USING (
  supervisor_id=auth.uid() OR public.is_admin() OR public.current_user_role()='monitor'
  OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager') AND movement_context='workshop')
);

CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entry_exit_logs l WHERE l.id=p_movement_id
      AND (l.supervisor_id=auth.uid() OR public.is_admin() OR public.current_user_role()='monitor'
        OR (public.current_user_role() IN ('workshop_manager','assistant_workshop_manager') AND l.movement_context='workshop'))
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

DROP POLICY IF EXISTS "insert_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "insert_entry_exit_photos" ON public.entry_exit_photos FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role()<>'monitor' AND uploaded_by=auth.uid() AND public.can_access_movement(entry_exit_log_id));
DROP POLICY IF EXISTS "update_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "update_entry_exit_photos" ON public.entry_exit_photos FOR UPDATE TO authenticated
  USING (public.current_user_role()<>'monitor' AND public.can_access_movement(entry_exit_log_id) AND (uploaded_by=auth.uid() OR public.is_admin()))
  WITH CHECK (public.current_user_role()<>'monitor' AND public.can_access_movement(entry_exit_log_id) AND (uploaded_by=auth.uid() OR public.is_admin()));
DROP POLICY IF EXISTS "delete_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "delete_entry_exit_photos" ON public.entry_exit_photos FOR DELETE TO authenticated
  USING (public.current_user_role()<>'monitor' AND public.can_access_movement(entry_exit_log_id) AND (uploaded_by=auth.uid() OR public.is_admin()));

DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='log-photos' AND public.current_user_role()<>'monitor'
  AND (storage.foldername(name))[1]=auth.uid()::text
  AND public.can_access_movement(public.safe_uuid(split_part(name,'/',2)))
);
DROP POLICY IF EXISTS update_log_photos ON storage.objects;
CREATE POLICY update_log_photos ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='log-photos' AND public.current_user_role()<>'monitor' AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin()))
WITH CHECK (bucket_id='log-photos' AND public.current_user_role()<>'monitor' AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin()));
DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='log-photos' AND public.current_user_role()<>'monitor'
  AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin())
  AND (
    EXISTS (SELECT 1 FROM public.entry_exit_photos p WHERE p.file_path=name AND public.can_access_movement(p.entry_exit_log_id))
    OR public.can_access_movement(public.safe_uuid(split_part(name,'/',2)))
    OR EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.photo_url=name AND public.can_access_movement(l.id))
  )
);
