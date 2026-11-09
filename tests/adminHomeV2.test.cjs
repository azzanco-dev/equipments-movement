// The admin home rebuilt on the approved /ui-kit «نموذج الرئيسية الجديدة v2»
// (owner 2026-11-09: «اعتمد الرئيسية الي في ui-kit», variant «ب بمسافات
// الحالية»; EM-252 «الارقام الحالية تاخذ كامل الصفحة»).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function loadLib(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Intl,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
const BLOCKS = [
  'KpiStrip',
  'FleetStateCard',
  'TopProjectsCard',
  'WorkshopPurposeCard',
  'LatestMovementsCard',
  'AttentionSection',
  'WorkshopSuppliersCard',
  'AvailabilityCard',
  'AfaqyCard',
  'EntriesCard',
]
const NEW_FILES = [
  'HomeBlock',
  'KpiStrip',
  'FleetStateCard',
  'TopProjectsCard',
  'WorkshopPurposeCard',
  'LatestMovementsCard',
  'WorkshopSuppliersCard',
  'AvailabilityCard',
  'AfaqyCard',
  'EntriesCard',
]
const component = (name) =>
  read('src', 'components', 'admin-home', `${name}.tsx`)

test('the page composes the mockup blocks in order, three rows of three', () => {
  const at = ['<PageHeader', ...BLOCKS.map((name) => `<${name}`)].map(
    (needle) => screen.indexOf(needle),
  )
  assert.ok(
    at.every((index, i) => index > 0 && (i === 0 || index > at[i - 1])),
    String(at),
  )
  // Phone: one column; two from md; the mockup's three from xl.
  assert.match(screen, /const ROW = 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'/)
  assert.equal(screen.match(/<div className=\{ROW\}>/g).length, 3)
  // The KPI strip two per row on a phone.
  assert.match(
    component('KpiStrip'),
    /className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"/,
  )
  // The greeting stays (22 / 24 px, no date).
  assert.match(screen, /text-\[22px\] font-bold leading-tight sm:text-\[24px\]/)
  assert.doesNotMatch(screen, /saudiDayLabel/)
})

test('what a block cannot hold opens in place from its «عرض الكل»', () => {
  for (const [panel, element] of [
    ['fleet-tables', '<FleetStateSection'],
    ['availability', '<AvailabilitySection />'],
    ['afaqy', '<AfaqySection onSelectEquipment={onSelectEquipment} />'],
  ]) {
    const call =
      screen.indexOf(`panelBox(\n          '${panel}'`) + 1 ||
      screen.indexOf(`panelBox('${panel}'`) + 1
    assert.ok(call > 0, panel)
    assert.ok(screen.indexOf(element, call) > call, panel)
    assert.match(screen, new RegExp(`openPanel\\('${panel}'\\)`))
  }
  assert.match(screen, /t\('adminHomeCollapse'\)/)
})

test('every link comes from the pure helpers, gated on the shell', () => {
  const kpi = component('KpiStrip')
  for (const call of [
    'links.equipment ? activeFleetHref() : null',
    'links.logs ? openProjectVisitsHref() : null',
    "links.logs ? workshopStateLogHref('maintenance') : null",
    "links.logs ? workshopStateLogHref('parking') : null",
    "links.logs ? workshopStateLogHref('out_of_service') : null",
    'links.equipment ? availableEquipmentHref() : null',
    'links.logs ? movementLogHref() : null',
    'links.purchasingUnits ? noPoHref() : null',
  ])
    assert.ok(kpi.includes(call), call)
  assert.match(screen, /purchasingUnits: canOpenPage\('purchasing\/units'\)/)
  assert.match(
    component('TopProjectsCard'),
    /canOpenLogs \? openProjectVisitsHref\(\) : null/,
  )
  assert.match(
    component('LatestMovementsCard'),
    /canOpenLogs \? movementLogHref\(\) : null/,
  )
  assert.match(component('LatestMovementsCard'), /movementHref\(row\.id\)/)
  // No list URL is written by hand in the blocks.
  for (const name of NEW_FILES)
    assert.doesNotMatch(
      component(name),
      /['"`]\/(logs|purchasing|sales)\?/,
      name,
    )

  const links = loadLib('adminHomeLinks')
  const param = (href, key) =>
    JSON.parse(new URL(href, 'http://x').searchParams.get(key))
  assert.deepEqual(param(links.activeFleetHref(), 'filters'), [
    { id: 'status', field: 'status', operator: 'eq', value: 'active' },
  ])
  assert.deepEqual(param(links.openProjectVisitsHref(), 'vfilters'), [
    { id: 'open', field: 'is_open', operator: 'eq', value: 'true' },
  ])
  assert.equal(
    new URL(links.openWorkshopVisitsHref(), 'http://x').searchParams.get(
      'context',
    ),
    'workshop',
  )
  assert.equal(links.movementLogHref(), '/logs?view=log')
  assert.equal(links.movementHref('m1'), '/movements/m1')
  assert.deepEqual(
    param(links.availableEquipmentHref(['alazani']), 'filters'),
    [
      {
        id: 'state',
        field: 'equipment_state',
        operator: 'eq',
        value: 'available',
      },
      { id: 'status', field: 'status', operator: 'eq', value: 'active' },
      {
        id: 'owner',
        field: 'ownership_status',
        operator: 'eq',
        value: 'alazani',
      },
    ],
  )
  const attention = loadLib('adminAttention')
  const longOos = param(
    attention.outOfServiceLongHref('2026-10-10', ['alazani']),
    'vfilters',
  )
  assert.deepEqual(longOos.at(-1), {
    id: 'owner',
    field: 'equipment_ownership_status',
    operator: 'eq',
    value: 'alazani',
  })
  // Without owners the attention item's link is unchanged.
  assert.equal(
    param(attention.outOfServiceLongHref('2026-10-10'), 'vfilters').length,
    3,
  )
})

test('the KPI gates: purchasing, sales and Afaqy figures only for their readers', () => {
  const kpi = component('KpiStrip')
  assert.match(kpi, /usePermissions\(\)\.can\('purchasing\.view'\)/)
  assert.match(kpi, /if \(!canPurchasing\) return null/)
  // A reader without purchasing sees «غير مصنفة» in that place.
  assert.match(kpi, /canPurchasing\s*\?\s*\{\s*id: 'no_po'/)
  assert.match(kpi, /'equipmentStateUnclassified'/)
  const attention = component('AttentionSection')
  assert.match(attention, /permissions\.can\('purchasing\.view'\)/)
  assert.match(attention, /permissions\.can\('sales\.view'\)/)
  assert.match(attention, /canViewEquipmentLocation\(permissions\)/)
  assert.match(
    component('AfaqyCard'),
    /if \(!canViewEquipmentLocation\(permissionState\)\) return null/,
  )
  // A failed read is an ErrorState with retry in its block, never «no data».
  const block = component('HomeBlock')
  assert.match(block, /state === 'failed' \? \(\s*<ErrorState/)
  assert.match(
    component('KpiStrip'),
    /if \(matrix\.failed\)\s*return \(\s*<ErrorState/,
  )
})

test('the data: one snapshot, bounded reads, every owner for the KPIs', () => {
  const data = read('src', 'lib', 'adminHomeData.ts')
  assert.match(
    data,
    /fetchEntriesSeriesAllOwners[\s\S]*?p_owners: \[\.\.\.ALL_OWNERS\]/,
  )
  const visits = data.slice(
    data.indexOf('export async function fetchOpenProjectVisits'),
  )
  assert.match(visits, /\.from\('movement_visits'\)/)
  assert.match(visits, /\.eq\('movement_context', 'site'\)/)
  assert.match(visits, /\.eq\('is_open', true\)/)
  assert.match(visits, /\.limit\(OPEN_PROJECT_VISITS_CAP\)/)
  const latest = data.slice(
    data.indexOf('export async function fetchLatestMovements'),
  )
  assert.match(latest, /\.from\('movement_log_search'\)/)
  assert.match(
    latest,
    /\.order\('recorded_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)\s*\.limit\(limit\)/,
  )
  assert.match(data, /LATEST_MOVEMENTS_LIMIT = 7/)
  assert.match(screen, /fetchAllOwnersStateMatrix\(signal\)/)
  // Figures count up; charts only through the lazy wrappers.
  for (const name of [
    'KpiStrip',
    'FleetStateCard',
    'TopProjectsCard',
    'WorkshopPurposeCard',
    'WorkshopSuppliersCard',
    'AfaqyCard',
    'EntriesCard',
  ])
    assert.match(component(name), /<CountUp value=\{/, name)
  for (const name of NEW_FILES)
    assert.doesNotMatch(component(name), /from 'recharts'/, name)
})

test('the pure rules: top projects, the daily run, shares and times', () => {
  const v2 = loadLib('adminHomeV2')
  const visit = (projectId, nameAr) => ({ projectId, nameAr, nameEn: null })
  const grouped = v2.topProjects(
    [
      visit('a', 'ب'),
      visit('b', 'ا'),
      visit('a', 'ب'),
      visit('c', 'ج'),
      visit(null, null),
      visit('b', 'ا'),
      visit('a', 'ب'),
    ],
    2,
  )
  assert.deepEqual(
    [...grouped.top.map((row) => `${row.id}:${row.count}`)],
    ['a:3', 'b:2'],
  )
  assert.equal(grouped.others, 1)
  assert.equal(grouped.otherProjects, 1)
  assert.equal(grouped.total, 6)
  assert.deepEqual(
    [
      ...v2.dailyRun(
        [
          { day: '2026-11-08', entries: 4, exits: 1 },
          { day: '2026-11-06', entries: 2, exits: 0 },
        ],
        'entries',
        '2026-11-08',
        4,
      ),
    ],
    [0, 2, 0, 4],
  )
  assert.equal(v2.sharePercent(1, 3), 33)
  assert.equal(v2.sharePercent(5, 0), 0)
  const now = new Date('2026-11-09T07:00:00Z') // 10:00 in Riyadh
  assert.equal(v2.movementTimeLabel('2026-11-09T04:15:00Z', now), '07:15')
  // 22:30 UTC on the 8th is the 9th in Riyadh: still today.
  assert.equal(v2.movementTimeLabel('2026-11-08T22:30:00Z', now), '01:30')
  assert.equal(v2.movementTimeLabel('2026-11-08T12:00:00Z', now), '08/11')
})

test('tokens only, no hamza alif in the new copy, no uppercase', () => {
  for (const name of NEW_FILES) {
    const source = component(name)
    assert.doesNotMatch(
      source,
      /\b(gray|slate|zinc|neutral|stone|red|green|amber|yellow|blue|emerald|indigo|teal|rose|orange|purple|violet|sky|lime|pink)-\d{2,3}\b/,
      name,
    )
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, name)
    assert.doesNotMatch(source, /rgba?\(|hsla?\(/, name)
    assert.doesNotMatch(
      source,
      /bg-white|text-white|bg-black|text-black|gradient/,
      name,
    )
    assert.doesNotMatch(source, /uppercase|tracking-/, name)
    // Logical direction utilities only.
    assert.doesNotMatch(
      source,
      /\b(ml|mr|pl|pr)-\d|\btext-(left|right)\b/,
      name,
    )
  }
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = translations.split('// admin-home-v2 — start')
  assert.equal(blocks.length, 3)
  const ar = blocks[1].slice(0, blocks[1].indexOf('// admin-home-v2 — end'))
  const en = blocks[2].slice(0, blocks[2].indexOf('// admin-home-v2 — end'))
  assert.doesNotMatch(ar, /[أإآ]/)
  const keys = (block) =>
    [...block.matchAll(/^ {4}(\w+): /gm)].map((match) => match[1])
  assert.deepEqual(keys(ar), keys(en))
  assert.ok(keys(ar).length > 30)
})
