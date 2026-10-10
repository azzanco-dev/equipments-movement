-- 0123: remove the "F" zero-padding renumbering from the code history
--
-- Owner request 2026-10-10. The two-digit F codes were renumbered through the
-- admin Excel update to carry a leading zero (F12 -> F012) so they match the
-- Afaqy unit names. That was a formatting change, not a real renumbering, and
-- the owner does not want it in «ارقام سابقة»: those rows are removed from the
-- append-only `equipment_code_changes` (migration 0114). Clients cannot delete
-- history rows (SELECT only), so this is done here, once.
--
-- Scope, deliberately narrow: a row is removed ONLY when its old code is `F`
-- followed by exactly two digits and its new code is the same digits with one
-- leading zero, compared as upper(btrim(code)) like 0114 does everywhere.
-- Any other change (another prefix, another digit count, a different new
-- code) is untouched. Nothing else is created, changed or dropped.
--
-- Consequence: the old two-digit code stops matching in searches and leaves
-- the «ارقام سابقة» lists, and it becomes available to another unit again
-- (guard_equipment_code_history reads this table). The migration reports the
-- number of rows it removed.

DO $$
DECLARE
  v_removed int;
BEGIN
  DELETE FROM public.equipment_code_changes c
  WHERE upper(btrim(c.old_code)) ~ '^F[0-9]{2}$'
    AND upper(btrim(c.new_code)) = 'F0' || substr(upper(btrim(c.old_code)), 2);
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RAISE NOTICE '0123: removed % zero-padding F code change(s) from equipment_code_changes', v_removed;
END;
$$;
