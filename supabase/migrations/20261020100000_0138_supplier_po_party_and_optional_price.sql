-- 0138: the PO's party (a supplier OR an owner class), optional prices,
-- the PO created with its equipment in one call, card periods from the entry.
--
-- Owner review of the first purchasing screens, 2026-10-20:
--
--   1. «لا قاعدة صفر اجباري»: any unit may carry a price or none for now.
--      `supplier_po_equipment.price` becomes NULLable (a line without a
--      price = «تحتاج سعر»); the internal-zero rule of 0136 is dropped from
--      add_supplier_po_equipment and update_supplier_po_equipment_price
--      (is_internal_equipment() stays, unused by any rule). The computed
--      column `unpriced_count(supplier_pos)` serves the «تحتاج اسعار» badge
--      and filter.
--   2. No new supplier rows for Al-Azani, Takween, F and B: a PO's party is
--      EITHER a lessor (`lessor_id`) OR an owner class (`owner_class`:
--      alazani / takween / third_party_f / third_party_partnership_b),
--      exactly one. A unit belongs to the party when its `lessor_id` is the
--      PO's lessor, or its `ownership_status` is the PO's class (token
--      `equipment_not_of_po_supplier`). `is_internal` stays only as a
--      compatibility flag (true for the alazani class), no rule reads it.
--   3. The PO is created WITH its equipment in one call (`p_equipment`
--      jsonb on create_supplier_po), so a half-created PO never consumes a
--      number: the whole call succeeds or nothing is written.
--   4. The card period starts at the unit's ENTRY date (the open site entry
--      0137 already requires), not at the PO start date; the PO start date
--      is the screen's suggestion (the earliest entry) and stays editable.
--
-- Movements, their triggers and policies are untouched; the purchasing
-- tables keep their 0136 policies.

-- ===========================================================================
-- 1. Optional price
-- ===========================================================================
ALTER TABLE public.supplier_po_equipment
  ALTER COLUMN price DROP NOT NULL;

COMMENT ON COLUMN public.supplier_po_equipment.price IS
  '0138: the rental price excluding VAT, or NULL while the price is still to be entered («تحتاج سعر»). numeric(12, 2) >= 0.';

CREATE OR REPLACE FUNCTION public.unpriced_count(po public.supplier_pos)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.supplier_po_equipment l
  WHERE l.supplier_po_id = po.id
    AND l.price IS NULL;
$$;

COMMENT ON FUNCTION public.unpriced_count(public.supplier_pos) IS
  '0138: PostgREST computed column of supplier_pos — how many of the PO''s lines still have no price (the «تحتاج اسعار» badge and filter). Runs as the caller: RLS of the lines applies.';

REVOKE ALL ON FUNCTION public.unpriced_count(public.supplier_pos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpriced_count(public.supplier_pos) TO authenticated;

-- ===========================================================================
-- 2. The party: a lessor or an owner class
-- ===========================================================================
ALTER TABLE public.supplier_pos
  ADD COLUMN IF NOT EXISTS owner_class text
    CONSTRAINT supplier_pos_owner_class_check CHECK (
      owner_class IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b')
    );

-- A 0136/0137 internal PO (no lessor) is an Al-Azani PO.
UPDATE public.supplier_pos
SET owner_class = 'alazani'
WHERE lessor_id IS NULL AND owner_class IS NULL;

ALTER TABLE public.supplier_pos
  DROP CONSTRAINT IF EXISTS supplier_pos_lessor_check;
ALTER TABLE public.supplier_pos
  ADD CONSTRAINT supplier_pos_party_check
    CHECK ((lessor_id IS NOT NULL) <> (owner_class IS NOT NULL));

COMMENT ON COLUMN public.supplier_pos.owner_class IS
  '0138: the PO''s party when it is an owner class rather than a lessor row (alazani / takween / third_party_f / third_party_partnership_b). Exactly one of lessor_id and owner_class is set.';
COMMENT ON COLUMN public.supplier_pos.is_internal IS
  '0136; since 0138 a compatibility flag only (true for the alazani class): no rule reads it.';

CREATE INDEX IF NOT EXISTS supplier_pos_owner_class_idx
  ON public.supplier_pos (owner_class)
  WHERE owner_class IS NOT NULL;

-- ===========================================================================
-- 3. add_supplier_po_equipment: 0137 body minus the internal-zero rule, plus
--    the party check, the optional price and the entry-based card period
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment(
  p_po_id uuid,
  p_equipment_id uuid,
  p_price numeric DEFAULT NULL,
  p_note text DEFAULT NULL
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
      supplier_po_id, equipment_card_id, price, note
    ) VALUES (
      v_po.id, v_card_id, p_price, NULLIF(btrim(p_note), '')
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
      'entry_log_id', v_last.id
    ),
    auth.uid()
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text) IS
  '0136/0137/0138: adds a unit of the PO''s party to an open supplier PO, with or without a price (excluding VAT), only while the unit is inside the PO''s company and project (its latest movement is an open site entry there), reusing or creating its equipment card from that entry''s date and recording the entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  TO authenticated;

-- ===========================================================================
-- 4. create_supplier_po: the party, and the equipment in the same call
-- ===========================================================================
DROP FUNCTION IF EXISTS public.create_supplier_po(uuid, uuid, uuid, date, text);

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

  v_number := public.next_supplier_po_number();

  INSERT INTO public.supplier_pos (
    po_number, lessor_id, owner_class, is_internal, company_id, project_id,
    start_date, notes, created_by
  ) VALUES (
    v_number, p_lessor_id, p_owner_class, p_owner_class = 'alazani',
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
  -- add_supplier_po_equipment or the whole call (and the number) is rolled
  -- back. Each item: {"equipment_id": uuid, "price": number|null, "note": text|null}.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_supplier_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      v_item->>'note'
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138: creates an open supplier PO for a party (a lessor OR an owner class) with the next SPO number and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note}]). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- 5. update_supplier_po_equipment_price: 0136 body minus the internal rule
-- ===========================================================================
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
  v_status text;
  v_equipment_id uuid;
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
  '0136/0138: sets the price of a line of an OPEN supplier PO (also the first price of an unpriced line) and records old and new. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  TO authenticated;
