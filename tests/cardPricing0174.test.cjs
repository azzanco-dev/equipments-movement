// Migration 0174 (owner decisions 2026-11-04, card pricing «اسعار المعدات»):
// the CLIENT's monthly price on each «كرت المعدة», its approval and the
// linkage to the supplier PO's approval — the database layer only. Static
// checks of the migration's source: the file order (after 0173), the four
// card columns, the sales.approve key held by the admin, the two CHECK lists,
// the four SECURITY DEFINER writers with the fixed search_path, their
// permission checks and stable tokens, the PO approval / return linkage, the
// REVOKE / GRANT shape and the view's trailing columns with the margin rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261104110000_0174_equipment_card_pricing.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const raw = read('supabase', 'migrations', MIGRATION)
const sql = norm(raw)

/** One function of a migration, from its CREATE to the closing `$$;`. */
const fn = (source, head) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, head)
  return source.slice(
    start,
    source.indexOf('$$;', source.indexOf('$$', start) + 2) + 3,
  )
}

/** One statement from its head to the next `;`. */
const stmt = (source, head) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, head)
  return source.slice(start, source.indexOf(';', start) + 1)
}

const SIGNATURES = {
  set_equipment_card_client_price:
    'set_equipment_card_client_price(uuid, numeric)',
  set_equipment_card_client_prices: 'set_equipment_card_client_prices(jsonb)',
  approve_equipment_card_pricing: 'approve_equipment_card_pricing(uuid)',
  return_equipment_card_pricing: 'return_equipment_card_pricing(uuid, text)',
}

test('0174 is the single 0174 migration and sorts after 0172 (and after 0173 once written)', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0174 present')
  assert.equal(migrations.filter((file) => /_0174_/.test(file)).length, 1)
  const before = migrations.slice(0, at)
  assert.ok(before.some((file) => /_0172_/.test(file)))
  // 0173 (the supplier PO numbering, written in parallel) adds `renumbered`
  // to the same CHECK this migration re-creates, so 0174 must apply after it.
  const at173 = migrations.findIndex((file) => /_0173_/.test(file))
  if (at173 >= 0) assert.ok(at173 < at, '0173 sorts before 0174')
  assert.match(raw, /0174 MUST BE APPLIED AFTER 0173/)
})

test('equipment_cards: the client price, the pricing state and its approver', () => {
  const alter = stmt(
    sql,
    'ALTER TABLE public.equipment_cards ADD COLUMN IF NOT EXISTS client_price',
  )
  assert.match(alter, /client_price numeric\(12, 2\)/)
  assert.match(
    alter,
    /CHECK \(client_price IS NULL OR \(client_price >= 0 AND client_price <= 9999999999\.99\)\)/,
  )
  assert.match(alter, /pricing_status text NOT NULL DEFAULT 'draft'/)
  assert.match(alter, /CHECK \(pricing_status IN \('draft', 'approved'\)\)/)
  assert.match(alter, /pricing_approved_at timestamptz/)
  assert.match(
    alter,
    /pricing_approved_by uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/,
  )
  // Approved exactly when approved_at is set (the 0160 shape).
  assert.match(
    sql,
    /ADD CONSTRAINT equipment_cards_pricing_approved_at_check CHECK \(\(pricing_status = 'approved'\) = \(pricing_approved_at IS NOT NULL\)\)/,
  )
  for (const column of [
    'client_price',
    'pricing_status',
    'pricing_approved_at',
    'pricing_approved_by',
  ])
    assert.match(
      raw,
      new RegExp(`COMMENT ON COLUMN public\\.equipment_cards\\.${column} IS`),
    )
  // The client price is MONTHLY (owner «شهري نعم»): the comment says so and
  // the card's rate_unit is not touched.
  assert.match(raw, /per MONTH \(owner 2026-11-04\)/)
  assert.doesNotMatch(sql, /ALTER COLUMN rate_unit/)
})

test('the permission key sales.approve, held by the admin role, requires sales.view', () => {
  const insert = stmt(sql, 'INSERT INTO public.permissions (')
  assert.match(insert, /'sales\.approve', 'sales'/)
  assert.match(
    insert,
    /'المبيعات: اعتماد اسعار الكروت', 'Sales: approve card pricing'/,
  )
  assert.match(
    insert,
    /false, NULL, ARRAY\['sales\.view'\], false, 'database', 1120/,
  )
  assert.match(insert, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(
    sql,
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\) VALUES \('admin', 'sales\.approve', NULL\) ON CONFLICT \(role_key, permission_key\) DO NOTHING;/,
  )
  // No other role gets it by migration; assignable from the roles page.
  assert.equal((sql.match(/'sales\.approve'/g) ?? []).length, 3)
  // The new Arabic copy uses the plain alif.
  assert.doesNotMatch(raw, /[أإآ]/)
})

test('the two CHECK lists: the card events gain the pricing events, the PO events approval_returned (plus 0173 renumbered)', () => {
  const cardCheck = stmt(
    sql,
    'ALTER TABLE public.equipment_card_events ADD CONSTRAINT equipment_card_events_type_check',
  )
  assert.match(
    cardCheck,
    /event_type IN \( 'month_recorded', 'month_updated', 'month_deleted', 'client_price_changed', 'pricing_approved', 'pricing_returned' \)/,
  )
  assert.match(
    sql,
    /ALTER TABLE public\.equipment_card_events DROP CONSTRAINT equipment_card_events_type_check;/,
  )
  const poCheck = stmt(
    sql,
    'ALTER TABLE public.supplier_po_events ADD CONSTRAINT supplier_po_events_type_check',
  )
  // 0160's list, plus renumbered (0173) and approval_returned (0174).
  for (const type of [
    'created',
    'updated',
    'equipment_added',
    'price_changed',
    'line_updated',
    'card_changed',
    'equipment_removed',
    'approved',
    'approval_returned',
    'renumbered',
    'closed',
    'reopened',
  ])
    assert.match(poCheck, new RegExp(`'${type}'`), type)
  assert.match(
    sql,
    /ALTER TABLE public\.supplier_po_events DROP CONSTRAINT supplier_po_events_type_check;/,
  )
})

test('assert_sales_approve: sales.approve or sales_approve_required (42501), never callable', () => {
  const body = fn(
    sql,
    'CREATE OR REPLACE FUNCTION public.assert_sales_approve()',
  )
  assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(
    body,
    /auth\.uid\(\) IS NULL OR NOT public\.has_permission\('sales\.approve'\)/,
  )
  assert.match(
    body,
    /RAISE EXCEPTION 'sales_approve_required' USING ERRCODE = '42501'/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.assert_sales_approve\(\) FROM PUBLIC, anon, authenticated;/,
  )
})

test('the four writers: SECURITY DEFINER, fixed search_path, their permission first, the card row locked', () => {
  for (const [name, signature] of Object.entries(SIGNATURES)) {
    const body = fn(sql, `CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.match(
      body,
      /SECURITY DEFINER SET search_path = public, pg_temp/,
      name,
    )
    assert.match(
      sql,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${signature.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\\.${signature.replace(/[()]/g, '\\$&')} TO authenticated;`,
      ),
      name,
    )
    assert.match(
      raw,
      new RegExp(
        `COMMENT ON FUNCTION public\\.${signature.replace(/[()]/g, '\\$&')} IS`,
      ),
      name,
    )
  }
  // The price writers check sales.manage, the approval ones sales.approve.
  for (const name of [
    'set_equipment_card_client_price',
    'set_equipment_card_client_prices',
  ]) {
    const body = fn(sql, `CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.match(body, /BEGIN PERFORM public\.assert_sales_manage\(\);/, name)
  }
  for (const name of [
    'approve_equipment_card_pricing',
    'return_equipment_card_pricing',
  ]) {
    const body = fn(sql, `CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.match(body, /BEGIN PERFORM public\.assert_sales_approve\(\);/, name)
  }
  // The card row FOR UPDATE before any read or write of the card.
  for (const name of [
    'set_equipment_card_client_price',
    'approve_equipment_card_pricing',
    'return_equipment_card_pricing',
  ]) {
    const body = fn(sql, `CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.match(
      body,
      /FROM public\.equipment_cards c WHERE c\.id = p_card_id FOR UPDATE;/,
      name,
    )
    assert.match(
      body,
      /RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023'/,
      name,
    )
  }
})

test('set_equipment_card_client_price: NULL = no price, the bound, the approved lock, no event when unchanged', () => {
  const body = fn(
    sql,
    'CREATE OR REPLACE FUNCTION public.set_equipment_card_client_price(',
  )
  assert.match(body, /p_card_id uuid, p_price numeric \) RETURNS void/)
  assert.match(
    body,
    /IF v_card\.pricing_status = 'approved' THEN RAISE EXCEPTION 'card_pricing_approved_locked' USING ERRCODE = '55000'/,
  )
  assert.match(
    body,
    /IF p_price IS NOT NULL AND \(p_price = 'NaN'::numeric OR p_price < 0 OR p_price > 9999999999\.99\) THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'/,
  )
  assert.match(body, /v_price := round\(p_price, 2\);/)
  assert.match(
    body,
    /IF v_price IS NOT DISTINCT FROM v_card\.client_price THEN RETURN; END IF;/,
  )
  assert.match(
    body,
    /UPDATE public\.equipment_cards SET client_price = v_price WHERE id = p_card_id;/,
  )
  assert.match(
    body,
    /record_equipment_card_event\( p_card_id, 'client_price_changed', jsonb_build_object\('old_price', v_card\.client_price, 'new_price', v_price\) \)/,
  )
})

test('set_equipment_card_client_prices: the batch through the single setter, one transaction, the count', () => {
  const body = fn(
    sql,
    'CREATE OR REPLACE FUNCTION public.set_equipment_card_client_prices(',
  )
  assert.match(body, /p_items jsonb \) RETURNS integer/)
  assert.match(
    body,
    /IF p_items IS NULL OR jsonb_typeof\(p_items\) <> 'array' THEN RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023'/,
  )
  assert.match(
    body,
    /jsonb_array_elements\(p_items\) WITH ORDINALITY AS items\(value, ord\) ORDER BY ord/,
  )
  assert.match(
    body,
    /jsonb_typeof\(v_item -> 'card_id'\) IS DISTINCT FROM 'string'/,
  )
  assert.match(
    body,
    /COALESCE\(jsonb_typeof\(v_item -> 'price'\), 'null'\) NOT IN \('number', 'null'\)/,
  )
  assert.match(
    body,
    /PERFORM public\.set_equipment_card_client_price\( v_card_id, \(v_item ->> 'price'\)::numeric \); v_count := v_count \+ 1;/,
  )
  assert.match(body, /RETURN v_count;/)
  // No savepoint / exception block around the setter: a refused item
  // refuses the whole batch.
  assert.doesNotMatch(
    body.slice(body.indexOf('PERFORM public.set_equipment_card_client_price(')),
    /EXCEPTION WHEN/,
  )
})

test('approve_equipment_card_pricing: draft, a client price, a priced supplier line on an open PO; then the PO when all its cards are approved', () => {
  const body = fn(
    sql,
    'CREATE OR REPLACE FUNCTION public.approve_equipment_card_pricing(',
  )
  assert.match(body, /p_card_id uuid\) RETURNS void/)
  assert.match(
    body,
    /IF v_card\.pricing_status <> 'draft' THEN RAISE EXCEPTION 'card_pricing_not_draft' USING ERRCODE = '55000'/,
  )
  assert.match(
    body,
    /IF v_card\.client_price IS NULL THEN RAISE EXCEPTION 'card_pricing_no_client_price' USING ERRCODE = '55000'/,
  )
  // The supplier line as sales_equipment_cards finds it: the open PO's first.
  assert.match(
    body,
    /FROM public\.supplier_po_equipment sl JOIN public\.supplier_pos sp ON sp\.id = sl\.supplier_po_id WHERE sl\.equipment_card_id = p_card_id ORDER BY \(sp\.status = 'open'\) DESC, sp\.created_at DESC, sp\.id DESC LIMIT 1;/,
  )
  assert.match(
    body,
    /RAISE EXCEPTION 'card_pricing_no_supplier_line' USING ERRCODE = '55000'/,
  )
  // The PO row lock, then open and priced (0 counts: IS NULL only).
  assert.match(
    body,
    /FROM public\.supplier_pos p WHERE p\.id = v_line\.supplier_po_id FOR UPDATE;/,
  )
  assert.match(
    body,
    /IF v_po\.status <> 'open' THEN RAISE EXCEPTION 'card_pricing_no_supplier_line'/,
  )
  assert.match(
    body,
    /IF v_line\.price IS NULL THEN RAISE EXCEPTION 'card_pricing_no_supplier_price' USING ERRCODE = '55000'/,
  )
  assert.doesNotMatch(body, /v_line\.price <= 0|v_line\.price = 0/)
  assert.match(
    body,
    /UPDATE public\.equipment_cards SET pricing_status = 'approved', pricing_approved_at = now\(\), pricing_approved_by = auth\.uid\(\) WHERE id = p_card_id;/,
  )
  // The owner's rule: every line's card approved + an open draft PO → the
  // PO approved directly, NOT through approve_supplier_po.
  assert.match(body, /IF v_po\.approval_status = 'draft' THEN/)
  assert.match(
    body,
    /NOT EXISTS \( SELECT 1 FROM public\.supplier_po_equipment l JOIN public\.equipment_cards c ON c\.id = l\.equipment_card_id WHERE l\.supplier_po_id = v_po\.id AND c\.pricing_status <> 'approved' \)/,
  )
  assert.match(body, /v_line_count > 0 AND NOT EXISTS/)
  assert.doesNotMatch(body, /approve_supplier_po\(/)
  assert.match(
    body,
    /UPDATE public\.supplier_pos SET approval_status = 'approved', approved_at = now\(\), approved_by = auth\.uid\(\) WHERE id = v_po\.id;/,
  )
  assert.match(
    body,
    /INSERT INTO public\.supplier_po_events \(supplier_po_id, event_type, payload, actor_id\) VALUES \( v_po\.id, 'approved', jsonb_build_object\( 'via', 'card_pricing', 'card_id', p_card_id, 'line_count', v_line_count \), auth\.uid\(\) \);/,
  )
  // The card event carries both prices, the PO and whether it got approved.
  assert.match(
    body,
    /record_equipment_card_event\( p_card_id, 'pricing_approved', jsonb_build_object\( 'client_price', v_card\.client_price, 'supplier_price', v_line\.price, 'supplier_rate_unit', v_line\.rate_unit, 'supplier_po_id', v_po\.id, 'supplier_po_number', v_po\.po_number, 'supplier_po_approved', v_po_approved \) \)/,
  )
})

test('return_equipment_card_pricing: approved only, back to draft with the note; an approved OPEN PO back to draft too', () => {
  const body = fn(
    sql,
    'CREATE OR REPLACE FUNCTION public.return_equipment_card_pricing(',
  )
  assert.match(body, /p_card_id uuid, p_note text DEFAULT NULL \) RETURNS void/)
  assert.match(
    body,
    /IF v_card\.pricing_status <> 'approved' THEN RAISE EXCEPTION 'card_pricing_not_approved' USING ERRCODE = '55000'/,
  )
  assert.match(body, /v_note := NULLIF\(btrim\(p_note\), ''\);/)
  assert.match(
    body,
    /IF char_length\(v_note\) > 500 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023'/,
  )
  assert.match(
    body,
    /UPDATE public\.equipment_cards SET pricing_status = 'draft', pricing_approved_at = NULL, pricing_approved_by = NULL WHERE id = p_card_id;/,
  )
  // The PO: the open PO's line first, locked, and only an approved OPEN PO
  // goes back (a closed PO is history).
  assert.match(
    body,
    /ORDER BY \(sp\.status = 'open'\) DESC, sp\.created_at DESC, sp\.id DESC LIMIT 1 FOR UPDATE OF sp;/,
  )
  assert.match(
    body,
    /IF v_po_found AND v_po\.status = 'open' AND v_po\.approval_status = 'approved' THEN v_po_returned := true;/,
  )
  assert.match(
    body,
    /UPDATE public\.supplier_pos SET approval_status = 'draft', approved_at = NULL, approved_by = NULL WHERE id = v_po\.id;/,
  )
  assert.match(
    body,
    /INSERT INTO public\.supplier_po_events \(supplier_po_id, event_type, payload, actor_id\) VALUES \( v_po\.id, 'approval_returned', jsonb_build_object\( 'via', 'card_pricing', 'card_id', p_card_id, 'note', v_note,/,
  )
  assert.match(
    body,
    /record_equipment_card_event\( p_card_id, 'pricing_returned', jsonb_build_object\( 'note', v_note,/,
  )
})

test('sales_equipment_cards: the 0169 columns verbatim, then the trailing pricing columns with the margin rule', () => {
  const previous = norm(
    read('supabase', 'migrations', '20261102120000_0169_client_pos.sql'),
  )
  const head = (source) => {
    const start = source.indexOf(
      'CREATE OR REPLACE VIEW public.sales_equipment_cards',
    )
    return source.slice(start, source.indexOf('has_supplier_po', start))
  }
  // Every 0169 column, in the same order and the same text, up to the last
  // 0169 column (0172's views select them by name).
  assert.equal(head(sql), head(previous))
  const view = stmt(sql, 'CREATE OR REPLACE VIEW public.sales_equipment_cards')
  assert.match(view, /WITH \(security_invoker = true\)/)
  const trailing = view.slice(view.indexOf('AS has_supplier_po'))
  const order = [
    'c.client_price AS card_client_price',
    'c.pricing_status',
    'c.pricing_approved_at',
    'c.pricing_approved_by',
    'pn.full_name AS pricing_approved_by_name',
    'm.card_margin',
    'AS card_margin_pct',
    'sp.supplier_po_approval_status',
  ]
  let last = -1
  for (const column of order) {
    const at = trailing.indexOf(column)
    assert.ok(at > last, column)
    last = at
  }
  assert.match(
    view,
    /LEFT JOIN public\.profile_names pn ON pn\.id = c\.pricing_approved_by/,
  )
  // The margin: both prices set and a MONTHLY supplier line, rounded.
  assert.match(
    view,
    /CASE WHEN c\.client_price IS NOT NULL AND sp\.supplier_price IS NOT NULL AND sp\.supplier_rate_unit = 'month' THEN round\(c\.client_price - sp\.supplier_price, 2\) ELSE NULL END AS card_margin/,
  )
  // The percentage over the client price, NULL when NULL or 0.
  assert.match(
    view,
    /CASE WHEN m\.card_margin IS NULL OR c\.client_price IS NULL OR c\.client_price = 0 THEN NULL ELSE round\(m\.card_margin \/ c\.client_price \* 100, 2\) END AS card_margin_pct/,
  )
  // Never dropped: 0172's views depend on it.
  assert.doesNotMatch(sql, /DROP VIEW/)
  assert.match(
    sql,
    /REVOKE ALL ON public\.sales_equipment_cards FROM PUBLIC, anon; GRANT SELECT ON public\.sales_equipment_cards TO authenticated;/,
  )
})

test('the stable tokens the client maps are exactly the ones the migration raises', () => {
  const raised = new Set(
    [...sql.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((match) => match[1]),
  )
  assert.deepEqual([...raised].sort(), [
    'card_pricing_approved_locked',
    'card_pricing_no_client_price',
    'card_pricing_no_supplier_line',
    'card_pricing_no_supplier_price',
    'card_pricing_not_approved',
    'card_pricing_not_draft',
    'invalid_card',
    'invalid_items',
    'invalid_note',
    'invalid_price',
    'sales_approve_required',
  ])
  // Nothing else is touched: no movement, photo, master-data or policy change.
  assert.doesNotMatch(
    sql,
    /entry_exit_logs SET|entry_exit_photos|CREATE POLICY|DROP POLICY|storage\./,
  )
})
