// wave 22B — the roles and permissions UI (Settings › «الادوار والصلاحيات»):
// pure helpers, the role gate of the page (admin only, fail closed), and the
// rule that nothing in the interface turns the roles system on by itself.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
// Type-only imports (`@/i18n`) are erased by the transpile step.
function loadLibModule(name, cache = new Map()) {
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
      Date,
      Math,
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

/** vm-realm objects have a foreign prototype, so compare plain copies. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const roles = loadLibModule('rolesAdmin')
const permissions = loadLibModule('permissions')
const forms = loadLibModule('formValidation')

// --- The real catalogue and seeds of 0126 ------------------------------------

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const SQL_0126 = read(
  'supabase',
  'migrations',
  fs.readdirSync(MIGRATIONS).find((name) => /_0126_/.test(name)),
)

function catalogue() {
  const insert =
    /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?\));\n/.exec(
      SQL_0126,
    )
  assert.ok(insert)
  const list = (value) =>
    value === 'NULL'
      ? null
      : value === "'{}'"
        ? []
        : [...value.matchAll(/'([\w.]+)'/g)].map((m) => m[1])
  const rows = [
    ...insert[1].matchAll(
      /\('([\w.]+)', '(\w+)', '((?:[^']|'')+)', '((?:[^']|'')+)',\s*'((?:[^']|'')+)',\s*'((?:[^']|'')+)',\s*(true|false), (NULL|ARRAY\[[^\]]*\]), ('\{\}'|ARRAY\[[^\]]*\]), (true|false), '(\w+)', (\d+)\)/g,
    ),
  ]
  assert.ok(rows.length > 40)
  return rows.map((m) => ({
    key: m[1],
    group_key: m[2],
    name_ar: m[3],
    name_en: m[4],
    scoped: m[7] === 'true',
    scopes: list(m[8]),
    requires: list(m[9]),
    admin_only: m[10] === 'true',
    enforced_in: m[11],
    sort: Number(m[12]),
  }))
}
const CATALOGUE = catalogue()

/** role -> selection, from the legacy mapping and the suggested-role seeds. */
function seededSelections() {
  const selections = new Map()
  const add = (role, key, scope) => {
    if (!selections.has(role)) selections.set(role, {})
    selections.get(role)[key] = scope ?? null
  }
  const legacy = SQL_0126.slice(
    SQL_0126.indexOf('FUNCTION public.legacy_role_permissions'),
  )
  const legacyBody = legacy.slice(0, legacy.indexOf('$$;'))
  for (const [, role, key, , scope] of legacyBody.matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  ))
    add(role, key, scope)
  const seeds =
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\)\nVALUES([\s\S]*?);\n/.exec(
      SQL_0126,
    )
  assert.ok(seeds)
  for (const [, role, key, , scope] of seeds[1].matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  ))
    add(role, key, scope)
  return selections
}

// --- Role keys ---------------------------------------------------------------

test('the role key is suggested from the English name', () => {
  const cases = [
    ['Foreman Lead', 'foreman_lead'],
    ['  Equipment   Officer ', 'equipment_officer'],
    ['Purchasing', 'purchasing'],
    ['HR & Admin-2', 'hr_admin_2'],
    ['2nd Shift Lead', 'nd_shift_lead'],
    ['Café Manager', 'cafe_manager'],
    ['مشتريات', ''],
    ['A', ''],
    ['', ''],
    ['x'.repeat(60), 'x'.repeat(40)],
    [`${'a'.repeat(39)} b`, 'a'.repeat(39)],
  ]
  for (const [name, key] of cases) {
    const suggested = roles.suggestRoleKey(name)
    assert.equal(suggested, key, name)
    if (suggested) assert.match(suggested, roles.ROLE_KEY_PATTERN)
  }
})

test('the role form schema mirrors admin_upsert_role', () => {
  const ok = {
    key: 'foreman_lead',
    name_ar: 'رئيس الفورمين',
    name_en: 'Foreman Lead',
    description_ar: '',
    description_en: '',
  }
  const errors = (values) =>
    plain(forms.validateWithSchema(forms.roleFormSchema, values))
  assert.deepEqual(errors(ok), {})
  assert.deepEqual(errors({ ...ok, key: '' }), { key: 'roleKeyRequired' })
  for (const key of ['1abc', 'a', 'Abc', 'a-b', 'a'.repeat(41)])
    assert.deepEqual(errors({ ...ok, key }), { key: 'roleKeyInvalid' }, key)
  assert.deepEqual(errors({ ...ok, name_ar: ' ' }), {
    name_ar: 'roleNameArRequired',
  })
  assert.deepEqual(errors({ ...ok, name_en: 'x'.repeat(61) }), {
    name_en: 'roleNameTooLong',
  })
  assert.deepEqual(errors({ ...ok, description_en: 'x'.repeat(501) }), {
    description_en: 'roleDescriptionTooLong',
  })
})

// --- Scopes and the selection --------------------------------------------------

test('scope options follow permissions.scopes, narrowest first', () => {
  assert.deepEqual(
    plain(roles.scopeOptions({ scoped: true, scopes: ['all', 'own', 'site'] })),
    ['own', 'site', 'all'],
  )
  assert.deepEqual(
    plain(roles.scopeOptions({ scoped: false, scopes: null })),
    [],
  )
  assert.equal(
    roles.defaultScope({ scoped: true, scopes: ['all', 'workshop'] }),
    'workshop',
  )
  assert.equal(roles.defaultScope({ scoped: false, scopes: null }), null)
  // Every scoped key of the real catalogue offers exactly its own scopes.
  for (const permission of CATALOGUE.filter((p) => p.scoped)) {
    const options = plain(roles.scopeOptions(permission))
    assert.deepEqual([...options].sort(), [...permission.scopes].sort())
  }
})

test('ticking a key ticks its prerequisites transitively, with the default scope', () => {
  const result = roles.tickPermission({}, CATALOGUE, 'home.foreman')
  assert.deepEqual(plain(result.selection), {
    'home.foreman': 'own',
    'movements.site.create': 'own',
    'movements.photos.manage': 'own',
  })
  assert.deepEqual(plain(result.autoAdded), [
    'movements.site.create',
    'movements.photos.manage',
  ])
  // An already ticked prerequisite keeps its scope and is not reported.
  const again = roles.tickPermission(
    { 'movements.read': 'all' },
    CATALOGUE,
    'movements.workshop.classify',
  )
  assert.deepEqual(plain(again.selection), {
    'movements.read': 'all',
    'movements.workshop.classify': null,
  })
  assert.deepEqual(plain(again.autoAdded), [])
})

test('a prerequisite cannot be unticked while a ticked key needs it', () => {
  const { selection } = roles.tickPermission({}, CATALOGUE, 'home.admin')
  const blocked = roles.untickPermission(selection, CATALOGUE, 'movements.read')
  assert.deepEqual(plain(blocked.blockedBy), ['home.admin'])
  assert.equal(blocked.selection, selection)
  const freed = roles.untickPermission(selection, CATALOGUE, 'home.admin')
  assert.deepEqual(plain(freed.selection), { 'movements.read': 'own' })
})

test('a scope outside permissions.scopes is ignored', () => {
  const selection = { 'home.workshop': 'workshop' }
  assert.equal(
    roles.setPermissionScope(selection, CATALOGUE, 'home.workshop', 'own'),
    selection,
  )
  assert.deepEqual(
    plain(
      roles.setPermissionScope(selection, CATALOGUE, 'home.workshop', 'all'),
    ),
    { 'home.workshop': 'all' },
  )
})

test('the client checks agree with the database rules', () => {
  const problems = (selection, role = 'custom') =>
    plain(roles.selectionProblems(selection, CATALOGUE, role))
  assert.deepEqual(problems({ 'nope.key': null }), {
    'nope.key': 'rolesErrUnknownPermission',
  })
  assert.deepEqual(problems({ 'movements.read': null }), {
    'movements.read': 'rolesErrInvalidScope',
  })
  assert.deepEqual(problems({ 'equipment.read': 'all' }), {
    'equipment.read': 'rolesErrInvalidScope',
  })
  assert.deepEqual(problems({ 'settings.roles': null }), {
    'settings.roles': 'rolesErrAdminOnly',
  })
  assert.deepEqual(problems({ 'home.admin': null }), {
    'home.admin': 'rolesErrMissingRequired',
  })
  // Every seeded role (the six system roles and the suggestions) is valid.
  for (const [role, selection] of seededSelections())
    assert.deepEqual(problems(selection, role), {}, role)
})

test('the payload is the full set in a stable order', () => {
  assert.deepEqual(
    plain(
      roles.toPermissionsPayload({
        'movements.read': 'all',
        'home.admin': null,
      }),
    ),
    [
      { key: 'home.admin', scope: null },
      { key: 'movements.read', scope: 'all' },
    ],
  )
  const a = { x: 'all', y: null }
  assert.equal(roles.selectionsEqual(a, { y: null, x: 'all' }), true)
  assert.equal(roles.selectionsEqual(a, { x: 'own', y: null }), false)
  assert.equal(roles.selectionsEqual(a, { x: 'all' }), false)
})

test('permissions are grouped by group_key in catalogue order, every group labelled', () => {
  const groups = plain(roles.groupPermissions(CATALOGUE))
  const keys = groups.map((group) => group.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const group of groups) {
    assert.ok(roles.PERMISSION_GROUP_LABEL_KEYS[group.key], group.key)
    const sorts = group.permissions.map((p) => p.sort)
    assert.deepEqual(
      sorts,
      [...sorts].sort((a, b) => a - b),
    )
  }
  assert.equal(
    groups.reduce((sum, group) => sum + group.permissions.length, 0),
    CATALOGUE.length,
  )
})

// --- Errors ------------------------------------------------------------------

test('every raised code maps to a safe message, never the raw text', () => {
  const sql = SQL_0126
  const raised = new Set(
    [...sql.matchAll(/RAISE EXCEPTION '(\w+)'/g)].map((m) => m[1]),
  )
  // Every token an admin function of 0126 can raise is mapped.
  for (const token of raised) assert.ok(roles.ROLES_ERROR_KEYS[token], token)
  for (const [token, key] of Object.entries(roles.ROLES_ERROR_KEYS)) {
    const mapped = plain(roles.rolesRpcError({ code: 'P0001', message: token }))
    assert.equal(mapped.code, token)
    assert.equal(mapped.messageKey, key)
  }
  const unknown = plain(
    roles.rolesRpcError({
      code: '42P01',
      message: 'relation "x" does not exist',
    }),
  )
  assert.deepEqual(unknown, {
    code: null,
    messageKey: 'rolesErrGeneric',
    permissionKey: null,
    requiredKey: null,
  })
  assert.equal(
    roles.rolesRpcError({ message: 'boom' }, 'rolePermissionsSaveError')
      .messageKey,
    'rolePermissionsSaveError',
  )
  // Tokens are matched whole: one is not mistaken for a longer one.
  assert.equal(
    roles.rolesRpcError({ message: 'invalid_permissions_payload' }).code,
    'invalid_permissions_payload',
  )
  assert.equal(
    roles.rolesRpcError({ message: 'user_not_found' }).code,
    'user_not_found',
  )
})

test('the DETAIL of a permission error names the row', () => {
  assert.deepEqual(
    plain(
      roles.rolesRpcError({
        message: 'missing_required_permission',
        details: 'home.admin requires movements.read',
      }),
    ),
    {
      code: 'missing_required_permission',
      messageKey: 'rolesErrMissingRequired',
      permissionKey: 'home.admin',
      requiredKey: 'movements.read',
    },
  )
  const scope = plain(
    roles.rolesRpcError({
      message: 'invalid_permission_scope',
      details: 'movements.read',
    }),
  )
  assert.equal(scope.permissionKey, 'movements.read')
  assert.equal(scope.messageKey, 'rolesErrInvalidScope')
  // A DETAIL that is not a permission key is not used.
  assert.equal(
    roles.rolesRpcError({
      message: 'unknown_permission',
      details: 'DROP TABLE',
    }).permissionKey,
    null,
  )
})

// --- Activation ----------------------------------------------------------------

test('offender reasons and audit actions have labels', () => {
  for (const reason of [
    'no_role',
    'unknown_role',
    'inactive_role',
    'admin_mismatch',
  ])
    assert.ok(roles.OFFENDER_REASON_KEYS[reason], reason)
  assert.equal(roles.offenderReasonKey('no_role'), 'rolesOffenderNoRole')
  assert.equal(roles.offenderReasonKey('???'), 'rolesOffenderUnknownRole')
  const actions = /CHECK \(action IN \(([\s\S]*?)\)\)/.exec(SQL_0126)
  assert.ok(actions)
  for (const [, action] of actions[1].matchAll(/'(\w+)'/g))
    assert.ok(roles.ROLE_CHANGE_ACTION_KEYS[action], action)
})

test('the preview is grouped per user into gained, lost and scope changes', () => {
  const row = (profile, key, change, legacy, active) => ({
    profile_id: profile,
    full_name: profile.toUpperCase(),
    legacy_role: 'supervisor',
    role_key: 'foreman_lead',
    permission_key: key,
    legacy_scope: legacy,
    active_scope: active,
    change,
  })
  const users = plain(
    roles.groupPreviewByUser([
      row('b', 'map.view', 'gained', null, 'all'),
      row('b', 'movements.read', 'scope_changed', 'own', 'site'),
      row('a', 'home.foreman', 'lost', 'own', null),
      row('b', 'reports.view', 'gained', null, 'site'),
    ]),
  )
  assert.deepEqual(
    users.map((user) => user.profile_id),
    ['b', 'a'],
  )
  assert.deepEqual(
    users[0].gained.map((r) => r.permission_key),
    ['map.view', 'reports.view'],
  )
  assert.equal(users[0].scope_changed.length, 1)
  assert.equal(users[0].lost.length, 0)
  assert.equal(users[1].lost[0].permission_key, 'home.foreman')
})

test('enabling needs zero offenders and the typed word; nothing enables by default', () => {
  const base = {
    enabled: false,
    offendersLoaded: true,
    offenderCount: 0,
    previewLoaded: true,
    typed: 'تفعيل',
    word: 'تفعيل',
    busy: false,
  }
  assert.equal(roles.canEnableRolesSystem(base), true)
  assert.equal(roles.canEnableRolesSystem({ ...base, typed: '' }), false)
  assert.equal(roles.canEnableRolesSystem({ ...base, typed: 'تفعيل ' }), true)
  assert.equal(roles.canEnableRolesSystem({ ...base, typed: 'تعطيل' }), false)
  assert.equal(roles.canEnableRolesSystem({ ...base, offenderCount: 1 }), false)
  assert.equal(
    roles.canEnableRolesSystem({ ...base, offendersLoaded: false }),
    false,
  )
  assert.equal(roles.canEnableRolesSystem({ ...base, enabled: null }), false)
  assert.equal(roles.canEnableRolesSystem({ ...base, enabled: true }), false)
  assert.equal(roles.canEnableRolesSystem({ ...base, busy: true }), false)
  assert.equal(
    roles.canEnableRolesSystem({ ...base, previewLoaded: false }),
    false,
  )
})

test('the flag and the toggle answer are read defensively', () => {
  assert.equal(roles.rolesSystemEnabledFromValue({ enabled: true }), true)
  for (const value of [
    { enabled: 'true' },
    { enabled: false },
    null,
    undefined,
    true,
    {},
  ])
    assert.equal(roles.rolesSystemEnabledFromValue(value), false)
  assert.deepEqual(plain(roles.parseToggleResult(null)), {
    enabled: false,
    changed: false,
    offenders: [],
    reason: null,
    preview_rows: null,
  })
  assert.deepEqual(
    plain(
      roles.parseToggleResult({
        enabled: false,
        changed: false,
        reason: 'preview_changed',
        offenders: [],
        preview_rows: 12,
      }),
    ),
    {
      enabled: false,
      changed: false,
      offenders: [],
      reason: 'preview_changed',
      preview_rows: 12,
    },
  )
  assert.equal(roles.parseToggleResult({ reason: 'whatever' }).reason, null)
  const refused = plain(
    roles.parseToggleResult({
      enabled: false,
      changed: false,
      offenders: [{ profile_id: 'x', reason: 'no_role' }],
    }),
  )
  assert.equal(refused.offenders.length, 1)
})

test('audit values are reduced to labels, never shown as raw JSON', () => {
  assert.deepEqual(
    plain(roles.roleChangeValue('permission_granted', { scope: 'own' })),
    {
      kind: 'scope',
      scope: 'own',
    },
  )
  assert.deepEqual(
    plain(roles.roleChangeValue('role_reassigned', { role_key: 'monitor' })),
    {
      kind: 'role',
      roleKey: 'monitor',
    },
  )
  assert.deepEqual(
    plain(
      roles.roleChangeValue('role_updated', {
        key: 'x',
        name_ar: 'س',
        name_en: 'X',
        is_active: false,
      }),
    ),
    { kind: 'roleRow', nameAr: 'س', nameEn: 'X', active: false },
  )
  assert.deepEqual(
    plain(
      roles.roleChangeValue('roles_system_enabled', {
        key: 'roles_system',
        value: { enabled: true },
      }),
    ),
    { kind: 'enabled', enabled: true },
  )
  assert.equal(roles.roleChangeValue('role_created', null), null)
})

// --- Client permissions and the page gate -----------------------------------------

test('current_permissions rows become a map; malformed rows are dropped', () => {
  const map = permissions.toPermissionMap([
    { permission_key: 'settings.roles', scope: 'all' },
    { permission_key: 'movements.read', scope: 'own' },
    { permission_key: 'bad.scope', scope: 'everything' },
    { permission_key: 7, scope: 'all' },
    null,
  ])
  assert.deepEqual([...map.keys()], ['settings.roles', 'movements.read'])
  assert.equal(
    permissions.permissionScopeOf('ready', map, 'movements.read'),
    'own',
  )
  assert.equal(
    permissions.permissionScopeOf('loading', map, 'movements.read'),
    null,
  )
  assert.equal(
    permissions.permissionScopeOf('error', map, 'movements.read'),
    null,
  )
  assert.equal(permissions.permissionScopeOf('ready', map, 'nope'), null)
})

test('the roles page is admin only and fails closed', () => {
  const withKey = new Map([['settings.roles', 'all']])
  const without = new Map([['movements.read', 'all']])
  const access = permissions.rolesPageAccess
  assert.equal(access('admin', 'ready', withKey), 'allowed')
  assert.equal(access('admin', 'ready', without), 'denied')
  assert.equal(access('admin', 'loading', withKey), 'loading')
  assert.equal(access('admin', 'error', withKey), 'error')
  for (const role of [
    'monitor',
    'supervisor',
    'workshop',
    'assistant_workshop_manager',
    'workshop_manager',
    'purchasing',
    'Admin',
    '',
    null,
    undefined,
  ])
    for (const status of ['ready', 'loading', 'error'])
      assert.equal(access(role, status, withKey), 'denied', `${role} ${status}`)
})

test('the route is registered only in the admin branch, after the fail-closed check', () => {
  const app = read('src', 'App.tsx')
  // wave 23: the admin shell is the one the compiler proves is `admin`, after
  // every other shell kind returned; the page renders behind its gate
  // (`settings/roles` -> settings.roles, tests/wave23Shell.test.cjs).
  const failClosed = app.indexOf("const adminShell: 'admin' = shell.kind")
  const route = app.indexOf('<RolesSettings />')
  assert.ok(failClosed > 0 && route > failClosed)
  assert.equal(app.split('<RolesSettings />').length, 2, 'rendered once')
  assert.match(app, /page === 'settings\/roles' && <RolesSettings \/>/)
  // App.tsx reads the permissions once, through usePermissions(), for the
  // sidebar and the shell (tests/wave23Nav.test.cjs, wave23Shell.test.cjs).
  assert.doesNotMatch(app, /current_permissions|has_permission/)
  assert.equal(app.split('usePermissions()').length, 2, 'read once')
  assert.match(
    app,
    /visibleNavItems\(\s*permissionState,\s*profile\.role,\s*shell\.pages,?\s*\)/,
  )
  const page = read('src', 'components', 'roles', 'RolesSettings.tsx')
  assert.match(page, /rolesPageAccess\(\s*profile\?\.role,/)
  assert.match(page, /if \(access !== 'allowed'\)/)
  const context = read('src', 'auth', 'PermissionsContext.tsx')
  assert.match(
    context,
    /In-screen actions, API\s+\* routes and Edge Functions still decide by `profiles\.role`/,
  )
})

test('the flag changes only on an explicit click, after the typed confirmation', () => {
  const dir = path.join(ROOT, 'src')
  const files = []
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(dir)
  const callers = files.filter((file) =>
    fs.readFileSync(file, 'utf8').includes("'set_roles_system_enabled'"),
  )
  assert.deepEqual(
    callers.map((file) => path.relative(ROOT, file).replace(/\\/g, '/')),
    ['src/components/roles/RolesActivationSection.tsx'],
  )
  const panel = read('src', 'components', 'roles', 'RolesActivationSection.tsx')
  // One call, inside the click handler that re-checks the confirmation.
  assert.equal(panel.split("'set_roles_system_enabled'").length, 2)
  const toggle = panel.slice(panel.indexOf('const toggle = async'))
  assert.ok(toggle.indexOf('set_roles_system_enabled') > 0)
  assert.match(toggle, /if \(next \? !canEnable : !canDisable\) return/)
  assert.match(
    toggle,
    /p_expected_preview_rows:\s*next && preview\.state === 'ready' \? preview\.rows\.length : null/,
  )
  assert.match(toggle, /answer\.reason === 'preview_changed'/)
  assert.match(panel, /onClick=\{\(\) => void toggle\(true\)\}/)
  assert.match(panel, /onClick=\{\(\) => void toggle\(false\)\}/)
  // No native confirm() anywhere on the roles page.
  for (const file of fs.readdirSync(path.join(dir, 'components', 'roles')))
    assert.doesNotMatch(
      read('src', 'components', 'roles', file),
      /window\.confirm|[^.\w]confirm\(\s*['"`]/,
      file,
    )
})

// --- Translations ---------------------------------------------------------------

test('wave-22-roles copy: Arabic and English keys match, no alif with hamza or madda', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ wave-22-roles — start\n([\s\S]*?)\/\/ wave-22-roles — end/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  const keysOf = (block) =>
    [...block.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keysOf(blocks[0][1]), keysOf(blocks[1][1]))
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const keys = new Set(keysOf(blocks[0][1]))
  const used = [
    ...Object.values(roles.ROLES_ERROR_KEYS),
    ...Object.values(roles.OFFENDER_REASON_KEYS),
    ...Object.values(roles.ROLE_CHANGE_ACTION_KEYS),
    ...Object.values(roles.SCOPE_LABEL_KEYS),
    ...Object.values(roles.PERMISSION_GROUP_LABEL_KEYS),
  ]
  for (const key of used) assert.ok(keys.has(key), key)
})

test('a legacy role change is blocked only as the 0126 trigger refuses it', () => {
  const base = {
    rolesSystemEnabled: true,
    oldRole: 'supervisor',
    newRole: 'monitor',
    assignedRoleKey: 'foreman_lead',
  }
  const blocked = (patch) =>
    roles.legacyRoleChangeBlocked({ ...base, ...patch })
  assert.equal(blocked({}), true)
  assert.equal(blocked({ rolesSystemEnabled: false }), false)
  assert.equal(blocked({ rolesSystemEnabled: null }), false)
  assert.equal(blocked({ assignedRoleKey: 'supervisor' }), false) // not customised
  assert.equal(blocked({ assignedRoleKey: null }), false)
  assert.equal(blocked({ newRole: 'admin' }), false) // admin parity follows
  assert.equal(blocked({ oldRole: 'admin', assignedRoleKey: 'admin' }), false)
  assert.equal(blocked({ newRole: 'supervisor' }), false) // no change
  const userForm = loadLibModule('userForm')
  assert.deepEqual(
    plain(
      userForm.userEditServerFieldErrors('roles_system_active_use_assignment'),
    ),
    { role: 'roleChangeUseAssignment' },
  )
})

test('reports.view all hints that the equipment report needs movements.read all', () => {
  assert.deepEqual(
    plain(
      roles.selectionScopeHints({
        'reports.view': 'all',
        'movements.read': 'site',
      }),
    ),
    { 'reports.view': 'rolePermissionsHintReportsNeedReadAll' },
  )
  assert.deepEqual(
    plain(
      roles.selectionScopeHints({
        'reports.view': 'all',
        'movements.read': 'all',
      }),
    ),
    {},
  )
  assert.deepEqual(
    plain(
      roles.selectionScopeHints({
        'reports.view': 'site',
        'movements.read': 'site',
      }),
    ),
    {},
  )
})
