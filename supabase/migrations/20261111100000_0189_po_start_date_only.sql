-- 0189: a supplier PO is its START DATE only, and a card is a visit (owner
-- decisions 2026-11-10 / 2026-11-11: «خلينا نشيل القيد هذا بحيث يسمح بانشاء
-- po مورد للمعدة حتى لو المعدة لها po مفتوح», «خلنا نلغي اغلاق الامر, ومفتوح
-- او مغلق شيلها, يصير نحط تاريخ بداية للPO المورد فقط, وحتى المعدة نشيل منها
-- البداية والنهاية ومفتوح, ويصير التاريخ يكون في الPO كتاريخ البداية»,
-- «وبرضه الكرت حاليا الغي القيد حق المعدة لها كرت مفتوح»; plan approved
-- «اعتمد ونفذ»).
--
-- What goes:
--   * supplier_pos.status / closed_at (open | closed) with their CHECKs and
--     the index supplier_pos_status_start_idx; close_supplier_po(uuid). The
--     one PO closed in production becomes an ordinary PO; its «closed» event
--     stays in supplier_po_events as history (the event CHECK keeps the
--     type).
--   * The 0136 trigger supplier_po_equipment_single_open and its function
--     enforce_supplier_po_equipment_single_open (a card on at most one OPEN
--     supplier PO): a unit may now sit on several supplier POs. What stays
--     is supplier_po_equipment_unique (the same card once per PO), raised as
--     equipment_already_on_po (was equipment_already_on_open_po).
--   * equipment_cards.period_from / period_to with equipment_cards_period_check
--     and the EXCLUDE constraint equipment_cards_no_overlap (two cards of a
--     unit never overlapped; token card_overlap): a card has no period and
--     is neither open nor ended. end_equipment_card, reopen_equipment_card
--     and the view sales_cards_awaiting_end (0185) are dropped; the events
--     card_ended / card_reopened stay in equipment_card_events as history.
--
-- What a card is now: the unit's VISIT in a company and project — one card
-- per site entry (entry_log_id, set since 0137; every card in production
-- carries one). add_supplier_po_equipment and add_client_po_equipment take
-- the card linked to the visit's entry, else create one linked to it. The
-- visit's dates come from the movements (entry_at, and the exit that closes
-- it); the DATE of the supplier side is the PO's start_date, which is the
-- entry's Saudi day (0148, kept).
--
-- A. Dropped first (they read the columns): the eight views below, the
--    trigger, the four functions.
-- B. The tables: the columns and constraints above; new indexes
--    supplier_pos_start_date_idx (start_date DESC, id DESC) and
--    equipment_cards_equipment_idx (equipment_id, created_at DESC) in place
--    of the two that carried a dropped column.
-- C. Functions re-created, each the production body VERBATIM except the
--    lines about the status or the period:
--      add_supplier_po_equipment        no po_closed; the card by the entry;
--                                       no card_overlap; equipment_already_on_po
--      update_supplier_po               no po_closed; the start-date lock
--                                       reads each line's card entry
--      update_supplier_po_equipment     no po_closed
--      update_supplier_po_equipment_price  no po_closed
--      remove_supplier_po_equipment     no po_closed
--      approve_supplier_po              no po_closed
--      approve_equipment_card_pricing   the line of the card's LATEST supplier
--                                       PO (was: the open PO's first); no
--                                       closed-PO refusal
--      return_equipment_card_pricing    the latest PO; an approved one goes
--                                       back to draft
--      record_equipment_card_month      month_outside_card by the card's
--                                       VISIT (entry month → exit month)
--      add_client_po_equipment          the card by the entry; no card_overlap
--    New: return_supplier_po_approval(p_po_id, p_note) — purchasing.approve;
--    an APPROVED PO back to draft (po_not_approved), event approval_returned
--    {via: manual, note, approved_at, approved_by}. It replaces «close it
--    and create a new one» as the way to change an approved PO; the lock
--    hints say so. The pricing of the PO's cards is not touched.
--    create_supplier_po is not re-created (it never read the status); its
--    comment is refreshed.
-- D. Views re-created (security_invoker, the same grants):
--      sales_equipment_cards    without period_from / period_to / is_open /
--                               supplier_po_status; exit_at and
--                               supplier_po_start_date added; the supplier
--                               side = the card's latest PO;
--                               has_supplier_po = any supplier line
--      sales_card_months        entry_at / exit_at instead of the period
--      sales_card_month_slots   the months of the card's visit
--      purchasing_po_units      without po_status and the card period;
--                               equipment_card_id added
--      sales_po_units           without the card period and
--                               supplier_po_status
--      purchasing_site_visits   the visit's supplier PO: through the visit's
--      purchasing_site_units    own card, else a PO of that company and
--                               project that started on or before the
--                               visit's entry day. Checked read-only against
--                               production on 2026-11-11: of 813 site visits
--                               811 keep their PO or their «بدون PO», 2
--                               closed visits gain one (the formerly closed
--                               PO; a PO whose card period had not covered
--                               the visit), none loses one.
--    The client PO keeps its open / closed state everywhere.
--
-- Stable error tokens: gone — po_closed, card_overlap,
-- equipment_already_on_open_po, card_already_ended, card_not_ended,
-- card_has_later_months, invalid_period_to. New — equipment_already_on_po
-- (23505), po_not_approved (55000). Unchanged — everything else.
--
-- No new permission key. Every function: SECURITY DEFINER, SET search_path =
-- public, pg_temp, REVOKE ALL FROM PUBLIC, anon, GRANT EXECUTE TO
-- authenticated, a COMMENT.
--
-- Rollout: apply 0189 AFTER the screens of this commit are deployed. The
-- screens that are live before it select status, closed_at, period_from and
-- period_to and would fail once the columns are gone; the new screens read
-- none of them and no column this migration adds, so they work on both
-- sides of it. Until it is applied the only thing that does not work is the
-- new «رجوع للتعديل» of a supplier PO (the function arrives here).

-- ===========================================================================
-- A. What reads the dropped columns goes first
-- ===========================================================================
DROP VIEW public.sales_cards_awaiting_end;
DROP VIEW public.sales_card_month_slots;
DROP VIEW public.sales_card_months;
DROP VIEW public.sales_equipment_cards;
DROP VIEW public.sales_po_units;
DROP VIEW public.purchasing_po_units;
DROP VIEW public.purchasing_site_visits;
DROP VIEW public.purchasing_site_units;

DROP TRIGGER supplier_po_equipment_single_open ON public.supplier_po_equipment;
DROP FUNCTION public.enforce_supplier_po_equipment_single_open();
DROP FUNCTION public.close_supplier_po(uuid);
DROP FUNCTION public.end_equipment_card(uuid, date, text);
DROP FUNCTION public.reopen_equipment_card(uuid, text);

-- ===========================================================================
-- B. The tables
-- ===========================================================================
ALTER TABLE public.supplier_pos
  DROP CONSTRAINT supplier_pos_closed_at_check,
  DROP CONSTRAINT supplier_pos_status_check,
  DROP COLUMN status,
  DROP COLUMN closed_at;

-- The list's default order and the date filter (supplier_pos_status_start_idx
-- went with the status column).
CREATE INDEX supplier_pos_start_date_idx
  ON public.supplier_pos (start_date DESC, id DESC);

COMMENT ON TABLE public.supplier_pos IS
  '0136/0189 supplier purchase orders: a party (a lessor OR an owner class), a company and project, a START DATE (the Saudi entry day of its units, 0148) and an approval state (draft / approved, 0160). Since 0189 a PO has no open / closed state and is never closed; an approved PO is changed after return_supplier_po_approval. Written only through the purchasing functions; read by purchasing.view.';

ALTER TABLE public.equipment_cards
  DROP CONSTRAINT equipment_cards_no_overlap,
  DROP CONSTRAINT equipment_cards_period_check,
  DROP COLUMN period_from,
  DROP COLUMN period_to;

-- The cards of a unit, newest first (equipment_cards_equipment_idx carried
-- period_from and went with it).
CREATE INDEX equipment_cards_equipment_idx
  ON public.equipment_cards (equipment_id, created_at DESC);

COMMENT ON TABLE public.equipment_cards IS
  '0136/0189 «كرت المعدة»: one unit in one company and project for one VISIT (entry_log_id: the site entry it was created from). Since 0189 a card has no period and is neither open nor ended — the visit''s dates are the movements'' (the entry and the exit that closes it) and the date of the supplier side is the PO''s start date — and the cards of a unit are not checked against each other. The shared document the supplier PO lines, the client PO lines, the client price and its approval and the month records link to; created only by add_supplier_po_equipment / add_client_po_equipment. Read by purchasing.view or sales.view; no direct write path.';

COMMENT ON COLUMN public.equipment_cards.entry_log_id IS
  '0137/0189: the site ENTRY (entry_exit_logs) the card was created from — the card''s visit. The add functions find a visit''s card by it. SET NULL when the movement is deleted.';

-- ===========================================================================
-- C. Functions
-- ===========================================================================
-- C1. add_supplier_po_equipment
CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment(
  p_po_id uuid,
  p_equipment_id uuid,
  p_price numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rate_unit text DEFAULT 'month'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_unit public.equipment%ROWTYPE;
  v_card_id uuid;
  v_card_created boolean := false;
  v_line_id uuid;
  v_last public.entry_exit_logs%ROWTYPE;
  v_entry public.entry_exit_logs%ROWTYPE;
  v_rate_unit text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  -- 0160: an approved PO is locked (owner 2026-10-28). 0189: it is returned
  -- to draft to change it (there is no closing any more).
  IF v_po.approval_status = 'approved' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;

  IF p_equipment_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM public.equipment e WHERE e.id = p_equipment_id;
  END IF;
  IF p_equipment_id IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  -- 0138: the price is optional («تحتاج سعر» while NULL); when given it is
  -- numeric(12, 2) >= 0. No owner-based rule (owner 2026-10-20).
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  -- 0157: the price is per month or per day; nothing given = month.
  -- 0185: month, week, day or hour.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month');
  IF v_rate_unit NOT IN ('month', 'week', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;
  -- 0138: the unit belongs to the PO's party: the PO's lessor, or the PO's
  -- owner class.
  IF NOT (
    (v_po.lessor_id IS NOT NULL AND v_unit.lessor_id = v_po.lessor_id)
    OR (v_po.owner_class IS NOT NULL AND v_unit.ownership_status = v_po.owner_class)
  ) THEN
    RAISE EXCEPTION 'equipment_not_of_po_supplier'
      USING ERRCODE = '55000',
            HINT = 'The equipment does not belong to the PO''s supplier or owner class.';
  END IF;

  -- The unit's advisory key (the one every movement function takes), so two
  -- concurrent calls never create two cards for one unit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));

  -- 0188 (owner 2026-11-09): the unit joins through a SITE VISIT of the
  -- PO's company and project, open or closed, whose entry's Saudi day is the
  -- PO start date (0148) — a unit that entered and left within a day can be
  -- put on a PO. Was (0137): the latest movement is an open site entry
  -- there. The open visit is preferred (the entry that is the unit's latest
  -- movement, in the chain's own order), else the latest closed one. The
  -- key above is the sequence trigger's, so a movement being recorded at the
  -- same moment is serialised against these reads.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  SELECT l.* INTO v_entry
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
    AND l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND l.company_id = v_po.company_id
    AND l.project_id = v_po.project_id
    AND (l.recorded_at AT TIME ZONE 'Asia/Riyadh')::date = v_po.start_date
  ORDER BY (l.id IS NOT DISTINCT FROM v_last.id) DESC, l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    -- 0148 kept: the unit did visit the PO's company and project, but on
    -- another day than the PO start date.
    IF EXISTS (
      SELECT 1
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = p_equipment_id
        AND l.movement_type = 'entry'
        AND l.movement_context = 'site'
        AND l.company_id = v_po.company_id
        AND l.project_id = v_po.project_id
    ) THEN
      RAISE EXCEPTION 'entry_date_mismatch'
        USING ERRCODE = '55000',
              HINT = 'The equipment entered the project on a day other than the PO start date.';
    END IF;
    RAISE EXCEPTION 'equipment_not_at_po_project'
      USING ERRCODE = '55000',
            HINT = 'The equipment has no visit in the PO''s company and project on the PO start date.';
  END IF;
  -- 0189 (owner 2026-11-11): the card is the unit's VISIT in the PO's
  -- company and project — the card created from this very entry, else a new
  -- card linked to it. A card has no period any more (the date is the PO's
  -- start date, which is this entry's Saudi day: 0148), so there is no
  -- overlap rule and the unit's other cards and POs do not matter.
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.entry_log_id = v_entry.id
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_card_id IS NULL THEN
    INSERT INTO public.equipment_cards (
      equipment_id, company_id, project_id, created_by, entry_log_id
    ) VALUES (
      p_equipment_id, v_po.company_id, v_po.project_id, auth.uid(), v_entry.id
    )
    RETURNING id INTO v_card_id;
    v_card_created := true;
  END IF;

  BEGIN
    INSERT INTO public.supplier_po_equipment (
      supplier_po_id, equipment_card_id, price, note, rate_unit
    ) VALUES (
      v_po.id, v_card_id, p_price, NULLIF(btrim(p_note), ''), v_rate_unit
    )
    RETURNING id INTO v_line_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- The one rule left (0189): a card is on a PO once. The 0136 «one open
      -- PO per card» trigger is gone, so the unit may sit on other POs.
      RAISE EXCEPTION 'equipment_already_on_po'
        USING ERRCODE = '23505',
              HINT = 'This equipment is already on this PO.';
  END;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_po.id, 'equipment_added',
    jsonb_build_object(
      'line_id', v_line_id,
      'equipment_id', p_equipment_id,
      'equipment_card_id', v_card_id,
      'card_created', v_card_created,
      'price', p_price,
      'rate_unit', v_rate_unit,
      'entry_log_id', v_entry.id
    ),
    auth.uid()
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text) IS
  '0136/0137/0138/0148/0157/0160/0185/0188/0189: adds a unit of the PO''s party to a DRAFT supplier PO (an approved PO is locked: po_approved_locked), with or without a price (excluding VAT) per month, week, day or hour (p_rate_unit, default month; invalid_rate_unit), through a site visit of the unit in the PO''s company and project, open or closed (0188), whose entry''s Saudi day is the PO start date (the open visit first, else the latest closed one; no visit there at all: equipment_not_at_po_project; visits there on other days only: entry_date_mismatch). 0189: the card is that visit''s (the card linked to the entry, else a new one linked to it; no period, no overlap rule) and the unit may already sit on other POs — only the same card twice on this PO is refused (equipment_already_on_po). Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  TO authenticated;

-- C2. update_supplier_po
CREATE OR REPLACE FUNCTION public.update_supplier_po(
  p_po_id uuid,
  p_start_date date,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_notes text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'invalid_start_date' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  -- 0160: an approved PO is locked (owner 2026-10-28) — its notes stay
  -- editable, its start date does not.
  IF v_po.approval_status = 'approved' AND p_start_date <> v_po.start_date THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;

  -- 0148: while the PO has lines, its start date is their entry day (Saudi
  -- time): a new start date must be the entry day of every current line.
  -- A PO without lines keeps a free start date; an unchanged one is not
  -- checked, so the notes stay editable on the pre-0148 mixed POs.
  IF p_start_date <> v_po.start_date AND EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment l
    JOIN public.equipment_cards c ON c.id = l.equipment_card_id
    -- 0189: a line's entry is its card's entry (the card has no period to
    -- fall back on; a card whose entry row is gone does not lock the date).
    JOIN public.entry_exit_logs el ON el.id = c.entry_log_id
    WHERE l.supplier_po_id = p_po_id
      AND (el.recorded_at AT TIME ZONE 'Asia/Riyadh')::date <> p_start_date
  ) THEN
    RAISE EXCEPTION 'po_start_date_locked'
      USING ERRCODE = '55000',
            HINT = 'The PO start date is the entry day of its equipment while it has lines.';
  END IF;

  IF p_start_date = v_po.start_date
     AND v_notes IS NOT DISTINCT FROM v_po.notes THEN
    RETURN;
  END IF;

  UPDATE public.supplier_pos
  SET start_date = p_start_date,
      notes = v_notes
  WHERE id = p_po_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    p_po_id, 'updated',
    jsonb_build_object(
      'old_start_date', v_po.start_date,
      'new_start_date', p_start_date,
      'old_notes', v_po.notes,
      'new_notes', v_notes
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.update_supplier_po(uuid, date, text) IS
  '0142/0148/0160/0189: changes the start date and the notes of a supplier PO and records old and new (event updated). While the PO has lines a new start date must be their entry day (po_start_date_locked; the entry of each line is its card''s entry); on an APPROVED PO only the notes change (po_approved_locked). The party, company and project never change. A PO has no open / closed state any more (0189). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po(uuid, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po(uuid, date, text)
  TO authenticated;

-- C3. update_supplier_po_equipment
CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment(
  p_line_id uuid,
  p_price numeric,
  p_note text DEFAULT NULL,
  p_rate_unit text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.supplier_po_equipment%ROWTYPE;
  v_equipment_id uuid;
  v_note text;
  v_price_changed boolean;
  v_rate_unit text;
  v_approval text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_line
  FROM public.supplier_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.approval_status INTO v_approval
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  -- 0160: an approved PO is locked (owner 2026-10-28).
  IF v_approval = 'approved' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;

  -- NULL = «تحتاج تسعير» (0138: prices are optional).
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;
  -- 0157: the unit, month or day; nothing given keeps the line's own.
  -- 0185: month, week, day or hour.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit);
  IF v_rate_unit NOT IN ('month', 'week', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;

  v_price_changed := p_price IS DISTINCT FROM v_line.price;
  IF NOT v_price_changed
     AND v_note IS NOT DISTINCT FROM v_line.note
     AND v_rate_unit = v_line.rate_unit THEN
    RETURN;
  END IF;

  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;

  UPDATE public.supplier_po_equipment
  SET price = p_price,
      note = v_note,
      rate_unit = v_rate_unit
  WHERE id = v_line.id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_line.supplier_po_id,
    CASE WHEN v_price_changed THEN 'price_changed' ELSE 'line_updated' END,
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_equipment_id,
      'old_price', v_line.price,
      'new_price', p_price,
      'old_note', v_line.note,
      'new_note', v_note,
      'old_rate_unit', v_line.rate_unit,
      'new_rate_unit', v_rate_unit
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text) IS
  '0142/0157/0160/0185/0189: sets the price (NULL = unpriced), the note and the price unit (p_rate_unit month|week|day|hour, NULL = unchanged; invalid_rate_unit) of a line of a DRAFT supplier PO in one call (an approved PO is locked: po_approved_locked); a price change is the event price_changed, a note- or unit-only change is line_updated. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  TO authenticated;

-- C4. update_supplier_po_equipment_price
CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment_price(
  p_line_id uuid,
  p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.supplier_po_equipment%ROWTYPE;
  v_equipment_id uuid;
  v_approval text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_line
  FROM public.supplier_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.approval_status INTO v_approval
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  -- 0160: an approved PO is locked (owner 2026-10-28).
  IF v_approval = 'approved' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;

  IF p_price IS NULL OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;

  IF p_price = v_line.price THEN
    RETURN;
  END IF;

  UPDATE public.supplier_po_equipment
  SET price = p_price
  WHERE id = v_line.id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_line.supplier_po_id, 'price_changed',
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_equipment_id,
      'old_price', v_line.price,
      'new_price', p_price
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric) IS
  '0136/0138/0160/0189: sets the price of a line of a DRAFT supplier PO (an approved PO is locked: po_approved_locked) (also the first price of an unpriced line) and records old and new. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  TO authenticated;

-- C5. remove_supplier_po_equipment
CREATE OR REPLACE FUNCTION public.remove_supplier_po_equipment(
  p_line_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.supplier_po_equipment%ROWTYPE;
  v_po public.supplier_pos%ROWTYPE;
  v_card public.equipment_cards%ROWTYPE;
  v_equipment_id uuid;
  v_code text;
  v_note text;
  v_card_deleted boolean := false;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_line
  FROM public.supplier_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF p_line_id IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  IF v_po.approval_status <> 'draft' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_equipment_id::text, 0));

  SELECT * INTO v_card
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id
  FOR UPDATE;

  SELECT e.code INTO v_code
  FROM public.equipment e
  WHERE e.id = v_card.equipment_id;

  DELETE FROM public.supplier_po_equipment WHERE id = v_line.id;

  IF v_card.pricing_status = 'draft'
     AND v_card.client_price IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.supplier_po_equipment l
       WHERE l.equipment_card_id = v_card.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.client_po_equipment l
       WHERE l.equipment_card_id = v_card.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.equipment_card_months m
       WHERE m.equipment_card_id = v_card.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.equipment_card_events ev
       WHERE ev.equipment_card_id = v_card.id
     ) THEN
    DELETE FROM public.equipment_cards WHERE id = v_card.id;
    v_card_deleted := true;
  END IF;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_po.id, 'equipment_removed',
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_card.equipment_id,
      'equipment_code', v_code,
      'card_id', v_card.id,
      'price', v_line.price,
      'rate_unit', v_line.rate_unit,
      'line_note', v_line.note,
      'note', v_note,
      'card_kept', NOT v_card_deleted
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'line_id', v_line.id,
    'card_id', v_card.id,
    'card_deleted', v_card_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.remove_supplier_po_equipment(uuid, text) IS
  '0187/0189: removes a line from a DRAFT supplier PO (po_approved_locked; invalid_line, invalid_note > 500) and records equipment_removed {line_id, equipment_id, equipment_code, card_id, price, rate_unit, line_note, note, card_kept}. The card is deleted too when nothing else uses it (no supplier or client PO line, no month record, no card event, draft pricing, no client price), else kept. Returns {line_id, card_id, card_deleted}. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.remove_supplier_po_equipment(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_supplier_po_equipment(uuid, text)
  TO authenticated;

-- C6. approve_supplier_po
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

  UPDATE public.supplier_pos
  SET approval_status = 'approved',
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = p_po_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    p_po_id, 'approved',
    jsonb_build_object('line_count', v_lines),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.approve_supplier_po(uuid) IS
  '0160/0189: approves a DRAFT supplier PO — needs purchasing.approve, never by its creator, only with at least one line and every line priced — recording approved_at / approved_by and the event approved. An approved PO is locked until return_supplier_po_approval. Tokens purchasing_approve_required, invalid_po, po_not_draft, po_self_approval, po_has_no_lines, po_has_unpriced_lines.';

REVOKE ALL ON FUNCTION public.approve_supplier_po(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_supplier_po(uuid)
  TO authenticated;

-- C7. return_supplier_po_approval (new)
CREATE FUNCTION public.return_supplier_po_approval(
  p_po_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_note text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('purchasing.approve') THEN
    RAISE EXCEPTION 'purchasing_approve_required'
      USING ERRCODE = '42501',
            HINT = 'Returning a supplier purchase order to draft needs the purchasing.approve permission.';
  END IF;

  -- The PO row lock: every write to the PO and its lines takes it too.
  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'po_not_approved'
      USING ERRCODE = '55000',
            HINT = 'Only an approved PO is returned to draft.';
  END IF;

  -- The note: trimmed, blank = none, at most 500 characters.
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  UPDATE public.supplier_pos
  SET approval_status = 'draft',
      approved_at = NULL,
      approved_by = NULL
  WHERE id = p_po_id;

  -- The 0174 event, with via = manual (the card-pricing return writes
  -- via = card_pricing and its card_id).
  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    p_po_id, 'approval_returned',
    jsonb_build_object(
      'via', 'manual',
      'note', v_note,
      'approved_at', v_po.approved_at,
      'approved_by', v_po.approved_by
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.return_supplier_po_approval(uuid, text) IS
  '0189 «رجوع للتعديل»: puts an APPROVED supplier PO back into draft (po_not_approved otherwise; invalid_po), clearing approved_at / approved_by and recording the event approval_returned {via: manual, note, approved_at, approved_by} with the optional note (trimmed, at most 500 characters: invalid_note), so the PO and its lines are editable again — the way to change an approved PO now that a PO is never closed. The pricing of its cards is not touched. Needs purchasing.approve (purchasing_approve_required).';

REVOKE ALL ON FUNCTION public.return_supplier_po_approval(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_supplier_po_approval(uuid, text)
  TO authenticated;

-- C8. approve_equipment_card_pricing
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

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'pricing_approved',
    jsonb_build_object(
      'client_price', v_card.client_price,
      'client_price_unit', v_card.client_price_unit,
      'supplier_price', v_line.price,
      'supplier_rate_unit', v_line.rate_unit,
      'supplier_po_id', v_po.id,
      'supplier_po_number', v_po.po_number,
      'supplier_po_approved', v_po_approved
    )
  );

  IF v_po_approved THEN
    UPDATE public.supplier_pos
    SET approval_status = 'approved',
        approved_at = now(),
        approved_by = auth.uid()
    WHERE id = v_po.id;

    -- The 0160 event shape (actor_id; the PO page resolves the name).
    INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
    VALUES (
      v_po.id, 'approved',
      jsonb_build_object(
        'via', 'card_pricing',
        'card_id', p_card_id,
        'line_count', v_line_count
      ),
      auth.uid()
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.approve_equipment_card_pricing(uuid) IS
  '0174/0185/0189: approves the pricing of one equipment card — needs sales.approve, a DRAFT card (card_pricing_not_draft) with a client price (card_pricing_no_client_price) and a priced supplier line (card_pricing_no_supplier_line when the card sits on no supplier PO, card_pricing_no_supplier_price; 0 counts), the line of the card''s LATEST supplier PO (0189) — recording pricing_approved_at / _by and the event pricing_approved (0185: with client_price_unit; the units need not match). Then, when every line of that supplier PO sits on an approved card and the PO is a draft, the PO itself becomes approved (0160 state, event approved {via: card_pricing}) without approve_supplier_po''s checks (owner 2026-11-04).';

REVOKE ALL ON FUNCTION public.approve_equipment_card_pricing(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_card_pricing(uuid)
  TO authenticated;

-- C9. return_equipment_card_pricing
CREATE OR REPLACE FUNCTION public.return_equipment_card_pricing(
  p_card_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.equipment_cards%ROWTYPE;
  v_note text;
  v_po public.supplier_pos%ROWTYPE;
  v_po_found boolean := false;
  v_po_returned boolean := false;
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
  IF v_card.pricing_status <> 'approved' THEN
    RAISE EXCEPTION 'card_pricing_not_approved'
      USING ERRCODE = '55000',
            HINT = 'Only an approved pricing is returned for editing.';
  END IF;

  -- The note (ready for the owner's later reasons): trimmed, blank = none,
  -- at most 500 characters.
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  UPDATE public.equipment_cards
  SET pricing_status = 'draft',
      pricing_approved_at = NULL,
      pricing_approved_by = NULL
  WHERE id = p_card_id;

  -- The card's supplier PO (its LATEST one, as the view; 0189: no open /
  -- closed state): an approved PO goes back into draft, so the PO and its
  -- lines are editable again (0160's lock reads approval_status).
  SELECT sp.* INTO v_po
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = p_card_id
  ORDER BY sp.created_at DESC, sp.id DESC
  LIMIT 1
  FOR UPDATE OF sp;
  v_po_found := FOUND;
  IF v_po_found AND v_po.approval_status = 'approved' THEN
    v_po_returned := true;
  END IF;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'pricing_returned',
    jsonb_build_object(
      'note', v_note,
      'client_price', v_card.client_price,
      'supplier_po_id', CASE WHEN v_po_found THEN v_po.id END,
      'supplier_po_returned', v_po_returned
    )
  );

  IF v_po_returned THEN
    UPDATE public.supplier_pos
    SET approval_status = 'draft',
        approved_at = NULL,
        approved_by = NULL
    WHERE id = v_po.id;

    INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
    VALUES (
      v_po.id, 'approval_returned',
      jsonb_build_object(
        'via', 'card_pricing',
        'card_id', p_card_id,
        'note', v_note,
        'approved_at', v_po.approved_at,
        'approved_by', v_po.approved_by
      ),
      auth.uid()
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.return_equipment_card_pricing(uuid, text) IS
  '0174/0189 «رجوع للتعديل»: puts an APPROVED card pricing back into draft (card_pricing_not_approved otherwise), clearing pricing_approved_at / _by and recording the event pricing_returned with the optional note (trimmed, at most 500 characters: invalid_note). When the card''s latest supplier PO is approved it goes back into draft too (approved_at / _by cleared, event approval_returned {via: card_pricing, card_id, note}), so the PO and its lines are editable again. Needs sales.approve.';

REVOKE ALL ON FUNCTION public.return_equipment_card_pricing(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_equipment_card_pricing(uuid, text)
  TO authenticated;

-- C10. record_equipment_card_month
CREATE OR REPLACE FUNCTION public.record_equipment_card_month(
  p_card_id uuid,
  p_month date,
  p_hours numeric,
  p_note text DEFAULT NULL,
  p_days numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date;
  v_entry_log_id uuid;
  v_card_created_at timestamptz;
  v_entry public.entry_exit_logs%ROWTYPE;
  v_next_type text;
  v_next_at timestamptz;
  v_month_from date;
  v_month_to date;
  v_current_month date;
  v_hours numeric(8, 2);
  v_days numeric(5, 2);
  v_note text;
  v_id uuid;
  v_old_hours numeric(8, 2);
  v_old_days numeric(5, 2);
  v_old_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  -- Any day of the month names the month; stored as its first day.
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;
  v_month := date_trunc('month', p_month::timestamp)::date;

  -- The card, locked first: two writers of the same card queue here, so the
  -- read-then-insert below never races (the UNIQUE constraint is the backstop).
  SELECT c.entry_log_id, c.created_at INTO v_entry_log_id, v_card_created_at
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- 0189: the card has no period of its own any more. Its months are those
  -- of its VISIT, month to month in Saudi time: from the month the unit
  -- entered (the card's entry; the month the card was created when the
  -- entry row is gone) to the month it left — the exit that closes the
  -- entry, the unit's next movement in the entry's context by
  -- (recorded_at, id). Still inside: no upper bound but the current month
  -- below. A unit that left still takes its past months (the timesheet
  -- arrives late).
  SELECT l.* INTO v_entry
  FROM public.entry_exit_logs l
  WHERE l.id = v_entry_log_id;
  IF FOUND THEN
    v_month_from := date_trunc('month', v_entry.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;
    SELECT n.movement_type, n.recorded_at INTO v_next_type, v_next_at
    FROM public.entry_exit_logs n
    WHERE n.equipment_id = v_entry.equipment_id
      AND n.movement_context = v_entry.movement_context
      AND (n.recorded_at, n.id) > (v_entry.recorded_at, v_entry.id)
    ORDER BY n.recorded_at, n.id
    LIMIT 1;
    IF FOUND AND v_next_type = 'exit' THEN
      v_month_to := date_trunc('month', v_next_at AT TIME ZONE 'Asia/Riyadh')::date;
    END IF;
  ELSE
    v_month_from := date_trunc('month', v_card_created_at AT TIME ZONE 'Asia/Riyadh')::date;
  END IF;
  IF v_month < v_month_from OR (v_month_to IS NOT NULL AND v_month > v_month_to) THEN
    RAISE EXCEPTION 'month_outside_card'
      USING ERRCODE = '55000',
            HINT = 'The month lies outside the card''s visit.';
  END IF;

  -- Never a month after the current Saudi month.
  v_current_month := date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')::date;
  IF v_month > v_current_month THEN
    RAISE EXCEPTION 'month_in_future'
      USING ERRCODE = '55000',
            HINT = 'Hours are recorded up to the current month only.';
  END IF;

  -- The hours: 0 to 9999, two decimals (NaN is numeric too).
  IF p_hours IS NULL OR p_hours = 'NaN'::numeric OR p_hours < 0 OR p_hours > 9999 THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  END IF;
  v_hours := round(p_hours, 2);

  -- 0185: the days: NULL = none, else 0 to 31, two decimals. A value like
  -- the note: NULL stores no days.
  IF p_days IS NOT NULL
     AND (p_days = 'NaN'::numeric OR p_days < 0 OR p_days > 31) THEN
    RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023';
  END IF;
  v_days := round(p_days, 2);

  -- The note: trimmed, blank = none, at most 500 characters.
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.hours, m.days, m.note INTO v_id, v_old_hours, v_old_days, v_old_note
  FROM public.equipment_card_months m
  WHERE m.equipment_card_id = p_card_id
    AND m.month = v_month
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.equipment_card_months (equipment_card_id, month, hours, days, note, created_by)
    VALUES (p_card_id, v_month, v_hours, v_days, v_note, auth.uid())
    RETURNING id INTO v_id;

    PERFORM public.record_equipment_card_event(
      p_card_id,
      'month_recorded',
      jsonb_build_object('month', v_month, 'hours', v_hours, 'days', v_days, 'note', v_note)
    );
    RETURN v_id;
  END IF;

  -- An existing record: update hours, days and note; no event when nothing
  -- changed.
  IF v_old_hours = v_hours
     AND v_old_days IS NOT DISTINCT FROM v_days
     AND v_old_note IS NOT DISTINCT FROM v_note THEN
    RETURN v_id;
  END IF;

  UPDATE public.equipment_card_months
  SET hours = v_hours, days = v_days, note = v_note
  WHERE id = v_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'month_updated',
    jsonb_build_object(
      'month', v_month,
      'hours', v_hours,
      'old_hours', v_old_hours,
      'days', v_days,
      'old_days', v_old_days,
      'note', v_note,
      'old_note', v_old_note
    )
  );
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text, numeric) IS
  '0172/0185/0189: records the hours (and, since 0185, the optional days: 0 to 31, invalid_days) of ONE card for ONE Saudi month (p_month is normalised to the first of its month): insert → event month_recorded, an existing row → hours, days and note updated with the event month_updated carrying old_hours / old_days (no event when nothing changed). 0189: the month must lie within the card''s VISIT — from the Saudi month of its entry (the month the card was created when the entry row is gone) to the month of the exit that closes it, when it left (month_outside_card) — and not after the current Saudi month (month_in_future); a unit that left still takes its past months. Locks the card row first. Needs sales.manage. Returns the record id.';

REVOKE ALL ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text, numeric)
  TO authenticated;

-- C11. add_client_po_equipment
CREATE OR REPLACE FUNCTION public.add_client_po_equipment(
  p_client_po_id uuid,
  p_equipment_id uuid,
  p_price numeric DEFAULT NULL,
  p_rate_unit text DEFAULT 'month',
  p_standard_hours integer DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.client_pos%ROWTYPE;
  v_card_id uuid;
  v_card_created boolean := false;
  v_line_id uuid;
  v_last public.entry_exit_logs%ROWTYPE;
  v_entry public.entry_exit_logs%ROWTYPE;
  v_rate_unit text;
  v_standard_hours integer;
  v_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  -- The PO row lock: every write to the PO and its lines takes it.
  SELECT * INTO v_po
  FROM public.client_pos p
  WHERE p.id = p_client_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_client_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  -- The sale price is optional («تحتاج سعر» while NULL); when given it is
  -- numeric(12, 2) >= 0.
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  -- The price unit: month, week (0185), day or hour; nothing given = month.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month');
  IF v_rate_unit NOT IN ('month', 'week', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;
  -- The line's standard hours: given, else the PO's default.
  v_standard_hours := COALESCE(p_standard_hours, v_po.standard_hours);
  IF v_standard_hours IS NULL OR v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  -- The contract quantity: optional, positive, in the line's unit.
  IF p_quantity IS NOT NULL AND (p_quantity <= 0 OR p_quantity > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  -- The unit's advisory key (the one every movement function takes), so two
  -- concurrent calls never create two cards for one unit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));

  -- 0188 (owner 2026-11-09): the unit joins through a SITE VISIT of the
  -- PO's company and project, open or closed (no entry-day rule on the
  -- client side). Was (0137 / 0169): the latest movement is an open site
  -- entry there. The open visit is preferred (the entry that is the unit's
  -- latest movement, in the chain's own order), else the latest closed one.
  -- The key above is the sequence trigger's, so a movement being recorded
  -- at the same moment is serialised against these reads.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  SELECT l.* INTO v_entry
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
    AND l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND l.company_id = v_po.company_id
    AND l.project_id = v_po.project_id
  ORDER BY (l.id IS NOT DISTINCT FROM v_last.id) DESC, l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'equipment_not_at_po_project'
      USING ERRCODE = '55000',
            HINT = 'The equipment has no visit in the PO''s company and project.';
  END IF;
  -- 0189: the card is the unit's VISIT there — the card created from this
  -- very entry (the supplier side's, when it came first), else a new card
  -- linked to it, with this line's unit and standard hours as the card's
  -- shared fields. A card has no period any more, so no overlap rule.
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.entry_log_id = v_entry.id
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_card_id IS NULL THEN
    INSERT INTO public.equipment_cards (
      equipment_id, company_id, project_id, rate_unit, standard_hours,
      created_by, entry_log_id
    ) VALUES (
      p_equipment_id, v_po.company_id, v_po.project_id, v_rate_unit, v_standard_hours,
      auth.uid(), v_entry.id
    )
    RETURNING id INTO v_card_id;
    v_card_created := true;
  END IF;

  -- A card sits on at most one OPEN client PO: this PO (the unique
  -- constraint) or another (the trigger); both raise the same token.
  IF EXISTS (
    SELECT 1
    FROM public.client_po_equipment l
    JOIN public.client_pos p ON p.id = l.client_po_id
    WHERE l.equipment_card_id = v_card_id
      AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION 'equipment_already_on_open_client_po'
      USING ERRCODE = '23505',
            HINT = 'This equipment already sits on an open client PO for this company and project.';
  END IF;

  BEGIN
    INSERT INTO public.client_po_equipment (
      client_po_id, equipment_card_id, price, rate_unit, standard_hours, quantity, note, created_by
    ) VALUES (
      v_po.id, v_card_id, p_price, v_rate_unit, v_standard_hours, p_quantity, v_note, auth.uid()
    )
    RETURNING id INTO v_line_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'equipment_already_on_open_client_po'
        USING ERRCODE = '23505',
              HINT = 'This equipment is already on this PO.';
  END;

  PERFORM public.record_client_po_event(
    v_po.id, 'equipment_added',
    jsonb_build_object(
      'line_id', v_line_id,
      'equipment_id', p_equipment_id,
      'equipment_card_id', v_card_id,
      'card_created', v_card_created,
      'price', p_price,
      'rate_unit', v_rate_unit,
      'standard_hours', v_standard_hours,
      'quantity', p_quantity,
      'entry_log_id', v_entry.id
    )
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text) IS
  '0169/0185/0188/0189: adds a unit to an OPEN client PO with an optional sale price (excluding VAT) per month / week / day / hour (p_rate_unit, default month; invalid_rate_unit), the line''s standard hours (p_standard_hours, NULL = the PO''s default), an optional contract quantity and a note, through a site visit of the unit in the PO''s company and project, open or closed (0188; the open visit first, else the latest closed one; none: equipment_not_at_po_project). 0189: the card is that visit''s (the card linked to the entry, else a new one linked to it; no period, no overlap rule). A card sits on at most one open client PO (equipment_already_on_open_client_po). Serialises on the unit''s advisory key. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  TO authenticated;

-- C12. create_supplier_po: the body never read the status; the comment only.
COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138/0139/0148/0157/0189: creates a supplier PO (a draft; no open / closed state since 0189) for a party (a lessor OR an owner class) with the next PO number and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note, rate_unit month|week|day|hour}]) through add_supplier_po_equipment, so every unit must have entered on the start date (entry_date_mismatch rolls the whole call back); a unit may already sit on other POs. Needs purchasing.manage.';

-- ===========================================================================
-- D. Views
-- ===========================================================================
-- D1. sales_equipment_cards
CREATE VIEW public.sales_equipment_cards
WITH (security_invoker = true)
AS
SELECT
  -- The card.
  c.id AS card_id,
  c.equipment_id,
  c.company_id,
  c.project_id,
  c.rate_unit,
  c.standard_hours,
  c.note,
  c.entry_log_id,
  el.recorded_at AS entry_at,
  -- 0189: the exit that closes the card's entry (NULL while the unit is
  -- still inside, or for a reader who may not see the movement).
  CASE WHEN nx.movement_type = 'exit' THEN nx.recorded_at END AS exit_at,
  c.created_at,
  c.updated_at,
  -- The unit.
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  e.lessor_id AS equipment_lessor_id,
  ls.name AS equipment_lessor_name,
  -- The company (the client) and the project.
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The client side.
  cl.client_line_id,
  cl.client_po_id,
  cl.client_po_number,
  cl.client_po_status,
  cl.client_price,
  cl.client_rate_unit,
  cl.client_standard_hours,
  cl.client_quantity,
  (cl.client_po_id IS NOT NULL AND cl.client_po_status = 'open') AS has_client_po,
  -- The supplier side.
  sp.supplier_line_id,
  sp.supplier_po_id,
  sp.supplier_po_number,
  sp.supplier_price,
  sp.supplier_rate_unit,
  (sp.supplier_po_id IS NOT NULL) AS has_supplier_po,
  -- 0174: the card's own client price («اسعار المعدات») and its approval.
  c.client_price AS card_client_price,
  c.pricing_status,
  c.pricing_approved_at,
  c.pricing_approved_by,
  pn.full_name AS pricing_approved_by_name,
  m.card_margin,
  CASE
    WHEN m.card_margin IS NULL OR c.client_price IS NULL OR c.client_price = 0 THEN NULL
    ELSE round(m.card_margin / c.client_price * 100, 2)
  END AS card_margin_pct,
  sp.supplier_po_approval_status,
  -- 0184: the two PO dates and the latest modification, at the END.
  cl.client_po_updated_at,
  sp.supplier_po_updated_at,
  GREATEST(c.updated_at, cl.client_po_updated_at, sp.supplier_po_updated_at) AS last_modified_at,
  -- 0185: the unit of the card's client price.
  c.client_price_unit AS card_client_price_unit,
  -- 0189: the supplier PO's start date — the date of the card's supplier
  -- side now that the card has no period.
  sp.supplier_po_start_date
FROM public.equipment_cards c
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = e.lessor_id
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.projects pr ON pr.id = c.project_id
LEFT JOIN public.entry_exit_logs el ON el.id = c.entry_log_id
-- 0189: the unit's next movement in the entry's context, in the chain's own
-- (recorded_at, id) order (the index idx_entry_exit_logs_equipment_context_time
-- serves it): an exit closes the visit.
LEFT JOIN LATERAL (
  SELECT n.movement_type, n.recorded_at
  FROM public.entry_exit_logs n
  WHERE n.equipment_id = el.equipment_id
    AND n.movement_context = el.movement_context
    AND (n.recorded_at, n.id) > (el.recorded_at, el.id)
  ORDER BY n.recorded_at, n.id
  LIMIT 1
) nx ON true
LEFT JOIN public.profile_names pn ON pn.id = c.pricing_approved_by
LEFT JOIN LATERAL (
  SELECT
    l.id AS client_line_id,
    p.id AS client_po_id,
    p.po_number AS client_po_number,
    p.status AS client_po_status,
    l.price AS client_price,
    l.rate_unit AS client_rate_unit,
    l.standard_hours AS client_standard_hours,
    l.quantity AS client_quantity,
    p.updated_at AS client_po_updated_at
  FROM public.client_po_equipment l
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE l.equipment_card_id = c.id
  ORDER BY (p.status = 'open') DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) cl ON true
LEFT JOIN LATERAL (
  SELECT
    sl.id AS supplier_line_id,
    sp2.id AS supplier_po_id,
    sp2.po_number AS supplier_po_number,
    sl.price AS supplier_price,
    sl.rate_unit AS supplier_rate_unit,
    sp2.approval_status AS supplier_po_approval_status,
    sp2.updated_at AS supplier_po_updated_at,
    sp2.start_date AS supplier_po_start_date
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp2 ON sp2.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = c.id
  -- 0189: the card's LATEST supplier PO (no open / closed state).
  ORDER BY sp2.created_at DESC, sp2.id DESC
  LIMIT 1
) sp ON true
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN c.client_price IS NOT NULL
         AND sp.supplier_price IS NOT NULL
         -- 0185: the same unit on both sides (any of the four).
         AND sp.supplier_rate_unit = c.client_price_unit
      THEN round(c.client_price - sp.supplier_price, 2)
    ELSE NULL
  END AS card_margin
) m;

COMMENT ON VIEW public.sales_equipment_cards IS
  '0169 / 0174 / 0184 / 0185 / 0189: one row per equipment card («كرت المعدة») with the unit, the company and project, the visit it was created from (entry_log_id, entry_at and, since 0189, exit_at: the exit that closes that entry, NULL while inside — the card has NO period of its own any more) and both sides — the client PO line (id, number, status, price, unit, standard hours, quantity; has_client_po = an open one; the open PO''s line first, else the latest) and the supplier PO line (id, number, price, unit; has_supplier_po = any; since 0189 the line of the card''s LATEST supplier PO, which has no open / closed state) — plus the card''s own client price card_client_price (excluding VAT) with card_client_price_unit, pricing_status / pricing_approved_at / pricing_approved_by / pricing_approved_by_name, card_margin (= card_client_price − supplier_price when both are set and card_client_price_unit = supplier_rate_unit, else NULL) and card_margin_pct (over the client price, NULL when it is NULL or 0), supplier_po_approval_status, client_po_updated_at, supplier_po_updated_at, last_modified_at (the latest of the card''s, the client PO''s and the supplier PO''s updated_at) and supplier_po_start_date (0189). security_invoker: sales.view or purchasing.view for the card, each side''s own key, movements RLS for the entry and the exit.';

REVOKE ALL ON public.sales_equipment_cards FROM PUBLIC, anon;
GRANT SELECT ON public.sales_equipment_cards TO authenticated;

-- D2. sales_card_months
CREATE VIEW public.sales_card_months
WITH (security_invoker = true)
AS
SELECT
  -- The record.
  m.id,
  m.month,
  m.hours,
  m.note,
  m.created_by,
  m.created_at,
  m.updated_at,
  -- The card.
  sc.card_id,
  sc.equipment_id,
  sc.company_id,
  sc.project_id,
  -- 0189: the card's visit instead of its period.
  sc.entry_at,
  sc.exit_at,
  sc.rate_unit,
  sc.standard_hours,
  -- The unit.
  sc.equipment_code,
  sc.equipment_type,
  sc.equipment_type_search,
  sc.equipment_plate_number,
  sc.equipment_plate_digits,
  sc.equipment_chassis_number,
  sc.equipment_ownership_status,
  sc.equipment_lessor_id,
  sc.equipment_lessor_name,
  (sc.equipment_ownership_status = 'alazani') AS owned,
  -- The company (the client) and the project.
  sc.company_name_ar,
  sc.company_name_en,
  sc.project_name_ar,
  sc.project_name_en,
  -- The client side.
  sc.client_line_id,
  sc.client_po_id,
  sc.client_po_number,
  sc.client_po_status,
  sc.client_price,
  sc.client_rate_unit,
  sc.client_standard_hours,
  -- The supplier side.
  sc.supplier_line_id,
  sc.supplier_po_id,
  sc.supplier_po_number,
  sc.supplier_price,
  sc.supplier_rate_unit,
  -- The amounts.
  COALESCE(sc.client_standard_hours, sc.standard_hours) AS due_standard_hours,
  d.client_due,
  d.supplier_due,
  CASE
    WHEN d.client_due IS NULL THEN NULL
    ELSE round(d.client_due - COALESCE(d.supplier_due, 0), 2)
  END AS margin,
  -- 0185: at the END, the recorded days and the days inside the project.
  m.days,
  COALESCE(pd.presence_days, 0) AS presence_days
FROM public.equipment_card_months m
JOIN public.sales_equipment_cards sc ON sc.card_id = m.equipment_card_id
CROSS JOIN LATERAL (
  SELECT
    public.card_month_due(
      sc.client_price, sc.client_rate_unit, m.hours,
      COALESCE(sc.client_standard_hours, sc.standard_hours), m.days
    ) AS client_due,
    CASE
      WHEN sc.equipment_ownership_status = 'alazani' THEN NULL
      ELSE public.card_month_due(
        sc.supplier_price, sc.supplier_rate_unit, m.hours,
        COALESCE(sc.client_standard_hours, sc.standard_hours), m.days
      )
    END AS supplier_due
) d
-- 0185: the distinct Saudi days of the month on which the unit was inside
-- the card's company and project (site visits of movement_visits, filtered
-- by its partition keys equipment_id and movement_context).
LEFT JOIN LATERAL (
  SELECT count(DISTINCT pdays.day)::integer AS presence_days
  FROM public.movement_visits v
  CROSS JOIN LATERAL generate_series(
    GREATEST((v.entry_at AT TIME ZONE 'Asia/Riyadh')::date, m.month)::timestamp,
    LEAST(
      COALESCE(
        (v.exit_at AT TIME ZONE 'Asia/Riyadh')::date,
        (now() AT TIME ZONE 'Asia/Riyadh')::date
      ),
      (m.month + interval '1 month' - interval '1 day')::date
    )::timestamp,
    interval '1 day'
  ) AS pdays(day)
  WHERE v.equipment_id = sc.equipment_id
    AND v.movement_context = 'site'
    AND v.company_id = sc.company_id
    AND v.project_id = sc.project_id
    AND v.entry_at < ((m.month + interval '1 month') AT TIME ZONE 'Asia/Riyadh')
    AND (v.exit_at IS NULL OR v.exit_at >= (m.month::timestamp AT TIME ZONE 'Asia/Riyadh'))
) pd ON true;

COMMENT ON VIEW public.sales_card_months IS
  '0172/0185/0189: one row per RECORDED month of an equipment card («كروت التشغيل») with the card''s facts as sales_equipment_cards exposes them (the unit, the company and project, the card''s visit entry_at / exit_at since 0189 instead of a period, the client line and the supplier line, owned = an Al-Azani unit) plus the hours, the note and the computed amounts: client_due and supplier_due through card_month_due (month: price × hours ÷ due_standard_hours — the client line''s standard hours, else the card''s; hour: price × hours; day: price × days; week: price × days ÷ 7; unpriced or a missing figure: NULL; owned or no supplier line: supplier_due NULL) and margin = client_due − COALESCE(supplier_due, 0), NULL without a client due; days (the recorded days) and presence_days (the distinct Saudi days of the month on which the unit was inside the card''s company and project, from movement_visits; 0 for a reader without the movement rights). Nothing is stored. security_invoker: sales.view or purchasing.view for the record and the card, each side''s own key for its line, movements RLS for the visit and presence_days.';

REVOKE ALL ON public.sales_card_months FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_months TO authenticated;

-- D3. sales_card_month_slots
CREATE VIEW public.sales_card_month_slots
WITH (security_invoker = true)
AS
SELECT
  -- The slot (a stable id for a list row) and the record, when any.
  sc.card_id::text || ':' || to_char(g.month, 'YYYY-MM') AS slot_id,
  g.month,
  (m.id IS NOT NULL) AS recorded,
  m.id AS month_id,
  m.hours,
  m.note,
  m.created_by,
  m.created_at,
  m.updated_at,
  -- The card.
  sc.card_id,
  sc.equipment_id,
  sc.company_id,
  sc.project_id,
  -- 0189: the card's visit instead of its period.
  sc.entry_at,
  sc.exit_at,
  sc.rate_unit,
  sc.standard_hours,
  -- The unit.
  sc.equipment_code,
  sc.equipment_type,
  sc.equipment_type_search,
  sc.equipment_plate_number,
  sc.equipment_plate_digits,
  sc.equipment_chassis_number,
  sc.equipment_ownership_status,
  sc.equipment_lessor_id,
  sc.equipment_lessor_name,
  (sc.equipment_ownership_status = 'alazani') AS owned,
  -- The company (the client) and the project.
  sc.company_name_ar,
  sc.company_name_en,
  sc.project_name_ar,
  sc.project_name_en,
  -- The client side.
  sc.client_line_id,
  sc.client_po_id,
  sc.client_po_number,
  sc.client_po_status,
  sc.client_price,
  sc.client_rate_unit,
  sc.client_standard_hours,
  -- The supplier side.
  sc.supplier_line_id,
  sc.supplier_po_id,
  sc.supplier_po_number,
  sc.supplier_price,
  sc.supplier_rate_unit,
  -- The amounts (NULL while not recorded).
  COALESCE(sc.client_standard_hours, sc.standard_hours) AS due_standard_hours,
  d.client_due,
  d.supplier_due,
  CASE
    WHEN d.client_due IS NULL THEN NULL
    ELSE round(d.client_due - COALESCE(d.supplier_due, 0), 2)
  END AS margin,
  -- 0185: at the END, the recorded days and the days inside the project.
  m.days,
  COALESCE(pd.presence_days, 0) AS presence_days
FROM public.sales_equipment_cards sc
CROSS JOIN LATERAL (
  SELECT s::date AS month
  FROM generate_series(
    -- 0189: the months of the card's VISIT — from the Saudi month of its
    -- entry (the month the card was created when the entry is not visible)
    -- to the smaller of the month of its exit and the current month.
    date_trunc('month', COALESCE(sc.entry_at, sc.created_at) AT TIME ZONE 'Asia/Riyadh'),
    LEAST(
      date_trunc('month', COALESCE(sc.exit_at, now()) AT TIME ZONE 'Asia/Riyadh'),
      date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')
    ),
    interval '1 month'
  ) AS s
) g
LEFT JOIN public.equipment_card_months m
  ON m.equipment_card_id = sc.card_id
 AND m.month = g.month
CROSS JOIN LATERAL (
  SELECT
    public.card_month_due(
      sc.client_price, sc.client_rate_unit, m.hours,
      COALESCE(sc.client_standard_hours, sc.standard_hours), m.days
    ) AS client_due,
    CASE
      WHEN sc.equipment_ownership_status = 'alazani' THEN NULL
      ELSE public.card_month_due(
        sc.supplier_price, sc.supplier_rate_unit, m.hours,
        COALESCE(sc.client_standard_hours, sc.standard_hours), m.days
      )
    END AS supplier_due
) d
-- 0185: the distinct Saudi days of the month on which the unit was inside
-- the card's company and project (site visits of movement_visits, filtered
-- by its partition keys equipment_id and movement_context).
LEFT JOIN LATERAL (
  SELECT count(DISTINCT pdays.day)::integer AS presence_days
  FROM public.movement_visits v
  CROSS JOIN LATERAL generate_series(
    GREATEST((v.entry_at AT TIME ZONE 'Asia/Riyadh')::date, g.month)::timestamp,
    LEAST(
      COALESCE(
        (v.exit_at AT TIME ZONE 'Asia/Riyadh')::date,
        (now() AT TIME ZONE 'Asia/Riyadh')::date
      ),
      (g.month + interval '1 month' - interval '1 day')::date
    )::timestamp,
    interval '1 day'
  ) AS pdays(day)
  WHERE v.equipment_id = sc.equipment_id
    AND v.movement_context = 'site'
    AND v.company_id = sc.company_id
    AND v.project_id = sc.project_id
    AND v.entry_at < ((g.month + interval '1 month') AT TIME ZONE 'Asia/Riyadh')
    AND (v.exit_at IS NULL OR v.exit_at >= (g.month::timestamp AT TIME ZONE 'Asia/Riyadh'))
) pd ON true;

COMMENT ON VIEW public.sales_card_month_slots IS
  '0172/0185/0189: every equipment card × every Saudi month of its VISIT (0189; it was the card''s period): from the month of its entry (the month the card was created when the entry is not visible to the reader) to the smaller of the month of the exit that closes it and the current Saudi month (generate_series, computed on read and bounded by the number of cards × their months — filter by month or by company and project), LEFT JOINed to the recorded hours: the columns of sales_card_months plus slot_id (card:YYYY-MM), recorded and month_id, with hours, note and the amounts NULL while the month is not recorded; days (NULL while not recorded) and presence_days (recorded or not; 0 for a reader without the movement rights). Feeds the «الشهور» list and the batch screen. security_invoker as sales_card_months.';

REVOKE ALL ON public.sales_card_month_slots FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_month_slots TO authenticated;

-- D4. purchasing_po_units
CREATE VIEW public.purchasing_po_units
WITH (security_invoker = true)
AS
SELECT
  -- The line.
  l.id AS line_id,
  l.price,
  l.rate_unit,
  l.note AS line_note,
  l.created_at AS line_created_at,
  l.updated_at,
  (l.price IS NOT NULL) AS is_priced,
  -- The PO.
  p.id AS supplier_po_id,
  p.po_number,
  p.approval_status,
  p.start_date,
  p.lessor_id,
  p.owner_class,
  COALESCE(p.owner_class, 'external_supplier') AS party_class,
  ls.name AS lessor_name,
  ls.is_internal AS lessor_is_internal,
  -- The PO's company and project.
  p.company_id,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The unit and its card.
  c.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  -- 0189: the card itself (it has no period any more).
  c.id AS equipment_card_id
FROM public.supplier_po_equipment l
JOIN public.supplier_pos p ON p.id = l.supplier_po_id
JOIN public.equipment_cards c ON c.id = l.equipment_card_id
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = p.lessor_id
LEFT JOIN public.companies co ON co.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id;

COMMENT ON VIEW public.purchasing_po_units IS
  '0167/0189: one row per supplier PO line (supplier_po_equipment) with its PO (number, approval, start date, party and party_class as in party_class(supplier_pos); no open / closed state since 0189), the PO''s company and project, the unit and its card (equipment_card_id; the card has no period since 0189). The «حسب المعدات» view of the PO list. security_invoker: purchasing.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.purchasing_po_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_po_units TO authenticated;

-- D5. sales_po_units
CREATE VIEW public.sales_po_units
WITH (security_invoker = true)
AS
SELECT
  -- The line.
  l.id AS line_id,
  l.price,
  l.rate_unit,
  l.standard_hours,
  l.quantity,
  l.note AS line_note,
  l.created_at AS line_created_at,
  l.updated_at,
  (l.price IS NOT NULL) AS is_priced,
  -- The PO.
  p.id AS client_po_id,
  p.po_number,
  p.status AS po_status,
  p.issue_date,
  p.expiry_date,
  p.standard_hours AS po_standard_hours,
  -- The PO's company (the client) and project.
  p.company_id,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The unit and its card.
  c.id AS equipment_card_id,
  c.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  e.lessor_id AS equipment_lessor_id,
  ls.name AS equipment_lessor_name,
  -- The supplier side of the same card, when present.
  sp.supplier_po_id,
  sp.supplier_po_number,
  sp.supplier_price,
  sp.supplier_rate_unit
FROM public.client_po_equipment l
JOIN public.client_pos p ON p.id = l.client_po_id
JOIN public.equipment_cards c ON c.id = l.equipment_card_id
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = e.lessor_id
LEFT JOIN public.companies co ON co.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN LATERAL (
  SELECT
    sp2.id AS supplier_po_id,
    sp2.po_number AS supplier_po_number,
    sl.price AS supplier_price,
    sl.rate_unit AS supplier_rate_unit
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp2 ON sp2.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = c.id
  -- 0189: the card's LATEST supplier PO (no open / closed state).
  ORDER BY sp2.created_at DESC, sp2.id DESC
  LIMIT 1
) sp ON true;

COMMENT ON VIEW public.sales_po_units IS
  '0169/0189: one row per client PO line (client_po_equipment) with its PO (number, status, issue / expiry date, standard hours), the PO''s company and project, the unit, its card (equipment_card_id; no period since 0189) and the supplier side of the same card when present (supplier_po_id, supplier_po_number, supplier_price, supplier_rate_unit: the line of the card''s latest supplier PO). The «حسب المعدات» view of the client PO list. security_invoker: sales.view, purchasing.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.sales_po_units FROM PUBLIC, anon;
GRANT SELECT ON public.sales_po_units TO authenticated;

-- D6. purchasing_site_visits
CREATE VIEW public.purchasing_site_visits
WITH (security_invoker = true)
AS
SELECT
  v.entry_id,
  v.equipment_id,
  v.equipment_code,
  v.equipment_type,
  v.equipment_type_search,
  v.equipment_plate_number,
  e.chassis_number AS equipment_chassis_number,
  v.equipment_ownership_status,
  v.equipment_lessor_id,
  v.equipment_lessor_name,
  v.company_id,
  v.company_name_ar,
  v.company_name_en,
  v.project_id,
  v.project_name_ar,
  v.project_name_en,
  -- The foreman who recorded the site entry.
  v.entry_supervisor_id,
  v.entry_supervisor_name,
  v.entry_at,
  -- «ترقيم الشركة»: the client company's number on the entry, when set.
  v.contractor_equipment_code,
  -- The open PO the unit sits on for this company and project: as 0147
  -- (any card of the unit there) for an OPEN visit, the card created from
  -- this visit's entry first; a CLOSED visit only through a card whose
  -- period covers its entry day (0188).
  po.id AS supplier_po_id,
  po.po_number,
  (po.id IS NOT NULL) AS has_po,
  -- Without one: the open PO of the unit's party for this company and
  -- project, which the unit can join (add_supplier_po_equipment re-checks).
  -- 0148: only a PO whose start date is the day this unit entered.
  -- 0160: and only a DRAFT one (an approved PO is locked).
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number,
  -- 0169: the open CLIENT PO the unit sits on for this company and project.
  cpo.id AS client_po_id,
  cpo.po_number AS client_po_number,
  (cpo.id IS NOT NULL) AS has_client_po,
  -- 0169: without one, the open client PO of this company and project that
  -- the unit can join (add_client_po_equipment re-checks).
  project_cpo.id AS project_client_po_id,
  project_cpo.po_number AS project_client_po_number,
  -- 0188: the visit's state and its exit (NULL while inside).
  CASE WHEN v.exit_id IS NULL THEN 'inside' ELSE 'exited' END AS visit_state,
  v.exit_at,
  v.exit_purpose
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else through
  -- a PO that started on or before the visit's entry day (a PO of an
  -- earlier stay still covers the unit when it returns; a PO of a LATER
  -- visit never marks an older one). The visit's own card first, then the
  -- latest start date, then the latest PO. No open / closed state.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR p.start_date <= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           p.start_date DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    AND p.approval_status = 'draft'
    AND (
      (v.equipment_ownership_status = 'external_supplier'
        AND p.lessor_id IS NOT NULL
        AND p.lessor_id = v.equipment_lessor_id)
      OR (v.equipment_ownership_status <> 'external_supplier'
        AND p.owner_class = v.equipment_ownership_status)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) party_po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    -- 0189: a CLOSED visit only through its own card (0188 used the card's
    -- period, which is gone), so a later visit's PO does not cover it.
    AND (
      v.exit_id IS NULL
      OR c.entry_log_id IS NOT DISTINCT FROM v.entry_id
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) cpo ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_pos p
  WHERE cpo.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) project_cpo ON true
WHERE v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_visits IS
  '0188/0189: every SITE visit of movement_visits, open or closed, with the supplier PO of the visit (supplier_po_id, po_number, has_po) — since 0189 a line of the unit on a PO of that company and project through the visit''s own card, else through a PO that started on or before the visit''s entry day (the visit''s card first, then the latest start date; a supplier PO has no open / closed state) —, else the DRAFT PO of its party there whose start date is the visit''s entry day that it can join (party_po_id, party_po_number), the client columns of 0169 (the open client PO; a closed visit only through its own card) and visit_state (inside / exited), exit_at and exit_purpose. The «المعدات في المشاريع» page. security_invoker: movements RLS, purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_visits FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_visits TO authenticated;

-- D7. purchasing_site_units
CREATE VIEW public.purchasing_site_units
WITH (security_invoker = true)
AS
SELECT
  v.entry_id,
  v.equipment_id,
  v.equipment_code,
  v.equipment_type,
  v.equipment_type_search,
  v.equipment_plate_number,
  e.chassis_number AS equipment_chassis_number,
  v.equipment_ownership_status,
  v.equipment_lessor_id,
  v.equipment_lessor_name,
  v.company_id,
  v.company_name_ar,
  v.company_name_en,
  v.project_id,
  v.project_name_ar,
  v.project_name_en,
  -- The foreman who recorded the open site entry.
  v.entry_supervisor_id,
  v.entry_supervisor_name,
  v.entry_at,
  -- «ترقيم الشركة»: the client company's number on the entry, when set.
  v.contractor_equipment_code,
  -- The open PO the unit sits on for this company and project.
  po.id AS supplier_po_id,
  po.po_number,
  (po.id IS NOT NULL) AS has_po,
  -- Without one: the open PO of the unit's party for this company and
  -- project, which the unit can join (add_supplier_po_equipment re-checks).
  -- 0148: only a PO whose start date is the day this unit entered.
  -- 0160: and only a DRAFT one (an approved PO is locked).
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number,
  -- 0169: the open CLIENT PO the unit sits on for this company and project.
  cpo.id AS client_po_id,
  cpo.po_number AS client_po_number,
  (cpo.id IS NOT NULL) AS has_client_po,
  -- 0169: without one, the open client PO of this company and project that
  -- the unit can join (add_client_po_equipment re-checks).
  project_cpo.id AS project_client_po_id,
  project_cpo.po_number AS project_client_po_number
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else through
  -- a PO that started on or before the visit's entry day (a PO of an
  -- earlier stay still covers the unit when it returns; a PO of a LATER
  -- visit never marks an older one). The visit's own card first, then the
  -- latest start date, then the latest PO. No open / closed state.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR p.start_date <= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           p.start_date DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    AND p.approval_status = 'draft'
    AND (
      (v.equipment_ownership_status = 'external_supplier'
        AND p.lessor_id IS NOT NULL
        AND p.lessor_id = v.equipment_lessor_id)
      OR (v.equipment_ownership_status <> 'external_supplier'
        AND p.owner_class = v.equipment_ownership_status)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) party_po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) cpo ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_pos p
  WHERE cpo.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) project_cpo ON true
WHERE v.is_open
  AND v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_units IS
  '0147/0148/0160/0169/0189: the units inside a project now (open site visits of movement_visits) with the supplier PO of the visit (supplier_po_id, po_number, has_po) — since 0189 as purchasing_site_visits finds it: through the visit''s own card, else a PO of that company and project that started on or before the visit''s entry day (a supplier PO has no open / closed state) —, else the DRAFT PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number); and (0169) the open client PO they sit on there (client_po_id, client_po_number, has_client_po), else the open client PO of that company and project they can join (project_client_po_id, project_client_po_number). The inquiry''s PO card reads it. security_invoker: movements RLS, purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;

-- ===========================================================================
-- E. Guards: nothing left reads what is gone
-- ===========================================================================
DO $$
DECLARE
  v_bad text;
BEGIN
  -- plpgsql does not check column names when a function is created, so a
  -- function that still read a dropped column would only fail when called.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ 'equipment_cards'
    AND p.prosrc ~ '\mperiod_(from|to)\M';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0189: functions still read the card period: %', v_bad;
  END IF;

  -- The supplier PO status: p.status / sp.status / v_po.status / v_status in
  -- a function of the supplier side (the client PO keeps its own status, so
  -- functions that touch client_pos are not looked at).
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ 'supplier_pos'
    AND p.prosrc !~ 'client_pos'
    AND p.prosrc ~ '\m(v_po|sp|sp2|p)\.status\M|\mv_status\M|\mclosed_at\M';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0189: functions still read the supplier PO status: %', v_bad;
  END IF;
END;
$$;
