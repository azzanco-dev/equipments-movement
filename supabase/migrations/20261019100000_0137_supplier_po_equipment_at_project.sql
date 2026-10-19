-- 0137: a unit joins a supplier PO only while it is INSIDE the PO's company
-- and project; the card remembers the entry that brought it.
--
-- Owner decision 2026-10-19 («اذا سويت PO واضفت معدات لازم تكون نفس المشروع
-- والشركة الحالية»; the manual link to a movement is NOT required). So:
--
--   1. `add_supplier_po_equipment` (0136, re-created VERBATIM plus the block
--      marked 0137) looks at the unit's LATEST movement, in the one
--      `(recorded_at, id)` order of the chain and under the unit's advisory
--      key: it must be an open site ENTRY whose company and project are the
--      PO's. Otherwise the line is refused with the stable token
--      `equipment_not_at_po_project` (SQLSTATE 55000): a unit that is
--      available, inside the workshop or inside another project never lands
--      on this PO. The screens limit the search to such units; this check is
--      what actually enforces it.
--   2. That entry is stored on the card (`equipment_cards.entry_log_id`,
--      new, optional, ON DELETE SET NULL): the link comes for free, nobody
--      picks it by hand. A card created by this call gets it; a reused card
--      without one gets it too; an existing link is never overwritten.
--   3. The `equipment_added` event carries `entry_log_id` as well.
--
-- Nothing changes for movements: no movement function, trigger or policy is
-- touched, and the purchasing tables keep their 0136 policies (reads by
-- purchasing.view, writes only through the functions).

ALTER TABLE public.equipment_cards
  ADD COLUMN IF NOT EXISTS entry_log_id uuid
    REFERENCES public.entry_exit_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS equipment_cards_entry_log_idx
  ON public.equipment_cards (entry_log_id)
  WHERE entry_log_id IS NOT NULL;

COMMENT ON COLUMN public.equipment_cards.entry_log_id IS
  '0137: the site ENTRY that brought the unit into the card''s company and project, set by add_supplier_po_equipment from the unit''s latest movement at the time the line was added (never picked by hand, never overwritten).';

-- ===========================================================================
-- add_supplier_po_equipment: 0136 verbatim plus the 0137 block
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment(
  p_po_id uuid,
  p_equipment_id uuid,
  p_price numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_card_id uuid;
  v_card_created boolean := false;
  v_line_id uuid;
  v_last public.entry_exit_logs%ROWTYPE;
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

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  IF public.is_internal_equipment(p_equipment_id) AND p_price <> 0 THEN
    RAISE EXCEPTION 'internal_price_must_be_zero' USING ERRCODE = '22023';
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

  -- Reuse the unit's card for this company and project when its period
  -- covers the PO start date (an open end covers everything after it);
  -- otherwise open a new card from the PO start date with the defaults.
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.period_from <= v_po.start_date
    AND (c.period_to IS NULL OR c.period_to >= v_po.start_date)
  ORDER BY c.period_from DESC
  LIMIT 1;

  IF v_card_id IS NULL THEN
    BEGIN
      INSERT INTO public.equipment_cards (
        equipment_id, company_id, project_id, period_from, created_by, entry_log_id
      ) VALUES (
        p_equipment_id, v_po.company_id, v_po.project_id, v_po.start_date, auth.uid(), v_last.id
      )
      RETURNING id INTO v_card_id;
      v_card_created := true;
    EXCEPTION
      WHEN exclusion_violation THEN
        -- Another card of this unit (another company or project) already
        -- covers the PO start date.
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
  '0136/0137: adds a unit to an open supplier PO at a price excluding VAT (0 for an internal unit), only while the unit is inside the PO''s company and project (its latest movement is an open site entry there), reusing or creating its equipment card and recording that entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  TO authenticated;
