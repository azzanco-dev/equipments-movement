-- 0190: a supplier PO takes its official number at its FIRST approval; a
-- client PO may be created without the client's number.
--
-- Owner decisions 2026-11-11: «الحين المفروض انه رقم الPO مايصدر الا اذا جاء
-- الاعتماد», «اعتمد, وبرضه اشتغل على القديم, الى الان احنا ماطبعنا po's ولا
-- نشرنا شي فممكن تلغي الارقام من المسودات, بحيث لو صار اعتماد ينشى لها رقم
-- po», his choice «اعادة ترقيم المعتمدة» (the approved POs take 0001… in
-- the order they were approved and the next approval continues), and «po
-- العملاء ممكن مايكون له رقم».
--
-- Applied right AFTER 0189 (same push): it builds on the schema 0189 leaves
-- (no supplier PO status, the 0189 bodies of approve_supplier_po and
-- approve_equipment_card_pricing).
--
-- A. Supplier PO
--   1. supplier_pos.po_number stays ONE text NOT NULL UNIQUE column. It
--      holds the OFFICIAL number PO- + YYYYMM + a global sequence of at
--      least four digits (0173's shape, ^PO-[0-9]{10,}$) or, until the first
--      approval, a DRAFT REFERENCE DRAFT-#### (^DRAFT-[0-9]{4,}$). The CHECK
--      supplier_pos_number_format accepts exactly these two shapes, and the
--      new CHECK supplier_pos_approved_numbered says an approved PO always
--      carries an official number. A PO returned to draft (0189
--      return_supplier_po_approval, 0174/0189 return_equipment_card_pricing,
--      both NOT re-created here) KEEPS its official number, so a draft may
--      hold either shape; its next approval issues nothing new.
--   2. The draft references come from the new one-row counter
--      supplier_po_draft_sequence through next_supplier_po_draft_ref() —
--      the 0173 supplier_po_sequence pattern (a boolean primary key fixed to
--      true, RLS on with no policy, no privilege for PUBLIC / anon /
--      authenticated; the function SECURITY DEFINER with no EXECUTE grant,
--      called only by create_supplier_po).
--   3. create_supplier_po: the 0157 body VERBATIM except the number, now
--      next_supplier_po_draft_ref(). The `created` event keeps the key
--      po_number (now the draft reference).
--   4. approve_supplier_po: the 0189 body VERBATIM except that, when the PO
--      holds a draft reference, the approval UPDATE also sets po_number to
--      next_supplier_po_number(); the `approved` event payload is
--      {line_count, po_number} plus draft_ref (the reference it replaced)
--      when a number was issued.
--   5. approve_equipment_card_pricing: the 0189 body VERBATIM except that,
--      when its linkage approves the supplier PO and the PO holds a draft
--      reference, the number is issued the same way in that UPDATE; the
--      number is decided BEFORE the card event, so pricing_approved carries
--      in supplier_po_number the number the PO ends up with; the PO's
--      `approved` event {via, card_id, line_count} gains po_number (always)
--      and draft_ref (when issued). Locks unchanged: the card row, then the
--      PO row.
--   6. next_supplier_po_number() keeps its name, body and grants (none); only
--      its comment changes: it is called at the first approval, so the
--      YYYYMM is the approval's month. The counter is a table row, so a
--      rolled-back approval takes its number back with it.
--   7. The existing rows, in this transaction (production on 2026-11-11: 558
--      POs, all PO-…, 36 approved, 522 drafts, no approval_returned event;
--      written generally):
--      * The NUMBERED set = every PO approved now OR with at least one
--        `approved` event (a PO returned to draft after an approval keeps an
--        official number). Ordered by its first approval — COALESCE(its
--        earliest `approved` event, approved_at), then id — it takes
--        PO- + the Saudi YYYYMM of that first approval + 0001, 0002, … (one
--        global sequence across months, as 0173).
--      * Every OTHER PO (never approved) becomes DRAFT- + the sequence digits
--        of its current number (PO-2026110558 → DRAFT-0558), so people
--        still recognise it.
--      * supplier_po_sequence.last_seq = the size of the numbered set (the
--        next approval takes the next number); supplier_po_draft_sequence
--        starts at the greater of the old supplier_po_sequence.last_seq
--        (read before it is overwritten) and the greatest draft reference in
--        use.
--      * The UNIQUE constraint: the new official numbers can equal numbers
--        other rows still hold, and a non-deferrable unique constraint is
--        checked row by row. So every row whose number changes first moves
--        to a collision-free intermediate value TMP0190-<id> (the format
--        CHECK is dropped beforehand), then to its final value; the final
--        values are distinct (the official ones by their row number, the
--        draft ones by the never-restarting 0173 digits, and the two shapes
--        never meet), and a row that keeps its number is never touched.
--      * Each PO whose number changed gets ONE append-only `renumbered` event
--        {old_number, new_number, reason: number_at_approval} with no actor
--        (a migration has no auth.uid(), as 0173). supplier_pos.updated_at
--        does not move: the 0146 trigger supplier_pos_updated_at (the only
--        trigger on supplier_pos) is disabled around the UPDATEs and enabled
--        right after, as 0173 did.
--      * The two CHECKs are added after the renumbering, then a guard aborts
--        the migration unless every approved PO has an official number, the
--        official numbers' sequence digits are exactly 1..N with
--        N = supplier_po_sequence.last_seq, no never-approved PO holds an
--        official number and every po_number has one of the two shapes.
--
-- B. Client PO
--   client_pos.po_number stays text NOT NULL with its CHECK and its unique
--   index per company. create_client_po (the 0169 body VERBATIM otherwise)
--   no longer refuses a blank / NULL p_po_number: it stores an INTERNAL
--   REFERENCE CPO-#### (4+ digits) from the new one-row counter
--   client_po_ref_sequence through next_client_po_ref() (the same pattern
--   and hardening), taking the next one while that reference is already
--   used by a PO of the same company (compared as upper(btrim()), as the
--   index). A given number over 60 characters is still invalid_po_number,
--   an existing number of that company still duplicate_po_number. No
--   backfill on the client side.
--
-- No new permission key, no policy change. Every function: SECURITY
-- DEFINER, SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC, anon
-- (and the counter functions from authenticated too, with no grant), the
-- callable ones GRANT EXECUTE TO authenticated as before, a COMMENT.
--
-- Rollout: apply 0190 right after 0189, in the same push, AFTER the screens
-- of these commits are deployed (0189's own rule). The screens show
-- po_number as plain data, so they work on both sides of this migration;
-- before it a blank client PO number is still refused (invalid_po_number).
-- Checked read-only against production on 2026-11-11: the mapping gives 36
-- official numbers PO-2026110001 … PO-2026110036 and 522 draft references
-- up to DRAFT-0558, all distinct, none NULL.

-- ===========================================================================
-- A1. The draft-reference counter (the 0173 pattern)
-- ===========================================================================
CREATE TABLE public.supplier_po_draft_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT supplier_po_draft_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT supplier_po_draft_sequence_last_seq_check CHECK (last_seq >= 0)
);

COMMENT ON TABLE public.supplier_po_draft_sequence IS
  '0190: the ONE row holding the last consumed draft reference of a supplier PO (DRAFT-####, never restarts). Read and written only by next_supplier_po_draft_ref(); no client access.';

ALTER TABLE public.supplier_po_draft_sequence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supplier_po_draft_sequence FROM PUBLIC, anon, authenticated;

-- Starts at the OLD official sequence (read here, before A5 overwrites it);
-- A5 raises it to the greatest draft reference in use if that is greater.
INSERT INTO public.supplier_po_draft_sequence (singleton, last_seq)
SELECT true, s.last_seq
FROM public.supplier_po_sequence s
WHERE s.singleton;

CREATE OR REPLACE FUNCTION public.next_supplier_po_draft_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  -- The one row, locked by the UPDATE itself: concurrent creations queue
  -- here and each takes its own reference.
  UPDATE public.supplier_po_draft_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'supplier_po_draft_sequence_missing' USING ERRCODE = '55000';
  END IF;
  RETURN 'DRAFT-' || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_supplier_po_draft_ref() IS
  '0190: consumes and returns the next draft reference of a supplier PO, DRAFT- + a sequence of at least four digits that never restarts (DRAFT-0559). A PO carries it until its first approval issues the official number (next_supplier_po_number). Called only by create_supplier_po.';

REVOKE ALL ON FUNCTION public.next_supplier_po_draft_ref()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_supplier_po_number() IS
  '0173/0190: consumes and returns the next OFFICIAL supplier PO number, PO- + the Saudi year and month (YYYYMM) + a sequence of at least four digits that never restarts (PO-2026110001). Since 0190 it is called at a PO''s FIRST approval (approve_supplier_po, approve_equipment_card_pricing), so the month is the approval''s; a new PO carries a draft reference (next_supplier_po_draft_ref). The counter is a table row, so a rolled-back approval takes its number back.';

-- ===========================================================================
-- A2. create_supplier_po: 0157 verbatim, a draft reference as the number
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.create_supplier_po(
  p_lessor_id uuid,
  p_owner_class text,
  p_company_id uuid,
  p_project_id uuid,
  p_start_date date,
  p_notes text DEFAULT NULL,
  p_equipment jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_item jsonb;
BEGIN
  PERFORM public.assert_purchasing_manage();

  -- Exactly one party: a lessor row, or an owner class.
  IF p_lessor_id IS NULL AND p_owner_class IS NULL THEN
    RAISE EXCEPTION 'party_required' USING ERRCODE = '22023';
  END IF;
  IF p_lessor_id IS NOT NULL AND p_owner_class IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_party' USING ERRCODE = '22023';
  END IF;
  IF p_owner_class IS NOT NULL
     AND p_owner_class NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b') THEN
    RAISE EXCEPTION 'invalid_owner_class' USING ERRCODE = '22023';
  END IF;
  IF p_lessor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.lessors l WHERE l.id = p_lessor_id) THEN
    RAISE EXCEPTION 'invalid_lessor' USING ERRCODE = '22023';
  END IF;
  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'invalid_start_date' USING ERRCODE = '22023';
  END IF;
  IF p_equipment IS NOT NULL AND jsonb_typeof(p_equipment) <> 'array' THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;

  -- 0190: a new PO is a draft and carries a draft reference; the official
  -- number is issued at its first approval.
  v_number := public.next_supplier_po_draft_ref();

  INSERT INTO public.supplier_pos (
    po_number, lessor_id, owner_class, is_internal, company_id, project_id,
    start_date, notes, created_by
  ) VALUES (
    v_number, p_lessor_id, p_owner_class, COALESCE(p_owner_class = 'alazani', false),
    p_company_id, p_project_id, p_start_date,
    NULLIF(btrim(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_id, 'created',
    jsonb_build_object(
      'po_number', v_number,
      'lessor_id', p_lessor_id,
      'owner_class', p_owner_class,
      'company_id', p_company_id,
      'project_id', p_project_id,
      'start_date', p_start_date
    ),
    auth.uid()
  );

  -- The equipment, in the same transaction: every line passes the rules of
  -- add_supplier_po_equipment or the whole call (and the reference) is
  -- rolled back. Each item: {"equipment_id": uuid, "price": number|null,
  -- "note": text|null, "rate_unit": "month"|"day"|null} (0157: the unit;
  -- null or missing = month).
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_supplier_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      v_item->>'note',
      NULLIF(v_item->>'rate_unit', '')
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138/0139/0148/0157/0189/0190: creates a supplier PO (a draft; no open / closed state since 0189) for a party (a lessor OR an owner class) under a DRAFT REFERENCE (DRAFT-####, 0190: the official PO number is issued at its first approval) and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note, rate_unit month|week|day|hour}]) through add_supplier_po_equipment, so every unit must have entered on the start date (entry_date_mismatch rolls the whole call back); a unit may already sit on other POs. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- A3. approve_supplier_po: 0189 verbatim, the number issued at the first
--     approval
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_supplier_po(
  p_po_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_lines integer;
  v_unpriced integer;
  v_number text;
  v_draft_ref text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('purchasing.approve') THEN
    RAISE EXCEPTION 'purchasing_approve_required'
      USING ERRCODE = '42501',
            HINT = 'Approving supplier purchase orders needs the purchasing.approve permission.';
  END IF;

  -- The PO row lock: every write to the PO and its lines takes it too, so
  -- nothing changes between the checks below and the approval.
  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.approval_status <> 'draft' THEN
    RAISE EXCEPTION 'po_not_draft'
      USING ERRCODE = '55000',
            HINT = 'The PO is already approved.';
  END IF;
  -- Nobody approves a PO they created (a PO whose creator is gone has no
  -- creator to compare).
  IF v_po.created_by IS NOT NULL AND v_po.created_by = auth.uid() THEN
    RAISE EXCEPTION 'po_self_approval'
      USING ERRCODE = '42501',
            HINT = 'A PO is approved by someone other than its creator.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE l.price IS NULL)
  INTO v_lines, v_unpriced
  FROM public.supplier_po_equipment l
  WHERE l.supplier_po_id = p_po_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'po_has_no_lines'
      USING ERRCODE = '55000',
            HINT = 'A PO without equipment cannot be approved.';
  END IF;
  IF v_unpriced > 0 THEN
    RAISE EXCEPTION 'po_has_unpriced_lines'
      USING ERRCODE = '55000',
            HINT = 'Every unit of the PO needs a price before approval.';
  END IF;

  -- 0190: the first approval issues the official number in place of the
  -- draft reference; a PO returned to draft keeps the number it had.
  IF v_po.po_number ~ '^DRAFT-[0-9]{4,}$' THEN
    v_draft_ref := v_po.po_number;
    v_number := public.next_supplier_po_number();
  ELSE
    v_number := v_po.po_number;
  END IF;

  UPDATE public.supplier_pos
  SET approval_status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      po_number = v_number
  WHERE id = p_po_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    p_po_id, 'approved',
    jsonb_build_object('line_count', v_lines, 'po_number', v_number)
      || CASE
           WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object('draft_ref', v_draft_ref)
           ELSE '{}'::jsonb
         END,
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.approve_supplier_po(uuid) IS
  '0160/0189/0190: approves a DRAFT supplier PO — needs purchasing.approve, never by its creator, only with at least one line and every line priced — recording approved_at / approved_by and the event approved {line_count, po_number, draft_ref when issued}. 0190: when the PO still carries its draft reference (DRAFT-####) the approval issues the official number (next_supplier_po_number) in its place; a PO returned to draft keeps its number. An approved PO is locked until return_supplier_po_approval. Tokens purchasing_approve_required, invalid_po, po_not_draft, po_self_approval, po_has_no_lines, po_has_unpriced_lines.';

REVOKE ALL ON FUNCTION public.approve_supplier_po(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_supplier_po(uuid)
  TO authenticated;

-- ===========================================================================
-- A4. approve_equipment_card_pricing: 0189 verbatim, the number issued when
--     the linkage approves the PO
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_equipment_card_pricing(
  p_card_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.equipment_cards%ROWTYPE;
  v_line public.supplier_po_equipment%ROWTYPE;
  v_po public.supplier_pos%ROWTYPE;
  v_po_approved boolean := false;
  v_line_count integer;
  v_po_number text;
  v_draft_ref text;
BEGIN
  PERFORM public.assert_sales_approve();

  IF p_card_id IS NULL THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_card
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;
  IF v_card.pricing_status <> 'draft' THEN
    RAISE EXCEPTION 'card_pricing_not_draft'
      USING ERRCODE = '55000',
            HINT = 'The card''s pricing is already approved.';
  END IF;
  IF v_card.client_price IS NULL THEN
    RAISE EXCEPTION 'card_pricing_no_client_price'
      USING ERRCODE = '55000',
            HINT = 'The card needs a client price before approval.';
  END IF;

  -- The supplier line: the line of the card's LATEST supplier PO, as the
  -- view does (0189: a card may sit on several POs and none is «open»).
  SELECT sl.* INTO v_line
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = p_card_id
  ORDER BY sp.created_at DESC, sp.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_line'
      USING ERRCODE = '55000',
            HINT = 'The card sits on no supplier PO.';
  END IF;

  -- The PO row lock: every purchasing write and approve_supplier_po take it,
  -- so nothing changes the PO or its lines between the checks and the update.
  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  IF v_line.price IS NULL THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_price'
      USING ERRCODE = '55000',
            HINT = 'The supplier line of the card needs a price before approval.';
  END IF;

  UPDATE public.equipment_cards
  SET pricing_status = 'approved',
      pricing_approved_at = now(),
      pricing_approved_by = auth.uid()
  WHERE id = p_card_id;

  -- Owner 2026-11-04 («الاعتماد يخلي PO المورد يصير معتمد»): when every line
  -- of the PO sits on a card whose pricing is approved (this one included,
  -- updated above) and the PO is a draft, the PO becomes approved —
  -- directly, not through approve_supplier_po: its purchasing.approve and
  -- self-approval checks belong to the manual path. A PO with other cards
  -- still in draft waits for them.
  IF v_po.approval_status = 'draft' THEN
    SELECT count(*) INTO v_line_count
    FROM public.supplier_po_equipment l
    WHERE l.supplier_po_id = v_po.id;
    IF v_line_count > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_po_equipment l
      JOIN public.equipment_cards c ON c.id = l.equipment_card_id
      WHERE l.supplier_po_id = v_po.id
        AND c.pricing_status <> 'approved'
    ) THEN
      v_po_approved := true;
    END IF;
  END IF;

  -- 0190: the number the PO ends up with, decided before the card event —
  -- the first approval issues the official number in place of the draft
  -- reference; a PO returned to draft keeps the number it had.
  v_po_number := v_po.po_number;
  IF v_po_approved AND v_po.po_number ~ '^DRAFT-[0-9]{4,}$' THEN
    v_draft_ref := v_po.po_number;
    v_po_number := public.next_supplier_po_number();
  END IF;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'pricing_approved',
    jsonb_build_object(
      'client_price', v_card.client_price,
      'client_price_unit', v_card.client_price_unit,
      'supplier_price', v_line.price,
      'supplier_rate_unit', v_line.rate_unit,
      'supplier_po_id', v_po.id,
      'supplier_po_number', v_po_number,
      'supplier_po_approved', v_po_approved
    )
  );

  IF v_po_approved THEN
    UPDATE public.supplier_pos
    SET approval_status = 'approved',
        approved_at = now(),
        approved_by = auth.uid(),
        po_number = v_po_number
    WHERE id = v_po.id;

    -- The 0160 event shape (actor_id; the PO page resolves the name).
    INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
    VALUES (
      v_po.id, 'approved',
      jsonb_build_object(
        'via', 'card_pricing',
        'card_id', p_card_id,
        'line_count', v_line_count,
        'po_number', v_po_number
      )
        || CASE
             WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object('draft_ref', v_draft_ref)
             ELSE '{}'::jsonb
           END,
      auth.uid()
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.approve_equipment_card_pricing(uuid) IS
  '0174/0185/0189/0190: approves the pricing of one equipment card — needs sales.approve, a DRAFT card (card_pricing_not_draft) with a client price (card_pricing_no_client_price) and a priced supplier line (card_pricing_no_supplier_line when the card sits on no supplier PO, card_pricing_no_supplier_price; 0 counts), the line of the card''s LATEST supplier PO (0189) — recording pricing_approved_at / _by and the event pricing_approved (0185: with client_price_unit; the units need not match). Then, when every line of that supplier PO sits on an approved card and the PO is a draft, the PO itself becomes approved (0160 state, event approved {via: card_pricing, card_id, line_count, po_number, draft_ref when issued}) without approve_supplier_po''s checks (owner 2026-11-04); 0190: a PO still under its draft reference gets its official number (next_supplier_po_number) in that update, and pricing_approved carries that number in supplier_po_number.';

REVOKE ALL ON FUNCTION public.approve_equipment_card_pricing(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_card_pricing(uuid)
  TO authenticated;

-- ===========================================================================
-- A5. The existing POs: renumbered (the 0173 techniques)
-- ===========================================================================
ALTER TABLE public.supplier_pos
  DROP CONSTRAINT supplier_pos_number_format;

-- The mapping, computed once while every row still holds its old number.
CREATE TEMPORARY TABLE supplier_po_renumber_0190 (
  id uuid PRIMARY KEY,
  old_number text NOT NULL,
  new_number text
);

WITH first_approval AS (
  SELECT
    p.id,
    COALESCE(
      (SELECT min(e.created_at)
       FROM public.supplier_po_events e
       WHERE e.supplier_po_id = p.id
         AND e.event_type = 'approved'),
      p.approved_at
    ) AS approved_first
  FROM public.supplier_pos p
  WHERE p.approval_status = 'approved'
     OR EXISTS (
       SELECT 1
       FROM public.supplier_po_events e
       WHERE e.supplier_po_id = p.id
         AND e.event_type = 'approved'
     )
),
numbered AS (
  SELECT
    f.id,
    'PO-'
      || to_char(f.approved_first AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
      || lpad((row_number() OVER (ORDER BY f.approved_first, f.id))::text, 4, '0')
      AS new_number
  FROM first_approval f
)
INSERT INTO supplier_po_renumber_0190 (id, old_number, new_number)
SELECT
  p.id,
  p.po_number,
  CASE
    WHEN n.id IS NOT NULL THEN n.new_number
    -- A never-approved PO: DRAFT- + the sequence digits of its number.
    ELSE 'DRAFT-' || substring(p.po_number FROM '^PO-[0-9]{6}([0-9]{4,})$')
  END
FROM public.supplier_pos p
LEFT JOIN numbered n ON n.id = p.id;

DO $$
DECLARE
  v_bad integer;
BEGIN
  -- A never-approved PO whose number is not 0173's shape has no digits to
  -- keep: stop rather than guess.
  SELECT count(*) INTO v_bad
  FROM supplier_po_renumber_0190
  WHERE new_number IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0190: % never-approved supplier PO number(s) do not match ^PO-[0-9]{10,}$', v_bad;
  END IF;
END;
$$;

-- «اخر تعديل» stays what it was: the renumbering is not a user's change.
ALTER TABLE public.supplier_pos DISABLE TRIGGER supplier_pos_updated_at;

-- Step 1: every row whose number changes moves to a value no other row
-- holds or will hold (the UNIQUE constraint is checked row by row).
UPDATE public.supplier_pos p
SET po_number = 'TMP0190-' || p.id::text
FROM supplier_po_renumber_0190 r
WHERE r.id = p.id
  AND r.new_number IS DISTINCT FROM r.old_number;

-- Step 2: the final numbers (distinct among themselves).
UPDATE public.supplier_pos p
SET po_number = r.new_number
FROM supplier_po_renumber_0190 r
WHERE r.id = p.id
  AND r.new_number IS DISTINCT FROM r.old_number;

ALTER TABLE public.supplier_pos ENABLE TRIGGER supplier_pos_updated_at;

INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
SELECT
  r.id,
  'renumbered',
  jsonb_build_object(
    'old_number', r.old_number,
    'new_number', r.new_number,
    'reason', 'number_at_approval'
  ),
  NULL
FROM supplier_po_renumber_0190 r
WHERE r.new_number IS DISTINCT FROM r.old_number;

DROP TABLE supplier_po_renumber_0190;

-- The official counter continues after the last numbered PO.
UPDATE public.supplier_po_sequence
SET last_seq = (
  SELECT count(*)
  FROM public.supplier_pos p
  WHERE p.po_number ~ '^PO-[0-9]{10,}$'
)
WHERE singleton;

-- The draft counter continues after the greatest reference in use (it
-- already holds the old official sequence, A1).
UPDATE public.supplier_po_draft_sequence
SET last_seq = GREATEST(
  last_seq,
  COALESCE((
    SELECT max(substring(p.po_number FROM 7)::integer)
    FROM public.supplier_pos p
    WHERE p.po_number ~ '^DRAFT-[0-9]{4,}$'
  ), 0)
)
WHERE singleton;

-- ===========================================================================
-- A6. The two shapes, and an approved PO is always numbered
-- ===========================================================================
ALTER TABLE public.supplier_pos
  ADD CONSTRAINT supplier_pos_number_format CHECK (
    po_number ~ '^PO-[0-9]{10,}$'
    OR po_number ~ '^DRAFT-[0-9]{4,}$'
  );

ALTER TABLE public.supplier_pos
  ADD CONSTRAINT supplier_pos_approved_numbered CHECK (
    approval_status <> 'approved'
    OR po_number ~ '^PO-[0-9]{10,}$'
  );

COMMENT ON COLUMN public.supplier_pos.po_number IS
  '0173/0190: the OFFICIAL number PO- + the Saudi year and month of the PO''s FIRST approval (YYYYMM) + a global sequence of at least four digits that never restarts (PO-2026110001), issued by the first approval; until then a DRAFT REFERENCE DRAFT-#### (next_supplier_po_draft_ref). A PO returned to draft keeps its official number. Unique. 0190 renumbered every PO: the ones approved at least once in the order of their first approval, the others DRAFT- + their old sequence digits, each with a `renumbered` event {old_number, new_number, reason: number_at_approval}.';

COMMENT ON TABLE public.supplier_po_events IS
  '0136: append-only audit of a supplier PO (created, updated, equipment_added, price_changed, line_updated, card_changed, equipment_removed, approved, closed, reopened; 0173: renumbered {old_number, new_number}, written by a migration with no actor — 0190 adds reason: number_at_approval; 0174/0189: approval_returned; 0190: approved carries po_number and, when the approval issued the official number, draft_ref). Read by purchasing.view; written only by the purchasing functions; no update or delete path.';

-- ===========================================================================
-- A7. The guard
-- ===========================================================================
DO $$
DECLARE
  v_bad integer;
  v_count integer;
  v_distinct integer;
  v_min integer;
  v_max integer;
  v_seq integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.supplier_pos
  WHERE approval_status = 'approved'
    AND po_number !~ '^PO-[0-9]{10,}$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0190: % approved supplier PO(s) without an official number', v_bad;
  END IF;

  SELECT
    count(*),
    count(DISTINCT d.seq),
    min(d.seq),
    max(d.seq)
  INTO v_count, v_distinct, v_min, v_max
  FROM (
    SELECT substring(p.po_number FROM '^PO-[0-9]{6}([0-9]{4,})$')::integer AS seq
    FROM public.supplier_pos p
    WHERE p.po_number ~ '^PO-[0-9]{10,}$'
  ) d;
  SELECT last_seq INTO v_seq FROM public.supplier_po_sequence WHERE singleton;
  IF v_seq IS DISTINCT FROM v_count
     OR v_distinct IS DISTINCT FROM v_count
     OR (v_count > 0 AND (v_min IS DISTINCT FROM 1 OR v_max IS DISTINCT FROM v_count)) THEN
    RAISE EXCEPTION '0190: the official numbers are not exactly 1..% (count %, distinct %, min %, max %)',
      v_seq, v_count, v_distinct, v_min, v_max;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.supplier_pos p
  WHERE p.po_number ~ '^PO-'
    AND p.approval_status <> 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_po_events e
      WHERE e.supplier_po_id = p.id
        AND e.event_type = 'approved'
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0190: % never-approved supplier PO(s) still hold an official number', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.supplier_pos
  WHERE po_number !~ '^PO-[0-9]{10,}$'
    AND po_number !~ '^DRAFT-[0-9]{4,}$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0190: % supplier PO number(s) match neither PO-… nor DRAFT-…', v_bad;
  END IF;
END;
$$;

-- ===========================================================================
-- B1. The client-reference counter (the same pattern)
-- ===========================================================================
CREATE TABLE public.client_po_ref_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT client_po_ref_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT client_po_ref_sequence_last_seq_check CHECK (last_seq >= 0)
);

COMMENT ON TABLE public.client_po_ref_sequence IS
  '0190: the ONE row holding the last consumed internal reference of a client PO created without the client''s number (CPO-####, never restarts). Read and written only by next_client_po_ref(); no client access.';

ALTER TABLE public.client_po_ref_sequence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_po_ref_sequence FROM PUBLIC, anon, authenticated;

INSERT INTO public.client_po_ref_sequence (singleton, last_seq) VALUES (true, 0);

CREATE OR REPLACE FUNCTION public.next_client_po_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  -- The one row, locked by the UPDATE itself: concurrent creations queue
  -- here and each takes its own reference.
  UPDATE public.client_po_ref_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'client_po_ref_sequence_missing' USING ERRCODE = '55000';
  END IF;
  RETURN 'CPO-' || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_client_po_ref() IS
  '0190: consumes and returns the next internal reference of a client PO, CPO- + a sequence of at least four digits that never restarts (CPO-0001). Called only by create_client_po when the client''s number is left blank.';

REVOKE ALL ON FUNCTION public.next_client_po_ref()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- B2. create_client_po: 0169 verbatim, a blank number takes a reference
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.create_client_po(
  p_company_id uuid,
  p_project_id uuid,
  p_po_number text,
  p_issue_date date,
  p_expiry_date date DEFAULT NULL,
  p_standard_hours integer DEFAULT 260,
  p_notes text DEFAULT NULL,
  p_equipment jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_standard_hours integer;
  v_notes text;
  v_item jsonb;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;
  -- The client's own number: trimmed, at most 60 characters. 0190: it is
  -- optional; a blank one takes an internal reference below.
  v_number := NULLIF(btrim(p_po_number), '');
  IF v_number IS NOT NULL AND char_length(v_number) > 60 THEN
    RAISE EXCEPTION 'invalid_po_number' USING ERRCODE = '22023';
  END IF;
  IF v_number IS NOT NULL THEN
    -- Unique per client company, compared as upper(btrim()).
    IF EXISTS (
      SELECT 1 FROM public.client_pos p
      WHERE p.company_id = p_company_id
        AND upper(btrim(p.po_number)) = upper(v_number)
    ) THEN
      RAISE EXCEPTION 'duplicate_po_number'
        USING ERRCODE = '23505',
              HINT = 'This client already has a PO with this number.';
    END IF;
  ELSE
    -- 0190: the next internal reference CPO-#### that this client does not
    -- already use (a client may have typed one as its own number).
    LOOP
      v_number := public.next_client_po_ref();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.client_pos p
        WHERE p.company_id = p_company_id
          AND upper(btrim(p.po_number)) = upper(v_number)
      );
    END LOOP;
  END IF;
  IF p_issue_date IS NULL THEN
    RAISE EXCEPTION 'invalid_issue_date' USING ERRCODE = '22023';
  END IF;
  IF p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN
    RAISE EXCEPTION 'invalid_expiry_date' USING ERRCODE = '22023';
  END IF;
  v_standard_hours := COALESCE(p_standard_hours, 260);
  IF v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;
  IF p_equipment IS NOT NULL AND jsonb_typeof(p_equipment) <> 'array' THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.client_pos (
      company_id, project_id, po_number, issue_date, expiry_date, standard_hours,
      notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_number, p_issue_date, p_expiry_date, v_standard_hours,
      v_notes, auth.uid()
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent creation with the same number for the same client.
      RAISE EXCEPTION 'duplicate_po_number'
        USING ERRCODE = '23505',
              HINT = 'This client already has a PO with this number.';
  END;

  PERFORM public.record_client_po_event(
    v_id, 'created',
    jsonb_build_object(
      'po_number', v_number,
      'company_id', p_company_id,
      'project_id', p_project_id,
      'issue_date', p_issue_date,
      'expiry_date', p_expiry_date,
      'standard_hours', v_standard_hours
    )
  );

  -- The equipment, in the same transaction: every line passes the rules of
  -- add_client_po_equipment or the whole call is rolled back. Each item:
  -- {"equipment_id": uuid, "price": number|null, "rate_unit":
  -- "month"|"day"|"hour"|null, "standard_hours": integer|null, "quantity":
  -- number|null, "note": text|null}.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_client_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      NULLIF(v_item->>'rate_unit', ''),
      NULLIF(v_item->>'standard_hours', '')::integer,
      NULLIF(v_item->>'quantity', '')::numeric,
      v_item->>'note'
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb) IS
  '0169/0190: creates an open client PO for one company and project under the client''s own number (trimmed, at most 60 characters: invalid_po_number; unique per company: duplicate_po_number) — 0190: the number is optional, a blank one stores the next internal reference CPO-#### (next_client_po_ref) that the company does not already use —, with its issue date, optional expiry date (invalid_expiry_date when before the issue date), default standard hours (260) and notes, and, in the same transaction, its lines (p_equipment: [{equipment_id, price|null, rate_unit, standard_hours|null, quantity|null, note}]) through add_client_po_equipment, so a unit not inside the project rolls the whole call back. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb)
  TO authenticated;

COMMENT ON COLUMN public.client_pos.po_number IS
  '0169/0190: the client''s own PO number (trimmed, at most 60 characters, unique per company as upper(btrim(po_number))), or, when it was left blank at creation (0190), an internal reference CPO-#### from next_client_po_ref().';
