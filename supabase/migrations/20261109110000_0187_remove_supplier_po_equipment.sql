-- 0187: remove a unit from a supplier PO (owner 2026-11-09, «حذف المعدة
-- بشرط مفتوح ومسودة»).
--
-- remove_supplier_po_equipment(p_line_id uuid, p_note text DEFAULT NULL)
--   * purchasing.manage (assert_purchasing_manage, 0136).
--   * Only while the line's PO is OPEN and a DRAFT: a closed PO is history
--     (po_closed), an approved PO is locked (po_approved_locked, 0160 —
--     return it to draft first, through the card pricing, 0174).
--   * Deletes the line. The 0146 trigger supplier_po_equipment_touch_po is
--     AFTER INSERT OR UPDATE OR DELETE, so the PO's updated_at moves.
--   * Writes the event equipment_removed {line_id, equipment_id,
--     equipment_code, card_id, price, rate_unit, line_note, note,
--     card_kept} (actor = auth.uid(); seq by the 0141 identity). The type
--     is ALREADY in supplier_po_events_type_check: 0149 added it for its
--     one-off fix and 0160, 0173 and 0174 kept it (0174's list is the
--     latest; 0185 and 0186 do not touch it), so the CHECK is NOT
--     re-created here.
--   * The card: when, after the delete, it has no supplier line (any PO,
--     open or closed), no client PO line (client_po_equipment), no month
--     record (equipment_card_months), no card event (equipment_card_events
--     — so never a priced, approved, returned, ended or reopened card),
--     pricing_status = 'draft' and client_price IS NULL, the card is
--     deleted too: it was only ever the shell add_supplier_po_equipment
--     created. Otherwise it stays (card_kept: true). Either way the unit
--     reads «بدون PO» on «المعدات في المشاريع»: purchasing_site_units
--     (0160/0169) derives supplier_po_id / has_po from the OPEN PO lines,
--     not from the card.
--   * Returns jsonb {line_id, card_id, card_deleted}.
--
-- Locks: the line row, then the PO row (the order update_supplier_po_equipment
-- takes), then the unit's advisory key (add_supplier_po_equipment takes it
-- before it looks a card up, so a concurrent add cannot reuse a card being
-- deleted), then the card row. Locking the PO before the line would invert
-- update_supplier_po_equipment's order.
--
-- Stable tokens:
--   purchasing_manage_required                42501
--   invalid_line / invalid_note               22023
--   po_closed / po_approved_locked            55000
--
-- Rollout: safe before the UI (a new function only; no table, view, policy
-- or CHECK changes).

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
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;
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
  '0187: removes a line from an OPEN, DRAFT supplier PO (po_closed, po_approved_locked; invalid_line, invalid_note > 500) and records equipment_removed {line_id, equipment_id, equipment_code, card_id, price, rate_unit, line_note, note, card_kept}. The card is deleted too when nothing else uses it (no supplier or client PO line, no month record, no card event, draft pricing, no client price), else kept. Returns {line_id, card_id, card_deleted}. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.remove_supplier_po_equipment(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_supplier_po_equipment(uuid, text)
  TO authenticated;
