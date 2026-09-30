-- Wave 8 security batch, part 2 of 2: evidence photos, user deletion, and the
-- role checks of the quick-create and lookup functions.
--
-- Owner approval 2026-09-30, after a read-only audit. Part 1 (0108) covers the
-- movement sequence itself. Nothing here edits or deletes data.
--
-- ===========================================================================
-- M4 — deleting a user must not delete evidence photos; role checks fail closed
-- ===========================================================================
--   * `entry_exit_photos.uploaded_by` referenced `profiles(id) ON DELETE
--     CASCADE` (0031). The Users screen deletes the `profiles` row, so deleting
--     a user silently removed every photo row that user had uploaded, on
--     anybody's movement. The foreign key becomes `ON DELETE RESTRICT`: the
--     delete is refused (SQLSTATE 23503) and the screen shows a translated
--     message. The constraint is looked up in the catalog instead of trusting
--     its default name. It is re-added `NOT VALID` and validated only when the
--     old foreign key to `profiles` was found, because then every existing row
--     is already known to satisfy it and the validation cannot fail. RESTRICT
--     is enforced for deletes either way.
--   * `NOT IN` on a NULL role is NULL, and `IF NULL THEN` does not raise, so a
--     caller whose profile row is missing passed these role checks. Each
--     function below is recreated from its latest definition with
--     `v_role IS NULL OR` added and nothing else changed:
--       - `classify_workshop_entry(uuid, text)`              (0051)
--       - `quick_create_workshop_equipment(text, text, text)` (0051)
--       - `quick_create_lessor_by_name(text)`                 (0049)
--       - `quick_create_foreman_equipment(text, text, text, uuid)` (0064)
--       - `get_last_movement(uuid, text)`                     (0091)
--     `enforce_movement_sequence()` is handled in 0108. Their `search_path`
--     is normalised to `public, pg_temp`.
--   * 0064 added the four-argument `quick_create_foreman_equipment` without
--     dropping the three-argument overload of 0049, which kept the same
--     NULL-unsafe check and is not called by the application. It is dropped.
--
-- ===========================================================================
-- M5 — the first-generation quick-create functions (0034)
-- ===========================================================================
--   `quick_create_driver`, `quick_create_lessor` and `quick_create_equipment`
--   checked only `auth.uid() IS NOT NULL` and were revoked only FROM PUBLIC, so
--   every signed-in role, `monitor` included, could create master data.
--   * `quick_create_lessor(text, text)` and `quick_create_equipment(text,
--     uuid)` are not called by the application or by any other function
--     (superseded by `quick_create_lessor_by_name` and
--     `quick_create_foreman_equipment`). They are dropped.
--   * `quick_create_driver(text, text)` is still used by the site movement
--     form. It is limited to the two roles that can record a site movement,
--     `admin` and `supervisor`, and revoked from `anon`.
--
-- ===========================================================================
-- M6 — a photo row is immutable except for its display order
-- ===========================================================================
--   The UPDATE policy of 0072 plus the table-level UPDATE privilege let an
--   uploader re-point `entry_exit_log_id` or `file_path`, moving a photo to
--   another movement he can read, past the max-three trigger (BEFORE INSERT
--   only). No application code updates this table. Two independent guards:
--   * column privilege: UPDATE is granted on `sort_order` only;
--   * a BEFORE UPDATE trigger that rejects a change to any other column,
--     whatever privilege the caller holds.
--   New rows are also bound to the path convention every upload path uses
--   (`app/api/movements/**`, `src/lib/movementPhotoUpload.ts`, the Storage
--   INSERT policy): `<uploader uuid>/<movement uuid>/<file>`, or
--   `<uploader uuid>/<pending batch uuid>/<file>` for a photo staged before the
--   movement existed, where the batch belongs to the uploader and lists the
--   path. So a row can no longer point at another user's object or at another
--   movement's folder. Existing rows are not checked.
--
-- ===========================================================================
-- M7 — reading a movement is not permission to attach photos to it
-- ===========================================================================
--   0098 widened `can_access_movement()` so the workshop roles can READ site
--   movements. The photo INSERT policy and the Storage INSERT policy reused
--   that helper, so a workshop role could attach photos to any site movement.
--   `public.can_write_movement_photos(uuid)` reproduces the write rule that was
--   in force before 0098 (0076 + the monitor exclusion of 0072): an admin, the
--   movement's own recorder, or a workshop role on a WORKSHOP movement. It is
--   an allowlist, so `monitor`, an unknown role and a missing profile never
--   write. Both INSERT policies use it; `uploaded_by = auth.uid()` and the
--   own-folder rule are kept.
--   Not changed: the SELECT policies (read stays as 0098 decided) and the
--   UPDATE/DELETE policies, which already require the caller to be the
--   uploader (or an admin) and so never reached another user's photo.

-- The foreign key swap below takes brief strong locks on `entry_exit_photos`
-- and `profiles`, a table every request reads. Fail fast instead of queueing
-- the application behind this migration if another session holds them.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. M4: uploaded_by -> profiles becomes ON DELETE RESTRICT
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_constraint record;
  v_found boolean := false;
BEGIN
  -- Every single-column foreign key on `uploaded_by`, whatever its name.
  FOR v_constraint IN
    SELECT c.conname, c.confrelid
    FROM pg_constraint c
    WHERE c.conrelid = 'public.entry_exit_photos'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'uploaded_by'
      )]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.entry_exit_photos DROP CONSTRAINT %I',
      v_constraint.conname
    );
    IF v_constraint.confrelid = 'public.profiles'::regclass THEN
      v_found := true;
    END IF;
  END LOOP;

  ALTER TABLE public.entry_exit_photos
    ADD CONSTRAINT entry_exit_photos_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
    ON DELETE RESTRICT
    NOT VALID;

  -- Every row satisfied the foreign key to profiles that was just dropped, so
  -- this validation cannot fail. Without that guarantee the constraint stays
  -- NOT VALID, which still enforces RESTRICT and every new row.
  IF v_found THEN
    ALTER TABLE public.entry_exit_photos
      VALIDATE CONSTRAINT entry_exit_photos_uploaded_by_fkey;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. M4: role checks fail closed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_workshop_entry(p_entry_log_id uuid, p_purpose text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_entry public.entry_exit_logs;
  v_current_status text;
  v_is_open boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop_manager', 'assistant_workshop_manager') THEN
    RAISE EXCEPTION 'workshop manager required';
  END IF;
  IF p_purpose NOT IN ('maintenance', 'parking') THEN
    RAISE EXCEPTION 'invalid workshop purpose';
  END IF;

  SELECT * INTO v_entry
  FROM public.entry_exit_logs
  WHERE id = p_entry_log_id
    AND movement_context = 'workshop'
    AND movement_type = 'entry'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workshop entry not found'; END IF;

  v_is_open := NOT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_entry.equipment_id
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  );
  IF NOT v_is_open THEN
    UPDATE public.entry_exit_logs
    SET workshop_purpose = p_purpose, previous_operational_status = NULL
    WHERE id = v_entry.id;
    RETURN;
  END IF;

  SELECT operational_status INTO v_current_status
  FROM public.equipment
  WHERE id = v_entry.equipment_id
  FOR UPDATE;

  IF v_entry.workshop_purpose = 'maintenance' AND p_purpose = 'parking' THEN
    UPDATE public.equipment
    SET operational_status = COALESCE(v_entry.previous_operational_status, 'operational')
    WHERE id = v_entry.equipment_id;
    UPDATE public.entry_exit_logs
    SET workshop_purpose = 'parking', previous_operational_status = NULL
    WHERE id = v_entry.id;
  ELSIF v_entry.workshop_purpose IS DISTINCT FROM 'maintenance' AND p_purpose = 'maintenance' THEN
    UPDATE public.entry_exit_logs
    SET workshop_purpose = 'maintenance', previous_operational_status = v_current_status
    WHERE id = v_entry.id;
    UPDATE public.equipment
    SET operational_status = 'maintenance'
    WHERE id = v_entry.equipment_id;
  ELSE
    UPDATE public.entry_exit_logs
    SET workshop_purpose = p_purpose
    WHERE id = v_entry.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_workshop_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_workshop_entry(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.quick_create_workshop_equipment(
  p_numbering_status text,
  p_code text,
  p_plate_number text
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment public.equipment;
  v_plate text := upper(btrim(p_plate_number));
  v_code text;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager')
     OR p_numbering_status NOT IN ('numbered', 'unnumbered')
     OR v_plate = '' THEN
    RAISE EXCEPTION 'invalid_workshop_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE upper(btrim(plate_number)) = v_plate
  LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;

  IF p_numbering_status = 'numbered' THEN
    v_code := upper(btrim(p_code));
    IF v_code = '' THEN RAISE EXCEPTION 'equipment code required'; END IF;
    IF EXISTS (SELECT 1 FROM public.equipment WHERE upper(btrim(code)) = v_code) THEN
      RAISE EXCEPTION 'duplicate equipment code';
    END IF;
  ELSE
    LOOP
      v_code := 'U' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = v_code);
    END LOOP;
  END IF;

  INSERT INTO public.equipment(
    code, type, plate_number, operational_status, ownership_status,
    qr_value, master_data_complete, numbering_status
  )
  VALUES (
    v_code, 'غير محدد', v_plate, 'operational', 'alazani',
    gen_random_uuid()::text, false, p_numbering_status
  )
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_create_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_workshop_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.quick_create_lessor_by_name(p_name text)
RETURNS public.lessors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lessor public.lessors;
  v_name text := btrim(p_name);
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor')
     OR v_name = ''
     OR char_length(v_name) > 150 THEN
    RAISE EXCEPTION 'invalid_quick_lessor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));
  SELECT * INTO v_lessor
  FROM public.lessors
  WHERE lower(btrim(name)) = lower(v_name)
  LIMIT 1;
  IF FOUND THEN RETURN v_lessor; END IF;

  INSERT INTO public.lessors(name)
  VALUES (v_name)
  RETURNING * INTO v_lessor;
  RETURN v_lessor;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_create_lessor_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_lessor_by_name(text) TO authenticated;

-- The three-argument overload of 0049 was left behind by 0064 with the same
-- NULL-unsafe role check; the application calls the four-argument one only.
DROP FUNCTION IF EXISTS public.quick_create_foreman_equipment(text, text, uuid);

CREATE OR REPLACE FUNCTION public.quick_create_foreman_equipment(
  p_plate_number text,
  p_chassis_number text,
  p_type text,
  p_lessor_id uuid
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment public.equipment;
  v_plate text := NULLIF(upper(btrim(p_plate_number)), '');
  v_chassis text := NULLIF(upper(btrim(p_chassis_number)), '');
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor')
     OR (v_plate IS NULL AND v_chassis IS NULL)
     OR btrim(p_type) = ''
     OR p_lessor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_quick_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE (v_plate IS NOT NULL AND upper(btrim(plate_number)) = v_plate)
     OR (v_chassis IS NOT NULL AND upper(btrim(chassis_number)) = v_chassis)
  ORDER BY
    CASE WHEN v_plate IS NOT NULL AND upper(btrim(plate_number)) = v_plate THEN 0 ELSE 1 END,
    created_at,
    id
  LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.equipment_types WHERE name = btrim(p_type)) THEN
    RAISE EXCEPTION 'invalid_equipment_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lessors WHERE id = p_lessor_id) THEN
    RAISE EXCEPTION 'invalid_lessor';
  END IF;

  INSERT INTO public.equipment(
    code,
    type,
    plate_number,
    chassis_number,
    operational_status,
    ownership_status,
    lessor_id,
    qr_value,
    master_data_complete,
    numbering_status
  )
  VALUES (
    public.next_short_equipment_code(),
    btrim(p_type),
    v_plate,
    v_chassis,
    'operational',
    'external_supplier',
    p_lessor_id,
    gen_random_uuid()::text,
    false,
    'unnumbered'
  )
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_create_foreman_equipment(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_foreman_equipment(text, text, text, uuid) TO authenticated;

-- Same signature and return columns as 0091, so CREATE OR REPLACE is enough.
CREATE OR REPLACE FUNCTION public.get_last_movement(
  p_equipment_id uuid,
  p_movement_context text DEFAULT 'site'
)
RETURNS TABLE(
  movement_type text,
  movement_context text,
  workshop_purpose text,
  recorded_at timestamptz,
  supervisor_id uuid,
  supervisor_name text,
  company_id uuid,
  project_id uuid,
  project_name_ar text,
  project_name_en text,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text,
  driver_mobile_number text,
  company_name_ar text,
  company_name_en text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor') THEN
    RAISE EXCEPTION 'authenticated role required';
  END IF;
  IF p_movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement context';
  END IF;

  RETURN QUERY
  SELECT
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.supervisor_id,
    s.full_name,
    l.company_id,
    l.project_id,
    p.name_ar,
    p.name_en,
    l.contractor_equipment_code,
    COALESCE(c.new_driver_id, l.driver_id),
    COALESCE(c.new_driver_name, l.driver_name),
    d.mobile_number,
    co.name_ar,
    co.name_en
  FROM public.entry_exit_logs l
  LEFT JOIN public.profiles s ON s.id = l.supervisor_id
  LEFT JOIN public.projects p ON p.id = l.project_id
  LEFT JOIN LATERAL (
    SELECT x.new_driver_id, x.new_driver_name
    FROM public.movement_driver_changes x
    WHERE x.entry_log_id = l.id
    ORDER BY x.changed_at DESC, x.id DESC
    LIMIT 1
  ) c ON l.movement_type = 'entry'
  LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id, l.driver_id)
  LEFT JOIN public.companies co ON co.id = l.company_id
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. M5: first-generation quick-create functions
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.quick_create_lessor(text, text);
DROP FUNCTION IF EXISTS public.quick_create_equipment(text, uuid);

CREATE OR REPLACE FUNCTION public.quick_create_driver(p_full_name text, p_mobile_number text)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers;
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  -- Only the roles that record a site movement may quick-create a driver.
  -- Fail closed: no session and a missing profile (NULL role) are rejected.
  IF auth.uid() IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'quick_driver_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Only an admin or a site foreman may quick-create a driver.';
  END IF;

  IF btrim(p_full_name) = '' OR btrim(p_mobile_number) !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'invalid_quick_driver';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE mobile_number = btrim(p_mobile_number)
  LIMIT 1;
  IF FOUND THEN RETURN v_driver; END IF;

  INSERT INTO public.drivers(full_name, mobile_number)
  VALUES (btrim(p_full_name), btrim(p_mobile_number))
  RETURNING * INTO v_driver;
  RETURN v_driver;
END;
$$;

COMMENT ON FUNCTION public.quick_create_driver(text, text) IS
  'Quick Create of a driver from the site movement form: full name and mobile number only, deduplicated by mobile number. Admin and supervisor only.';

REVOKE ALL ON FUNCTION public.quick_create_driver(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_driver(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. M7: who may attach photos to a movement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_movement_photos(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    JOIN public.profiles me ON me.id = auth.uid()
    WHERE l.id = p_movement_id
      AND (
        me.role = 'admin'
        OR (
          me.role IN ('supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager')
          AND l.supervisor_id = auth.uid()
        )
        OR (
          me.role IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
          AND l.movement_context = 'workshop'
        )
      )
  );
$$;

COMMENT ON FUNCTION public.can_write_movement_photos(uuid) IS
  'True when the caller may ATTACH photos to this movement: an admin, the movement''s own recorder, or a workshop role on a workshop movement. Narrower than can_access_movement(), which is the read rule. Monitor, an unknown role and a missing profile never write.';

REVOKE ALL ON FUNCTION public.can_write_movement_photos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_movement_photos(uuid) TO authenticated;

-- 0072's policy with the read helper replaced by the write helper.
DROP POLICY IF EXISTS "insert_entry_exit_photos" ON public.entry_exit_photos;
CREATE POLICY "insert_entry_exit_photos" ON public.entry_exit_photos
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_role() <> 'monitor'
  AND uploaded_by = auth.uid()
  AND public.can_write_movement_photos(entry_exit_log_id)
);

-- 0079's policy with the read helper replaced by the write helper. The
-- pending-batch branch (photos staged before the movement exists) is kept.
DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'log-photos'
  AND public.current_user_role() <> 'monitor'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.can_write_movement_photos(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND pending.expires_at > now()
        AND name = ANY(pending.file_paths)
    )
  )
);

-- ---------------------------------------------------------------------------
-- 5. M6: photo rows are immutable except for sort_order
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON TABLE public.entry_exit_photos FROM PUBLIC, anon, authenticated;
GRANT UPDATE (sort_order) ON TABLE public.entry_exit_photos TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_movement_photo_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.entry_exit_log_id IS DISTINCT FROM OLD.entry_exit_log_id
     OR NEW.file_path IS DISTINCT FROM OLD.file_path
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'photo_update_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Only the display order of a movement photo may be changed.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_movement_photo_identity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_movement_photo_identity_trigger ON public.entry_exit_photos;
CREATE TRIGGER protect_movement_photo_identity_trigger
  BEFORE UPDATE ON public.entry_exit_photos
  FOR EACH ROW EXECUTE FUNCTION public.protect_movement_photo_identity();

-- SECURITY DEFINER because it reads `pending_movement_photo_batches`, whose
-- RLS shows a caller only his own batches; the check must not depend on who
-- inserts the row.
CREATE OR REPLACE FUNCTION public.enforce_movement_photo_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[];
  v_folder uuid;
BEGIN
  v_parts := string_to_array(NEW.file_path, '/');

  -- Exactly <uploader>/<folder>/<file>: no nested folder, no empty segment.
  IF v_parts IS NULL
     OR cardinality(v_parts) <> 3
     OR v_parts[3] = ''
     OR public.safe_uuid(v_parts[1]) IS DISTINCT FROM NEW.uploaded_by THEN
    RAISE EXCEPTION 'invalid_photo_path'
      USING HINT = 'A movement photo must be stored in its uploader''s folder.';
  END IF;

  v_folder := public.safe_uuid(v_parts[2]);

  -- The folder is the movement itself, or a batch the uploader staged before
  -- the movement existed and that lists exactly this path.
  IF v_folder IS NOT NULL AND v_folder = NEW.entry_exit_log_id THEN
    RETURN NEW;
  END IF;
  IF v_folder IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.pending_movement_photo_batches pending
    WHERE pending.id = v_folder
      AND pending.uploaded_by = NEW.uploaded_by
      AND NEW.file_path = ANY(pending.file_paths)
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid_photo_path'
    USING HINT = 'A movement photo path must belong to its movement or to a batch staged by its uploader.';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_movement_photo_path()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_movement_photo_path_trigger ON public.entry_exit_photos;
CREATE TRIGGER enforce_movement_photo_path_trigger
  BEFORE INSERT ON public.entry_exit_photos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_movement_photo_path();

NOTIFY pgrst, 'reload schema';
