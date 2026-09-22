const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/driverEquipment.ts (no imports of its own) so the
// `?driver=<id>` URL helpers behind DriverDetailDialog / DriversListScreen
// are exercised exactly as written, without a bundler.
function loadDriverEquipment() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'driverEquipment.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, URLSearchParams }, { filename: file })
  return exports
}

const driverEquipment = loadDriverEquipment()

test('the dialog query param is "driver"', () => {
  assert.equal(driverEquipment.DRIVER_DIALOG_QUERY_PARAM, 'driver')
})

test('buildDriverDialogHref points at the drivers list with the id as a query param', () => {
  assert.equal(
    driverEquipment.buildDriverDialogHref(
      '11111111-1111-1111-1111-111111111111',
    ),
    '/drivers?driver=11111111-1111-1111-1111-111111111111',
  )
})

test('buildDriverDialogHref percent-encodes an id that needs it', () => {
  assert.equal(
    driverEquipment.buildDriverDialogHref('a b&c'),
    '/drivers?driver=a%20b%26c',
  )
})

test('driverIdFromSearchParams reads the id from real URLSearchParams', () => {
  const params = new URLSearchParams('driver=abc&q=test')
  assert.equal(driverEquipment.driverIdFromSearchParams(params), 'abc')
})

test('driverIdFromSearchParams accepts anything with a get() method, not just URLSearchParams', () => {
  const readonlyLike = { get: (name) => (name === 'driver' ? 'xyz' : null) }
  assert.equal(driverEquipment.driverIdFromSearchParams(readonlyLike), 'xyz')
})

test('driverIdFromSearchParams returns null when the param is missing, blank, or params is absent', () => {
  assert.equal(
    driverEquipment.driverIdFromSearchParams(new URLSearchParams('q=test')),
    null,
  )
  assert.equal(
    driverEquipment.driverIdFromSearchParams(new URLSearchParams('driver=   ')),
    null,
  )
  assert.equal(driverEquipment.driverIdFromSearchParams(null), null)
  assert.equal(driverEquipment.driverIdFromSearchParams(undefined), null)
})

test('driverIdFromSearchParams trims surrounding whitespace', () => {
  assert.equal(
    driverEquipment.driverIdFromSearchParams(
      new URLSearchParams('driver=%20abc%20'),
    ),
    'abc',
  )
})
