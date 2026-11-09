-- 0188: «المعدات في المشاريع» lists the site VISITS, open and closed, and a
-- closed visit can join a PO (owner 2026-11-09: a unit that enters and
-- leaves a project within one day — typically a daily or hourly unit — never
-- showed on the page and could never be put on a PO; «60 يوم خليها»).
--
-- A. New view purchasing_site_visits (security_invoker): every SITE visit of
--    movement_visits, open or closed, with EVERY column of
--    purchasing_site_units (0169) in the same order, plus the TRAILING
--    columns visit_state ('inside' while exit_id IS NULL, else 'exited'),
--    exit_at and exit_purpose.
--      * supplier_po_id / po_number / has_po: the open supplier PO the unit
--        sits on for that company and project, as 0147 — any card of the
--        unit there — for an OPEN visit (the card created from this visit's
--        entry is now preferred when there are several); a CLOSED visit only
--        through a card whose period covers its entry day (Saudi), so a PO of
--        a LATER visit of the unit in the same project does not mark an
--        older closed visit as covered. The client columns (cpo) follow the
--        same rule; they stay unread by the screens (2026-11-04).
--      * party_po_id: unchanged — the party's open DRAFT PO there whose
--        start date is this visit's entry day (0148 / 0160).
--    purchasing_site_units itself is NOT changed: the live home counts
--    (AttentionSection, KpiStrip) and the inquiry's PO card read it as «the
--    units inside a project now», and widening it would change them for the
--    UI that is live. The page /purchasing/units moves to the new view.
--
-- B. add_supplier_po_equipment: the 0185 body VERBATIM except the visit
--    lookup. Was (0137): the unit's latest movement is an open site ENTRY in
--    the PO's company and project. Now: a site ENTRY of the unit in the PO's
--    company and project — open or closed — whose Saudi day is the PO start
--    date (0148); the open visit first (the entry that is the unit's latest
--    movement, in the chain's (recorded_at, id) order), else the latest
--    closed one. No such entry: entry_date_mismatch when the unit has site
--    entries there on other days only (as before, when it was inside on
--    another day), else equipment_not_at_po_project. The card's
--    entry_log_id, the card reuse / creation and the event's entry_log_id
--    take that entry. create_supplier_po adds its units through here (not
--    re-created).
--
-- C. add_client_po_equipment: the 0185 body VERBATIM except the same
--    widening: a site ENTRY of the unit in the client PO's company and
--    project, open or closed (the open visit first, else the latest closed
--    one; no entry-day rule on the client side); none:
--    equipment_not_at_po_project. create_client_po passes through it (not
--    re-created).
--
-- Rollout: safe before the UI — the two functions keep their signatures and
-- only accept more, purchasing_site_units is untouched and the new view is
-- read only by the new screens. Apply 0188 BEFORE deploying them (the page
-- reads purchasing_site_visits).

-- ===========================================================================
-- A. purchasing_site_visits
-- ===========================================================================
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
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    -- 0188: a CLOSED visit only through a card whose period covers its
    -- entry day, so a later visit's PO does not cover it.
    AND (
      v.exit_id IS NULL
      OR (c.period_from <= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
        AND (c.period_to IS NULL
          OR c.period_to >= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date))
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC, p.created_at DESC, p.id DESC
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
    -- 0188: a CLOSED visit only through a card whose period covers its
    -- entry day, so a later visit's PO does not cover it.
    AND (
      v.exit_id IS NULL
      OR (c.period_from <= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
        AND (c.period_to IS NULL
          OR c.period_to >= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date))
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
  '0188: every SITE visit of movement_visits, open or closed, with the columns of purchasing_site_units (0147/0148/0160/0169) in the same order — the open supplier PO the unit sits on for that company and project (supplier_po_id, po_number, has_po; a closed visit only through a card whose period covers its entry day), else the open DRAFT PO of its party there whose start date is the visit''s entry day (party_po_id, party_po_number), and the client columns of 0169 — plus visit_state (inside / exited), exit_at and exit_purpose. The «المعدات في المشاريع» page. security_invoker: movements RLS, purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_visits FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_visits TO authenticated;

-- ===========================================================================
-- B. add_supplier_po_equipment: 0185 verbatim, a visit open or closed
-- ===========================================================================
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
  -- 0138: the card period starts on the day the unit entered (Saudi time),
  -- which is the PO start date (0148).
  v_entry_date := (v_entry.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;

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
        p_equipment_id, v_po.company_id, v_po.project_id, v_entry_date, auth.uid(), v_entry.id
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
    SET entry_log_id = v_entry.id
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
      'entry_log_id', v_entry.id
    ),
    auth.uid()
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text) IS
  '0136/0137/0138/0148/0157/0160/0185/0188: adds a unit of the PO''s party to an open, DRAFT supplier PO (an approved PO is locked: po_approved_locked), with or without a price (excluding VAT) per month, week, day or hour (p_rate_unit, default month; invalid_rate_unit), through a site visit of the unit in the PO''s company and project, open or closed (0188), whose entry''s Saudi day is the PO start date (the open visit first, else the latest closed one; no visit there at all: equipment_not_at_po_project; visits there on other days only: entry_date_mismatch), reusing or creating its equipment card from that entry''s date and recording the entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  TO authenticated;

-- ===========================================================================
-- C. add_client_po_equipment: 0185 verbatim, a visit open or closed
-- ===========================================================================
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
  -- The card period starts on the day the unit entered (Saudi time). No
  -- same-day rule here: each line's period is its own card's.
  v_entry_date := (v_entry.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;

  -- Reuse the unit's card for this company and project: the one created
  -- from this very entry (the supplier side's, 0137), else the one whose
  -- period covers the entry date (an open end covers everything after it).
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.entry_log_id = v_entry.id
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
        auth.uid(), v_entry.id
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
    SET entry_log_id = v_entry.id
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
      'entry_log_id', v_entry.id
    )
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text) IS
  '0169/0185/0188: adds a unit to an OPEN client PO with an optional sale price (excluding VAT) per month / week / day / hour (p_rate_unit, default month; invalid_rate_unit), the line''s standard hours (p_standard_hours, NULL = the PO''s default), an optional contract quantity and a note, through a site visit of the unit in the PO''s company and project, open or closed (0188; the open visit first, else the latest closed one; none: equipment_not_at_po_project), reusing the unit''s card for that company and project (by entry_log_id, else by period) or creating it from that entry''s Saudi day. A card sits on at most one open client PO (equipment_already_on_open_client_po). Serialises on the unit''s advisory key. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  TO authenticated;
