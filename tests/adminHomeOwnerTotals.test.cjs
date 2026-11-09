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

test('the owners read every owner and link to the filtered lists', () => {
  const data = read('src', 'lib', 'adminHomeData.ts')
  assert.match(
    data,
    /fetchAllOwnersStateMatrix[\s\S]*?rpc\('get_admin_owner_state_matrix', \{\s*p_owners: owners\.length \? \[\.\.\.owners\] : null,?\s*\}\)/,
  )
  // Home v2 (owner 2026-11-09): the owner boxes of 2026-10-29 live on as the
  // «الملاك» tab of «حالة الاسطول», every owner's fleet and units on
  // projects with the same links.
  const card = read('src', 'components', 'admin-home', 'FleetStateCard.tsx')
  assert.match(card, /ownerTotals\(matrix\.data, FLEET_STATES\)/)
  assert.match(card, /ownerTotals\(matrix\.data, \['inside_site'\]\)/)
  assert.match(
    card,
    /canOpenEquipment \? ownerEquipmentHref\(row\.owner\) : null/,
  )
  assert.match(
    card,
    /canOpenLogs \? insideProjectsLogHref\(row\.owner\) : null/,
  )
  assert.match(card, /t\(ownershipBadge\(row\.owner\)\.key\)/)
  assert.match(card, /<CountUp value=\{value\} \/>/)
  const links = loadLib('adminHomeLinks')
  const filtersOf = (href, key) =>
    JSON.parse(new URL(href, 'http://x').searchParams.get(key))
  assert.deepEqual(filtersOf(links.ownerEquipmentHref('takween'), 'filters'), [
    {
      id: 'owner',
      field: 'ownership_status',
      operator: 'eq',
      value: 'takween',
    },
    { id: 'status', field: 'status', operator: 'eq', value: 'active' },
  ])
  assert.deepEqual(
    filtersOf(
      links.insideProjectsLogHref('external_supplier', null),
      'vfilters',
    ),
    [
      { id: 'open', field: 'is_open', operator: 'eq', value: 'true' },
      {
        id: 'owner',
        field: 'equipment_ownership_status',
        operator: 'eq',
        value: 'external_supplier',
      },
      {
        id: 'supplier',
        field: 'equipment_lessor_id',
        operator: 'in',
        value: '__empty__',
      },
    ],
  )
  assert.match(
    read('src', 'App.tsx'),
    /const canOpenLogs = shell\.pages\.has\('logs'\)/,
  )
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  // Owner 2026-11-08: no date under the greeting any more («شيل التاريخ تحت
  // مساء الخير», the header shows it), a smaller greeting («صغّر خط
  // التحية») and less room above it («قلل المسافة الي فوق»).
  assert.doesNotMatch(screen, /saudiDayLabel/)
  assert.match(screen, /'adminHomeGreetingMorning'/)
  // Owner 2026-10-29: the greeting bold.
  assert.match(
    screen,
    /className="text-\[22px\] font-bold leading-tight sm:text-\[24px\]"/,
  )
  assert.match(screen, /className="-mt-1 space-y-4 sm:-mt-2 lg:-mt-4"/)
  // ONE snapshot over every owner feeds the KPI strip and the fleet card.
  assert.match(screen, /fetchAllOwnersStateMatrix\(signal\)/)
  assert.match(screen, /<KpiStrip\s+matrix=\{matrix\}/)
  assert.match(screen, /<FleetStateCard\s+matrix=\{matrix\}/)
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

test('the suppliers parse, load on their own and link to the log', () => {
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
  assert.match(
    read('src', 'lib', 'adminHomeData.ts'),
    /rpc\('get_admin_supplier_site_counts'\)/,
  )
  // Home v2 (owner 2026-11-09): the suppliers are the second tab of the
  // workshop block, each a link to the log's open visits of that supplier.
  const card = read(
    'src',
    'components',
    'admin-home',
    'WorkshopSuppliersCard.tsx',
  )
  assert.match(card, /fetchSupplierSiteCounts\(signal\)/)
  assert.match(card, /insideProjectsLogHref\('external_supplier', row\.id\)/)
  assert.match(card, /canOpenLogs \?/)
  assert.match(card, /<CountUp value=\{row\.count\} \/>/)
  assert.match(card, /t\('adminHomeSupplierSitesNone'\)/)
  // The workshop tab opens its open workshop entry (owner 2026-10-29).
  assert.match(card, /onSelectMovement\(row\.lastMovementId\)/)
})

// Owner 2026-10-29 «حالات المتبقي», kept by the home v2 workshop block.
test('the workshop block keeps the remaining-states filter and export', () => {
  const card = read(
    'src',
    'components',
    'admin-home',
    'WorkshopPurposeCard.tsx',
  )
  // Its own owner filter over all five, Al-Azani by default.
  assert.match(card, /useState<AdminHomeOwner\[\]>\(\['alazani'\]\)/)
  assert.match(card, /<OwnerFilter\s/)
  assert.match(card, /fetchAllOwnersStateMatrix\(signal, owners\)/)
  // The Excel export of the units outside a project, for those owners.
  assert.match(card, /restUnitExcelColumns\(/)
  assert.match(card, /fetchRestUnitsPage\(owners, page, size/)
  assert.match(card, /fileName: 'remaining-by-state'/)
  // The links carry the chosen owners.
  assert.match(card, /openWorkshopVisitsHref\(owners\)/)
  assert.match(card, /availableEquipmentHref\(owners\)/)
  assert.match(card, /outOfServiceLongHref\(cutoff, owners\)/)
  for (const state of [
    'workshop_maintenance',
    'workshop_parking',
    'workshop_out_of_service',
    'workshop_unclassified',
  ])
    assert.match(card, new RegExp(`state: '${state}'`))
  // Owner 2026-10-29: «بالنسبة للارقام الاحصائية خليها counter».
  assert.match(card, /<CountUp value=\{value\} \/>/)
  const counter = read('src', 'components', 'admin-home', 'CountUp.tsx')
  assert.match(counter, /prefers-reduced-motion: reduce/)
  assert.match(counter, /<span className="sr-only">\{value\}<\/span>/)
  assert.match(counter, /const from = shownRef\.current/)
  // The workshop / available links of the chosen owners.
  const links = loadLib('adminHomeLinks')
  const filters = (href) =>
    JSON.parse(new URL(href, 'http://x').searchParams.get('vfilters'))
  assert.deepEqual(filters(links.workshopStateLogHref(null, ['alazani']))[1], {
    id: 'purpose',
    field: 'workshop_purpose',
    operator: 'is_not_set',
    value: '',
  })
  assert.deepEqual(
    filters(links.openWorkshopVisitsHref(['alazani', 'takween']))[1],
    {
      id: 'owner',
      field: 'equipment_ownership_status',
      operator: 'in',
      value: 'alazani,takween',
    },
  )
  assert.equal(filters(links.openWorkshopVisitsHref()).length, 1)
})
