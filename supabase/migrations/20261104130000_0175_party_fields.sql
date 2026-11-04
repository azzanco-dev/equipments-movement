-- 0175: the extra master-data fields of suppliers and clients (EM-260).
--
-- Owner request 2026-11-03 («اضافة حقول اضافية للموردين والعملاء مثل الرقم
-- الضريبي والسجل التجاري وغيره»), started 2026-11-04 with the standard field
-- set below. Both `public.lessors` (the suppliers, «الموردون») and
-- `public.companies` (the clients, «الشركات») gain the same OPTIONAL columns;
-- every one is NULL by default and nothing existing changes:
--
--   tax_number          the Saudi VAT registration number: 15 digits, unique
--                       per table when set
--   commercial_register the CR number: 4 to 20 digits, unique per table when
--                       set
--   address             the national address / street, at most 200 characters
--   city                at most 60 characters
--   email               at most 120 characters, a lenient shape check
--
-- `companies` alone also gains `contact_person` (≤ 120) and `contact_number`
-- (≤ 30) — the lessors have carried both since 0001 —, and `lessors` alone
-- gains the bank details: `bank_name` (≤ 100, owner 2026-11-04 «البنك
-- والايبان») and `iban`, stored WITHOUT spaces and upper-case (a Saudi IBAN:
-- «SA», 2 check digits, 2 bank digits, 18 account characters = 24
-- characters).
--
-- Normalisation happens in the database (the 0131 pattern of the drivers'
-- employee-number trigger): a BEFORE INSERT OR UPDATE trigger per
-- table trims every new text column, stores a blank as NULL, strips spaces
-- and dashes from the tax number, the CR number and the IBAN, upper-cases the
-- IBAN and lower-cases the email, so the CHECKs and the unique indexes see
-- the normalised text whatever the client sent.
--
-- Uniqueness is a partial unique index per column (many NULLs are fine); the
-- violation names the index, which the forms map to the field
-- («الرقم الضريبي مستخدم لمورد اخر»). Trigram indexes serve the lists'
-- server-side search (`ilike '%term%'`) on the two numbers.
--
-- NO RLS or policy change: the existing read / edit gates of both tables stay
-- (`lessors.edit`, `companies_projects.edit`). `lessor_contacts` (0136) is
-- untouched.
--
-- ===========================================================================
-- 1. Objects
-- ===========================================================================
-- New columns:
--   public.lessors:   tax_number, commercial_register, address, city, email,
--                     bank_name, iban
--   public.companies: tax_number, commercial_register, address, city, email,
--                     contact_person, contact_number
-- New constraints: `<table>_<column>_check` for every new column.
-- New indexes:
--   unique  lessors_tax_number_unique, lessors_commercial_register_unique,
--           companies_tax_number_unique, companies_commercial_register_unique
--           (partial, WHERE the column IS NOT NULL)
--   trigram lessors_tax_number_trgm_idx, lessors_commercial_register_trgm_idx,
--           companies_tax_number_trgm_idx,
--           companies_commercial_register_trgm_idx
-- New functions / triggers:
--   public.normalise_lessor_fields()  RETURNS trigger — BEFORE INSERT OR
--     UPDATE ON public.lessors (trigger `normalise_lessor_fields`)
--   public.normalise_company_fields() RETURNS trigger — BEFORE INSERT OR
--     UPDATE ON public.companies (trigger `normalise_company_fields`)
--
-- Rewritten: NONE. No view, function or policy selects `lessors.*` or
-- `companies.*` by name in a way the new nullable columns change
-- (`quick_create_lessor_by_name` returns the row type `public.lessors`, so
-- the new columns ride along as NULL).
--
-- Rollout: apply BEFORE deploying the UI of EM-260 (the forms, the detail
-- dialogs and the imports write the columns; the lists search them and the
-- supplier PO PDF selects two of them). The live UI never names them, so
-- applying first is safe.

-- ===========================================================================
-- 2. lessors — columns and CHECKs
-- ===========================================================================
ALTER TABLE public.lessors
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS commercial_register text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text;

ALTER TABLE public.lessors
  DROP CONSTRAINT IF EXISTS lessors_tax_number_check,
  DROP CONSTRAINT IF EXISTS lessors_commercial_register_check,
  DROP CONSTRAINT IF EXISTS lessors_address_check,
  DROP CONSTRAINT IF EXISTS lessors_city_check,
  DROP CONSTRAINT IF EXISTS lessors_email_check,
  DROP CONSTRAINT IF EXISTS lessors_bank_name_check,
  DROP CONSTRAINT IF EXISTS lessors_iban_check;

ALTER TABLE public.lessors
  ADD CONSTRAINT lessors_tax_number_check
    CHECK (tax_number IS NULL OR tax_number ~ '^[0-9]{15}$'),
  ADD CONSTRAINT lessors_commercial_register_check
    CHECK (commercial_register IS NULL OR commercial_register ~ '^[0-9]{4,20}$'),
  ADD CONSTRAINT lessors_address_check
    CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 200),
  ADD CONSTRAINT lessors_city_check
    CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 60),
  ADD CONSTRAINT lessors_email_check
    CHECK (
      email IS NULL
      OR (char_length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    ),
  ADD CONSTRAINT lessors_bank_name_check
    CHECK (bank_name IS NULL OR char_length(bank_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT lessors_iban_check
    CHECK (iban IS NULL OR iban ~ '^SA[0-9]{4}[0-9A-Z]{18}$');

COMMENT ON COLUMN public.lessors.tax_number IS
  'Optional Saudi VAT registration number («الرقم الضريبي», 0175): exactly 15 digits once spaces and dashes are stripped (normalise_lessor_fields), unique when set (lessors_tax_number_unique). Printed on the supplier PO PDF.';
COMMENT ON COLUMN public.lessors.commercial_register IS
  'Optional commercial register number («السجل التجاري», 0175): 4 to 20 digits once spaces and dashes are stripped, unique when set (lessors_commercial_register_unique). Printed on the supplier PO PDF.';
COMMENT ON COLUMN public.lessors.address IS
  'Optional national address / street («العنوان», 0175): trimmed, blank stored as NULL, at most 200 characters.';
COMMENT ON COLUMN public.lessors.city IS
  'Optional city («المدينة», 0175): trimmed, blank stored as NULL, at most 60 characters.';
COMMENT ON COLUMN public.lessors.email IS
  'Optional e-mail («البريد», 0175): trimmed and lower-cased, blank stored as NULL, at most 120 characters, a lenient shape check.';
COMMENT ON COLUMN public.lessors.bank_name IS
  'Optional bank name of the supplier («البنك», 0175): trimmed, blank stored as NULL, at most 100 characters.';
COMMENT ON COLUMN public.lessors.iban IS
  'Optional Saudi IBAN («الايبان», 0175): stored without spaces or dashes and upper-case (normalise_lessor_fields); SA + 22 characters (lessors_iban_check).';

-- ===========================================================================
-- 3. companies — columns and CHECKs
-- ===========================================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS commercial_register text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_number text;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_tax_number_check,
  DROP CONSTRAINT IF EXISTS companies_commercial_register_check,
  DROP CONSTRAINT IF EXISTS companies_address_check,
  DROP CONSTRAINT IF EXISTS companies_city_check,
  DROP CONSTRAINT IF EXISTS companies_email_check,
  DROP CONSTRAINT IF EXISTS companies_contact_person_check,
  DROP CONSTRAINT IF EXISTS companies_contact_number_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_tax_number_check
    CHECK (tax_number IS NULL OR tax_number ~ '^[0-9]{15}$'),
  ADD CONSTRAINT companies_commercial_register_check
    CHECK (commercial_register IS NULL OR commercial_register ~ '^[0-9]{4,20}$'),
  ADD CONSTRAINT companies_address_check
    CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 200),
  ADD CONSTRAINT companies_city_check
    CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 60),
  ADD CONSTRAINT companies_email_check
    CHECK (
      email IS NULL
      OR (char_length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    ),
  ADD CONSTRAINT companies_contact_person_check
    CHECK (contact_person IS NULL OR char_length(contact_person) BETWEEN 1 AND 120),
  ADD CONSTRAINT companies_contact_number_check
    CHECK (contact_number IS NULL OR char_length(contact_number) BETWEEN 1 AND 30);

COMMENT ON COLUMN public.companies.tax_number IS
  'Optional Saudi VAT registration number of the client («الرقم الضريبي», 0175): exactly 15 digits once spaces and dashes are stripped (normalise_company_fields), unique when set (companies_tax_number_unique).';
COMMENT ON COLUMN public.companies.commercial_register IS
  'Optional commercial register number of the client («السجل التجاري», 0175): 4 to 20 digits once spaces and dashes are stripped, unique when set (companies_commercial_register_unique).';
COMMENT ON COLUMN public.companies.address IS
  'Optional national address / street («العنوان», 0175): trimmed, blank stored as NULL, at most 200 characters.';
COMMENT ON COLUMN public.companies.city IS
  'Optional city («المدينة», 0175): trimmed, blank stored as NULL, at most 60 characters.';
COMMENT ON COLUMN public.companies.email IS
  'Optional e-mail («البريد», 0175): trimmed and lower-cased, blank stored as NULL, at most 120 characters, a lenient shape check.';
COMMENT ON COLUMN public.companies.contact_person IS
  'Optional contact person of the client («جهة الاتصال», 0175): trimmed, blank stored as NULL, at most 120 characters.';
COMMENT ON COLUMN public.companies.contact_number IS
  'Optional contact number of the client («الجوال», 0175): trimmed, blank stored as NULL, at most 30 characters.';

-- ===========================================================================
-- 4. Uniqueness (partial) and the search indexes
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS lessors_tax_number_unique
  ON public.lessors (tax_number)
  WHERE tax_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lessors_commercial_register_unique
  ON public.lessors (commercial_register)
  WHERE commercial_register IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_tax_number_unique
  ON public.companies (tax_number)
  WHERE tax_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_commercial_register_unique
  ON public.companies (commercial_register)
  WHERE commercial_register IS NOT NULL;

CREATE INDEX IF NOT EXISTS lessors_tax_number_trgm_idx
  ON public.lessors USING gin (tax_number extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lessors_commercial_register_trgm_idx
  ON public.lessors USING gin (commercial_register extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS companies_tax_number_trgm_idx
  ON public.companies USING gin (tax_number extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS companies_commercial_register_trgm_idx
  ON public.companies USING gin (commercial_register extensions.gin_trgm_ops);

-- ===========================================================================
-- 5. Normalisation triggers: trim, blank -> NULL, the numbers without
--    spaces / dashes, the IBAN upper-case, the email lower-case
-- ===========================================================================
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
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_lessor_fields() IS
  'BEFORE INSERT OR UPDATE trigger on lessors (0175): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number, commercial_register and iban, upper-cases iban and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those seven columns only.';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.normalise_lessor_fields()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalise_lessor_fields ON public.lessors;
CREATE TRIGGER normalise_lessor_fields
  BEFORE INSERT OR UPDATE ON public.lessors
  FOR EACH ROW EXECUTE FUNCTION public.normalise_lessor_fields();

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
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_company_fields() IS
  'BEFORE INSERT OR UPDATE trigger on companies (0175): trims the 0175 columns and stores a blank as NULL, strips spaces and dashes from tax_number and commercial_register and lower-cases email, so the CHECKs and the unique indexes see the normalised text. Writes those seven columns only.';

REVOKE ALL ON FUNCTION public.normalise_company_fields()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalise_company_fields ON public.companies;
CREATE TRIGGER normalise_company_fields
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.normalise_company_fields();
