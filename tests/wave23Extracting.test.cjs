// wave 23 — the extraction feature is gated by the permission
// `extracting.view` (migration 0128), on the page and on its API routes,
// instead of the legacy admin role. Source checks only (the page and the
// routes need a browser / server).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('the extraction page opens by extracting.view and fails closed', () => {
  const page = read('src/screens/Extracting.tsx')
  assert.match(page, /usePermissions\(\)/)
  assert.match(page, /permissions\.can\('extracting\.view'\)/)
  // Waits while the permissions load; after a failed load only the legacy
  // admin role passes.
  assert.match(
    page,
    /permissions\.status === 'loading'\) return <FullPageSpinner/,
  )
  assert.match(
    page,
    /permissions\.status === 'ready'\s*\?\s*permissions\.can\('extracting\.view'\)\s*:\s*profile\.role === 'admin'/,
  )
  assert.ok(!/profile\.role !== 'admin'/.test(page))
})

test('the extraction routes require has_permission(extracting.view) with the caller token', () => {
  const server = read('src/lib/extracting/server.ts')
  assert.match(server, /EXTRACTING_PERMISSION = 'extracting\.view'/)
  assert.match(
    server,
    /supabase\.rpc\(\s*'has_permission',\s*\{ p_key: EXTRACTING_PERMISSION \},?\s*\)/,
  )
  assert.match(
    server,
    /allowed !== true\)\s*return \{ response: apiError\('forbidden', 403\) \}/,
  )
  assert.ok(!/select\('role'\)/.test(server))
  assert.ok(!/requireAdmin/.test(server))
  for (const route of [
    'app/api/extracting/ocr/route.ts',
    'app/api/extracting/publish/route.ts',
  ]) {
    const source = read(route)
    assert.match(source, /requireExtractingAccess\(request\)/)
    assert.ok(!/requireAdmin/.test(source), route)
  }
})

test('the not-authorized copy names the permission, plain alif', () => {
  const translations = read('src/i18n/translations.ts')
  const ar = translations.match(/extractingAdminOnly: '([^']+)'/g)
  assert.equal(ar.length, 2)
  assert.match(ar[0], /صفحة استخراج النصوص/)
  assert.ok(!/[أإآ]/.test(ar[0]))
  assert.match(ar[1], /permission/)
})
