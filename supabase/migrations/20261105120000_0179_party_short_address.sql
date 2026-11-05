-- 0179: the short national address («العنوان الوطني المختصر») of suppliers
-- and clients.
--
-- Owner 2026-11-05 («بالنسبة للعنوان الوطني سوي حقل اضافي العنوان الوطني
-- المختصر، وحسب النظام السعودي فهو مكون من 4 حروف و4 ارقام، فابغى حقل يكون
-- مقسم»): beside 0175's free-text `address`, both `public.lessors` and
-- `public.companies` gain an OPTIONAL `short_address`: the Saudi National
-- Address short code, 4 Latin letters then 4 digits (e.g. RRRD2929), stored
-- upper-case without spaces or dashes. Not unique (one building may house
-- several parties).
--
-- The 0175 normalising triggers are re-created verbatim plus one line each:
-- `short_address` trimmed of spaces and dashes, upper-cased, a blank stored
-- as NULL, so the CHECK sees the normalised text whatever the client sent.
--
-- No RLS, policy, grant or view change. MUST be applied AFTER 0175.
--
-- Objects: lessors.short_address, companies.short_address, the CHECKs
-- lessors_short_address_check / companies_short_address_check, and the two
-- trigger functions normalise_lessor_fields() / normalise_company_fields()
-- (replaced; their triggers of 0175 stay).

ALTER TABLE public.lessors
  ADD COLUMN IF NOT EXISTS short_address text;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS short_address text;

ALTER TABLE public.lessors
  DROP CONSTRAINT IF EXISTS lessors_short_address_check,
  ADD CONSTRAINT lessors_short_address_check
    CHECK (short_address IS NULL OR short_address ~ '^[A-Z]{4}[0-9]{4}$');
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_short_address_check,
  ADD CONSTRAINT companies_short_address_check
    CHECK (short_address IS NULL OR short_address ~ '^[A-Z]{4}[0-9]{4}$');

COMMENT ON COLUMN public.lessors.short_address IS
  '0179: the Saudi short national address, 4 letters then 4 digits (RRRD2929), upper-case without spaces; optional.';
COMMENT ON COLUMN public.companies.short_address IS
  '0179: the Saudi short national address, 4 letters then 4 digits (RRRD2929), upper-case without spaces; optional.';

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
  NEW.city := nullif(btrim(NEW.city), '');
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.bank_name := nullif(btrim(NEW.bank_name), '');
  NEW.iban := nullif(upper(regexp_replace(NEW.iban, '[\s-]', '', 'g')), '');
  NEW.short_address :=
    nullif(upper(regexp_replace(NEW.short_address, '[\s-]', '', 'g')), '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_lessor_fields() IS
  'BEFORE INSERT OR UPDATE trigger on lessors (0175, 0179): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number, commercial_register, iban and short_address, upper-cases iban and short_address and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those eight columns only.';

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
  NEW.city := nullif(btrim(NEW.city), '');
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.contact_person := nullif(btrim(NEW.contact_person), '');
  NEW.contact_number := nullif(btrim(NEW.contact_number), '');
  NEW.short_address :=
    nullif(upper(regexp_replace(NEW.short_address, '[\s-]', '', 'g')), '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_company_fields() IS
  'BEFORE INSERT OR UPDATE trigger on companies (0175, 0179): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number, commercial_register and short_address, upper-cases short_address and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those eight columns only.';

REVOKE ALL ON FUNCTION public.normalise_company_fields()
  FROM PUBLIC, anon, authenticated;
