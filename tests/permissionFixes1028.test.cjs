// 2026-10-28 review: the client follows the permission keys for custom roles
// (exports, the `companies` read scope, classification outside the workshop
// home, the workshop form on the workshop home, the equipment report gate,
// the Settings hub cards, hidden landings, links into pages the shell does
// not open, the inquiry card). Nothing changes for the six original roles
// with the legacy mapping: tests/wave23Nav, wave23Shell and wave24Actions keep
// proving that.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

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
      require(request) {
        throw new Error(`Unexpected runtime import: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const nav = loadLib('navPermissions')
const homeScope = loadLib('homeScope')
const ready = (entries) => ({ status: 'ready', permissions: new Map(entries) })
const sorted = (set) => [...set].sort()

// --- 1. The Excel exports follow movements.export ----------------------------

test('1: every movement Excel export button needs movements.export', () => {
  const files = [
    ['src', 'screens', 'admin-home', 'LogsScreen.tsx'],
    ['src', 'components', 'visits', 'VisitsTable.tsx'],
    ['src', 'components', 'admin-home', 'FleetMiniTables.tsx'],
  ]
  for (const parts of files) {
    const source = read(...parts)
    assert.match(
      source,
      /const canExport = (?:usePermissions\(\)|permissions)\.can\('movements\.export'\)/,
      parts.join('/'),
    )
    assert.match(source, /\{canExport && \(\s*<Button/, parts.join('/'))
  }
})

// --- 2. movements.read scope `companies` -------------------------------------

test('2: the companies read scope opens the log and the embedded foreman log', () => {
  const entries = [
    ['home.foreman', 'own'],
    ['movements.read', 'companies'],
  ]
  assert.equal(
    homeScope.homeMovementsScopeFromPermissions(new Map(entries)),
    'site_all',
  )
  assert.equal(nav.planShell(ready(entries)).homeScope, 'site_all')
  // Without a home: the admin shell, landing on the log.
  const plan = nav.planShell(ready([['movements.read', 'companies']]))
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'logs')
  assert.ok(plan.pages.has('logs'))
  // `own` still opens nothing.
  assert.equal(nav.planShell(ready([['movements.read', 'own']])).kind, 'none')
})

// --- 3. The workshop home keeps its list (not changed, see the report) -------

test('3: the original workshop role keeps the workshop-only home', () => {
  // The legacy `workshop` role holds home.workshop 'workshop' WITH
  // movements.read 'all', so movements.read cannot widen that home without
  // changing it; the rule stays home.workshop's own scope.
  const entries = [
    ['home.workshop', 'workshop'],
    ['movements.read', 'all'],
  ]
  assert.equal(
    homeScope.homeMovementsScopeFromPermissions(new Map(entries)),
    'workshop',
  )
  assert.equal(nav.planShell(ready(entries)).homeScope, 'workshop')
})

// --- 4. Classification wherever the key is held ------------------------------

test('4: the classify key classifies on the foreman log and on /logs', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx')
  assert.match(
    home,
    /const logClassify = holdsClassify && \(workshopMode \|\| embeddedLog\)/,
  )
  assert.match(home, /classify=\{logClassify \? classify : undefined\}/)
  // The workshop homes keep the pending card and its error; a foreman log
  // shows a failed classification itself.
  assert.match(home, /const canClassify = workshopMode && holdsClassify/)
  assert.match(home, /error: workshopMode \? null : classifyError/)

  const app = read('src', 'App.tsx')
  assert.match(
    app,
    /selfClassify=\{\s*permissions\.has\('movements\.workshop\.classify'\) &&\s*!permissions\.has\('home\.admin'\)\s*\}/,
  )
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.match(logs, /const classify = classifyProp \?\? ownClassify/)
  assert.match(logs, /supabase\.rpc\(\s*'classify_workshop_entry'/)
  assert.match(logs, /const refreshToken = refreshTokenProp \+ ownRefresh/)
  assert.match(logs, /\{classify\?\.error && \(/)
})

// --- 5. The workshop home records workshop movements -------------------------

test('5: the workshop home asks for the workshop form', () => {
  const app = read('src', 'App.tsx')
  // 2026-10-28: one shell tree for every kind (the sidebar for every user);
  // the form is forced on the workshop shell only, never on the admin or
  // foreman shell.
  const shell = app.slice(
    app.indexOf(
      "const shellKind: 'admin' | 'foreman' | 'workshop' = shell.kind",
    ),
  )
  assert.match(
    shell,
    /workshopForm=\{\s*shellKind === 'workshop' &&\s*permissions\.has\('movements\.workshop\.create'\)\s*\}/,
  )
  assert.equal(app.match(/workshopForm=/g).length, 1)

  const create = read('src', 'screens', 'MovementCreate.tsx')
  assert.match(create, /forceWorkshopForm=\{workshopForm\}/)
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(
    form,
    /const forcedWorkshopForm =\s+forceWorkshopForm && permissionState\.can\('movements\.workshop\.create'\)/,
  )
  assert.match(
    form,
    /const workshopMode = forcedWorkshopForm \|\| formActions\.workshopMode/,
  )
})

// --- 6. The equipment report needs movements.read all ------------------------

test('6: /reports/equipment needs reports.view all AND movements.read all', () => {
  const only = ready([['reports.view', 'all']])
  assert.ok(!nav.planShell(only).pages.has('reports/equipment'))
  assert.equal(nav.planShell(only).landing, 'reports/entries')
  const both = ready([
    ['reports.view', 'all'],
    ['movements.read', 'all'],
  ])
  assert.ok(nav.planShell(both).pages.has('reports/equipment'))
  assert.ok(
    !nav
      .planShell(
        ready([
          ['reports.view', 'all'],
          ['movements.read', 'site'],
        ]),
      )
      .pages.has('reports/equipment'),
  )
})

// --- 7. The Settings hub cards follow their pages' gates ---------------------

test('7: each Settings card is shown only when its page opens', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(
    settings,
    /const opens = \(page: RoutePage\) =>\s+permissionStatus === 'ready' && canOpenPage\(permissions, page\)/,
  )
  for (const [page, href] of [
    ['settings/equipment-types', '/settings/equipment-types'],
    ['settings/afaqy', '/settings/afaqy'],
    ['settings/roles', '/settings/roles'],
  ]) {
    const at = settings.indexOf(`{opens('${page}') && (`)
    assert.ok(at > 0, page)
    assert.ok(
      settings.indexOf(`router.push('${href}')`, at) > at,
      `${page} card opens ${href}`,
    )
  }
  assert.match(settings, /const canSeeActivity = opens\('activity'\)/)
  // The gates themselves: one key each.
  const one = (key) => ready([[key, 'all']])
  assert.ok(
    nav.canOpenPage(
      one('settings.equipment_types').permissions,
      'settings/equipment-types',
    ),
  )
  assert.ok(
    !nav.canOpenPage(
      one('settings.equipment_types').permissions,
      'settings/afaqy',
    ),
  )
  assert.ok(
    !nav.canOpenPage(
      one('settings.equipment_types').permissions,
      'settings/roles',
    ),
  )
})

// --- 8. Hidden entries as the last landing ------------------------------------

test('8: a role whose only pages are hidden entries lands on them', () => {
  const activity = nav.planShell(ready([['movements.activity', 'all']]))
  assert.equal(activity.kind, 'admin')
  assert.equal(activity.landing, 'activity')
  const imports = nav.planShell(ready([['movements.import', 'all']]))
  assert.equal(imports.kind, 'admin')
  assert.equal(imports.landing, 'movement-import')
  assert.ok(imports.pages.has('settings/workshop-opening-balance'))
  // A visible section still comes first.
  const both = nav.planShell(
    ready([
      ['movements.activity', 'all'],
      ['equipment.read', 'all'],
    ]),
  )
  assert.equal(both.landing, 'equipment')
  // The hidden entries stay out of the sidebar.
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        nav.visibleNavItems(
          ready([['movements.activity', 'all']]),
          activity.pages,
        ),
      ),
    ),
    [],
  )
  // The identity-extraction page alone: its own route.
  const extracting = nav.planShell(ready([['extracting.view', 'all']]))
  assert.equal(extracting.kind, 'admin')
  assert.equal(extracting.externalLanding, '/extracting')
  assert.deepEqual(sorted(extracting.pages), [])
  // Nothing at all: still the no-permissions page.
  assert.equal(nav.planShell(ready([])).kind, 'none')
})

// --- 9. Links only into pages the shell opens --------------------------------

test('9: links into other pages follow the shell', () => {
  const app = read('src', 'App.tsx')
  assert.match(
    app,
    /onViewAllMovements=\{\s*shell\.pages\.has\('logs'\)\s*\? \(code\) =>/,
  )
  const report = read('src', 'screens', 'EquipmentReports.tsx')
  assert.match(
    report,
    /planShell\(\{ status, permissions \}\)\.pages\.has\('equipment\/:id'\)/,
  )
  assert.match(report, /canOpenEquipment\s*\? \(\) => router\.push/)
  assert.match(report, /\{onOpen && \(/)
  const driver = read('src', 'screens', 'drivers', 'DriverDetailDialog.tsx')
  assert.match(driver, /const canOpenLogs = shellPages\.has\('logs'\)/)
  assert.match(
    driver,
    /const canOpenEquipment = shellPages\.has\('equipment\/:id'\)/,
  )
  assert.match(driver, /canOpenLogs \? \(\s*<Button/)
  assert.match(driver, /onRowClick=\{\s*canOpenEquipment\s*\?/)
  const inquiry = read(
    'src',
    'screens',
    'inquiry',
    'EquipmentInquiryScreen.tsx',
  )
  assert.match(inquiry, /shellPages\.has\('equipment\/:id'\)/)
  assert.match(inquiry, /shellPages\.has\('purchasing\/:id'\)/)
  // 2026-10-28 (the sidebar for every user): a field shell opens both pages
  // with their keys, and neither without them.
  const field = nav.planShell(
    ready([
      ['home.foreman', 'own'],
      ['equipment.read', 'all'],
      ['purchasing.view', 'all'],
    ]),
  )
  assert.ok(field.pages.has('equipment/:id'))
  assert.ok(field.pages.has('purchasing/:id'))
  const bare = nav.planShell(ready([['home.foreman', 'own']]))
  assert.ok(!bare.pages.has('equipment/:id'))
  assert.ok(!bare.pages.has('purchasing/:id'))
})

// --- 10. The inquiry card follows inquiry.view --------------------------------

test('10: the inquiry card needs inquiry.view', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx')
  assert.match(
    home,
    /const canInquire = permissionState\.can\('inquiry\.view'\)/,
  )
  assert.match(home, /\{canInquire && <InquiryCard \/>\}/)
  // The plain foreman home stays without it (owner 2026-09-22); a foreman
  // home with the embedded log shows it.
  assert.match(home, /\{embeddedLog && canInquire && <InquiryCard \/>\}/)
  assert.equal((home.match(/<InquiryCard \/>/g) ?? []).length, 2)
})
