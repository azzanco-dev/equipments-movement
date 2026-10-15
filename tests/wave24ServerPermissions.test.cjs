// wave 24 — the server decides by permission keys, not by the role.
//
// * `requirePermission(request, key)` (src/lib/server/adminRequest.ts) is
//   the shared check of the API routes: the caller's token, has_permission()
//   called with it, exactly `true` or forbidden.
// * Every route under app/api (the extraction routes have their own gate,
//   `requireExtractingAccess`) decides by a key of the 0126 catalogue; none
//   still calls requireAdmin() or is_admin(), unless listed as admin-only by
//   design (nothing today).
// * The Edge Functions create-user and manage-user require `users.manage`
//   through has_permission() evaluated AS THE CALLER (the anon-key client
//   carrying the caller's Authorization header), never through the service
//   role, which stays for the privileged writes only.
// Source checks only, like the rest of the suite.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

/** Every route.ts under app/api, as a path relative to the root with `/`. */
function apiRoutes() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts')
        found.push(path.relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  walk(path.join(ROOT, 'app', 'api'))
  return found.sort()
}

/** route -> the permission key it requires. */
const ROUTE_KEYS = {
  'app/api/afaqy/units/route.ts': 'settings.integrations',
  'app/api/afaqy/sync/route.ts': 'settings.integrations',
  'app/api/afaqy/position/route.ts': 'equipment.location.view',
  'app/api/notifications/whatsapp-status/route.ts': 'settings.integrations',
  'app/api/notifications/workshop-arrival/route.ts': 'movements.notify_foreman',
}

/** Routes that may still decide by the admin role, by design. */
const ADMIN_ONLY_BY_DESIGN = new Set([])

/** The movement API: no requirePermission gate of its own (RLS through the
 *  forwarded token and the database functions decide; it still reads
 *  profiles.role for early 403s, outside wave 24). */
const NO_ROUTE_GATE = new Set([
  'app/api/movements/route.ts',
  'app/api/movements/[id]/route.ts',
  'app/api/movements/[id]/photos/route.ts',
  'app/api/movements/photo-uploads/route.ts',
])

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('requirePermission shares the token flow and demands exactly true', () => {
  const helper = read('src', 'lib', 'server', 'adminRequest.ts')
  assert.match(helper, /^\/\/ SERVER ONLY\./)
  assert.match(
    helper,
    /export async function requirePermission\(\s+request: Request,\s+key: ServerPermissionKey,\s+\): Promise<AdminRequestResult>/,
  )
  // One token flow for both checks.
  assert.equal(
    (helper.match(/auth\.getClaims\(accessToken\)/g) ?? []).length,
    1,
  )
  assert.equal(
    (helper.match(/await resolveCaller\(request\)/g) ?? []).length,
    2,
  )
  assert.match(helper, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(
    helper,
    /if \(authError \|\| !claimsData\?\.claims\.sub\) \{\s+return \{ ok: false, error: 'unauthorized' \}/,
  )
  // The decision: has_permission(key) with the caller's client, `=== true`.
  assert.match(
    helper,
    /await supabase\.rpc\(\s+'has_permission',\s+\{ p_key: key \},\s+\)/,
  )
  assert.match(
    helper,
    /if \(permissionError \|\| allowed !== true\) \{\s+return \{ ok: false, error: 'forbidden' \}/,
  )
  assert.ok(
    !/allowed\)|allowed ===? false|!allowed/.test(helper),
    'truthiness is not enough',
  )
  assert.ok(!/SERVICE_ROLE|service_role/i.test(helper))
  // The keys the routes use are typed, and are exactly the ones below.
  const union = /export type ServerPermissionKey =([\s\S]*?)\n\n/.exec(helper)
  assert.ok(union)
  const keys = [...union[1].matchAll(/'([\w.]+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(keys, [...new Set(Object.values(ROUTE_KEYS))].sort())
})

test('every API route decides by its permission key; none by the role', () => {
  const routes = apiRoutes()
  assert.ok(routes.length >= 12, 'the routes were found')
  for (const route of routes) {
    const source = read(route)
    if (route.startsWith('app/api/extracting/')) {
      // The extraction gate is `extracting.view` (wave 23); its admin check
      // decides only the update mode of the lookup / publish routes.
      assert.ok(!/requireAdmin/.test(source), route)
      continue
    }
    if (ADMIN_ONLY_BY_DESIGN.has(route)) continue
    assert.ok(
      !/requireAdmin|rpc\('is_admin'\)|is_admin\(/.test(source),
      `${route} still decides by the role`,
    )
    const key = ROUTE_KEYS[route]
    if (!key) {
      // The movement API (outside wave 24) still reads profiles.role for its
      // cheap early 403s; its database functions and RLS re-check fail
      // closed. It has no requirePermission gate of its own.
      assert.ok(NO_ROUTE_GATE.has(route), `${route} is listed`)
      assert.ok(!/requirePermission|has_permission/.test(source), route)
      continue
    }
    assert.ok(
      !/select\('role'\)|\.role ===? 'admin'|\.role !==? 'admin'/.test(source),
      `${route} reads the role`,
    )
    assert.match(
      source,
      new RegExp(
        `const access = await requirePermission\\(\\s*request,\\s*'${escape(key)}',?\\s*\\)`,
      ),
      route,
    )
    assert.match(source, /if \(!access\.ok\) \{/, route)
    assert.match(source, /access\.error === 'unauthorized' \? 401 : 403/, route)
    // The check is the first thing the handler does.
    const handler = source.slice(source.indexOf('export async function'))
    const at = handler.indexOf('requirePermission(')
    assert.ok(at > 0, route)
    const work = handler.slice(0, at).replace(/await\s*$/, '')
    assert.ok(!/await /.test(work), `${route} works before the check`)
    assert.match(
      source,
      /import \{ requirePermission \} from '@\/lib\/server\/adminRequest'/,
      route,
    )
    assert.equal(
      (source.match(/requirePermission\(/g) ?? []).length,
      1,
      `${route}: exactly one call`,
    )
  }
  assert.deepEqual(
    Object.keys(ROUTE_KEYS).sort(),
    routes.filter(
      (route) =>
        !route.startsWith('app/api/extracting/') && !NO_ROUTE_GATE.has(route),
    ),
    'every gated route is listed with its key',
  )
})

test('the route keys are catalogue keys that 0130 did not retire', () => {
  const migrations = path.join(ROOT, 'supabase', 'migrations')
  const files = fs
    .readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const catalogue = read(
    'supabase',
    'migrations',
    files.find((f) => f.includes('_0126_')),
  )
  const retire = read(
    'supabase',
    'migrations',
    files.find((f) => f.includes('_0130_')),
  )
  const insert =
    /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?\));\n/.exec(
      catalogue,
    )
  assert.ok(insert)
  const keys = new Set(
    [...insert[1].matchAll(/\n\s+\('([\w.]+)', '\w+', '/g)].map((m) => m[1]),
  )
  const retired = [
    ...retire.matchAll(
      /DELETE FROM public\.permissions\s+WHERE key = '([\w.]+)'/g,
    ),
  ].map((m) => m[1])
  assert.deepEqual(retired, ['map.view'])
  for (const key of [...Object.values(ROUTE_KEYS), 'users.manage']) {
    assert.ok(keys.has(key), `${key} is in the catalogue`)
    assert.ok(!retired.includes(key), `${key} is not retired`)
  }
  // «الموقع الحالي» and «ابلاغ الفورمان» are the catalogue names of the keys.
  assert.match(
    catalogue,
    /\('equipment\.location\.view', 'equipment', 'الموقع الحالي للمعدة'/,
  )
  assert.match(
    catalogue,
    /\('movements\.notify_foreman', 'movements', 'ابلاغ الفورمان'/,
  )
  assert.match(
    catalogue,
    /\('settings\.integrations', 'settings', 'الربط والتنبيهات'/,
  )
  // The database function behind the notice route re-checks the same key.
  const policies = read(
    'supabase',
    'migrations',
    files.find((f) => f.includes('_0127_')),
  )
  const fn =
    /CREATE OR REPLACE FUNCTION public\.request_workshop_arrival_notice[\s\S]*?\$\$;/.exec(
      policies,
    )
  assert.ok(fn)
  assert.match(fn[0], /public\.has_permission\('movements\.notify_foreman'\)/)
})

test('the Edge Functions require users.manage as the caller, never through the service role', () => {
  for (const name of ['create-user', 'manage-user']) {
    const source = read('supabase', 'functions', name, 'index.ts')
    // The caller's client: anon key + the caller's Authorization header.
    assert.match(
      source,
      /const userClient = createClient\(supabaseUrl, anonKey, \{\s+global: \{ headers: \{ Authorization: authHeader \} \},\s+\}\)/,
      name,
    )
    assert.match(source, /await userClient\.auth\.getUser\(\)/, name)
    // The decision, as the caller, exactly `true`.
    assert.match(
      source,
      /const \{ data: canManageUsers, error: permissionError \} =\s+await userClient\.rpc\('has_permission', \{ p_key: 'users\.manage' \}\)/,
      name,
    )
    assert.match(
      source,
      /if \(permissionError \|\| canManageUsers !== true\)/,
      name,
    )
    // One call in the code (the comments explain it), none on the
    // service-role client.
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    assert.equal((code.match(/has_permission/g) ?? []).length, 1, name)
    assert.ok(!/adminClient\.rpc\(/.test(source), name)
    // No role read decides anything about the caller any more.
    assert.ok(
      !/profile\.role !== 'admin'|callerProfile\?\.role|select\('role,must_change_password'\)/.test(
        source,
      ),
      name,
    )
    const forbiddenAt = source.indexOf('canManageUsers !== true')
    // The privileged client is used only after the check (create-user) or
    // for the caller's own forced password change and the writes (manage-user).
    const afterCheck = source.slice(forbiddenAt)
    assert.match(afterCheck, /adminClient\.auth\.admin\./, name)
    if (name === 'create-user') {
      assert.ok(
        source.indexOf('createClient(supabaseUrl, serviceRoleKey)') >
          forbiddenAt,
        'the service-role client is created after the check',
      )
      assert.match(source, /app_metadata: \{ role, admin_created: true \}/)
    } else {
      // Kept rules: own role, last admin, the forced own password change.
      assert.match(source, /code: 'own_role'/)
      assert.match(source, /code: 'last_admin'/)
      assert.ok(
        source.indexOf("body.action === 'change_own_password'") < forbiddenAt,
      )
      assert.ok(source.indexOf("body.action === 'get'") > forbiddenAt)
      assert.ok(source.indexOf("body.action === 'update'") > forbiddenAt)
      assert.match(
        source,
        /\.select\('must_change_password'\)\s+\.eq\('id', user\.id\)/,
      )
    }
    // The six legacy roles stay the allowlist of the account role.
    assert.match(
      source,
      /'assistant_workshop_manager',\s+'workshop_manager',\s+'monitor',\s+\]\.includes\(role\)/,
    )
  }
})
