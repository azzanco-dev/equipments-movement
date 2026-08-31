-- Append-only audit history for movement records. Admins can read it; nobody
-- can mutate it through the API. The trigger captures every database path,
-- including regular forms, imports and reviewed SECURITY DEFINER functions.
CREATE TABLE public.movement_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movement_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  equipment_code text,
  movement_type text,
  movement_context text,
  old_values jsonb,
  new_values jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX movement_audit_logs_created_id_idx
  ON public.movement_audit_logs(created_at DESC, id DESC);
CREATE INDEX movement_audit_logs_actor_created_idx
  ON public.movement_audit_logs(actor_id, created_at DESC, id DESC);
CREATE INDEX movement_audit_logs_movement_created_idx
  ON public.movement_audit_logs(movement_id, created_at DESC, id DESC);
CREATE INDEX movement_audit_logs_action_created_idx
  ON public.movement_audit_logs(action, created_at DESC, id DESC);

ALTER TABLE public.movement_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY movement_audit_logs_admin_select
  ON public.movement_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON TABLE public.movement_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.movement_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_movement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    v_old := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', OLD.equipment_id,
      'supervisor_id', OLD.supervisor_id,
      'movement_type', OLD.movement_type,
      'movement_context', OLD.movement_context,
      'driver_id', OLD.driver_id,
      'driver_name', OLD.driver_name,
      'company_id', OLD.company_id,
      'project_id', OLD.project_id,
      'contractor_equipment_code', OLD.contractor_equipment_code,
      'notes', OLD.notes,
      'recorded_at', OLD.recorded_at,
      'workshop_purpose', OLD.workshop_purpose
    ));
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', NEW.equipment_id,
      'supervisor_id', NEW.supervisor_id,
      'movement_type', NEW.movement_type,
      'movement_context', NEW.movement_context,
      'driver_id', NEW.driver_id,
      'driver_name', NEW.driver_name,
      'company_id', NEW.company_id,
      'project_id', NEW.project_id,
      'contractor_equipment_code', NEW.contractor_equipment_code,
      'notes', NEW.notes,
      'recorded_at', NEW.recorded_at,
      'workshop_purpose', NEW.workshop_purpose
    ));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old || v_new) LOOP
      IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF cardinality(v_changed) = 0 THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY(SELECT jsonb_object_keys(v_new));
  ELSE
    v_changed := ARRAY(SELECT jsonb_object_keys(v_old));
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

CREATE TRIGGER audit_entry_exit_logs
AFTER INSERT OR UPDATE OR DELETE ON public.entry_exit_logs
FOR EACH ROW EXECUTE FUNCTION public.audit_movement_change();
