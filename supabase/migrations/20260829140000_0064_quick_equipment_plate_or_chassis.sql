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
  IF v_role NOT IN ('admin', 'supervisor')
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

NOTIFY pgrst, 'reload schema';
