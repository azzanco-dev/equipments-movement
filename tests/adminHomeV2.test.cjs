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
// Owner 2026-11-10: the available table took the projects chart's place in
// the first row («وبداله خليه جدول المتاحة») and the chart is last («خلي
// الجدول تحت اخر شي»).
const BLOCKS = [
  'KpiStrip',
  'FleetStateCard',
  'AvailableCard',
  'WorkshopPurposeCard',
  'LatestMovementsCard',
  'AttentionSection',
  'WorkshopCard',
  'AvailabilityCard',
  'AfaqyCard',
  'EntriesCard',
  'TopProjectsCard',
]
const NEW_FILES = [
  'HomeBlock',
  'KpiStrip',
  'FleetStateCard',
  'AvailableCard',
  'TopProjectsCard',
  'WorkshopPurposeCard',
  'LatestMovementsCard',
  'WorkshopCard',
  'AttentionSection',
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
  // Owner 2026-11-10 («قلل المسافات شوي»): gap-3.
  assert.match(screen, /const ROW = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'/)
  assert.equal(screen.match(/<div className=\{ROW\}>/g).length, 3)
  // The projects chart alone across the width, under the in-place panels.
  assert.match(screen, /const FULL_ROW = 'grid gap-3'/)
  assert.match(
    screen,
    /<div className=\{FULL_ROW\}>\s*<TopProjectsCard canOpenLogs=\{canOpenLogs\} \/>/,
  )
  assert.ok(
    screen.indexOf('<div className={FULL_ROW}>') >
      screen.indexOf("panelBox(\n          'afaqy'"),
  )
  const projects = component('TopProjectsCard')
  assert.match(projects, /title="homeV2TopProjects"/)
  assert.match(loadLib('adminHomeV2').TOP_PROJECTS_LIMIT + '', /^12$/)
  // The KPI strip two per row on a phone.
  assert.match(
    component('KpiStrip'),
    /className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"/,
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
    'links.equipment ? ownerEquipmentHref(STRIP_OWNER) : null',
    'links.logs ? insideProjectsLogHref(STRIP_OWNER) : null',
    "links.logs ? workshopStateLogHref('maintenance', STRIP_OWNERS) : null",
    "links.logs ? workshopStateLogHref('parking', STRIP_OWNERS) : null",
    'links.equipment ? availableEquipmentHref(STRIP_OWNERS) : null',
    'links.logs ? movementLogHref() : null',
    'links.logs ? workshopStateLogHref(null, STRIP_OWNERS) : null',
  ])
    assert.ok(kpi.includes(call), call)
  assert.match(
    kpi,
    /links\.logs\s*\?\s*workshopStateLogHref\('out_of_service', STRIP_OWNERS\)\s*:\s*null/,
  )
  assert.doesNotMatch(screen, /purchasingUnits/)
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
  // Without owners the link carries no owner filter.
  assert.equal(
    param(attention.outOfServiceLongHref('2026-10-10'), 'vfilters').length,
    3,
  )
})

// Owner 2026-11-10: «خلي الارقام الي فوق تخص العزاني فقط … وشيل بدون PO من
// فوق».
test('the KPI strip counts Al-Azani only, from the snapshot, without «بدون PO»', () => {
  const kpi = component('KpiStrip')
  assert.match(kpi, /const STRIP_OWNER: AdminHomeOwner = 'alazani'/)
  assert.match(kpi, /data\.count\(STRIP_OWNER, state\)/)
  assert.doesNotMatch(kpi, /ownerTotals/)
  // The entries of Al-Azani, through the chart's function.
  assert.match(
    kpi,
    /fetchEntriesSeries\(\s*from,\s*today,\s*STRIP_OWNERS,\s*null,\s*signal,?\s*\)/,
  )
  assert.doesNotMatch(kpi, /fetchEntriesSeriesAllOwners/)
  // No «بدون PO» tile and no purchasing read; «غير مصنفة» for everyone.
  assert.doesNotMatch(kpi, /purchasing_site_units|noPo|no_po|canPurchasing/)
  assert.doesNotMatch(kpi, /\.from\(|supabase/)
  assert.match(kpi, /'unclassified',\s*'equipmentStateUnclassified'/)
  assert.match(kpi, /chip: t\('homeV2AlazaniOnly'\)/)
  assert.match(kpi, /'h-full rounded-2xl p-3'/)
  const data = read('src', 'lib', 'adminHomeData.ts')
  assert.doesNotMatch(
    data,
    /fetchEntriesSeriesAllOwners|fetchSupplierSiteCounts/,
  )
})

test('the attention gates: purchasing and sales items only for their readers', () => {
  const attention = component('AttentionSection')
  assert.match(attention, /permissions\.can\('purchasing\.view'\)/)
  assert.match(attention, /permissions\.can\('sales\.view'\)/)
  assert.doesNotMatch(attention, /loadAfaqyStats|canViewEquipmentLocation/)
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
    'TopProjectsCard',
    'WorkshopPurposeCard',
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

// Owner 2026-11-10: «بالنسبة للاسطول يكون فيه تابين، اول تاب اجمالي الاسطول
// حسب الملاك، والثاني داخل المشاريع حسب الملاك برضه، وثاني جدول الورشة،
// وثالث جدول المتاحة».
// Then «حالة الاسطول خليه دونات»: each tab a donut of the five owners whose
// legend names link to that owner's rows.
test('the fleet card: four owner tabs over the snapshot, each a donut', () => {
  const card = component('FleetStateCard')
  const tabs = [...card.matchAll(/\{ id: '(\w+)', label: '\w+'/g)].map(
    (match) => match[1],
  )
  // Then «خليها "الاسطول" وشيل منه تاب الورشة والمتاحة»: two tabs.
  assert.deepEqual(tabs, ['fleet', 'projects'])
  assert.doesNotMatch(
    card,
    /OwnerFilter|fetchAllOwnersStateMatrix|<table|openWorkshopVisitsHref|availableEquipmentHref/,
  )
  assert.match(card, /ownerTotals\(data, item\.states\)/)
  assert.match(card, /\? ownerEquipmentHref\(owner\)\s*: undefined/)
  assert.match(card, /\? insideProjectsLogHref\(owner\)\s*: undefined/)
  const ar = read('src', 'i18n', 'translations.ts')
  assert.match(ar, /homeV2FleetStatus: 'الاسطول',/)
  assert.match(ar, /homeV2TabFleetTotal: 'الاجمالي',/)
  assert.match(card, /href: hrefOf\(row\.owner\),/)
  assert.match(card, /<SoftDonut[\s\S]*legend="side"[\s\S]*slices=\{slices\}/)
  assert.match(card, /skeleton=\{<DonutSkeleton tabs legendRows=\{5\} \/>\}/)
  const donut = read('src', 'components', 'charts', 'SoftDonut.tsx')
  // «فيه مساحة فاضية تحت الدونات»: the donut fills the stretched card.
  assert.match(card, /bodyClassName="flex flex-col"/)
  assert.match(card, /legend="side"\s*fill\s*slices=\{slices\}/)
  assert.match(donut, /fill && 'min-h-0 flex-1'/)
  assert.match(donut, /style=\{fill \? \{ minHeight: height \} : \{ height \}\}/)
  // The shared donut's legend renders a slice's `href` as a real link.
  assert.match(donut, /slice\.href \? \(\s*<AppLink\s+href=\{slice\.href\}/)
  assert.match(
    read('src', 'components', 'charts', 'FleetDonut.tsx'),
    /href\?: string/,
  )
})

// Owner 2026-11-10: «وبداله خليه جدول المتاحة» — the latest available units
// for the owner filter (the fleet tables' four owners, Al-Azani by default).
test('the available card: the latest available units of the chosen owners', () => {
  const card = component('AvailableCard')
  assert.match(card, /useState<AdminHomeOwner\[\]>\(\['alazani'\]\)/)
  assert.match(card, /options=\{FLEET_FILTER_OWNERS\}/)
  assert.match(card, /state: 'available',\s*owners,/)
  assert.match(card, /pageSize: ROWS,/)
  assert.match(card, /const ROWS = 6/)
  assert.match(card, /title="homeV2AvailableNow"/)
  assert.match(
    card,
    /href=\{canOpenEquipment \? availableEquipmentHref\(owners\) : null\}/,
  )
  assert.match(card, /rowHref=\{\(row\) => `\/equipment\/\$\{row\.id\}`\}/)
  assert.match(card, /empty=\{t\('adminHomeFleetAvailableEmpty'\)\}/)
  // «صغر الخط واضف تفاصيل اكثر، مثل اخر شركة ومشروع، اخر فورمين»: 12 px
  // cells, the last company and project (or «الورشة»), the foreman of the
  // last site exit from one bounded recorder lookup, the exit purpose.
  assert.match(card, /cellTextClassName="text-xs"/)
  assert.match(card, /header: t\('adminHomeColLastSite'\)/)
  assert.match(card, /t\('adminHomeLastSiteWorkshop'\)/)
  assert.match(card, /header: t\('adminHomeColForeman'\)/)
  assert.match(card, /row\.lastMovementType === 'exit'/)
  assert.match(card, /fetchMovementRecorderNames\(ids, signal\)/)
  assert.match(card, /<ExitPurposeBadge purpose=\{row\.exitPurpose\} \/>/)
  // «اضف عدد للمتاحة»: the owners' total beside the title.
  assert.match(card, /count=\{data\?\.total \?\? null\}/)
  const block = component('HomeBlock')
  assert.match(block, /count\?: number \| null/)
  assert.match(block, /<CountUp value=\{count\} \/>/)
  assert.match(
    screen,
    /<AvailableCard\s+canOpenEquipment=\{canOpenEquipment\}\s+onSelectEquipment=\{onSelectEquipment\}\s*\/>/,
  )
})

// Owner 2026-11-10: «جدول الورشة تحت شيل الموردين، وخلي التابات حسب التصنيف».
test('the workshop card: tabs by purpose, no suppliers', () => {
  assert.ok(
    !fs.existsSync(
      path.join(
        ROOT,
        'src',
        'components',
        'admin-home',
        'WorkshopSuppliersCard.tsx',
      ),
    ),
  )
  const card = component('WorkshopCard')
  const tabs = [
    ...card.matchAll(/id: '(\w+)',\s*label: '\w+',\s*state: '(\w+)'/g),
  ]
  assert.deepEqual(
    tabs.map((match) => match[1]),
    ['maintenance', 'parking', 'out_of_service', 'unclassified'],
  )
  assert.deepEqual(
    tabs.map((match) => match[2]),
    [
      'workshop_maintenance',
      'workshop_parking',
      'workshop_out_of_service',
      'workshop_unclassified',
    ],
  )
  assert.match(card, /useState<WorkshopTab>\('maintenance'\)/)
  assert.match(card, /purpose: current,/)
  assert.match(card, /if \(loaded\) return/)
  // Owner 2026-11-10, «اضف في جدول الورشة فلتر المالك وافتراضي على
  // العزاني»: the four fleet owners, Al-Azani by default; the tab counts
  // follow the chosen owners and a new choice reads the tabs again.
  assert.match(card, /useState<AdminHomeOwner\[\]>\(\['alazani'\]\)/)
  assert.match(card, /options=\{FLEET_FILTER_OWNERS\}/)
  assert.match(
    card,
    /const countedOwners = owners\.length \? owners : FLEET_FILTER_OWNERS/,
  )
  assert.match(card, /countedOwners\.reduce/)
  assert.match(card, /purpose: current,\s*owners,/)
  assert.match(card, /setOwners\(value\)\s*setPages\(\{\}\)\s*setFailed\(\{\}\)/)
  assert.match(card, /title="homeV2WorkshopNow"/)
  assert.match(card, /<ViewAllAction onClick=\{onShowFleetTables\} \/>/)
  assert.doesNotMatch(card, /fetchSupplierSiteCounts|homeV2TabSuppliers/)
  // The tabs send values the fleet tables' purpose filter accepts.
  const stats = loadLib('adminHomeStats')
  for (const purpose of [
    'maintenance',
    'parking',
    'out_of_service',
    'unclassified',
  ])
    assert.ok(stats.WORKSHOP_PURPOSE_FILTERS.includes(purpose), purpose)
})

test('tighter spacing (owner 2026-11-10, «قلل المسافات شوي»)', () => {
  assert.match(screen, /className="-mt-1 space-y-3 sm:-mt-2 lg:-mt-4"/)
  const block = component('HomeBlock')
  assert.match(block, /rounded-2xl p-3"/)
  assert.match(block, /"mb-1\.5 flex items-start justify-between gap-2"/)
  for (const name of ['WorkshopCard', 'LatestMovementsCard'])
    assert.match(component(name), /cellClassName="py-1\.5"/, name)
})
