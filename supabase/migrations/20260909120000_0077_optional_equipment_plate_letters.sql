-- A numbered equipment record requires plate digits, while letters are optional.
ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_plate_parts_together;

ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_plate_letters_require_digits
    CHECK (plate_letters_en IS NULL OR plate_digits IS NOT NULL);

CREATE UNIQUE INDEX equipment_plate_digits_without_letters_unique_idx
  ON public.equipment(plate_digits)
  WHERE plate_digits IS NOT NULL AND plate_letters_en IS NULL;

CREATE OR REPLACE FUNCTION public.normalize_equipment_plate_parts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_letters text;
BEGIN
  IF NEW.plate_number IS NULL OR btrim(NEW.plate_number) = '' THEN
    NEW.plate_number := NULL;
    NEW.plate_digits := NULL;
    NEW.plate_letters_en := NULL;
    RETURN NEW;
  END IF;

  v_digits := regexp_replace(upper(NEW.plate_number), '[^0-9]', '', 'g');
  v_letters := NULLIF(regexp_replace(upper(NEW.plate_number), '[^A-Z]', '', 'g'), '');

  IF v_digits !~ '^[0-9]{1,4}$'
     OR (v_letters IS NOT NULL AND v_letters !~ '^[A-Z]{1,3}$') THEN
    RAISE EXCEPTION 'invalid_plate_number';
  END IF;

  NEW.plate_digits := v_digits;
  NEW.plate_letters_en := v_letters;
  NEW.plate_number := v_digits ||
    CASE WHEN v_letters IS NULL THEN '' ELSE '-' || v_letters END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_equipment_plate_parts()
  FROM PUBLIC, anon, authenticated;
