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
        // The workbook reader is never called by the pure helpers under test;
        // it only has to exist at module scope.
        if (request === 'xlsx') return { read: () => ({}), utils: {} }
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

test('the four owner-approved statuses are the only ones offered', () => {
  assert.deepEqual(plain(form.EQUIPMENT_STATUSES), [
    'active',
    'sold',
    'scrapped',
    'rented_out',
  ])
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
  assert.deepEqual(plain(form.equipmentStatusBadge('scrapped')), {
    tone: 'neutral',
    key: 'equipmentStatusScrapped',
  })
  assert.deepEqual(plain(form.equipmentStatusBadge('rented_out')), {
    tone: 'neutral',
    key: 'equipmentStatusRentedOut',
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
    form.isFleetEquipment({ is_active: false, status: 'scrapped' }),
    false,
  )
  // A row selected before migration 0102 has no status; is_active decides.
  assert.equal(form.isFleetEquipment({ is_active: true }), true)
  assert.equal(form.isFleetEquipment({ is_active: false }), false)
})

test('under maintenance is derived from the latest movement only', () => {
  const open = {
    movement_type: 'entry',
    movement_context: 'workshop',
    workshop_purpose: 'maintenance',
  }
  assert.equal(form.isUnderMaintenance(open), true)
  // Parking is a workshop entry too, but it is not maintenance.
  assert.equal(
    form.isUnderMaintenance({ ...open, workshop_purpose: 'parking' }),
    false,
  )
  // Not classified yet.
  assert.equal(
    form.isUnderMaintenance({ ...open, workshop_purpose: null }),
    false,
  )
  // The workshop exit is a later movement, so the state clears.
  assert.equal(
    form.isUnderMaintenance({ ...open, movement_type: 'exit' }),
    false,
  )
  // A site entry is not maintenance whatever the purpose column holds.
  assert.equal(
    form.isUnderMaintenance({ ...open, movement_context: 'site' }),
    false,
  )
  // Equipment that has never moved.
  assert.equal(form.isUnderMaintenance(undefined), false)
  assert.equal(form.isUnderMaintenance(null), false)
})

const updateExcel = loadLibModule('equipmentUpdateExcel')

test('the Excel status cell accepts both languages and keeps blanks', () => {
  assert.equal(updateExcel.parseEquipmentStatusCell('نشطة'), 'active')
  assert.equal(updateExcel.parseEquipmentStatusCell('Sold'), 'sold')
  assert.equal(updateExcel.parseEquipmentStatusCell('  مشطوبة '), 'scrapped')
  assert.equal(updateExcel.parseEquipmentStatusCell('rented out'), 'rented_out')
  assert.equal(
    updateExcel.parseEquipmentStatusCell('مؤجرة للغير'),
    'rented_out',
  )
  // Blank / missing means "keep the current status", not "unknown".
  assert.equal(updateExcel.parseEquipmentStatusCell(''), null)
  assert.equal(updateExcel.parseEquipmentStatusCell('   '), null)
  assert.equal(updateExcel.parseEquipmentStatusCell(undefined), null)
  // Anything else is reported per row rather than silently ignored.
  assert.equal(updateExcel.parseEquipmentStatusCell('retired'), undefined)
})
