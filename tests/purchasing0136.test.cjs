// Migration 0136 (purchasing, first piece; owner decisions 2026-10-15 to
// 2026-10-18): supplier purchase orders, the rental price per equipment, and
// the shared «كرت المعدة» (equipment_cards) created behind the scenes.
//
// Source checks only, like the rest of the suite: the five purchasing tables
// have RLS with a SELECT policy on purchasing.view and no write policy, every
// function is SECURITY DEFINER with the fixed search_path and the right
// REVOKE / GRANT, the error tokens the client will map are present, the two
// 0126 keys are reused (no new catalogue key) and the frozen legacy mapping
// is untouched. New Arabic copy carries no hamza alif.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261018130000_0136_purchasing_supplier_pos.sql'
const PREVIOUS = '20261018120000_0135_workshop_purpose_and_code_rules.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const stripped = sql.replace(/--[^\n]*/g, '')

/** SQL without `--` comments, whitespace collapsed. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TABLES = [
  'equipment_cards',
  'supplier_pos',
  'supplier_po_equipment',
  'supplier_po_events',
  'supplier_po_counters',
]

const FUNCTIONS = {
  // name -> [argument list as written in the REVOKE, executable by clients]
  is_internal_equipment: ['uuid', true],
  legacy_role_permissions: ['text', true],
  next_supplier_po_number: ['', false],
  enforce_supplier_po_equipment_single_open: ['', false],
  assert_purchasing_manage: ['', false],
  create_supplier_po: ['uuid, uuid, uuid, date, text', true],
  add_supplier_po_equipment: ['uuid, uuid, numeric, text', true],
  update_supplier_po_equipment_price: ['uuid, numeric', true],
  close_supplier_po: ['uuid', true],
}

const TOKENS = [
  'purchasing_manage_required',
  'invalid_po',
  'invalid_equipment',
  'invalid_lessor',
  'invalid_company',
  'invalid_project',
  'invalid_start_date',
  'invalid_price',
  'invalid_line',
  'po_closed',
  'internal_price_must_be_zero',
  'card_overlap',
  'equipment_already_on_open_po',
]

const HAMZA_ALIF = /[أإآ]/

/** The CREATE [OR REPLACE] FUNCTION statement of `name`, header to `$$;`. */
function fn(name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${escape(name)}\\(`,
  ).exec(sql)
  assert.ok(match, `missing function ${name}`)
  const end = sql.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return sql.slice(match.index, end + 4)
}

test('0136 is the single 0136 migration, right after 0135', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0136 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0136_/.test(file)).length, 1)
  assert.equal(migrations[migrations.length - 1], MIGRATION, 'latest migration')
})

test('the five purchasing tables exist with RLS, a purchasing.view SELECT policy and no write policy', () => {
  for (const table of TABLES) {
    assert.match(stripped, new RegExp(`CREATE TABLE public\\.${table} \\(`), table)
    assert.match(
      stripped,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`),
      `${table}: RLS`,
    )
    const policies = [
      ...stripped.matchAll(
        new RegExp(`CREATE POLICY (\\w+) ON public\\.${table}\\s+FOR (\\w+)`, 'g'),
      ),
    ]
    if (table === 'supplier_po_counters') {
      assert.equal(policies.length, 0, 'the counter has no client access at all')
      continue
    }
    assert.equal(policies.length, 1, `${table}: exactly one policy`)
    assert.equal(policies[0][2], 'SELECT')
    const policy = stripped.slice(policies[0].index, stripped.indexOf(';', policies[0].index))
    assert.match(policy, /TO authenticated/)
    assert.match(
      norm(policy),
      /USING \(\(SELECT public\.has_permission\('purchasing\.view'\)\)\)/,
    )
  }
})

test('lessor_contacts is DB-only for admin or lessors.edit, and lessors gains is_internal', () => {
  assert.match(
    stripped,
    /ALTER TABLE public\.lessors\s+ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;/,
  )
  assert.match(stripped, /CREATE TABLE public\.lessor_contacts \(/)
  assert.match(stripped, /ALTER TABLE public\.lessor_contacts ENABLE ROW LEVEL SECURITY;/)
  const policies = [
    ...stripped.matchAll(/CREATE POLICY (\w+) ON public\.lessor_contacts\s+FOR (\w+)/g),
  ].map((m) => m[2])
  assert.deepEqual(policies.sort(), ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  const count = stripped.split("has_permission('lessors.edit')").length - 1
  // SELECT, INSERT, DELETE: one clause each; UPDATE: USING and WITH CHECK.
  assert.equal(count, 5, 'every lessor_contacts policy clause tests lessors.edit')
})

test('equipment_cards is the shared card: defaults, open end, no overlap per unit', () => {
  const table = stripped.slice(
    stripped.indexOf('CREATE TABLE public.equipment_cards ('),
    stripped.indexOf(');', stripped.indexOf('CREATE TABLE public.equipment_cards (')),
  )
  assert.match(table, /equipment_id uuid NOT NULL REFERENCES public\.equipment\(id\) ON DELETE RESTRICT/)
  assert.match(table, /company_id uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE RESTRICT/)
  assert.match(table, /project_id uuid NOT NULL REFERENCES public\.projects\(id\) ON DELETE RESTRICT/)
  assert.match(table, /period_from date NOT NULL,\s+period_to date,/)
  assert.match(table, /rate_unit text NOT NULL DEFAULT 'month'/)
  assert.match(table, /CHECK \(rate_unit IN \('month', 'day', 'hour'\)\)/)
  assert.match(table, /standard_hours integer NOT NULL DEFAULT 260/)
  assert.match(table, /CHECK \(period_to IS NULL OR period_to >= period_from\)/)
  assert.match(
    norm(table),
    /CONSTRAINT equipment_cards_no_overlap EXCLUDE USING gist \( equipment_id WITH =, daterange\(period_from, period_to, '\[\]'\) WITH && \)/,
  )
  assert.match(stripped, /CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;/)
})

test('supplier_pos: SPO number, lessor only NULL when internal, open/closed with closed_at', () => {
  const table = stripped.slice(
    stripped.indexOf('CREATE TABLE public.supplier_pos ('),
    stripped.indexOf(');', stripped.indexOf('CREATE TABLE public.supplier_pos (')),
  )
  assert.match(table, /po_number text NOT NULL UNIQUE/)
  assert.match(table, /CHECK \(po_number ~ '\^SPO\[0-9\]\{6,\}\$'\)/)
  assert.match(table, /lessor_id uuid REFERENCES public\.lessors\(id\) ON DELETE RESTRICT,/)
  assert.match(table, /CHECK \(lessor_id IS NOT NULL OR is_internal\)/)
  assert.match(table, /CHECK \(status IN \('open', 'closed'\)\)/)
  assert.match(table, /CHECK \(\(status = 'closed'\) = \(closed_at IS NOT NULL\)\)/)

  const numbering = norm(fn('next_supplier_po_number'))
  assert.match(numbering, /AT TIME ZONE 'Asia\/Riyadh', 'YY'/)
  assert.match(numbering, /ON CONFLICT \(year\) DO UPDATE SET last_seq = public\.supplier_po_counters\.last_seq \+ 1/)
  assert.match(numbering, /RETURN 'SPO' \|\| lpad\(v_year::text, 2, '0'\) \|\| lpad\(v_seq::text, 4, '0'\);/)
})

test('supplier_po_equipment: price excluding VAT >= 0, one card per PO, one open PO per card', () => {
  const table = stripped.slice(
    stripped.indexOf('CREATE TABLE public.supplier_po_equipment ('),
    stripped.indexOf(');', stripped.indexOf('CREATE TABLE public.supplier_po_equipment (')),
  )
  assert.match(table, /supplier_po_id uuid NOT NULL REFERENCES public\.supplier_pos\(id\) ON DELETE CASCADE/)
  assert.match(table, /equipment_card_id uuid NOT NULL REFERENCES public\.equipment_cards\(id\) ON DELETE RESTRICT/)
  assert.match(table, /price numeric\(12, 2\) NOT NULL/)
  assert.match(table, /CHECK \(price >= 0\)/)
  assert.match(table, /UNIQUE \(supplier_po_id, equipment_card_id\)/)
  assert.match(
    norm(stripped),
    /CREATE TRIGGER supplier_po_equipment_single_open BEFORE INSERT OR UPDATE OF equipment_card_id, supplier_po_id ON public\.supplier_po_equipment FOR EACH ROW EXECUTE FUNCTION public\.enforce_supplier_po_equipment_single_open\(\);/,
  )
  assert.match(fn('enforce_supplier_po_equipment_single_open'), /'equipment_already_on_open_po'/)
})

test('supplier_po_events is append-only with the five event types', () => {
  const table = stripped.slice(
    stripped.indexOf('CREATE TABLE public.supplier_po_events ('),
    stripped.indexOf(');', stripped.indexOf('CREATE TABLE public.supplier_po_events (')),
  )
  assert.match(
    norm(table),
    /event_type IN \('created', 'equipment_added', 'price_changed', 'card_changed', 'closed'\)/,
  )
  assert.match(table, /payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/)
  // Every write function records an event.
  for (const [name, type] of [
    ['create_supplier_po', 'created'],
    ['add_supplier_po_equipment', 'equipment_added'],
    ['update_supplier_po_equipment_price', 'price_changed'],
    ['close_supplier_po', 'closed'],
  ]) {
    assert.match(fn(name), new RegExp(`INSERT INTO public\\.supplier_po_events[\\s\\S]*'${type}'`), name)
  }
})

test('every function is SECURITY DEFINER with the fixed search_path and the right grants', () => {
  const created = [...stripped.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created.sort(), Object.keys(FUNCTIONS).sort())
  for (const [name, [args, executable]] of Object.entries(FUNCTIONS)) {
    const body = norm(fn(name))
    if (name === 'legacy_role_permissions') {
      // The frozen mapping stays SECURITY INVOKER (0126); checked below.
      assert.match(body, /IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp/)
    } else {
      assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/, name)
    }
    assert.doesNotMatch(body, /is_admin\(\)|current_user_role\(\)|\.role\s*=/, `${name}: no role test`)
    const signature = `public\\.${name}\\(${escape(args)}\\)`
    if (executable) {
      assert.match(
        norm(stripped),
        new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`),
        `${name}: revoke`,
      )
      assert.match(
        norm(stripped),
        new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`),
        `${name}: grant`,
      )
    } else {
      assert.match(
        norm(stripped),
        new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`),
        `${name}: internal only`,
      )
      assert.doesNotMatch(norm(stripped), new RegExp(`GRANT EXECUTE ON FUNCTION ${signature}`), name)
    }
  }
})

test('the four write functions gate on purchasing.manage first and serialise where needed', () => {
  const gate = norm(fn('assert_purchasing_manage'))
  assert.match(
    gate,
    /IF auth\.uid\(\) IS NULL OR NOT public\.has_permission\('purchasing\.manage'\) THEN RAISE EXCEPTION 'purchasing_manage_required' USING ERRCODE = '42501'/,
  )
  for (const name of [
    'create_supplier_po',
    'add_supplier_po_equipment',
    'update_supplier_po_equipment_price',
    'close_supplier_po',
  ]) {
    const body = norm(fn(name))
    const begin = body.indexOf('BEGIN PERFORM public.assert_purchasing_manage();')
    assert.ok(begin > 0, `${name}: the permission check is the first statement`)
  }
  const add = norm(fn('add_supplier_po_equipment'))
  assert.match(add, /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_equipment_id::text, 0\)\);/)
  assert.match(add, /FROM public\.supplier_pos p WHERE p\.id = p_po_id FOR UPDATE;/)
  assert.match(add, /IF v_po\.status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'/)
  assert.match(add, /IF public\.is_internal_equipment\(p_equipment_id\) AND p_price <> 0 THEN RAISE EXCEPTION 'internal_price_must_be_zero'/)
  // The card is reused when it covers the PO start date, else created from it.
  assert.match(add, /AND c\.period_from <= v_po\.start_date AND \(c\.period_to IS NULL OR c\.period_to >= v_po\.start_date\)/)
  assert.match(add, /INSERT INTO public\.equipment_cards \( equipment_id, company_id, project_id, period_from, created_by \) VALUES \( p_equipment_id, v_po\.company_id, v_po\.project_id, v_po\.start_date, auth\.uid\(\) \)/)
  assert.match(add, /WHEN exclusion_violation THEN[\s\S]*RAISE EXCEPTION 'card_overlap' USING ERRCODE = '23P01'/)

  const internal = norm(fn('is_internal_equipment'))
  assert.match(internal, /e\.ownership_status = 'alazani' OR l\.is_internal/)
})

test('every error token the client will map is present', () => {
  for (const token of TOKENS) {
    assert.ok(stripped.includes(`'${token}'`), token)
  }
})

test('the two 0126 keys are reused; the legacy mapping is the 0130 body plus exactly the two admin rows', () => {
  assert.doesNotMatch(stripped, /INSERT INTO public\.permissions/)
  // The flag is neither read nor written (the mapping's COMMENT may name it).
  assert.doesNotMatch(
    stripped,
    /set_roles_system_enabled\(|roles_system_enabled\(|(UPDATE|INSERT INTO|DELETE FROM) public\.app_settings/,
  )
  assert.doesNotMatch(stripped, /is_admin\(\)/, 'no policy or function tests a role name (0127 rule)')

  const sql0130 = read('supabase', 'migrations', '20261015100000_0130_retire_map_permission.sql')
  const start0130 = sql0130.indexOf('CREATE OR REPLACE FUNCTION public.legacy_role_permissions(')
  const before = norm(sql0130.slice(start0130, sql0130.indexOf('\n$$;', start0130) + 4))
  const after = norm(fn('legacy_role_permissions'))
  const anchor = "('admin', 'settings.roles', NULL),"
  assert.equal(before.split(anchor).length, 2)
  assert.equal(
    after,
    before.replace(
      anchor,
      `${anchor} ('admin', 'purchasing.view', NULL), ('admin', 'purchasing.manage', NULL),`,
    ),
  )
  assert.equal(after.split('purchasing').length, 3, 'exactly two purchasing rows, both admin')
  for (const key of ['purchasing.view', 'purchasing.manage']) {
    assert.match(
      norm(stripped),
      new RegExp(`UPDATE public\\.permissions SET enforced_in = 'database',[^;]*WHERE key = '${escape(key)}';`),
      key,
    )
  }
  assert.match(
    norm(stripped),
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\) VALUES \('admin', 'purchasing\.view', NULL\), \('admin', 'purchasing\.manage', NULL\) ON CONFLICT \(role_key, permission_key\) DO NOTHING;/,
  )
  // No other table or policy of the schema is altered.
  const altered = [...stripped.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(altered)].sort(),
    ['equipment_cards', 'lessor_contacts', 'lessors', 'supplier_po_counters', 'supplier_po_equipment', 'supplier_po_events', 'supplier_pos'],
  )
  assert.doesNotMatch(stripped, /DROP POLICY|DROP TABLE|DROP FUNCTION/)
})

test('new Arabic copy carries no hamza alif', () => {
  assert.doesNotMatch(sql, HAMZA_ALIF)
})
