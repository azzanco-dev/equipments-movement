// 0211 (owner 2026-11-23): «ادارة المستخدمين» can be given to any role, and
// a user manager who is not the admin can never reach an admin account.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const migration = read(
  'supabase',
  'migrations',
  '20261123120000_0211_users_manage_any_role.sql',
)

test('users.manage is no longer admin only; settings.roles stays', () => {
  assert.match(
    migration,
    /UPDATE public\.permissions\s+SET admin_only = false\s+WHERE key = 'users\.manage';/,
  )
  assert.doesNotMatch(migration, /settings\.roles'\s*;/)
})

test('role assignment by a non-admin user manager is bounded', () => {
  assert.match(migration, /has_permission\('users\.manage'\) IS NOT TRUE/)
  assert.match(migration, /'cannot_change_own_role'/)
  assert.match(
    migration,
    /IF v_role\.key = 'admin' OR v_current = 'admin' THEN\s+RAISE EXCEPTION 'admin_role_admin_only'/,
  )
  assert.match(migration, /'last_admin'/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_assign_profile_role\(uuid, text\) FROM PUBLIC, anon;/,
  )
})

test('an admin profile is updated and deleted by the admin only', () => {
  assert.match(migration, /FUNCTION public\.profile_is_admin_user\(p_profile_id uuid\)/)
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  for (const policy of ['update_profiles', 'delete_profiles'])
    assert.match(
      migration,
      new RegExp(
        String.raw`CREATE POLICY ${policy} ON public\.profiles[\s\S]*?NOT public\.profile_is_admin_user\(id\)`,
      ),
    )
})

test('the Edge Functions refuse a non-admin on the admin role or account', () => {
  const createUser = read('supabase', 'functions', 'create-user', 'index.ts')
  const manageUser = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.match(createUser, /if \(roleKey === 'admin'\) \{[\s\S]*?rpc\('is_admin'\)/)
  assert.match(manageUser, /\.eq\('role_key', 'admin'\)[\s\S]*?rpc\('is_admin'\)/)
  assert.match(manageUser, /code: 'admin_role_admin_only'/)
})

test('the screens hide the admin role and lock an admin account', () => {
  const list = read('src', 'screens', 'AdminUsers.tsx')
  const detail = read('src', 'screens', 'UserDetail.tsx')
  for (const source of [list, detail])
    assert.match(source, /const callerIsAdmin = permissionState\.can\('settings\.roles'\)/)
  assert.match(list, /\.filter\(\(option\) => callerIsAdmin \|\| option\.value !== 'admin'\)/)
  assert.match(list, /!callerIsAdmin && row\.assignedRole\?\.key === 'admin'/)
  assert.match(detail, /const adminTargetLocked = !callerIsAdmin && savedAssignedKey === 'admin'/)
  assert.match(detail, /\{canSaveUser && \(/)
})
