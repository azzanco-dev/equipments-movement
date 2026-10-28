// Roles stage 4c-1 (owner 2026-10-27, «ابدا بـ 4c»): nothing writes
// profiles.role any more. create-user assigns the chosen role itself,
// manage-user never writes the role, and migration 0154 gives new accounts
// the placeholder `monitor`, drops the sync trigger and the legacy writer.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261027140000_0154_stop_writing_legacy_role.sql'
const body = read('supabase', 'migrations', MIGRATION)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')

test('0154 follows 0153', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0153_/)
})

test('new accounts get the placeholder; no trigger copies the legacy role', () => {
  assert.match(
    body,
    /INSERT INTO public\.profiles\(id, full_name, role\) VALUES \( NEW\.id, COALESCE\(NEW\.raw_user_meta_data->>'full_name', NEW\.email\), 'monitor' \);/,
  )
  assert.doesNotMatch(body, /raw_app_meta_data/)
  assert.match(body, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(body, /DROP TRIGGER IF EXISTS sync_profile_role_assignment ON public\.profiles;/)
  assert.match(body, /DROP FUNCTION IF EXISTS public\.sync_profile_role_assignment\(\);/)
  assert.match(body, /DROP FUNCTION IF EXISTS public\.admin_set_user_role\(uuid, text\);/)
})

test('create-user assigns the chosen role as the caller', () => {
  const fn = read('supabase', 'functions', 'create-user', 'index.ts')
  assert.match(fn, /const roleKey = String\(role_key \?\? role \?\? ''\)\.trim\(\)/)
  assert.match(fn, /\.from\('roles'\)\s+\.select\('key,is_active'\)\s+\.eq\('key', roleKey\)/)
  // Roles stage 4c-2 (0156): no role in app_metadata any more.
  assert.match(fn, /app_metadata: \{ admin_created: true \}/)
  assert.match(
    fn,
    /await userClient\.rpc\(\s+'admin_assign_profile_role',\s+\{ p_profile_id: authData\.user\.id, p_role_key: roleKey \},?\s+\)/,
  )
  assert.match(fn, /role_assigned: !assignError/)
})

test('manage-user never writes the role', () => {
  const fn = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.doesNotMatch(fn, /body\.role|role: string|\{ full_name: fullName, role \}/)
  assert.match(fn, /\} = \{ full_name: fullName \}/)
})

test('the add-user screen sends the role key and reports a failed assignment', () => {
  const screen = read('src', 'screens', 'AdminUsers.tsx')
  assert.match(screen, /role_key: form\.role,/)
  assert.match(screen, /if \(result\.role_assigned === false\) \{/)
  assert.doesNotMatch(screen, /'admin_assign_profile_role'/)
})
