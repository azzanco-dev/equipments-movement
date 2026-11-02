// Migration 0169 (owner 2026-11-01 / 2026-11-02, sales phase 1): client
// purchase orders («PO العملاء») — the database layer mirroring the
// supplier-PO layer on the shared «كرت المعدة». Static checks of the
// migration's source: the keys and the role, the three tables with their
// updated_at triggers and RLS, the SECURITY DEFINER writers with the fixed
// search_path, the permission check and the stable tokens, the join rule and
// the card reuse of add_client_po_equipment, the two security_invoker views,
// and purchasing_site_units kept verbatim plus trailing columns.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261102120000_0169_client_pos.sql'
const PREVIOUS_VIEW = '20261028160000_0160_supplier_po_approval.sql'

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
  return source.slice(start, source.indexOf('$$;', source.indexOf('$$', start) + 2) + 3)
}

/** The order of fragments inside a body: each after the previous one. */
const inOrder = (body, fragments) => {
  let at = 0
  for (const fragment of fragments) {
    const next = body.indexOf(fragment, at)
    assert.ok(next >= at, `expected in order: ${fragment}`)
    at = next + fragment.length
  }
}

const SIGNATURES = {
  create_client_po: 'create_client_po(uuid, uuid, text, date, date, integer, text, jsonb)',
  add_client_po_equipment: 'add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)',
  update_client_po: 'update_client_po(uuid, date, date, text)',
  update_client_po_equipment: 'update_client_po_equipment(uuid, numeric, text, integer, numeric, text)',
  close_client_po: 'close_client_po(uuid)',
}

test('0169 is the single 0169 migration, right after 0168', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0169 present')
  assert.match(migrations[at - 1], /_0168_/)
  assert.equal(migrations.filter((file) => /_0169_/.test(file)).length, 1)
})

test('the keys: sales.view and sales.manage, group sales, database-enforced, manage requires view', () => {
  assert.match(
    sql,
    /\('sales\.view', 'sales', 'المبيعات: عرض', 'Sales: view', '[^']+', '[^']+', false, NULL, '\{\}', false, 'database', 1100\)/,
  )
  assert.match(
    sql,
    /\('sales\.manage', 'sales', 'المبيعات: ادارة', 'Sales: manage', '[^']+', '[^']+', false, NULL, ARRAY\['sales\.view'\], false, 'database', 1110\) ON CONFLICT \(key\) DO NOTHING;/,
  )
  // The admin holds both (the role assignment is the only mapping since 0156).
  assert.match(
    sql,
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\) VALUES \('admin', 'sales\.view', NULL\), \('admin', 'sales\.manage', NULL\) ON CONFLICT \(role_key, permission_key\) DO NOTHING;/,
  )
  assert.doesNotMatch(sql, /legacy_role_permissions/)
})

test('the custom role «المبيعات» holds both keys and reads purchasing; purchasing reads sales', () => {
  assert.match(
    sql,
    /INSERT INTO public\.roles \(key, name_ar, name_en, description_ar, description_en, is_system, is_active\) VALUES \( 'sales', 'المبيعات', 'Sales', '[^']+', '[^']+', false, true \) ON CONFLICT \(key\) DO NOTHING;/,
  )
  for (const row of [
    "('sales', 'sales.view', NULL)",
    "('sales', 'sales.manage', NULL)",
    "('sales', 'purchasing.view', NULL)",
    "('sales', 'movements.read', 'all')",
    "('sales', 'equipment.read', NULL)",
    "('purchasing', 'sales.view', NULL)",
  ])
    assert.ok(sql.includes(row), row)
  // The role never manages purchasing.
  assert.doesNotMatch(sql, /\('sales', 'purchasing\.manage'/)
  // The shared card is read by either side.
  assert.match(
    sql,
    /CREATE POLICY select_equipment_cards ON public\.equipment_cards FOR SELECT TO authenticated USING \(\(SELECT public\.has_permission\('purchasing\.view'\)\) OR \(SELECT public\.has_permission\('sales\.view'\)\)\);/,
  )
})

test('client_pos: the client number per company, dates, default hours, status, updated_at', () => {
  const table = sql.slice(sql.indexOf('CREATE TABLE public.client_pos ('), sql.indexOf('CREATE UNIQUE INDEX client_pos_company_number_unique'))
  assert.match(table, /company_id uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE RESTRICT/)
  assert.match(table, /project_id uuid NOT NULL REFERENCES public\.projects\(id\) ON DELETE RESTRICT/)
  assert.match(
    table,
    /po_number text NOT NULL CONSTRAINT client_pos_number_check CHECK \(po_number = btrim\(po_number\) AND po_number <> '' AND char_length\(po_number\) <= 60\)/,
  )
  assert.match(table, /issue_date date NOT NULL, expiry_date date,/)
  assert.match(table, /standard_hours integer NOT NULL DEFAULT 260 CONSTRAINT client_pos_standard_hours_check CHECK \(standard_hours > 0\)/)
  assert.match(table, /status text NOT NULL DEFAULT 'open' CONSTRAINT client_pos_status_check CHECK \(status IN \('open', 'closed'\)\)/)
  assert.match(table, /closed_at timestamptz, closed_by uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/)
  assert.match(table, /notes text CONSTRAINT client_pos_notes_check CHECK \(char_length\(notes\) <= 1000\)/)
  assert.match(table, /created_at timestamptz NOT NULL DEFAULT now\(\), updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(table, /CHECK \(expiry_date IS NULL OR expiry_date >= issue_date\)/)
  assert.match(table, /CHECK \(\(status = 'closed'\) = \(closed_at IS NOT NULL\)\)/)
  // No approval, no generated number.
  assert.doesNotMatch(table, /approval|SPO|counter/)
  assert.match(sql, /CREATE UNIQUE INDEX client_pos_company_number_unique ON public\.client_pos \(company_id, upper\(btrim\(po_number\)\)\);/)
  for (const index of [
    'client_pos_company_project_idx ON public.client_pos (company_id, project_id)',
    'client_pos_status_issue_idx ON public.client_pos (status, issue_date DESC)',
    'client_pos_updated_at_id_idx ON public.client_pos (updated_at DESC, id DESC)',
    'client_pos_po_number_trgm_idx ON public.client_pos USING gin (po_number extensions.gin_trgm_ops)',
  ])
    assert.ok(sql.includes(`CREATE INDEX ${index};`), index)
  assert.match(sql, /CREATE TRIGGER client_pos_updated_at BEFORE UPDATE ON public\.client_pos FOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\);/)
  // The computed column, as unpriced_count(supplier_pos).
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.unpriced_count\(po public\.client_pos\) RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS \$\$ SELECT count\(\*\)::integer FROM public\.client_po_equipment l WHERE l\.client_po_id = po\.id AND l\.price IS NULL; \$\$;/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.unpriced_count\(public\.client_pos\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.unpriced_count\(public\.client_pos\) TO authenticated;/)
})

test('client_po_equipment: the card line with price, unit, hours, quantity; one open client PO per card', () => {
  const table = sql.slice(sql.indexOf('CREATE TABLE public.client_po_equipment ('), sql.indexOf('CREATE INDEX client_po_equipment_card_idx'))
  assert.match(table, /client_po_id uuid NOT NULL REFERENCES public\.client_pos\(id\) ON DELETE CASCADE/)
  assert.match(table, /equipment_card_id uuid NOT NULL REFERENCES public\.equipment_cards\(id\) ON DELETE RESTRICT/)
  assert.match(table, /price numeric\(12, 2\) CONSTRAINT client_po_equipment_price_check CHECK \(price IS NULL OR price >= 0\)/)
  assert.match(table, /rate_unit text NOT NULL DEFAULT 'month' CONSTRAINT client_po_equipment_rate_unit_check CHECK \(rate_unit IN \('month', 'day', 'hour'\)\)/)
  assert.match(table, /standard_hours integer NOT NULL CONSTRAINT client_po_equipment_standard_hours_check CHECK \(standard_hours > 0\)/)
  assert.match(table, /quantity numeric\(12, 2\) CONSTRAINT client_po_equipment_quantity_check CHECK \(quantity IS NULL OR quantity > 0\)/)
  assert.match(table, /note text CONSTRAINT client_po_equipment_note_check CHECK \(char_length\(note\) <= 500\)/)
  assert.match(table, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(table, /CONSTRAINT client_po_equipment_unique UNIQUE \(client_po_id, equipment_card_id\)/)
  assert.match(sql, /CREATE TRIGGER client_po_equipment_updated_at BEFORE UPDATE ON public\.client_po_equipment FOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\);/)
  // The 0136 way: a trigger, a card on at most one OPEN client PO.
  const single = fn(sql, 'CREATE OR REPLACE FUNCTION public.enforce_client_po_equipment_single_open()')
  assert.match(single, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(single, /WHERE l\.equipment_card_id = NEW\.equipment_card_id AND l\.id <> NEW\.id AND p\.status = 'open'/)
  assert.match(single, /RAISE EXCEPTION 'equipment_already_on_open_client_po' USING ERRCODE = '23505'/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.enforce_client_po_equipment_single_open\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /CREATE TRIGGER client_po_equipment_single_open BEFORE INSERT OR UPDATE OF equipment_card_id, client_po_id ON public\.client_po_equipment FOR EACH ROW EXECUTE FUNCTION public\.enforce_client_po_equipment_single_open\(\);/)
  // A line change touches its PO (the 0146 rule).
  const touch = fn(sql, 'CREATE OR REPLACE FUNCTION public.touch_client_po_from_line()')
  assert.match(touch, /UPDATE public\.client_pos SET updated_at = now\(\) WHERE id = OLD\.client_po_id; RETURN OLD;/)
  assert.match(touch, /UPDATE public\.client_pos SET updated_at = now\(\) WHERE id = NEW\.client_po_id;/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.touch_client_po_from_line\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /CREATE TRIGGER client_po_equipment_touch_po AFTER INSERT OR UPDATE OR DELETE ON public\.client_po_equipment FOR EACH ROW EXECUTE FUNCTION public\.touch_client_po_from_line\(\);/)
})

test('client_po_events: append-only with seq, the six event types, the actor and the actor name', () => {
  const table = sql.slice(sql.indexOf('CREATE TABLE public.client_po_events ('), sql.indexOf('CREATE INDEX client_po_events_po_seq_idx'))
  assert.match(table, /seq bigint GENERATED BY DEFAULT AS IDENTITY/)
  assert.match(table, /client_po_id uuid NOT NULL REFERENCES public\.client_pos\(id\) ON DELETE CASCADE/)
  assert.match(table, /event_type IN \('created', 'updated', 'equipment_added', 'line_updated', 'price_changed', 'closed'\)/)
  assert.match(table, /payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/)
  assert.match(table, /actor_id uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL, actor_name text, created_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.doesNotMatch(table, /updated_at/)
  assert.match(sql, /CREATE INDEX client_po_events_po_seq_idx ON public\.client_po_events \(client_po_id, created_at, seq\);/)
  // The writer of every event, with the actor name from profile_names.
  const record = fn(sql, 'CREATE OR REPLACE FUNCTION public.record_client_po_event(')
  assert.match(record, /SELECT full_name INTO v_actor_name FROM public\.profile_names WHERE id = auth\.uid\(\);/)
  assert.match(record, /INSERT INTO public\.client_po_events \(client_po_id, event_type, payload, actor_id, actor_name\)/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_client_po_event\(uuid, text, jsonb\) FROM PUBLIC, anon, authenticated;/)
})

test('RLS: every sales table selects on sales.view and has no write policy', () => {
  for (const table of ['client_pos', 'client_po_equipment', 'client_po_events']) {
    assert.ok(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), table)
    assert.ok(
      sql.includes(
        `CREATE POLICY select_${table} ON public.${table} FOR SELECT TO authenticated USING ((SELECT public.has_permission('sales.view')));`,
      ),
      `select policy of ${table}`,
    )
    assert.doesNotMatch(sql, new RegExp(`CREATE POLICY \\w+ ON public\\.${table} FOR (INSERT|UPDATE|DELETE|ALL)`))
  }
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\.client_/)
})

test('every writer: SECURITY DEFINER, fixed search_path, the permission first, authenticated only', () => {
  const assertion = fn(sql, 'CREATE OR REPLACE FUNCTION public.assert_sales_manage()')
  assert.match(assertion, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(
    assertion,
    /IF auth\.uid\(\) IS NULL OR NOT public\.has_permission\('sales\.manage'\) THEN RAISE EXCEPTION 'sales_manage_required' USING ERRCODE = '42501'/,
  )
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.assert_sales_manage\(\) FROM PUBLIC, anon, authenticated;/)
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    const body = fn(sql, `CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.match(body, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$/, name)
    assert.match(body, /BEGIN PERFORM public\.assert_sales_manage\(\);/, `${name} checks the permission first`)
    const escaped = sig.replace(/[()]/g, '\\$&')
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\\.${escaped} TO authenticated;`),
      `grants of ${sig}`,
    )
    assert.match(sql, new RegExp(`COMMENT ON FUNCTION public\\.${escaped} IS`), `comment of ${sig}`)
  }
  // No SECURITY DEFINER function without the fixed search_path.
  const definers = sql.match(/SECURITY DEFINER [^$]{0,60}/g) ?? []
  assert.equal(definers.length, 9, 'nine SECURITY DEFINER functions')
  for (const head of definers) assert.match(head, /^SECURITY DEFINER SET search_path = public, pg_temp/)
})

test('create_client_po: validates, refuses a duplicate client number, creates the lines in one transaction', () => {
  const body = fn(sql, 'CREATE OR REPLACE FUNCTION public.create_client_po(')
  assert.match(
    body,
    /create_client_po\( p_company_id uuid, p_project_id uuid, p_po_number text, p_issue_date date, p_expiry_date date DEFAULT NULL, p_standard_hours integer DEFAULT 260, p_notes text DEFAULT NULL, p_equipment jsonb DEFAULT '\[\]'::jsonb \) RETURNS uuid/,
  )
  inOrder(body, [
    "RAISE EXCEPTION 'invalid_company'",
    "RAISE EXCEPTION 'invalid_project'",
    "v_number := NULLIF(btrim(p_po_number), '');",
    "RAISE EXCEPTION 'invalid_po_number'",
    'upper(btrim(p.po_number)) = upper(v_number)',
    "RAISE EXCEPTION 'duplicate_po_number' USING ERRCODE = '23505'",
    "RAISE EXCEPTION 'invalid_issue_date'",
    'IF p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN',
    "RAISE EXCEPTION 'invalid_expiry_date'",
    "RAISE EXCEPTION 'invalid_standard_hours'",
    "RAISE EXCEPTION 'invalid_notes'",
    "RAISE EXCEPTION 'invalid_equipment'",
    'INSERT INTO public.client_pos (',
    'WHEN unique_violation THEN',
    "RAISE EXCEPTION 'duplicate_po_number'",
    "PERFORM public.record_client_po_event( v_id, 'created',",
    'FOR v_item IN SELECT value FROM jsonb_array_elements(',
    'PERFORM public.add_client_po_equipment( v_id,',
    "NULLIF(v_item->>'rate_unit', ''), NULLIF(v_item->>'standard_hours', '')::integer, NULLIF(v_item->>'quantity', '')::numeric, v_item->>'note' );",
  ])
  // No generated number, no approval.
  assert.doesNotMatch(body, /next_|approval/)
})

test('add_client_po_equipment: the join rule, the advisory key, the card reuse, one open client PO', () => {
  const body = fn(sql, 'CREATE OR REPLACE FUNCTION public.add_client_po_equipment(')
  assert.match(
    body,
    /add_client_po_equipment\( p_client_po_id uuid, p_equipment_id uuid, p_price numeric DEFAULT NULL, p_rate_unit text DEFAULT 'month', p_standard_hours integer DEFAULT NULL, p_quantity numeric DEFAULT NULL, p_note text DEFAULT NULL \) RETURNS uuid/,
  )
  inOrder(body, [
    'WHERE p.id = p_client_po_id FOR UPDATE;',
    "RAISE EXCEPTION 'invalid_client_po'",
    "IF v_po.status <> 'open' THEN RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';",
    "RAISE EXCEPTION 'invalid_equipment'",
    "RAISE EXCEPTION 'invalid_price'",
    "v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month'); IF v_rate_unit NOT IN ('month', 'day', 'hour') THEN RAISE EXCEPTION 'invalid_rate_unit'",
    'v_standard_hours := COALESCE(p_standard_hours, v_po.standard_hours);',
    "RAISE EXCEPTION 'invalid_standard_hours'",
    "RAISE EXCEPTION 'invalid_quantity'",
    "RAISE EXCEPTION 'invalid_note'",
    // The unit's advisory key, then the latest movement in the chain's order.
    'PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));',
    'FROM public.entry_exit_logs l WHERE l.equipment_id = p_equipment_id ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;',
    "IF NOT FOUND OR v_last.movement_type <> 'entry' OR v_last.movement_context <> 'site' OR v_last.company_id IS DISTINCT FROM v_po.company_id OR v_last.project_id IS DISTINCT FROM v_po.project_id THEN RAISE EXCEPTION 'equipment_not_at_po_project' USING ERRCODE = '55000'",
    "v_entry_date := (v_last.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;",
    // The card: by the entry first, then by the period, then a new one.
    'AND c.entry_log_id = v_last.id LIMIT 1;',
    'AND c.period_from <= v_entry_date AND (c.period_to IS NULL OR c.period_to >= v_entry_date) ORDER BY c.period_from DESC LIMIT 1;',
    'INSERT INTO public.equipment_cards ( equipment_id, company_id, project_id, period_from, rate_unit, standard_hours, created_by, entry_log_id ) VALUES ( p_equipment_id, v_po.company_id, v_po.project_id, v_entry_date, v_rate_unit, v_standard_hours, auth.uid(), v_last.id )',
    "WHEN exclusion_violation THEN RAISE EXCEPTION 'card_overlap' USING ERRCODE = '23P01'",
    'UPDATE public.equipment_cards SET entry_log_id = v_last.id WHERE id = v_card_id AND entry_log_id IS NULL;',
    "RAISE EXCEPTION 'equipment_already_on_open_client_po' USING ERRCODE = '23505'",
    'INSERT INTO public.client_po_equipment ( client_po_id, equipment_card_id, price, rate_unit, standard_hours, quantity, note, created_by )',
    "WHEN unique_violation THEN RAISE EXCEPTION 'equipment_already_on_open_client_po'",
    "PERFORM public.record_client_po_event( v_po.id, 'equipment_added',",
    'RETURN v_line_id;',
  ])
  // No same-entry-day rule, no party rule, no approval lock (purchasing's).
  assert.doesNotMatch(body, /entry_date_mismatch|start_date|equipment_not_of_po_supplier|approval/)
})

test('update_client_po and close_client_po: open PO only, the identity never changes', () => {
  const update = fn(sql, 'CREATE OR REPLACE FUNCTION public.update_client_po(')
  assert.match(update, /update_client_po\( p_client_po_id uuid, p_issue_date date, p_expiry_date date DEFAULT NULL, p_notes text DEFAULT NULL \) RETURNS void/)
  inOrder(update, [
    'WHERE p.id = p_client_po_id FOR UPDATE;',
    "RAISE EXCEPTION 'client_po_closed'",
    "RAISE EXCEPTION 'invalid_issue_date'",
    "RAISE EXCEPTION 'invalid_expiry_date'",
    "RAISE EXCEPTION 'invalid_notes'",
    'IF p_issue_date = v_po.issue_date AND p_expiry_date IS NOT DISTINCT FROM v_po.expiry_date AND v_notes IS NOT DISTINCT FROM v_po.notes THEN RETURN;',
    'UPDATE public.client_pos SET issue_date = p_issue_date, expiry_date = p_expiry_date, notes = v_notes WHERE id = p_client_po_id;',
    "PERFORM public.record_client_po_event( p_client_po_id, 'updated',",
  ])
  assert.doesNotMatch(update, /SET [^;]*(company_id|project_id|po_number|standard_hours)/)

  const close = fn(sql, 'CREATE OR REPLACE FUNCTION public.close_client_po(')
  inOrder(close, [
    'WHERE p.id = p_client_po_id FOR UPDATE;',
    "RAISE EXCEPTION 'invalid_client_po'",
    "RAISE EXCEPTION 'client_po_closed'",
    "UPDATE public.client_pos SET status = 'closed', closed_at = now(), closed_by = auth.uid() WHERE id = p_client_po_id;",
    "PERFORM public.record_client_po_event(p_client_po_id, 'closed', '{}'::jsonb);",
  ])
})

test('update_client_po_equipment: NULL price = unpriced, price_changed vs line_updated, old and new', () => {
  const body = fn(sql, 'CREATE OR REPLACE FUNCTION public.update_client_po_equipment(')
  assert.match(
    body,
    /update_client_po_equipment\( p_line_id uuid, p_price numeric, p_rate_unit text DEFAULT NULL, p_standard_hours integer DEFAULT NULL, p_quantity numeric DEFAULT NULL, p_note text DEFAULT NULL \) RETURNS void/,
  )
  inOrder(body, [
    "RAISE EXCEPTION 'invalid_line'",
    'WHERE p.id = v_line.client_po_id FOR UPDATE;',
    "RAISE EXCEPTION 'client_po_closed'",
    "IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN RAISE EXCEPTION 'invalid_price'",
    "v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit); IF v_rate_unit NOT IN ('month', 'day', 'hour') THEN RAISE EXCEPTION 'invalid_rate_unit'",
    'v_standard_hours := COALESCE(p_standard_hours, v_line.standard_hours);',
    "RAISE EXCEPTION 'invalid_quantity'",
    "RAISE EXCEPTION 'invalid_note'",
    'v_price_changed := p_price IS DISTINCT FROM v_line.price;',
    'UPDATE public.client_po_equipment SET price = p_price, rate_unit = v_rate_unit, standard_hours = v_standard_hours, quantity = p_quantity, note = v_note WHERE id = v_line.id;',
    "CASE WHEN v_price_changed THEN 'price_changed' ELSE 'line_updated' END",
    "'old_price', v_line.price, 'new_price', p_price,",
    "'old_quantity', v_line.quantity, 'new_quantity', p_quantity,",
  ])
})

test('the tokens of the brief are all raised', () => {
  for (const token of [
    'sales_manage_required',
    'invalid_company',
    'invalid_project',
    'invalid_po_number',
    'duplicate_po_number',
    'invalid_issue_date',
    'invalid_expiry_date',
    'invalid_price',
    'invalid_rate_unit',
    'invalid_standard_hours',
    'invalid_quantity',
    'invalid_line',
    'invalid_client_po',
    'invalid_equipment',
    'client_po_closed',
    'equipment_not_at_po_project',
    'equipment_already_on_open_client_po',
    'card_overlap',
  ])
    assert.match(sql, new RegExp(`RAISE EXCEPTION '${token}'`), token)
})

test('the views: sales_po_units and sales_equipment_cards are security_invoker, select only', () => {
  for (const view of ['sales_po_units', 'sales_equipment_cards']) {
    assert.ok(sql.includes(`CREATE OR REPLACE VIEW public.${view} WITH (security_invoker = true) AS SELECT`), view)
    assert.ok(sql.includes(`REVOKE ALL ON public.${view} FROM PUBLIC, anon; GRANT SELECT ON public.${view} TO authenticated;`), `grants of ${view}`)
    assert.ok(sql.includes(`COMMENT ON VIEW public.${view} IS`), `comment of ${view}`)
  }
  const units = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.sales_po_units'), sql.indexOf('COMMENT ON VIEW public.sales_po_units'))
  for (const column of [
    'l.id AS line_id', 'l.price', 'l.rate_unit', 'l.standard_hours', 'l.quantity', '(l.price IS NOT NULL) AS is_priced',
    'p.id AS client_po_id', 'p.po_number', 'p.status AS po_status', 'p.issue_date', 'p.expiry_date', 'p.standard_hours AS po_standard_hours',
    'co.name_ar AS company_name_ar', 'co.name_en AS company_name_en', 'pr.name_ar AS project_name_ar', 'pr.name_en AS project_name_en',
    'c.equipment_id', 'e.code AS equipment_code', 'e.type AS equipment_type', 'e.type_search AS equipment_type_search',
    'e.plate_number AS equipment_plate_number', 'e.plate_digits AS equipment_plate_digits', 'e.chassis_number AS equipment_chassis_number',
    'e.ownership_status AS equipment_ownership_status', 'e.lessor_id AS equipment_lessor_id', 'ls.name AS equipment_lessor_name',
    'c.period_from AS card_period_from', 'c.period_to AS card_period_to',
    'sp.supplier_po_id', 'sp.supplier_po_number', 'sp.supplier_price', 'sp.supplier_rate_unit',
  ])
    assert.ok(units.includes(column), `sales_po_units: ${column}`)
  assert.match(units, /FROM public\.client_po_equipment l JOIN public\.client_pos p ON p\.id = l\.client_po_id JOIN public\.equipment_cards c ON c\.id = l\.equipment_card_id LEFT JOIN public\.equipment e/)
  assert.match(units, /WHERE sl\.equipment_card_id = c\.id ORDER BY \(sp2\.status = 'open'\) DESC, sp2\.created_at DESC, sp2\.id DESC LIMIT 1 \) sp ON true;/)

  const cards = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.sales_equipment_cards'), sql.indexOf('COMMENT ON VIEW public.sales_equipment_cards'))
  for (const column of [
    'c.id AS card_id', 'c.equipment_id', 'c.company_id', 'c.project_id', 'c.period_from', 'c.period_to', '(c.period_to IS NULL) AS is_open',
    'c.entry_log_id', 'el.recorded_at AS entry_at',
    'e.code AS equipment_code', 'e.chassis_number AS equipment_chassis_number', 'ls.name AS equipment_lessor_name',
    'cl.client_po_id', 'cl.client_po_number', 'cl.client_price', 'cl.client_rate_unit', 'cl.client_standard_hours', 'cl.client_quantity',
    "(cl.client_po_id IS NOT NULL AND cl.client_po_status = 'open') AS has_client_po",
    'sp.supplier_po_id', 'sp.supplier_po_number', 'sp.supplier_price', 'sp.supplier_rate_unit',
    "(sp.supplier_po_id IS NOT NULL AND sp.supplier_po_status = 'open') AS has_supplier_po",
  ])
    assert.ok(cards.includes(column), `sales_equipment_cards: ${column}`)
  assert.match(cards, /FROM public\.equipment_cards c LEFT JOIN public\.equipment e ON e\.id = c\.equipment_id/)
})

test('purchasing_site_units: the 0160 view verbatim plus the trailing client columns', () => {
  const before = norm(read('supabase', 'migrations', PREVIOUS_VIEW))
  const END = "AND v.movement_context = 'site';"
  const view = (source) =>
    source.slice(
      source.indexOf('CREATE OR REPLACE VIEW public.purchasing_site_units'),
      source.indexOf(END) + END.length,
    )
  const previous = view(before)
  const current = view(sql)
  // The column list of 0160, in order, stays exactly what it was.
  const previousColumns = previous.slice(previous.indexOf('SELECT') + 7, previous.indexOf('FROM public.movement_visits v'))
  const currentColumns = current.slice(current.indexOf('SELECT') + 7, current.indexOf('FROM public.movement_visits v'))
  assert.equal(
    previousColumns.trim(),
    'v.entry_id, v.equipment_id, v.equipment_code, v.equipment_type, v.equipment_type_search, v.equipment_plate_number, e.chassis_number AS equipment_chassis_number, v.equipment_ownership_status, v.equipment_lessor_id, v.equipment_lessor_name, v.company_id, v.company_name_ar, v.company_name_en, v.project_id, v.project_name_ar, v.project_name_en, v.entry_supervisor_id, v.entry_supervisor_name, v.entry_at, v.contractor_equipment_code, po.id AS supplier_po_id, po.po_number, (po.id IS NOT NULL) AS has_po, party_po.id AS party_po_id, party_po.po_number AS party_po_number',
  )
  assert.ok(currentColumns.startsWith(`${previousColumns.trim()}, `), 'the existing columns lead, untouched')
  assert.equal(
    currentColumns.slice(previousColumns.trim().length).trim(),
    ', cpo.id AS client_po_id, cpo.po_number AS client_po_number, (cpo.id IS NOT NULL) AS has_client_po, project_cpo.id AS project_client_po_id, project_cpo.po_number AS project_client_po_number'.trim(),
  )
  // The joins of 0160 stay verbatim; the two client joins are added before the WHERE.
  const previousFrom = previous.slice(previous.indexOf('FROM public.movement_visits v'), previous.indexOf('WHERE v.is_open'))
  const currentFrom = current.slice(current.indexOf('FROM public.movement_visits v'), current.indexOf('WHERE v.is_open'))
  assert.ok(currentFrom.startsWith(previousFrom), 'the 0160 joins lead, untouched')
  const added = currentFrom.slice(previousFrom.length)
  assert.match(added, /^LEFT JOIN LATERAL \( SELECT p\.id, p\.po_number FROM public\.client_po_equipment l JOIN public\.equipment_cards c ON c\.id = l\.equipment_card_id JOIN public\.client_pos p ON p\.id = l\.client_po_id WHERE c\.equipment_id = v\.equipment_id AND p\.status = 'open' AND p\.company_id = v\.company_id AND p\.project_id = v\.project_id ORDER BY p\.created_at DESC, p\.id DESC LIMIT 1 \) cpo ON true/)
  assert.match(added, /LEFT JOIN LATERAL \( SELECT p\.id, p\.po_number FROM public\.client_pos p WHERE cpo\.id IS NULL AND p\.status = 'open' AND p\.company_id = v\.company_id AND p\.project_id = v\.project_id ORDER BY p\.created_at DESC, p\.id DESC LIMIT 1 \) project_cpo ON true $/)
  assert.ok(current.includes("WHERE v.is_open AND v.movement_context = 'site';"))
  assert.match(sql, /REVOKE ALL ON public\.purchasing_site_units FROM PUBLIC, anon; GRANT SELECT ON public\.purchasing_site_units TO authenticated;/)
})

test('every object carries a COMMENT ON; the Arabic copy uses plain alif', () => {
  for (const name of [
    'TABLE public.client_pos', 'TABLE public.client_po_equipment', 'TABLE public.client_po_events', 'TABLE public.equipment_cards',
    'VIEW public.sales_po_units', 'VIEW public.sales_equipment_cards', 'VIEW public.purchasing_site_units',
    'FUNCTION public.assert_sales_manage()', 'FUNCTION public.record_client_po_event(uuid, text, jsonb)',
    'FUNCTION public.enforce_client_po_equipment_single_open()', 'FUNCTION public.touch_client_po_from_line()',
  ])
    assert.ok(sql.includes(`COMMENT ON ${name} IS`), name)
  // No alif with hamza or madda anywhere in the file (owner rule).
  assert.doesNotMatch(raw, /[أإآ]/)
  // Nothing is applied here: no push, no data rewrite of the supplier side.
  assert.doesNotMatch(sql, /UPDATE public\.supplier_po|DELETE FROM|DROP TABLE/)
})
