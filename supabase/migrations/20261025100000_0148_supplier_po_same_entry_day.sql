-- 0148: every unit of one supplier PO entered the project on the SAME day,
-- and that day is the PO's start date.
--
-- Owner decision 2026-10-25 («اضف شرط نفس تاريخ الدخول», then «ابدا»). The
-- day is the Saudi calendar day (Asia/Riyadh, UTC+03:00) of the unit's open
-- site ENTRY, the entry 0137 already requires and 0138 already uses as the
-- card's `period_from`. So:
--
--   1. `add_supplier_po_equipment` (the 0138 body VERBATIM plus the block
--      marked 0148) refuses a unit whose entry day is not the PO's
--      `start_date`, with the stable token `entry_date_mismatch` (SQLSTATE
--      55000). `create_supplier_po` (latest body 0139, unchanged) adds every
--      item of `p_equipment` through this function, so a new PO whose units
--      entered on another day than its start date, or on different days,
--      is refused as a whole and consumes no number.
--   2. `update_supplier_po` (the 0142 body VERBATIM plus the block marked
--      0148) refuses a NEW start date that differs from the entry day of
--      any of the PO's current lines, token `po_start_date_locked` (55000).
--      A PO without lines keeps a free start date; an unchanged start date
--      is never checked, so the notes of every open PO stay editable. A
--      line's entry is its card's `entry_log_id` (0137), its card's
--      `period_from` when that link is gone.
--   3. `purchasing_site_units` (the 0147 body VERBATIM plus one condition)
--      offers as the party's PO (`party_po_id` / `party_po_number`) only an
--      open PO of the party there whose start date is that visit's entry
--      day; otherwise the page offers a new PO.
--
-- The rule applies to NEW additions only. The read-only check on
-- 2026-10-25 found 8 of 53 open POs whose lines entered on several days or
-- on a day other than the start date; their lines are left exactly as they
-- are, and only a start-date change on them is refused from now on.
--
-- Same shape as the purchasing writers: SECURITY DEFINER, fixed
-- search_path, `assert_purchasing_manage()` first, the PO row locked FOR
-- UPDATE (so an addition and a start-date change never interleave), the
-- unit's advisory key `hashtextextended(equipment_id::text, 0)` before its
-- movements are read, executable by `authenticated` only. Movements, their
-- triggers and policies, and the purchasing tables' policies are untouched.

-- ===========================================================================
-- 1. add_supplier_po_equipment: 0138 verbatim plus the 0148 block
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
  '0136/0137/0138/0148: adds a unit of the PO''s party to an open supplier PO, with or without a price (excluding VAT), only while the unit is inside the PO''s company and project (its latest movement is an open site entry there) and only when that entry''s Saudi day is the PO start date (entry_date_mismatch), reusing or creating its equipment card from that entry''s date and recording the entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  TO authenticated;

-- create_supplier_po keeps its 0139 body: its loop calls the function above
-- for every item, so it inherits the rule. Its comment records that.
COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138/0139/0148: creates an open supplier PO for a party (a lessor OR an owner class) with the next SPO number and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note}]) through add_supplier_po_equipment, so every unit must have entered on the start date (entry_date_mismatch rolls the whole call back). Needs purchasing.manage.';

-- ===========================================================================
-- 2. update_supplier_po: 0142 verbatim plus the 0148 block
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

  -- 0148: while the PO has lines, its start date is their entry day (Saudi
  -- time): a new start date must be the entry day of every current line.
  -- A PO without lines keeps a free start date; an unchanged one is not
  -- checked, so the notes stay editable on the pre-0148 mixed POs.
  IF p_start_date <> v_po.start_date AND EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment l
    JOIN public.equipment_cards c ON c.id = l.equipment_card_id
    LEFT JOIN public.entry_exit_logs el ON el.id = c.entry_log_id
    WHERE l.supplier_po_id = p_po_id
      AND COALESCE((el.recorded_at AT TIME ZONE 'Asia/Riyadh')::date, c.period_from)
          <> p_start_date
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
  '0142/0148: changes the start date and the notes of an OPEN supplier PO and records old and new (event updated). While the PO has lines a new start date must be their entry day (po_start_date_locked). The party, company and project never change. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po(uuid, date, text) TO authenticated;

-- ===========================================================================
-- 3. purchasing_site_units: 0147 verbatim plus the same-day party PO
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
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
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
WHERE v.is_open
  AND v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_units IS
  '0147/0148: the units inside a project now (open site visits of movement_visits) with the open supplier PO they sit on for that company and project (supplier_po_id, po_number, has_po), else the open PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number). The «المعدات في المشاريع» page of purchasing. security_invoker: movements RLS and purchasing.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;
