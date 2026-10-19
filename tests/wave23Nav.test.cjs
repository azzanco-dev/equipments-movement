// wave 23 (routing by permissions, step 1) — the sidebar follows the user's
// permissions. With the roles system OFF, current_permissions() answers from
// the frozen legacy_role_permissions(profiles.role) mapping, so the menu built
// from those keys must be EXACTLY the role-based menu of before, for each of
// the six roles. The role is only the fallback while permissions load or after
// a failed load; an unknown role with no permissions gets no sidebar.
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

/** vm-realm objects have a foreign prototype, so compare plain copies. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const nav = loadLib('navPermissions')

// --- The migrations -----------------------------------------------------------

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const migrationTexts = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => read('supabase', 'migrations', name))

/** The LATEST body of legacy_role_permissions (0126, recreated by 0128). */
function legacyMapping() {
  let body = null
  for (const sql of migrationTexts) {
    const re =
      /CREATE OR REPLACE FUNCTION public\.legacy_role_permissions\(p_role text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g
    for (const match of sql.matchAll(re)) body = match[1]
  }
  assert.ok(body, 'legacy_role_permissions is defined')
  const rows = [...body.matchAll(/\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g)]
  assert.ok(rows.length > 50)
  const mapping = new Map()
  for (const [, role, key, , scope] of rows) {
    if (!mapping.has(role)) mapping.set(role, new Map())
    // current_permissions() returns COALESCE(scope, 'all').
    mapping.get(role).set(key, scope ?? 'all')
  }
  return mapping
}

/** Every key of the permission catalogue (all INSERTs into permissions). */
function catalogueKeys() {
  const keys = new Set()
  for (const sql of migrationTexts) {
    for (const insert of sql.matchAll(
      /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?);\n/g,
    ))
      for (const row of insert[1].matchAll(/^\s*\('([\w.]+)', '(\w+)',/gm))
        keys.add(row[1])
  }
  assert.ok(keys.size > 40)
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

// --- The role-based menus captured from src/App.tsx at 4fa887d ---------------
// (admin `navItems`, monitor `monitorNavItems`, and `navItems={[]}` for the
// foreman and workshop shells).

const CAPTURED = {
  admin: [
    { key: 'dashboard' },
    { key: 'logs' },
    { key: 'inquiry' },
    { key: 'equipment' },
    { key: 'projects' },
    { key: 'companies' },
    { key: 'lessors' },
    // Purchasing (migration 0136, 2026-10-19): the admin holds
    // purchasing.view in the frozen legacy mapping too, so «المشتريات» joined
    // the admin menu; no other legacy role has it.
    { key: 'purchasing' },
    { key: 'drivers' },
    { key: 'users' },
    { key: 'activity' },
    {
      key: 'reports',
      children: ['reports/entries', 'reports/equipment', 'reports/workshop'],
    },
    { key: 'movement-import' },
    { key: 'settings' },
  ],
  monitor: [{ key: 'dashboard' }, { key: 'logs' }, { key: 'inquiry' }],
  supervisor: [],
  workshop: [],
  assistant_workshop_manager: [],
  workshop_manager: [],
}

// The pages of the shell each role is routed to (the `routable` set App.tsx
// passes). Since wave 23 step 2 that is the shell plan's open pages; the
// role-based table is checked against the 8f17f53 router in
// tests/wave23Shell.test.cjs.
const APP = read('src', 'App.tsx')
const SHELL_PAGES = Object.fromEntries(
  ROLES.map((role) => [role, new Set(nav.LEGACY_SHELL_BY_ROLE[role].pages)]),
)

const ready = (map) => ({ status: 'ready', permissions: map })

/**
 * The sidebar App.tsx shows (2026-10-13): built from visibleNavItems in the
 * ADMIN shell only, limited to the shell's open pages; the foreman and
 * workshop homes pass `navItems={[]}`, whatever other keys the user holds.
 */
function shownMenu(state, role) {
  const shell = nav.planShell(state, role)
  return shell.kind === 'admin'
    ? plain(nav.visibleNavItems(state, role, shell.pages))
    : []
}

// --- Equivalence with the roles system OFF ------------------------------------

test('the legacy mapping covers the six roles', () => {
  assert.deepEqual([...LEGACY.keys()].sort(), [...ROLES].sort())
})

for (const role of ROLES) {
  test(`roles OFF: the permission menu of ${role} equals today's menu`, () => {
    const permissions = LEGACY.get(role)
    // The menu the shell shows…
    assert.deepEqual(shownMenu(ready(permissions), role), CAPTURED[role])
    // …which, for the admin shell, is the pure permission decision limited
    // to the pages of the shell App.tsx routes this role to.
    if (permissions.has('home.admin')) {
      assert.deepEqual(
        plain(nav.visibleNavItems(ready(permissions), role)),
        CAPTURED[role],
      )
      assert.deepEqual(
        plain(nav.visibleNavItems(ready(permissions), role, SHELL_PAGES[role])),
        CAPTURED[role],
      )
    } else {
      // A field home: the role's shell shows no sidebar even though some of
      // its keys (inquiry.view, movements.read) are sidebar entries.
      assert.equal(
        nav.planShell(ready(permissions), role).kind !== 'admin',
        true,
      )
      assert.deepEqual(CAPTURED[role], [])
    }
    // The role does not matter once permissions are ready.
    assert.deepEqual(
      shownMenu(ready(permissions), 'someone-else'),
      CAPTURED[role],
    )
  })

  test(`loading / failed permissions: ${role} keeps today's menu`, () => {
    for (const status of ['loading', 'error']) {
      const state = { status, permissions: new Map() }
      assert.deepEqual(shownMenu(state, role), CAPTURED[role])
      assert.deepEqual(
        plain(nav.visibleNavItems(state, role, SHELL_PAGES[role])),
        CAPTURED[role],
      )
    }
  })
}

test('the fallback table is the captured role-based menu', () => {
  assert.deepEqual(plain(nav.LEGACY_NAV_BY_ROLE), CAPTURED)
})

// --- Fail closed --------------------------------------------------------------

test('an unknown or missing role with no permissions gets no sidebar', () => {
  for (const role of [
    undefined,
    null,
    '',
    'manager',
    'constructor',
    'toString',
  ])
    for (const status of ['loading', 'error', 'ready'])
      assert.deepEqual(
        plain(nav.visibleNavItems({ status, permissions: new Map() }, role)),
        [],
      )
})

test('without home.admin the menu lists the sections, not the home', () => {
  const map = new Map(LEGACY.get('admin'))
  map.delete('home.admin')
  const expected = CAPTURED.admin.filter((item) => item.key !== 'dashboard')
  assert.deepEqual(plain(nav.visibleNavItems(ready(map), 'admin')), expected)
  assert.deepEqual(shownMenu(ready(map), 'admin'), expected)
  assert.equal(nav.planShell(ready(map), 'admin').landing, 'logs')
  // one section alone
  assert.deepEqual(
    shownMenu(ready(new Map([['equipment.read', 'all']])), 'x'),
    [{ key: 'equipment' }],
  )
  // home alone is not a menu
  assert.deepEqual(
    plain(nav.visibleNavItems(ready(new Map([['home.admin', 'all']])), 'x')),
    [],
  )
  assert.deepEqual(shownMenu(ready(new Map([['home.admin', 'all']])), 'x'), [])
})

test('a field home shows no sidebar whatever else the user holds', () => {
  for (const home of ['home.foreman', 'home.workshop']) {
    const state = ready(
      new Map([
        [home, 'all'],
        ['inquiry.view', 'all'],
        ['equipment.read', 'all'],
        ['movements.read', 'all'],
      ]),
    )
    assert.notEqual(nav.planShell(state, 'x').kind, 'admin')
    assert.deepEqual(shownMenu(state, 'x'), [])
  }
})

test('scopes and any-of gates', () => {
  const base = [['home.admin', 'all']]
  const keys = (entries) =>
    plain(nav.visibleNavItems(ready(new Map([...base, ...entries])), null))
  // the log needs a site/workshop/all read scope, not "own" or "companies"
  assert.deepEqual(keys([['movements.read', 'own']]), [])
  assert.deepEqual(keys([['movements.read', 'companies']]), [])
  assert.deepEqual(keys([['movements.read', 'workshop']]), [
    { key: 'dashboard' },
    { key: 'logs' },
  ])
  // reports: each child follows its scope
  assert.deepEqual(keys([['reports.view', 'workshop']]), [
    { key: 'dashboard' },
    { key: 'reports', children: ['reports/workshop'] },
  ])
  assert.deepEqual(keys([['reports.view', 'site']]), [
    { key: 'dashboard' },
    { key: 'reports', children: ['reports/entries'] },
  ])
  // settings: any of its three keys
  for (const key of [
    'settings.equipment_types',
    'settings.integrations',
    'settings.roles',
  ])
    assert.deepEqual(keys([[key, 'all']]), [
      { key: 'dashboard' },
      { key: 'settings' },
    ])
  // users needs manage, not read
  assert.deepEqual(keys([['users.read', 'all']]), [])
})

test('routable drops pages the current shell cannot open', () => {
  const items = nav.visibleNavItems(
    ready(LEGACY.get('admin')),
    'admin',
    new Set(['dashboard', 'logs', 'reports', 'reports/workshop']),
  )
  assert.deepEqual(plain(items), [
    { key: 'dashboard' },
    { key: 'logs' },
    { key: 'reports', children: ['reports/workshop'] },
  ])
})

test('every gate is a key of the permission catalogue', () => {
  const catalogue = catalogueKeys()
  // The home entry's gate is the admin-home key (2026-10-13).
  assert.deepEqual(plain(nav.NAV_ENTRIES[0]), {
    key: 'dashboard',
    requires: [{ key: 'home.admin' }],
  })
  assert.equal(nav.NAV_SHELL_PERMISSION, undefined)
  const gates = nav.NAV_ENTRIES.flatMap((entry) => [
    ...entry.requires,
    ...(entry.children ?? []).flatMap((child) => child.requires),
  ])
  for (const gate of gates)
    assert.ok(catalogue.has(gate.key), `${gate.key} is in the catalogue`)
})

// --- Wiring -------------------------------------------------------------------

test('App.tsx builds every sidebar from visibleNavItems', () => {
  assert.match(
    APP,
    /import \{ usePermissions \} from '@\/auth\/PermissionsContext'/,
  )
  // One menu, built once for the admin shell, limited to its open pages.
  assert.match(
    APP,
    /const navItems = visibleNavItems\(\s*permissionState,\s*profile\.role,\s*shell\.pages,?\s*\)/,
  )
  assert.equal(APP.split('visibleNavItems(').length, 2)
  assert.equal(APP.split('navItems={navItems}').length, 2, 'the admin shell')
  // The field homes never have a sidebar, and the menu is built after them.
  assert.equal(APP.split('navItems={[]}').length, 2, 'the field shell')
  const fieldShell = APP.indexOf(
    "if (shell.kind === 'foreman' || shell.kind === 'workshop')",
  )
  const menuBuilt = APP.indexOf('const navItems = visibleNavItems(')
  const adminShell = APP.indexOf("const adminShell: 'admin' = shell.kind")
  assert.ok(fieldShell > 0 && menuBuilt > 0 && adminShell > 0)
  assert.ok(APP.indexOf('navItems={[]}') > fieldShell)
  assert.ok(APP.indexOf('navItems={[]}') < adminShell)
  assert.ok(menuBuilt > adminShell)
  assert.ok(APP.indexOf('navItems={navItems}') > menuBuilt)
  // no hand-written role menus left
  assert.doesNotMatch(APP, /\{ key: 'logs', label: t\('logs'\)/)
  // wave 23 step 2: the shells no longer branch on the role
  assert.doesNotMatch(APP, /if \(profile\.role ===/)
  assert.doesNotMatch(APP, /profile\.role !== 'admin'/)
})
