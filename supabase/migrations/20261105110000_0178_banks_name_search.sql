-- 0178: the search column of the banks list.
--
-- Owner 2026-11-05 «لما ابحث عن بنك يطلع تعذر تحميل الخيارات»: the bank
-- selector of the supplier form and the Settings › «البنوك» page search with
-- the shared `NAME_SEARCH_FIELDS` (`name_search.ilike`), the normalised name
-- column every name master carries since 0116 (hamza, taa marbuta and alif
-- maqsura folded, so «الأهلي» finds «الاهلي»). 0177 created `public.banks`
-- without it, so every search was refused. This adds it exactly as 0116 did
-- for `equipment_types`.
--
-- Objects: public.banks.name_search (generated, stored) and its trigram
-- index banks_name_search_trgm_idx. No policy, grant or function change.

ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS name_search text
    GENERATED ALWAYS AS (public.normalize_search_text(name)) STORED;

CREATE INDEX IF NOT EXISTS banks_name_search_trgm_idx
  ON public.banks USING gin (name_search extensions.gin_trgm_ops);

COMMENT ON COLUMN public.banks.name_search IS
  'normalize_search_text(name), generated (0178). Search only; never displayed.';
