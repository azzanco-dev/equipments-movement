-- 0142 — purchasing: edit an OPEN supplier PO and edit a line with its note.
--
-- Owner review 2026-10-22 of the purchasing screens (tasks 2 and 6):
--   * «تعديل الامر»: the start date and the notes of an open PO can be
--     changed (`update_supplier_po`), recorded as the event `updated` with
--     the old and new values. The party, company and project stay fixed (the
--     cards and the lines depend on them; a different project is a new PO).
--   * «تعديل المعدة»: editing a line sets its price AND its note in one call
--     (`update_supplier_po_equipment`); a price change is still the event
--     `price_changed` (its payload now also carries the notes), a note-only
--     change is the new event `line_updated`. The 0136/0138 function
--     `update_supplier_po_equipment_price` stays as it is.
--
-- Same shape as the 0136 writers: SECURITY DEFINER, fixed search_path,
-- `assert_purchasing_manage()` first, the PO row locked, stable tokens
-- (`invalid_po`, `po_closed`, `invalid_start_date`, `invalid_notes`,
-- `invalid_line`, `invalid_price`, `invalid_note`), executable by
-- `authenticated` only. Reads are unchanged.

-- ===========================================================================
-- A. The two new event types
-- ===========================================================================
ALTER TABLE public.supplier_po_events
  DROP CONSTRAINT supplier_po_events_type_check;
ALTER TABLE public.supplier_po_events
  ADD CONSTRAINT supplier_po_events_type_check CHECK (
    event_type IN (
      'created', 'updated',
      'equipment_added', 'price_changed', 'line_updated', 'card_changed',
      'closed'
    )
  );

-- ===========================================================================
-- B. update_supplier_po: the start date and the notes of an open PO
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
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'invalid_start_date' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
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
  '0142: changes the start date and the notes of an OPEN supplier PO and records old and new (event updated). The party, company and project never change. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po(uuid, date, text) TO authenticated;

-- ===========================================================================
-- C. update_supplier_po_equipment: a line's price AND note
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment(
  p_line_id uuid,
  p_price numeric,
  p_note text DEFAULT NULL
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
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_line
  FROM public.supplier_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.status INTO v_status
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;

  -- NULL = «تحتاج تسعير» (0138: prices are optional).
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  v_price_changed := p_price IS DISTINCT FROM v_line.price;
  IF NOT v_price_changed AND v_note IS NOT DISTINCT FROM v_line.note THEN
    RETURN;
  END IF;

  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;

  UPDATE public.supplier_po_equipment
  SET price = p_price,
      note = v_note
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
      'new_note', v_note
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text) IS
  '0142: sets the price (NULL = unpriced) and the note of a line of an OPEN supplier PO in one call; a price change is the event price_changed, a note-only change is line_updated. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text)
  TO authenticated;
