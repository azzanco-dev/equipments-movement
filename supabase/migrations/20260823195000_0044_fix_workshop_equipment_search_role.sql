-- Qualify the profile id because the table-returning function also exposes an id variable.
CREATE OR REPLACE FUNCTION public.search_workshop_equipment(p_movement_type text, p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text, ownership_status text, qr_value text, is_active boolean, master_data_complete boolean, numbering_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_role NOT IN ('admin', 'workshop') OR p_movement_type NOT IN ('entry', 'exit') THEN RAISE EXCEPTION 'workshop role required'; END IF;
  RETURN QUERY
  SELECT e.id,e.code,e.type,e.plate_number,e.ownership_status,e.qr_value,e.is_active,e.master_data_complete,e.numbering_status
  FROM public.equipment e
  LEFT JOIN LATERAL (
    SELECT l.movement_type FROM public.entry_exit_logs l
    WHERE l.equipment_id=e.id
    ORDER BY l.recorded_at DESC,l.id DESC LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
    AND ((p_movement_type='entry' AND (last_movement.movement_type IS NULL OR last_movement.movement_type='exit'))
      OR (p_movement_type='exit' AND last_movement.movement_type='entry'))
  ORDER BY e.code LIMIT 20;
END; $$;

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text) TO authenticated;
