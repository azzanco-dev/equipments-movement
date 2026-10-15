-- 0131: «الرقم الوظيفي» (employee number) of a driver (EM-237).
--
-- Owner request 2026-10-14. The driver master record gains ONE optional text
-- field, `drivers.employee_number`, shown in the drivers list, the driver
-- form, the driver detail and the drivers Excel import as «الرقم الوظيفي».
-- Quick Create does not know it.
--
-- Rules (database side, so no client can bypass them):
--   * Optional: NULL means "no employee number". A blank or whitespace-only
--     value is stored as NULL (trigger below), never as ''.
--   * Trimmed on write (trigger below), so '  E-1001 ' and 'E-1001' are the
--     same value and the CHECK sees the trimmed text.
--   * At most 30 characters once trimmed (`drivers_employee_number_check`,
--     the style of `drivers_name_en_check`, 0078).
--   * Unique across drivers, compared as `upper(btrim(employee_number))`
--     (the comparison `equipment_code_previously_used` uses for codes, 0114),
--     so 'e-1001' and 'E-1001' cannot belong to two drivers. A partial unique
--     index, like `drivers_mobile_number_unique` (0034): many NULLs are fine.
--     The violation names the index, `drivers_employee_number_unique`, which
--     the driver form maps to its field (`src/lib/driverForm.ts`).
--   * A trigram index for the list search (`ilike '%term%'`), the pattern of
--     `drivers_name_en_trgm_idx` (0078).
--
-- ===========================================================================
-- 1. Objects
-- ===========================================================================
-- New:
--   column `public.drivers.employee_number text`
--   constraint `drivers_employee_number_check`
--   unique index `drivers_employee_number_unique` ON (upper(btrim(..)))
--   index `drivers_employee_number_trgm_idx` (gin, trigram)
--   function `public.normalise_driver_employee_number()` RETURNS trigger
--   trigger `normalise_driver_employee_number` BEFORE INSERT OR UPDATE ON
--     public.drivers
--
-- Rewritten: NONE. Every migration was searched for `drivers` (rg):
--   * no database function imports or updates drivers from Excel: the drivers
--     import (`src/components/DriverExcelImport.tsx`) inserts through
--     PostgREST under `insert_drivers` (0127), and there is no drivers Excel
--     update flow;
--   * the drivers list searches, filters and sorts `public.drivers` through
--     PostgREST (`src/screens/drivers/DriversListScreen.tsx`), no RPC;
--   * `quick_create_driver` (latest 0119) inserts named columns only
--     (`full_name`, `mobile_number`, `employment_type`) and returns the row
--     type `public.drivers`, so the new nullable column needs no change there;
--   * the views `movement_log_search`, `movement_visits` (0124) and
--     `driver_equipment_summary` (0092) carry no driver master fields beyond
--     the name and mobile, so they are untouched.
--   The only trigger on `public.drivers` is `trg_drivers_updated_at` (0033,
--   BEFORE UPDATE, the shared `update_updated_at()`), which cannot host an
--   INSERT-time normalisation, hence the small new trigger.
--
-- Rollout: apply BEFORE deploying the UI of EM-237 (the list selects and
-- searches `employee_number`; the form and import write it). The live UI
-- never names the column, so applying first is safe.

-- ===========================================================================
-- 2. Column and CHECK
-- ===========================================================================
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS employee_number text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_employee_number_check;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_employee_number_check
  CHECK (
    employee_number IS NULL
    OR char_length(btrim(employee_number)) BETWEEN 1 AND 30
  );

COMMENT ON COLUMN public.drivers.employee_number IS
  'Optional employee number («الرقم الوظيفي», 0131). Trimmed on write, blank stored as NULL (normalise_driver_employee_number), 1..30 characters, unique as upper(btrim(..)) (drivers_employee_number_unique).';

-- ===========================================================================
-- 3. Uniqueness (case- and space-insensitive) and the search index
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS drivers_employee_number_unique
  ON public.drivers (upper(btrim(employee_number)))
  WHERE employee_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS drivers_employee_number_trgm_idx
  ON public.drivers USING gin (employee_number extensions.gin_trgm_ops);

-- ===========================================================================
-- 4. Normalisation trigger: trim, blank -> NULL
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.normalise_driver_employee_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.employee_number := nullif(btrim(NEW.employee_number), '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_driver_employee_number() IS
  'BEFORE INSERT OR UPDATE trigger on drivers (0131): trims employee_number and stores a blank value as NULL, so the CHECK and the unique index see the normalised text. Writes NEW.employee_number only.';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.normalise_driver_employee_number()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalise_driver_employee_number ON public.drivers;
CREATE TRIGGER normalise_driver_employee_number
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.normalise_driver_employee_number();
