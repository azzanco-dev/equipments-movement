-- Admin-only one-time opening balance for equipment already inside the workshop.
CREATE OR REPLACE FUNCTION public.search_workshop_opening_candidates(p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY SELECT e.id,e.code,e.type,e.plate_number FROM public.equipment e
  WHERE e.is_active
    AND NOT EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=e.id AND l.movement_context='workshop')
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
  ORDER BY e.code LIMIT 20;
END; $$;
REVOKE ALL ON FUNCTION public.search_workshop_opening_candidates(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_opening_candidates(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_workshop_opening_balance(p_equipment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  IF EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=p_equipment_id AND l.movement_context='workshop') THEN
    RAISE EXCEPTION 'workshop movement already exists';
  END IF;
  INSERT INTO public.entry_exit_logs(equipment_id,supervisor_id,movement_type,movement_context,registration_method,notes,recorded_at)
  VALUES (p_equipment_id,auth.uid(),'entry','workshop','manual','رصيد افتتاحي للورشة',now()) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END; $$;
REVOKE ALL ON FUNCTION public.add_workshop_opening_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_workshop_opening_balance(uuid) TO authenticated;
