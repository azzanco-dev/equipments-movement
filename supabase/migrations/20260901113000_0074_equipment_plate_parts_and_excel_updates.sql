ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS plate_digits text,
  ADD COLUMN IF NOT EXISTS plate_letters_en text;

ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_plate_digits_format
    CHECK (plate_digits IS NULL OR plate_digits ~ '^[0-9]{1,4}$'),
  ADD CONSTRAINT equipment_plate_letters_en_format
    CHECK (plate_letters_en IS NULL OR plate_letters_en ~ '^[A-Z]{1,3}$'),
  ADD CONSTRAINT equipment_plate_parts_together
    CHECK ((plate_digits IS NULL) = (plate_letters_en IS NULL));

-- Backfill Latin legacy plates. If legacy duplicates exist, only the oldest row
-- receives structured parts; the other rows remain available for manual review.
WITH parsed AS (
  SELECT
    id,
    regexp_replace(upper(plate_number), '[^0-9]', '', 'g') AS digits,
    regexp_replace(upper(plate_number), '[^A-Z]', '', 'g') AS letters,
    row_number() OVER (
      PARTITION BY
        regexp_replace(upper(plate_number), '[^0-9]', '', 'g'),
        regexp_replace(upper(plate_number), '[^A-Z]', '', 'g')
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.equipment
  WHERE plate_number IS NOT NULL
), valid AS (
  SELECT id, digits, letters
  FROM parsed
  WHERE digits ~ '^[0-9]{1,4}$'
    AND letters ~ '^[A-Z]{1,3}$'
    AND duplicate_rank = 1
)
UPDATE public.equipment e
SET plate_digits = valid.digits, plate_letters_en = valid.letters
FROM valid
WHERE e.id = valid.id;

UPDATE public.equipment
SET plate_number = plate_digits || '-' || plate_letters_en
WHERE plate_digits IS NOT NULL AND plate_letters_en IS NOT NULL;

CREATE UNIQUE INDEX equipment_plate_parts_unique_idx
  ON public.equipment(plate_digits, plate_letters_en)
  WHERE plate_digits IS NOT NULL AND plate_letters_en IS NOT NULL;

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
  v_letters := regexp_replace(upper(NEW.plate_number), '[^A-Z]', '', 'g');
  IF v_digits !~ '^[0-9]{1,4}$' OR v_letters !~ '^[A-Z]{1,3}$' THEN
    RAISE EXCEPTION 'invalid_plate_number';
  END IF;

  NEW.plate_digits := v_digits;
  NEW.plate_letters_en := v_letters;
  NEW.plate_number := v_digits || '-' || v_letters;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_equipment_plate_parts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_normalize_equipment_plate_parts ON public.equipment;
CREATE TRIGGER trg_normalize_equipment_plate_parts
  BEFORE INSERT OR UPDATE OF plate_number, plate_digits, plate_letters_en
  ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.normalize_equipment_plate_parts();

CREATE OR REPLACE FUNCTION public.update_equipment_from_excel(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_equipment public.equipment;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_version timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'invalid_update_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := (v_row->>'record_id')::uuid;
      v_version := (v_row->>'record_version')::timestamptz;
      SELECT * INTO v_equipment FROM public.equipment WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found'; END IF;
      IF v_equipment.updated_at IS DISTINCT FROM v_version THEN
        RAISE EXCEPTION 'record_changed';
      END IF;
      IF NULLIF(btrim(v_row->>'code'), '') IS NULL OR NULLIF(btrim(v_row->>'type'), '') IS NULL THEN
        RAISE EXCEPTION 'required_value_missing';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.equipment_types et WHERE et.name = btrim(v_row->>'type')) THEN
        RAISE EXCEPTION 'equipment_type_not_found';
      END IF;

      UPDATE public.equipment SET
        code = btrim(v_row->>'code'),
        type = btrim(v_row->>'type'),
        plate_number = NULLIF(btrim(v_row->>'plate_number'), ''),
        operational_status = (v_row->>'operational_status')::text,
        ownership_status = (v_row->>'ownership_status')::text,
        project_id = NULLIF(v_row->>'project_id', '')::uuid,
        lessor_id = CASE WHEN v_row->>'ownership_status' = 'external_supplier'
          THEN NULLIF(v_row->>'lessor_id', '')::uuid ELSE NULL END,
        brand = NULLIF(btrim(v_row->>'brand'), ''),
        model = NULLIF(btrim(v_row->>'model'), ''),
        manufacture_year = NULLIF(v_row->>'manufacture_year', '')::integer,
        chassis_number = NULLIF(btrim(v_row->>'chassis_number'), ''),
        registration_type = NULLIF(v_row->>'registration_type', '')::text,
        last_maintenance_date = NULLIF(v_row->>'last_maintenance_date', '')::date,
        registration_expiry = NULLIF(v_row->>'registration_expiry', '')::date,
        insurance_expiry = NULLIF(v_row->>'insurance_expiry', '')::date,
        master_data_complete = true
      WHERE id = v_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_id, 'status', 'updated'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_row->>'record_id', 'status', 'error',
        'error_code', CASE
          WHEN SQLERRM LIKE '%record_not_found%' THEN 'record_not_found'
          WHEN SQLERRM LIKE '%record_changed%' THEN 'record_changed'
          WHEN SQLERRM LIKE '%required_value_missing%' THEN 'required_value_missing'
          WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found'
          WHEN SQLERRM LIKE '%invalid_plate_number%' THEN 'invalid_plate_number'
          ELSE 'update_failed' END
      ));
    END;
  END LOOP;
  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.update_equipment_from_excel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_equipment_from_excel(jsonb) TO authenticated;
