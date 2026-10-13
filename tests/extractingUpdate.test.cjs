// Extraction page: update an existing person matched by the residence number
// (owner request 2026-10-13). The update ability is the admin's alone
// (`public.is_admin()` with the caller's token), whatever permission opened
// the page. Source checks only (the page and the routes need a browser /
// server); the payload rules are in extracting-publish.test.cjs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('the publish route gates update mode on is_admin before any write', () => {
  const route = read('app/api/extracting/publish/route.ts')
  const server = read('src/lib/extracting/server.ts')
  assert.match(server, /supabase\.rpc\('is_admin'\)/)
  assert.match(server, /return !error && data === true/)
  const gate = route.indexOf(
    "mode === 'update' && !(await callerIsAdmin(auth.supabase))",
  )
  assert.ok(gate > -1, 'update mode calls callerIsAdmin')
  assert.match(
    route.slice(gate),
    /^[^\n]*\n\s*return apiError\('forbidden', 403\)/,
  )
  // The gate precedes every write of the handler.
  const handler = route.indexOf('export async function POST')
  const firstWrite = route.indexOf(
    'publishCurrentSystem(auth.supabase',
    handler,
  )
  assert.ok(gate > handler && gate < firstWrite)
  // No client flag is trusted: the mode comes from the parser only.
  assert.match(route, /const \{ data, targets, mode \} = parsed/)
  assert.ok(!/canUpdate/.test(route), 'the publish route ignores canUpdate')
  // The current-system update rewrites only the non-empty mapped columns.
  assert.match(route, /\.update\(currentSystemDriverUpdatePayload\(data\)\)/)
  // The Employee PUT comes from the update payload; an existing User is never
  // modified (no PUT /api/resource/User).
  assert.match(route, /erpEmployeeUpdatePayload\(data, availableFields\)/)
  assert.ok(!/resource\/User\/[^`]*`,\s*\{\s*method: 'PUT'/.test(route))
})

test('the lookup route exists behind requireExtractingAccess and is read-only', () => {
  const route = read('app/api/extracting/lookup/route.ts')
  assert.match(route, /requireExtractingAccess\(request\)/)
  assert.match(route, /parseLookupRequest\(/)
  assert.match(route, /apiError\('invalid_id_number', 400\)/)
  assert.match(route, /callerIsAdmin\(auth\.supabase\)/)
  assert.match(route, /findEmployeeByResidence\(/)
  assert.match(route, /\{ configured: false \}/)
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(route))
  assert.ok(!/method: '(POST|PUT|DELETE)'/.test(route))
  // One ERPNext implementation, shared through the erpnext module.
  const publish = read('app/api/extracting/publish/route.ts')
  assert.ok(!/async function findEmployeeByResidence/.test(publish))
  assert.match(publish, /from '@\/lib\/extracting\/erpnext'/)
})

test("the page sends mode 'update' only when the lookup allows it", () => {
  const hook = read('src/components/extracting/useExtraction.ts')
  assert.match(hook, /publishExtraction\(token, form, targets, mode\)/)
  assert.match(hook, /const mode = publishModeFor\(/)
  assert.match(hook, /LOOKUP_DEBOUNCE_MS = 400/)
  assert.match(hook, /isValidIdNumber\(idNumber\)/)
  const lookup = read('src/lib/extracting/lookup.ts')
  assert.match(
    lookup,
    /result\.canUpdate && hasExistingRecord\(result, targets\)\s*\?\s*'update'\s*:\s*'create'/,
  )
  const page = read('src/screens/Extracting.tsx')
  assert.match(
    page,
    /<ExistingRecordCard lookup=\{lookup\} targets=\{targets\} \/>/,
  )
  assert.match(
    page,
    /mode === 'update' \? 'extractingUpdateSubmit' : 'extractingSubmit'/,
  )
  const card = read('src/components/extracting/ExistingRecordCard.tsx')
  assert.match(card, /lookup\.status === 'loading'/)
  assert.match(card, /lookup\.status === 'error'/)
  assert.match(card, /extractingLookupAdminOnly/)
  assert.match(card, /extractingLookupNone/)
})

test('the new statuses and lookup copy exist in both languages, plain alif', () => {
  const translations = read('src/i18n/translations.ts')
  const messages = read('src/lib/extracting/messages.ts')
  assert.match(messages, /updated: 'extractingStatusUpdated'/)
  assert.match(messages, /local_update_failed: 'extractingErrLocalUpdate'/)
  assert.match(messages, /lookup_failed: 'extractingErrLookup'/)
  const form = read('src/lib/extracting/form.ts')
  assert.match(form, /\| 'updated'/)
  assert.match(form, /export const UPDATE_FIELDS = \[/)
  // The update notice names the allowlist from UPDATE_FIELDS itself.
  const card = read('src/components/extracting/ExistingRecordCard.tsx')
  assert.match(
    card,
    /UPDATE_FIELDS\.map\(\(key\) => t\(FIELD_LABELS\[key\]\)\)/,
  )
  assert.match(card, /extractingUpdateNoticeSuffix/)
  for (const key of [
    'extractingStatusUpdated',
    'extractingErrLocalUpdate',
    'extractingErrLookup',
    'extractingUpdateSubmit',
    'extractingUpdateNotice',
    'extractingUpdateNoticeSuffix',
    'extractingLookupSection',
    'extractingLookupLoading',
    'extractingLookupNone',
    'extractingLookupAdminOnly',
    'extractingLookupErpNotConfigured',
  ]) {
    const matches = translations.match(new RegExp(`${key}:\\s*'([^']+)'`, 'g'))
    assert.equal(matches?.length, 2, key)
    assert.ok(!/[أإآ]/.test(matches[0]), `${key} uses plain alif`)
  }
  assert.match(translations, /extractingUpdateSubmit: 'تحديث السجل الموجود'/)
  assert.match(translations, /extractingLookupSection: 'سجل موجود'/)
  assert.match(translations, /extractingLookupNone: 'لا يوجد سجل بهذا الرقم'/)
  assert.match(
    translations,
    /extractingLookupAdminOnly: 'التحديث متاح للادمن فقط'/,
  )
})
