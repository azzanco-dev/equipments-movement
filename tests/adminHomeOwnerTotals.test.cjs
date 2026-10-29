const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-29: «حلو التاريخ والتصبيحة، اعتمدها في الرئيسية، واضف مربعين
// الاسطول وفي المشاريع للرئيسية» (from the /ui-kit home mockup).

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

test('the greeting and the day follow Saudi time', () => {
  const greeting = loadLib('homeGreeting')
  // 06:30 UTC = 09:30 Riyadh; 09:00 UTC = 12:00; 21:30 UTC = 00:30 next day.
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-29T06:30:00Z')),
    'morning',
  )
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-29T09:00:00Z')),
    'evening',
  )
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-28T21:30:00Z')),
    'morning',
  )
  assert.equal(
    greeting.saudiDayLabel(new Date('2026-10-29T06:30:00Z'), 'ar'),
    'الخميس 29 اكتوبر 2026',
  )
  assert.equal(
    greeting.saudiDayLabel(new Date('2026-10-29T06:30:00Z'), 'en'),
    'Thursday 29 October 2026',
  )
  // The Saudi day, not the UTC one: 22:00 UTC on the 28th is the 29th.
  assert.match(
    greeting.saudiDayLabel(new Date('2026-10-28T22:00:00Z'), 'ar'),
    / 29 /,
  )
  assert.doesNotMatch(
    greeting.saudiDayLabel(new Date('2026-04-15T06:00:00Z'), 'ar'),
    /[أإآ]/,
  )
})

test('ownerTotals covers all five owners and adds up', () => {
  const stats = loadLib('adminHomeStats')
  const matrix = stats.parseOwnerStateMatrix({
    total: 10,
    cells: [
      { owner: 'alazani', state: 'inside_site', count: 4 },
      { owner: 'alazani', state: 'available', count: 2 },
      { owner: 'takween', state: 'inside_site', count: 1 },
      { owner: 'external_supplier', state: 'workshop_parking', count: 3 },
    ],
  })
  const fleet = stats.ownerTotals(matrix, stats.FLEET_STATES)
  assert.equal(fleet.total, 10)
  assert.deepEqual(
    [...fleet.owners.map((row) => `${row.owner}:${row.count}`)],
    [
      'alazani:6',
      'takween:1',
      'third_party_f:0',
      'third_party_partnership_b:0',
      'external_supplier:3',
    ],
  )
  const sites = stats.ownerTotals(matrix, ['inside_site'])
  assert.equal(sites.total, 5)
  assert.equal(sites.owners[0].count, 4)
})

test('the cards read every owner and link to the filtered equipment list', () => {
  const data = read('src', 'lib', 'adminHomeData.ts')
  assert.match(
    data,
    /fetchAllOwnersStateMatrix[\s\S]*?rpc\('get_admin_owner_state_matrix', \{\s*p_owners: owners\.length \? \[\.\.\.owners\] : null,?\s*\}\)/,
  )
  const section = read(
    'src',
    'components',
    'admin-home',
    'OwnerTotalsSection.tsx',
  )
  assert.match(section, /ownerTotals\(data, FLEET_STATES\)/)
  assert.match(section, /ownerTotals\(data, \['inside_site'\]\)/)
  assert.match(section, /field: 'ownership_status'/)
  assert.match(section, /canOpenEquipment\s*\?/)
  // Owner 2026-10-29: «في المشاريع» and the suppliers open the log's open
  // project visits of that owner / supplier; the fleet the equipment list.
  assert.match(
    section,
    /canOpenLogs \? \(owner\) => insideProjectsLogHref\(owner\)/,
  )
  assert.match(section, /insideProjectsLogHref\('external_supplier', row\.id\)/)
  assert.match(section, /field: 'is_open', operator: 'eq', value: 'true'/)
  assert.match(section, /field: SUPPLIER_FILTER_KEY/)
  assert.match(section, /\/logs\?vfilters=/)
  assert.match(
    read('src', 'App.tsx'),
    /const canOpenLogs = shell\.pages\.has\('logs'\)/,
  )
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.match(
    screen,
    /<OwnerTotalsSection\s+canOpenEquipment=\{Boolean\(onSelectEquipment\)\}\s+canOpenLogs=\{canOpenLogs\}\s*\/>/,
  )
  assert.ok(
    screen.indexOf('<OwnerTotalsSection') <
      screen.indexOf('<FleetStateSection'),
  )
  assert.match(screen, /description=\{saudiDayLabel\(now, lang\)\}/)
  assert.match(screen, /'adminHomeGreetingMorning'/)
  // Owner 2026-10-29: the greeting and the big numbers bold, full names.
  assert.match(screen, /className="text-\[30px\] font-bold/)
  assert.match(section, /text-3xl font-bold tabular-nums/)
  assert.match(section, /t\(ownershipBadge\(row\.owner\)\.key\)/)
})

// Owner 2026-10-29: «اضف عمود في المشاريع تبع الموردين» (migration 0161).
test('0161 counts the supplier units inside projects, read-only', () => {
  const files = fs
    .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .filter((file) => /_0161_/.test(file))
  assert.equal(files.length, 1)
  const sql = read('supabase', 'migrations', files[0])
  assert.match(sql, /FUNCTION public\.get_admin_supplier_site_counts\(\)/)
  assert.match(sql, /SECURITY INVOKER/)
  assert.match(sql, /SET search_path = public, pg_temp/)
  assert.match(sql, /has_permission\('home\.admin'\)/)
  assert.match(sql, /s\.ownership_status = 'external_supplier'/)
  assert.match(sql, /s\.state = 'inside_site'/)
  assert.match(sql, /s\.is_active\s+AND s\.status = 'active'/)
  assert.match(sql, /LIMIT 200/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_admin_supplier_site_counts\(\) FROM PUBLIC, anon;/,
  )
  const code = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(code, /\b(UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE)\b/)
})

test('the suppliers card parses, loads on its own and follows the fleet tables', () => {
  const stats = loadLib('adminHomeStats')
  const parsed = stats.parseSupplierSiteCounts({
    total: 5,
    suppliers: [
      { lessor_id: 'a', name: 'مورد', count: 4 },
      { lessor_id: null, name: null, count: 1 },
    ],
  })
  assert.equal(parsed.total, 5)
  assert.equal(parsed.suppliers[1].id, null)
  assert.equal(parsed.suppliers[1].name, null)
  assert.equal(parsed.suppliers[0].count, 4)
  const section = read(
    'src',
    'components',
    'admin-home',
    'OwnerTotalsSection.tsx',
  )
  assert.match(section, /export function SupplierSitesCard\(\{\s*canOpenLogs,?/)
  assert.match(
    section,
    /useAdminHomeSection\(load\)[\s\S]*useAdminHomeSection\(load\)/,
  )
  // Owner 2026-10-29: the home renders it after the fleet tables, which sit
  // right under the workshop states without the old state cards.
  assert.doesNotMatch(section, /<SupplierSitesCard/)
  const home = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  // Owner boxes, «حالات المتبقي», the workshop and available tables, then
  // the suppliers.
  const order = [
    '<OwnerTotalsSection',
    '<RestStatesCard',
    "tables={['workshop', 'available']}",
    '<SupplierSitesCard canOpenLogs={canOpenLogs} />',
  ].map((needle) => home.indexOf(needle))
  assert.ok(
    order.every(
      (at, index) => at > 0 && (index === 0 || at > order[index - 1]),
    ),
  )
  const fleetState = read(
    'src',
    'components',
    'admin-home',
    'FleetStateSection.tsx',
  )
  assert.match(
    fleetState,
    /showCards \? fetchFleetState\(owners, signal\) : Promise\.resolve\(null\)/,
  )
  assert.match(fleetState, /\{!showCards \? null : failed \?/)
  // Owner 2026-10-29: «كاردز صغيرة» — a row per total, the total first.
  assert.match(section, /function OwnerTotalsRow\(/)
  assert.match(section, /grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5/)
  // Owner 2026-10-29: «المتبقي» was the third row, then «حالات المتبقي»
  // took its place («واستبدله بقسم المتبقي فوق»): two owner rows remain.
  assert.equal(section.match(/<OwnerTotalsRow/g).length, 2)
  assert.doesNotMatch(section, /adminHomeOwnerRestTitle|restEquipmentHref/)
  // Owner 2026-10-29: «وشيل كروت الصيانة الي تحت المتبقي», then back as
  // their own box at the page's end («حالات المتبقي», `RestStatesCard`).
  assert.doesNotMatch(section, /extra=/)
  assert.match(section, /export function RestStatesCard\(/)
  for (const state of [
    'workshop_maintenance',
    'workshop_parking',
    'workshop_out_of_service',
    'workshop_unclassified',
    'available',
  ])
    assert.match(section, new RegExp(`state: '${state}'`))
  // The state links carry the box's chosen owners (owner 2026-10-29).
  assert.match(section, /workshopStateLogHref\(item\.purpose, owners\)/)
  assert.match(section, /availableEquipmentHref\(owners\)/)
  // Its own owner filter over all five, Al-Azani by default, and the
  // Excel export of its units.
  assert.match(section, /useState<AdminHomeOwner\[\]>\(\['alazani'\]\)/)
  assert.match(section, /<OwnerFilter\s/)
  // Owner 2026-10-29: «بالنسبة للارقام الاحصائية خليها counter».
  for (const value of [
    'total',
    'row.count',
    'data.total',
    'rest.total',
    'count',
  ])
    assert.match(
      section,
      new RegExp(`<CountUp value=\{${value.replace('.', '\.')}\} \/>`),
      value,
    )
  const counter = read('src', 'components', 'admin-home', 'CountUp.tsx')
  assert.match(counter, /prefers-reduced-motion: reduce/)
  assert.match(counter, /<span className="sr-only">\{value\}<\/span>/)
  assert.match(counter, /const from = shownRef\.current/)
  assert.match(section, /fetchAllOwnersStateMatrix\(signal, owners\)/)
  assert.match(section, /restUnitExcelColumns\(/)
  assert.match(section, /fetchRestUnitsPage\(owners, page, size/)
  assert.match(section, /<\/ul>\s*<\/section>\s*<\/Card>/)
  // Light owner tints with the charts' readable text («بالوان فاتحة»).
  assert.match(
    section,
    /color-mix\(in srgb, \$\{OWNER_STROKE\[row\.owner\]\} 18%, var\(--bg\)\)/,
  )
  assert.match(section, /color: 'var\(--chart-text\)'/)
  assert.doesNotMatch(section, /#[0-9a-fA-F]{3,6}/)
  // The title and hint, then the total under both; more room between the
  // sections.
  assert.match(
    section,
    /\{title\}<\/span>\s*<span className="block text-xs text-muted">\{hint\}<\/span>\s*<span className="mt-1 block text-3xl font-bold tabular-nums">\s*<CountUp value=\{total\} \/>/,
  )
  // The icon first in the total row, on the texts' right.
  assert.match(
    section,
    /items-start gap-3 rounded-xl bg-surface p-3">\s*<span\s+aria-hidden="true"[^>]*>\s*\{icon\}/,
  )
  assert.match(section, /<div className="space-y-4">\s*<OwnerTotalsRow/)
  assert.match(
    read('src', 'lib', 'adminHomeData.ts'),
    /rpc\('get_admin_supplier_site_counts'\)/,
  )
})
