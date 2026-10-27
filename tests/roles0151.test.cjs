// Migration 0151 (owner 2026-10-27, roles stage 2, «ابدا»): every role is
// equal but the admin. The five non-admin original roles stop being locked
// system roles; the legacy sync never copies a value whose role is gone;
// select_profiles reads the target's assigned role. The movement API asks
// has_permission instead of reading profiles.role.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261027110000_0151_roles_equal.sql'
const body = read('supabase', 'migrations', MIGRATION)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()

test('0151 follows 0150', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const index = files.indexOf(MIGRATION)
  assert.ok(index > 0)
  assert.match(files[index - 1], /_0150_/)
})

test('only the admin role stays a locked system role', () => {
  assert.match(
    body,
    /UPDATE public\.roles SET is_system = false, updated_at = now\(\) WHERE key IN \( 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor' \) AND is_system;/,
  )
  assert.doesNotMatch(body, /WHERE key IN \([^)]*'admin'/)
})

test('the legacy sync copies only a value whose role exists', () => {
  const start = body.indexOf('FUNCTION public.sync_profile_role_assignment()')
  const fn = body.slice(start, body.indexOf('$$;', start))
  assert.match(
    fn,
    /BEGIN IF NOT EXISTS \(SELECT 1 FROM public\.roles r WHERE r\.key = NEW\.role\) THEN RETURN NULL; END IF; IF TG_OP = 'INSERT' THEN/,
  )
  assert.match(fn, /RAISE EXCEPTION 'roles_system_active_use_assignment'/)
  assert.match(
    body,
    /REVOKE ALL ON FUNCTION public\.sync_profile_role_assignment\(\) FROM PUBLIC, anon, authenticated;/,
  )
})

test('select_profiles reads the assigned role for the workshop scope', () => {
  const start = body.indexOf('CREATE POLICY select_profiles')
  const policy = body.slice(start, body.indexOf(';', start))
  assert.match(
    policy,
    /EXISTS \( SELECT 1 FROM public\.profile_roles pr WHERE pr\.profile_id = profiles\.id AND pr\.role_key IN \('workshop', 'assistant_workshop_manager', 'workshop_manager'\) \)/,
  )
  assert.doesNotMatch(policy, /\bAND role IN\b/)
})

test('the movement and photo routes ask for the permission, not the role', () => {
  const create = read('app', 'api', 'movements', 'route.ts')
  assert.match(
    create,
    /movementContext === 'workshop'\s+\? 'movements\.workshop\.create'\s+: 'movements\.site\.create'/,
  )
  for (const route of [
    ['app', 'api', 'movements', 'photo-uploads', 'route.ts'],
    ['app', 'api', 'movements', '[id]', 'photos', 'route.ts'],
  ]) {
    const source = read(...route)
    assert.match(source, /p_key: 'movements\.photos\.manage'/)
    assert.match(source, /if \(!auth\.canManagePhotos\)/)
    assert.doesNotMatch(source, /auth\.role|select\('role'\)/)
  }
})

test('the roles page keeps the six original roles first by key', () => {
  const rows = read('src', 'components', 'roles', 'roleRows.ts')
  assert.match(rows, /const rank = \(row: T\) => \{\s+const index = SYSTEM_ROLE_ORDER\.indexOf\(row\.key\)/)
})
