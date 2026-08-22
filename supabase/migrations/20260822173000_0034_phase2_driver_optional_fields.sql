-- Phase 2 stabilization: only the driver's full name is mandatory in the
-- master record. Quick Create still asks for a mobile number in the UI.
ALTER TABLE public.drivers
  ALTER COLUMN id_number DROP NOT NULL,
  ALTER COLUMN mobile_number DROP NOT NULL,
  ALTER COLUMN nationality DROP NOT NULL,
  ALTER COLUMN employment_type DROP NOT NULL;

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_id_number_check;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_id_number_check
  CHECK (id_number IS NULL OR id_number ~ '^[0-9]{5,20}$');

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_mobile_number_check;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_mobile_number_check
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+?[0-9]{7,15}$');

-- PostgreSQL UNIQUE permits multiple NULL values, while continuing to block
-- real duplicate identifiers and mobile numbers.
CREATE UNIQUE INDEX IF NOT EXISTS drivers_mobile_number_unique
  ON public.drivers (mobile_number) WHERE mobile_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.quick_create_driver(p_full_name text, p_mobile_number text)
RETURNS public.drivers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_driver public.drivers;
BEGIN
  IF auth.uid() IS NULL OR btrim(p_full_name) = '' OR btrim(p_mobile_number) !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'invalid_quick_driver';
  END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE mobile_number = btrim(p_mobile_number) LIMIT 1;
  IF FOUND THEN RETURN v_driver; END IF;
  INSERT INTO public.drivers(full_name, mobile_number)
  VALUES (btrim(p_full_name), btrim(p_mobile_number)) RETURNING * INTO v_driver;
  RETURN v_driver;
END; $$;

CREATE OR REPLACE FUNCTION public.quick_create_lessor(p_name text, p_mobile_number text)
RETURNS public.lessors
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lessor public.lessors;
BEGIN
  IF auth.uid() IS NULL OR btrim(p_name) = '' OR btrim(p_mobile_number) = '' THEN RAISE EXCEPTION 'invalid_quick_lessor'; END IF;
  SELECT * INTO v_lessor FROM public.lessors
  WHERE lower(name) = lower(btrim(p_name)) OR contact_number = btrim(p_mobile_number) LIMIT 1;
  IF FOUND THEN RETURN v_lessor; END IF;
  INSERT INTO public.lessors(name, contact_number) VALUES (btrim(p_name), btrim(p_mobile_number)) RETURNING * INTO v_lessor;
  RETURN v_lessor;
END; $$;

CREATE OR REPLACE FUNCTION public.quick_create_equipment(p_plate_number text, p_lessor_id uuid DEFAULT NULL)
RETURNS public.equipment
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_equipment public.equipment; v_plate text := upper(btrim(p_plate_number)); v_code text;
BEGIN
  IF auth.uid() IS NULL OR v_plate = '' THEN RAISE EXCEPTION 'invalid_quick_equipment'; END IF;
  SELECT * INTO v_equipment FROM public.equipment WHERE upper(btrim(plate_number)) = v_plate LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;
  v_code := 'PLATE-' || regexp_replace(v_plate, '[^A-Z0-9]', '', 'g');
  IF v_code = 'PLATE-' THEN v_code := 'PLATE-' || substr(gen_random_uuid()::text, 1, 8); END IF;
  INSERT INTO public.equipment(code, type, plate_number, operational_status, ownership_status, lessor_id, qr_value)
  VALUES (v_code, 'غير محدد', v_plate, 'operational', CASE WHEN p_lessor_id IS NULL THEN 'alazani' ELSE 'external_supplier' END, p_lessor_id, gen_random_uuid()::text)
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END; $$;

REVOKE ALL ON FUNCTION public.quick_create_driver(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quick_create_lessor(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quick_create_equipment(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quick_create_driver(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quick_create_lessor(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quick_create_equipment(text, uuid) TO authenticated;
