// wave 23 (routing by permissions, step 2) — the shell / home a signed-in user
// gets and the pages that render in it follow the permissions
// (src/lib/navPermissions.ts: planShell, pageGate, routePageOf), not
// profiles.role.
//
// With the roles system OFF, current_permissions() answers from the frozen
// legacy_role_permissions(profiles.role) mapping, so for each of the six roles
// the shell and every rendered screen must be IDENTICAL to the role-based
// router of src/App.tsx at 8f17f53 (transcribed below as `before`). While the
// permissions load or after a failed load the role-based router is kept.
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

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const sorted = (set) => [...set].sort()

const nav = loadLib('navPermissions')
const homeScope = loadLib('homeScope')

// --- The frozen legacy mapping (latest body, 0126 recreated by 0128) ----------

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const migrationTexts = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => read('supabase', 'migrations', name))

function legacyMapping() {
  let body = null
  for (const sql of migrationTexts) {
    const re =
      /CREATE OR REPLACE FUNCTION public\.legacy_role_permissions\(p_role text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g
    for (const match of sql.matchAll(re)) body = match[1]
  }
  assert.ok(body, 'legacy_role_permissions is defined')
  const mapping = new Map()
  for (const [, role, key, , scope] of body.matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  )) {
    if (!mapping.has(role)) mapping.set(role, new Map())
    mapping.get(role).set(key, scope ?? 'all')
  }
  return mapping
}

function catalogueKeys() {
  const keys = new Set()
  for (const sql of migrationTexts)
    for (const insert of sql.matchAll(
      /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?);\n/g,
    ))
      for (const row of insert[1].matchAll(/^\s*\('([\w.]+)', '(\w+)',/gm))
        keys.add(row[1])
  return keys
}

const LEGACY = legacyMapping()
const ROLES = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]
const ready = (entries) => ({
  status: 'ready',
  permissions: entries instanceof Map ? entries : new Map(entries),
})
const LOADING = { status: 'loading', permissions: new Map() }
const FAILED = { status: 'error', permissions: new Map() }

// --- The router of src/App.tsx at 8f17f53, transcribed ------------------------

const ADMIN_PAGES_8F17F53 = new Set([
  'dashboard',
  'logs',
  'inquiry',
  'equipment',
  'projects',
  'companies',
  'lessors',
  'drivers',
  'users',
  'movement-import',
  'activity',
  'settings',
  'reports',
  'reports/entries',
  'reports/entries/all',
  'reports/equipment',
  'reports/workshop',
])
const WORKER_ROLES = new Set([
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
])

/** What the 8f17f53 router rendered for `role` at `url`. */
function before(role, url) {
  const segments = url.split('/').filter(Boolean)
  const movementId = segments[0] === 'movements' ? segments[1] : null
  const isMovementCreate = segments[0] === 'movements' && segments[1] === 'new'
  const equipmentId = segments[0] === 'equipment' ? segments[1] : null
  const driverId = segments[0] === 'drivers' ? segments[1] : null
  const userId = segments[0] === 'users' ? segments[1] : null
  const page =
    segments[0] === 'reports'
      ? 'reports'
      : ADMIN_PAGES_8F17F53.has(segments[0] ?? '')
        ? segments[0]
        : 'dashboard'

  if (
    segments[0] === 'print' &&
    segments[1] === 'export' &&
    (role === 'admin' || role === 'monitor')
  )
    return { shell: 'print', screen: 'PrintExport' }

  if (role === 'monitor') {
    const monitorPage =
      page === 'logs' ? 'logs' : page === 'inquiry' ? 'inquiry' : 'dashboard'
    return {
      shell: 'admin',
      active: monitorPage,
      screen:
        movementId && movementId !== 'new'
          ? 'MovementDetail(back)'
          : monitorPage === 'logs'
            ? 'Logs'
            : monitorPage === 'inquiry'
              ? 'Inquiry'
              : 'AdminHome(-,-)',
    }
  }

  if (WORKER_ROLES.has(role))
    return {
      shell: role === 'supervisor' ? 'foreman' : 'workshop',
      active: segments[0] === 'inquiry' ? 'inquiry' : 'dashboard',
      screen: isMovementCreate
        ? 'MovementCreate(home)'
        : movementId
          ? 'MovementDetail(home)'
          : segments[0] === 'inquiry'
            ? 'Inquiry'
            : 'Home',
    }

  if (role !== 'admin') return { shell: 'unavailable' }

  let screen
  if (isMovementCreate) screen = 'MovementCreate(logs)'
  else if (movementId) screen = 'MovementDetail(back)'
  else if (equipmentId) screen = 'EquipmentDetail'
  else if (driverId) screen = 'DriverDetail'
  else if (userId) screen = 'UserDetail'
  else if (page === 'reports')
    screen =
      segments[1] === 'workshop'
        ? 'WorkshopReports'
        : segments[1] === 'equipment'
          ? 'EquipmentReports'
          : segments[1] === 'entries' && segments[2] === 'all'
            ? 'EntryReportsAll'
            : 'EntryReports'
  else if (page === 'settings')
    screen = segments[1] === 'roles' ? 'RolesSettings' : 'AdminSettings'
  else screen = ADMIN_SCREEN[page]
  return { shell: 'admin', active: page, screen }
}

const ADMIN_SCREEN = {
  dashboard: 'AdminHome(equipment,create)',
  logs: 'Logs',
  inquiry: 'Inquiry',
  equipment: 'AdminEquipment',
  projects: 'AdminProjects',
  companies: 'AdminCompanies',
  lessors: 'AdminLessors',
  drivers: 'AdminDrivers',
  users: 'AdminUsers',
  'movement-import': 'MovementImport',
  activity: 'MovementActivity',
}

// --- The new router, transcribed from src/App.tsx (checked below) ------------

const NEW_ADMIN_SCREEN = {
  'movements/new': 'MovementCreate(logs)',
  'movements/:id': 'MovementDetail(back)',
  'equipment/:id': 'EquipmentDetail',
  'drivers/:id': 'DriverDetail',
  'users/:id': 'UserDetail',
  logs: 'Logs',
  inquiry: 'Inquiry',
  equipment: 'AdminEquipment',
  projects: 'AdminProjects',
  companies: 'AdminCompanies',
  lessors: 'AdminLessors',
  drivers: 'AdminDrivers',
  users: 'AdminUsers',
  'movement-import': 'MovementImport',
  activity: 'MovementActivity',
  'reports/workshop': 'WorkshopReports',
  'reports/equipment': 'EquipmentReports',
  'reports/entries/all': 'EntryReportsAll',
  'reports/entries': 'EntryReports',
  'settings/roles': 'RolesSettings',
  settings: 'AdminSettings',
  'settings/equipment-types': 'AdminSettings',
  'settings/workshop-opening-balance': 'AdminSettings',
  'settings/afaqy': 'AdminSettings',
}

function after(state, role, url) {
  const shell = nav.planShell(state, role)
  const segments = url.split('/').filter(Boolean)
  const requested = nav.routePageOf(segments)
  const page = shell.pages.has(requested) ? requested : shell.landing
  if (shell.kind === 'pending') return { shell: 'pending' }
  if (requested === 'print/export' && shell.pages.has('print/export'))
    return { shell: 'print', screen: 'PrintExport' }
  if (shell.kind === 'unavailable') return { shell: 'unavailable' }
  if (shell.kind === 'none') return { shell: 'none' }
  // The admin shell without a dashboard replaces a URL it does not open.
  if (shell.landing !== 'dashboard' && !shell.pages.has(requested))
    return { shell: shell.kind, redirect: `/${shell.landing}` }
  if (shell.kind === 'foreman' || shell.kind === 'workshop')
    return {
      shell: shell.kind,
      active: page === 'inquiry' ? 'inquiry' : 'dashboard',
      screen:
        page === 'movements/new'
          ? 'MovementCreate(home)'
          : page === 'movements/:id'
            ? 'MovementDetail(home)'
            : page === 'inquiry'
              ? 'Inquiry'
              : 'Home',
    }
  assert.equal(shell.kind, 'admin')
  const screen =
    page === 'dashboard'
      ? `AdminHome(${shell.pages.has('equipment/:id') ? 'equipment' : '-'},${
          shell.pages.has('movements/new') ? 'create' : '-'
        })`
      : NEW_ADMIN_SCREEN[page]
  assert.ok(screen, `a screen for ${page}`)
  return { shell: 'admin', active: nav.navKeyOfPage(page), screen }
}

/** The sidebar App.tsx shows: built for the admin shell only. */
function menu(state, role) {
  const shell = nav.planShell(state, role)
  return shell.kind === 'admin'
    ? plain(nav.visibleNavItems(state, role, shell.pages))
    : []
}

const URLS = [
  '/',
  '/dashboard',
  '/dashboard/x',
  '/logs',
  '/logs/x',
  '/inquiry',
  '/inquiry/x',
  '/equipment',
  '/equipment/e1',
  '/equipment/e1/x',
  '/projects',
  '/companies',
  '/lessors',
  '/drivers',
  '/drivers/d1',
  '/users',
  '/users/u1',
  '/activity',
  '/movement-import',
  '/reports',
  '/reports/entries',
  '/reports/entries/all',
  '/reports/equipment',
  '/reports/workshop',
  '/reports/other',
  '/settings',
  '/settings/roles',
  '/settings/roles/x',
  '/settings/afaqy',
  '/settings/afaqy/x',
  '/settings/equipment-types',
  '/settings/workshop-opening-balance',
  '/settings/other',
  '/movements',
  '/movements/new',
  '/movements/m1',
  '/movements/m1/x',
  '/print',
  '/print/export',
  '/print/other',
  '/unknown',
  '/unknown/x',
]

// The only intended difference with the roles system OFF: the two workshop
// managers hold movements.export (wave 21 gave their embedded log the export
// dialog, whose PDF option opens /print/export) but the role-based router
// sent that tab to their home. The print page fetches nothing.
const KNOWN_DIFFERENCES = new Set([
  'assistant_workshop_manager /print/export',
  'workshop_manager /print/export',
])

// --- Equivalence with the roles system OFF ------------------------------------

test('the legacy mapping covers the six roles', () => {
  assert.deepEqual([...LEGACY.keys()].sort(), [...ROLES].sort())
})

for (const role of ROLES) {
  test(`roles OFF: ${role} gets today's shell and pages`, () => {
    const differences = []
    for (const url of URLS) {
      const now = after(ready(LEGACY.get(role)), role, url)
      const then = before(role, url)
      if (KNOWN_DIFFERENCES.has(`${role} ${url}`)) {
        differences.push(`${role} ${url}`)
        assert.deepEqual(then.screen, 'Home')
        assert.deepEqual(now, { shell: 'print', screen: 'PrintExport' })
        continue
      }
      assert.deepEqual(now, then, `${role} ${url}`)
    }
    for (const known of KNOWN_DIFFERENCES)
      if (known.startsWith(`${role} `)) assert.ok(differences.includes(known))
  })

  test(`loading / failed permissions: ${role} keeps the role-based router`, () => {
    for (const state of [LOADING, FAILED])
      for (const url of URLS)
        assert.deepEqual(after(state, role, url), before(role, url), url)
  })

  test(`roles OFF: ${role} gets the same home variant`, () => {
    const plan = nav.planShell(ready(LEGACY.get(role)), role)
    if (plan.kind === 'foreman' || plan.kind === 'workshop')
      assert.equal(plan.homeScope, homeScope.homeMovementsScope(role))
    else assert.equal(plan.homeScope, undefined)
    // The fallback passes nothing: HomeScreen reads the role, as before.
    assert.equal(nav.planShell(LOADING, role).homeScope, undefined)
  })

  test(`roles OFF: ${role} lands on its home`, () => {
    // The six roles hold a home.* key, so the sections rule never applies.
    for (const state of [ready(LEGACY.get(role)), LOADING, FAILED])
      assert.equal(nav.planShell(state, role).landing, 'dashboard')
  })
}

test('the role fallback table is the 8f17f53 router', () => {
  for (const role of ROLES) {
    const legacy = nav.LEGACY_SHELL_BY_ROLE[role]
    const pages = new Set(legacy.pages)
    for (const url of URLS) {
      const then = before(role, url)
      const requested = nav.routePageOf(url.split('/').filter(Boolean))
      // A page is in the table exactly when the old router rendered it
      // rather than the role's home.
      if (requested === 'dashboard') continue
      const home = before(role, '/dashboard')
      const opened = then.screen !== home.screen || then.shell !== home.shell
      assert.equal(pages.has(requested), opened, `${role} ${url}`)
    }
  }
})

// --- Custom roles and fail closed ---------------------------------------------

test('home.admin + movements.read: dashboard and logs only', () => {
  const state = ready([
    ['home.admin', 'all'],
    ['movements.read', 'all'],
  ])
  const plan = nav.planShell(state, 'purchasing')
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'dashboard')
  assert.deepEqual(sorted(plan.pages), ['dashboard', 'logs', 'movements/:id'])
  assert.deepEqual(menu(state, 'purchasing'), [
    { key: 'dashboard' },
    { key: 'logs' },
  ])
  assert.equal(after(state, 'x', '/logs').screen, 'Logs')
  assert.equal(
    after(state, 'x', '/movements/m1').screen,
    'MovementDetail(back)',
  )
  for (const url of [
    '/equipment',
    '/equipment/e1',
    '/settings',
    '/settings/roles',
    '/users/u1',
    '/movements/new',
    '/reports/workshop',
    '/inquiry',
  ])
    assert.deepEqual(after(state, 'x', url), {
      shell: 'admin',
      active: 'dashboard',
      screen: 'AdminHome(-,-)',
    })
  // The print page needs movements.export.
  assert.equal(after(state, 'x', '/print/export').screen, 'AdminHome(-,-)')
})

test('no permissions: the no-permissions page, whatever the role', () => {
  for (const role of [...ROLES, 'purchasing', '', null, undefined, 'toString'])
    for (const url of URLS)
      assert.deepEqual(after(ready([]), role, url), { shell: 'none' })
})

test('an unknown role waits while loading, is unavailable after a failure', () => {
  for (const role of ['purchasing', '', null, undefined, 'toString', 'Admin']) {
    assert.equal(nav.planShell(LOADING, role).kind, 'pending')
    assert.equal(nav.planShell(FAILED, role).kind, 'unavailable')
    assert.equal(nav.planShell(FAILED, role).pages.size, 0)
  }
})

test('precedence admin > foreman > workshop, and the home variants', () => {
  const kind = (entries) => nav.planShell(ready(entries), 'x')
  assert.equal(
    kind([
      ['home.admin', 'all'],
      ['home.foreman', 'own'],
      ['home.workshop', 'all'],
    ]).kind,
    'admin',
  )
  const foreman = kind([
    ['home.foreman', 'all'],
    ['home.workshop', 'all'],
  ])
  assert.equal(foreman.kind, 'foreman')
  for (const scope of ['own', 'companies', 'site', 'all'])
    assert.equal(kind([['home.foreman', scope]]).homeScope, 'own_site')
  assert.equal(kind([['home.workshop', 'all']]).homeScope, 'all_contexts')
  for (const scope of ['workshop', 'own', 'site', 'companies'])
    assert.equal(kind([['home.workshop', scope]]).homeScope, 'workshop')
  // A field home without the other keys: only its home renders.
  assert.deepEqual(sorted(kind([['home.workshop', 'all']]).pages), [
    'dashboard',
  ])
})

// --- The admin shell without a home (owner decision 2026-10-13) ---------------

test('the dashboard entry requires exactly home.admin', () => {
  const dashboard = nav.NAV_ENTRIES.find((entry) => entry.key === 'dashboard')
  assert.deepEqual(plain(dashboard.requires), [{ key: 'home.admin' }])
  assert.equal(dashboard.children, undefined)
  assert.equal(nav.NAV_ENTRIES[0].key, 'dashboard')
})

test('equipment.read alone: the admin shell with «المعدات» only', () => {
  const state = ready([['equipment.read', 'all']])
  const plan = nav.planShell(state, 'x')
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.source, 'permissions')
  assert.equal(plan.landing, 'equipment')
  assert.deepEqual(sorted(plan.pages), ['equipment', 'equipment/:id'])
  assert.deepEqual(menu(state, 'x'), [{ key: 'equipment' }])
  assert.deepEqual(after(state, 'x', '/equipment'), {
    shell: 'admin',
    active: 'equipment',
    screen: 'AdminEquipment',
  })
  assert.deepEqual(after(state, 'x', '/equipment/e1'), {
    shell: 'admin',
    active: 'equipment',
    screen: 'EquipmentDetail',
  })
  // Anything else, the dashboard and the print page included, is replaced
  // by the first section (the header logo links to /dashboard).
  for (const url of [
    '/',
    '/dashboard',
    '/logs',
    '/inquiry',
    '/settings',
    '/movements/m1',
    '/movements/new',
    '/print/export',
    '/unknown',
  ])
    assert.deepEqual(
      after(state, 'x', url),
      { shell: 'admin', redirect: '/equipment' },
      url,
    )
  // The admin home never renders without home.admin.
  assert.ok(!plan.pages.has('dashboard'))
})

test('movements.read scope all alone lands on the log', () => {
  const state = ready([['movements.read', 'all']])
  const plan = nav.planShell(state, 'x')
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'logs')
  assert.deepEqual(sorted(plan.pages), ['logs', 'movements/:id'])
  assert.deepEqual(menu(state, 'x'), [{ key: 'logs' }])
  assert.equal(
    after(state, 'x', '/movements/m1').screen,
    'MovementDetail(back)',
  )
  assert.deepEqual(after(state, 'x', '/equipment'), {
    shell: 'admin',
    redirect: '/logs',
  })
  // With the export key the print page opens too.
  const exporting = ready([
    ['movements.read', 'all'],
    ['movements.export', 'all'],
  ])
  assert.deepEqual(sorted(nav.planShell(exporting, 'x').pages), [
    'logs',
    'movements/:id',
    'print/export',
  ])
  assert.deepEqual(after(exporting, 'x', '/print/export'), {
    shell: 'print',
    screen: 'PrintExport',
  })
})

test('reports.view scope workshop alone lands on the workshop report', () => {
  const state = ready([['reports.view', 'workshop']])
  const plan = nav.planShell(state, 'x')
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'reports/workshop')
  assert.deepEqual(sorted(plan.pages), ['reports', 'reports/workshop'])
  assert.deepEqual(menu(state, 'x'), [
    { key: 'reports', children: ['reports/workshop'] },
  ])
  assert.deepEqual(after(state, 'x', '/reports/workshop'), {
    shell: 'admin',
    active: 'reports',
    screen: 'WorkshopReports',
  })
  // /reports asks for the entries report, which this scope does not open.
  assert.deepEqual(after(state, 'x', '/reports'), {
    shell: 'admin',
    redirect: '/reports/workshop',
  })
  // A reports.view scope no child accepts opens no section at all.
  for (const scope of ['own', 'companies'])
    assert.equal(
      nav.planShell(ready([['reports.view', scope]]), 'x').kind,
      'none',
    )
})

test('the landing is the first passing section in menu order', () => {
  const state = ready([
    ['drivers.read', 'all'],
    ['inquiry.view', 'all'],
  ])
  const plan = nav.planShell(state, 'x')
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'inquiry')
  assert.deepEqual(menu(state, 'x'), [{ key: 'inquiry' }, { key: 'drivers' }])
  assert.deepEqual(sorted(plan.pages), ['drivers', 'drivers/:id', 'inquiry'])
  assert.deepEqual(after(state, 'x', '/'), {
    shell: 'admin',
    redirect: '/inquiry',
  })
  assert.equal(after(state, 'x', '/drivers/d1').screen, 'DriverDetail')
  // Every section can be the landing, in NAV_ENTRIES order.
  const landings = []
  for (const entry of nav.NAV_ENTRIES) {
    // A hidden entry (URL only) is never a landing.
    if (entry.key === 'dashboard' || entry.hidden) continue
    const gate = (entry.children ?? [entry])[0].requires[0]
    const own = nav.planShell(
      ready([[gate.key, gate.scopes?.[0] ?? 'all']]),
      'x',
    )
    assert.equal(own.kind, 'admin', entry.key)
    landings.push(own.landing)
  }
  assert.deepEqual(landings, [
    'logs',
    'inquiry',
    'equipment',
    'projects',
    'projects',
    'lessors',
    'drivers',
    'users',
    'activity',
    'reports/entries',
    'movement-import',
    'settings',
  ])
})

test('a key that opens no section is still the no-permissions page', () => {
  // The log needs a site / workshop / all read scope, as in the sidebar.
  for (const entries of [
    [['movements.read', 'own']],
    [['movements.read', 'companies']],
    [['users.read', 'all']],
    [['movements.export', 'all']],
    [['movements.site.create', 'all']],
  ]) {
    const plan = nav.planShell(ready(entries), 'x')
    assert.equal(plan.kind, 'none', JSON.stringify(entries))
    assert.equal(plan.pages.size, 0)
    assert.deepEqual(after(ready(entries), 'x', '/logs'), { shell: 'none' })
  }
})

test('a field home keeps precedence over the sections, with no sidebar', () => {
  const state = ready([
    ['home.foreman', 'own'],
    ['equipment.read', 'all'],
    ['inquiry.view', 'all'],
  ])
  const plan = nav.planShell(state, 'x')
  assert.equal(plan.kind, 'foreman')
  assert.equal(plan.landing, 'dashboard')
  assert.deepEqual(sorted(plan.pages), ['dashboard', 'inquiry'])
  assert.deepEqual(menu(state, 'x'), [])
  assert.deepEqual(after(state, 'x', '/equipment'), {
    shell: 'foreman',
    active: 'dashboard',
    screen: 'Home',
  })
  const workshop = ready([
    ['home.workshop', 'workshop'],
    ['reports.view', 'all'],
  ])
  assert.equal(nav.planShell(workshop, 'x').kind, 'workshop')
  assert.deepEqual(menu(workshop, 'x'), [])
})

// --- The gate table -----------------------------------------------------------

const ALL_PAGES = [
  ...new Set([
    ...nav.SHELL_PAGES.admin,
    ...nav.SHELL_PAGES.foreman,
    ...nav.SHELL_PAGES.workshop,
    'print/export',
  ]),
]

test('every routable page has a gate made of catalogue keys', () => {
  const catalogue = catalogueKeys()
  for (const page of ALL_PAGES)
    for (const gate of nav.pageGate(page))
      assert.ok(catalogue.has(gate.key), `${page}: ${gate.key}`)
  assert.deepEqual(plain(nav.pageGate('dashboard')), [{ key: 'home.admin' }])
  assert.deepEqual(Object.keys(nav.SHELL_PAGES), [
    'admin',
    'foreman',
    'workshop',
  ])
  // An unknown page is closed.
  assert.equal(nav.pageGate('nowhere').length, 1)
  assert.equal(nav.pageGate('nowhere')[0].key, '')
})

test('sidebar entries are guarded by the sidebar table itself', () => {
  for (const entry of nav.NAV_ENTRIES) {
    assert.equal(nav.pageGate(entry.key), entry.requires, entry.key)
    for (const child of entry.children ?? [])
      assert.equal(nav.pageGate(child.key), child.requires, child.key)
  }
})

test('the gates of the pages outside the sidebar', () => {
  const gate = (page) => plain(nav.pageGate(page))
  assert.deepEqual(gate('movements/:id'), [{ key: 'movements.read' }])
  assert.deepEqual(gate('equipment/:id'), [{ key: 'equipment.read' }])
  assert.deepEqual(gate('drivers/:id'), [{ key: 'drivers.read' }])
  assert.deepEqual(gate('users/:id'), [{ key: 'users.manage' }])
  assert.deepEqual(gate('inquiry'), [{ key: 'inquiry.view' }])
  assert.deepEqual(gate('movements/new'), [
    { key: 'movements.site.create' },
    { key: 'movements.workshop.create' },
  ])
  assert.deepEqual(gate('print/export'), [{ key: 'movements.export' }])
  assert.deepEqual(gate('settings/afaqy'), [{ key: 'settings.integrations' }])
  assert.deepEqual(gate('settings/roles'), [{ key: 'settings.roles' }])
  assert.deepEqual(gate('settings/equipment-types'), [
    { key: 'settings.equipment_types' },
  ])
  assert.deepEqual(gate('settings/workshop-opening-balance'), [
    { key: 'movements.import' },
  ])
  assert.deepEqual(gate('reports/entries/all'), gate('reports/entries'))
  assert.deepEqual(gate('settings'), [
    { key: 'settings.equipment_types' },
    { key: 'settings.integrations' },
    { key: 'settings.roles' },
  ])
  // A detail page with only the settings key it needs.
  const afaqy = nav.planShell(
    ready([
      ['home.admin', 'all'],
      ['settings.integrations', 'all'],
    ]),
    'x',
  )
  assert.deepEqual(sorted(afaqy.pages), [
    'dashboard',
    'settings',
    'settings/afaqy',
  ])
})

test('routePageOf reads the URL as the old router did', () => {
  const page = (url) => nav.routePageOf(url.split('/').filter(Boolean))
  assert.equal(page('/'), 'dashboard')
  assert.equal(page('/movements'), 'dashboard')
  assert.equal(page('/movements/new'), 'movements/new')
  assert.equal(page('/movements/abc'), 'movements/:id')
  assert.equal(page('/equipment'), 'equipment')
  assert.equal(page('/equipment/abc'), 'equipment/:id')
  assert.equal(page('/reports'), 'reports/entries')
  assert.equal(page('/reports/entries/all'), 'reports/entries/all')
  assert.equal(page('/settings/roles/x'), 'settings/roles')
  assert.equal(page('/settings/afaqy'), 'settings/afaqy')
  assert.equal(page('/settings/afaqy/x'), 'settings')
  assert.equal(page('/print/export'), 'print/export')
  assert.equal(page('/print'), 'dashboard')
  assert.equal(page('/ui-kit'), 'dashboard')
  assert.equal(page('/toString'), 'dashboard')
})

// --- Wiring -------------------------------------------------------------------

const APP = read('src', 'App.tsx')
const content = APP.slice(APP.indexOf('function AppContent()'))

test('App.tsx picks the shell with planShell and guards with its pages', () => {
  assert.match(
    content,
    /planShell\(\{ status: permissionStatus, permissions \}, role\)/,
  )
  assert.match(content, /const requested = routePageOf\(segments\)/)
  assert.match(
    content,
    /const page: RoutePage = shell\.pages\.has\(requested\) \? requested : shell\.landing/,
  )
  // No shell branches on the role any more.
  assert.doesNotMatch(content, /profile\.role ===|profile\.role !==/)
  assert.doesNotMatch(content, /ADMIN_PAGES|MONITOR_NAV_PAGES|WORKER_NAV_PAGES/)
  assert.doesNotMatch(content, /minimal|MINIMAL/)
  // The shells, in order, and fail closed before the admin one.
  const order = [
    "if (requested === 'print/export' && shell.pages.has('print/export'))",
    "if (shell.kind === 'unavailable' || shell.kind === 'pending')",
    "if (shell.kind === 'none')",
    "if (shell.kind === 'foreman' || shell.kind === 'workshop')",
    "const adminShell: 'admin' = shell.kind",
  ].map((marker) => content.indexOf(marker))
  for (const index of order) assert.ok(index > 0)
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  )
  assert.match(
    content,
    /<NoPermissionsPage onSignOut=\{\(\) => void signOut\(\)\} \/>/,
  )
})

test('App.tsx replaces a URL the dashboard-less admin shell does not open', () => {
  assert.match(
    content,
    /const landingRedirect =\s*profile && shell\.landing !== 'dashboard' && !shell\.pages\.has\(requested\)\s*\? `\/\$\{shell\.landing\}`\s*: null/,
  )
  assert.match(
    content,
    /useEffect\(\(\) => \{\s*if \(landingRedirect\) router\.replace\(landingRedirect\)\s*\}, \[landingRedirect, router\]\)/,
  )
  // The admin shell shows the route placeholder until the URL matches.
  const admin = content.slice(
    content.indexOf("const adminShell: 'admin' = shell.kind"),
  )
  assert.match(
    admin,
    /\{landingRedirect \? \(\s*<RouteFallback \/>\s*\) : page === 'movements\/new'/,
  )
  assert.equal(content.split('landingRedirect').length, 6)
  // The admin home chunk is warmed only for a shell that has it.
  assert.match(
    APP,
    /if \(kind === 'admin'\) return landing === 'dashboard' \? 'admin-home' : null/,
  )
})

test('App.tsx renders each screen behind its page', () => {
  const pairs = [
    [/page === 'movements\/new' \? \(\s*<MovementCreate/g, 2],
    [/page === 'movements\/:id' \? \(\s*<MovementDetail/g, 2],
    [/page === 'equipment\/:id' \? \(\s*<EquipmentDetail/g, 1],
    [/page === 'drivers\/:id' \? \(\s*<DriverDetail/g, 1],
    [/page === 'users\/:id' \? \(\s*<UserDetail/g, 1],
    [/page === 'settings\/roles' && <RolesSettings \/>/g, 1],
    [/page === 'reports\/workshop' && \(\s*<WorkshopReports/g, 1],
    [/page === 'reports\/equipment' && <EquipmentReports \/>/g, 1],
    [/page === 'reports\/entries\/all' && \(\s*<EntryReportsAll/g, 1],
    [/page === 'reports\/entries' && \(\s*<EntryReports /g, 1],
  ]
  for (const [re, count] of pairs)
    assert.equal(content.match(re)?.length, count, String(re))
  const components = {
    dashboard: 'AdminHomeScreen',
    logs: 'LogsScreen',
    inquiry: 'EquipmentInquiryScreen',
    equipment: 'AdminEquipment',
    projects: 'AdminProjects',
    companies: 'AdminCompanies',
    lessors: 'AdminLessors',
    drivers: 'AdminDrivers',
    users: 'AdminUsers',
    'movement-import': 'MovementImport',
    activity: 'MovementActivity',
  }
  for (const [page, component] of Object.entries(components))
    assert.match(
      content,
      new RegExp(`page === '${page}' &&[\\s(]*<${component}\\b`),
      page,
    )
  assert.match(
    content,
    /\(page === 'settings' \|\|\s*page === 'settings\/equipment-types' \|\|\s*page === 'settings\/workshop-opening-balance' \|\|\s*page === 'settings\/afaqy'\) && <AdminSettings \/>/,
  )
  // The admin home's shortcuts follow the pages they open.
  assert.match(
    content,
    /const canOpenEquipment = shell\.pages\.has\('equipment\/:id'\)/,
  )
  assert.match(
    content,
    /const canCreateMovement = shell\.pages\.has\('movements\/new'\)/,
  )
  assert.match(content, /onSelectEquipment=\{\s*canOpenEquipment/)
  assert.match(content, /onCreateMovement=\{\s*canCreateMovement/)
})

test('the field home receives its variant from the permission scope', () => {
  assert.match(content, /<HomeScreen\s+movementsScope=\{shell\.homeScope\}/)
  const home = read('src', 'screens', 'HomeScreen.tsx')
  assert.match(home, /movementsScope\?: HomeMovementsScope/)
  // wave 24: without the prop the home resolves the scope itself (the
  // permissions once ready, the role meanwhile).
  assert.match(
    home,
    /const scope =\s*movementsScope \?\? resolveHomeMovementsScope\(permissionState, profile\?\.role\)/,
  )
  // Same three values as the home's own type.
  const homeSource = read('src', 'lib', 'homeScope.ts')
  assert.match(
    homeSource,
    /export type HomeMovementsScope = 'all_contexts' \| 'workshop' \| 'own_site'/,
  )
  assert.match(
    read('src', 'lib', 'navPermissions.ts'),
    /export type ShellHomeScope = 'all_contexts' \| 'workshop' \| 'own_site'/,
  )
})

test('the no-permissions copy exists in Arabic and English, without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ wave-23-shell — start([\s\S]*?)\/\/ wave-23-shell — end/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  for (const [, block] of blocks) {
    assert.match(block, /noPermissionsTitle:/)
    assert.match(block, /noPermissionsBody:/)
  }
  assert.match(blocks[0][1], /لا توجد صلاحيات/)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
})
