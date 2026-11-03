-- 0171: the generated short code continues from the LAST one.
--
-- Owner 2026-11-03 («لما اضيف معدة جديدة لمورد, مفروض التسلسل يبدا من اخر
-- شي, مش من تحت»): a unit created from the movement form's quick create
-- (a supplier unit through quick_create_foreman_equipment, or a workshop
-- unit «بدون رقم») gets a generated code «U» + number. Since 0040 that
-- number came from the sequence equipment_short_code_seq, which only knows
-- the codes IT handed out: a U-code entered by hand, by the Excel import or
-- before the sequence existed is invisible to it, so the next generated
-- code could fall BELOW the highest U-code in the fleet («من تحت»). The
-- sequence also ignored the previous codes of 0114, so a number that once
-- belonged to a renamed unit could be handed out and refused by
-- equipment_code_previously_used.
--
-- Now next_short_equipment_code() takes the greatest number among
--   * the current codes of the form U + digits (upper(btrim(code))), and
--   * the previous codes of the same form in equipment_code_changes
--     (old_code and new_code, so a renamed unit's numbers stay taken),
-- adds one and keeps counting up while the candidate is a current or a
-- previous code. Concurrent callers are serialised on one transaction
-- advisory lock, so two quick creates never compute the same number; the
-- unique index on the code stays the last guard. The width stays three
-- digits with lpad (U001 … U999, then U1000). The sequence is dropped:
-- nothing else used it (0040 revoked every grant), and the callers
-- (quick_create_foreman_equipment, quick_create_workshop_equipment) are
-- unchanged.

CREATE OR REPLACE FUNCTION public.next_short_equipment_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
  v_code text;
BEGIN
  -- One generator at a time: the second caller waits and sees the first
  -- caller's row once it is committed (the callers insert in the same
  -- transaction that computed the code).
  PERFORM pg_advisory_xact_lock(hashtextextended('next_short_equipment_code', 0));

  SELECT COALESCE(MAX(n), 0) + 1
  INTO v_next
  FROM (
    SELECT substr(upper(btrim(code)), 2)::integer AS n
    FROM public.equipment
    WHERE upper(btrim(code)) ~ '^U[0-9]{1,9}$'
    UNION ALL
    SELECT substr(upper(btrim(old_code)), 2)::integer
    FROM public.equipment_code_changes
    WHERE upper(btrim(old_code)) ~ '^U[0-9]{1,9}$'
    UNION ALL
    SELECT substr(upper(btrim(new_code)), 2)::integer
    FROM public.equipment_code_changes
    WHERE upper(btrim(new_code)) ~ '^U[0-9]{1,9}$'
  ) AS numbers;

  LOOP
    v_code := 'U' || lpad(v_next::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.equipment WHERE upper(btrim(code)) = v_code
    ) AND NOT EXISTS (
      SELECT 1 FROM public.equipment_code_changes
      WHERE upper(btrim(old_code)) = v_code OR upper(btrim(new_code)) = v_code
    );
    v_next := v_next + 1;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.next_short_equipment_code() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_short_equipment_code() IS
  '0171: the next generated short code «U» + number, one above the greatest U-number among the current codes and the previous codes of equipment_code_changes (owner 2026-11-03: the sequence continues from the last code, never from a lower free number); serialised on an advisory lock. Called only by the quick-create functions.';

DROP SEQUENCE IF EXISTS public.equipment_short_code_seq;
