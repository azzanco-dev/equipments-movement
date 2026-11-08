// Migration 0185, the purchasing side (owner go 2026-11-08, «ابدا»): the
// supplier line's price is per month, week, day or hour, the totals stay one
// amount per unit, and the PDF names the unit in Arabic with its English
// under it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

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

const plain = (value) => JSON.parse(JSON.stringify(value))
const translations = read('src', 'i18n', 'translations.ts')

/** A key's value in Arabic (first) and English (second). */
function valuesOf(key) {
  const matches = [
    ...translations.matchAll(
      new RegExp(`^    ${key}:\\s*\\n?\\s*'([^'\\n]*)',$`, 'gm'),
    ),
  ]
  assert.equal(matches.length, 2, key)
  return { ar: matches[0][1], en: matches[1][1] }
}

test('the four units, in order, with month as the default', () => {
  const lib = loadLib('purchasing')
  assert.deepEqual(plain(lib.SUPPLIER_PO_RATE_UNITS), [
    'month',
    'week',
    'day',
    'hour',
  ])
  assert.equal(lib.SUPPLIER_PO_DEFAULT_RATE_UNIT, 'month')
  for (const unit of ['month', 'week', 'day', 'hour']) {
    assert.equal(lib.isSupplierPoRateUnit(unit), true, unit)
    assert.equal(lib.supplierPoRateUnitOf(unit), unit, unit)
  }
  assert.equal(lib.isSupplierPoRateUnit('year'), false)
  assert.equal(lib.supplierPoRateUnitOf('year'), 'month')
  assert.equal(lib.supplierPoRateUnitOf(null), 'month')
})

test('labels and suffixes reuse the sales keys for week and hour', () => {
  const lib = loadLib('purchasing')
  assert.deepEqual(plain(lib.SUPPLIER_PO_RATE_UNIT_LABEL_KEYS), {
    month: 'supplierPoRateUnitMonth',
    week: 'saleRateUnitWeek',
    day: 'supplierPoRateUnitDay',
    hour: 'saleRateUnitHour',
  })
  assert.deepEqual(plain(lib.SUPPLIER_PO_PER_UNIT_KEYS), {
    month: 'supplierPoPerMonth',
    week: 'salePerWeek',
    day: 'supplierPoPerDay',
    hour: 'salePerHour',
  })
  assert.deepEqual(
    Object.values(plain(lib.SUPPLIER_PO_PER_UNIT_KEYS)).map((key) =>
      valuesOf(key),
    ),
    [
      { ar: '/ شهر', en: '/ month' },
      { ar: '/ اسبوع', en: '/ week' },
      { ar: '/ يوم', en: '/ day' },
      { ar: '/ ساعة', en: '/ hour' },
    ],
  )
})

test('the PDF unit column says the unit in Arabic and English', () => {
  const lib = loadLib('purchasing')
  assert.deepEqual(
    plain(lib.SUPPLIER_PO_RATE_UNITS).map((unit) =>
      valuesOf(lib.SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[unit]),
    ),
    [
      { ar: 'شهري', en: 'Monthly' },
      { ar: 'اسبوعي', en: 'Weekly' },
      { ar: 'يومي', en: 'Daily' },
      { ar: 'بالساعة', en: 'Hourly' },
    ],
  )
  const sheet = read(
    'src',
    'components',
    'purchasing',
    'SupplierPoPrintSheet.tsx',
  )
  assert.ok(
    sheet.includes(
      'const unitKey = SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[supplierPoRateUnitOf(line.rate_unit)]',
    ),
  )
  assert.match(sheet, /<Stacked k=\{unitKey\} \/>/)
  // The totals box names a unit only when the PO mixes them.
  assert.match(sheet, /const mixedUnits = totals\.length > 1/)
  assert.match(
    sheet,
    /<PricesByUnit parts=\{totals\} alignEnd showUnit=\{mixedUnits\} \/>/,
  )
})

test('totals per unit: month, week, day, hour, never added together', () => {
  const lib = loadLib('purchasing')
  assert.deepEqual(
    plain(
      lib.supplierPoTotalsByUnit([
        { price: 50, rate_unit: 'hour' },
        { price: 300, rate_unit: 'day' },
        { price: '1500.25', rate_unit: 'week' },
        { price: 9000, rate_unit: 'month' },
        { price: 25.5, rate_unit: 'hour' },
        { price: null, rate_unit: 'week' },
      ]),
    ),
    {
      parts: [
        { unit: 'month', total: 9000 },
        { unit: 'week', total: 1500.25 },
        { unit: 'day', total: 300 },
        { unit: 'hour', total: 75.5 },
      ],
      unpriced: 1,
    },
  )
  // An unpriced weekly line still names its unit.
  assert.deepEqual(
    plain(lib.supplierPoTotalsByUnit([{ price: null, rate_unit: 'week' }])),
    { parts: [{ unit: 'week', total: 0 }], unpriced: 1 },
  )
})

test('the dialogs offer every unit from the shared list', () => {
  for (const file of [
    'AddEquipmentDialog.tsx',
    'EditLineDialog.tsx',
    'CreateSupplierPoDialog.tsx',
  ]) {
    const source = read('src', 'components', 'purchasing', file)
    assert.match(
      source,
      /SUPPLIER_PO_RATE_UNITS\.map\(\(unit\) => \(\{[\s\S]*?label: t\(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS\[unit\]\)/,
      file,
    )
  }
  const price = read('src', 'components', 'purchasing', 'Price.tsx')
  assert.ok(price.includes('{t(SUPPLIER_PO_PER_UNIT_KEYS[unit])}'))
})

test('the four-unit message, and the purchasing-0185 block without hamza on alif', () => {
  const lib = read('src', 'lib', 'purchasing.ts')
  assert.equal(
    (lib.match(/key: 'supplierPoRateUnitInvalidFour'/g) ?? []).length,
    2,
  )
  assert.deepEqual(valuesOf('supplierPoRateUnitInvalidFour'), {
    ar: 'اختر وحدة السعر: شهري او اسبوعي او يومي او بالساعة.',
    en: 'Pick the price unit: monthly, weekly, daily or hourly.',
  })
  const blocks = [
    ...translations.matchAll(
      /\/\/ purchasing-0185 — start[^\n]*\n([\s\S]*?)\/\/ purchasing-0185 — end/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  for (const [, body] of blocks) assert.doesNotMatch(body, /[أإآ]/)
  // Each block sits right after the sales-0185 block of its language.
  assert.equal(
    (
      translations.match(
        /\/\/ sales-0185 — end\n {4}\/\/ purchasing-0185 — start/g,
      ) ?? []
    ).length,
    2,
  )
})
