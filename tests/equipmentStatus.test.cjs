const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Same loader as tests/equipment-form.test.cjs: the real `src/lib` modules are
// transpiled and their `@/lib/...` imports resolved, so the helpers are
// exercised exactly as the screens use them. Type-only imports are erased.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
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
      String,
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        // wave 18: the form schemas are built with the real Zod.
        if (request === 'zod') return require('zod')
        // The workbook reader is never called by the pure helpers under test;
        // it only has to exist at module scope.
        if (request === 'xlsx') return { read: () => ({}), utils: {} }
        if (request === 'xlsx-js-style') return { utils: {} }
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const form = loadLibModule('equipmentForm')
// Values built inside the vm realm are not reference-equal to this realm's
// prototypes, so they are compared after a JSON round-trip, exactly as
// tests/equipment-form.test.cjs does.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

test('active and sold are the only asset statuses offered (0125)', () => {
  assert.deepEqual(plain(form.EQUIPMENT_STATUSES), ['active', 'sold'])
})

test('only an active status reads as a fleet badge', () => {
  assert.deepEqual(plain(form.equipmentStatusBadge('active')), {
    tone: 'success',
    key: 'equipmentStatusActive',
  })
  assert.deepEqual(plain(form.equipmentStatusBadge('sold')), {
    tone: 'neutral',
    key: 'equipmentStatusSold',
  })
})

test('a row read without the column falls back to active, never blank', () => {
  assert.equal(form.equipmentStatusKey(undefined), 'equipmentStatusActive')
  assert.equal(form.equipmentStatusKey(null), 'equipmentStatusActive')
  assert.deepEqual(plain(form.equipmentStatusBadge(undefined)), {
    tone: 'success',
    key: 'equipmentStatusActive',
  })
})

test('fleet membership needs both is_active and an active status', () => {
  assert.equal(
    form.isFleetEquipment({ is_active: true, status: 'active' }),
    true,
  )
  assert.equal(
    form.isFleetEquipment({ is_active: true, status: 'sold' }),
    false,
  )
  assert.equal(
    form.isFleetEquipment({ is_active: false, status: 'active' }),
    false,
  )
  assert.equal(
    form.isFleetEquipment({ is_active: false, status: 'sold' }),
    false,
  )
  // A row selected before migration 0102 has no status; is_active decides.
  assert.equal(form.isFleetEquipment({ is_active: true }), true)
  assert.equal(form.isFleetEquipment({ is_active: false }), false)
})

const updateExcel = loadLibModule('equipmentUpdateExcel')

test('the Excel status cell accepts both languages and keeps blanks', () => {
  assert.equal(updateExcel.parseEquipmentStatusCell('نشطة'), 'active')
  assert.equal(updateExcel.parseEquipmentStatusCell('Sold'), 'sold')
  assert.equal(updateExcel.parseEquipmentStatusCell('  مباعة '), 'sold')
  // wave 20 (migration 0125): scrapped and rented out are retired, so a cell
  // that still says so is reported on its row instead of being sent.
  assert.equal(updateExcel.parseEquipmentStatusCell('  مشطوبة '), undefined)
  assert.equal(updateExcel.parseEquipmentStatusCell('rented out'), undefined)
  assert.equal(updateExcel.parseEquipmentStatusCell('مؤجرة للغير'), undefined)
  // Blank / missing means "keep the current status", not "unknown".
  assert.equal(updateExcel.parseEquipmentStatusCell(''), null)
  assert.equal(updateExcel.parseEquipmentStatusCell('   '), null)
  assert.equal(updateExcel.parseEquipmentStatusCell(undefined), null)
  // Anything else is reported per row rather than silently ignored.
  assert.equal(updateExcel.parseEquipmentStatusCell('retired'), undefined)
})
