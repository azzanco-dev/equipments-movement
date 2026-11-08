// Migration 0185 (owner decisions 2026-11-08): four price units (month,
// week, day, hour), days on the month record with the due per unit and the
// presence days, the manual card end / reopening and the view of the cards
// awaiting their end — the database layer only. Static checks of the
// migration's source.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const MIGRATION = '20261108100000_0185_price_units_days_card_end.sql'
const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const raw = fs
  .readFileSync(path.join(root, 'supabase', 'migrations', MIGRATION), 'utf8')
  .replace(/\r\n/g, '\n')
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(raw)
const header = raw.slice(0, raw.indexOf('\nALTER TABLE'))

/** One function from its CREATE to the closing `$$;`. */
const fn = (head) => {
  const start = sql.indexOf(head)
  assert.ok(start >= 0, head)
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3)
}
/** One statement from its head to the next `;`. */
const stmt = (head) => {
  const start = sql.indexOf(head)
  assert.ok(start >= 0, head)
  return sql.slice(start, sql.indexOf(';', start) + 1)
}

const FOUR = "('month', 'week', 'day', 'hour')"

test('0185 is the single 0185 migration and sorts after 0184', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0)
  assert.equal(migrations.filter((file) => /_0185_/.test(file)).length, 1)
  assert.ok(migrations.slice(0, at).some((file) => /_0184_/.test(file)))
})

test('the three unit CHECKs and the card client price unit carry the four values', () => {
  for (const [table, name] of [
    ['supplier_po_equipment', 'supplier_po_equipment_rate_unit_check'],
    ['client_po_equipment', 'client_po_equipment_rate_unit_check'],
    ['equipment_cards', 'equipment_cards_rate_unit_check'],
  ]) {
    assert.ok(sql.includes(`ALTER TABLE public.${table} DROP CONSTRAINT ${name};`), name)
    assert.ok(
      sql.includes(`ALTER TABLE public.${table} ADD CONSTRAINT ${name} CHECK (rate_unit IN ${FOUR});`),
      name,
    )
  }
  assert.ok(
    sql.includes(
      `ADD COLUMN IF NOT EXISTS client_price_unit text NOT NULL DEFAULT 'month' CONSTRAINT equipment_cards_client_price_unit_check CHECK (client_price_unit IN ${FOUR})`,
    ),
  )
})

test('the four PO line writers validate the four units; the create functions are not re-created', () => {
  for (const name of [
    'add_supplier_po_equipment',
    'update_supplier_po_equipment',
    'add_client_po_equipment',
    'update_client_po_equipment',
  ]) {
    const body = fn(`CREATE OR REPLACE FUNCTION public.${name}(`)
    assert.ok(body.includes(`IF v_rate_unit NOT IN ${FOUR} THEN RAISE EXCEPTION 'invalid_rate_unit'`), name)
    assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/)
  }
  assert.doesNotMatch(sql, /FUNCTION public\.create_(supplier|client)_po\(/)
})

test('the dropped signatures are dropped before being re-created', () => {
  for (const [drop, create] of [
    [
      'DROP FUNCTION public.set_equipment_card_client_price(uuid, numeric);',
      'CREATE FUNCTION public.set_equipment_card_client_price( p_card_id uuid, p_price numeric, p_rate_unit text DEFAULT NULL )',
    ],
    [
      'DROP FUNCTION public.record_equipment_card_month(uuid, date, numeric, text);',
      'CREATE FUNCTION public.record_equipment_card_month( p_card_id uuid, p_month date, p_hours numeric, p_note text DEFAULT NULL, p_days numeric DEFAULT NULL )',
    ],
    [
      'DROP FUNCTION public.card_month_due(numeric, text, numeric, integer);',
      'CREATE FUNCTION public.card_month_due( p_price numeric, p_rate_unit text, p_hours numeric, p_standard_hours integer, p_days numeric )',
    ],
  ]) {
    const at = sql.indexOf(drop)
    assert.ok(at >= 0, drop)
    assert.ok(sql.indexOf(create) > at, create)
  }
  // The views that call card_month_due go first and come back.
  const dropViews = sql.indexOf('DROP VIEW public.sales_card_month_slots; DROP VIEW public.sales_card_months;')
  assert.ok(dropViews >= 0)
  assert.ok(dropViews < sql.indexOf('DROP FUNCTION public.card_month_due('))
  assert.ok(sql.indexOf('CREATE VIEW public.sales_card_months') > dropViews)
  assert.ok(sql.indexOf('CREATE VIEW public.sales_card_month_slots') > dropViews)
})

test('the card client price: unit unchanged on NULL, event on price or unit change', () => {
  const body = fn('CREATE FUNCTION public.set_equipment_card_client_price(')
  assert.match(body, /RAISE EXCEPTION 'card_pricing_approved_locked'/)
  assert.match(body, /v_unit := COALESCE\(NULLIF\(btrim\(p_rate_unit\), ''\), v_card\.client_price_unit\);/)
  assert.match(body, /IF v_price IS NOT DISTINCT FROM v_card\.client_price AND v_unit = v_card\.client_price_unit THEN RETURN;/)
  assert.match(body, /'old_unit', v_card\.client_price_unit, 'new_unit', v_unit/)
  const batch = fn('CREATE OR REPLACE FUNCTION public.set_equipment_card_client_prices(')
  assert.match(batch, /COALESCE\(jsonb_typeof\(v_item -> 'rate_unit'\), 'null'\) NOT IN \('string', 'null'\)/)
  assert.match(batch, /v_item ->> 'rate_unit' \);/)
  const approve = fn('CREATE OR REPLACE FUNCTION public.approve_equipment_card_pricing(')
  assert.match(approve, /'client_price_unit', v_card\.client_price_unit,/)
})

test('the days: column, validation, events and the batch', () => {
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS days numeric(5, 2) CONSTRAINT equipment_card_months_days_check CHECK (days IS NULL OR (days >= 0 AND days <= 31))'))
  const body = fn('CREATE FUNCTION public.record_equipment_card_month(')
  assert.match(body, /RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023'/)
  assert.match(body, /'month_recorded', jsonb_build_object\('month', v_month, 'hours', v_hours, 'days', v_days, 'note', v_note\)/)
  assert.match(body, /AND v_old_days IS NOT DISTINCT FROM v_days/)
  assert.match(body, /'days', v_days, 'old_days', v_old_days/)
  const batch = fn('CREATE OR REPLACE FUNCTION public.record_equipment_card_months(')
  assert.match(batch, /COALESCE\(jsonb_typeof\(v_item -> 'days'\), 'null'\) NOT IN \('number', 'null'\)/)
  assert.match(batch, /\(v_item ->> 'days'\)::numeric \);/)
})

test('card_month_due: one immutable definition per unit', () => {
  const body = fn('CREATE FUNCTION public.card_month_due(')
  assert.match(body, /RETURNS numeric LANGUAGE sql IMMUTABLE/)
  assert.match(body, /WHEN p_price IS NULL THEN NULL/)
  assert.match(body, /WHEN p_rate_unit = 'hour' THEN round\(p_price \* p_hours, 2\)/)
  assert.match(body, /WHEN p_rate_unit = 'month' AND p_standard_hours > 0 THEN round\(p_price \* p_hours \/ p_standard_hours, 2\)/)
  assert.match(body, /WHEN p_rate_unit = 'day' THEN round\(p_price \* p_days, 2\)/)
  assert.match(body, /WHEN p_rate_unit = 'week' THEN round\(p_price \* p_days \/ 7, 2\)/)
  // Both month views pass the days for the client and the supplier due.
  for (const view of ['sales_card_months', 'sales_card_month_slots']) {
    const def = stmt(`CREATE VIEW public.${view}`)
    assert.equal((def.match(/COALESCE\(sc\.client_standard_hours, sc\.standard_hours\), m\.days \)/g) || []).length, 2, view)
    assert.match(def, /END AS margin, m\.days, COALESCE\(pd\.presence_days, 0\) AS presence_days FROM/, view)
    assert.match(def, /FROM public\.movement_visits v/, view)
    assert.match(def, /v\.movement_context = 'site'/, view)
    assert.match(def, /count\(DISTINCT pdays\.day\)/, view)
  }
})

test('sales_equipment_cards: 0184 columns kept, the trailing unit, the margin per unit', () => {
  const def = stmt('CREATE OR REPLACE VIEW public.sales_equipment_cards')
  assert.match(def, /AS last_modified_at, c\.client_price_unit AS card_client_price_unit FROM/)
  assert.match(def, /AND sp\.supplier_rate_unit = c\.client_price_unit THEN round\(c\.client_price - sp\.supplier_price, 2\)/)
  assert.doesNotMatch(def, /supplier_rate_unit = 'month'/)
  // Every 0184 column, in order, before the new one.
  const old = norm(
    fs.readFileSync(
      path.join(root, 'supabase', 'migrations', '20261107140000_0184_card_prices_last_modified.sql'),
      'utf8',
    ).replace(/\r\n/g, '\n'),
  )
  const cols = (text) => {
    const start = text.indexOf('CREATE OR REPLACE VIEW public.sales_equipment_cards')
    const list = text.slice(text.indexOf('SELECT', start) + 6, text.indexOf(' FROM public.equipment_cards c', start))
    return list.split(/,(?![^()]*\))/).map((c) => c.trim().split(/\s+AS\s+/i).pop().replace(/^[a-z]+\./, ''))
  }
  const before = cols(old)
  const after = cols(sql)
  assert.deepEqual(after.slice(0, before.length), before)
  assert.deepEqual(after.slice(before.length), ['card_client_price_unit'])
})

test('the manual end and the reopening', () => {
  const end = fn('CREATE OR REPLACE FUNCTION public.end_equipment_card(')
  assert.match(end, /PERFORM public\.assert_sales_manage\(\);/)
  assert.match(end, /FOR UPDATE;/)
  for (const token of ['invalid_card', 'card_already_ended', 'invalid_period_to', 'card_has_later_months', 'invalid_note'])
    assert.match(end, new RegExp(`RAISE EXCEPTION '${token}'`), token)
  assert.match(end, /'card_ended', jsonb_build_object\('period_to', p_period_to, 'note', v_note\)/)
  const reopen = fn('CREATE OR REPLACE FUNCTION public.reopen_equipment_card(')
  assert.match(reopen, /RAISE EXCEPTION 'card_not_ended'/)
  assert.match(reopen, /WHEN exclusion_violation THEN RAISE EXCEPTION 'card_overlap' USING ERRCODE = '23P01'/)
  assert.match(reopen, /'card_reopened', jsonb_build_object\('old_period_to', v_card\.period_to, 'note', v_note\)/)
  assert.ok(
    sql.includes(
      "event_type IN ( 'month_recorded', 'month_updated', 'month_deleted', 'client_price_changed', 'pricing_approved', 'pricing_returned', 'card_ended', 'card_reopened' )",
    ),
  )
})

test('sales_cards_awaiting_end: open cards whose latest movement is a work-completed site exit', () => {
  const def = stmt('CREATE OR REPLACE VIEW public.sales_cards_awaiting_end')
  assert.match(def, /ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1/)
  assert.match(def, /mv\.exit_id = lm\.id AND mv\.company_id = sc\.company_id AND mv\.project_id = sc\.project_id/)
  assert.match(def, /WHERE sc\.is_open AND lm\.movement_type = 'exit' AND lm\.movement_context = 'site' AND lm\.exit_purpose = 'work_completed'/)
  assert.match(def, /pn\.full_name AS exit_supervisor_name/)
})

test('every view is security_invoker, every function revokes anon and grants authenticated', () => {
  for (const view of ['sales_equipment_cards', 'sales_card_months', 'sales_card_month_slots', 'sales_cards_awaiting_end']) {
    assert.match(sql, new RegExp(`VIEW public\\.${view} WITH \\(security_invoker = true\\)`), view)
    assert.ok(sql.includes(`REVOKE ALL ON public.${view} FROM PUBLIC, anon; GRANT SELECT ON public.${view} TO authenticated;`), view)
  }
  const heads = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)\(/g)].map((m) => m[1])
  assert.equal(heads.length, 12)
  for (const name of heads) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s*FROM PUBLIC, anon;`), name)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*TO authenticated;`), name)
    assert.match(sql, new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(`), name)
    const head = sql.includes(`CREATE FUNCTION public.${name}(`)
      ? `CREATE FUNCTION public.${name}(`
      : `CREATE OR REPLACE FUNCTION public.${name}(`
    const body = fn(head)
    assert.match(body, /SET search_path = public, pg_temp/, name)
  }
})

test('the header lists every token the migration raises, and no hamza on alif', () => {
  const raised = new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]))
  for (const token of [
    'invalid_rate_unit',
    'invalid_days',
    'invalid_items',
    'invalid_card',
    'invalid_price',
    'invalid_note',
    'invalid_period_to',
    'card_already_ended',
    'card_not_ended',
    'card_has_later_months',
    'card_overlap',
    'card_pricing_approved_locked',
  ]) {
    assert.ok(raised.has(token), `raised: ${token}`)
    assert.ok(header.includes(token), `header: ${token}`)
  }
  assert.doesNotMatch(raw, /[أإآ]/u)
  // Nothing else is touched: no movement write, photo, policy or storage.
  assert.doesNotMatch(sql, /entry_exit_logs SET|entry_exit_photos|CREATE POLICY|DROP POLICY|storage\./)
})
