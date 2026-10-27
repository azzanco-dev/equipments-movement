// Roles stage 4b (owner 2026-10-27, «ابدا بـ 4b»): a role is changed through
// the assignment alone. Migration 0153 drops the admin parity of
// admin_assign_profile_role (it never reads profiles.role) and moves the
// last-admin rule into it; the user page plans an assign step only and the
// roles page no longer filters candidates or shows a legacy badge.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261027130000_0153_assign_role_without_legacy.sql'
const body = read('supabase', 'migrations', MIGRATION)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')

test('0153 follows 0152', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0152_/)
})

test('the assignment never reads the legacy role and keeps the last admin', () => {
  const start = body.indexOf('AS $$')
  const fn = body.slice(start, body.indexOf('$$;', start + 5))
  assert.doesNotMatch(fn, /\bp\.role\b|v_legacy_role|admin_role_mismatch/)
  assert.match(fn, /OR public\.is_admin\(\) IS NOT TRUE OR public\.has_permission\('settings\.roles'\) IS NOT TRUE THEN RAISE EXCEPTION 'admin_required'/)
  assert.match(fn, /PERFORM 1 FROM public\.profiles p WHERE p\.id = p_profile_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'/)
  assert.match(fn, /IF p_profile_id = auth\.uid\(\) AND v_role\.key <> 'admin' THEN RAISE EXCEPTION 'cannot_change_own_admin'/)
  assert.match(
    fn,
    /IF v_current = 'admin' AND v_role\.key <> 'admin' AND NOT EXISTS \( SELECT 1 FROM public\.profile_roles other WHERE other\.role_key = 'admin' AND other\.profile_id <> p_profile_id \) THEN RAISE EXCEPTION 'last_admin'/,
  )
  assert.match(body, /REVOKE ALL ON FUNCTION public\.admin_assign_profile_role\(uuid, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.admin_assign_profile_role\(uuid, text\) TO authenticated;/)
})

test('last_admin has a safe message on the role field', () => {
  const rolesAdmin = read('src', 'lib', 'rolesAdmin.ts')
  assert.match(rolesAdmin, /^ {2}last_admin: 'rolesErrLastAdmin',$/m)
  assert.match(read('src', 'lib', 'userRoleAssignment.ts'), /'last_admin',/)
})

test('the roles page assigns anyone and shows no legacy badge', () => {
  const tab = read('src', 'components', 'roles', 'RoleUsersTab.tsx')
  assert.doesNotMatch(tab, /\.eq\('role', 'admin'\)|\.neq\('role', 'admin'\)|roleBadge|legacyLabel/)
  assert.doesNotMatch(tab, /select\('id,full_name,role'\)/)
})
