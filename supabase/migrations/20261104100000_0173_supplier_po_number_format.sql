-- 0173: supplier PO numbers «PO-YYYYMM» + an endless sequence; every
-- existing PO renumbered.
--
-- Owner decision 2026-11-04 («بالنسبة لترقيم PO الموردين خليه السنة كاملة
-- والشهر ثم اربع خانات تسلسلية, وخليها تكون كذا PO- ثم الرقم, وعدل على كل
-- الموجود»; «التسلسل الرباعي يستمر للابد»):
--   1. The number is `PO-` + the Saudi year (four digits) + the Saudi month
--      (two digits) + a sequence of AT LEAST four digits that never restarts
--      — not per month, not per year; after 9999 it simply grows to five
--      digits: PO-2026110001, PO-2026110002, …, PO-2026120003.
--   2. The counter: ONE global row. The 0136 table `supplier_po_counters`
--      (one row per two-digit year) is replaced by the one-row table
--      `supplier_po_sequence` (a boolean primary key fixed to true, so a
--      second row cannot exist; RLS on with no policy and no grant, so no
--      client reads or writes it). `next_supplier_po_number()` keeps its
--      name and signature — `create_supplier_po` (0157) calls it by name and
--      is NOT re-created — and now increments that single row (the row lock
--      serialises concurrent creations, as the yearly upsert did) and builds
--      the number from now() in Saudi time. A rolled-back creation still
--      leaves a gap, which stays accepted.
--   3. Every EXISTING PO is renumbered in this transaction: ordered by
--      (created_at, id) they take the sequence 1..N and the number of the
--      Saudi month of their creation, and the counter is set to N. No new
--      number can equal an old `SPO…` value and the new numbers are
--      distinct, so one UPDATE from a numbered CTE is enough under the
--      UNIQUE constraint. Each renumbered PO gets one append-only event
--      `renumbered` with {old_number, new_number} and no actor (a migration
--      has no auth.uid(), as the 0149 events). `supplier_pos.updated_at` is
--      kept as it was («اخر تعديل» keeps meaning the last change by a
--      user): the 0146 trigger is disabled around the one UPDATE and
--      re-enabled right after.
--   4. The format CHECK `supplier_pos_number_format` is dropped before the
--      renumbering and re-added AFTER it as `^PO-[0-9]{10,}$`, so the
--      migration never fails on the old values; a guard aborts the whole
--      migration if any row would not match the new format or the counter
--      disagrees with the row count.
--   5. Nothing else changes: lines, cards, the other events, the views
--      (`purchasing_site_units`, `purchasing_po_units`, `sales_*` read
--      po_number as data), policies and the other functions.

-- ===========================================================================
-- 1. The event type (the 0160 list plus `renumbered`)
-- ===========================================================================
ALTER TABLE public.supplier_po_events
  DROP CONSTRAINT supplier_po_events_type_check;
ALTER TABLE public.supplier_po_events
  ADD CONSTRAINT supplier_po_events_type_check CHECK (
    event_type IN (
      'created', 'updated',
      'equipment_added', 'price_changed', 'line_updated', 'card_changed',
      'equipment_removed',
      'approved',
      'closed', 'reopened',
      'renumbered'
    )
  );

COMMENT ON TABLE public.supplier_po_events IS
  '0136: append-only audit of a supplier PO (created, updated, equipment_added, price_changed, line_updated, card_changed, equipment_removed, approved, closed, reopened; 0173: renumbered {old_number, new_number}, written once by the migration with no actor). Read by purchasing.view; written only by the purchasing functions; no update or delete path.';

-- ===========================================================================
-- 2. The single global counter
-- ===========================================================================
CREATE TABLE public.supplier_po_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT supplier_po_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT supplier_po_sequence_last_seq_check CHECK (last_seq >= 0)
);

COMMENT ON TABLE public.supplier_po_sequence IS
  '0173: the ONE row holding the last consumed supplier PO sequence number (never restarts: not per month, not per year). Read and written only by next_supplier_po_number(); no client access. Replaces the yearly supplier_po_counters of 0136.';

ALTER TABLE public.supplier_po_sequence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supplier_po_sequence FROM PUBLIC, anon, authenticated;

INSERT INTO public.supplier_po_sequence (singleton, last_seq) VALUES (true, 0);

DROP TABLE public.supplier_po_counters;

CREATE OR REPLACE FUNCTION public.next_supplier_po_number()
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
  UPDATE public.supplier_po_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'supplier_po_sequence_missing' USING ERRCODE = '55000';
  END IF;
  RETURN 'PO-'
    || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
    || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_supplier_po_number() IS
  '0173: consumes and returns the next supplier PO number, PO- + the Saudi year and month (YYYYMM) + a sequence of at least four digits that never restarts (PO-2026110001; after 9999 it grows to five digits). Called only by create_supplier_po; a rolled-back creation leaves a gap, which is accepted.';

REVOKE ALL ON FUNCTION public.next_supplier_po_number()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. Renumbering every existing PO
-- ===========================================================================
ALTER TABLE public.supplier_pos
  DROP CONSTRAINT supplier_pos_number_format;

-- «اخر تعديل» stays what it was: the renumbering is not a user's change.
ALTER TABLE public.supplier_pos DISABLE TRIGGER supplier_pos_updated_at;

WITH numbered AS (
  SELECT
    p.id,
    p.po_number AS old_number,
    'PO-'
      || to_char(p.created_at AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
      || lpad((row_number() OVER (ORDER BY p.created_at, p.id))::text, 4, '0')
      AS new_number
  FROM public.supplier_pos p
),
renumbered AS (
  UPDATE public.supplier_pos p
  SET po_number = n.new_number
  FROM numbered n
  WHERE n.id = p.id
    AND p.po_number IS DISTINCT FROM n.new_number
  RETURNING p.id, n.old_number, n.new_number
)
INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
SELECT
  r.id,
  'renumbered',
  jsonb_build_object('old_number', r.old_number, 'new_number', r.new_number),
  NULL
FROM renumbered r;

ALTER TABLE public.supplier_pos ENABLE TRIGGER supplier_pos_updated_at;

-- The counter continues from the last renumbered PO.
UPDATE public.supplier_po_sequence
SET last_seq = (SELECT count(*) FROM public.supplier_pos)
WHERE singleton;

-- ===========================================================================
-- 4. The guard, then the new format
-- ===========================================================================
DO $$
DECLARE
  v_bad integer;
  v_count integer;
  v_seq integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.supplier_pos
  WHERE po_number !~ '^PO-[0-9]{10,}$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0173: % supplier PO number(s) do not match ^PO-[0-9]{10,}$ after renumbering', v_bad;
  END IF;

  SELECT count(*) INTO v_count FROM public.supplier_pos;
  SELECT last_seq INTO v_seq FROM public.supplier_po_sequence WHERE singleton;
  IF v_seq IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION '0173: the sequence (%) does not equal the number of POs (%)', v_seq, v_count;
  END IF;
END;
$$;

ALTER TABLE public.supplier_pos
  ADD CONSTRAINT supplier_pos_number_format CHECK (po_number ~ '^PO-[0-9]{10,}$');

COMMENT ON COLUMN public.supplier_pos.po_number IS
  '0173: PO- + the Saudi year and month of creation (YYYYMM) + a global sequence of at least four digits that never restarts (PO-2026110001). Unique. Every PO before 0173 (SPO + YY + four digits) was renumbered by the migration, with a `renumbered` event carrying its old number.';
