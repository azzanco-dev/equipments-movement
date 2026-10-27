// wave 23 (routing by permissions, step 3) — the users list, the user page
// and the header while the roles system (0126) is ON: ONE role in the UI, the
// `profile_roles` assignment, with the legacy `profiles.role` derived from it
// (src/lib/userRoleAssignment.ts). With the flag OFF or unknown the screens
// keep the legacy role exactly as before.
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
const { legacyRoleFor, planRoleChange, legacyRoleAfter } = lib

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
  assert.equal(lib.NARROWEST_LEGACY_ROLE, 'monitor')
})

// --- legacyRoleFor -----------------------------------------------------------

test('legacyRoleFor: a system role is its own legacy role', () => {
  for (const key of SYSTEM)
    for (const current of [...SYSTEM, null])
      assert.equal(legacyRoleFor(key, current), key, `${key} from ${current}`)
})

test('legacyRoleFor: a custom role keeps the legacy role, except admin → monitor', () => {
  for (const custom of ['foreman_lead', 'equipment_officer', 'purchasing'])
    for (const current of SYSTEM)
      assert.equal(
        legacyRoleFor(custom, current),
        current === 'admin' ? 'monitor' : current,
        `${custom} from ${current}`,
      )
  // A new user (no legacy role yet) with a custom role gets the narrowest.
  assert.equal(legacyRoleFor('foreman_lead', null), 'monitor')
  // Never admin.
  for (const current of [...SYSTEM, null])
    assert.notEqual(legacyRoleFor('purchasing', current), 'admin')
})

// --- planRoleChange ------------------------------------------------------------

const plan = (currentLegacy, currentAssigned, newRoleKey) =>
  plain(planRoleChange({ currentLegacy, currentAssigned, newRoleKey }))

// Roles stage 4b (owner 2026-10-27, migration 0153): a role is changed
// through the assignment alone; the legacy role is never written.
test('plan: any change is one assign step, never a legacy change', () => {
  for (const current of SYSTEM)
    for (const assigned of [...SYSTEM, 'foreman_lead', null])
      for (const target of [...SYSTEM, 'foreman_lead', 'purchasing']) {
        const steps = plan(current, assigned, target)
        assert.ok(
          steps.every((step) => step.kind === 'assign'),
          `${current}/${assigned} → ${target}`,
        )
        assert.equal(legacyRoleAfter(steps, current), current)
        if (assigned === target) assert.deepEqual(steps, [])
        else assert.deepEqual(steps, [{ kind: 'assign', roleKey: target }])
      }
})

test('plan: to and from admin is an assign like any other', () => {
  assert.deepEqual(plan('supervisor', 'supervisor', 'admin'), [
    { kind: 'assign', roleKey: 'admin' },
  ])
  assert.deepEqual(plan('admin', 'admin', 'equipment_officer'), [
    { kind: 'assign', roleKey: 'equipment_officer' },
  ])
  assert.deepEqual(plan('monitor', null, 'admin'), [
    { kind: 'assign', roleKey: 'admin' },
  ])
})

test('legacyRoleAfter reads the plan', () => {
  assert.equal(
    legacyRoleAfter([{ kind: 'changeLegacy', to: 'monitor' }], 'admin'),
    'monitor',
  )
  assert.equal(
    legacyRoleAfter([{ kind: 'assign', roleKey: 'x' }], 'supervisor'),
    'supervisor',
  )
  assert.equal(legacyRoleAfter([], 'workshop'), 'workshop')
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

test('PermissionsContext reads the flag and the own assignment once, apart from the permissions', () => {
  const ctx = read('src', 'auth', 'PermissionsContext.tsx')
  assert.match(
    ctx,
    /\.from\('app_settings'\)\s+\.select\('value'\)\s+\.eq\('key', 'roles_system'\)\s+\.maybeSingle\(\)/,
  )
  assert.match(
    ctx,
    /\.from\('profile_roles'\)\s+\.select\('role_key,roles\(name_ar,name_en\)'\)\s+\.eq\('profile_id', forUser\)\s+\.maybeSingle\(\)/,
  )
  assert.match(ctx, /rolesSystemEnabled: boolean \| null/)
  assert.match(ctx, /assignedRole: AssignedRole \| null/)
  // Their failure never turns the permissions status to error: the status is
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

test('the users list: ON reads the assignment and filters by it; OFF keeps the legacy select', () => {
  const list = read('src', 'screens', 'AdminUsers.tsx')
  assert.match(list, /const rolesOn = rolesSystemEnabled === true/)
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
  // OFF: exactly the previous select.
  assert.match(list, /: 'id,full_name,role,must_change_password,created_at'/)
  // ON: the role column shows the assignment, the legacy badge otherwise.
  assert.match(list, /if \(rolesOn && row\.assignedRole\)/)
  assert.match(
    list,
    /const badge = roleBadge\(row\.role\)\s+return <Badge tone=\{badge\.tone\}>\{t\(badge\.key\)\}<\/Badge>/,
  )
  // The role filter maps to the assignment column while ON.
  assert.match(list, /const ASSIGNED_ROLE_COLUMN = 'profile_roles\.role_key'/)
  assert.match(
    list,
    /filter\.field === 'role'\s+\? \{ \.\.\.filter, field: ASSIGNED_ROLE_COLUMN \}/,
  )
  // Creation (roles stage 4c-1): create-user receives the chosen role key
  // and assigns it itself; the screen only reads whether it was assigned.
  assert.match(list, /role_key: chosenRole,/)
  assert.match(list, /if \(result\.role_assigned === false\) \{/)
  // A failed assignment is a role-field message, never a failed creation,
  // and the dialog cannot create the user twice.
  assert.match(list, /role: 'userCreatedRoleNotAssigned'/)
  assert.match(list, /if \(createdUserId\) return/)
  assert.match(list, /\{t\('userOpenPage'\)\}/)
  // OFF: the legacy options and today's select.
  assert.match(list, /const legacyRoleOptions = USER_ROLES\.map/)
  assert.match(
    list,
    /value=\{form\.role\}\s+disabled=\{Boolean\(createdUserId\)\}\s+onValueChange=\{\(value\) =>\s+update\(\{ role: value as UserRole \}\)/,
  )
})

test('the user page: ON uses the assignment select and plan; OFF keeps the legacy select and the blocked-change check', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.match(page, /const rolesOn = rolesSystemEnabled === true/)
  assert.match(
    page,
    /const \{ roles: activeRoles \} = useActiveRoles\(rolesOn\)/,
  )
  // The assignment is read as before and feeds the select.
  assert.match(
    page,
    /\.from\('profile_roles'\)\s+\.select\('role_key,roles\(name_ar,name_en\)'\)\s+\.eq\('profile_id', userId\)\s+\.maybeSingle\(\)/,
  )
  assert.match(page, /setAssignedRoleKey\(assigned\?\.key \?\? ''\)/)
  // The plan decides the legacy role and the assign step.
  assert.match(
    page,
    /planRoleChange\(\{\s+currentLegacy: user\.role,\s+currentAssigned: systemRole\.roleKey,\s+newRoleKey: assignedRoleKey,\s+\}\)/,
  )
  assert.match(
    page,
    /const legacyRoleToSave =\s+rolesOn && user \? legacyRoleAfter\(rolePlan, user\.role\) : role/,
  )
  assert.match(page, /role: savedRole,/)
  assert.match(
    page,
    /supabase\.rpc\(\s*'admin_assign_profile_role',\s*\{ p_profile_id: userId, p_role_key: assignStep\.roleKey \},/,
  )
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
  // ON: the roles-system select (the legacy select hidden) with the note.
  assert.match(page, /rolesOn \? \(/)
  assert.match(page, /value=\{assignedRoleKey \|\| undefined\}/)
  assert.match(page, /options=\{assignedRoleOptions\}/)
  assert.match(
    page,
    /hint=\{rolesOn \? t\('userRoleManagedInSettings'\) : undefined\}/,
  )
  // OFF: today's legacy select and the blocked-change check are intact.
  assert.match(
    page,
    /value=\{role\}\s+onValueChange=\{\(value\) => \{\s+clearError\('role'\)\s+setRole\(value as UserRole\)\s+if \(value !== 'supervisor'\) setCompanies\(\[\]\)\s+\}\}\s+options=\{roleOptions\}/,
  )
  assert.match(page, /legacyRoleChangeBlocked\(\{/)
  assert.match(page, /role: 'roleChangeUseAssignment',/)
  // The read-only "new system role" line exists only while OFF.
  assert.match(
    page,
    /\.\.\.\(rolesOn\s+\? \[\]\s+: \[\s+\{\s+key: 'newSystemRole'/,
  )
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
