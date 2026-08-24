DROP FUNCTION IF EXISTS public.search_workshop_equipment(text, text);

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

  IF v_role NOT IN ('admin', 'workshop', 'workshop_manager')
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
    SELECT l.movement_type, l.supervisor_id
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
      OR (
        p_movement_type = 'exit'
        AND last_movement.movement_type = 'entry'
        AND (v_role IN ('admin', 'workshop_manager') OR last_movement.supervisor_id = auth.uid())
      )
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;
