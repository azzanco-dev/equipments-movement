-- 0164: the supplier's English name.
--
-- Owner 2026-10-29 («والمورد عربي وانجليزي»): the supplier PO PDF is
-- bilingual, so the supplier carries an optional English name beside its
-- Arabic `name`, entered in the supplier form and printed under the Arabic
-- name on the PO. NULL = none (the PDF shows the Arabic name alone).
--
-- A plain nullable column: the existing row policies of `lessors` cover it,
-- the BEFORE UPDATE `updated_at` trigger already runs, and no function or
-- view needs it.

alter table public.lessors
  add column if not exists name_en text;

alter table public.lessors
  drop constraint if exists lessors_name_en_check;

alter table public.lessors
  add constraint lessors_name_en_check
  check (name_en is null or (btrim(name_en) <> '' and char_length(name_en) <= 200));

comment on column public.lessors.name_en is
  'Optional English name of the supplier (0164), printed under the Arabic name on the supplier PO PDF.';
