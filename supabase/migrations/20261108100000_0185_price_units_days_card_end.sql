-- 0185: price units, days on the month record, the manual card end and the
-- cards awaiting their end (owner decisions 2026-11-08, «ابدا الهجرة»).
-- Database only; the screens follow later.
--
-- A. FOUR PRICE UNITS everywhere: month, week, day, hour.
--   * The CHECKs supplier_po_equipment_rate_unit_check (0157: month / day),
--     client_po_equipment_rate_unit_check (0169: month / day / hour) and
--     equipment_cards_rate_unit_check (0136: month / day / hour) are dropped
--     and re-added with the four values; every default stays 'month'.
--   * New column equipment_cards.client_price_unit text NOT NULL DEFAULT
--     'month' (CHECK the four values): the unit of the card's own client
--     price (0174 client_price, monthly only until now). Every existing row
--     becomes 'month' through the default.
--   * Re-created with the four-value validation, bodies copied VERBATIM
--     except the unit list (and its comment line):
--       add_supplier_po_equipment, update_supplier_po_equipment (from 0160),
--       add_client_po_equipment, update_client_po_equipment (from 0169).
--     create_supplier_po (0157) and create_client_po (0169) do not validate
--     the unit themselves (they pass each item's rate_unit to the add
--     functions), so they are NOT re-created.
--   * set_equipment_card_client_price: DROP (uuid, numeric), CREATE
--     (p_card_id uuid, p_price numeric, p_rate_unit text DEFAULT NULL).
--     NULL unit = unchanged; a unit outside the four → invalid_rate_unit;
--     an approved card is still refused (card_pricing_approved_locked); the
--     event client_price_changed carries old_price / new_price / old_unit /
--     new_unit and is written when the price OR the unit changed (nothing
--     changed → no write, no event). The old two-parameter signature is
--     dropped first: kept beside the new one, PostgREST would find two
--     candidates for a call naming p_card_id + p_price only. The live UI's
--     call (p_card_id, p_price) keeps working through the default.
--   * set_equipment_card_client_prices(p_items jsonb): same signature; each
--     item may carry "rate_unit" (string | null, optional; another JSON type
--     → invalid_items) and goes through the single setter.
--   * approve_equipment_card_pricing: the 0174 body verbatim (no new
--     condition: the units need not match to approve); its pricing_approved
--     payload gains client_price_unit.
--   * sales_equipment_cards: 0184 verbatim (every column, same order) plus
--     the TRAILING column card_client_price_unit; card_margin = card client
--     price − supplier price when both are set AND card_client_price_unit =
--     supplier_rate_unit (any of the four units; was: supplier line monthly),
--     else NULL; card_margin_pct as before over the client price.
--
-- B. DAYS on the month record and the due per unit.
--   * equipment_card_months.days numeric(5, 2) NULL, CHECK 0 to 31.
--   * record_equipment_card_month: DROP (uuid, date, numeric, text), CREATE
--     (p_card_id uuid, p_month date, p_hours numeric, p_note text DEFAULT
--     NULL, p_days numeric DEFAULT NULL): 0172's rules plus the days —
--     invalid_days unless NULL or 0 to 31 (rounded to two decimals), stored
--     like the note (a VALUE: NULL stores no days), the events
--     month_recorded / month_updated carry days (and old_days), and
--     "nothing changed" compares the days too. The old call (four named
--     parameters) keeps working through the default.
--   * record_equipment_card_months(p_month date, p_items jsonb): same
--     signature; each item may carry "days" (number | null, optional;
--     another JSON type → invalid_items), passed through.
--   * delete_equipment_card_month: unchanged.
--   * card_month_due: DROP (numeric, text, numeric, integer), CREATE
--     (p_price numeric, p_rate_unit text, p_hours numeric, p_standard_hours
--     integer, p_days numeric), IMMUTABLE: price NULL → NULL; hour → price ×
--     hours; month → price × hours ÷ standard hours (standard hours > 0);
--     day → price × days; week → price × days ÷ 7; NULL hours / days → NULL;
--     any other unit NULL; rounded to 2 decimals. Only the two 0172 views
--     called the old version; they are dropped first and re-created.
--   * sales_card_months / sales_card_month_slots: DROP VIEW, then the 0172
--     definitions verbatim, the dues called with m.days, and the TRAILING
--     columns days and presence_days (client_rate_unit and
--     supplier_rate_unit were already exposed). presence_days = the number
--     of DISTINCT Saudi calendar days (Asia/Riyadh) of that month on which
--     the card's unit was inside the card's company and project: for every
--     SITE visit of movement_visits with the card's equipment, company and
--     project, the days from the entry's Saudi day to the exit's Saudi day
--     (an open visit: to today, Saudi), clipped to the month, counted once
--     each (an exit and a re-entry on the same day count one day), so it
--     never exceeds the month's length. movement_visits is security_invoker
--     over entry_exit_logs: a reader without the movement rights sees no
--     visit and gets 0. The read is a LEFT JOIN LATERAL of one aggregate
--     row per row of the view, bounded by the unit's site visits that touch
--     the month (at most 31 days each); the visits are filtered by
--     equipment_id and
--     movement_context, the window partition keys of movement_visits, so
--     the filter reaches entry_exit_logs and the existing index
--     idx_entry_exit_logs_equipment_context_time (equipment_id,
--     movement_context, recorded_at, id; 0040) serves it — no new index.
--
-- C. The MANUAL card end (owner: «انهاء الكرت خليه يدوي»).
--   * end_equipment_card(p_card_id uuid, p_period_to date, p_note text
--     DEFAULT NULL): sales.manage; the card row locked FOR UPDATE; sets
--     period_to and writes the event card_ended {period_to, note}.
--   * reopen_equipment_card(p_card_id uuid, p_note text DEFAULT NULL):
--     sales.manage; the card row locked; period_to back to NULL (an overlap
--     with a later card of the unit raises the 0136 EXCLUDE constraint →
--     card_overlap); event card_reopened {old_period_to, note}.
--   * equipment_card_events.event_type CHECK: 0174's list plus card_ended
--     and card_reopened.
--   * Nothing else: sales_equipment_cards already shows ended cards
--     (is_open = period_to IS NULL) and the RLS of equipment_cards is
--     unchanged.
--
-- D. «معدات خرجت بانتهاء عمل وكرتها مفتوح»: the read-only security_invoker
--   view sales_cards_awaiting_end — every OPEN card whose unit's LATEST
--   movement (both contexts, (recorded_at, id) order, the 0125 way) is a
--   SITE EXIT with exit_purpose = 'work_completed' closing a visit
--   (movement_visits.exit_id) in the card's company and project; with the
--   unit, the company and project, period_from, the visit's entry, the exit
--   (exit_log_id, exit_at), its recorder (exit_supervisor_id / _name through
--   profile_names) and the card's client / supplier PO (id, number) from
--   sales_equipment_cards. The movement read follows the reader's movement
--   rights (security_invoker), so the latest movement is the latest the
--   reader may see.
--
-- Stable error tokens (new or newly raised here; the copied functions keep
-- their own, unchanged):
--   sales_manage_required / sales_approve_required          42501
--   invalid_rate_unit / invalid_days / invalid_items /
--   invalid_card / invalid_price / invalid_note /
--   invalid_period_to / invalid_month / invalid_hours       22023
--   card_already_ended / card_not_ended /
--   card_has_later_months / card_pricing_approved_locked /
--   month_outside_card / month_in_future                    55000
--   card_overlap                                            23P01
--
-- No new permission key: sales.manage writes, sales.view / purchasing.view
-- read as before. Every function: SECURITY DEFINER (card_month_due: plain
-- SQL), SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC, anon,
-- GRANT EXECUTE TO authenticated, a COMMENT.
--
-- Rollout: safe to apply BEFORE the new screens. The live UI calls
-- set_equipment_card_client_price (p_card_id, p_price) and
-- record_equipment_card_month (p_card_id, p_month, p_hours, p_note), which
-- the defaulted new parameters keep working; the batches take the same
-- items; the views only gain TRAILING columns (sales_card_months and
-- sales_card_month_slots are dropped and re-created inside this
-- transaction with the same columns in the same order); every existing
-- unit stays valid under the wider CHECKs.
--
-- Nothing here changes a movement, a photo, the master data or a policy.

-- ===========================================================================
-- A1. The four units on the three tables
-- ===========================================================================
ALTER TABLE public.supplier_po_equipment
  DROP CONSTRAINT supplier_po_equipment_rate_unit_check;
ALTER TABLE public.supplier_po_equipment
  ADD CONSTRAINT supplier_po_equipment_rate_unit_check
    CHECK (rate_unit IN ('month', 'week', 'day', 'hour'));

ALTER TABLE public.client_po_equipment
  DROP CONSTRAINT client_po_equipment_rate_unit_check;
ALTER TABLE public.client_po_equipment
  ADD CONSTRAINT client_po_equipment_rate_unit_check
    CHECK (rate_unit IN ('month', 'week', 'day', 'hour'));

ALTER TABLE public.equipment_cards
  DROP CONSTRAINT equipment_cards_rate_unit_check;
ALTER TABLE public.equipment_cards
  ADD CONSTRAINT equipment_cards_rate_unit_check
    CHECK (rate_unit IN ('month', 'week', 'day', 'hour'));

ALTER TABLE public.equipment_cards
  ADD COLUMN IF NOT EXISTS client_price_unit text NOT NULL DEFAULT 'month'
    CONSTRAINT equipment_cards_client_price_unit_check
      CHECK (client_price_unit IN ('month', 'week', 'day', 'hour'));

COMMENT ON COLUMN public.supplier_po_equipment.rate_unit IS
  '0157 / 0185: the unit of the line''s price with this supplier — month, week, day or hour (0185; was month or day). Independent of the card''s rate_unit, which is the client side''s. Default month.';
COMMENT ON COLUMN public.client_po_equipment.rate_unit IS
  '0169 / 0185: the unit of the line''s sale price — month, week, day or hour (0185 added week). Default month.';
COMMENT ON COLUMN public.equipment_cards.rate_unit IS
  '0136 / 0185: billing unit shared by purchasing and sales: month, week, day or hour (0185 added week). Default month.';
COMMENT ON COLUMN public.equipment_cards.client_price_unit IS
  '0185: the unit of the card''s own client price (client_price) — month, week, day or hour; default month (every card before 0185 is month). Written only by set_equipment_card_client_price (and its batch); locked while the pricing is approved.';
COMMENT ON COLUMN public.equipment_cards.client_price IS
  '0174 / 0185: the CLIENT''s rental price of the card excluding VAT, in the unit client_price_unit (0185; monthly until then); NULL = not priced yet. Written only by set_equipment_card_client_price (and the batch set_equipment_card_client_prices); locked while pricing_status = approved.';

-- ===========================================================================
-- A2. The PO line writers with the four units (copied verbatim otherwise)
-- ===========================================================================
-- add_supplier_po_equipment: copied from 0160 verbatim, the unit list widened.
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
  v_entry_date date;
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
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;
  -- 0160: an approved PO is locked (owner 2026-10-28): to change it, close
  -- it and create a new PO.
  IF v_po.approval_status = 'approved' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; close it and create a new one.';
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

  -- 0137: the unit must be inside the PO's company and project right now:
  -- its latest movement, in the chain's own order, is an open site ENTRY
  -- there. The key above is the sequence trigger's, so a movement being
  -- recorded at the same moment is serialised against this read.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND
     OR v_last.movement_type <> 'entry'
     OR v_last.movement_context <> 'site'
     OR v_last.company_id IS DISTINCT FROM v_po.company_id
     OR v_last.project_id IS DISTINCT FROM v_po.project_id THEN
    RAISE EXCEPTION 'equipment_not_at_po_project'
      USING ERRCODE = '55000',
            HINT = 'The equipment is not inside the PO''s company and project right now.';
  END IF;
  -- 0138: the card period starts on the day the unit entered (Saudi time).
  v_entry_date := (v_last.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;

  -- 0148: every unit of one PO entered on the same day, the PO's start date
  -- (owner 2026-10-25). create_supplier_po adds its units through here.
  IF v_entry_date <> v_po.start_date THEN
    RAISE EXCEPTION 'entry_date_mismatch'
      USING ERRCODE = '55000',
            HINT = 'The equipment entered the project on a day other than the PO start date.';
  END IF;

  -- Reuse the unit's card for this company and project when its period
  -- covers the entry date (an open end covers everything after it);
  -- otherwise open a new card from the entry date with the defaults.
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.period_from <= v_entry_date
    AND (c.period_to IS NULL OR c.period_to >= v_entry_date)
  ORDER BY c.period_from DESC
  LIMIT 1;

  IF v_card_id IS NULL THEN
    BEGIN
      INSERT INTO public.equipment_cards (
        equipment_id, company_id, project_id, period_from, created_by, entry_log_id
      ) VALUES (
        p_equipment_id, v_po.company_id, v_po.project_id, v_entry_date, auth.uid(), v_last.id
      )
      RETURNING id INTO v_card_id;
      v_card_created := true;
    EXCEPTION
      WHEN exclusion_violation THEN
        -- Another card of this unit (another company or project) already
        -- covers the entry date.
        RAISE EXCEPTION 'card_overlap'
          USING ERRCODE = '23P01',
                HINT = 'The equipment already has a card for another company or project in this period.';
    END;
  ELSE
    -- 0137: a reused card without a link gets this entry; a link is never
    -- overwritten.
    UPDATE public.equipment_cards
    SET entry_log_id = v_last.id
    WHERE id = v_card_id AND entry_log_id IS NULL;
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
      RAISE EXCEPTION 'equipment_already_on_open_po'
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
      'entry_log_id', v_last.id
    ),
    auth.uid()
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text) IS
  '0136/0137/0138/0148/0157/0160/0185: adds a unit of the PO''s party to an open, DRAFT supplier PO (an approved PO is locked: po_approved_locked), with or without a price (excluding VAT) per month, week, day or hour (p_rate_unit, default month; invalid_rate_unit), only while the unit is inside the PO''s company and project (its latest movement is an open site entry there) and only when that entry''s Saudi day is the PO start date (entry_date_mismatch), reusing or creating its equipment card from that entry''s date and recording the entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  TO authenticated;

-- update_supplier_po_equipment: copied from 0160 verbatim, the unit list widened.
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
  v_status text;
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

  SELECT p.status, p.approval_status INTO v_status, v_approval
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;
  -- 0160: an approved PO is locked (owner 2026-10-28).
  IF v_approval = 'approved' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; close it and create a new one.';
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
  '0142/0157/0160/0185: sets the price (NULL = unpriced), the note and the price unit (p_rate_unit month|week|day|hour, NULL = unchanged; invalid_rate_unit) of a line of an OPEN, DRAFT supplier PO in one call (an approved PO is locked: po_approved_locked); a price change is the event price_changed, a note- or unit-only change is line_updated. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  TO authenticated;

-- add_client_po_equipment: copied from 0169 verbatim, the unit list widened.
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
  v_entry_date date;
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

  -- The join rule of purchasing (0137): the unit must be inside the PO's
  -- company and project right now — its latest movement, in the chain's own
  -- order, is an open site ENTRY there. The key above is the sequence
  -- trigger's, so a movement being recorded at the same moment is serialised
  -- against this read.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND
     OR v_last.movement_type <> 'entry'
     OR v_last.movement_context <> 'site'
     OR v_last.company_id IS DISTINCT FROM v_po.company_id
     OR v_last.project_id IS DISTINCT FROM v_po.project_id THEN
    RAISE EXCEPTION 'equipment_not_at_po_project'
      USING ERRCODE = '55000',
            HINT = 'The equipment is not inside the PO''s company and project right now.';
  END IF;
  -- The card period starts on the day the unit entered (Saudi time). No
  -- same-day rule here: each line's period is its own card's.
  v_entry_date := (v_last.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;

  -- Reuse the unit's card for this company and project: the one created
  -- from this very entry (the supplier side's, 0137), else the one whose
  -- period covers the entry date (an open end covers everything after it).
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.entry_log_id = v_last.id
  LIMIT 1;

  IF v_card_id IS NULL THEN
    SELECT c.id INTO v_card_id
    FROM public.equipment_cards c
    WHERE c.equipment_id = p_equipment_id
      AND c.company_id = v_po.company_id
      AND c.project_id = v_po.project_id
      AND c.period_from <= v_entry_date
      AND (c.period_to IS NULL OR c.period_to >= v_entry_date)
    ORDER BY c.period_from DESC
    LIMIT 1;
  END IF;

  IF v_card_id IS NULL THEN
    -- Otherwise open a new card from the entry date, linked to the entry,
    -- with this line's unit and standard hours as the card's shared fields.
    BEGIN
      INSERT INTO public.equipment_cards (
        equipment_id, company_id, project_id, period_from, rate_unit, standard_hours,
        created_by, entry_log_id
      ) VALUES (
        p_equipment_id, v_po.company_id, v_po.project_id, v_entry_date, v_rate_unit, v_standard_hours,
        auth.uid(), v_last.id
      )
      RETURNING id INTO v_card_id;
      v_card_created := true;
    EXCEPTION
      WHEN exclusion_violation THEN
        -- Another card of this unit (another company or project) already
        -- covers the entry date.
        RAISE EXCEPTION 'card_overlap'
          USING ERRCODE = '23P01',
                HINT = 'The equipment already has a card for another company or project in this period.';
    END;
  ELSE
    -- A reused card without a link gets this entry; a link is never
    -- overwritten (0137).
    UPDATE public.equipment_cards
    SET entry_log_id = v_last.id
    WHERE id = v_card_id AND entry_log_id IS NULL;
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
      'entry_log_id', v_last.id
    )
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text) IS
  '0169/0185: adds a unit to an OPEN client PO with an optional sale price (excluding VAT) per month / week / day / hour (p_rate_unit, default month; invalid_rate_unit), the line''s standard hours (p_standard_hours, NULL = the PO''s default), an optional contract quantity and a note, only while the unit is inside the PO''s company and project (its latest movement is an open site entry there: equipment_not_at_po_project), reusing the unit''s card for that company and project (by entry_log_id, else by period) or creating it from that entry''s Saudi day. A card sits on at most one open client PO (equipment_already_on_open_client_po). Serialises on the unit''s advisory key. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  TO authenticated;

-- update_client_po_equipment: copied from 0169 verbatim, the unit list widened.
CREATE OR REPLACE FUNCTION public.update_client_po_equipment(
  p_line_id uuid,
  p_price numeric,
  p_rate_unit text DEFAULT NULL,
  p_standard_hours integer DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.client_po_equipment%ROWTYPE;
  v_status text;
  v_equipment_id uuid;
  v_note text;
  v_price_changed boolean;
  v_rate_unit text;
  v_standard_hours integer;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_line
  FROM public.client_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.status INTO v_status
  FROM public.client_pos p
  WHERE p.id = v_line.client_po_id
  FOR UPDATE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  -- NULL = «تحتاج سعر»: the price is a value, not "unchanged".
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  -- The unit and the standard hours are NOT NULL on the line: nothing given
  -- keeps the line's own. 0185: month, week, day or hour.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit);
  IF v_rate_unit NOT IN ('month', 'week', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;
  v_standard_hours := COALESCE(p_standard_hours, v_line.standard_hours);
  IF v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  -- The quantity and the note are values: NULL clears the ceiling / note.
  IF p_quantity IS NOT NULL AND (p_quantity <= 0 OR p_quantity > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  v_price_changed := p_price IS DISTINCT FROM v_line.price;
  IF NOT v_price_changed
     AND v_rate_unit = v_line.rate_unit
     AND v_standard_hours = v_line.standard_hours
     AND p_quantity IS NOT DISTINCT FROM v_line.quantity
     AND v_note IS NOT DISTINCT FROM v_line.note THEN
    RETURN;
  END IF;

  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;

  UPDATE public.client_po_equipment
  SET price = p_price,
      rate_unit = v_rate_unit,
      standard_hours = v_standard_hours,
      quantity = p_quantity,
      note = v_note
  WHERE id = v_line.id;

  PERFORM public.record_client_po_event(
    v_line.client_po_id,
    CASE WHEN v_price_changed THEN 'price_changed' ELSE 'line_updated' END,
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_equipment_id,
      'old_price', v_line.price,
      'new_price', p_price,
      'old_rate_unit', v_line.rate_unit,
      'new_rate_unit', v_rate_unit,
      'old_standard_hours', v_line.standard_hours,
      'new_standard_hours', v_standard_hours,
      'old_quantity', v_line.quantity,
      'new_quantity', p_quantity,
      'old_note', v_line.note,
      'new_note', v_note
    )
  );
END;
$$;

COMMENT ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text) IS
  '0169/0185: sets the sale price (NULL = unpriced), the price unit (p_rate_unit month|week|day|hour, NULL = unchanged; invalid_rate_unit), the standard hours (NULL = unchanged), the contract quantity (NULL = no ceiling) and the note of a line of an OPEN client PO in one call; a price change is the event price_changed, any other change is line_updated; the payload carries old and new. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text)
  TO authenticated;

-- ===========================================================================
-- A3. The card's client price with its unit
-- ===========================================================================
-- The old two-parameter signature is dropped first (see the header).
DROP FUNCTION public.set_equipment_card_client_price(uuid, numeric);

CREATE FUNCTION public.set_equipment_card_client_price(
  p_card_id uuid,
  p_price numeric,
  p_rate_unit text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.equipment_cards%ROWTYPE;
  v_price numeric(12, 2);
  v_unit text;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_card_id IS NULL THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- The card, locked first (approval and the batch queue here too).
  SELECT * INTO v_card
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- An approved pricing is locked: return it for editing first.
  IF v_card.pricing_status = 'approved' THEN
    RAISE EXCEPTION 'card_pricing_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'The card''s pricing is approved; return it for editing first.';
  END IF;

  -- NULL = no price; else numeric(12, 2) >= 0 (NaN is numeric too).
  IF p_price IS NOT NULL
     AND (p_price = 'NaN'::numeric OR p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  v_price := round(p_price, 2);

  -- 0185: the unit of the price; nothing given keeps the card's own.
  v_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_card.client_price_unit);
  IF v_unit NOT IN ('month', 'week', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;

  -- Nothing changed: no write, no event.
  IF v_price IS NOT DISTINCT FROM v_card.client_price
     AND v_unit = v_card.client_price_unit THEN
    RETURN;
  END IF;

  UPDATE public.equipment_cards
  SET client_price = v_price,
      client_price_unit = v_unit
  WHERE id = p_card_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'client_price_changed',
    jsonb_build_object(
      'old_price', v_card.client_price,
      'new_price', v_price,
      'old_unit', v_card.client_price_unit,
      'new_unit', v_unit
    )
  );
END;
$$;

COMMENT ON FUNCTION public.set_equipment_card_client_price(uuid, numeric, text) IS
  '0174/0185: sets the client''s rental price (excluding VAT) of one equipment card — NULL = no price, else 0 to 9999999999.99 (invalid_price) — and its unit (p_rate_unit month|week|day|hour, NULL = unchanged; invalid_rate_unit), unless the card''s pricing is approved (card_pricing_approved_locked); records the event client_price_changed {old_price, new_price, old_unit, new_unit} when the price or the unit changed (no event when unchanged). Locks the card row first. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.set_equipment_card_client_price(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_card_client_price(uuid, numeric, text) TO authenticated;

-- The batch: the 0174 body plus the optional "rate_unit" of each item.
CREATE OR REPLACE FUNCTION public.set_equipment_card_client_prices(
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_card_id uuid;
  v_count integer := 0;
BEGIN
  PERFORM public.assert_sales_manage();

  -- An array of {"card_id": uuid, "price": number | null,
  -- "rate_unit": text | null (0185, optional)}.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- In the array's order; one transaction, so a refused item (its own token)
  -- refuses the whole batch. An empty array writes nothing and returns 0.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS items(value, ord)
    ORDER BY ord
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item -> 'card_id') IS DISTINCT FROM 'string'
       OR COALESCE(jsonb_typeof(v_item -> 'price'), 'null') NOT IN ('number', 'null')
       OR COALESCE(jsonb_typeof(v_item -> 'rate_unit'), 'null') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_card_id := (v_item ->> 'card_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END;

    PERFORM public.set_equipment_card_client_price(
      v_card_id,
      (v_item ->> 'price')::numeric,
      v_item ->> 'rate_unit'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_equipment_card_client_prices(jsonb) IS
  '0174/0185: the batch save of the «اسعار المعدات» page: p_items is an array of {card_id, price|null, rate_unit|null (0185, optional: NULL or missing keeps the card''s unit)} (shape → invalid_items), each set through set_equipment_card_client_price in order inside ONE transaction, so any refused item refuses the whole batch with its own token. Returns the number of items processed (an empty array → 0). Needs sales.manage.';

REVOKE ALL ON FUNCTION public.set_equipment_card_client_prices(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_card_client_prices(jsonb) TO authenticated;

-- approve_equipment_card_pricing: copied from 0174 verbatim, the payload
-- gains client_price_unit (no new condition).
CREATE OR REPLACE FUNCTION public.approve_equipment_card_pricing(p_card_id uuid)
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

  -- The supplier line (the open PO's first, as the view does).
  SELECT sl.* INTO v_line
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = p_card_id
  ORDER BY (sp.status = 'open') DESC, sp.created_at DESC, sp.id DESC
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
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_line'
      USING ERRCODE = '55000',
            HINT = 'The card''s supplier PO is closed.';
  END IF;
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
  -- updated above) and the PO is an open draft, the PO becomes approved —
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
  '0174/0185: approves the pricing of one equipment card — needs sales.approve, a DRAFT card (card_pricing_not_draft) with a client price (card_pricing_no_client_price) and a priced supplier line on an OPEN supplier PO (card_pricing_no_supplier_line, card_pricing_no_supplier_price; 0 counts) — recording pricing_approved_at / _by and the event pricing_approved (0185: with client_price_unit; the units need not match). Then, when every line of that supplier PO sits on an approved card and the PO is an open draft, the PO itself becomes approved (0160 state, event approved {via: card_pricing}) without approve_supplier_po''s checks (owner 2026-11-04).';

REVOKE ALL ON FUNCTION public.approve_equipment_card_pricing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_card_pricing(uuid) TO authenticated;

-- ===========================================================================
-- B1. The days of a month record; the card events
-- ===========================================================================
ALTER TABLE public.equipment_card_months
  ADD COLUMN IF NOT EXISTS days numeric(5, 2)
    CONSTRAINT equipment_card_months_days_check
      CHECK (days IS NULL OR (days >= 0 AND days <= 31));

COMMENT ON COLUMN public.equipment_card_months.days IS
  '0185: the days recorded for the month (0 to 31, two decimals; NULL = not recorded), as the timesheet says. A daily price is due × days, a weekly price × days ÷ 7 (card_month_due).';

-- The card's audit gains the manual end and the reopening (0174's list
-- plus card_ended and card_reopened).
ALTER TABLE public.equipment_card_events
  DROP CONSTRAINT equipment_card_events_type_check;
ALTER TABLE public.equipment_card_events
  ADD CONSTRAINT equipment_card_events_type_check CHECK (
    event_type IN (
      'month_recorded', 'month_updated', 'month_deleted',
      'client_price_changed', 'pricing_approved', 'pricing_returned',
      'card_ended', 'card_reopened'
    )
  );

COMMENT ON TABLE public.equipment_card_events IS
  '0172 / 0174 / 0185: append-only audit of an equipment card — the month records (month_recorded, month_updated, month_deleted; payload month, hours, old_hours, days, old_days, note), the pricing (client_price_changed {old_price, new_price, old_unit, new_unit}, pricing_approved {client_price, client_price_unit, supplier_price, supplier_rate_unit, supplier_po_id, supplier_po_approved}, pricing_returned {note, supplier_po_returned}) and the period (card_ended {period_to, note}, card_reopened {old_period_to, note}) — with the actor and the actor''s name at the time. Read by sales.view or purchasing.view; written only by the card functions; no update or delete path. The card page orders by (created_at, seq) among the PO events.';

-- ===========================================================================
-- B2. record_equipment_card_month with the days
-- ===========================================================================
-- The old four-parameter signature is dropped first (see the header).
DROP FUNCTION public.record_equipment_card_month(uuid, date, numeric, text);

CREATE FUNCTION public.record_equipment_card_month(
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
  v_card_from date;
  v_card_to date;
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
  SELECT c.period_from, c.period_to INTO v_card_from, v_card_to
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- The month lies within the card's period, month to month in Saudi time:
  -- from the month of period_from to the month of period_to when set. An
  -- ended card still accepts its past months (the timesheet arrives late).
  v_month_from := date_trunc('month', v_card_from::timestamp)::date;
  v_month_to := CASE
    WHEN v_card_to IS NULL THEN NULL
    ELSE date_trunc('month', v_card_to::timestamp)::date
  END;
  IF v_month < v_month_from OR (v_month_to IS NOT NULL AND v_month > v_month_to) THEN
    RAISE EXCEPTION 'month_outside_card'
      USING ERRCODE = '55000',
            HINT = 'The month lies outside the card''s period.';
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
  '0172/0185: records the hours (and, since 0185, the optional days: 0 to 31, invalid_days) of ONE card for ONE Saudi month (p_month is normalised to the first of its month): insert → event month_recorded, an existing row → hours, days and note updated with the event month_updated carrying old_hours / old_days (no event when nothing changed). The month must lie within the card''s period (month_outside_card) and not after the current Saudi month (month_in_future); an ended card still takes its past months. Locks the card row first. Needs sales.manage. Returns the record id.';

REVOKE ALL ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text, numeric) TO authenticated;

-- The batch: the 0172 body plus the optional "days" of each item.
CREATE OR REPLACE FUNCTION public.record_equipment_card_months(
  p_month date,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_card_id uuid;
  v_count integer := 0;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;
  -- An array of {"card_id": uuid, "hours": number, "note": text | null,
  -- "days": number | null (0185, optional)}.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- In the array's order; one transaction, so a refused item (its own token)
  -- refuses the whole batch. An empty array records nothing and returns 0.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS items(value, ord)
    ORDER BY ord
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item -> 'card_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'hours') IS DISTINCT FROM 'number'
       OR COALESCE(jsonb_typeof(v_item -> 'note'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_item -> 'days'), 'null') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_card_id := (v_item ->> 'card_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END;

    PERFORM public.record_equipment_card_month(
      v_card_id,
      p_month,
      (v_item ->> 'hours')::numeric,
      v_item ->> 'note',
      (v_item ->> 'days')::numeric
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.record_equipment_card_months(date, jsonb) IS
  '0172/0185: the batch entry of one month for many cards (one project''s timesheet): p_items is an array of {card_id, hours, note|null, days|null (0185, optional)} (shape → invalid_items), each recorded through record_equipment_card_month in order inside ONE transaction, so any refused item refuses the whole batch with its own token. Returns the number of items recorded (an empty array → 0). Needs sales.manage.';

REVOKE ALL ON FUNCTION public.record_equipment_card_months(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_equipment_card_months(date, jsonb) TO authenticated;

-- ===========================================================================
-- B3. card_month_due per unit; the two 0172 views go first
-- ===========================================================================
-- The views call the four-argument card_month_due and select from
-- sales_equipment_cards; they are re-created below.
DROP VIEW public.sales_card_month_slots;
DROP VIEW public.sales_card_months;

DROP FUNCTION public.card_month_due(numeric, text, numeric, integer);

CREATE FUNCTION public.card_month_due(
  p_price numeric,
  p_rate_unit text,
  p_hours numeric,
  p_standard_hours integer,
  p_days numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_price IS NULL THEN NULL
    WHEN p_rate_unit = 'hour' THEN round(p_price * p_hours, 2)
    WHEN p_rate_unit = 'month' AND p_standard_hours > 0
      THEN round(p_price * p_hours / p_standard_hours, 2)
    WHEN p_rate_unit = 'day' THEN round(p_price * p_days, 2)
    WHEN p_rate_unit = 'week' THEN round(p_price * p_days / 7, 2)
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.card_month_due(numeric, text, numeric, integer, numeric) IS
  '0172/0185: the amount a month''s record is worth at one price — hour: price × hours; month: price × hours ÷ standard hours; day: price × days; week: price × days ÷ 7 (0185); unpriced, a missing hours / days figure or another unit: NULL; rounded to 2 decimals. Used by sales_card_months and sales_card_month_slots for the client due and the supplier due.';

REVOKE ALL ON FUNCTION public.card_month_due(numeric, text, numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.card_month_due(numeric, text, numeric, integer, numeric) TO authenticated;

-- ===========================================================================
-- A4. sales_equipment_cards: 0184 verbatim plus card_client_price_unit
-- ===========================================================================
-- Copied from 0184: every column in the same order, then the trailing unit;
-- the margin compares the card's client price with the supplier price only
-- when both are in the SAME unit (any of the four).
CREATE OR REPLACE VIEW public.sales_equipment_cards
WITH (security_invoker = true)
AS
SELECT
  -- The card.
  c.id AS card_id,
  c.equipment_id,
  c.company_id,
  c.project_id,
  c.period_from,
  c.period_to,
  (c.period_to IS NULL) AS is_open,
  c.rate_unit,
  c.standard_hours,
  c.note,
  c.entry_log_id,
  el.recorded_at AS entry_at,
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
  sp.supplier_po_status,
  sp.supplier_price,
  sp.supplier_rate_unit,
  (sp.supplier_po_id IS NOT NULL AND sp.supplier_po_status = 'open') AS has_supplier_po,
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
  -- 0185: the unit of the card's client price, at the END.
  c.client_price_unit AS card_client_price_unit
FROM public.equipment_cards c
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = e.lessor_id
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.projects pr ON pr.id = c.project_id
LEFT JOIN public.entry_exit_logs el ON el.id = c.entry_log_id
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
    sp2.status AS supplier_po_status,
    sl.price AS supplier_price,
    sl.rate_unit AS supplier_rate_unit,
    sp2.approval_status AS supplier_po_approval_status,
    sp2.updated_at AS supplier_po_updated_at
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp2 ON sp2.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = c.id
  ORDER BY (sp2.status = 'open') DESC, sp2.created_at DESC, sp2.id DESC
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
  '0169 / 0174 / 0184 / 0185: one row per equipment card («كرت المعدة») with the unit, the company and project, the period (is_open = period_to IS NULL), the entry it was created from (entry_log_id, entry_at) and both sides — the client PO line (id, number, status, price, unit, standard hours, quantity; has_client_po = an open one) and the supplier PO line (id, number, status, price, unit; has_supplier_po = an open one), each the open PO''s line first, else the latest — plus, since 0174 and only at the END (sales_card_months and sales_card_month_slots select from it): the card''s own client price card_client_price (excluding VAT), pricing_status / pricing_approved_at / pricing_approved_by / pricing_approved_by_name, card_margin (= card_client_price − supplier_price when both are set and card_client_price_unit = supplier_rate_unit, any of month / week / day / hour since 0185, else NULL) and card_margin_pct (over the client price, NULL when it is NULL or 0), and the supplier PO''s approval state supplier_po_approval_status; since 0184 client_po_updated_at, supplier_po_updated_at and last_modified_at (the latest of the card''s, the client PO''s and the supplier PO''s updated_at); since 0185 card_client_price_unit (the unit of card_client_price). security_invoker: sales.view or purchasing.view for the card, each side''s own key, movements RLS for the entry.';

REVOKE ALL ON public.sales_equipment_cards FROM PUBLIC, anon;
GRANT SELECT ON public.sales_equipment_cards TO authenticated;

-- ===========================================================================
-- B4. sales_card_months and sales_card_month_slots: copied from 0172, the
--     dues with the days, and the trailing days and presence_days
-- ===========================================================================
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
  sc.period_from,
  sc.period_to,
  sc.is_open,
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
  sc.supplier_po_status,
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
  '0172/0185: one row per RECORDED month of an equipment card («كروت التشغيل») with the card''s facts as sales_equipment_cards exposes them (the unit, the company and project, the period, the client line and the supplier line, owned = an Al-Azani unit) plus the hours, the note and the computed amounts: client_due and supplier_due through card_month_due (month: price × hours ÷ due_standard_hours — the client line''s standard hours, else the card''s; hour: price × hours; day: price × days; week: price × days ÷ 7; unpriced or a missing figure: NULL; owned or no supplier line: supplier_due NULL) and margin = client_due − COALESCE(supplier_due, 0), NULL without a client due. Since 0185, at the end: days (the recorded days) and presence_days (the distinct Saudi days of the month on which the unit was inside the card''s company and project, from movement_visits; 0 for a reader without the movement rights). Nothing is stored. security_invoker: sales.view or purchasing.view for the record and the card, each side''s own key for its line, movements RLS for presence_days.';

REVOKE ALL ON public.sales_card_months FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_months TO authenticated;

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
  sc.period_from,
  sc.period_to,
  sc.is_open,
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
  sc.supplier_po_status,
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
    date_trunc('month', sc.period_from::timestamp),
    LEAST(
      date_trunc('month', COALESCE(sc.period_to, (now() AT TIME ZONE 'Asia/Riyadh')::date)::timestamp),
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
  '0172/0185: every equipment card × every Saudi month from the month of its period_from to the smaller of the month of its period_to and the current Saudi month (generate_series, computed on read and bounded by the number of cards × their months — filter by month or by company and project), LEFT JOINed to the recorded hours: the columns of sales_card_months plus slot_id (card:YYYY-MM), recorded and month_id, with hours, note and the amounts NULL while the month is not recorded; since 0185, at the end, days (NULL while not recorded) and presence_days (the distinct Saudi days of the month on which the unit was inside the card''s company and project, from movement_visits, recorded or not; 0 for a reader without the movement rights). Feeds the «الشهور» list and the batch screen. security_invoker as sales_card_months.';

REVOKE ALL ON public.sales_card_month_slots FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_month_slots TO authenticated;

-- ===========================================================================
-- C. The manual card end and the reopening
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.end_equipment_card(
  p_card_id uuid,
  p_period_to date,
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
  v_today date;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_card_id IS NULL THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- The card, locked first (the month and pricing writers take it too).
  SELECT * INTO v_card
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;
  IF v_card.period_to IS NOT NULL THEN
    RAISE EXCEPTION 'card_already_ended'
      USING ERRCODE = '55000',
            HINT = 'The card is already ended.';
  END IF;

  -- The end day: from the card's first day to today (Saudi time).
  v_today := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  IF p_period_to IS NULL OR p_period_to < v_card.period_from OR p_period_to > v_today THEN
    RAISE EXCEPTION 'invalid_period_to' USING ERRCODE = '22023';
  END IF;

  -- No recorded month may lie after the month of the end day.
  IF EXISTS (
    SELECT 1
    FROM public.equipment_card_months m
    WHERE m.equipment_card_id = p_card_id
      AND m.month > date_trunc('month', p_period_to::timestamp)::date
  ) THEN
    RAISE EXCEPTION 'card_has_later_months'
      USING ERRCODE = '55000',
            HINT = 'The card has recorded months after the end day.';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  UPDATE public.equipment_cards
  SET period_to = p_period_to
  WHERE id = p_card_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'card_ended',
    jsonb_build_object('period_to', p_period_to, 'note', v_note)
  );
END;
$$;

COMMENT ON FUNCTION public.end_equipment_card(uuid, date, text) IS
  '0185 «انهاء الكرت» (manual, owner 2026-11-08): ends an OPEN equipment card on p_period_to — from its period_from to today in Saudi time (invalid_period_to), never before a recorded month (card_has_later_months), not twice (card_already_ended) — with an optional note (at most 500 characters: invalid_note) and the event card_ended {period_to, note}. Locks the card row first. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.end_equipment_card(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_equipment_card(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_equipment_card(
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
BEGIN
  PERFORM public.assert_sales_manage();

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
  IF v_card.period_to IS NULL THEN
    RAISE EXCEPTION 'card_not_ended'
      USING ERRCODE = '55000',
            HINT = 'The card is open.';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  BEGIN
    UPDATE public.equipment_cards
    SET period_to = NULL
    WHERE id = p_card_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      -- A later card of this unit starts after the end day (0136's
      -- equipment_cards_no_overlap).
      RAISE EXCEPTION 'card_overlap'
        USING ERRCODE = '23P01',
              HINT = 'The equipment has a later card; this card cannot be reopened.';
  END;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'card_reopened',
    jsonb_build_object('old_period_to', v_card.period_to, 'note', v_note)
  );
END;
$$;

COMMENT ON FUNCTION public.reopen_equipment_card(uuid, text) IS
  '0185: reopens an ENDED equipment card (card_not_ended when open): period_to back to NULL, refused when a later card of the unit would overlap (card_overlap), with an optional note (invalid_note) and the event card_reopened {old_period_to, note}. Locks the card row first. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.reopen_equipment_card(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_equipment_card(uuid, text) TO authenticated;

-- ===========================================================================
-- D. sales_cards_awaiting_end («معدات خرجت بانتهاء عمل وكرتها مفتوح»)
-- ===========================================================================
-- An open card whose unit's latest movement (both contexts, (recorded_at,
-- id) order, idx_entry_exit_logs_equipment_time of 0043) is a site exit
-- «انتهاء عمل» closing a visit in the card's company and project. The visit
-- is read with the unit and the site context, the partition keys of
-- movement_visits, so the filter reaches entry_exit_logs.
CREATE OR REPLACE VIEW public.sales_cards_awaiting_end
WITH (security_invoker = true)
AS
SELECT
  sc.card_id,
  sc.equipment_id,
  sc.equipment_code,
  sc.equipment_type,
  sc.equipment_plate_number,
  sc.equipment_chassis_number,
  sc.company_id,
  sc.company_name_ar,
  sc.company_name_en,
  sc.project_id,
  sc.project_name_ar,
  sc.project_name_en,
  sc.period_from,
  v.entry_id AS entry_log_id,
  v.entry_at,
  lm.id AS exit_log_id,
  lm.recorded_at AS exit_at,
  lm.supervisor_id AS exit_supervisor_id,
  pn.full_name AS exit_supervisor_name,
  sc.client_po_id,
  sc.client_po_number,
  sc.supplier_po_id,
  sc.supplier_po_number
FROM public.sales_equipment_cards sc
CROSS JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.exit_purpose,
    l.recorded_at,
    l.supervisor_id
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = sc.equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) lm
CROSS JOIN LATERAL (
  SELECT mv.entry_id, mv.entry_at
  FROM public.movement_visits mv
  WHERE mv.equipment_id = sc.equipment_id
    AND mv.movement_context = 'site'
    AND mv.exit_id = lm.id
    AND mv.company_id = sc.company_id
    AND mv.project_id = sc.project_id
  LIMIT 1
) v
LEFT JOIN public.profile_names pn ON pn.id = lm.supervisor_id
WHERE sc.is_open
  AND lm.movement_type = 'exit'
  AND lm.movement_context = 'site'
  AND lm.exit_purpose = 'work_completed';

COMMENT ON VIEW public.sales_cards_awaiting_end IS
  '0185 «معدات خرجت بانتهاء عمل وكرتها مفتوح»: every OPEN equipment card whose unit''s latest movement (both contexts, (recorded_at, id) order) is a SITE exit with exit_purpose work_completed closing a visit (movement_visits.exit_id) in the card''s company and project — the unit, the company and project, period_from, the visit''s entry (entry_log_id, entry_at), the exit (exit_log_id, exit_at), its recorder (exit_supervisor_id / exit_supervisor_name from profile_names) and the card''s client and supplier PO (id, number). Such a card is a candidate for end_equipment_card. Read only. security_invoker: sales.view or purchasing.view for the card, movements RLS for the movements (the latest movement is the latest the reader may see).';

REVOKE ALL ON public.sales_cards_awaiting_end FROM PUBLIC, anon;
GRANT SELECT ON public.sales_cards_awaiting_end TO authenticated;

NOTIFY pgrst, 'reload schema';
