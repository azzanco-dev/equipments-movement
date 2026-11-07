-- 0181: drop the city of suppliers and clients (`lessors.city`,
-- `companies.city`).
--
-- Owner 2026-11-05 («شيل المدينة, العنوان خليه العنوان الكامل»): the forms,
-- details dialogs, Excel imports and the completeness ring stopped showing
-- the city, and the address became «العنوان الكامل» (hint: district, street,
-- building number, city, postal code). The 0175 column stayed and the forms
-- saved it back unchanged. Owner 2026-11-07 («3 و 4»): drop the column.
--
-- ROLLOUT: apply this migration only AFTER the screens of the same commit
-- are deployed. The earlier screens select `city` in the suppliers and
-- clients lists and send it back on every save, so they would fail once the
-- column is gone.
--
-- What this migration does
--   1. Keeps every stored city: a set `city` is folded into `address` (the
--      full address now names the city) — the city alone when there is no
--      address, nothing when the address already contains it, else
--      «address، city» while that fits the 200-character address CHECK. A
--      city that would not fit is reported by a NOTICE and dropped.
--   2. Re-creates the 0179 trigger functions normalise_lessor_fields() /
--      normalise_company_fields() VERBATIM minus their `NEW.city` line
--      (their 0175 triggers stay), so no trigger names the column.
--   3. Drops `lessors.city` and `companies.city`; their CHECKs
--      lessors_city_check / companies_city_check go with them.
--   4. A guard aborts when a function of the public schema still names
--      `NEW.city`.
--
-- No RLS, policy, grant or view change (no view selects the column).
-- MUST be applied AFTER 0179.

-- 1. Fold the city into the address.
DO $fold$
DECLARE
  v_lost integer;
BEGIN
  SELECT count(*) INTO v_lost FROM public.lessors
  WHERE city IS NOT NULL
    AND address IS NOT NULL
    AND strpos(address, city) = 0
    AND char_length(address || '، ' || city) > 200;
  IF v_lost > 0 THEN
    RAISE NOTICE '0181: % supplier cities do not fit in the address and are dropped', v_lost;
  END IF;

  SELECT count(*) INTO v_lost FROM public.companies
  WHERE city IS NOT NULL
    AND address IS NOT NULL
    AND strpos(address, city) = 0
    AND char_length(address || '، ' || city) > 200;
  IF v_lost > 0 THEN
    RAISE NOTICE '0181: % client cities do not fit in the address and are dropped', v_lost;
  END IF;
END;
$fold$;

UPDATE public.lessors
SET address = CASE
  WHEN address IS NULL THEN city
  ELSE address || '، ' || city
END
WHERE city IS NOT NULL
  AND (address IS NULL
    OR (strpos(address, city) = 0
      AND char_length(address || '، ' || city) <= 200));

UPDATE public.companies
SET address = CASE
  WHEN address IS NULL THEN city
  ELSE address || '، ' || city
END
WHERE city IS NOT NULL
  AND (address IS NULL
    OR (strpos(address, city) = 0
      AND char_length(address || '، ' || city) <= 200));

-- 2. The triggers without the city.
CREATE OR REPLACE FUNCTION public.normalise_lessor_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.tax_number := nullif(regexp_replace(NEW.tax_number, '[\s-]', '', 'g'), '');
  NEW.commercial_register :=
    nullif(regexp_replace(NEW.commercial_register, '[\s-]', '', 'g'), '');
  NEW.address := nullif(btrim(NEW.address), '');
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.bank_name := nullif(btrim(NEW.bank_name), '');
  NEW.iban := nullif(upper(regexp_replace(NEW.iban, '[\s-]', '', 'g')), '');
  NEW.short_address :=
    nullif(upper(regexp_replace(NEW.short_address, '[\s-]', '', 'g')), '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_lessor_fields() IS
  'BEFORE INSERT OR UPDATE trigger on lessors (0175, 0179, 0181): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number, commercial_register, iban and short_address, upper-cases iban and short_address and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those seven columns only (0181 dropped the city).';

REVOKE ALL ON FUNCTION public.normalise_lessor_fields()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalise_company_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.tax_number := nullif(regexp_replace(NEW.tax_number, '[\s-]', '', 'g'), '');
  NEW.commercial_register :=
    nullif(regexp_replace(NEW.commercial_register, '[\s-]', '', 'g'), '');
  NEW.address := nullif(btrim(NEW.address), '');
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.contact_person := nullif(btrim(NEW.contact_person), '');
  NEW.contact_number := nullif(btrim(NEW.contact_number), '');
  NEW.short_address :=
    nullif(upper(regexp_replace(NEW.short_address, '[\s-]', '', 'g')), '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_company_fields() IS
  'BEFORE INSERT OR UPDATE trigger on companies (0175, 0179, 0181): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number, commercial_register and short_address, upper-cases short_address and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those seven columns only (0181 dropped the city).';

REVOKE ALL ON FUNCTION public.normalise_company_fields()
  FROM PUBLIC, anon, authenticated;

-- 3. The columns (their CHECKs go with them).
ALTER TABLE public.lessors DROP COLUMN IF EXISTS city;
ALTER TABLE public.companies DROP COLUMN IF EXISTS city;

-- 4. Guard.
DO $guard$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc LIKE '%NEW.city%';

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION '0181: functions still name NEW.city: %', v_names;
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
