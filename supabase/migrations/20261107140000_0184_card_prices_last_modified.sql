-- 0184 «اسعار المعدات» sorted by the latest modification (owner 2026-11-07,
-- «الترتيب حقها ابغاه يكون حسب احدث تعديل سواء على امر العميل او امر
-- المورد»).
--
-- sales_equipment_cards: 0174 verbatim plus three TRAILING columns
-- (CREATE OR REPLACE only adds columns at the end; 0172's views select
-- explicit columns from this view):
--   client_po_updated_at   the updated_at of the client PO the view picks
--                          (0169: a line change moves it too)
--   supplier_po_updated_at the updated_at of the supplier PO the view picks
--                          (0146: a line change moves it too)
--   last_modified_at       the latest of the card's own updated_at (its
--                          client price and its approval live on the card),
--                          the client PO's and the supplier PO's
--                          (GREATEST ignores NULL; the card's is NOT NULL).
-- Read only; no table, policy or function changes.

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
  sp.supplier_po_approval_status,
  -- 0184: the two PO dates and the latest modification, at the END.
  cl.client_po_updated_at,
  sp.supplier_po_updated_at,
  GREATEST(c.updated_at, cl.client_po_updated_at, sp.supplier_po_updated_at) AS last_modified_at
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
    l.quantity AS client_quantity,
    p.updated_at AS client_po_updated_at
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
    sp2.approval_status AS supplier_po_approval_status,
    sp2.updated_at AS supplier_po_updated_at
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
  '0169 / 0174 / 0184: one row per equipment card («كرت المعدة») with the unit, the company and project, the period (is_open = period_to IS NULL), the entry it was created from (entry_log_id, entry_at) and both sides — the client PO line (id, number, status, price, unit, standard hours, quantity; has_client_po = an open one) and the supplier PO line (id, number, status, price, unit; has_supplier_po = an open one), each the open PO''s line first, else the latest — plus, since 0174 and only at the END (sales_card_months and sales_card_month_slots select from it): the card''s own client price card_client_price (monthly, excluding VAT), pricing_status / pricing_approved_at / pricing_approved_by / pricing_approved_by_name, card_margin (= card_client_price − supplier_price when both are set and the supplier line is monthly, else NULL) and card_margin_pct (over the client price, NULL when it is NULL or 0), and the supplier PO''s approval state supplier_po_approval_status; since 0184 client_po_updated_at, supplier_po_updated_at and last_modified_at (the latest of the card''s, the client PO''s and the supplier PO''s updated_at; «اسعار المعدات» sorts by it). security_invoker: sales.view or purchasing.view for the card, each side''s own key, movements RLS for the entry.';

REVOKE ALL ON public.sales_equipment_cards FROM PUBLIC, anon;
GRANT SELECT ON public.sales_equipment_cards TO authenticated;
