-- 0192: when a site visit's entry was registered, on «المعدات في المشاريع».
--
-- Owner request 2026-11-11: «الي سويناه بخصوص تاريخ انشاء الدخولية ابغاه يكون
-- في "المعدات في المشاريع"», then «انشاء الدخول فقط». The tickets of
-- `/purchasing/units` show and sort by when the visit's ENTRY was registered
-- (the entry's only, not the exit's). `movement_visits` carries it
-- (`entry_created_at`, 0159); the page's view `purchasing_site_visits` did
-- not pass it on.
--
-- ===========================================================================
-- Recreated object (body copied verbatim from its latest migration)
-- ===========================================================================
--   `public.purchasing_site_visits`   latest: 0189 (section D6). Verbatim,
--       plus ONE column APPENDED after `exit_purpose`:
--           entry_created_at   `v.entry_created_at`
--   The joins, the PO rule of a visit and the `WHERE v.movement_context =
--   'site'` filter are unchanged: the same rows, the same PO on each.
--   `purchasing_site_units` (the inquiry's read) is not touched.
--
-- ===========================================================================
-- Compatibility with the deployed UI (rollout: this migration first, then UI)
-- ===========================================================================
--   * `CREATE OR REPLACE VIEW` only allows new columns at the end; every
--     existing column keeps its name, position and type, so the live page
--     keeps working: it simply does not read it yet.
--   * The new page selects the column, so it is deployed AFTER this
--     migration is applied.
--   * Security is unchanged: `security_invoker = true`; the REVOKE / GRANT
--     are repeated.
--
-- ===========================================================================
-- Indexes
-- ===========================================================================
--   None: the sort runs over the view's rows like its other sorts.

CREATE OR REPLACE VIEW public.purchasing_site_visits
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
  v.exit_purpose,
  -- 0192: appended; everything above is 0189 verbatim. When the visit's
  -- ENTRY was registered in the system (movement_visits, 0159).
  v.entry_created_at
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else through
  -- a PO that started on or before the visit's entry day (a PO of an
  -- earlier stay still covers the unit when it returns; a PO of a LATER
  -- visit never marks an older one). The visit's own card first, then the
  -- latest start date, then the latest PO. No open / closed state.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR p.start_date <= (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           p.start_date DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
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
    -- 0189: a CLOSED visit only through its own card (0188 used the card's
    -- period, which is gone), so a later visit's PO does not cover it.
    AND (
      v.exit_id IS NULL
      OR c.entry_log_id IS NOT DISTINCT FROM v.entry_id
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
  '0188/0189/0192: every SITE visit of movement_visits, open or closed, with the supplier PO of the visit (supplier_po_id, po_number, has_po) — since 0189 a line of the unit on a PO of that company and project through the visit''s own card, else through a PO that started on or before the visit''s entry day (the visit''s card first, then the latest start date; a supplier PO has no open / closed state) —, else the DRAFT PO of its party there whose start date is the visit''s entry day that it can join (party_po_id, party_po_number), the client columns of 0169 (the open client PO; a closed visit only through its own card) and visit_state (inside / exited), exit_at and exit_purpose; since 0192 also entry_created_at, when the visit''s entry was registered in the system. The «المعدات في المشاريع» page. security_invoker: movements RLS, purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_visits FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_visits TO authenticated;

NOTIFY pgrst, 'reload schema';
