-- 0167: `purchasing_po_units`, the «حسب المعدات» view of the PO list.
--
-- Owner 2026-10-31: the «اوامر الشراء» page gets a view switch — «حسب
-- الاوامر» (the current list, the default) and «حسب المعدات»: one row per
-- unit on a supplier PO, with the PO number, so a unit is found by its code,
-- type, plate or chassis without opening each PO.
--
-- One row per `supplier_po_equipment` line, flattened with its PO, its card
-- («كرت المعدة»), its unit, the PO's company and project and, for a lessor
-- party, the lessor (the PO's party; since 0138 a PO has exactly one of
-- `lessor_id` / `owner_class`, and a unit must belong to that party). The
-- price unit is the LINE's (0157). `party_class` is the same expression as
-- the computed column `party_class(supplier_pos)` of 0140, inlined so the
-- list filters it like the orders list.
--
-- Read-only, security_invoker: the three purchasing tables keep their
-- `purchasing.view` RLS for the reader, the unit, the company, the project
-- and the lessor their own policies (LEFT JOINs, so a line never drops out
-- because one of them is hidden). No write path, no function, no grant
-- beyond the view's select.

CREATE OR REPLACE VIEW public.purchasing_po_units
WITH (security_invoker = true)
AS
SELECT
  -- The line.
  l.id AS line_id,
  l.price,
  l.rate_unit,
  l.note AS line_note,
  l.created_at AS line_created_at,
  l.updated_at,
  (l.price IS NOT NULL) AS is_priced,
  -- The PO.
  p.id AS supplier_po_id,
  p.po_number,
  p.status AS po_status,
  p.approval_status,
  p.start_date,
  p.lessor_id,
  p.owner_class,
  COALESCE(p.owner_class, 'external_supplier') AS party_class,
  ls.name AS lessor_name,
  ls.is_internal AS lessor_is_internal,
  -- The PO's company and project.
  p.company_id,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The unit and its card.
  c.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  c.period_from AS card_period_from,
  c.period_to AS card_period_to
FROM public.supplier_po_equipment l
JOIN public.supplier_pos p ON p.id = l.supplier_po_id
JOIN public.equipment_cards c ON c.id = l.equipment_card_id
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = p.lessor_id
LEFT JOIN public.companies co ON co.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id;

COMMENT ON VIEW public.purchasing_po_units IS
  '0167: one row per supplier PO line (supplier_po_equipment) with its PO (number, status, approval, start date, party and party_class as in party_class(supplier_pos)), the PO''s company and project, the unit and its card period. The «حسب المعدات» view of the PO list. security_invoker: purchasing.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.purchasing_po_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_po_units TO authenticated;
