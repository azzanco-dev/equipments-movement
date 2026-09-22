const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files,
// so the report filter helpers are exercised exactly as the screens use them.
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
        const alias = /^@\/lib\/(.+)$/.exec(request)
        if (alias) return loadLibModule(alias[1], cache)
        const relative = /^\.\/(.+)$/.exec(request)
        if (relative) return loadLibModule(relative[1], cache)
        // Type-only imports are erased; anything else is a real dependency the
        // helpers must not have.
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const {
  ALAZANI_ONLY,
  DEFAULT_REPORT_CONTEXT,
  REPORT_CONTEXTS,
  REPORT_CONTEXT_PARAM,
  REPORT_OWNERS_PARAM,
  applyReportFilterParams,
  isAlazaniOnly,
  isReportContext,
  parseReportContext,
  parseReportOwners,
  reportOwnersArgument,
  serializeReportOwners,
  toggleAlazaniOnly,
} = loadLibModule('reportFilters')

// The module runs in its own VM realm, so its arrays are not reference-equal to
// this file's `Array`. Comparing the JSON shape is what the other lib tests do.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- owners ---------------------------------------------------------------

test('an owners parameter is parsed into the canonical order', () => {
  assert.deepEqual(plain(parseReportOwners('takween,alazani')), [
    'alazani',
    'takween',
  ])
  assert.deepEqual(plain(parseReportOwners(' alazani , alazani ')), ['alazani'])
  assert.deepEqual(plain(parseReportOwners(['external_supplier', 'alazani'])), [
    'alazani',
    'external_supplier',
  ])
})

test('an unknown, empty or missing owner degrades to every owner', () => {
  assert.deepEqual(plain(parseReportOwners(null)), [])
  assert.deepEqual(plain(parseReportOwners(undefined)), [])
  assert.deepEqual(plain(parseReportOwners('')), [])
  assert.deepEqual(plain(parseReportOwners('everyone')), [])
  // A hand-edited link keeps only what the database accepts.
  assert.deepEqual(plain(parseReportOwners('alazani,everyone')), ['alazani'])
})

test('serializing is the inverse of parsing, and empty means every owner', () => {
  assert.equal(serializeReportOwners(['takween', 'alazani']), 'alazani,takween')
  assert.equal(serializeReportOwners([]), '')
  assert.equal(serializeReportOwners(null), '')
  assert.equal(serializeReportOwners(['everyone']), '')
  const raw = 'alazani,third_party_f'
  assert.equal(serializeReportOwners(parseReportOwners(raw)), raw)
})

test('the p_owners argument is null for every owner, never an empty array', () => {
  assert.equal(reportOwnersArgument([]), null)
  assert.equal(reportOwnersArgument(null), null)
  assert.equal(reportOwnersArgument(['everyone']), null)
  assert.deepEqual(plain(reportOwnersArgument(['takween', 'alazani'])), [
    'alazani',
    'takween',
  ])
})

// --- the «العزاني فقط» shortcut -------------------------------------------

test('the shortcut is pressed only when the selection is exactly Al-Azani', () => {
  assert.equal(isAlazaniOnly(ALAZANI_ONLY), true)
  assert.equal(isAlazaniOnly(['alazani']), true)
  assert.equal(isAlazaniOnly([]), false)
  assert.equal(isAlazaniOnly(['alazani', 'takween']), false)
  assert.equal(isAlazaniOnly(['takween']), false)
  assert.equal(isAlazaniOnly(null), false)
})

test('the shortcut sets Al-Azani, and pressing it again clears the filter', () => {
  assert.deepEqual(plain(toggleAlazaniOnly([])), ['alazani'])
  assert.deepEqual(plain(toggleAlazaniOnly(['takween'])), ['alazani'])
  assert.deepEqual(plain(toggleAlazaniOnly(['alazani'])), [])
  // It never mutates the shared constant.
  const toggled = toggleAlazaniOnly([])
  toggled.push('takween')
  assert.deepEqual(plain(ALAZANI_ONLY), ['alazani'])
})

// --- context --------------------------------------------------------------

test('the context parameter accepts only the three known values', () => {
  assert.deepEqual([...REPORT_CONTEXTS], ['site', 'workshop', 'all'])
  assert.equal(DEFAULT_REPORT_CONTEXT, 'site')
  for (const value of REPORT_CONTEXTS) {
    assert.equal(isReportContext(value), true)
    assert.equal(parseReportContext(value), value)
  }
  assert.equal(isReportContext('both'), false)
})

test('a missing or unknown context keeps the reports previous behaviour', () => {
  assert.equal(parseReportContext(null), 'site')
  assert.equal(parseReportContext(undefined), 'site')
  assert.equal(parseReportContext(''), 'site')
  assert.equal(parseReportContext('SITE'), 'site')
  assert.equal(parseReportContext('sites'), 'site')
  // A screen with another default (none today) still gets its own fallback.
  assert.equal(parseReportContext('sites', 'workshop'), 'workshop')
  assert.equal(parseReportContext(' workshop '), 'workshop')
})

// --- the URL --------------------------------------------------------------

test('the filter writes both values into the query string', () => {
  const params = applyReportFilterParams(
    new URLSearchParams('page=3'),
    ['takween', 'alazani'],
    'workshop',
  )
  assert.equal(params.get(REPORT_OWNERS_PARAM), 'alazani,takween')
  assert.equal(params.get(REPORT_CONTEXT_PARAM), 'workshop')
  assert.equal(params.get('page'), '3')
})

test('default values are removed, so an untouched report keeps its URL', () => {
  const params = applyReportFilterParams(
    new URLSearchParams('owners=alazani&context=workshop&period=month'),
    [],
    'site',
  )
  assert.equal(params.has(REPORT_OWNERS_PARAM), false)
  assert.equal(params.has(REPORT_CONTEXT_PARAM), false)
  assert.equal(params.get('period'), 'month')
  assert.equal(params.toString(), 'period=month')
})

test('an unknown owner never reaches the URL', () => {
  const params = applyReportFilterParams(new URLSearchParams(), ['everyone'])
  assert.equal(params.has(REPORT_OWNERS_PARAM), false)
  assert.equal(params.has(REPORT_CONTEXT_PARAM), false)
})

test('a URL round trip returns the same filter', () => {
  const written = applyReportFilterParams(
    new URLSearchParams(),
    ['external_supplier', 'alazani'],
    'all',
  )
  const read = new URLSearchParams(written.toString())
  assert.deepEqual(plain(parseReportOwners(read.get(REPORT_OWNERS_PARAM))), [
    'alazani',
    'external_supplier',
  ])
  assert.equal(parseReportContext(read.get(REPORT_CONTEXT_PARAM)), 'all')
})
