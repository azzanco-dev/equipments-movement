-- 0160: approval of supplier POs (EM-107) — «مسودة» then «معتمد».
--
-- Owner decisions 2026-10-28 (through the parent session):
--   1. Who approves: the new permission key `purchasing.approve` («اعتماد
--      اوامر الشراء»), assignable to any role on the roles page; it requires
--      `purchasing.view` and the admin role holds it.
--   2. States: every PO starts as a draft and becomes approved; closing
--      stays as it is. `supplier_pos.approval_status` (draft / approved,
--      default draft) with `approved_at` / `approved_by`. EVERY existing PO
--      is a draft (owner's choice), so its PDF waits for approval.
--   3. `approve_supplier_po(p_po_id)`: the caller holds purchasing.approve
--      (`purchasing_approve_required`, 42501); the PO exists (`invalid_po`),
--      is open (`po_closed`) and a draft (`po_not_draft`); the caller is
--      not its creator (`po_self_approval`, 42501); it has lines
--      (`po_has_no_lines`) and every line is priced
--      (`po_has_unpriced_lines`). It records approved_at / approved_by and
--      the append-only event `approved`.
--   4. An approved PO is LOCKED: `add_supplier_po_equipment`,
--      `update_supplier_po_equipment`, `update_supplier_po_equipment_price`
--      and a start-date change through `update_supplier_po` refuse it with
--      `po_approved_locked` (55000); its notes stay editable and closing
--      stays allowed. To change an approved PO, the user closes it and
--      creates a new one (a card still sits on at most one open PO).
--      `purchasing_site_units` offers as the party's PO only a draft.
--   5. Deferred: approving «كرت المعدة» (client + supplier price).
--
-- Every function is re-created from its latest body (add / update line:
-- 0157; price: 0138; update PO and the view: 0148) VERBATIM plus the block
-- marked 0160. Same shape as the other purchasing writers: SECURITY
-- DEFINER, fixed search_path, the permission first, the PO row locked FOR
-- UPDATE (approval and every write serialise on it), executable by
-- `authenticated` only. Movements and every policy are untouched.

-- ===========================================================================
-- 1. The approval state
-- ===========================================================================
ALTER TABLE public.supplier_pos
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft'
    CONSTRAINT supplier_pos_approval_status_check
      CHECK (approval_status IN ('draft', 'approved')),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.supplier_pos
  ADD CONSTRAINT supplier_pos_approved_at_check
    CHECK ((approval_status = 'approved') = (approved_at IS NOT NULL));

COMMENT ON COLUMN public.supplier_pos.approval_status IS
  '0160: draft («مسودة») until approve_supplier_po makes it approved («معتمد»). An approved PO is locked (no line, price or start-date change; notes and closing stay). Every PO before 0160 is a draft.';
COMMENT ON COLUMN public.supplier_pos.approved_at IS
  '0160: when the PO was approved; set exactly for an approved PO.';
COMMENT ON COLUMN public.supplier_pos.approved_by IS
  '0160: who approved the PO (never its creator).';

-- ===========================================================================
-- 2. The event type (the 0149 list plus one)
-- ===========================================================================
ALTER TABLE public.supplier_po_events
  DROP CONSTRAINT supplier_po_events_type_check;
ALTER TABLE public.supplier_po_events
  ADD CONSTRAINT supplier_po_events_type_check CHECK (
    event_type IN (
      'created', 'updated',
      'equipment_added', 'price_changed', 'line_updated', 'card_changed',
      'equipment_removed',
      'approved',
      'closed', 'reopened'
    )
  );

-- ===========================================================================
-- 3. The permission key, held by the admin role
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES (
  'purchasing.approve', 'purchasing',
  'المشتريات: اعتماد اوامر الشراء', 'Purchasing: approve purchase orders',
  'اعتماد امر شراء مسودة بعد تسعير كل معداته، ولا يعتمد احد امرا انشاه بنفسه. الاعتماد يقفل الامر ويفتح تصدير PDF.',
  'Approve a draft purchase order once every unit is priced; nobody approves a PO they created. Approval locks the PO and opens its PDF.',
  false, NULL, ARRAY['purchasing.view'], false, 'database', 1020
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'purchasing.approve', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- 4. approve_supplier_po
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_supplier_po(p_po_id uuid)
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
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
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
  '0160: approves an open DRAFT supplier PO — needs purchasing.approve, never by its creator, only with at least one line and every line priced — recording approved_at / approved_by and the event approved. An approved PO is locked. Tokens purchasing_approve_required, invalid_po, po_closed, po_not_draft, po_self_approval, po_has_no_lines, po_has_unpriced_lines.';

REVOKE ALL ON FUNCTION public.approve_supplier_po(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_supplier_po(uuid) TO authenticated;

-- ===========================================================================
-- 5. add_supplier_po_equipment: 0157 verbatim plus the lock
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
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month');
  IF v_rate_unit NOT IN ('month', 'day') THEN
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
  '0136/0137/0138/0148/0157/0160: adds a unit of the PO''s party to an open, DRAFT supplier PO (an approved PO is locked: po_approved_locked), with or without a price (excluding VAT) per month or per day (p_rate_unit, default month), only while the unit is inside the PO''s company and project (its latest movement is an open site entry there) and only when that entry''s Saudi day is the PO start date (entry_date_mismatch), reusing or creating its equipment card from that entry''s date and recording the entry on it. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text, text)
  TO authenticated;

-- ===========================================================================
-- 6. update_supplier_po_equipment: 0157 verbatim plus the lock
-- ===========================================================================
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
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit);
  IF v_rate_unit NOT IN ('month', 'day') THEN
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
  '0142/0157/0160: sets the price (NULL = unpriced), the note and the price unit (p_rate_unit month|day, NULL = unchanged) of a line of an OPEN, DRAFT supplier PO in one call (an approved PO is locked: po_approved_locked); a price change is the event price_changed, a note- or unit-only change is line_updated. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment(uuid, numeric, text, text)
  TO authenticated;

-- ===========================================================================
-- 7. update_supplier_po_equipment_price: 0138 verbatim plus the lock
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
  '0136/0138/0160: sets the price of a line of an OPEN, DRAFT supplier PO (an approved PO is locked: po_approved_locked) (also the first price of an unpriced line) and records old and new. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  TO authenticated;

-- ===========================================================================
-- 8. update_supplier_po: 0148 verbatim plus the locked start date
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

  -- 0160: an approved PO is locked (owner 2026-10-28) — its notes stay
  -- editable, its start date does not.
  IF v_po.approval_status = 'approved' AND p_start_date <> v_po.start_date THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; close it and create a new one.';
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
  '0142/0148/0160: changes the start date and the notes of an OPEN supplier PO and records old and new (event updated). While the PO has lines a new start date must be their entry day (po_start_date_locked); on an APPROVED PO only the notes change (po_approved_locked). The party, company and project never change. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po(uuid, date, text) TO authenticated;

-- ===========================================================================
-- 9. purchasing_site_units: 0148 verbatim, the party's PO only while draft
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
WHERE v.is_open
  AND v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_units IS
  '0147/0148/0160: the units inside a project now (open site visits of movement_visits) with the open supplier PO they sit on for that company and project (supplier_po_id, po_number, has_po), else the open DRAFT PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number). The «المعدات في المشاريع» page of purchasing. security_invoker: movements RLS and purchasing.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;
