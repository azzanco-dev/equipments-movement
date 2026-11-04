-- 0174: card pricing («اسعار المعدات») — the CLIENT rental price of each
-- «كرت المعدة» and its approval, the database layer. Builds on the shared
-- document equipment_cards (0136), its supplier line (supplier_po_equipment,
-- 0136 / 0157), the supplier PO approval (0160) and the card's append-only
-- audit equipment_card_events (0172).
--
-- Owner decisions 2026-11-04:
--   * the sales section is reduced for now to ONE page, «اسعار المعدات»:
--     every card that sits on a supplier PO line gets a client rental price
--     («شهري نعم»: MONTHLY, excluding VAT) entered inline; the supplier price
--     comes from the supplier PO line; the margin and the margin percentage
--     are computed on read, never stored.
--   * a card's pricing is a draft until approved («نعم فيه اعتماد … او رجوع
--     للتعديل»); the approval is internal (no notes yet, ready for them) and
--     «رجوع للتعديل» puts the card back into draft.
--   * «الاعتماد يخلي PO المورد يصير معتمد»: when EVERY line of a supplier PO
--     sits on a card whose pricing is approved, the PO becomes approved
--     (0160's state) — directly, here, not through approve_supplier_po, whose
--     purchasing.approve and self-approval checks belong to the manual path.
--     A PO with other cards still in draft waits. Returning a card's pricing
--     puts its approved OPEN supplier PO back into draft, so the PO and its
--     lines are editable again (0160's lock reads approval_status only).
--   * who approves: the new permission key `sales.approve` («اعتماد اسعار
--     الكروت»), held by the admin role, assignable to any role; it requires
--     sales.view. The price itself is written by sales.manage.
--
-- Rules (the 0169 / 0172 shape): every write goes through the SECURITY
-- DEFINER functions below (RLS has no INSERT / UPDATE policy on
-- equipment_cards); each checks its permission first (assert_sales_manage
-- or the new assert_sales_approve) and locks the card row FOR UPDATE before
-- it reads or writes; the card events are append-only; the supplier PO row
-- is locked FOR UPDATE before its approval state changes (the same lock
-- every purchasing writer takes).
--   Stable error tokens (the client maps them, never shows raw errors):
--     sales_manage_required / sales_approve_required          42501
--     invalid_card / invalid_price / invalid_note /
--     invalid_items                                           22023
--     card_pricing_approved_locked / card_pricing_not_draft /
--     card_pricing_not_approved / card_pricing_no_client_price /
--     card_pricing_no_supplier_line /
--     card_pricing_no_supplier_price                          55000
--
-- Order of application: this migration re-creates the CHECK of
-- supplier_po_events.event_type with the full list INCLUDING `renumbered`,
-- which migration 0173 (the supplier PO numbering, written in parallel)
-- adds to the same CHECK. 0174 MUST BE APPLIED AFTER 0173: applied in the
-- other order, 0173 would drop `approval_returned` again.
--
-- Nothing here changes a movement, a photo, the master data, a client PO
-- table, the 0172 month tables or any existing policy.

-- ===========================================================================
-- A. equipment_cards: the client price and the pricing state
-- ===========================================================================
ALTER TABLE public.equipment_cards
  ADD COLUMN IF NOT EXISTS client_price numeric(12, 2)
    CONSTRAINT equipment_cards_client_price_check
      CHECK (client_price IS NULL OR (client_price >= 0 AND client_price <= 9999999999.99)),
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'draft'
    CONSTRAINT equipment_cards_pricing_status_check
      CHECK (pricing_status IN ('draft', 'approved')),
  ADD COLUMN IF NOT EXISTS pricing_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS pricing_approved_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Approved exactly when approved_at is set (the 0160 shape).
ALTER TABLE public.equipment_cards
  ADD CONSTRAINT equipment_cards_pricing_approved_at_check
    CHECK ((pricing_status = 'approved') = (pricing_approved_at IS NOT NULL));

COMMENT ON COLUMN public.equipment_cards.client_price IS
  '0174: the CLIENT''s rental price of the card, per MONTH (owner 2026-11-04) and excluding VAT; NULL = not priced yet. The card''s rate_unit / standard_hours stay the client side''s timesheet rule (0136 / 0172). Written only by set_equipment_card_client_price (and the batch set_equipment_card_client_prices); locked while pricing_status = approved.';
COMMENT ON COLUMN public.equipment_cards.pricing_status IS
  '0174: draft («مسودة») until approve_equipment_card_pricing makes it approved («معتمد»); return_equipment_card_pricing puts it back into draft. An approved card''s client price is locked. Approving the last draft card of a supplier PO approves that PO.';
COMMENT ON COLUMN public.equipment_cards.pricing_approved_at IS
  '0174: when the card''s pricing was approved; set exactly for an approved card.';
COMMENT ON COLUMN public.equipment_cards.pricing_approved_by IS
  '0174: who approved the card''s pricing.';

-- ===========================================================================
-- B. The permission key, held by the admin role (the 0160 shape)
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES (
  'sales.approve', 'sales',
  'المبيعات: اعتماد اسعار الكروت', 'Sales: approve card pricing',
  'اعتماد سعر العميل على كرت المعدة او ارجاعه للتعديل. اعتماد اخر كرت على PO المورد يعتمد ذلك الـ PO.',
  'Approve the client price of an equipment card or return it for editing. Approving the last card of a supplier PO approves that PO.',
  false, NULL, ARRAY['sales.view'], false, 'database', 1120
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'sales.approve', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- C. The event types
-- ===========================================================================
-- The card's own audit (0172) gains the pricing events.
ALTER TABLE public.equipment_card_events
  DROP CONSTRAINT equipment_card_events_type_check;
ALTER TABLE public.equipment_card_events
  ADD CONSTRAINT equipment_card_events_type_check CHECK (
    event_type IN (
      'month_recorded', 'month_updated', 'month_deleted',
      'client_price_changed', 'pricing_approved', 'pricing_returned'
    )
  );

COMMENT ON TABLE public.equipment_card_events IS
  '0172 / 0174: append-only audit of an equipment card — the month records (month_recorded, month_updated, month_deleted; payload month, hours, old_hours, note) and the pricing (client_price_changed {old_price, new_price}, pricing_approved {client_price, supplier_price, supplier_rate_unit, supplier_po_id, supplier_po_approved}, pricing_returned {note, supplier_po_returned}) — with the actor and the actor''s name at the time. Read by sales.view or purchasing.view; written only by the card functions; no update or delete path. The card page orders by (created_at, seq) among the PO events.';

-- The supplier PO audit (0160's list, plus `renumbered` of 0173 — see the
-- order of application above — plus `approval_returned`: the PO put back
-- into draft when a card's pricing is returned).
ALTER TABLE public.supplier_po_events
  DROP CONSTRAINT supplier_po_events_type_check;
ALTER TABLE public.supplier_po_events
  ADD CONSTRAINT supplier_po_events_type_check CHECK (
    event_type IN (
      'created', 'updated',
      'equipment_added', 'price_changed', 'line_updated', 'card_changed',
      'equipment_removed',
      'approved', 'approval_returned',
      'renumbered',
      'closed', 'reopened'
    )
  );

-- ===========================================================================
-- D. assert_sales_approve (the assert_sales_manage shape)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.assert_sales_approve()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('sales.approve') THEN
    RAISE EXCEPTION 'sales_approve_required'
      USING ERRCODE = '42501',
            HINT = 'Approving card pricing needs the sales.approve permission.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_sales_approve() IS
  '0174: raises sales_approve_required (42501) unless the caller is signed in and holds sales.approve. Called first by approve_equipment_card_pricing and return_equipment_card_pricing; not callable by clients.';

REVOKE ALL ON FUNCTION public.assert_sales_approve()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- E. set_equipment_card_client_price: the client price of ONE card
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.set_equipment_card_client_price(
  p_card_id uuid,
  p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.equipment_cards%ROWTYPE;
  v_price numeric(12, 2);
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

  -- Nothing changed: no write, no event.
  IF v_price IS NOT DISTINCT FROM v_card.client_price THEN
    RETURN;
  END IF;

  UPDATE public.equipment_cards
  SET client_price = v_price
  WHERE id = p_card_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'client_price_changed',
    jsonb_build_object('old_price', v_card.client_price, 'new_price', v_price)
  );
END;
$$;

COMMENT ON FUNCTION public.set_equipment_card_client_price(uuid, numeric) IS
  '0174: sets the client''s MONTHLY rental price (excluding VAT) of one equipment card — NULL = no price, else 0 to 9999999999.99 (invalid_price) — unless the card''s pricing is approved (card_pricing_approved_locked); records the event client_price_changed with old and new (no event when unchanged). Locks the card row first. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.set_equipment_card_client_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_card_client_price(uuid, numeric) TO authenticated;

-- ===========================================================================
-- F. set_equipment_card_client_prices: the batch (the «اسعار المعدات» save)
-- ===========================================================================
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

  -- An array of {"card_id": uuid, "price": number | null}.
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
       OR COALESCE(jsonb_typeof(v_item -> 'price'), 'null') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_card_id := (v_item ->> 'card_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END;

    PERFORM public.set_equipment_card_client_price(
      v_card_id,
      (v_item ->> 'price')::numeric
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_equipment_card_client_prices(jsonb) IS
  '0174: the batch save of the «اسعار المعدات» page: p_items is an array of {card_id, price|null} (shape → invalid_items), each set through set_equipment_card_client_price in order inside ONE transaction, so any refused item refuses the whole batch with its own token. Returns the number of items processed (an empty array → 0). Needs sales.manage.';

REVOKE ALL ON FUNCTION public.set_equipment_card_client_prices(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_card_client_prices(jsonb) TO authenticated;

-- ===========================================================================
-- G. approve_equipment_card_pricing
-- ===========================================================================
-- The supplier line is found as sales_equipment_cards finds it: the line on
-- the OPEN supplier PO first, else the latest; here it must be on an open PO
-- and priced (0 counts as a price: an Al-Azani unit on an internal PO).
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
  '0174: approves the pricing of one equipment card — needs sales.approve, a DRAFT card (card_pricing_not_draft) with a client price (card_pricing_no_client_price) and a priced supplier line on an OPEN supplier PO (card_pricing_no_supplier_line, card_pricing_no_supplier_price; 0 counts) — recording pricing_approved_at / _by and the event pricing_approved. Then, when every line of that supplier PO sits on an approved card and the PO is an open draft, the PO itself becomes approved (0160 state, event approved {via: card_pricing}) without approve_supplier_po''s checks (owner 2026-11-04).';

REVOKE ALL ON FUNCTION public.approve_equipment_card_pricing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_card_pricing(uuid) TO authenticated;

-- ===========================================================================
-- H. return_equipment_card_pricing («رجوع للتعديل»)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.return_equipment_card_pricing(
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
  v_po public.supplier_pos%ROWTYPE;
  v_po_found boolean := false;
  v_po_returned boolean := false;
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
  IF v_card.pricing_status <> 'approved' THEN
    RAISE EXCEPTION 'card_pricing_not_approved'
      USING ERRCODE = '55000',
            HINT = 'Only an approved pricing is returned for editing.';
  END IF;

  -- The note (ready for the owner's later reasons): trimmed, blank = none,
  -- at most 500 characters.
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  UPDATE public.equipment_cards
  SET pricing_status = 'draft',
      pricing_approved_at = NULL,
      pricing_approved_by = NULL
  WHERE id = p_card_id;

  -- The card's supplier PO (the open PO's line first, as the view): an
  -- approved OPEN PO goes back into draft, so the PO and its lines are
  -- editable again (0160's lock reads approval_status). A closed PO is
  -- history and stays as it is.
  SELECT sp.* INTO v_po
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = p_card_id
  ORDER BY (sp.status = 'open') DESC, sp.created_at DESC, sp.id DESC
  LIMIT 1
  FOR UPDATE OF sp;
  v_po_found := FOUND;
  IF v_po_found AND v_po.status = 'open' AND v_po.approval_status = 'approved' THEN
    v_po_returned := true;
  END IF;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'pricing_returned',
    jsonb_build_object(
      'note', v_note,
      'client_price', v_card.client_price,
      'supplier_po_id', CASE WHEN v_po_found THEN v_po.id END,
      'supplier_po_returned', v_po_returned
    )
  );

  IF v_po_returned THEN
    UPDATE public.supplier_pos
    SET approval_status = 'draft',
        approved_at = NULL,
        approved_by = NULL
    WHERE id = v_po.id;

    INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
    VALUES (
      v_po.id, 'approval_returned',
      jsonb_build_object(
        'via', 'card_pricing',
        'card_id', p_card_id,
        'note', v_note,
        'approved_at', v_po.approved_at,
        'approved_by', v_po.approved_by
      ),
      auth.uid()
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.return_equipment_card_pricing(uuid, text) IS
  '0174 «رجوع للتعديل»: puts an APPROVED card pricing back into draft (card_pricing_not_approved otherwise), clearing pricing_approved_at / _by and recording the event pricing_returned with the optional note (trimmed, at most 500 characters: invalid_note). When the card''s supplier PO is an approved OPEN PO it goes back into draft too (approved_at / _by cleared, event approval_returned {via: card_pricing, card_id, note}), so the PO and its lines are editable again. Needs sales.approve.';

REVOKE ALL ON FUNCTION public.return_equipment_card_pricing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_equipment_card_pricing(uuid, text) TO authenticated;

-- ===========================================================================
-- I. sales_equipment_cards: 0169 verbatim plus the TRAILING pricing columns
-- ===========================================================================
-- sales_card_months and sales_card_month_slots (0172) select explicit
-- columns from this view, so it keeps every 0169 column in the same order
-- and only GAINS columns at the end through CREATE OR REPLACE (never a
-- DROP). The margin is computed on read: client price − supplier price when
-- both are set and the supplier line is MONTHLY (a daily supplier line has
-- no rule → NULL); an owned Al-Azani unit on a 0-priced line keeps the full
-- client price as its margin. The percentage is over the client price, NULL
-- when that is NULL or 0.
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
  sp.supplier_po_approval_status
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
    l.quantity AS client_quantity
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
    sp2.approval_status AS supplier_po_approval_status
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
         AND sp.supplier_rate_unit = 'month'
      THEN round(c.client_price - sp.supplier_price, 2)
    ELSE NULL
  END AS card_margin
) m;

COMMENT ON VIEW public.sales_equipment_cards IS
  '0169 / 0174: one row per equipment card («كرت المعدة») with the unit, the company and project, the period (is_open = period_to IS NULL), the entry it was created from (entry_log_id, entry_at) and both sides — the client PO line (id, number, status, price, unit, standard hours, quantity; has_client_po = an open one) and the supplier PO line (id, number, status, price, unit; has_supplier_po = an open one), each the open PO''s line first, else the latest — plus, since 0174 and only at the END (sales_card_months and sales_card_month_slots select from it): the card''s own client price card_client_price (monthly, excluding VAT), pricing_status / pricing_approved_at / pricing_approved_by / pricing_approved_by_name, card_margin (= card_client_price − supplier_price when both are set and the supplier line is monthly, else NULL) and card_margin_pct (over the client price, NULL when it is NULL or 0), and the supplier PO''s approval state supplier_po_approval_status. «اسعار المعدات», «قائمة كروت المعدات» and «صفحة كرت المعدة». security_invoker: sales.view or purchasing.view for the card, each side''s own key, movements RLS for the entry.';

REVOKE ALL ON public.sales_equipment_cards FROM PUBLIC, anon;
GRANT SELECT ON public.sales_equipment_cards TO authenticated;
