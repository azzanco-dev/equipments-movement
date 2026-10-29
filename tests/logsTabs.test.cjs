const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-29: «في صفحة الدخوليات، فلتر المشاريع الورشة الكل، برضه يكون
// خاضع للصلاحية». The log's context tabs follow the `movements.read` scope.

const ROOT = path.join(__dirname, '..')

function loadLib(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const tabs = loadLib('logsTabs')

test('the tabs follow the movements.read scope', () => {
  const all = ['site', 'workshop', 'all']
  assert.deepEqual([...tabs.logsTabsForScope('all')], all)
  assert.deepEqual([...tabs.logsTabsForScope('site')], ['site'])
  assert.deepEqual([...tabs.logsTabsForScope('companies')], ['site'])
  assert.deepEqual([...tabs.logsTabsForScope('workshop')], ['workshop'])
  // Own rows can be of either context; RLS returns only those.
  assert.deepEqual([...tabs.logsTabsForScope('own')], all)
  assert.deepEqual([...tabs.logsTabsForScope(null)], all)
  // A fresh array every time, never the shared constant.
  assert.notEqual(tabs.logsTabsForScope('all'), tabs.LOGS_TABS)
})

test('a tab the scope does not offer falls back to the first offered', () => {
  assert.equal(tabs.clampLogsTab('all', ['site']), 'site')
  assert.equal(tabs.clampLogsTab('site', ['workshop']), 'workshop')
  assert.equal(
    tabs.clampLogsTab('workshop', ['site', 'workshop', 'all']),
    'workshop',
  )
  assert.equal(tabs.isLogsTab('all'), true)
  assert.equal(tabs.isLogsTab('x'), false)
  assert.equal(tabs.isLogsTab(null), false)
})

test('LogsScreen offers only the allowed tabs and clamps the URL', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'screens', 'admin-home', 'LogsScreen.tsx'),
    'utf8',
  )
  assert.match(source, /logsTabsForScope\(readScope\)/)
  assert.match(source, /permissions\.scope\('movements\.read'\)/)
  assert.match(source, /clampLogsTab\(defaultContext, tabs\)/)
  assert.match(source, /tabs\.length > 1 &&/)
  assert.match(source, /\{tabs\.map\(\(value\) =>/)
  assert.doesNotMatch(source, /\bTABS\.map\b/)
})
