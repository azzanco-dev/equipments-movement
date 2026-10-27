// Roles stage 3 (owner 2026-10-27, «ابدا بالمرحلة الثالثة»): the pickers and
// the companies of a user follow the assigned role's permissions, not the
// legacy role name. Migration 0152 makes `profile_names.role` the
// assignment; the foreman pickers list the roles holding
// movements.site.create (the admin aside), the movement recorder the roles
// holding the context's create key; manage-user stores companies for any
// role and counts the admins by assignment.
//
// Source checks plus the pure rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261027120000_0152_profile_names_assigned_role.sql'

function loadHolders() {
  const source = read('src', 'lib', 'rolePermissionHolders.ts')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === '@/lib/supabaseResult')
        return {
          unwrapRows: (result) => {
            if (result.error) throw new Error('load')
            return result.data ?? []
          },
        }
      throw new Error(`unexpected import ${name}`)
    },
  })
  return module.exports
}

test('0152 follows 0151 and keeps the three columns of profile_names', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const index = files.indexOf(MIGRATION)
  assert.match(files[index - 1], /_0151_/)
  const body = read('supabase', 'migrations', MIGRATION)
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
  assert.match(
    body,
    /CREATE OR REPLACE VIEW public\.profile_names WITH \(security_invoker = false\) AS SELECT p\.id, p\.full_name, pr\.role_key AS role FROM public\.profiles p LEFT JOIN public\.profile_roles pr ON pr\.profile_id = p\.id;/,
  )
  assert.match(body, /REVOKE ALL ON public\.profile_names FROM PUBLIC, anon; GRANT SELECT ON public\.profile_names TO authenticated;/)
})

test('a foreman role records projects and is not the admin', () => {
  const { isForemanRoleKey } = loadHolders()
  const keys = new Set(['admin', 'supervisor', 'site_lead'])
  assert.equal(isForemanRoleKey('supervisor', keys), true)
  assert.equal(isForemanRoleKey('site_lead', keys), true)
  assert.equal(isForemanRoleKey('admin', keys), false)
  assert.equal(isForemanRoleKey('workshop', keys), false)
  assert.equal(isForemanRoleKey('', keys), false)
  assert.equal(isForemanRoleKey(null, keys), false)
})

test('the role holders are read from active roles only', () => {
  const source = read('src', 'lib', 'rolePermissionHolders.ts')
  assert.match(source, /\.select\('role_key,roles!inner\(is_active\)'\)\s+\.eq\('permission_key', permissionKey\)\s+\.eq\('roles\.is_active', true\)/)
  assert.match(source, /roleKeysHolding\(client, 'movements\.site\.create'\)\)\.filter\(\s+\(key\) => key !== 'admin',?\s+\)/)
})

test('no picker lists a legacy role name any more', () => {
  for (const file of [
    ['src', 'lib', 'foremanFilter.ts'],
    ['src', 'screens', 'admin-home', 'LogsScreen.tsx'],
  ]) {
    const source = read(...file)
    assert.doesNotMatch(source, /\.eq\('role', 'supervisor'\)/, file.join('/'))
    assert.match(source, /const roleKeys = await foremanRoleKeys\((client|supabase)\)/)
    assert.match(source, /\.in\('role', roleKeys\)/)
  }
  const edit = read('src', 'components', 'movement', 'MovementEditDialog.tsx')
  assert.doesNotMatch(edit, /RECORDER_ROLES/)
  assert.match(edit, /site \? 'movements\.site\.create' : 'movements\.workshop\.create'/)
  assert.match(edit, /\.from\('profile_names'\)\s+\.select\('id,full_name'\)\s+\.in\('role', roleKeys\)/)
})

test('the companies of a user follow the role permission', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.match(page, /rolesOn && foremanKeys && systemRoleLoaded\s+\? isForemanRoleKey\(roleKey, foremanKeys\)\s+: legacy === 'supervisor'/)
  assert.match(page, /company_ids: companiesApply/)
  assert.match(page, /\{companiesApply && \(/)
  assert.match(page, /\.\.\.\(savedCompaniesApply/)
  const fn = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.match(fn, /if \(companyIds\.length > 0\) \{/)
  assert.doesNotMatch(fn, /role === 'supervisor'/)
  // The last-admin count moved into admin_assign_profile_role (0153,
  // roles stage 4c-1): manage-user no longer changes the role at all.
  assert.doesNotMatch(fn, /\.eq\('role', 'admin'\)/)
})

test('the users list does not sort by the hidden legacy role', () => {
  const list = read('src', 'screens', 'AdminUsers.tsx')
  assert.match(list, /sortable: !rolesOn,/)
})
