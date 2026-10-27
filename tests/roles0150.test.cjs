// Migration 0150 (owner 2026-10-27, «نبغى نشيل التقسيم هذا وتكون كلها
// واحد», stage 1, «اهم شي مايتغير شي على المستخدمين»): the assigned role
// (`profile_roles`) is the only source of access. is_admin(),
// permission_scope() and current_permissions() read the assignment only;
// guards abort the migration unless the system is ON and the admin parity
// holds, so nobody's access changes; the system can no longer be switched
// off.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const MIGRATION = '20261027100000_0150_roles_single_source.sql'
const sql = fs
  .readFileSync(path.join(root, 'supabase', 'migrations', MIGRATION), 'utf8')
  .replace(/\r\n/g, '\n')
const body = sql
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const fn = (name) => {
  const start = body.indexOf(`FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} is defined`)
  const open = body.indexOf('AS $$', start)
  return body.slice(open, body.indexOf('$$;', open + 5))
}

test('0150 follows 0149', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const index = files.indexOf(MIGRATION)
  assert.ok(index > 0)
  assert.match(files[index - 1], /_0149_/)
})

test('the guards abort unless the system is on and the admin parity holds', () => {
  const guard = body.slice(0, body.indexOf('CREATE OR REPLACE FUNCTION public.is_admin()'))
  assert.match(guard, /IF NOT public\.roles_system_enabled\(\) THEN RAISE EXCEPTION/)
  assert.match(
    guard,
    /WHERE \(p\.role = 'admin'\) IS DISTINCT FROM \(pr\.role_key = 'admin'\) AND \(p\.role = 'admin' OR pr\.role_key = 'admin'\)/,
  )
  assert.match(guard, /IF v_mismatch > 0 THEN RAISE EXCEPTION/)
})

test('is_admin() reads the admin assignment, not profiles.role', () => {
  const definition = fn('is_admin')
  assert.match(definition, /FROM public\.profile_roles WHERE profile_id = auth\.uid\(\) AND role_key = 'admin'/)
  assert.doesNotMatch(definition, /profiles\b(?!_)/)
  assert.match(body, /REVOKE ALL ON FUNCTION public\.is_admin\(\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.is_admin\(\) TO authenticated;/)
})

test('permission_scope() and current_permissions() have no legacy branch', () => {
  for (const name of ['permission_scope', 'current_permissions']) {
    const definition = fn(name)
    assert.match(definition, /FROM public\.profile_roles pr JOIN public\.roles r ON r\.key = pr\.role_key AND r\.is_active/)
    assert.doesNotMatch(definition, /legacy_role_permissions|roles_system_enabled|\bp\.role\b|public\.profiles\b/)
  }
})

test('the roles system can no longer be switched off', () => {
  assert.match(
    body,
    /ALTER FUNCTION public\.set_roles_system_enabled\(boolean, integer\) RENAME TO set_roles_system_enabled_0126;/,
  )
  assert.match(
    body,
    /REVOKE ALL ON FUNCTION public\.set_roles_system_enabled_0126\(boolean, integer\) FROM PUBLIC, anon, authenticated;/,
  )
  const wrapper = fn('set_roles_system_enabled')
  assert.match(wrapper, /OR public\.is_admin\(\) IS NOT TRUE OR public\.has_permission\('settings\.roles'\) IS NOT TRUE THEN RAISE EXCEPTION 'admin_required'/)
  assert.match(wrapper, /IF p_enabled IS NOT TRUE THEN RAISE EXCEPTION 'roles_system_permanent'/)
  assert.match(wrapper, /RETURN public\.set_roles_system_enabled_0126\(p_enabled, p_expected_preview_rows\);/)
})
