// The entry report's tabs follow the reader's reports.view scope (migration
// 0158 refuses a context outside it; 2026-10-28 permissions review).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const { outputText } = ts.transpileModule(read('src', 'lib', 'reportFilters.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const mod = { exports: {} }
vm.runInNewContext(outputText, {
  module: mod,
  exports: mod.exports,
  require: () => ({}),
})
const plain = (value) => JSON.parse(JSON.stringify(value))

test('the allowed contexts follow the reports.view scope', () => {
  const { reportContextsForScope } = mod.exports
  assert.deepEqual(plain(reportContextsForScope('all')), ['site', 'workshop', 'all'])
  assert.deepEqual(plain(reportContextsForScope('site')), ['site'])
  assert.deepEqual(plain(reportContextsForScope('workshop')), ['workshop'])
  assert.deepEqual(plain(reportContextsForScope(null)), [])
})

test('a context outside the scope falls back to the first allowed one', () => {
  const { clampReportContext } = mod.exports
  assert.equal(clampReportContext('all', ['workshop']), 'workshop')
  assert.equal(clampReportContext('site', ['site']), 'site')
  assert.equal(clampReportContext('workshop', ['site', 'workshop', 'all']), 'workshop')
  assert.equal(clampReportContext('site', []), 'site')
})

test('both entry report screens pass the allowed tabs', () => {
  for (const file of ['EntryReports.tsx', 'EntryReportsAll.tsx']) {
    const source = read('src', 'screens', file)
    assert.match(source, /reportContextsForScope\(\s*usePermissions\(\)\.scope\('reports\.view'\),?\s*\)/, file)
    assert.match(source, /contexts=\{reportContexts\}/, file)
  }
  assert.match(
    read('src', 'components', 'OwnerContextFilter.tsx'),
    /\{showContext && contexts\.length > 1 && \(/,
  )
})
