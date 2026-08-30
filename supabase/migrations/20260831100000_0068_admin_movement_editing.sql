-- Admin-only correction of movement facts, with deterministic sequence checks.
CREATE OR REPLACE FUNCTION public.admin_update_movement(
  p_movement_id uuid,
  p_equipment_id uuid,
  p_supervisor_id uuid,
  p_recorded_at timestamptz,
  p_company_id uuid,
  p_project_id uuid,
  p_contractor_equipment_code text,
  p_driver_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_pair public.entry_exit_logs;
  v_driver_name text;
  v_bad boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO v_log FROM public.entry_exit_logs WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'movement_not_found'; END IF;
  IF p_equipment_id IS NULL OR p_supervisor_id IS NULL OR p_recorded_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF p_recorded_at > now() THEN RAISE EXCEPTION 'future_time'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE id=p_equipment_id) OR
     NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_supervisor_id) THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF v_log.movement_context='site' AND (p_company_id IS NULL OR p_project_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text || ':' || v_log.movement_context,0));
  IF p_equipment_id <> v_log.equipment_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text || ':' || v_log.movement_context,0));
  END IF;

  -- Resolve the existing visit pair before changing time/equipment.
  IF v_log.movement_type='entry' THEN
    SELECT * INTO v_pair FROM public.entry_exit_logs l
    WHERE l.equipment_id=v_log.equipment_id AND l.movement_context=v_log.movement_context
      AND l.movement_type='exit' AND (l.recorded_at,l.id)>(v_log.recorded_at,v_log.id)
    ORDER BY l.recorded_at,l.id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_pair FROM public.entry_exit_logs l
    WHERE l.equipment_id=v_log.equipment_id AND l.movement_context=v_log.movement_context
      AND l.movement_type='entry' AND (l.recorded_at,l.id)<(v_log.recorded_at,v_log.id)
    ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF p_driver_id IS NOT NULL THEN
    IF v_log.driver_id IS NOT NULL THEN RAISE EXCEPTION 'driver_already_assigned'; END IF;
    SELECT full_name INTO v_driver_name FROM public.drivers WHERE id=p_driver_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_payload'; END IF;
  END IF;

  UPDATE public.entry_exit_logs SET
    equipment_id=p_equipment_id,
    supervisor_id=p_supervisor_id,
    recorded_at=p_recorded_at,
    company_id=CASE WHEN movement_context='site' THEN p_company_id ELSE NULL END,
    project_id=CASE WHEN movement_context='site' THEN p_project_id ELSE NULL END,
    contractor_equipment_code=CASE WHEN movement_context='site' THEN NULLIF(btrim(p_contractor_equipment_code),'') ELSE NULL END,
    driver_id=COALESCE(p_driver_id,driver_id),
    driver_name=CASE WHEN p_driver_id IS NOT NULL THEN v_driver_name ELSE driver_name END
  WHERE id=p_movement_id;

  -- Visit identity and inherited site facts stay consistent on both rows.
  IF v_pair.id IS NOT NULL THEN
    UPDATE public.entry_exit_logs SET
      equipment_id=p_equipment_id,
      company_id=CASE WHEN movement_context='site' THEN p_company_id ELSE NULL END,
      project_id=CASE WHEN movement_context='site' THEN p_project_id ELSE NULL END,
      contractor_equipment_code=CASE WHEN movement_context='site' THEN NULLIF(btrim(p_contractor_equipment_code),'') ELSE NULL END
    WHERE id=v_pair.id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT movement_type,
        lag(movement_type) OVER (PARTITION BY equipment_id,movement_context ORDER BY recorded_at,id) prev,
        row_number() OVER (PARTITION BY equipment_id,movement_context ORDER BY recorded_at,id) rn
      FROM public.entry_exit_logs
      WHERE equipment_id IN (v_log.equipment_id,p_equipment_id)
    ) s WHERE (rn=1 AND movement_type<>'entry') OR prev=movement_type
  ) INTO v_bad;
  IF v_bad THEN RAISE EXCEPTION 'invalid_sequence'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid,uuid,uuid,timestamptz,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid,uuid,uuid,timestamptz,uuid,uuid,text,uuid) TO authenticated;
