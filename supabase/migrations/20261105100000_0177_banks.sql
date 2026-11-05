-- 0177: the banks list («البنوك») that the supplier's bank is picked from.
--
-- Owner request 2026-11-05 («سوي قائمة للبنوك السعودية المعروفة, بحيث يكون
-- اختيار منها, ويكون الاضافة او الحذف او التعديل من الاعدادات»), right after
-- 0175 gave `public.lessors` a free-text `bank_name`. The bank is now chosen
-- from a managed master list, the `equipment_types` pattern of 0039:
--
--   * `public.banks` holds one row per bank: `name` (unique, also on its
--     lower-case trimmed form, 1–100 characters like 0175's
--     `lessors_bank_name_check`), `created_at`, and `updated_at` with the
--     `update_updated_at()` trigger (owner rule 2026-10-22).
--   * It is seeded with the banks licensed in Saudi Arabia that the company's
--     suppliers usually use; the list is edited from Settings › «البنوك».
--   * `lessors.bank_name` keeps its name and type (the screens and the import
--     of 0175 keep working) and becomes a foreign key to `banks(name)`:
--     ON UPDATE CASCADE (renaming a bank renames it on every supplier) and
--     ON DELETE RESTRICT (a bank used by a supplier cannot be deleted; the
--     screen says so).
--   * Any bank name already stored by 0175 is added to the list first, so
--     the foreign key never refuses an existing row.
--
-- Access: every signed-in user reads the list (the supplier form, the
-- details dialog); adding, renaming and deleting a bank need `lessors.edit`,
-- the key that already edits the suppliers (0127), so no new permission key.
--
-- MUST be applied AFTER 0175 (it references `lessors.bank_name`).
--
-- ===========================================================================
-- Objects
-- ===========================================================================
-- New table:   public.banks (RLS on; policies select_banks, insert_banks,
--              update_banks, delete_banks)
-- New index:   banks_name_lower_key (unique on lower(btrim(name)))
-- New trigger: banks_updated_at (BEFORE UPDATE, public.update_updated_at())
-- New FK:      lessors_bank_name_fkey (lessors.bank_name → banks.name)

CREATE TABLE IF NOT EXISTS public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
    CONSTRAINT banks_name_check
      CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.banks IS
  '0177: the banks a supplier''s bank is chosen from (owner 2026-11-05). Managed in Settings › «البنوك» by lessors.edit; lessors.bank_name references banks.name.';

CREATE UNIQUE INDEX IF NOT EXISTS banks_name_lower_key
  ON public.banks (lower(btrim(name)));

DROP TRIGGER IF EXISTS banks_updated_at ON public.banks;
CREATE TRIGGER banks_updated_at
  BEFORE UPDATE ON public.banks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- The known Saudi banks (no hamza on the alif, the project's copy rule).
INSERT INTO public.banks (name) VALUES
  ('البنك الاهلي السعودي'),
  ('مصرف الراجحي'),
  ('بنك الرياض'),
  ('البنك السعودي الاول'),
  ('البنك السعودي الفرنسي'),
  ('البنك العربي الوطني'),
  ('بنك البلاد'),
  ('بنك الجزيرة'),
  ('مصرف الانماء'),
  ('البنك السعودي للاستثمار'),
  ('بنك الخليج الدولي'),
  ('بنك STC'),
  ('بنك دال 360')
ON CONFLICT DO NOTHING;

-- Every bank name 0175 may already hold joins the list, then the stored
-- spelling follows the list's (a name that differs only in case or edge
-- spaces matches an existing bank).
INSERT INTO public.banks (name)
SELECT DISTINCT ON (lower(btrim(l.bank_name))) btrim(l.bank_name)
FROM public.lessors AS l
WHERE l.bank_name IS NOT NULL
  AND btrim(l.bank_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.banks AS b
    WHERE lower(btrim(b.name)) = lower(btrim(l.bank_name))
  )
ORDER BY lower(btrim(l.bank_name)), btrim(l.bank_name);

UPDATE public.lessors AS l
SET bank_name = b.name
FROM public.banks AS b
WHERE l.bank_name IS NOT NULL
  AND lower(btrim(l.bank_name)) = lower(btrim(b.name))
  AND l.bank_name <> b.name;

ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_banks ON public.banks;
CREATE POLICY select_banks ON public.banks
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS insert_banks ON public.banks;
CREATE POLICY insert_banks ON public.banks
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('lessors.edit'))
);

DROP POLICY IF EXISTS update_banks ON public.banks;
CREATE POLICY update_banks ON public.banks
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('lessors.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('lessors.edit'))
);

DROP POLICY IF EXISTS delete_banks ON public.banks;
CREATE POLICY delete_banks ON public.banks
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('lessors.edit'))
);

REVOKE ALL ON TABLE public.banks FROM anon;

ALTER TABLE public.lessors
  DROP CONSTRAINT IF EXISTS lessors_bank_name_fkey;
ALTER TABLE public.lessors
  ADD CONSTRAINT lessors_bank_name_fkey
  FOREIGN KEY (bank_name) REFERENCES public.banks(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS lessors_bank_name_idx
  ON public.lessors (bank_name)
  WHERE bank_name IS NOT NULL;

COMMENT ON COLUMN public.lessors.bank_name IS
  '0175 / 0177: the supplier''s bank, one of public.banks (foreign key on the name, renamed along with the bank, a used bank cannot be deleted).';
