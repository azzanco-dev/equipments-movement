const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards the UI half of wave 9: the "notify the foreman" panel of the workshop
// ENTRY form and the admin-maintained mobile number on the user page. The
// database and the API route (migration 0110) stay authoritative; these tests
// keep the client honest about what it sends, shows and never shows.
const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

function load(...parts) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(read(...parts), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports },
  )
  return exports
}


const mobile = load('src', 'lib', 'userMobile.ts')

// «ابلاغ الفورمان» (the manual workshop arrival notice, wave 9) was removed with
// the nested workshop stays (2026-11-14): the foreman of the open project visit
// is told automatically. This file keeps the mobile-number half of wave 9.

test('the mobile helpers mirror admin_set_user_mobile', () => {
  assert.equal(mobile.normalizeUserMobileInput(' 050-123 4567 '), '0501234567')
  assert.equal(mobile.normalizeUserMobileInput(null), '')
  assert.equal(mobile.normalizeUserMobileInput('   '), '')
  for (const value of ['', '0501234567', '+966501234567', '12345678'])
    assert.equal(mobile.isValidUserMobile(value), true, value)
  for (const value of [
    '1234567',
    '+',
    '05012345ab',
    '1234567890123456',
    '++9665',
  ])
    assert.equal(mobile.isValidUserMobile(value), false, value)

  // The client rule is the one the migration enforces.
  const sql = read(
    'supabase',
    'migrations',
    '20261001100000_0110_movement_notices.sql',
  )
  assert.ok(sql.includes("v_mobile !~ '^\\+?[0-9]{8,15}$'"))
  assert.match(
    read('src', 'lib', 'userMobile.ts'),
    /\/\^\\\+\?\[0-9\]\{8,15\}\$\//,
  )

  assert.equal(
    mobile.userMobileErrorCode('invalid_mobile (A mobile number is 8 to 15…)'),
    'invalid_mobile',
  )
  assert.equal(mobile.userMobileErrorCode('admin_required'), 'admin_required')
  assert.equal(mobile.userMobileErrorCode('user_not_found'), 'user_not_found')
  assert.equal(
    mobile.userMobileErrorCode(
      'Could not find the function public.admin_set_user_mobile',
    ),
    'failed',
  )
  assert.equal(mobile.userMobileErrorCode(null), 'failed')
})


test('the user page reads and writes the mobile apart from the record', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  // Since 0113 the number lives in `profile_contacts` (admin or self only).
  assert.match(
    page,
    /\.from\('profile_contacts'\)\s+\.select\('mobile_number'\)\s+\.eq\('user_id', userId\)\s+\.maybeSingle\(\)/,
  )
  assert.doesNotMatch(
    page,
    /\.from\('profiles'\)\s+\.select\('mobile_number'\)/,
  )
  assert.match(
    page,
    /supabase\.rpc\(\s*'admin_set_user_mobile',\s*\{ p_user_id: userId, p_mobile_number: nextMobile \},/,
  )
  assert.match(page, /type="tel"\s+inputMode="tel"\s+dir="ltr"/)
  assert.match(page, /disabled=\{mobileState !== 'loaded'\}/)
  // The record is saved first; the number only after it, and only on change.
  assert.ok(
    page.indexOf("action: 'update'") < page.indexOf("'admin_set_user_mobile'"),
  )
  const types = read('src', 'lib', 'types.ts')
  assert.match(
    types,
    /export interface ProfileContact \{\s+user_id: string\s+mobile_number: string \| null/,
  )
  // The number is no longer a profile field.
  const profileType = types.match(
    /export interface Profile \{[\s\S]*?\r?\n\}/,
  )[0]
  assert.doesNotMatch(profileType, /mobile/)
  // The number never joins the name-only lookup.
  assert.doesNotMatch(
    read('src', 'components', 'details', 'profileNames.ts'),
    /mobile/,
  )
})

test('the wave-9 notice strings exist in both languages, plain alif in Arabic', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-9-notices — start[\s\S]*?\/\/ wave-9-notices — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  const keys = (block) =>
    [...block.matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  for (const key of ['userMobileHint', 'userMobileInvalid'])
    assert.ok(keys(blocks[0]).includes(key), key)
  // The notify-foreman strings went with the panel.
  assert.ok(!keys(blocks[0]).some((key) => key.startsWith('notifyForeman')))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic, 'the Arabic block is missing')
  assert.ok(!/[أإآ]/.test(arabic))
})
