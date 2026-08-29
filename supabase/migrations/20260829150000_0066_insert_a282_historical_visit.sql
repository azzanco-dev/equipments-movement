-- Restore the strict global movement sequence and add the approved historical
-- A282 site visit directly. No ongoing sequence exception remains after this
-- migration.

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

ALTER TABLE public.entry_exit_logs DISABLE TRIGGER enforce_movement_sequence;

DO $$
DECLARE
  v_equipment_id uuid;
  v_supervisor_id uuid;
  v_company_id uuid;
  v_project_id uuid;
  v_driver_id uuid;
  v_existing_count integer;
  v_invalid_sequence boolean;
BEGIN
  SELECT id INTO STRICT v_equipment_id
  FROM public.equipment
  WHERE upper(btrim(code)) = 'A282';

  SELECT id INTO STRICT v_supervisor_id
  FROM public.profiles
  WHERE lower(btrim(full_name)) = lower('جلال العزاني');

  SELECT id INTO STRICT v_company_id
  FROM public.companies
  WHERE lower(btrim(name_ar)) = lower('Nesma & MAN Joint Venture')
     OR lower(btrim(name_en)) = lower('Nesma & MAN Joint Venture');

  SELECT id INTO STRICT v_project_id
  FROM public.projects
  WHERE lower(btrim(name_ar)) IN (lower('Diriyah'), lower('الدرعية'))
     OR lower(btrim(name_en)) IN (lower('Diriyah'), lower('الدرعية'));

  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE lower(btrim(full_name)) = lower('مرشد احمد')
  ORDER BY created_at, id
  LIMIT 1;

  SELECT count(*) INTO v_existing_count
  FROM public.entry_exit_logs
  WHERE equipment_id = v_equipment_id
    AND movement_context = 'site'
    AND recorded_at IN (
      timestamptz '2026-04-01 12:00:00+03',
      timestamptz '2026-08-25 12:00:00+03'
    );

  IF v_existing_count <> 0 THEN
    RAISE EXCEPTION 'A282 historical visit already exists or is partially inserted';
  END IF;

  INSERT INTO public.entry_exit_logs (
    equipment_id, supervisor_id, movement_type, movement_context,
    registration_method, driver_id, driver_name, company_id, project_id,
    contractor_equipment_code, notes, recorded_at
  ) VALUES
    (
      v_equipment_id, v_supervisor_id, 'entry', 'site', 'manual',
      v_driver_id, 'مرشد احمد', v_company_id, v_project_id,
      NULL, NULL, timestamptz '2026-04-01 12:00:00+03'
    ),
    (
      v_equipment_id, v_supervisor_id, 'exit', 'site', 'manual',
      v_driver_id, 'مرشد احمد', v_company_id, v_project_id,
      NULL, NULL, timestamptz '2026-08-25 12:00:00+03'
    );

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT movement_type,
             lag(movement_type) OVER (ORDER BY recorded_at, id) AS previous_type
      FROM public.entry_exit_logs
      WHERE equipment_id = v_equipment_id
    ) ordered_movements
    WHERE previous_type IS NULL AND movement_type = 'exit'
       OR previous_type = movement_type
  ) INTO v_invalid_sequence;

  IF v_invalid_sequence THEN
    RAISE EXCEPTION 'A282 sequence is invalid after historical visit insertion';
  END IF;
END;
$$;

ALTER TABLE public.entry_exit_logs ENABLE TRIGGER enforce_movement_sequence;
