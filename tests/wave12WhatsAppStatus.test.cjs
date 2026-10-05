const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards wave 12: the WhatsApp gateway connection status shown to the admin
// (the pure mapping, the server status function and its cache, the admin-only
// route, and the client pieces). Nothing here reaches the network.
const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

// Loads a src/lib module (and its `@/lib/...` imports) into one sandbox, so a
// test can supply `fetch`, `process.env`, `Date` and `console`.
function createLoader(globals = {}) {
  const cache = new Map()
  const sandbox = vm.createContext({ ...globals })
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const file = path.join(root, 'src', 'lib', `${name}.ts`)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
    const exports = {}
    cache.set(name, exports)
    const wrapper = vm.runInContext(
      `(function (exports, require) {${output}\n})`,
      sandbox,
      { filename: file },
    )
    wrapper(exports, (requested) => {
      const match = /^@\/lib\/(.+)$/.exec(requested)
      if (match) return load(match[1])
      throw new Error(`Unexpected module: ${requested}`)
    })
    return exports
  }
  return load
}

// --- The pure mapping --------------------------------------------------------

const nested = (status, substatus) => ({
  status: {
    accountStatus: substatus === undefined ? { status } : { status, substatus },
  },
})

test('the provider answer maps to a safe state', () => {
  const { mapUltraMsgInstanceStatus } = createLoader()('whatsappStatus')
  for (const [payload, expected] of [
    [nested('authenticated', 'connected'), 'connected'],
    [nested('authenticated'), 'connected'],
    [nested(' Authenticated ', 'CONNECTED'), 'connected'],
    [{ accountStatus: { status: 'authenticated' } }, 'connected'],
    [nested('qr'), 'qr'],
    [nested('qr', 'something'), 'qr'],
    [nested('initialize'), 'loading'],
    [nested('retrying'), 'loading'],
    [nested('loading'), 'loading'],
    [nested('disconnected'), 'disconnected'],
    [nested('standby'), 'disconnected'],
  ])
    assert.equal(
      mapUltraMsgInstanceStatus(payload),
      expected,
      JSON.stringify(payload),
    )
})

test('anything unexpected is unknown, never connected', () => {
  const { mapUltraMsgInstanceStatus } = createLoader()('whatsappStatus')
  for (const payload of [
    null,
    undefined,
    'authenticated',
    42,
    [],
    {},
    { error: 'Wrong token' },
    { error: 'x', status: { accountStatus: { status: 'authenticated' } } },
    { status: 'authenticated' },
    { status: { accountStatus: 'authenticated' } },
    { status: { accountStatus: { status: 7 } } },
    { status: { accountStatus: { status: '' } } },
    nested('authenticated', 'disconnected'),
    nested('authenticated', 'phone'),
    nested('something-new'),
  ])
    assert.equal(
      mapUltraMsgInstanceStatus(payload),
      'unknown',
      JSON.stringify(payload),
    )
})

test('only known not-connected states warn', () => {
  const { WHATSAPP_GATEWAY_STATES, isWhatsAppStatusWarning } =
    createLoader()('whatsappStatus')
  assert.deepEqual(
    [...WHATSAPP_GATEWAY_STATES].filter(isWhatsAppStatusWarning),
    ['disconnected', 'qr', 'loading'],
  )
})

test('the route answer is read strictly', () => {
  const { parseWhatsAppStatusResponse } = createLoader()('whatsappStatus')
  assert.equal(
    parseWhatsAppStatusResponse(200, { state: 'connected' }),
    'connected',
  )
  assert.equal(parseWhatsAppStatusResponse(200, { state: 'qr' }), 'qr')
  assert.equal(
    parseWhatsAppStatusResponse(200, { state: 'not_configured' }),
    'not_configured',
  )
  for (const [status, body] of [
    [200, { state: 'CONNECTED' }],
    [200, { state: 'other' }],
    [200, null],
    [200, 'connected'],
    [403, { state: 'connected' }],
    [401, { error: 'unauthorized' }],
    [500, { error: 'failed' }],
  ])
    assert.equal(parseWhatsAppStatusResponse(status, body), 'unknown')
})

test('the client loader sends the bearer token and never throws', async () => {
  const { loadWhatsAppStatus, WHATSAPP_STATUS_ENDPOINT } = createLoader({
    AbortController,
  })('whatsappStatus')
  assert.equal(WHATSAPP_STATUS_ENDPOINT, '/api/notifications/whatsapp-status')
  const session = (token) => ({
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
    },
  })
  const calls = []
  const ok = await loadWhatsAppStatus(
    session('abc'),
    undefined,
    async (url, init) => {
      calls.push({ url, init })
      return { status: 200, json: async () => ({ state: 'disconnected' }) }
    },
  )
  assert.equal(ok, 'disconnected')
  assert.equal(calls[0].url, '/api/notifications/whatsapp-status')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc')
  assert.equal(calls[0].init.cache, 'no-store')

  // No session: no request.
  let requested = false
  assert.equal(
    await loadWhatsAppStatus(session(null), undefined, async () => {
      requested = true
      return { status: 200, json: async () => ({}) }
    }),
    'unknown',
  )
  assert.equal(requested, false)

  // A network failure or an unreadable body is unknown.
  assert.equal(
    await loadWhatsAppStatus(session('abc'), undefined, async () => {
      throw new Error('offline')
    }),
    'unknown',
  )
  assert.equal(
    await loadWhatsAppStatus(session('abc'), undefined, async () => ({
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    })),
    'unknown',
  )

  // An aborted request is ignored (null), not reported as a state.
  const controller = new AbortController()
  assert.equal(
    await loadWhatsAppStatus(session('abc'), controller.signal, async () => {
      controller.abort()
      throw new Error('aborted')
    }),
    null,
  )
})

// --- The server status function ----------------------------------------------

const TOKEN = 'unit-test-token-value'

function gateway({ env, respond, now } = {}) {
  const calls = []
  const logs = []
  const record = (...args) => logs.push(JSON.stringify(args))
  const clock = { value: now ?? 1_000_000 }
  class FakeDate extends Date {
    static now() {
      return clock.value
    }
  }
  const load = createLoader({
    process: {
      env: env ?? { ULTRAMSG_INSTANCE_ID: 'instance1', ULTRAMSG_TOKEN: TOKEN },
    },
    console: { error: record, warn: record, log: record, info: record },
    URLSearchParams,
    AbortController,
    clearTimeout,
    setTimeout,
    Date: FakeDate,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return respond(url, init)
    },
  })
  return { load, calls, logs, clock }
}

const jsonResponse = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
})

test('the status request is the documented GET and maps the answer', async () => {
  const { load, calls, logs } = gateway({
    respond: () => jsonResponse(nested('authenticated', 'connected')),
  })
  const { fetchWhatsAppInstanceState } = load('server/ultramsg')
  assert.equal(await fetchWhatsAppInstanceState(), 'connected')
  assert.equal(calls.length, 1)
  const url = new URL(calls[0].url)
  assert.equal(url.origin, 'https://api.ultramsg.com')
  assert.equal(url.pathname, '/instance1/instance/status')
  assert.deepEqual([...url.searchParams.keys()], ['token'])
  assert.equal(url.searchParams.get('token'), TOKEN)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.ok(calls[0].init.signal)
  assert.deepEqual(logs, [])
})

test('a failed status request is unknown and nothing is logged', async () => {
  for (const respond of [
    () => jsonResponse(nested('authenticated'), false),
    () => jsonResponse({ error: `bad ${TOKEN}` }),
    () => jsonResponse('nope'),
    () => ({
      ok: true,
      json: async () => {
        throw new Error('not json')
      },
    }),
    () => {
      throw new Error(`connect failed token=${TOKEN}`)
    },
  ]) {
    const { load, logs } = gateway({ respond })
    assert.equal(
      await load('server/ultramsg').fetchWhatsAppInstanceState(),
      'unknown',
    )
    assert.deepEqual(logs, [])
  }
})

test('without the gateway variables the status is not_configured, with no request', async () => {
  for (const env of [
    {},
    { ULTRAMSG_INSTANCE_ID: 'instance1' },
    { ULTRAMSG_TOKEN: TOKEN },
    { ULTRAMSG_INSTANCE_ID: 'a/../b', ULTRAMSG_TOKEN: TOKEN },
  ]) {
    const { load, calls } = gateway({ env, respond: () => jsonResponse({}) })
    const status = await load('server/ultramsg').getWhatsAppGatewayStatus()
    assert.equal(status.state, 'not_configured')
    assert.equal(calls.length, 0)
  }
})

test('the status is cached for a minute and concurrent callers share one request', async () => {
  let answer = nested('authenticated', 'connected')
  const { load, calls, clock } = gateway({
    respond: () => jsonResponse(answer),
  })
  const { getWhatsAppGatewayStatus } = load('server/ultramsg')

  const [first, second] = await Promise.all([
    getWhatsAppGatewayStatus(),
    getWhatsAppGatewayStatus(),
  ])
  assert.equal(calls.length, 1)
  assert.equal(first.state, 'connected')
  assert.equal(second.state, 'connected')
  assert.equal(first.checkedAt, new Date(1_000_000).toISOString())
  // The safe payload: the state and the time only.
  assert.deepEqual(Object.keys(first).sort(), ['checkedAt', 'state'])

  answer = nested('qr')
  clock.value += 59 * 1000
  assert.equal((await getWhatsAppGatewayStatus()).state, 'connected')
  assert.equal(calls.length, 1)

  clock.value += 2 * 1000
  assert.equal((await getWhatsAppGatewayStatus()).state, 'qr')
  assert.equal(calls.length, 2)
})

test('the gateway module keeps its rules: no logs, no throw, no public variable', () => {
  const source = read('src', 'lib', 'server', 'ultramsg.ts')
  assert.ok(!/console\./.test(source))
  assert.ok(!/\bthrow\b/.test(source))
  assert.ok(!/catch \(/.test(source))
  assert.ok(!/process\.env\.NEXT_PUBLIC_/.test(source))
  assert.match(source, /\/instance\/status\?\$\{query\}`/)
  assert.match(source, /STATUS_CACHE_MS = 60 \* 1000/)
})

// --- The route ---------------------------------------------------------------

test('the status route authenticates, requires the admin role and returns only the state', () => {
  const route = read(
    'app',
    'api',
    'notifications',
    'whatsapp-status',
    'route.ts',
  )
  assert.match(route, /export async function GET\(request: Request\)/)
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(route))
  assert.match(
    route,
    /if \(!authorization\?\.startsWith\('Bearer '\)\) \{\s+return reply\(\{ error: 'unauthorized' \}, 401\)/,
  )
  assert.match(route, /supabase\.auth\.getClaims\(accessToken\)/)
  assert.match(route, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.ok(!/SERVICE_ROLE/i.test(route))
  // Fail closed: anything but `true` from is_admin() is a 403.
  assert.match(route, /await supabase\.rpc\('is_admin'\)/)
  assert.match(
    route,
    /if \(roleError \|\| isAdmin !== true\) \{\s+return reply\(\{ error: 'forbidden' \}, 403\)/,
  )
  // The role is checked before the gateway is asked.
  assert.ok(
    route.indexOf("rpc('is_admin')") <
      route.indexOf('await getWhatsAppGatewayStatus()'),
  )
  assert.match(
    route,
    /reply\(\{ state: status\.state, checkedAt: status\.checkedAt \}, 200\)/,
  )
  assert.match(route, /'Cache-Control': 'no-store'/)
  assert.match(
    route,
    /NextResponse\.json\(body, \{ status, headers: NO_STORE \}\)/,
  )
  assert.match(route, /export const runtime = 'nodejs'/)
  assert.ok(!/ULTRAMSG_|token=|instanceId/.test(route))
  assert.ok(!/console\.error\([^)]*\berror\b[^')]*\)/.test(route))
})

// --- The client --------------------------------------------------------------

test('the client polls for the admin only, every five minutes while visible', () => {
  const component = read('src', 'components', 'WhatsAppGatewayStatus.tsx')
  const layout = read('src', 'components', 'Layout.tsx')
  const lib = read('src', 'lib', 'whatsappStatus.ts')
  assert.match(lib, /WHATSAPP_STATUS_POLL_MS = 5 \* 60 \* 1000/)
  assert.match(
    layout,
    /const showWhatsAppStatus = profile\?\.role === 'admin' && navItems\.length > 0/,
  )
  assert.match(layout, /useWhatsAppStatusPolling\(showWhatsAppStatus\)/)
  assert.equal(
    (layout.match(/<WhatsAppStatusIndicator \/>/g) ?? []).length,
    2,
    'the desktop sidebar and the mobile drawer',
  )
  // Not polled, nothing requested: the store says `off`.
  assert.match(component, /if \(!enabled\) \{\s+publish\('off'\)\s+return\s+\}/)
  assert.match(
    component,
    /if \(document\.visibilityState !== 'visible'\) return/,
  )
  assert.match(
    component,
    /controller\?\.abort\(\)\s+window\.clearInterval\(interval\)/,
  )
  // The home alert: admin only, warnings only, small screens only.
  assert.match(
    component,
    /if \(profile\?\.role !== 'admin' \|\| view === 'off'\) return null\s+if \(!isWhatsAppStatusWarning\(view\)\) return null/,
  )
  assert.match(component, /cn\('lg:hidden', className\)/)
  // Tokens only.
  assert.ok(!/(gray|green|amber|emerald|yellow|red)-\d/.test(component))
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(component))
  assert.ok(!/ULTRAMSG_|@\/lib\/server\//.test(component + lib))
  assert.match(
    read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx'),
    /<WhatsAppStatusAlert className="mb-4" \/>/,
  )
})

test('the status copy exists in both languages and uses the plain alif', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-12-whatsapp-status — start([\s\S]*?)\/\/ wave-12-whatsapp-status — end/g,
  )
  assert.equal(blocks?.length, 2)
  const keys = (block) => [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.ok(keys(blocks[0]).length >= 7)
  assert.ok(!/[أإآ]/.test(blocks[0]), 'new Arabic copy uses the plain alif')
})
