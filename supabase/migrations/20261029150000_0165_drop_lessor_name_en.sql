-- 0165: drop the supplier's English name again.
--
-- Owner 2026-10-29 («معليش نقدر نلغي الاسم الانجليزي للمورد؟»): the optional
-- `lessors.name_en` of 0164 goes. Rollout order: apply this ONLY after the
-- screens without the field are deployed (they no longer read or write it);
-- the live UI of 0164 selects the column, so dropping it earlier would break
-- the supplier list and the PO page.
--
-- The column is empty (no supplier was given an English name), so nothing is
-- lost. No function, view or policy references it.

alter table public.lessors
  drop constraint if exists lessors_name_en_check;

alter table public.lessors
  drop column if exists name_en;
