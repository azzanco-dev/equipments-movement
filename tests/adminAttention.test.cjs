const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-29: «اضف الي يحتاج انتبهاك لرئيسية الادمن».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function loadLib(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const lib = loadLib('adminAttention')
const filtersOf = (href, param) =>
  JSON.parse(new URL(href, 'http://x').searchParams.get(param))

test('only items above zero show, in the strip order', () => {
  assert.deepEqual(
    [...lib.visibleAttentionItems({ unpriced: 2, unclassified: 1, no_po: 0 })],
    ['unclassified', 'unpriced'],
  )
  assert.equal(lib.visibleAttentionItems({}).length, 0)
})

test('the cutoff is the Saudi day', () => {
  // 22:00 UTC on 28 Oct is 01:00 on 29 Oct in Riyadh.
  assert.equal(
    lib.saudiDayBefore(new Date('2026-10-28T22:00:00Z'), 30),
    '2026-09-29',
  )
  assert.equal(
    lib.saudiDayBefore(new Date('2026-10-29T06:00:00Z'), 0),
    '2026-10-29',
  )
})

test('every item opens its list with allowlisted filters', () => {
  const unclassified = lib.unclassifiedHref()
  assert.match(unclassified, /^\/logs\?context=workshop&vfilters=/)
  assert.deepEqual(
    filtersOf(unclassified, 'vfilters').map((f) => `${f.field}:${f.operator}`),
    ['is_open:eq', 'workshop_purpose:is_not_set'],
  )
  const outOfService = filtersOf(
    lib.outOfServiceLongHref('2026-09-29'),
    'vfilters',
  )
  assert.deepEqual(
    outOfService.map((f) => `${f.field}:${f.operator}:${f.value}`),
    [
      'is_open:eq:true',
      'workshop_purpose:eq:out_of_service',
      'entry_at:lt:2026-09-29',
    ],
  )
  assert.match(lib.noPoHref(), /^\/purchasing\/units\?filters=/)
  assert.deepEqual(filtersOf(lib.noPoHref(), 'filters')[0].field, 'has_po')
  assert.deepEqual(
    filtersOf(lib.awaitingApprovalHref(), 'filters').map(
      (f) => `${f.field}:${f.operator}:${f.value}`,
    ),
    ['status:eq:open', 'approval_status:eq:draft', 'unpriced_count:eq:0'],
  )
  assert.deepEqual(
    filtersOf(lib.unpricedHref(), 'filters').map(
      (f) => `${f.field}:${f.operator}:${f.value}`,
    ),
    ['status:eq:open', 'unpriced_count:gt:0'],
  )
  // Each field and operator is offered by the target list's config.
  const visits = read('src', 'lib', 'visitsList.ts')
  assert.match(visits, /key: 'is_open'/)
  assert.match(visits, /'is_not_set'/)
  const configs = read('src', 'lib', 'listConfigs.ts')
  assert.match(configs, /key: 'has_po'/)
  assert.match(
    configs,
    /key: 'unpriced_count'[\s\S]*?operators: \['gt', 'eq'\]/,
  )
})

test('the section gates its items and sits at the end of the home', () => {
  const section = read(
    'src',
    'components',
    'admin-home',
    'AttentionSection.tsx',
  )
  assert.match(section, /permissions\.can\('purchasing\.view'\)/)
  assert.match(section, /canViewEquipmentLocation\(permissions\)/)
  assert.match(section, /if \(items\.length === 0 && !failed\) return null/)
  assert.match(section, /role="alert"/)
  assert.match(section, /canOpenPage\('logs'\)/)
  assert.match(section, /canOpenPage\('purchasing\/units'\)/)
  assert.match(section, /canOpenPage\('purchasing\/orders'\)/)
  // Owner 2026-10-29: off the top («شيله من الرئيسية»), then back at the
  // page's end with everything removed that day.
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.ok(
    screen.indexOf('<AttentionSection') > screen.indexOf('<EntriesFlowSection'),
  )
  assert.match(screen, /<div id=\{AFAQY_ANCHOR\}/)
  assert.match(
    read('src', 'App.tsx'),
    /canOpenPage=\{\(target\) => shell\.pages\.has\(target\)\}/,
  )
})
