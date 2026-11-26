-- 0215: the installment contract number carries a sequence of three digits.
--
-- Owner decision 2026-11-26: «بالنسبة لارقام العقود الداخلية … ابغاك تخليها
-- 3 ارقام مش 4 وغير الي موجود حاليا».
--
-- The number stays INS- + the GLOBAL sequence that never restarts and never
-- reuses a number; the sequence is padded to at least THREE digits instead
-- of four: INS-001 (it was INS-0001). Past 999 it simply grows (INS-1000):
-- the padding never cuts a longer sequence.
--
-- What changes:
--   1. installment_contracts_number_format accepts INS- + three digits or
--      more (^INS-[0-9]{3,}$; it was four or more).
--   2. Every issued number is CONVERTED: INS- + its sequence padded to three
--      (INS-0001 → INS-001; a sequence of 1000 or more keeps its digits).
--      The numbers stay unique (the sequence is global) and updated_at does
--      not move (the conversion is not an edit by a user). Installments have
--      no event log, so nothing records the old number;
--      installment_contract_deletions keeps the numbers it archived, as
--      history.
--   3. next_installment_contract_number() pads the sequence to three digits;
--      its counter (installment_contract_sequence) is not touched.
--
-- Unchanged: save_installment_contract (it calls the number function), every
-- view, token and grant.
--
-- Rollout: either side of the deploy. The screens show the number as data;
-- no screen checks its shape (INSTALLMENT_CONTRACT_NUMBER_PATTERN in
-- src/lib/installments.ts mirrors the new CHECK for the tests only).

-- ===========================================================================
-- 0. The installments section must be in place
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.installment_contracts') IS NULL
     OR to_regclass('public.installment_contract_sequence') IS NULL
     OR to_regprocedure('public.next_installment_contract_number()') IS NULL THEN
    RAISE EXCEPTION '0215: the installments section (0203) is not applied';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. The issued numbers take the three-digit sequence
-- ===========================================================================
ALTER TABLE public.installment_contracts
  DROP CONSTRAINT IF EXISTS installment_contracts_number_format;

-- updated_at does not move (the conversion is not an edit by a user).
ALTER TABLE public.installment_contracts
  DISABLE TRIGGER installment_contracts_updated_at;

DO $$
DECLARE
  r record;
  v_number text;
  v_seq text;
BEGIN
  FOR r IN
    SELECT c.id, c.contract_number
    FROM public.installment_contracts c
    WHERE c.contract_number ~ '^INS-[0-9]{4,}$'
    ORDER BY c.created_at, c.id
  LOOP
    -- INS- (4) + the sequence. lpad() CUTS a longer text to the length it is
    -- given, so the length is never under the sequence's own.
    v_seq := (substr(r.contract_number, 5)::bigint)::text;
    v_number := 'INS-' || lpad(v_seq, GREATEST(3, char_length(v_seq)), '0');
    IF v_number <> r.contract_number THEN
      UPDATE public.installment_contracts
      SET contract_number = v_number
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.installment_contracts
  ENABLE TRIGGER installment_contracts_updated_at;

ALTER TABLE public.installment_contracts
  ADD CONSTRAINT installment_contracts_number_format
    CHECK (contract_number ~ '^INS-[0-9]{3,}$');

COMMENT ON COLUMN public.installment_contracts.contract_number IS
  '0215: INS- + a global sequence of at least three digits that never restarts and never reuses a number (next_installment_contract_number), e.g. INS-001. Issued when the contract is created; it never changes.';

-- ===========================================================================
-- 2. next_installment_contract_number: the sequence padded to three digits
-- ===========================================================================
-- 0203's body with the padding changed.
CREATE OR REPLACE FUNCTION public.next_installment_contract_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  -- The one row, locked by the UPDATE itself: concurrent creations queue
  -- here and each takes its own number.
  UPDATE public.installment_contract_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'installment_contract_sequence_missing' USING ERRCODE = '55000';
  END IF;
  -- lpad() CUTS a longer text to the length it is given (lpad('1000', 3, '0')
  -- is '100'), so past 999 the length is the sequence's own.
  RETURN 'INS-' || lpad(v_seq::text, GREATEST(3, char_length(v_seq::text)), '0');
END;
$$;

COMMENT ON FUNCTION public.next_installment_contract_number() IS
  '0215 (re-created from 0203 with a three-digit sequence): consumes and returns the next installment contract number, INS- + a global sequence of at least three digits that never restarts and never reuses a number (INS-001). Called by save_installment_contract for a new contract. The counter is a table row, so a rolled-back call takes its number back.';

REVOKE ALL ON FUNCTION public.next_installment_contract_number()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.installment_contract_sequence IS
  '0203 / 0215: the ONE row holding the last issued installment contract number (INS-001, a global sequence that never restarts and never reuses a number). Read and written only by next_installment_contract_number(); no client access.';

-- ===========================================================================
-- 3. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_number text;
BEGIN
  SELECT c.contract_number INTO v_number
  FROM public.installment_contracts c
  WHERE c.contract_number !~ '^INS-[0-9]{3,}$'
     -- A sequence under 1000 is exactly three digits.
     OR (char_length(c.contract_number) >= 8 AND substr(c.contract_number, 5, 1) = '0')
  LIMIT 1;
  IF v_number IS NOT NULL THEN
    RAISE EXCEPTION '0215: the contract number % is not in the three-digit shape', v_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'next_installment_contract_number'
      AND p.prosrc LIKE '%lpad(v_seq::text, GREATEST(3, char_length(v_seq::text)), ''0'')%'
  ) THEN
    RAISE EXCEPTION '0215: next_installment_contract_number does not pad to three digits';
  END IF;
  IF has_function_privilege('authenticated', 'public.next_installment_contract_number()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.next_installment_contract_number()', 'EXECUTE') THEN
    RAISE EXCEPTION '0215: next_installment_contract_number is callable by a client';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
