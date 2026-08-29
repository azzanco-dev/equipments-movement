-- Keep historical movement imports compatible when the driver is missing from master data.
-- Company, project, equipment, and movement dates remain validated.

CREATE OR REPLACE FUNCTION public.prepare_movement_import(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
  v_errors jsonb;
  v_equipment record;
  v_company record;
  v_project record;
  v_driver record;
  v_supervisor record;
  v_mode text;
  v_entry_date date;
  v_exit_date date;
  v_value text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'invalid_import_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_errors := '[]'::jsonb;
    v_entry_date := NULL;
    v_exit_date := NULL;
    v_mode := COALESCE(NULLIF(v_row->>'mode', ''), 'entry');

    IF v_mode NOT IN ('entry', 'exit', 'both') THEN
      v_errors := v_errors || '"invalid_mode"'::jsonb;
    END IF;

    v_value := NULLIF(btrim(v_row->>'equipment_code'), '');
    SELECT e.id, e.code, e.type, e.plate_number
    INTO v_equipment
    FROM public.equipment e
    WHERE (v_value IS NOT NULL AND upper(btrim(e.code)) = upper(v_value))
       OR (
         NULLIF(btrim(v_row->>'plate_number'), '') IS NOT NULL
         AND regexp_replace(upper(COALESCE(e.plate_number, '')), '[^A-Z0-9ء-ي]', '', 'g') =
             regexp_replace(upper(v_row->>'plate_number'), '[^A-Z0-9ء-ي]', '', 'g')
       )
    ORDER BY CASE WHEN upper(btrim(e.code)) = upper(COALESCE(v_value, '')) THEN 0 ELSE 1 END, e.code
    LIMIT 1;
    IF NOT FOUND THEN
      v_errors := v_errors || '"equipment_not_found"'::jsonb;
    END IF;

    v_value := NULLIF(btrim(v_row->>'company_name'), '');
    SELECT c.id, c.name_ar, c.name_en INTO v_company
    FROM public.companies c
    WHERE v_value IS NOT NULL
      AND (lower(btrim(c.name_ar)) = lower(v_value)
        OR lower(btrim(c.name_en)) = lower(v_value))
    ORDER BY c.created_at, c.id LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'project_name'), '');
    SELECT p.id, p.name_ar, p.name_en INTO v_project
    FROM public.projects p
    WHERE v_value IS NOT NULL
      AND (lower(btrim(p.name_ar)) = lower(v_value)
        OR lower(btrim(p.name_en)) = lower(v_value))
    ORDER BY p.created_at, p.id LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'driver_name'), '');
    SELECT d.id, d.full_name, d.mobile_number, d.id_number INTO v_driver
    FROM public.drivers d
    WHERE (v_value IS NOT NULL AND lower(btrim(d.full_name)) = lower(v_value))
       OR (
           NULLIF(btrim(v_row->>'driver_number'), '') IS NOT NULL
           AND (
             regexp_replace(COALESCE(d.mobile_number, ''), '\D', '', 'g') = regexp_replace(v_row->>'driver_number', '\D', '', 'g')
             OR btrim(COALESCE(d.id_number, '')) = btrim(v_row->>'driver_number')
           )
       )
    ORDER BY CASE WHEN lower(btrim(d.full_name)) = lower(COALESCE(v_value, '')) THEN 0 ELSE 1 END, d.created_at, d.id
    LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'supervisor_name'), '');
    SELECT p.id, p.full_name INTO v_supervisor
    FROM public.profiles p
    WHERE v_value IS NOT NULL AND lower(btrim(p.full_name)) = lower(v_value)
    ORDER BY p.created_at, p.id LIMIT 1;
    IF v_supervisor.id IS NULL THEN
      SELECT p.id, p.full_name INTO v_supervisor
      FROM public.profiles p WHERE p.id = auth.uid();
    END IF;

    BEGIN
      IF NULLIF(v_row->>'entry_date', '') IS NOT NULL THEN
        v_entry_date := (v_row->>'entry_date')::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || '"invalid_entry_date"'::jsonb;
    END;
    BEGIN
      IF NULLIF(v_row->>'exit_date', '') IS NOT NULL THEN
        v_exit_date := (v_row->>'exit_date')::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || '"invalid_exit_date"'::jsonb;
    END;

    IF v_mode IN ('entry', 'both') THEN
      IF v_company.id IS NULL THEN v_errors := v_errors || '"company_not_found"'::jsonb; END IF;
      IF v_project.id IS NULL THEN v_errors := v_errors || '"project_not_found"'::jsonb; END IF;
      IF v_entry_date IS NULL THEN v_errors := v_errors || '"entry_date_required"'::jsonb; END IF;
    END IF;
    IF v_mode IN ('exit', 'both') AND v_exit_date IS NULL THEN
      v_errors := v_errors || '"exit_date_required"'::jsonb;
    END IF;
    IF v_mode = 'both' AND v_entry_date IS NOT NULL AND v_exit_date IS NOT NULL AND v_exit_date < v_entry_date THEN
      v_errors := v_errors || '"exit_before_entry"'::jsonb;
    END IF;

    v_result := v_result || jsonb_build_array(
      v_row || jsonb_build_object(
        'equipment_id', v_equipment.id,
        'equipment_label', CASE WHEN v_equipment.id IS NULL THEN NULL ELSE v_equipment.code || ' — ' || v_equipment.type END,
        'company_id', v_company.id,
        'company_label', COALESCE(v_company.name_ar, v_company.name_en),
        'project_id', v_project.id,
        'project_label', COALESCE(v_project.name_ar, v_project.name_en),
        'driver_id', v_driver.id,
        'driver_label', v_driver.full_name,
        'supervisor_id', v_supervisor.id,
        'supervisor_label', v_supervisor.full_name,
        'errors', v_errors
      )
    );
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_movement_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_movement_import(jsonb) TO authenticated;


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
      IF NEW.driver_id IS NULL THEN
        IF current_setting('app.movement_excel_import', true) IS DISTINCT FROM 'true'
           OR NOT public.is_admin() THEN
          RAISE EXCEPTION 'driver_id is required for an entry';
        END IF;
        NEW.driver_name:=NULLIF(btrim(NEW.driver_name), '');
      ELSE
        SELECT d.full_name INTO NEW.driver_name FROM public.drivers d WHERE d.id=NEW.driver_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
      END IF;
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

CREATE OR REPLACE FUNCTION public.import_movement_rows(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
  v_mode text;
  v_entry_at timestamptz;
  v_exit_at timestamptz;
  v_entry_id uuid;
  v_exit_id uuid;
  v_error text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'invalid_import_rows';
  END IF;

  PERFORM set_config('app.movement_excel_import', 'true', true);

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
    ORDER BY COALESCE(NULLIF(value->>'entry_date', ''), NULLIF(value->>'exit_date', '')),
             NULLIF(value->>'row_number', '')::integer
  LOOP
    v_entry_id := NULL;
    v_exit_id := NULL;
    v_error := NULL;
    BEGIN
      v_mode := v_row->>'mode';
      IF v_mode NOT IN ('entry', 'exit', 'both') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
      IF NULLIF(v_row->>'equipment_id', '') IS NULL THEN RAISE EXCEPTION 'equipment_required'; END IF;

      IF v_mode IN ('entry', 'both') THEN
        v_entry_at := ((v_row->>'entry_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, driver_id, driver_name, company_id, project_id,
          contractor_equipment_code, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'entry', 'site', 'manual',
          (v_row->>'driver_id')::uuid,
          COALESCE(
            NULLIF(btrim(v_row->>'driver_label'), ''),
            NULLIF(btrim(v_row->>'driver_name'), '')
          ),
          (v_row->>'company_id')::uuid,
          (v_row->>'project_id')::uuid,
          NULLIF(btrim(v_row->>'contractor_equipment_code'), ''),
          NULLIF(btrim(v_row->>'notes'), ''),
          v_entry_at
        ) RETURNING id INTO v_entry_id;
      END IF;

      IF v_mode IN ('exit', 'both') THEN
        v_exit_at := ((v_row->>'exit_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        IF v_mode = 'both' AND v_exit_at <= v_entry_at THEN
          v_exit_at := v_entry_at + interval '1 minute';
        END IF;
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'exit', 'site', 'manual',
          NULLIF(btrim(v_row->>'notes'), ''),
          v_exit_at
        ) RETURNING id INTO v_exit_id;
      END IF;

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', true,
        'entry_id', v_entry_id,
        'exit_id', v_exit_id
      ));
    EXCEPTION WHEN OTHERS THEN
      v_error := CASE
        WHEN SQLERRM LIKE '%sequence would be invalid%' THEN 'invalid_sequence'
        WHEN SQLERRM LIKE '%no prior entry%' THEN 'no_prior_entry'
        WHEN SQLERRM LIKE '%future%' THEN 'future_date'
        WHEN SQLERRM LIKE '%violates foreign key%' THEN 'invalid_relation'
        ELSE 'import_failed'
      END;
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', false,
        'error', v_error
      ));
    END;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_movement_rows(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_movement_rows(jsonb) TO authenticated;

