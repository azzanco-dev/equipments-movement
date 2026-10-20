-- 0139: create_supplier_po wrote NULL into supplier_pos.is_internal for a
-- lessor party (0138 computed `p_owner_class = 'alazani'`, which is NULL
-- when p_owner_class is NULL), so every PO addressed to a supplier failed
-- with 23502. The 0138 body is re-created VERBATIM with that one expression
-- wrapped in COALESCE(..., false). Nothing else changes.

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
    v_number, p_lessor_id, p_owner_class, COALESCE(p_owner_class = 'alazani', false),
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
  '0136/0138/0139: creates an open supplier PO for a party (a lessor OR an owner class) with the next SPO number and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note}]). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  TO authenticated;
