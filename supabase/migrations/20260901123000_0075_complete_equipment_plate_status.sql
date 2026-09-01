-- Complete master-data records use one of two identification states:
-- a vehicle plate (plate required) or a customs card (no number required).
UPDATE public.equipment
SET numbering_status = CASE
  WHEN NULLIF(btrim(plate_number), '') IS NULL THEN 'unnumbered'
  ELSE 'numbered'
END
WHERE master_data_complete = true;

CREATE OR REPLACE FUNCTION public.sync_complete_equipment_plate_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.master_data_complete = true THEN
    IF NULLIF(btrim(NEW.plate_number), '') IS NULL THEN
      NEW.plate_number := NULL;
      NEW.plate_digits := NULL;
      NEW.plate_letters_en := NULL;
      NEW.numbering_status := 'unnumbered';
    ELSE
      NEW.numbering_status := 'numbered';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_complete_equipment_plate_status()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_complete_equipment_plate_status
  ON public.equipment;
CREATE TRIGGER trg_sync_complete_equipment_plate_status
  BEFORE INSERT OR UPDATE OF plate_number, master_data_complete, numbering_status
  ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.sync_complete_equipment_plate_status();
