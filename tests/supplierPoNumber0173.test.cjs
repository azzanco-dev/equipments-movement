// Migration 0173 (owner 2026-11-04, «خليه السنة كاملة والشهر ثم اربع خانات
// تسلسلية, وخليها تكون كذا PO- ثم الرقم, وعدل على كل الموجود»; «التسلسل
// الرباعي يستمر للابد»): supplier PO numbers become PO- + the Saudi YYYYMM +
// a sequence of at least four digits that never restarts; every existing PO
// is renumbered in the same transaction with a `renumbered` audit event.
//
// Source checks only: the file order, the one-row counter and its lockdown,
// the function (name and signature kept, SECURITY DEFINER, search_path, the
// REVOKEs, the new number shape), the renumbering CTE ordered by
// (created_at, id), the event, the CHECK swap order and the client's event
// label and detail.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261104100000_0173_supplier_po_number_format.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const raw = read('supabase', 'migrations', MIGRATION)
/** SQL without `--` comments, whitespace collapsed. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(raw)

const NEW_FORMAT = "'^PO-[0-9]{10,}$'"

test('0173 is the only 0173, after 0172, and nothing before it knows the new table', () => {
  assert.equal(migrations.filter((f) => /_0173_/.test(f)).length, 1)
  const index = migrations.indexOf(MIGRATION)
  assert.ok(index > 0)
  assert.match(migrations[index - 1], /_0172_/)
  const earlier = migrations
    .slice(0, index)
    .map((f) => read('supabase', 'migrations', f))
    .join('\n')
  assert.doesNotMatch(earlier, /supplier_po_sequence/)
})

test('one global counter row, locked down, replacing the yearly counters', () => {
  assert.match(
    sql,
    /CREATE TABLE public\.supplier_po_sequence \( singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT supplier_po_sequence_singleton CHECK \(singleton\), last_seq integer NOT NULL DEFAULT 0 CONSTRAINT supplier_po_sequence_last_seq_check CHECK \(last_seq >= 0\) \);/,
  )
  assert.match(sql, /ALTER TABLE public\.supplier_po_sequence ENABLE ROW LEVEL SECURITY;/)
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.supplier_po_sequence FROM PUBLIC, anon, authenticated;/,
  )
  // No policy: nobody reads or writes it from the client.
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*supplier_po_sequence/)
  assert.match(
    sql,
    /INSERT INTO public\.supplier_po_sequence \(singleton, last_seq\) VALUES \(true, 0\);/,
  )
  assert.match(sql, /DROP TABLE public\.supplier_po_counters;/)
  assert.doesNotMatch(sql, /GRANT[^;]*supplier_po_sequence/)
})

test('next_supplier_po_number keeps its signature and returns PO-YYYYMM + the endless sequence', () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.next_supplier_po_number()')
  assert.ok(start >= 0)
  const fn = sql.slice(start, sql.indexOf('$$;', start) + 3)
  assert.match(
    fn,
    /^CREATE OR REPLACE FUNCTION public\.next_supplier_po_number\(\) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$/,
  )
  // The single row, incremented in place (the row lock serialises callers).
  assert.match(
    fn,
    /UPDATE public\.supplier_po_sequence SET last_seq = last_seq \+ 1 WHERE singleton RETURNING last_seq INTO v_seq;/,
  )
  assert.match(fn, /IF v_seq IS NULL THEN RAISE EXCEPTION 'supplier_po_sequence_missing'/)
  assert.match(
    fn,
    /RETURN 'PO-' \|\| to_char\(now\(\) AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\) \|\| lpad\(v_seq::text, 4, '0'\);/,
  )
  // Nothing per year or per month: no counters table, no year key.
  assert.doesNotMatch(fn, /supplier_po_counters|ON CONFLICT|'YY'|v_year/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.next_supplier_po_number\(\) FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(sql, /COMMENT ON FUNCTION public\.next_supplier_po_number\(\) IS '0173:/)
  // create_supplier_po is not re-created: it calls the function by name.
  assert.doesNotMatch(sql, /FUNCTION public\.create_supplier_po/)
})

test('the renumbering: (created_at, id) order, one UPDATE, one event per PO, the counter at N', () => {
  assert.match(
    sql,
    /'PO-' \|\| to_char\(p\.created_at AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\) \|\| lpad\(\(row_number\(\) OVER \(ORDER BY p\.created_at, p\.id\)\)::text, 4, '0'\) AS new_number FROM public\.supplier_pos p/,
  )
  assert.match(
    sql,
    /UPDATE public\.supplier_pos p SET po_number = n\.new_number FROM numbered n WHERE n\.id = p\.id AND p\.po_number IS DISTINCT FROM n\.new_number RETURNING p\.id, n\.old_number, n\.new_number/,
  )
  assert.match(
    sql,
    /INSERT INTO public\.supplier_po_events \(supplier_po_id, event_type, payload, actor_id\) SELECT r\.id, 'renumbered', jsonb_build_object\('old_number', r\.old_number, 'new_number', r\.new_number\), NULL FROM renumbered r;/,
  )
  // «اخر تعديل» is kept: the updated_at trigger is off around the UPDATE only.
  const disable = sql.indexOf('ALTER TABLE public.supplier_pos DISABLE TRIGGER supplier_pos_updated_at;')
  const update = sql.indexOf('UPDATE public.supplier_pos p SET po_number')
  const enable = sql.indexOf('ALTER TABLE public.supplier_pos ENABLE TRIGGER supplier_pos_updated_at;')
  assert.ok(disable >= 0 && update > disable && enable > update)
  assert.match(
    sql,
    /UPDATE public\.supplier_po_sequence SET last_seq = \(SELECT count\(\*\) FROM public\.supplier_pos\) WHERE singleton;/,
  )
  // Nothing else moves: no line, card, policy or view statement.
  assert.doesNotMatch(
    sql,
    /supplier_po_equipment\b|equipment_cards|CREATE POLICY|CREATE OR REPLACE VIEW|purchasing_site_units|purchasing_po_units/,
  )
})

test('the CHECK swap: old format dropped before, new format added after the renumbering, guarded', () => {
  const drop = sql.indexOf('ALTER TABLE public.supplier_pos DROP CONSTRAINT supplier_pos_number_format;')
  const update = sql.indexOf('UPDATE public.supplier_pos p SET po_number')
  const guard = sql.indexOf(`WHERE po_number !~ ${NEW_FORMAT}`)
  const add = sql.indexOf(
    `ALTER TABLE public.supplier_pos ADD CONSTRAINT supplier_pos_number_format CHECK (po_number ~ ${NEW_FORMAT});`,
  )
  assert.ok(drop >= 0, 'drop')
  assert.ok(update > drop, 'update after drop')
  assert.ok(guard > update, 'guard after update')
  assert.ok(add > guard, 'add after guard')
  assert.match(sql, /IF v_bad > 0 THEN RAISE EXCEPTION/)
  assert.match(sql, /IF v_seq IS DISTINCT FROM v_count THEN RAISE EXCEPTION/)
  assert.doesNotMatch(sql, /'\^SPO/)
})

test('the event type list is the 0160 list plus renumbered', () => {
  assert.match(sql, /ALTER TABLE public\.supplier_po_events DROP CONSTRAINT supplier_po_events_type_check;/)
  assert.match(
    sql,
    /event_type IN \( 'created', 'updated', 'equipment_added', 'price_changed', 'line_updated', 'card_changed', 'equipment_removed', 'approved', 'closed', 'reopened', 'renumbered' \)/,
  )
  // The event CHECK is widened before the renumbering writes its events.
  assert.ok(
    sql.indexOf("'renumbered' )") < sql.indexOf("SELECT r.id, 'renumbered'"),
  )
})

test('new Arabic copy carries no hamza alif', () => {
  const arabic = raw.match(/[؀-ۿ][^\n]*/g) ?? []
  for (const line of arabic) assert.doesNotMatch(line, /[أإآ]/, line)
  const lib = read('src', 'lib', 'purchasing.ts')
  const label = /SUPPLIER_PO_RENUMBERED_LABEL[\s\S]*?\}/.exec(lib)[0]
  assert.doesNotMatch(label, /[أإآ]/)
})

// --- The client -----------------------------------------------------------------

function loadLib(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      require: (spec) => {
        const match = /^@\/lib\/(.+)$/.exec(spec)
        if (match) return loadLib(match[1], cache)
        if (spec === 'zod') return require('zod')
        if (spec === '@/i18n/translations') return {}
        if (spec === '@/components/data-list/types') return {}
        if (spec.startsWith('@/')) return {}
        return require(spec)
      },
      console,
    },
  )
  return exports
}

test('the client labels the renumbered event and shows old → new', () => {
  const purchasing = loadLib('purchasing')
  assert.equal(purchasing.SUPPLIER_PO_EVENT_LABEL_KEYS.renumbered, 'supplierPoEventUpdated')
  const t = (key) => `<${key}>`
  assert.equal(purchasing.supplierPoEventLabel('closed', t, 'ar'), '<supplierPoEventClosed>')
  assert.equal(purchasing.supplierPoEventLabel('renumbered', t, 'ar'), 'اعادة ترقيم الامر')
  assert.equal(purchasing.supplierPoEventLabel('renumbered', t, 'en'), 'Order renumbered')
  const timeline = read('src', 'components', 'purchasing', 'SupplierPoEventsTimeline.tsx')
  assert.match(timeline, /supplierPoEventLabel\(event\.event_type, t, lang\)/)
  assert.doesNotMatch(timeline, /SUPPLIER_PO_EVENT_LABEL_KEYS/)

  const data = read('src', 'lib', 'purchasingData.ts')
  const detailSrc = data.slice(
    data.indexOf('export function supplierPoEventDetail('),
    data.indexOf('\n}\n', data.indexOf('export function supplierPoEventDetail(')) + 3,
  )
  assert.match(detailSrc, /case 'renumbered':/)
  const detail = new Function(
    'isSupplierPoRateUnit',
    `${detailSrc
      .replace('export ', '')
      .replace(/: Pick<[^,]+,\s*'event_type' \| 'payload'>/, '')
      .replace(/: \(equipmentId: string\) => string \| null/, '')
      .replace(/: \(value: unknown\) => string/, '')
      .replace(/: \(value: string\) => string = /, ' = ')
      .replace(/: \(unit: SupplierPoRateUnit\) => string = /, ' = ')
      .replace(/\): string \| null \{/, ') {')
      .replace(/ as string \| null/g, '')
      .replace(/ as SupplierPoRateUnit/g, '')}; return supplierPoEventDetail`,
  )(() => false)
  assert.equal(
    detail(
      {
        event_type: 'renumbered',
        payload: { old_number: 'SPO260046', new_number: 'PO-2026100046' },
      },
      () => null,
      String,
    ),
    'SPO260046 → PO-2026100046',
  )
  assert.equal(detail({ event_type: 'renumbered', payload: {} }, () => null, String), null)
})

test('no screen assumes the SPO shape; the number is data everywhere', () => {
  const files = [
    ['src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'],
    ['src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx'],
    ['src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx'],
    ['src', 'screens', 'purchasing', 'PoUnitsList.tsx'],
    ['src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx'],
    ['src', 'components', 'purchasing', 'CloseSupplierPoDialog.tsx'],
    ['src', 'components', 'purchasing', 'EquipmentPurchasingCard.tsx'],
    ['src', 'lib', 'purchasing.ts'],
    ['src', 'lib', 'purchasingData.ts'],
  ]
  for (const file of files) {
    const code = read(...file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(code, /'SPO|"SPO|`SPO|\^SPO|startsWith\('PO|slice\(3\)/, file.join('/'))
  }
  // The PDF's file name is the number itself.
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(sheet, /document\.title = \[\s+poNumber,/)
  // The admin review page tells the new rule.
  const model = read('src', 'screens', 'sales', 'purchasingModel.ts')
  assert.match(model, /PO-2026110001/)
  assert.match(model, /number: 'PO-2026100007'/)
})
