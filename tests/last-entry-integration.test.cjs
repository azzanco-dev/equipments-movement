const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
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

const { driverOption, driverOptionDescription } = loadLibModule('driverOptions')

test('the driver option puts the name on the label', () => {
  const option = driverOption({
    id: 'd1',
    full_name: 'محمد الغامدي',
    id_number: '2345678901',
    mobile_number: '0551234567',
  })
  assert.equal(option.value, 'd1')
  assert.equal(option.label, 'محمد الغامدي')
  assert.equal(option.description, '2345678901 · 0551234567')
})

test('an english name stays part of the label, not the second line', () => {
  const option = driverOption({
    id: 'd2',
    full_name: 'محمد الغامدي',
    name_en: 'Mohammed Alghamdi',
    id_number: '2345678901',
    mobile_number: null,
  })
  assert.equal(option.label, 'محمد الغامدي — Mohammed Alghamdi')
  assert.equal(option.description, '2345678901')
})

test('the second line keeps whichever identifier exists', () => {
  assert.equal(driverOptionDescription(null, '0551234567'), '0551234567')
  assert.equal(driverOptionDescription('2345678901', null), '2345678901')
  assert.equal(driverOptionDescription('  ', '  '), undefined)
})

test('a driver without identifiers gets no second line', () => {
  const option = driverOption({
    id: 'd3',
    full_name: 'سائق بدون بيانات',
    id_number: null,
    mobile_number: null,
  })
  assert.equal(option.label, 'سائق بدون بيانات')
  assert.equal('description' in option, false)
})
