const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the driver helpers are exercised exactly as the driver page uses them.
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
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const driverEquipment = loadLibModule('driverEquipment')

// The module runs in its own vm realm, so the objects it returns do not share
// this realm's prototypes. Comparing plain copies keeps the assertions strict.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const row = (overrides = {}) => ({
  equipment_id: 'eq-1',
  equipment_code: 'A145',
  equipment_type: 'حفار',
  equipment_plate_number: 'ABC 1234',
  times_driven: 3,
  last_driven_at: '2026-09-18T07:00:00Z',
  is_current: false,
  ...overrides,
})

test('the select constant asks only for the columns the section renders', () => {
  const fields = driverEquipment.DRIVER_EQUIPMENT_SELECT.split(',')
  assert.deepEqual(fields, [
    'equipment_id',
    'equipment_code',
    'equipment_type',
    'equipment_plate_number',
    'times_driven',
    'last_driven_at',
    'is_current',
  ])
  assert.ok(!driverEquipment.DRIVER_EQUIPMENT_SELECT.includes('*'))
  assert.equal(driverEquipment.DRIVER_EQUIPMENT_LIMIT, 20)
  assert.equal(
    driverEquipment.DRIVER_EQUIPMENT_SUMMARY_VIEW,
    'driver_equipment_summary',
  )
})

test('a full row maps to the display shape', () => {
  assert.deepEqual(plain(driverEquipment.mapDriverEquipmentRow(row())), {
    equipmentId: 'eq-1',
    code: 'A145',
    type: 'حفار',
    plateNumber: 'ABC 1234',
    timesDriven: 3,
    lastDrivenAt: '2026-09-18T07:00:00Z',
    isCurrent: false,
  })
})

test('columns hidden by RLS or left blank become null, never empty text', () => {
  const mapped = driverEquipment.mapDriverEquipmentRow(
    row({
      equipment_code: null,
      equipment_type: '   ',
      equipment_plate_number: '',
      last_driven_at: null,
    }),
  )
  assert.equal(mapped.code, null)
  assert.equal(mapped.type, null)
  assert.equal(mapped.plateNumber, null)
  assert.equal(mapped.lastDrivenAt, null)
  assert.equal(mapped.equipmentId, 'eq-1')
})

test('an unusable times_driven never renders as a negative or fractional count', () => {
  const counts = [null, undefined, '4', -2, Number.NaN, 2.7].map(
    (value) =>
      driverEquipment.mapDriverEquipmentRow(row({ times_driven: value }))
        .timesDriven,
  )
  assert.deepEqual(counts, [0, 0, 0, 0, 0, 2])
})

test('is_current is only true for a real boolean true', () => {
  const values = [true, false, null, undefined, 'true', 1].map(
    (value) =>
      driverEquipment.mapDriverEquipmentRow(row({ is_current: value }))
        .isCurrent,
  )
  assert.deepEqual(values, [true, false, false, false, false, false])
})

test('rows are ordered current first, then most recently driven', () => {
  const mapped = driverEquipment.mapDriverEquipmentRows([
    row({ equipment_id: 'old', last_driven_at: '2026-01-01T00:00:00Z' }),
    row({ equipment_id: 'recent', last_driven_at: '2026-09-18T07:00:00Z' }),
    row({
      equipment_id: 'driving',
      last_driven_at: '2026-05-05T00:00:00Z',
      is_current: true,
    }),
  ])
  assert.deepEqual(
    mapped.map((item) => item.equipmentId),
    ['driving', 'recent', 'old'],
  )
})

test('equal timestamps fall back to the equipment id, so the order is stable', () => {
  const sameTime = '2026-09-18T07:00:00Z'
  const ids = driverEquipment
    .mapDriverEquipmentRows([
      row({ equipment_id: 'b', last_driven_at: sameTime }),
      row({ equipment_id: 'a', last_driven_at: sameTime }),
      row({ equipment_id: 'c', last_driven_at: sameTime }),
    ])
    .map((item) => item.equipmentId)
  assert.deepEqual(ids, ['a', 'b', 'c'])
})

test('rows with no equipment id and empty payloads are dropped', () => {
  assert.deepEqual(plain(driverEquipment.mapDriverEquipmentRows(null)), [])
  assert.deepEqual(plain(driverEquipment.mapDriverEquipmentRows(undefined)), [])
  assert.deepEqual(
    driverEquipment
      .mapDriverEquipmentRows([row({ equipment_id: null }), row()])
      .map((item) => item.equipmentId),
    ['eq-1'],
  )
})

test('a row that never carried a timestamp sorts last instead of crashing', () => {
  const ids = driverEquipment
    .mapDriverEquipmentRows([
      row({ equipment_id: 'unknown', last_driven_at: null }),
      row({ equipment_id: 'dated', last_driven_at: '2026-02-02T00:00:00Z' }),
    ])
    .map((item) => item.equipmentId)
  assert.deepEqual(ids, ['dated', 'unknown'])
})

test('the view-all link carries the driver name as a movement log filter', () => {
  const href = driverEquipment.buildDriverMovementsHref(' محمد علي ')
  assert.ok(href.startsWith('/logs?filters='))
  const filters = JSON.parse(
    decodeURIComponent(href.slice('/logs?filters='.length)),
  )
  assert.deepEqual(filters, [
    { id: 'driver', field: 'driver_name', operator: 'eq', value: 'محمد علي' },
  ])
})

test('a driver with no usable name links to the unfiltered movement log', () => {
  assert.equal(driverEquipment.buildDriverMovementsHref('   '), '/logs')
  assert.equal(driverEquipment.buildDriverMovementsHref(''), '/logs')
})
