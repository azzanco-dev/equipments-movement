const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-11, «اذا بسوي امر شراء او كرت لنفس الشركة والمشروع خليه يطلع
// تنبيه»: a WARNING, never a block, when a unit is put on a supplier PO while
// it already sits on another PO of the same company and project.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      Intl,
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const { existingPosByUnit, unitsWithExistingPo } = loadLibModule('purchasing')
const row = (equipment_id, po_number, start_date) => ({
  equipment_id,
  supplier_po_id: `id-${po_number}`,
  po_number,
  start_date,
  approval_status: 'draft',
})

test('existingPosByUnit groups by unit, newest start date first', () => {
  const byUnit = existingPosByUnit([
    row('u1', 'PO-2026110001', '2026-11-01'),
    row('u2', 'PO-2026110002', '2026-11-02'),
    row('u1', 'PO-2026110204', '2026-11-06'),
    row('u1', 'PO-2026110100', '2026-11-06'),
  ])
  assert.deepEqual(
    Array.from(byUnit.get('u1'), (r) => r.po_number),
    ['PO-2026110204', 'PO-2026110100', 'PO-2026110001'],
  )
  assert.equal(byUnit.get('u2').length, 1)
  assert.equal(existingPosByUnit([]).size, 0)
})

test('unitsWithExistingPo keeps the ticked order and skips clean units', () => {
  const byUnit = existingPosByUnit([
    row('u1', 'PO-2026110001', '2026-11-01'),
    row('u3', 'PO-2026110003', '2026-11-03'),
  ])
  assert.deepEqual(
    Array.from(unitsWithExistingPo(['u3', 'u2', 'u1'], byUnit)),
    ['u3', 'u1'],
  )
  assert.deepEqual(Array.from(unitsWithExistingPo([], byUnit)), [])
  assert.deepEqual(Array.from(unitsWithExistingPo(['u1'], new Map())), [])
})

test('the loader reads five columns of purchasing_po_units, bounded, throwing', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  const start = data.indexOf('export async function fetchExistingUnitPos')
  assert.ok(start > 0)
  const fn = data.slice(start)
  assert.match(fn, /\.from\('purchasing_po_units'\)/)
  assert.match(
    fn,
    /\.select\('equipment_id,supplier_po_id,po_number,start_date,approval_status'\)/,
  )
  assert.doesNotMatch(fn, /select\('\*'\)/)
  assert.match(fn, /\.limit\(1000\)/)
  assert.match(fn, /unwrapRows</)
  assert.match(fn, /neq\('supplier_po_id'/)
})

test('both dialogs warn with a warning Notice and never block saving', () => {
  for (const file of ['CreateSupplierPoDialog.tsx', 'AddEquipmentDialog.tsx']) {
    const src = read('src', 'components', 'purchasing', file)
    assert.match(src, /<Notice tone="warning" size="compact">/, file)
    assert.match(src, /fetchExistingUnitPos/, file)
    assert.match(src, /supplierPoDupCheckFailed/, file)
    assert.match(src, /existingFailed/, file)
    assert.doesNotMatch(src, /disabled=\{[^}]*(duplicate|existing)/i, file)
    assert.doesNotMatch(
      src,
      /<Button variant="primary"[^>]*disabled/,
      `${file}: the save button is never disabled`,
    )
  }
  const create = read(
    'src',
    'components',
    'purchasing',
    'CreateSupplierPoDialog.tsx',
  )
  assert.match(create, /supplierPoDupUnitLine/)
  assert.match(create, /supplierPoDupCreateNotice/)
  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /excludePoId: po\.id/)
  assert.match(add, /supplierPoDupAddNotice/)
})

test('the new translation keys exist in both languages, no hamza alif in Arabic', () => {
  const text = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...text.matchAll(
      /\/\/ po-duplicate-warning — start\n([\s\S]*?)\/\/ po-duplicate-warning — end/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  const keys = (block) =>
    [...block[1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
  const [ar, en] = blocks
  assert.deepEqual(keys(ar), keys(en))
  assert.ok(keys(ar).length >= 5)
  assert.ok(text.indexOf(ar[0]) < text.indexOf(en[0]))
  assert.doesNotMatch(ar[1], /[أإآ]/)
})
