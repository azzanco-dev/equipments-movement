-- 0202: the quotation number carries a sequence of three digits.
--
-- Owner decision 2026-11-17, reviewing the quotations list: «شيل التاريخ من
-- رقم العرض», then «202611000», and when asked which shape he wanted:
-- «لاتشيل التاريخ بس خليها 3 خانات الاصفار».
--
-- The number stays QT- + the Saudi YYYYMM of the creation + the GLOBAL
-- sequence that never restarts and never reuses a number; the sequence is
-- padded to at least THREE digits instead of four: QT-202611001 (it was
-- QT-2026110001). Past 999 it simply grows (QT-2026121000): the padding
-- never cuts a longer sequence.
--
-- What changes:
--   1. quotations_number_format accepts QT- + nine digits or more
--      (^QT-[0-9]{9,}$; it was ten or more).
--   2. A number issued under the four-digit shape is CONVERTED: QT- + its
--      six date digits + its sequence padded to three (QT-2026110001 →
--      QT-202611001; a sequence of 1000 or more keeps its digits). The
--      numbers stay unique (the sequence is global), updated_at does not
--      move, and each converted quotation gets an `updated` event
--      {old_number, new_number, reason: 'three_digit_sequence'}. (Production
--      held no quotation when this was written.) quotation_deletions keeps
--      the numbers it archived, as history.
--   3. next_quotation_number() pads the sequence to three digits; its
--      counter (quotation_number_sequence) is not touched.
--
-- Unchanged: save_quotation, copy_quotation, delete_quotation (they call
-- next_quotation_number), every token and grant.
--
-- Rollout: apply 0202 BEFORE deploying the quotation screens (the screens
-- show the number as data; their pattern mirrors the new CHECK).

-- ===========================================================================
-- 0. 0201 must be in place
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.quotation_deletions') IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = 'public.quotation_terms'::regclass
         AND a.attname = 'title_ar' AND NOT a.attisdropped
     ) THEN
    RAISE EXCEPTION '0202: migration 0201 (quotation terms without a title) is not applied';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. The issued numbers take the three-digit sequence
-- ===========================================================================
ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_number_format;

-- updated_at does not move (the conversion is not an edit by a user).
ALTER TABLE public.quotations DISABLE TRIGGER quotations_updated_at;

DO $$
DECLARE
  r record;
  v_number text;
  v_seq text;
BEGIN
  FOR r IN
    SELECT q.id, q.quote_number
    FROM public.quotations q
    WHERE q.quote_number ~ '^QT-[0-9]{10,}$'
    ORDER BY q.created_at, q.id
  LOOP
    -- QT- (3) + YYYYMM (6) + the sequence. lpad() CUTS a longer text to the
    -- length it is given, so the length is never under the sequence's own.
    v_seq := (substr(r.quote_number, 10)::bigint)::text;
    v_number := 'QT-'
      || substr(r.quote_number, 4, 6)
      || lpad(v_seq, GREATEST(3, char_length(v_seq)), '0');
    IF v_number <> r.quote_number THEN
      UPDATE public.quotations
      SET quote_number = v_number
      WHERE id = r.id;

      -- A migration has no auth.uid(): the event has no actor.
      INSERT INTO public.quotation_events (quotation_id, event_type, payload)
      VALUES (
        r.id, 'updated',
        jsonb_build_object(
          'old_number', r.quote_number,
          'new_number', v_number,
          'reason', 'three_digit_sequence'
        )
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.quotations ENABLE TRIGGER quotations_updated_at;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_number_format
    CHECK (quote_number ~ '^QT-[0-9]{9,}$');

COMMENT ON COLUMN public.quotations.quote_number IS
  '0202: the OFFICIAL number QT- + the Saudi YYYYMM of the quotation''s creation + a global sequence of at least three digits that never restarts and never reuses a number (next_quotation_number), e.g. QT-202611001. Issued when the quotation is created or copied; it never changes.';

-- ===========================================================================
-- 2. next_quotation_number: the sequence padded to three digits
-- ===========================================================================
-- 0199's body with the padding changed.
CREATE OR REPLACE FUNCTION public.next_quotation_number()
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
  UPDATE public.quotation_number_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'quotation_number_sequence_missing' USING ERRCODE = '55000';
  END IF;
  -- lpad() CUTS a longer text to the length it is given (lpad('1000', 3, '0')
  -- is '100'), so past 999 the length is the sequence's own.
  RETURN 'QT-'
    || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
    || lpad(v_seq::text, GREATEST(3, char_length(v_seq::text)), '0');
END;
$$;

COMMENT ON FUNCTION public.next_quotation_number() IS
  '0202 (re-created from 0199 with a three-digit sequence): consumes and returns the next quotation number, QT- + the Saudi year and month (YYYYMM) + a global sequence of at least three digits that never restarts and never reuses a number (QT-202611001). Called by save_quotation for a new quotation and by copy_quotation. The counter is a table row, so a rolled-back call takes its number back.';

REVOKE ALL ON FUNCTION public.next_quotation_number()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.quotation_number_sequence IS
  '0199 / 0202: the ONE row holding the last issued quotation number (QT-YYYYMM###, a global sequence that never restarts and never reuses a number). Read and written only by next_quotation_number(); no client access.';

-- ===========================================================================
-- 3. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_number text;
BEGIN
  SELECT q.quote_number INTO v_number
  FROM public.quotations q
  WHERE q.quote_number !~ '^QT-[0-9]{9,}$'
     -- A sequence under 1000 is exactly three digits.
     OR (char_length(q.quote_number) >= 13 AND substr(q.quote_number, 10, 1) = '0')
  LIMIT 1;
  IF v_number IS NOT NULL THEN
    RAISE EXCEPTION '0202: the quotation number % is not in the three-digit shape', v_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'next_quotation_number'
      AND p.prosrc LIKE '%lpad(v_seq::text, GREATEST(3, char_length(v_seq::text)), ''0'')%'
  ) THEN
    RAISE EXCEPTION '0202: next_quotation_number does not pad to three digits';
  END IF;
  IF has_function_privilege('authenticated', 'public.next_quotation_number()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.next_quotation_number()', 'EXECUTE') THEN
    RAISE EXCEPTION '0202: next_quotation_number is callable by a client';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
