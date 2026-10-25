-- 0149 — purchasing: reopen SPO260001 and SPO260002, once.
--
-- Owner request 2026-10-25 («SPO260001 / SPO260002 ابغاك ترجع تفتحها»,
-- then «أ / مرة وحدة»): a one-off data fix, no reopen function and no
-- button. Both were closed on 2026-10-20.
--   * SPO260001 (شركة حلم للمقاولات العامة, اكسبو) has no lines: it is
--     reopened as it is.
--   * SPO260002 (مؤسسة صدى التطوير للنقليات, KKR) has one line, U175, whose
--     card has sat on the open SPO260046 since 2026-10-25. A card is on at
--     most one open PO (supplier_po_equipment_single_open), so the owner
--     chose option (أ): the U175 line leaves SPO260002 (the card and its
--     line on SPO260046 stay untouched) and the PO is reopened empty.
--
-- The audit stays append-only: two new event types, `equipment_removed`
-- (payload: the unit's id and code, the card, the price) and `reopened`,
-- written with no actor (a migration has no auth.uid()). Every step checks
-- the state it expects and aborts the whole migration otherwise, so nothing
-- changes if the data moved since it was written.

-- ===========================================================================
-- A. The two new event types (the 0142 list plus two)
-- ===========================================================================
ALTER TABLE public.supplier_po_events
  DROP CONSTRAINT supplier_po_events_type_check;
ALTER TABLE public.supplier_po_events
  ADD CONSTRAINT supplier_po_events_type_check CHECK (
    event_type IN (
      'created', 'updated',
      'equipment_added', 'price_changed', 'line_updated', 'card_changed',
      'equipment_removed',
      'closed', 'reopened'
    )
  );

-- ===========================================================================
-- B. The fix
-- ===========================================================================
DO $$
DECLARE
  v_po1 public.supplier_pos%ROWTYPE;
  v_po2 public.supplier_pos%ROWTYPE;
  v_line public.supplier_po_equipment%ROWTYPE;
  v_equipment_id uuid;
  v_code text;
  v_lines integer;
BEGIN
  SELECT * INTO v_po1 FROM public.supplier_pos
  WHERE po_number = 'SPO260001' FOR UPDATE;
  SELECT * INTO v_po2 FROM public.supplier_pos
  WHERE po_number = 'SPO260002' FOR UPDATE;
  IF v_po1.id IS NULL OR v_po2.id IS NULL THEN
    RAISE EXCEPTION '0149: SPO260001 or SPO260002 not found';
  END IF;
  IF v_po1.status <> 'closed' OR v_po2.status <> 'closed' THEN
    RAISE EXCEPTION '0149: SPO260001 and SPO260002 must both be closed';
  END IF;

  -- SPO260001: no lines.
  SELECT count(*) INTO v_lines FROM public.supplier_po_equipment
  WHERE supplier_po_id = v_po1.id;
  IF v_lines <> 0 THEN
    RAISE EXCEPTION '0149: SPO260001 has % lines, expected none', v_lines;
  END IF;

  -- SPO260002: exactly one line, U175, whose card is on another open PO.
  SELECT count(*) INTO v_lines FROM public.supplier_po_equipment
  WHERE supplier_po_id = v_po2.id;
  IF v_lines <> 1 THEN
    RAISE EXCEPTION '0149: SPO260002 has % lines, expected one', v_lines;
  END IF;
  SELECT * INTO v_line FROM public.supplier_po_equipment
  WHERE supplier_po_id = v_po2.id FOR UPDATE;
  SELECT c.equipment_id, e.code INTO v_equipment_id, v_code
  FROM public.equipment_cards c
  JOIN public.equipment e ON e.id = c.equipment_id
  WHERE c.id = v_line.equipment_card_id;
  IF v_code IS DISTINCT FROM 'U175' THEN
    RAISE EXCEPTION '0149: the SPO260002 line is %, expected U175', v_code;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment o
    JOIN public.supplier_pos p ON p.id = o.supplier_po_id
    WHERE o.equipment_card_id = v_line.equipment_card_id
      AND o.id <> v_line.id
      AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION '0149: U175 is no longer on another open PO; nothing to remove';
  END IF;

  -- SPO260002: the U175 line leaves (option أ); the card stays.
  DELETE FROM public.supplier_po_equipment WHERE id = v_line.id;
  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_po2.id,
    'equipment_removed',
    jsonb_build_object(
      'equipment_id', v_equipment_id,
      'equipment_code', v_code,
      'equipment_card_id', v_line.equipment_card_id,
      'price', v_line.price,
      'reason', '0149: on the open SPO260046'
    ),
    NULL
  );

  -- Both reopen.
  UPDATE public.supplier_pos
  SET status = 'open', closed_at = NULL
  WHERE id IN (v_po1.id, v_po2.id);
  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES
    (v_po1.id, 'reopened', jsonb_build_object('closed_at', v_po1.closed_at), NULL),
    (v_po2.id, 'reopened', jsonb_build_object('closed_at', v_po2.closed_at), NULL);
END;
$$;
