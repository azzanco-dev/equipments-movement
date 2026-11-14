-- 0194: a supplier PO's start date is free; a unit joins a PO through its
-- visit, not through the start date.
--
-- Owner decisions 2026-11-14: «خلي تاريخ البداية قابل للتعديل في نموذج
-- الانشاء». Asked which dates are allowed he chose «اي تاريخ» (any date,
-- before or after the units' entry; the form pre-fills the unit's entry
-- day), and he chose that the start date stays editable AFTER creation too,
-- in «تعديل الامر», for a DRAFT PO even when it has units. He did NOT choose
-- units with different entry days in one PO: that rule stays.
--
-- This reverses the 2026-10-25 rule of migration 0148 («نفس تاريخ الدخول»:
-- the PO's start date IS the Saudi entry day of its units). What stays of
-- 0148 is the other half: every unit of one PO entered the project on the
-- SAME Saudi day — now compared between the units themselves, not with the
-- start date.
--
-- A. add_supplier_po_equipment — new signature
--      (p_po_id uuid, p_equipment_id uuid, p_price numeric DEFAULT NULL,
--       p_note text DEFAULT NULL, p_rate_unit text DEFAULT 'month',
--       p_entry_log_id uuid DEFAULT NULL) RETURNS uuid
--    The five-argument function of 0189 is DROPPED first, so PostgREST never
--    sees two overloads; a caller with the five named parameters (the
--    screens live before this migration) resolves to the new function
--    through the default. The only database caller, create_supplier_po, is
--    re-created below. The 0189 body VERBATIM except how the visit is found:
--      * p_entry_log_id given → that row must be a SITE ENTRY of the unit in
--        the PO's company and project, else equipment_not_at_po_project.
--      * p_entry_log_id NULL → the unit's site entries in the PO's company
--        and project with NO day condition: first an entry on the entry day
--        of one of the PO's current lines (so a caller that passes no entry
--        still lands on the right visit), then the OPEN visit (the entry
--        that is the unit's latest movement), then the latest closed one
--        (recorded_at DESC, id DESC); none → equipment_not_at_po_project.
--      * The same-entry-day rule, detached from the start date: when the
--        PO already has lines whose cards carry an entry, the new unit's
--        entry Saudi day must equal the entry day of ONE of them (a few
--        pre-0148 POs hold units of several days, hence "one of"), else
--        entry_date_mismatch (55000). A PO without such lines accepts any
--        entry day. create_supplier_po adds its units one by one through
--        this function, so a new PO with units of two days is still refused
--        whole.
-- B. create_supplier_po — the 0193 body VERBATIM plus each item's optional
--    entry_log_id passed to the sixth parameter. p_start_date is only
--    required (invalid_start_date), compared with nothing.
-- C. update_supplier_po — the 0189 body VERBATIM minus the 0148 lock: on a
--    DRAFT PO the start date may be set to any date, with or without lines.
--    An APPROVED PO still refuses a start-date change (po_approved_locked);
--    the notes rule and the `updated` event are unchanged. The token
--    po_start_date_locked is raised by nothing any more.
-- D. guard_movement_with_po() — the 0193 body VERBATIM except one clause: a
--    change of the entry's Saudi DAY passed when every supplier PO of the
--    movement's cards started on the new day (the start date was the entry
--    day). The start date is now unrelated to the entry day, so a DAY change
--    is refused (movement_on_po, the same DETAIL) whenever a card of the
--    movement sits on a SUPPLIER PO line. A card only on a client PO keeps
--    the 0193 behaviour for the day; the unit / company / project rule and
--    everything else are unchanged. The trigger itself is not re-created.
-- E. The PO of a visit: purchasing_site_visits (latest body 0192) and
--    purchasing_site_units (latest body 0189) matched, besides the visit's
--    own card, a line through a PO whose START DATE was on or before the
--    visit's entry day, ordered by the latest start date. With a free start
--    date that fallback reads the line's CARD's entry instead
--    (equipment_cards.entry_log_id → entry_exit_logs): a line whose card's
--    entry is at or before THIS visit's entry in the chain's (recorded_at,
--    id) order (a PO of an earlier stay still covers the unit when it
--    returns after maintenance; a PO of a later visit never marks an older
--    one), ordered by the visit's own card first, then the latest card
--    entry, then the latest PO. The entry row is read under the reader's own
--    movement RLS, as the views already read movement_visits (and
--    sales_equipment_cards reads the card's entry): security_invoker is
--    kept and nothing SECURITY DEFINER is added. Every column, name, type
--    and position is identical (CREATE OR REPLACE VIEW); party_po_id /
--    party_po_number (the party's DRAFT PO there that starts on the entry
--    day, selected by no screen since 2026-11-12) are kept as they are.
--    Elsewhere: no other function or view compares a supplier PO's
--    start_date with an entry day (sales_equipment_cards and
--    purchasing_po_units only expose it; record_equipment_card_month and
--    sales_card_month_slots bound a card's months by its visit since 0189).
--
-- Stable tokens: unchanged — equipment_not_at_po_project (55000),
-- entry_date_mismatch (55000, now: another day than the PO's units),
-- po_approved_locked (55000), movement_on_po (55000). Retired:
-- po_start_date_locked (raised by nothing).
--
-- No new permission key. Every function: SECURITY DEFINER, SET search_path =
-- public, pg_temp; the callable ones REVOKE ALL FROM PUBLIC, anon, GRANT
-- EXECUTE TO authenticated, a COMMENT; the trigger function stays
-- executable by nobody.
--
-- Rollout: apply 0194 BEFORE deploying the screens that send p_entry_log_id
-- or edit the start date of a PO with units. The screens live before it
-- keep working on both sides of it (their five named parameters resolve to
-- the new function; they lock the start date themselves).

-- ===========================================================================
-- A. add_supplier_po_equipment
-- ===========================================================================
DROP FUNCTION IF EXISTS public.add_supplier_po_equipment(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment(
  p_po_id uuid,
  p_equipment_id uuid,
  p_price numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rate_unit text DEFAULT 'month',
  p_entry_log_id uuid DEFAULT NULL
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

  -- 0194 (owner 2026-11-14, «خلي تاريخ البداية قابل للتعديل»): the unit
  -- joins through a SITE VISIT of the PO's company and project, open or
  -- closed (0188), found WITHOUT the PO start date (0148 matched the entry
  -- day to it). The visit is the given entry (p_entry_log_id), else the
  -- entry on the entry day of one of the PO's current lines, then the open
  -- visit (the entry that is the unit's latest movement, in the chain's own
  -- order), then the latest closed one. The key above is the sequence
  -- trigger's, so a movement being recorded at the same moment is
  -- serialised against these reads.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  IF p_entry_log_id IS NOT NULL THEN
    SELECT l.* INTO v_entry
    FROM public.entry_exit_logs l
    WHERE l.id = p_entry_log_id
      AND l.equipment_id = p_equipment_id
      AND l.movement_type = 'entry'
      AND l.movement_context = 'site'
      AND l.company_id = v_po.company_id
      AND l.project_id = v_po.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'equipment_not_at_po_project'
        USING ERRCODE = '55000',
              HINT = 'The given entry is not a site entry of the equipment in the PO''s company and project.';
    END IF;
  ELSE
    SELECT l.* INTO v_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
      AND l.movement_type = 'entry'
      AND l.movement_context = 'site'
      AND l.company_id = v_po.company_id
      AND l.project_id = v_po.project_id
    ORDER BY EXISTS (
               SELECT 1
               FROM public.supplier_po_equipment pl
               JOIN public.equipment_cards pc ON pc.id = pl.equipment_card_id
               JOIN public.entry_exit_logs pe ON pe.id = pc.entry_log_id
               WHERE pl.supplier_po_id = v_po.id
                 AND (pe.recorded_at AT TIME ZONE 'Asia/Riyadh')::date
                   = (l.recorded_at AT TIME ZONE 'Asia/Riyadh')::date
             ) DESC,
             -- A caller that names no entry (the screens deployed before
             -- 0194, whose start date IS the ticked visit's entry day) still
             -- lands on that visit, not on a later one of the same unit.
             ((l.recorded_at AT TIME ZONE 'Asia/Riyadh')::date = v_po.start_date) DESC,
             (l.id IS NOT DISTINCT FROM v_last.id) DESC, l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'equipment_not_at_po_project'
        USING ERRCODE = '55000',
              HINT = 'The equipment has no visit in the PO''s company and project.';
    END IF;
  END IF;

  -- 0148 kept, detached from the start date (0194): every unit of one PO
  -- entered on the same Saudi day — the new unit's entry day must be the
  -- entry day of ONE of the PO's current lines (their cards' entries). A PO
  -- without such lines accepts any day.
  IF EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment pl
    JOIN public.equipment_cards pc ON pc.id = pl.equipment_card_id
    JOIN public.entry_exit_logs pe ON pe.id = pc.entry_log_id
    WHERE pl.supplier_po_id = v_po.id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment pl
    JOIN public.equipment_cards pc ON pc.id = pl.equipment_card_id
    JOIN public.entry_exit_logs pe ON pe.id = pc.entry_log_id
    WHERE pl.supplier_po_id = v_po.id
      AND (pe.recorded_at AT TIME ZONE 'Asia/Riyadh')::date
        = (v_entry.recorded_at AT TIME ZONE 'Asia/Riyadh')::date
  ) THEN
    RAISE EXCEPTION 'entry_date_mismatch'
      USING ERRCODE = '55000',
            HINT = 'The equipment entered the project on a day other than the PO''s units.';
  END IF;

  -- 0189 (owner 2026-11-11): the card is the unit's VISIT in the PO's
  -- company and project — the card created from this very entry, else a new
  -- card linked to it. A card has no period any more, so there is no
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

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text, uuid) IS
  '0136/0137/0138/0148/0157/0160/0185/0188/0189/0194: adds a unit of the PO''s party to a DRAFT supplier PO (an approved PO is locked: po_approved_locked), with or without a price (excluding VAT) per month, week, day or hour (p_rate_unit, default month; invalid_rate_unit), through a site visit of the unit in the PO''s company and project, open or closed (0188). 0194: the visit no longer follows the PO start date (which is free) — it is p_entry_log_id when given (a site entry of the unit in the PO''s company and project, else equipment_not_at_po_project), else the unit''s entry there on the entry day of one of the PO''s lines, then the open visit, then the latest closed one (none: equipment_not_at_po_project); the new unit''s entry day must be the entry day of one of the PO''s current lines (entry_date_mismatch; a PO without lines accepts any day). 0189: the card is that visit''s (the card linked to the entry, else a new one linked to it) and the unit may already sit on other POs — only the same card twice on this PO is refused (equipment_already_on_po). Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text, uuid)
  TO authenticated;

-- ===========================================================================
-- B. create_supplier_po: 0193 verbatim plus each item's entry_log_id
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
  -- 0193 (owner 2026-11-12, «حلو يصير لازم يكون فيه معدة»): a PO is created
  -- with at least one unit; checked before the draft reference is consumed.
  IF p_equipment IS NULL OR jsonb_array_length(p_equipment) = 0 THEN
    RAISE EXCEPTION 'po_has_no_lines'
      USING ERRCODE = '55000',
            HINT = 'A purchase order needs at least one unit.';
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
  -- null or missing = month). 0194: and "entry_log_id": uuid|null, the
  -- unit's visit (null or missing = found by add_supplier_po_equipment).
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_supplier_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      v_item->>'note',
      NULLIF(v_item->>'rate_unit', ''),
      NULLIF(v_item->>'entry_log_id', '')::uuid
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138/0139/0148/0157/0189/0190/0193/0194: creates a supplier PO (a draft; no open / closed state since 0189) for a party (a lessor OR an owner class) under a DRAFT REFERENCE (DRAFT-####, 0190: the official PO number is issued at its first approval) and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note, rate_unit month|week|day|hour, entry_log_id|null (0194: the unit''s visit)}], at least one since 0193 — po_has_no_lines otherwise, before the reference is taken) through add_supplier_po_equipment, so every unit must have entered on the same Saudi day (entry_date_mismatch rolls the whole call back); a unit may already sit on other POs. Since 0194 the start date is free (any date; only required: invalid_start_date). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- C. update_supplier_po: 0189 verbatim minus the start-date lock
-- ===========================================================================
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

  -- 0194 (owner 2026-11-14, «اي تاريخ»): the 0148 lock is gone — on a
  -- draft the start date may be any date, with or without lines.

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
  '0142/0148/0160/0189/0194: changes the start date and the notes of a supplier PO and records old and new (event updated). Since 0194 the start date of a DRAFT may be any date, with or without lines (the 0148 lock po_start_date_locked is gone); on an APPROVED PO only the notes change (po_approved_locked). The party, company and project never change. A PO has no open / closed state (0189). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po(uuid, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po(uuid, date, text)
  TO authenticated;

-- ===========================================================================
-- D. guard_movement_with_po: 0193 verbatim, the day clause changed
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.guard_movement_with_po()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_day date;
  v_new_day date;
  v_site_entry boolean;
  v_numbers text;
  v_inconsistent boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_day := (OLD.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;
    v_new_day := (NEW.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;
    -- The cheap exit: no locked fact changes.
    IF NEW.equipment_id IS NOT DISTINCT FROM OLD.equipment_id
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.movement_type IS NOT DISTINCT FROM OLD.movement_type
       AND NEW.movement_context IS NOT DISTINCT FROM OLD.movement_context
       AND v_new_day IS NOT DISTINCT FROM v_old_day THEN
      RETURN NEW;
    END IF;
  END IF;

  -- No card from this movement: nothing to guard (every exit, every
  -- workshop row, most entries).
  IF NOT EXISTS (
    SELECT 1 FROM public.equipment_cards c WHERE c.entry_log_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- The sequence trigger's key of the unit(s), in uuid order (re-entrant:
  -- the admin functions already hold it), then the cards themselves.
  IF TG_OP = 'UPDATE' AND NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
    IF NEW.equipment_id < OLD.equipment_id THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
  END IF;

  PERFORM 1
  FROM public.equipment_cards c
  WHERE c.entry_log_id = OLD.id
  ORDER BY c.id
  FOR UPDATE;

  -- The PO numbers of the movement's cards: supplier first, then client.
  SELECT NULLIF(concat_ws(', ',
    (SELECT string_agg(DISTINCT sp.po_number, ', ' ORDER BY sp.po_number)
     FROM public.equipment_cards c
     JOIN public.supplier_po_equipment sl ON sl.equipment_card_id = c.id
     JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
     WHERE c.entry_log_id = OLD.id),
    (SELECT string_agg(DISTINCT cp.po_number, ', ' ORDER BY cp.po_number)
     FROM public.equipment_cards c
     JOIN public.client_po_equipment cl ON cl.equipment_card_id = c.id
     JOIN public.client_pos cp ON cp.id = cl.client_po_id
     WHERE c.entry_log_id = OLD.id)
  ), '')
  INTO v_numbers;

  IF TG_OP = 'DELETE' THEN
    IF v_numbers IS NOT NULL THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = v_numbers,
              HINT = 'The unit of this movement sits on a purchase order; remove it from the PO first.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.equipment_cards c
      JOIN public.equipment_card_months m ON m.equipment_card_id = c.id
      WHERE c.entry_log_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = 'card months',
              HINT = 'The card of this movement has recorded months; delete them first.';
    END IF;
    -- Cards on no PO and without months: they go with their visit (their
    -- equipment_card_events cascade).
    DELETE FROM public.equipment_cards c WHERE c.entry_log_id = OLD.id;
    RETURN OLD;
  END IF;

  -- UPDATE with a changed locked fact.
  v_site_entry := NEW.movement_type = 'entry'
    AND NEW.movement_context = 'site'
    AND NEW.company_id IS NOT NULL
    AND NEW.project_id IS NOT NULL;

  IF v_numbers IS NOT NULL THEN
    -- The cards on a PO must already match the new row (a data fix moves
    -- the PO and the card first, then the movement, in one transaction).
    SELECT
      NOT v_site_entry
      OR EXISTS (
        SELECT 1
        FROM public.equipment_cards c
        WHERE c.entry_log_id = OLD.id
          AND (
            EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
            OR EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id)
          )
          AND (
            c.equipment_id IS DISTINCT FROM NEW.equipment_id
            OR c.company_id IS DISTINCT FROM NEW.company_id
            OR c.project_id IS DISTINCT FROM NEW.project_id
          )
      )
      -- 0194: the PO start date is free, so it no longer tells whether a
      -- new entry day is consistent: a day change is refused whenever a
      -- card of the movement sits on a supplier PO line.
      OR (
        v_new_day IS DISTINCT FROM v_old_day
        AND EXISTS (
          SELECT 1
          FROM public.equipment_cards c
          JOIN public.supplier_po_equipment sl ON sl.equipment_card_id = c.id
          WHERE c.entry_log_id = OLD.id
        )
      )
    INTO v_inconsistent;

    IF v_inconsistent THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = v_numbers,
              HINT = 'The unit of this movement sits on a purchase order; its unit, company, project, type and day are locked.';
    END IF;
  END IF;

  -- The cards on NO PO follow the movement.
  IF NOT v_site_entry THEN
    IF EXISTS (
      SELECT 1
      FROM public.equipment_cards c
      JOIN public.equipment_card_months m ON m.equipment_card_id = c.id
      WHERE c.entry_log_id = OLD.id
        AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id)
    ) THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = 'card months',
              HINT = 'The card of this movement has recorded months; delete them first.';
    END IF;
    DELETE FROM public.equipment_cards c
    WHERE c.entry_log_id = OLD.id
      AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id);
  ELSE
    UPDATE public.equipment_cards c
    SET equipment_id = NEW.equipment_id,
        company_id = NEW.company_id,
        project_id = NEW.project_id
    WHERE c.entry_log_id = OLD.id
      AND (
        c.equipment_id IS DISTINCT FROM NEW.equipment_id
        OR c.company_id IS DISTINCT FROM NEW.company_id
        OR c.project_id IS DISTINCT FROM NEW.project_id
      )
      AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_movement_with_po() IS
  '0193/0194 (owner 2026-11-12, «حلو قفل الحركة, اعتمده»): BEFORE UPDATE OR DELETE trigger function of entry_exit_logs. A movement whose card (equipment_cards.entry_log_id) sits on a supplier or client PO cannot be deleted, nor change its unit, company, project, type or context unless the cards on a PO already match the new row: movement_on_po (55000), DETAIL = the PO numbers (supplier, then client). Its Saudi day cannot change while a card of it sits on a SUPPLIER PO line (0194: the PO start date is free, so it no longer vouches for the day); a card only on a client PO lets the day change. A card on no PO follows the movement (unit, company, project), or is deleted with it / when the row stops being a site entry; one with month records refuses (movement_on_po, DETAIL card months). Any other update returns at once.';

REVOKE ALL ON FUNCTION public.guard_movement_with_po() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- E1. purchasing_site_visits: 0192 verbatim, the PO of a visit by the card's
--     entry instead of the start date
-- ===========================================================================
CREATE OR REPLACE VIEW public.purchasing_site_visits
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
  -- The supplier PO of the visit (0189; 0194: an earlier visit's PO by its
  -- card's entry, see the join below).
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
  v.exit_purpose,
  -- 0192: appended; everything above is 0189 verbatim. When the visit's
  -- ENTRY was registered in the system (movement_visits, 0159).
  v.entry_created_at
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else (0194)
  -- through a card whose ENTRY is at or before this visit's entry in the
  -- chain's (recorded_at, id) order (a PO of an earlier stay still covers
  -- the unit when it returns; a PO of a LATER visit never marks an older
  -- one; the start date is free since 0194 and says nothing about the
  -- visit). The visit's own card first, then the latest card entry, then
  -- the latest PO. The card's entry is read under the reader's movement RLS.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  LEFT JOIN public.entry_exit_logs ce ON ce.id = c.entry_log_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR (ce.recorded_at, ce.id) <= (v.entry_at, v.entry_id)
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           ce.recorded_at DESC NULLS LAST, ce.id DESC NULLS LAST,
           p.created_at DESC, p.id DESC
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
  '0188/0189/0192/0194: every SITE visit of movement_visits, open or closed, with the supplier PO of the visit (supplier_po_id, po_number, has_po) — a line of the unit on a PO of that company and project through the visit''s own card, else (0194) through a card whose entry is at or before the visit''s entry in (recorded_at, id) order (the visit''s card first, then the latest card entry, then the latest PO; a supplier PO has no open / closed state and its start date is free since 0194) —, else the DRAFT PO of its party there whose start date is the visit''s entry day that it can join (party_po_id, party_po_number), the client columns of 0169 (the open client PO; a closed visit only through its own card) and visit_state (inside / exited), exit_at and exit_purpose; since 0192 also entry_created_at, when the visit''s entry was registered in the system. The «المعدات في المشاريع» page. security_invoker: movements RLS (also for the cards'' entries), purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_visits FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_visits TO authenticated;

-- ===========================================================================
-- E2. purchasing_site_units: 0189 verbatim, the same PO rule as E1
-- ===========================================================================
CREATE OR REPLACE VIEW public.purchasing_site_units
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
  -- company and project, through the card of this very visit, else (0194)
  -- through a card whose ENTRY is at or before this visit's entry in the
  -- chain's (recorded_at, id) order (a PO of an earlier stay still covers
  -- the unit when it returns; a PO of a LATER visit never marks an older
  -- one; the start date is free since 0194 and says nothing about the
  -- visit). The visit's own card first, then the latest card entry, then
  -- the latest PO. The card's entry is read under the reader's movement RLS.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  LEFT JOIN public.entry_exit_logs ce ON ce.id = c.entry_log_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR (ce.recorded_at, ce.id) <= (v.entry_at, v.entry_id)
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           ce.recorded_at DESC NULLS LAST, ce.id DESC NULLS LAST,
           p.created_at DESC, p.id DESC
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
  '0147/0148/0160/0169/0189/0194: the units inside a project now (open site visits of movement_visits) with the supplier PO of the visit (supplier_po_id, po_number, has_po) — as purchasing_site_visits finds it: through the visit''s own card, else (0194) through a card whose entry is at or before the visit''s entry (a supplier PO has no open / closed state and its start date is free since 0194) —, else the DRAFT PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number); and (0169) the open client PO they sit on there (client_po_id, client_po_number, has_client_po), else the open client PO of that company and project they can join (project_client_po_id, project_client_po_number). The inquiry''s PO card reads it. security_invoker: movements RLS (also for the cards'' entries), purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;

-- ===========================================================================
-- F. The closing guard
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '0194: the five-argument add_supplier_po_equipment is still there';
  END IF;
  IF to_regprocedure('public.add_supplier_po_equipment(uuid, uuid, numeric, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION '0194: add_supplier_po_equipment(uuid, uuid, numeric, text, text, uuid) is missing';
  END IF;
  IF position('po_start_date_locked' IN pg_get_functiondef(
       'public.update_supplier_po(uuid, date, text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '0194: update_supplier_po still locks the start date';
  END IF;
  IF position('entry_log_id' IN pg_get_functiondef(
       'public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0194: create_supplier_po does not pass the entry_log_id';
  END IF;
  IF position('sp.start_date' IN pg_get_functiondef(
       'public.guard_movement_with_po()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '0194: guard_movement_with_po still compares the PO start date';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
