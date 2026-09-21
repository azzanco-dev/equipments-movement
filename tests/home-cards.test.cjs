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

// Covers the wave6-A workshop home cards: the "inside workshop" card's
// maintenance/parking breakdown line and each purpose card's share of the
// inside-workshop total. Both must hide rather than show a false "0 of 0".
test('insideWorkshopBreakdown hides when nothing is inside', () => {
  assert.equal(
    home.insideWorkshopBreakdown({
      insideNow: 0,
      maintenance: 0,
      parking: 0,
      pendingClassification: 0,
      pending: [],
    }),
    null,
  )
  assert.deepEqual(
    plain(
      home.insideWorkshopBreakdown({
        insideNow: 21,
        maintenance: 13,
        parking: 6,
        pendingClassification: 2,
        pending: [],
      }),
    ),
    { maintenance: 13, parking: 6 },
  )
})

test('workshopPurposeShare hides when nothing is inside and never divides by zero', () => {
  assert.equal(home.workshopPurposeShare(0, 0), null)
  assert.equal(home.workshopPurposeShare(5, 0), null)
  assert.deepEqual(plain(home.workshopPurposeShare(13, 21)), {
    count: 13,
    total: 21,
  })
  // A purpose count of zero still reports its (zero) share of a non-zero
  // inside-workshop total, rather than being treated as "nothing to show".
  assert.deepEqual(plain(home.workshopPurposeShare(0, 21)), {
    count: 0,
    total: 21,
  })
})
