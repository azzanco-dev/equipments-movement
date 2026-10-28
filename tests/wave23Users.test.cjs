// wave 23 (routing by permissions, step 3) — the users list, the user page
// and the header: ONE role in the UI, the `profile_roles` assignment
// (src/lib/userRoleAssignment.ts). Since roles stage 4c-2 (migration 0156)
// the legacy `profiles.role` is gone and there is no OFF mode.
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

const lib = loadLib('userRoleAssignment')
const { planRoleChange } = lib

const SYSTEM = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]

// --- The six system roles are the legacy values (0126 seed) -----------------

test('the system roles of 0126 are exactly the six legacy roles', () => {
  const sql = read(
    'supabase',
    'migrations',
    fs
      .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
      .find((name) => /_0126_/.test(name)),
  )
  const seed =
    /INSERT INTO public\.roles \(key, name_ar, name_en, description_ar, description_en, is_system, is_active\)\nVALUES([\s\S]*?);\n/.exec(
      sql,
    )
  assert.ok(seed)
  const system = [
    ...seed[1].matchAll(
      /\('(\w+)', '[^']+', '[^']+',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*', (true|false), true\)/g,
    ),
  ]
    .filter((m) => m[2] === 'true')
    .map((m) => m[1])
  assert.deepEqual(system.sort(), [...SYSTEM].sort())
  assert.deepEqual(plain(lib.SYSTEM_ROLE_KEYS).sort(), [...SYSTEM].sort())
  for (const key of SYSTEM) assert.equal(lib.isSystemRoleKey(key), true)
  assert.equal(lib.isSystemRoleKey('foreman_lead'), false)
  assert.equal(lib.isSystemRoleKey(''), false)
})

// --- No legacy role is derived any more ---------------------------------------

// Roles stage 4c-2 (migration 0156): profiles.role is dropped, so the
// helpers that derived it from the assignment are gone.
test('the legacy-role helpers are gone', () => {
  assert.equal(lib.legacyRoleFor, undefined)
  assert.equal(lib.legacyRoleAfter, undefined)
  assert.equal(lib.NARROWEST_LEGACY_ROLE, undefined)
  const source = read('src', 'lib', 'userRoleAssignment.ts')
  assert.doesNotMatch(source, /changeLegacy|currentLegacy|legacyRole/)
})

// --- planRoleChange ------------------------------------------------------------

const plan = (currentAssigned, newRoleKey) =>
  plain(planRoleChange({ currentAssigned, newRoleKey }))

// Roles stage 4b (owner 2026-10-27, migration 0153): a role is changed
// through the assignment alone.
test('plan: any change is one assign step', () => {
  for (const assigned of [...SYSTEM, 'foreman_lead', null])
    for (const target of [...SYSTEM, 'foreman_lead', 'purchasing']) {
      const steps = plan(assigned, target)
      if (assigned === target) assert.deepEqual(steps, [])
      else assert.deepEqual(steps, [{ kind: 'assign', roleKey: target }])
    }
})

test('plan: to and from admin is an assign like any other', () => {
  assert.deepEqual(plan('supervisor', 'admin'), [
    { kind: 'assign', roleKey: 'admin' },
  ])
  assert.deepEqual(plan('admin', 'equipment_officer'), [
    { kind: 'assign', roleKey: 'equipment_officer' },
  ])
  assert.deepEqual(plan(null, 'admin'), [{ kind: 'assign', roleKey: 'admin' }])
})

// --- The embed reader -------------------------------------------------------------

test('assignedRoleFromEmbed accepts an object, a one-element array and a missing roles embed', () => {
  const names = { name_ar: 'فورمين', name_en: 'Foreman' }
  const expected = { key: 'supervisor', name_ar: 'فورمين', name_en: 'Foreman' }
  assert.deepEqual(
    plain(lib.assignedRoleFromEmbed({ role_key: 'supervisor', roles: names })),
    expected,
  )
  assert.deepEqual(
    plain(
      lib.assignedRoleFromEmbed([{ role_key: 'supervisor', roles: [names] }]),
    ),
    expected,
  )
  assert.deepEqual(
    plain(lib.assignedRoleFromEmbed({ role_key: 'custom', roles: null })),
    { key: 'custom', name_ar: 'custom', name_en: 'custom' },
  )
  assert.equal(lib.assignedRoleFromEmbed(null), null)
  assert.equal(lib.assignedRoleFromEmbed([]), null)
  assert.equal(lib.assignedRoleFromEmbed({ roles: names }), null)
  assert.equal(lib.assignedRoleFromEmbed({ role_key: '' }), null)
})

test('the assign codes that belong under the role field', () => {
  assert.deepEqual([...lib.ASSIGN_ROLE_FIELD_CODES].sort(), [
    'admin_role_mismatch',
    'cannot_change_own_admin',
    'last_admin',
    'role_inactive',
    'role_not_found',
  ])
  // Every one of them is a known 0126 code with a translation key.
  const rolesAdmin = read('src', 'lib', 'rolesAdmin.ts')
  for (const code of lib.ASSIGN_ROLE_FIELD_CODES)
    assert.match(rolesAdmin, new RegExp(`^  ${code}: '\\w+',$`, 'm'))
})

// --- The screens -----------------------------------------------------------------

test('the pure module has no runtime import', () => {
  const source = read('src', 'lib', 'userRoleAssignment.ts')
  const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0])
  assert.deepEqual(imports, ["import type { UserRole } from '@/lib/types'"])
})

test('PermissionsContext reads the own assignment once, apart from the permissions', () => {
  const ctx = read('src', 'auth', 'PermissionsContext.tsx')
  // 2026-10-28: the roles system flag is no longer read (nothing showed it;
  // the system is the only one since 0150).
  assert.doesNotMatch(ctx, /app_settings|roles_system|rolesSystemEnabled/)
  assert.match(
    ctx,
    /\.from\('profile_roles'\)\s+\.select\('role_key,roles\(name_ar,name_en\)'\)\s+\.eq\('profile_id', forUser\)\s+\.maybeSingle\(\)/,
  )
  assert.match(ctx, /assignedRole: AssignedRole \| null/)
  // Its failure never turns the permissions status to error: the status is
  // set only from the current_permissions() result.
  const statusErrors = ctx.match(/status: 'error'/g) ?? []
  assert.equal(statusErrors.length, 2)
  assert.match(ctx, /void loadRoleInfo\(forUser, request\)/)
  // reload() goes through load(), which refreshes both.
  assert.match(ctx, /const reload = useCallback\(\(\) => load\(userId\)/)
})

test('the header shows the assigned role, nothing while it is unknown', () => {
  // Roles stage 4a: the roles system is permanently ON, so the label is the
  // assigned role's name; the legacy-role label fallback is gone.
  const layout = read('src', 'components', 'Layout.tsx')
  assert.match(
    layout,
    /const roleLabel = assignedRole\s+\? localizedName\(lang, assignedRole\.name_ar, assignedRole\.name_en\)\s+: null/,
  )
  assert.doesNotMatch(layout, /legacyRoleLabel|profile\??\.role/)
})

test('the users list reads the assignment and filters by it', () => {
  const list = read('src', 'screens', 'AdminUsers.tsx')
  // Roles stage 4c-2 (0156): no OFF mode and no legacy column.
  assert.doesNotMatch(list, /rolesOn|rolesSystemEnabled|legacyRole|row\.role\b/)
  assert.match(
    list,
    // `!profile_id` names the FK: profile_roles also points at profiles
    // through assigned_by, and PostgREST refuses the ambiguous embed
    // (PGRST201) without the hint.
    /const ASSIGNMENT_EMBED =\s*'profile_roles!profile_id\(role_key,roles\(name_ar,name_en\)\)'/,
  )
  assert.match(
    list,
    /'profile_roles!profile_id!inner\(role_key,roles\(name_ar,name_en\)\)'/,
  )
  assert.ok(!/'profile_roles\(role_key/.test(list))
  assert.ok(!/'profile_roles!inner\(/.test(list))
  // The select names no role column.
  assert.match(
    list,
    /const columns = `id,full_name,must_change_password,created_at,\$\{filtersAssignment \? ASSIGNMENT_EMBED_INNER : ASSIGNMENT_EMBED\}`/,
  )
  // The role column shows the assignment, «بدون دور» without one.
  assert.match(list, /if \(row\.assignedRole\)/)
  assert.match(
    list,
    /return <Badge tone="danger">\{t\('roleUsersNoRole'\)\}<\/Badge>/,
  )
  // The role filter maps to the assignment column.
  assert.match(list, /const ASSIGNED_ROLE_COLUMN = 'profile_roles\.role_key'/)
  assert.match(
    list,
    /filter\.field === 'role'\s+\? \{ \.\.\.filter, field: ASSIGNED_ROLE_COLUMN \}/,
  )
  // Creation (roles stage 4c-1): create-user receives the chosen role key
  // and assigns it itself; the screen only reads whether it was assigned.
  assert.match(list, /role_key: form\.role,/)
  assert.match(list, /if \(result\.role_assigned === false\) \{/)
  // A failed assignment is a role-field message, never a failed creation,
  // and the dialog cannot create the user twice.
  assert.match(list, /role: 'userCreatedRoleNotAssigned'/)
  assert.match(list, /if \(createdUserId\) return/)
  assert.match(list, /\{t\('userOpenPage'\)\}/)
  // One select: the active roles, the six original keys until they load.
  assert.match(list, /const roleOptions = activeRoles\s+\?/)
  assert.match(list, /: USER_ROLES\.map\(\(value\) => \(\{/)
  assert.match(
    list,
    /value=\{form\.role\}\s+disabled=\{Boolean\(createdUserId\)\}\s+onValueChange=\{\(value\) => update\(\{ role: value \}\)\}/,
  )
  assert.match(list, /const invalid = validateUserForm\(form\)/)
})

test('the user page uses the assignment select and plan only', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  // Roles stage 4c-2 (0156): no OFF mode, no legacy role, nothing about the
  // role sent to manage-user.
  assert.doesNotMatch(
    page,
    /rolesOn|legacyRole|legacyRoleChangeBlocked|user\.role\b|loadedUser\.role\b|setRole\(|role: savedRole|'newSystemRole'|roleChangeUseAssignment/,
  )
  assert.match(page, /const \{ roles: activeRoles \} = useActiveRoles\(true\)/)
  // The assignment is read as before and feeds the select.
  assert.match(
    page,
    /\.from\('profile_roles'\)\s+\.select\('role_key,roles\(name_ar,name_en\)'\)\s+\.eq\('profile_id', userId\)\s+\.maybeSingle\(\)/,
  )
  assert.match(page, /setAssignedRoleKey\(assigned\?\.key \?\? ''\)/)
  // The plan decides the assign step.
  assert.match(
    page,
    /planRoleChange\(\{\s+currentAssigned: systemRole\.roleKey,\s+newRoleKey: assignedRoleKey,\s+\}\)/,
  )
  assert.match(
    page,
    /supabase\.rpc\(\s*'admin_assign_profile_role',\s*\{ p_profile_id: userId, p_role_key: assignStep\.roleKey \},/,
  )
  // manage-user receives the record only.
  const update = page.slice(
    page.indexOf("action: 'update'"),
    page.indexOf('company_ids:', page.indexOf("action: 'update'")),
  )
  assert.doesNotMatch(update, /\brole\b/)
  // The record is saved first; the assignment after it.
  assert.ok(
    page.indexOf("action: 'update'") <
      page.indexOf("'admin_assign_profile_role'"),
  )
  // The 0126 codes go under the role field; anything else is form-level.
  assert.match(page, /rolesRpcError\(failure, 'userRoleAssignFailed'\)/)
  assert.match(
    page,
    /if \(mapped\.code && ASSIGN_ROLE_FIELD_CODES\.has\(mapped\.code\)\)/,
  )
  // The one select, with the note.
  assert.match(page, /value=\{assignedRoleKey \|\| undefined\}/)
  assert.match(page, /options=\{assignedRoleOptions\}/)
  assert.match(page, /hint=\{t\('userRoleManagedInSettings'\)\}/)
  assert.match(page, /role: assignedRoleKey,/)
  // The flag is no longer read by the page itself.
  assert.doesNotMatch(page, /\.from\('app_settings'\)/)
})

test('the active roles hook loads the whole small table, active only, while ON', () => {
  const hook = read('src', 'components', 'roles', 'useActiveRoles.ts')
  assert.match(hook, /if \(!enabled\) return/)
  assert.match(
    hook,
    /\.from\('roles'\)\s+\.select\('key,name_ar,name_en,is_system,created_at'\)\s+\.eq\('is_active', true\)/,
  )
  assert.match(hook, /sortRoles\(/)
  assert.doesNotMatch(hook, /\.limit\(|\.range\(/)
})

// --- Translations ----------------------------------------------------------------

test('the wave-23-users translations exist in both languages, Arabic with plain alif', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ wave-23-users — start\n([\s\S]*?)\/\/ wave-23-users — end/g,
    ),
  ]
  assert.equal(blocks.length, 2, 'one block per language')
  const keys = (block) =>
    [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]).sort()
  const [ar, en] = blocks.map((block) => block[1])
  assert.deepEqual(keys(ar), keys(en))
  assert.deepEqual(keys(ar), [
    'userCreatedRoleNotAssigned',
    'userOpenPage',
    'userRoleAssignFailed',
    'userRoleManagedInSettings',
  ])
  assert.doesNotMatch(ar, /[أإآ]/)
  assert.ok(source.indexOf(ar) < source.indexOf('\n  en: {'))
  assert.ok(source.indexOf(en) > source.indexOf('\n  en: {'))
})
