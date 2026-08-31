-- Store readable point-in-time labels in audit snapshots instead of exposing
-- relational UUIDs in the admin interface.
CREATE OR REPLACE FUNCTION public.movement_audit_snapshot(p_log public.entry_exit_logs)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'equipment_id', COALESCE((SELECT e.code FROM public.equipment e WHERE e.id=p_log.equipment_id), p_log.equipment_id::text),
    'supervisor_id', COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id=p_log.supervisor_id), p_log.supervisor_id::text),
    'movement_type', p_log.movement_type,
    'movement_context', p_log.movement_context,
    'driver_id', COALESCE((SELECT d.full_name FROM public.drivers d WHERE d.id=p_log.driver_id), p_log.driver_id::text),
    'driver_name', p_log.driver_name,
    'company_id', COALESCE((SELECT COALESCE(c.name_ar,c.name_en) FROM public.companies c WHERE c.id=p_log.company_id), p_log.company_id::text),
    'project_id', COALESCE((SELECT COALESCE(pr.name_ar,pr.name_en) FROM public.projects pr WHERE pr.id=p_log.project_id), p_log.project_id::text),
    'contractor_equipment_code', p_log.contractor_equipment_code,
    'notes', p_log.notes,
    'recorded_at', p_log.recorded_at,
    'workshop_purpose', p_log.workshop_purpose
  ));
$$;

REVOKE ALL ON FUNCTION public.movement_audit_snapshot(public.entry_exit_logs) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_movement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_raw jsonb;
  v_new_raw jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_key text;
  v_actor_name text;
  v_equipment_code text;
  v_row public.entry_exit_logs;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  SELECT code INTO v_equipment_code FROM public.equipment WHERE id = v_row.equipment_id;

  IF TG_OP <> 'INSERT' THEN
    v_old_raw := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', OLD.equipment_id, 'supervisor_id', OLD.supervisor_id,
      'movement_type', OLD.movement_type, 'movement_context', OLD.movement_context,
      'driver_id', OLD.driver_id, 'driver_name', OLD.driver_name,
      'company_id', OLD.company_id, 'project_id', OLD.project_id,
      'contractor_equipment_code', OLD.contractor_equipment_code,
      'notes', OLD.notes, 'recorded_at', OLD.recorded_at,
      'workshop_purpose', OLD.workshop_purpose
    ));
    v_old := public.movement_audit_snapshot(OLD);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_raw := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', NEW.equipment_id, 'supervisor_id', NEW.supervisor_id,
      'movement_type', NEW.movement_type, 'movement_context', NEW.movement_context,
      'driver_id', NEW.driver_id, 'driver_name', NEW.driver_name,
      'company_id', NEW.company_id, 'project_id', NEW.project_id,
      'contractor_equipment_code', NEW.contractor_equipment_code,
      'notes', NEW.notes, 'recorded_at', NEW.recorded_at,
      'workshop_purpose', NEW.workshop_purpose
    ));
    v_new := public.movement_audit_snapshot(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old_raw || v_new_raw) LOOP
      IF v_old_raw -> v_key IS DISTINCT FROM v_new_raw -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF cardinality(v_changed) = 0 THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY(SELECT jsonb_object_keys(v_new_raw));
  ELSE
    v_changed := ARRAY(SELECT jsonb_object_keys(v_old_raw));
  END IF;

  INSERT INTO public.movement_audit_logs(
    movement_id, action, actor_id, actor_name, equipment_id, equipment_code,
    movement_type, movement_context, old_values, new_values, changed_fields
  ) VALUES (
    v_row.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    auth.uid(), v_actor_name, v_row.equipment_id, v_equipment_code,
    v_row.movement_type, v_row.movement_context, v_old, v_new, v_changed
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_movement_change() FROM PUBLIC, anon, authenticated;
