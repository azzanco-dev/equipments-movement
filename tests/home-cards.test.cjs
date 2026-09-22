const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files,
// the same way tests/home-stats.test.cjs does. Kept local (rather than shared)
// so this file has no load-order dependency on the other home test file.
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

const home = loadLibModule('homeStats')

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// Covers the workshop home state cards' "change since yesterday" line: the
// comparison hides when the yesterday figure is unknown (stats function older
// than migration 0097) and the sign is rendered with a Latin minus.
test('changeSinceYesterday is null without a yesterday figure', () => {
  assert.equal(home.changeSinceYesterday(40, null), null)
  assert.equal(home.changeSinceYesterday(40, 37), 3)
  assert.equal(home.changeSinceYesterday(35, 37), -2)
  assert.equal(home.changeSinceYesterday(37, 37), 0)
})

test('formatSignedDelta keeps an explicit sign', () => {
  assert.equal(home.formatSignedDelta(3), '+3')
  assert.equal(home.formatSignedDelta(-2), '-2')
  assert.equal(home.formatSignedDelta(0), '0')
})

test('parseWorkshopHomeStats reads the yesterday snapshot when present', () => {
  const withYesterday = home.parseWorkshopHomeStats({
    inside_now: 40,
    maintenance: 3,
    parking: 31,
    pending_classification: 6,
    inside_yesterday: 38,
    maintenance_yesterday: 2,
    parking_yesterday: 30,
    pending: [],
  })
  assert.equal(withYesterday.insideYesterday, 38)
  assert.equal(withYesterday.maintenanceYesterday, 2)
  assert.equal(withYesterday.parkingYesterday, 30)

  const legacy = home.parseWorkshopHomeStats({
    inside_now: 40,
    maintenance: 3,
    parking: 31,
    pending_classification: 6,
    pending: [],
  })
  assert.equal(legacy.insideYesterday, null)
  assert.equal(legacy.maintenanceYesterday, null)
  assert.equal(legacy.parkingYesterday, null)
})
