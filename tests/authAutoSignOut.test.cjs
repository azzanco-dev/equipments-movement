// EM-174 (owner 2026-11-01, «حل EM-174»): an automatic sign-out — the auth
// client dropping the session after a refresh failed with a non-network
// error — is remembered with its cause in localStorage, silently (owner:
// no message for users); the owner reads it when the case repeats.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
// The module runs in its own vm realm; compare plain data, not realms.
const asData = (value) => JSON.parse(JSON.stringify(value))

/** Loads src/lib/authDiagnostics.ts in a sandbox with a fake localStorage. */
function loadDiagnostics(globals = {}) {
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  const sandbox = vm.createContext({ localStorage, ...globals })
  const file = path.join(root, 'src', 'lib', 'authDiagnostics.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInContext(`(function (exports, require) {${output}\n})`, sandbox, {
    filename: file,
  })(exports, (requested) => {
    throw new Error(`Unexpected module: ${requested}`)
  })
  return { diagnostics: exports, store }
}

test('the debug hook keeps the last auth error and prints nothing', () => {
  const { diagnostics } = loadDiagnostics()
  assert.equal(diagnostics.lastRecordedAuthError(), null)
  diagnostics.recordAuthDebug(
    'GoTrueClient@0 #_autoRefreshTokenTick()',
    'begin',
  )
  assert.equal(diagnostics.lastRecordedAuthError(), null)
  // The shape auth-js hands to its logger from _callRefreshToken / _recoverAndRefresh.
  diagnostics.recordAuthDebug('#_callRefreshToken(abcde...)', 'error', {
    name: 'AuthApiError',
    message: 'Invalid Refresh Token: Already Used',
    status: 400,
    code: 'refresh_token_already_used',
  })
  assert.deepEqual(asData(diagnostics.lastRecordedAuthError()), {
    name: 'AuthApiError',
    message: 'Invalid Refresh Token: Already Used',
    status: 400,
    code: 'refresh_token_already_used',
  })
  // A plain string or a session object is not an error.
  diagnostics.recordAuthDebug('#_recoverAndRefresh()', 'session from storage', {
    access_token: 'x',
    user: { id: 'u' },
  })
  assert.equal(
    diagnostics.lastRecordedAuthError().code,
    'refresh_token_already_used',
  )
  diagnostics.resetRecordedAuthError()
  assert.equal(diagnostics.lastRecordedAuthError(), null)
})

test('an automatic sign-out is remembered with the error and read back', () => {
  const { diagnostics, store } = loadDiagnostics({
    navigator: { onLine: false },
    document: { visibilityState: 'hidden' },
  })
  diagnostics.recordAuthDebug('x', 'error', {
    name: 'AuthApiError',
    message: 'Session from session_id claim in JWT does not exist',
    status: 403,
    code: 'session_not_found',
  })
  const at = Date.parse('2026-11-01T06:12:00Z')
  const info = diagnostics.rememberAutoSignOut(at)
  assert.deepEqual(asData(info), {
    at,
    error: {
      name: 'AuthApiError',
      message: 'Session from session_id claim in JWT does not exist',
      status: 403,
      code: 'session_not_found',
    },
    online: false,
    visible: false,
  })
  assert.ok(store.has(diagnostics.AUTO_SIGN_OUT_STORAGE_KEY))
  assert.deepEqual(asData(diagnostics.readAutoSignOut()), asData(info))
  // Saudi time (UTC+03:00), then the error, then the network and visibility.
  assert.equal(
    diagnostics.describeAutoSignOut(info),
    '2026-11-01 09:12 · session_not_found: Session from session_id claim in JWT does not exist · offline · hidden',
  )
  diagnostics.clearAutoSignOut()
  assert.equal(diagnostics.readAutoSignOut(), null)
})

test('without a captured error the line says so; broken storage reads as nothing', () => {
  const { diagnostics } = loadDiagnostics()
  const info = diagnostics.rememberAutoSignOut(
    Date.parse('2026-11-01T21:30:00Z'),
  )
  assert.equal(info.error, null)
  assert.equal(info.online, null)
  assert.equal(info.visible, null)
  assert.equal(
    diagnostics.describeAutoSignOut(info),
    '2026-11-02 00:30 · no error captured',
  )
  const { diagnostics: broken, store } = loadDiagnostics()
  store.set(broken.AUTO_SIGN_OUT_STORAGE_KEY, '{not json')
  assert.equal(broken.readAutoSignOut(), null)
  store.set(broken.AUTO_SIGN_OUT_STORAGE_KEY, JSON.stringify({ error: 'x' }))
  assert.equal(broken.readAutoSignOut(), null)
})

test('the client, the provider and the login screen are wired', () => {
  const client = read('src', 'lib', 'supabase.ts')
  assert.match(client, /debug: recordAuthDebug,/)
  // The option is a reference, so the security test's auth block regex still
  // sees detectSessionInUrl and flowType.
  const auth = client.match(/auth:\s*\{([\s\S]*?)\}/)
  assert.match(auth[1], /detectSessionInUrl:\s*false/)
  assert.match(auth[1], /flowType:\s*'pkce'/)

  const provider = read('src', 'auth', 'AuthContext.tsx')
  assert.match(
    provider,
    /if \(event === 'SIGNED_OUT'\) \{\s+if \(!userSignOutRef\.current && currentUserIdRef\.current\)\s+rememberAutoSignOut\(\)/,
  )
  assert.match(
    provider,
    /userSignOutRef\.current = true\s+try \{\s+await supabase\.auth\.signOut\(\)/,
  )
  assert.match(provider, /clearAutoSignOut\(\)\s+resetRecordedAuthError\(\)/)
  // Nothing reaches the user (owner 2026-11-01): no state, no login notice.
  assert.doesNotMatch(provider, /autoSignOut:|readAutoSignOut/)
  const screen = read('src', 'screens', 'AuthScreen.tsx')
  assert.doesNotMatch(screen, /autoSignOut|describeAutoSignOut/)
  assert.doesNotMatch(read('src', 'i18n', 'translations.ts'), /autoSignedOut/)
})
