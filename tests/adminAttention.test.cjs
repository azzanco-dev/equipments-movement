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
  vm.runInNewContext(
    code,
    {
      exports,
      URLSearchParams,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1])
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const lib = loadLib('adminAttention')
const filtersOf = (href, param) =>
  JSON.parse(new URL(href, 'http://x').searchParams.get(param))

test('only items above zero show, in the block order', () => {
  assert.deepEqual(
    [
      ...lib.visibleAttentionItems({
        available_alazani: 2,
        awaiting_approval: 1,
        awaiting_end: 0,
      }),
    ],
    ['awaiting_approval', 'available_alazani'],
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
  assert.deepEqual(
    filtersOf(lib.awaitingApprovalHref(), 'filters').map(
      (f) => `${f.field}:${f.operator}:${f.value}`,
    ),
    // 0189 (owner 2026-11-11): a supplier PO has no open / closed state.
    ['approval_status:eq:draft', 'unpriced_count:eq:0'],
  )
  // Owner 2026-11-10: the items that left the block took their links along.
  for (const gone of ['unclassifiedHref', 'noPoHref', 'unpricedHref'])
    assert.equal(lib[gone], undefined, gone)
  // Each field and operator is offered by the target list's config.
  const visits = read('src', 'lib', 'visitsList.ts')
  assert.match(visits, /key: 'is_open'/)
  const configs = read('src', 'lib', 'listConfigs.ts')
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
  // Owner 2026-11-10: no Afaqy item any more.
  assert.doesNotMatch(section, /canViewEquipmentLocation|loadAfaqyStats/)
  // Home v2 (owner 2026-11-09): the block keeps its grid place and says
  // there is nothing to do; a first load is the block's skeleton.
  assert.match(section, /items\.length === 0 && !failed \? \(/)
  assert.match(section, /t\('homeV2AttentionNone'\)/)
  assert.match(section, /state=\{firstLoad \? 'loading' : 'ready'\}/)
  assert.match(section, /role="alert"/)
  assert.match(section, /canOpenPage\('purchasing\/orders'\)/)
  // Home v2 (owner 2026-11-09): in the second row; since the owner's «اخر
  // الحركات جنب الورشة» of 2026-11-10 it opens the row and the latest
  // movements sit between it and the workshop card.
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.ok(
    screen.indexOf('<AttentionSection') <
      screen.indexOf('<LatestMovementsCard'),
  )
  assert.ok(
    screen.indexOf('<LatestMovementsCard') < screen.indexOf('<WorkshopCard'),
  )
  assert.ok(
    screen.indexOf('<AttentionSection') < screen.indexOf('<WorkshopCard'),
  )
  assert.doesNotMatch(screen, /onShowAfaqy/)
  assert.match(screen, /id=\{AFAQY_ANCHOR\}/)
  assert.match(
    read('src', 'App.tsx'),
    /canOpenPage=\{\(target\) => shell\.pages\.has\(target\)\}/,
  )
})

// 0185 added «معدات خرجت بانتهاء عمل وكرتها مفتوح»; migration 0189 (owner
// 2026-11-11, «وحتى المعدة نشيل منها البداية والنهاية ومفتوح») took the
// card's period away, so nothing «awaits its end» any more.
test('0189: no cards awaiting their end — two items, no sales read', () => {
  assert.deepEqual(
    [...lib.ATTENTION_ORDER],
    ['awaiting_approval', 'available_alazani'],
  )
  assert.equal(lib.visibleAttentionItems({ awaiting_end: 3 }).length, 0)
  assert.equal(lib.awaitingEndHref, undefined)
  assert.equal(lib.AWAITING_END_PAGE, undefined)
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'lib', 'cardsAwaitingEnd.ts')))

  const section = read(
    'src',
    'components',
    'admin-home',
    'AttentionSection.tsx',
  )
  assert.doesNotMatch(
    section,
    /sales_cards_awaiting_end|awaiting_end|canSales|adminAttentionAwaitingEnd/,
  )
  // The approval count: every draft with all its lines priced (no status).
  assert.match(
    section,
    /\.from\('supplier_pos'\)\s+\.select\('id', \{ count: 'exact', head: true \}\)\s+\.eq\('approval_status', 'draft'\)\s+\.eq\('unpriced_count', 0\)/,
  )
  assert.doesNotMatch(section, /\.eq\('status', 'open'\)/)
  assert.match(section, /\[canPurchasing\],/)
})

// Owner 2026-11-10: «معدات متاحة (العزاني)» from the page's snapshot.
test('the available Al-Azani item reads the snapshot and opens the list', () => {
  const section = read(
    'src',
    'components',
    'admin-home',
    'AttentionSection.tsx',
  )
  assert.match(
    section,
    /available_alazani: matrix\.data\?\.count\('alazani', 'available'\) \?\? 0/,
  )
  assert.match(
    section,
    /canOpenEquipment \? availableEquipmentHref\(\['alazani'\]\) : null/,
  )
  assert.match(section, /label: 'adminAttentionAvailableAlazani'/)
  // Only the two database counts; no workshop, PO-less or unpriced reads.
  assert.doesNotMatch(
    section,
    /movement_visits|purchasing_site_units|gt\('unpriced_count'/,
  )
  // A failed snapshot is an error with retry, never zero.
  assert.match(section, /const failed = counts\.failed \|\| matrix\.failed/)
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.match(screen, /<AttentionSection\s+matrix=\{matrix\}/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'adminAttentionAvailableAlazani',
    'adminAttentionAvailableAlazaniHint',
  ]) {
    const matches =
      translations.match(new RegExp(`^    ${key}: '[^'\n]+',$`, 'gm')) ?? []
    assert.equal(matches.length, 2, key)
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})
