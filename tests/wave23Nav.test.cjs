// wave 23 (routing by permissions, step 1) — the sidebar follows the user's
// permissions. With the roles system OFF, current_permissions() answers from
// the frozen legacy_role_permissions(profiles.role) mapping, so the menu built
// from those keys must be EXACTLY the role-based menu of before, for each of
// the six roles. Roles stage 4a (2026-10-27): no role fallback; while the
// permissions load or after a failed load there is no sidebar at all.
//
// 2026-10-28 (owner: «نبغى نضيف السايد بار للجميع، بس التابات الي فيه بحسب
// صلاحيات كل مستخدم»): every shell has the sidebar. The admin and monitor
// menus are unchanged; the four field roles, which had none, now list their
// home and the sections their permissions pass (CHANGED_2026_10_28 below).
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
    // Purchasing (migration 0136; listed since 2026-10-20): the admin holds
    // purchasing.view in the frozen legacy mapping too, so «المشتريات» is in
    // the admin menu; no other legacy role has it.
    // 2026-10-24: «المعدات في المشاريع» joins the purchasing section.
    { key: 'purchasing', children: ['purchasing/orders', 'purchasing/units'] },
    { key: 'drivers' },
    { key: 'users' },
    // 2026-10-22 (owner): «سجل النشاط» and the movement import left the
    // menu — hidden entries, still open by URL.
    {
      key: 'reports',
      children: ['reports/entries', 'reports/equipment', 'reports/workshop'],
    },
    { key: 'settings' },
  ],
  monitor: [{ key: 'dashboard' }, { key: 'logs' }, { key: 'inquiry' }],
  supervisor: [],
  workshop: [],
  assistant_workshop_manager: [],
  workshop_manager: [],
}

// The intended changes of 2026-10-28 (the sidebar for every user): the field
// roles get «الرئيسية» (their own home) and the sections their legacy keys
// pass — inquiry.view for all four, and the log for the three workshop roles
// (movements.read scope all; the supervisor's scope is own).
const CHANGED_2026_10_28 = {
  supervisor: [{ key: 'dashboard' }, { key: 'inquiry' }],
  workshop: [{ key: 'dashboard' }, { key: 'logs' }, { key: 'inquiry' }],
  assistant_workshop_manager: [
    { key: 'dashboard' },
    { key: 'logs' },
    { key: 'inquiry' },
  ],
  workshop_manager: [
    { key: 'dashboard' },
    { key: 'logs' },
    { key: 'inquiry' },
  ],
}
const EXPECTED = { ...CAPTURED, ...CHANGED_2026_10_28 }

// The pages of the admin shell each home.admin role was routed to by the
// role-based router of src/App.tsx at 8f17f53 (the `routable` set; the table
// was LEGACY_SHELL_BY_ROLE in navPermissions.ts until roles stage 4a). The
// field roles had no sidebar.
const APP = read('src', 'App.tsx')
const SHELL_PAGES = {
  admin: new Set([...nav.SHELL_PAGES.admin, 'print/export']),
  monitor: new Set([
    'dashboard',
    'logs',
    'inquiry',
    'movements/:id',
    'print/export',
  ]),
}

const ready = (map) => ({ status: 'ready', permissions: map })

/**
 * The sidebar App.tsx shows (2026-10-28): built from visibleNavItems in every
 * shell (admin, foreman, workshop), limited to the shell's open pages; no
 * sidebar without a shell.
 */
function shownMenu(state) {
  const shell = nav.planShell(state)
  return ['admin', 'foreman', 'workshop'].includes(shell.kind)
    ? plain(nav.visibleNavItems(state, shell.pages))
    : []
}

// --- Equivalence with the roles system OFF ------------------------------------

test('the legacy mapping covers the six roles', () => {
  assert.deepEqual([...LEGACY.keys()].sort(), [...ROLES].sort())
})

for (const role of ROLES) {
  test(`roles OFF: the permission menu of ${role} equals the expected menu`, () => {
    const permissions = LEGACY.get(role)
    // The menu the shell shows…
    assert.deepEqual(shownMenu(ready(permissions)), EXPECTED[role])
    // …which, for the admin shell, is the pure permission decision limited
    // to the pages of the shell App.tsx routes this role to.
    if (permissions.has('home.admin')) {
      assert.deepEqual(
        plain(nav.visibleNavItems(ready(permissions))),
        CAPTURED[role],
      )
      assert.deepEqual(
        plain(nav.visibleNavItems(ready(permissions), SHELL_PAGES[role])),
        CAPTURED[role],
      )
    } else {
      // A field home: before 2026-10-28 no sidebar at all; now its home and
      // the sections its keys pass, all of which its shell opens.
      assert.notEqual(nav.planShell(ready(permissions)).kind, 'admin')
      assert.deepEqual(CAPTURED[role], [])
      assert.deepEqual(
        plain(nav.visibleNavItems(ready(permissions))),
        EXPECTED[role],
      )
    }
  })

  test(`loading / failed permissions: ${role} gets no sidebar`, () => {
    // Roles stage 4a: nothing is guessed from the role meanwhile, even when
    // the state (wrongly) carries the role's permissions.
    for (const status of ['loading', 'error'])
      for (const permissions of [new Map(), LEGACY.get(role)]) {
        const state = { status, permissions }
        assert.deepEqual(shownMenu(state), [])
        assert.deepEqual(plain(nav.visibleNavItems(state)), [])
        assert.deepEqual(
          plain(nav.visibleNavItems(state, SHELL_PAGES.admin)),
          [],
        )
      }
  })
}

test('roles stage 4a: no role fallback menu is left', () => {
  assert.equal(nav.LEGACY_NAV_BY_ROLE, undefined)
  assert.equal(nav.LEGACY_SHELL_BY_ROLE, undefined)
  assert.doesNotMatch(
    read('src', 'lib', 'navPermissions.ts'),
    /LEGACY_\w+_BY_ROLE/,
  )
})

// --- Fail closed --------------------------------------------------------------

test('no permissions: no sidebar, whatever the status', () => {
  for (const status of ['loading', 'error', 'ready'])
    assert.deepEqual(
      plain(nav.visibleNavItems({ status, permissions: new Map() })),
      [],
    )
})

test('without home.admin the menu lists the sections, not the home', () => {
  const map = new Map(LEGACY.get('admin'))
  map.delete('home.admin')
  const expected = CAPTURED.admin.filter((item) => item.key !== 'dashboard')
  assert.deepEqual(plain(nav.visibleNavItems(ready(map))), expected)
  assert.deepEqual(shownMenu(ready(map)), expected)
  assert.equal(nav.planShell(ready(map)).landing, 'logs')
  // one section alone
  assert.deepEqual(shownMenu(ready(new Map([['equipment.read', 'all']]))), [
    { key: 'equipment' },
  ])
  // 2026-10-28: home alone is a menu of one entry (the sidebar is always
  // there for a user with a home)
  for (const home of ['home.admin', 'home.foreman', 'home.workshop']) {
    const state = ready(new Map([[home, 'all']]))
    assert.deepEqual(plain(nav.visibleNavItems(state)), [{ key: 'dashboard' }])
    assert.deepEqual(shownMenu(state), [{ key: 'dashboard' }])
  }
})

test('a field home lists every section its permissions pass', () => {
  for (const home of ['home.foreman', 'home.workshop']) {
    const state = ready(
      new Map([
        [home, 'all'],
        ['inquiry.view', 'all'],
        ['equipment.read', 'all'],
        ['movements.read', 'all'],
        ['purchasing.view', 'all'],
        ['reports.view', 'workshop'],
        ['movements.activity', 'all'],
      ]),
    )
    assert.notEqual(nav.planShell(state).kind, 'admin')
    const expected = [
      { key: 'dashboard' },
      { key: 'logs' },
      { key: 'inquiry' },
      { key: 'equipment' },
      {
        key: 'purchasing',
        children: ['purchasing/orders', 'purchasing/units'],
      },
      { key: 'reports', children: ['reports/workshop'] },
    ]
    assert.deepEqual(shownMenu(state), expected)
    // The same menu the permissions give without a shell limit: the field
    // shell opens every listed section (hidden entries stay out of the menu).
    assert.deepEqual(plain(nav.visibleNavItems(state)), expected)
  }
})

test('scopes and any-of gates', () => {
  const base = [['home.admin', 'all']]
  const keys = (entries) =>
    plain(nav.visibleNavItems(ready(new Map([...base, ...entries]))))
  // the log needs a site/workshop/all/companies read scope, not "own"
  // (2026-10-28: `companies` reads the rows of the user's companies)
  assert.deepEqual(keys([['movements.read', 'own']]), [{ key: 'dashboard' }])
  assert.deepEqual(keys([['movements.read', 'companies']]), [
    { key: 'dashboard' },
    { key: 'logs' },
  ])
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
  // the equipment report also needs movements.read all (its RPC checks it)
  assert.deepEqual(keys([['reports.view', 'all']]), [
    { key: 'dashboard' },
    { key: 'reports', children: ['reports/entries', 'reports/workshop'] },
  ])
  assert.deepEqual(
    keys([
      ['reports.view', 'all'],
      ['movements.read', 'all'],
    ]),
    [
      { key: 'dashboard' },
      { key: 'logs' },
      {
        key: 'reports',
        children: ['reports/entries', 'reports/equipment', 'reports/workshop'],
      },
    ],
  )
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
  assert.deepEqual(keys([['users.read', 'all']]), [{ key: 'dashboard' }])
})

test('routable drops pages the current shell cannot open', () => {
  const items = nav.visibleNavItems(
    ready(LEGACY.get('admin')),
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
  // The home entry's gate: any home key (2026-10-28; home.admin alone from
  // 2026-10-13 until then).
  assert.deepEqual(plain(nav.NAV_ENTRIES[0]), {
    key: 'dashboard',
    requires: [
      { key: 'home.admin' },
      { key: 'home.foreman' },
      { key: 'home.workshop' },
    ],
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
  // One menu, built once for every shell, limited to its open pages.
  assert.match(
    APP,
    /const navItems = visibleNavItems\(permissionState, shell\.pages\)/,
  )
  assert.equal(APP.split('visibleNavItems(').length, 2)
  assert.equal(APP.split('navItems={navItems}').length, 2, 'one Layout')
  assert.equal(APP.match(/<Layout\s/g).length, 1, 'one Layout')
  // 2026-10-28: no shell without a sidebar any more.
  assert.equal(APP.split('navItems={[]}').length, 1)
  assert.doesNotMatch(
    APP,
    /if \(shell\.kind === 'foreman' \|\| shell\.kind === 'workshop'\)/,
  )
  const shellKind = APP.indexOf(
    "const shellKind: 'admin' | 'foreman' | 'workshop' = shell.kind",
  )
  const menuBuilt = APP.indexOf('const navItems = visibleNavItems(')
  assert.ok(shellKind > 0 && menuBuilt > shellKind)
  assert.ok(APP.indexOf('navItems={navItems}') > menuBuilt)
  // no hand-written role menus left
  assert.doesNotMatch(APP, /\{ key: 'logs', label: t\('logs'\)/)
  // wave 23 step 2: the shells no longer branch on the role
  assert.doesNotMatch(APP, /if \(profile\.role ===/)
  assert.doesNotMatch(APP, /profile\.role !== 'admin'/)
  // roles stage 4a: the role is not read at all, not even as a fallback
  assert.doesNotMatch(APP, /profile\??\.role\b/)
})
