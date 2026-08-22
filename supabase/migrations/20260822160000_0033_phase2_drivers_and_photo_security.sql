/* Phase 2: drivers, movement-driver linkage, and photo security hardening. */

CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 150),
  id_number text NOT NULL UNIQUE CHECK (btrim(id_number) ~ '^[0-9]{5,20}$'),
  mobile_number text NOT NULL CHECK (btrim(mobile_number) ~ '^\+?[0-9]{7,15}$'),
  nationality text NOT NULL CHECK (nationality IN (
    'اليمن', 'مصر', 'باكستان', 'الهند', 'نيبال', 'بنجلاديش', 'السودان'
  )),
  employment_type text NOT NULL CHECK (employment_type IN (
    'العزاني', 'تكوين', 'البناء', 'البدراني', 'امدادات العربة', 'نقدي'
  )),
  job_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_full_name ON public.drivers(full_name);
CREATE INDEX IF NOT EXISTS idx_drivers_id_number ON public.drivers(id_number);
CREATE INDEX IF NOT EXISTS idx_drivers_mobile_number ON public.drivers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_drivers_nationality ON public.drivers(nationality);
CREATE INDEX IF NOT EXISTS idx_drivers_employment_type ON public.drivers(employment_type);

DROP TRIGGER IF EXISTS trg_drivers_updated_at ON public.drivers;
CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_drivers ON public.drivers;
CREATE POLICY select_drivers ON public.drivers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS insert_drivers ON public.drivers;
CREATE POLICY insert_drivers ON public.drivers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS update_drivers ON public.drivers;
CREATE POLICY update_drivers ON public.drivers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS delete_drivers ON public.drivers;
CREATE POLICY delete_drivers ON public.drivers FOR DELETE TO authenticated
  USING (public.is_admin());

ALTER TABLE public.entry_exit_logs
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_entry_exit_logs_driver_id
  ON public.entry_exit_logs(driver_id);

DROP FUNCTION IF EXISTS public.get_last_movement(uuid);
CREATE FUNCTION public.get_last_movement(p_equipment_id uuid)
RETURNS TABLE(
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid,
  company_id uuid,
  project_id uuid,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.movement_type,
         l.recorded_at,
         CASE WHEN public.is_admin() THEN l.supervisor_id ELSE NULL END,
         CASE WHEN public.is_admin() THEN l.company_id ELSE NULL END,
         CASE WHEN public.is_admin() THEN l.project_id ELSE NULL END,
         CASE WHEN public.is_admin() THEN l.contractor_equipment_code ELSE NULL END,
         l.driver_id,
         l.driver_name
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_before text;
  v_after text;
  v_last_entry record;
BEGIN
  NEW.created_at := now();

  IF NEW.movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  IF NEW.movement_type = 'entry' THEN
    IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
    IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
    IF NEW.driver_id IS NULL THEN RAISE EXCEPTION 'driver_id is required for an entry'; END IF;

    SELECT d.full_name INTO NEW.driver_name
    FROM public.drivers d WHERE d.id = NEW.driver_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;

  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at ASC, l.id ASC LIMIT 1;

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
    SELECT l.company_id, l.project_id, l.contractor_equipment_code, l.driver_id, l.driver_name
      INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;

    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
    NEW.company_id := v_last_entry.company_id;
    NEW.project_id := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
    NEW.driver_id := v_last_entry.driver_id;
    NEW.driver_name := v_last_entry.driver_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entry_exit_logs l
    WHERE l.id = p_movement_id
      AND (l.supervisor_id = auth.uid() OR public.is_admin())
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.safe_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
BEGIN
  RETURN p_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_uuid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_uuid(text) TO authenticated;

DROP POLICY IF EXISTS "select_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "select_entry_exit_photos" ON public.entry_exit_photos FOR SELECT TO authenticated
  USING (public.can_access_movement(entry_exit_log_id));

DROP POLICY IF EXISTS "insert_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "insert_entry_exit_photos" ON public.entry_exit_photos FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.can_access_movement(entry_exit_log_id));

DROP POLICY IF EXISTS "update_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "update_entry_exit_photos" ON public.entry_exit_photos FOR UPDATE TO authenticated
  USING (public.can_access_movement(entry_exit_log_id) AND (uploaded_by = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_access_movement(entry_exit_log_id) AND (uploaded_by = auth.uid() OR public.is_admin()));

DROP POLICY IF EXISTS "delete_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "delete_entry_exit_photos" ON public.entry_exit_photos FOR DELETE TO authenticated
  USING (public.can_access_movement(entry_exit_log_id) AND (uploaded_by = auth.uid() OR public.is_admin()));

CREATE OR REPLACE FUNCTION public.enforce_max_three_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE photo_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.entry_exit_log_id::text, 1));
  SELECT count(*) INTO photo_count
  FROM public.entry_exit_photos
  WHERE entry_exit_log_id = NEW.entry_exit_log_id;
  IF photo_count >= 3 THEN RAISE EXCEPTION 'maximum 3 photos per movement'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_max_three_photos() FROM PUBLIC, anon, authenticated;

UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'log-photos';

DROP POLICY IF EXISTS select_log_photos ON storage.objects;
CREATE POLICY select_log_photos ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'log-photos' AND EXISTS (
    SELECT 1
    FROM public.entry_exit_photos p
    WHERE p.file_path = name AND public.can_access_movement(p.entry_exit_log_id)
  )
  OR bucket_id = 'log-photos' AND EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.photo_url = name AND public.can_access_movement(l.id)
  )
);

DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'log-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
);

DROP POLICY IF EXISTS update_log_photos ON storage.objects;
CREATE POLICY update_log_photos ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'log-photos' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()))
WITH CHECK (bucket_id = 'log-photos' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  AND (
    EXISTS (SELECT 1 FROM public.entry_exit_photos p WHERE p.file_path = name AND public.can_access_movement(p.entry_exit_log_id))
    OR (
      public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
    )
    OR EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.photo_url = name AND public.can_access_movement(l.id))
  )
);
