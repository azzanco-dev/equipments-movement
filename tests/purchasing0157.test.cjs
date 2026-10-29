// Migration 0157 (owner 2026-10-28, «تختلف احيانا», «شهري او يومي»,
// «انطلق في المهمة»): the price of a unit on a supplier PO is per month or
// per day, on the LINE (the supplier's unit can differ from the client's).
// No standard hours and no quantity on the supplier side.
//
// Source checks plus the pure totals helper.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261028120000_0157_supplier_po_rate_unit.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(read('supabase', 'migrations', MIGRATION))

/** One function of a migration, from its CREATE to the closing `$$;`. */
const fn = (source, head) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, head)
  return source.slice(start, source.indexOf('$$;', source.indexOf('$$', start) + 2) + 3)
}

/** Loads src/lib/purchasing.ts (its only runtime import is pure). */
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
      Intl,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

test('0157 is the single 0157 migration, after 0156', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0157 present')
  assert.match(migrations[at - 1], /_0156_/)
  assert.equal(migrations.filter((file) => /_0157_/.test(file)).length, 1)
})

test('the column: month or day, month by default', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.supplier_po_equipment ADD COLUMN IF NOT EXISTS rate_unit text NOT NULL DEFAULT 'month' CONSTRAINT supplier_po_equipment_rate_unit_check CHECK \(rate_unit IN \('month', 'day'\)\);/,
  )
  // No hours, no quantity on the supplier side.
  assert.doesNotMatch(sql, /standard_hours|quantity/)
})

test('add_supplier_po_equipment: the 0148 body plus the unit', () => {
  const before = norm(read('supabase', 'migrations', '20261025100000_0148_supplier_po_same_entry_day.sql'))
  const head = 'CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment('
  const body = fn(sql, head)
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.add_supplier_po_equipment\(uuid, uuid, numeric, text\);/)
  const additions = [
    ["p_note text DEFAULT NULL )", "p_note text DEFAULT NULL, p_rate_unit text DEFAULT 'month' )"],
    ['v_entry_date date; BEGIN', 'v_entry_date date; v_rate_unit text; BEGIN'],
    [
      "RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'; END IF; IF NOT (",
      "RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'; END IF; v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month'); IF v_rate_unit NOT IN ('month', 'day') THEN RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023'; END IF; IF NOT (",
    ],
    ['price, note ) VALUES', 'price, note, rate_unit ) VALUES'],
    ["NULLIF(btrim(p_note), '') )", "NULLIF(btrim(p_note), ''), v_rate_unit )"],
    ["'price', p_price, 'entry_log_id'", "'price', p_price, 'rate_unit', v_rate_unit, 'entry_log_id'"],
  ]
  let expected = fn(before, head)
  for (const [from, to] of additions) {
    assert.ok(expected.includes(from), from)
    expected = expected.replace(from, to)
  }
  assert.equal(body, expected)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\) TO authenticated;/,
  )
})

test('create_supplier_po: the 0139 body, each item\'s unit passed on', () => {
  const before = norm(read('supabase', 'migrations', '20261020110000_0139_supplier_po_is_internal_default.sql'))
  const head = 'CREATE OR REPLACE FUNCTION public.create_supplier_po('
  const expected = fn(before, head).replace(
    "v_item->>'note' );",
    "v_item->>'note', NULLIF(v_item->>'rate_unit', '') );",
  )
  assert.equal(fn(sql, head), expected)
})

test('update_supplier_po_equipment: the 0142 body plus the unit', () => {
  const before = norm(read('supabase', 'migrations', '20261022100000_0142_supplier_po_update.sql'))
  const head = 'CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment('
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.update_supplier_po_equipment\(uuid, numeric, text\);/)
  const additions = [
    ['p_note text DEFAULT NULL )', 'p_note text DEFAULT NULL, p_rate_unit text DEFAULT NULL )'],
    ['v_price_changed boolean; BEGIN', 'v_price_changed boolean; v_rate_unit text; BEGIN'],
    [
      "RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023'; END IF;",
      "RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023'; END IF; v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit); IF v_rate_unit NOT IN ('month', 'day') THEN RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023'; END IF;",
    ],
    [
      'IF NOT v_price_changed AND v_note IS NOT DISTINCT FROM v_line.note THEN',
      'IF NOT v_price_changed AND v_note IS NOT DISTINCT FROM v_line.note AND v_rate_unit = v_line.rate_unit THEN',
    ],
    ['note = v_note WHERE', 'note = v_note, rate_unit = v_rate_unit WHERE'],
    [
      "'new_note', v_note )",
      "'new_note', v_note, 'old_rate_unit', v_line.rate_unit, 'new_rate_unit', v_rate_unit )",
    ],
  ]
  let expected = fn(before, head)
  for (const [from, to] of additions) {
    assert.ok(expected.includes(from), from)
    expected = expected.replace(from, to)
  }
  assert.equal(fn(sql, head), expected)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.update_supplier_po_equipment\(uuid, numeric, text, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.update_supplier_po_equipment\(uuid, numeric, text, text\) TO authenticated;/,
  )
})

test('totals per unit: a month and a day are never added', () => {
  const lib = loadLib('purchasing')
  assert.deepEqual(plain(lib.SUPPLIER_PO_RATE_UNITS), ['month', 'day'])
  assert.equal(lib.supplierPoRateUnitOf('day'), 'day')
  assert.equal(lib.supplierPoRateUnitOf(null), 'month')
  assert.equal(lib.supplierPoRateUnitOf('hour'), 'month')
  assert.deepEqual(plain(lib.supplierPoTotalsByUnit([])), {
    parts: [{ unit: 'month', total: 0 }],
    unpriced: 0,
  })
  assert.deepEqual(
    plain(
      lib.supplierPoTotalsByUnit([
        { price: 1000, rate_unit: 'month' },
        { price: '250.5', rate_unit: 'day' },
        { price: null, rate_unit: 'day' },
        { price: 500, rate_unit: null },
      ]),
    ),
    {
      parts: [
        { unit: 'month', total: 1500 },
        { unit: 'day', total: 250.5 },
      ],
      unpriced: 1,
    },
  )
  // Only daily lines: one daily total, no empty monthly one.
  assert.deepEqual(plain(lib.supplierPoTotalsByUnit([{ price: 300, rate_unit: 'day' }]).parts), [
    { unit: 'day', total: 300 },
  ])
  // The create payload carries the unit.
  assert.deepEqual(
    plain(
      lib.supplierPoEquipmentPayload([
        { equipment_id: 'e1', price: ' 400 ', note: '', rate_unit: 'day' },
      ]),
    ),
    [{ equipment_id: 'e1', price: 400, note: null, rate_unit: 'day' }],
  )
})

test('the screens send, edit and show the unit', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /SUPPLIER_PO_LINE_SELECT = `id,supplier_po_id,equipment_card_id,price,rate_unit,/)
  assert.match(data, /EQUIPMENT_PURCHASING_SELECT = `id,supplier_po_id,equipment_card_id,price,rate_unit,/)
  assert.equal((data.match(/p_rate_unit: input\.rateUnit,/g) ?? []).length, 2)

  const create = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(create, /const changeDefaultUnit = /)
  assert.match(create, /line\.rate_unit === previous \? \{ \.\.\.line, rate_unit: next \} : line/)
  assert.match(create, /rate_unit: picked\[visit\.equipment_id\]\.rate_unit,/)
  assert.match(create, /<PricesByUnit/)

  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /rateUnit: form\.rate_unit,/)
  assert.match(add, /name="rate_unit"/)
  const edit = read('src', 'components', 'purchasing', 'EditLineDialog.tsx')
  assert.match(edit, /rateUnit: form\.rate_unit,/)
  assert.match(edit, /rate_unit: supplierPoRateUnitOf\(lineRateUnit\),/)

  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(detail, /const \{ parts: totalsByUnit, unpriced \} = supplierPoTotalsByUnit\(lines\)/)
  assert.match(detail, /<PricesByUnit parts=\{totalsByUnit\} amount=\{vatOf\} \/>/)
  assert.match(detail, /<PricesByUnit parts=\{totalsByUnit\} amount=\{withVat\} \/>/)
  assert.match(detail, /totals=\{totalsByUnit\}/)
  assert.match(detail, /unit=\{supplierPoRateUnitOf\(line\.rate_unit\)\}/)
  // The PDF says the unit in its own column (owner 2026-10-29).
  assert.ok(
    read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx').includes(
      '{t(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[supplierPoRateUnitOf(line.rate_unit)])}',
    ),
  )
  // The PO list's opened row: the unit in its own column (owner 2026-10-28).
  const panel = read('src', 'components', 'purchasing', 'SupplierPoLinesPanel.tsx')
  assert.ok(panel.includes("{t('supplierPoRateUnit')}"))
  assert.ok(
    panel.includes('{t(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[supplierPoRateUnitOf(line.rate_unit)])}'),
  )
  assert.match(
    read('src', 'components', 'purchasing', 'EquipmentPurchasingCard.tsx'),
    /unit=\{supplierPoRateUnitOf\(row\.rate_unit\)\}/,
  )
})

test('the token and the labels, Arabic and English, plain alif', () => {
  const lib = read('src', 'lib', 'purchasing.ts')
  assert.match(lib, /^  'invalid_rate_unit', \/\/ 0157/m)
  assert.equal(
    (lib.match(/match: 'invalid_rate_unit',\s+field: 'rate_unit',\s+key: 'supplierPoRateUnitInvalid'/g) ?? []).length,
    2,
  )
  assert.match(lib, /invalid_rate_unit: 'supplierPoRateUnitInvalid', \/\/ create \(0157\)/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoRateUnit',
    'supplierPoRateUnitMonth',
    'supplierPoRateUnitDay',
    'supplierPoPerMonth',
    'supplierPoPerDay',
    'supplierPoRateUnitInvalid',
    'supplierPoDefaultRateUnit',
    'supplierPoDefaultRateUnitHint',
  ]) {
    const matches =
      translations.match(
        new RegExp(`^    ${key}:\\s*\\n?\\s*('[^'\\n]*'|"[^"\\n]*"),$`, 'gm'),
      ) ?? []
    assert.equal(matches.length, 2, key)
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})
