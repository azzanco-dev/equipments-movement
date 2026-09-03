-- Workshop staff share workshop movement visibility and registration while
-- classification remains restricted to managers. Enrich current movement
-- status with the project and foreman names used by the movement form.

DROP POLICY IF EXISTS "select_profiles" ON public.profiles;
CREATE POLICY "select_profiles" ON public.profiles FOR SELECT TO authenticated USING (
  auth.uid() = id
  OR public.is_admin()
  OR public.current_user_role() = 'monitor'
  OR (
    public.current_user_role() IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
    AND role IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
  )
);

DROP POLICY IF EXISTS "select_entry_exit_logs" ON public.entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON public.entry_exit_logs FOR SELECT TO authenticated USING (
  supervisor_id = auth.uid()
  OR public.is_admin()
  OR public.current_user_role() = 'monitor'
  OR (
    public.current_user_role() IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
    AND movement_context = 'workshop'
  )
);

CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.id = p_movement_id
      AND (
        l.supervisor_id = auth.uid()
        OR public.is_admin()
        OR public.current_user_role() = 'monitor'
        OR (
          public.current_user_role() IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
          AND l.movement_context = 'workshop'
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.search_workshop_equipment(text, text, text);
CREATE FUNCTION public.search_workshop_equipment(
  p_movement_type text,
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  ownership_status text,
  qr_value text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager')
     OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'workshop role required';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.ownership_status,
    e.qr_value,
    e.is_active,
    e.master_data_complete,
    e.numbering_status
  FROM public.equipment e
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR e.code ILIKE '%' || btrim(p_search) || '%'
      OR e.type ILIKE '%' || btrim(p_search) || '%'
      OR e.plate_number ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      p_movement_type = 'entry'
      OR (p_movement_type = 'exit' AND last_movement.movement_type = 'entry')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before text;
  v_after text;
  v_last_entry record;
  v_role text;
BEGIN
  NEW.created_at := now();
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  IF NEW.movement_context = 'workshop' THEN
    IF v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
      RAISE EXCEPTION 'workshop role required';
    END IF;
    NEW.company_id := NULL;
    NEW.project_id := NULL;
    NEW.contractor_equipment_code := NULL;
    NEW.driver_id := NULL;
    NEW.driver_name := NULL;
  ELSE
    IF v_role NOT IN ('admin', 'supervisor') THEN
      RAISE EXCEPTION 'foreman role required';
    END IF;
    IF NEW.movement_type = 'entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      IF NEW.driver_id IS NULL THEN
        IF current_setting('app.movement_excel_import', true) IS DISTINCT FROM 'true'
           OR NOT public.is_admin() THEN
          RAISE EXCEPTION 'driver_id is required for an entry';
        END IF;
        NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');
      ELSE
        SELECT d.full_name INTO NEW.driver_name
        FROM public.drivers d
        WHERE d.id = NEW.driver_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
      END IF;
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
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  IF (v_before IS NOT NULL AND v_before = NEW.movement_type)
     OR (v_after IS NOT NULL AND v_after = NEW.movement_type) THEN
    RAISE EXCEPTION 'sequence would be invalid';
  END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment';
  END IF;

  IF NEW.movement_type = 'exit' THEN
    SELECT l.* INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;

    NEW.company_id := v_last_entry.company_id;
    NEW.project_id := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
    IF NEW.movement_context = 'site' THEN
      SELECT c.new_driver_id, c.new_driver_name INTO NEW.driver_id, NEW.driver_name
      FROM public.movement_driver_changes c
      WHERE c.entry_log_id = v_last_entry.id
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT 1;
      IF NOT FOUND THEN
        NEW.driver_id := v_last_entry.driver_id;
        NEW.driver_name := v_last_entry.driver_name;
      END IF;
    END IF;
    IF v_last_entry.movement_context = 'workshop'
       AND v_last_entry.workshop_purpose = 'maintenance' THEN
      UPDATE public.equipment
      SET operational_status = COALESCE(v_last_entry.previous_operational_status, 'operational')
      WHERE id = NEW.equipment_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_last_movement(uuid, text);
CREATE FUNCTION public.get_last_movement(
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
  driver_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_role NOT IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor') THEN
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
    COALESCE(c.new_driver_name, l.driver_name)
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
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;
