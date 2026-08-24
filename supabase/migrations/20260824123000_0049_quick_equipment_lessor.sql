CREATE OR REPLACE FUNCTION public.quick_create_lessor_by_name(p_name text)
RETURNS public.lessors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lessor public.lessors;
  v_name text := btrim(p_name);
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'supervisor') OR v_name = '' OR char_length(v_name) > 150 THEN
    RAISE EXCEPTION 'invalid_quick_lessor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));
  SELECT * INTO v_lessor
  FROM public.lessors
  WHERE lower(btrim(name)) = lower(v_name)
  LIMIT 1;
  IF FOUND THEN RETURN v_lessor; END IF;

  INSERT INTO public.lessors(name)
  VALUES (v_name)
  RETURNING * INTO v_lessor;
  RETURN v_lessor;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_create_lessor_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_lessor_by_name(text) TO authenticated;

DROP FUNCTION IF EXISTS public.quick_create_foreman_equipment(text, text);

CREATE FUNCTION public.quick_create_foreman_equipment(
  p_plate_number text,
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
  v_plate text := upper(btrim(p_plate_number));
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'supervisor') OR v_plate = '' OR btrim(p_type) = '' OR p_lessor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_quick_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE upper(btrim(plate_number)) = v_plate
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

REVOKE ALL ON FUNCTION public.quick_create_foreman_equipment(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_foreman_equipment(text, text, uuid) TO authenticated;
