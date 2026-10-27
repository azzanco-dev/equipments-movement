// Roles stage 4a (2026-10-27) — the client never decides from the signed-in
// user's legacy role (`profiles.role`) any more: no fallback while the
// permissions load or after a failed load, no admin gate on the role. Access
// comes only from the assigned role's permissions (`usePermissions()`).
// Static checks only; the ready-state equivalence per role is proven in
// tests/wave23Nav, wave23Shell and wave24Actions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

/** Files owned elsewhere or review-only sample data, never checked here. */
const EXCLUDED = [
  /^src\/screens\/Extracting\.tsx$/,
  /^src\/components\/extracting\//,
  /^src\/lib\/extracting\//,
  /^src\/screens\/ui-kit\//,
]
/**
 * Reads of ANOTHER user's legacy role as display data (the role badge of a
 * listed user), not a decision for the signed-in user. Stage 4b retires them.
 */
const DISPLAY_ONLY = new Set(['src/components/roles/RoleUsersTab.tsx'])

function sourceFiles() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name))
        files.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }
  walk(SRC)
  return files.filter((file) => !EXCLUDED.some((re) => re.test(file)))
}

test('no file under src/ decides by profile.role', () => {
  const files = sourceFiles()
  assert.ok(files.length > 100, `${files.length} files`)
  const offenders = []
  for (const file of files) {
    if (DISPLAY_ONLY.has(file)) continue
    const source = read(...file.split('/'))
    if (/\bprofile\??\.role\b/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

test('the signed-in user role is never taken from useAuth()', () => {
  for (const file of sourceFiles()) {
    const source = read(...file.split('/'))
    assert.doesNotMatch(
      source,
      /const \{[^}]*\brole\b[^}]*\} = useAuth\(\)/,
      file,
    )
    assert.doesNotMatch(source, /useAuth\(\)\.profile\??\.role/, file)
  }
})

test('the changed areas carry no role rule and no role parameter', () => {
  const actions = read('src', 'lib', 'actionPermissions.ts')
  assert.doesNotMatch(actions, /\brole\s*[!=]==/)
  assert.doesNotMatch(actions, /LegacyRole|byRole|WORKSHOP_ROLES/)
  const nav = read('src', 'lib', 'navPermissions.ts')
  assert.doesNotMatch(nav, /LEGACY_\w+_BY_ROLE/)
  assert.match(nav, /export function planShell\(state: NavPermissionState\)/)
  assert.match(
    nav,
    /export function visibleNavItems\(\s*state: NavPermissionState,\s*routable\?: ReadonlySet<string>,\s*\)/,
  )
  const scope = read('src', 'lib', 'homeScope.ts')
  assert.doesNotMatch(scope, /role === '/)
  const permissions = read('src', 'lib', 'permissions.ts')
  assert.match(
    permissions,
    /export function rolesPageAccess\(\s*status: PermissionsStatus,\s*map: ReadonlyMap<string, PermissionScope>,\s*\)/,
  )
  const gallery = read('src', 'lib', 'movementPhotoGallery.ts')
  assert.doesNotMatch(gallery, /\.role\b/)
})

test('the review pages are gated on settings.roles, fail closed', () => {
  for (const file of [
    ['src', 'screens', 'UiKit.tsx'],
    ['src', 'screens', 'sales', 'PurchasingStructure.tsx'],
  ]) {
    const source = read(...file)
    const name = file.join('/')
    assert.match(
      source,
      /const access = rolesPageAccess\(permissions\.status, permissions\.permissions\)/,
      name,
    )
    assert.match(
      source,
      /if \(access === 'loading'\) return <FullPageSpinner \/>/,
      name,
    )
    assert.match(source, /if \(access !== 'allowed'\)/, name)
    assert.doesNotMatch(source, /profile\??\.role\b/, name)
  }
})

test('the load-error copy exists in Arabic and English, without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const values = [
    ...source.matchAll(/\n\s+permissionsLoadError:\s*\n?\s*'([^']*)'/g),
  ].map((match) => match[1])
  assert.equal(values.length, 2)
  assert.doesNotMatch(values[0], /[أإآ]/)
  assert.match(values[0], /صلاحيات/)
  assert.match(values[1], /permissions/)
})
