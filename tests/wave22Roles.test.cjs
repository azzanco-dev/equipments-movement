// Wave 22A: roles and permissions, shipped INACTIVE (migrations 0126 and
// 0127). Pure text checks, like the rest of the suite: no database is
// reached.
//
// 0126: the permission catalogue, the roles, the frozen legacy mapping, the
//       flag, the decision functions and the admin functions.
// 0127: every role-name test of the live policies and functions moved to a
//       permission key, verbatim otherwise, and equivalent for the six legacy
//       roles under the frozen mapping.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  ALL_ROLES,
  WORKSHOP_ROLES,
  FUNCTION_REWRITES,
  POLICY_REWRITES,
} = require('./helpers/wave22Rewrites.cjs')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const FILES = fs
  .readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const filesOf = (number) => FILES.filter((file) => file.includes(`_${number}_`))
const fileOf = (number) => {
  const names = filesOf(number)
  assert.equal(names.length, 1, `one migration ${number}`)
  return names[0]
}
// Working copies may be checked out with CRLF (core.autocrlf); compare as LF.
const read = (name) =>
  fs.readFileSync(path.join(MIGRATIONS, name), 'utf8').replace(/\r\n/g, '\n')
const migration = (number) => read(fileOf(number))
/** The last migration numbered `number` (numbers repeat) that `has` it. */
function sourceFile(number, has) {
  const names = filesOf(number).filter((file) => has(read(file)))
  assert.ok(names.length, `migration ${number} defines it`)
  return names[names.length - 1]
}
const SQL_0126 = migration('0126')
const SQL_0127 = migration('0127')

/** The SQL without comment lines. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every `CREATE [OR REPLACE] FUNCTION public.<name>(` block, to its `;`. */
function functionBlocks(sql) {
  const blocks = []
  const re =
    /(CREATE (?:OR REPLACE )?|DROP )FUNCTION (?:IF EXISTS )?(?:public\.)?(\w+)\s*\(/g
  let match
  while ((match = re.exec(sql))) {
    const start = match.index
    const line = sql.slice(sql.lastIndexOf('\n', start) + 1, start)
    if (line.includes('--')) continue
    if (match[1] === 'DROP ') {
      blocks.push({ name: match[2], start, drop: true, text: '' })
      continue
    }
    // A dollar-quoted body before the next statement; a SQL-standard body
    // (RETURN ... or BEGIN ATOMIC) ends before the next top-level statement.
    const next = sql
      .slice(start + 6)
      .search(/\n(CREATE|REVOKE|GRANT|COMMENT|DROP|ALTER) /)
    const limit = next < 0 ? sql.length : start + 6 + next
    const as = /\bAS\s+(\$\w*\$)/g
    as.lastIndex = start
    const open = as.exec(sql)
    let end
    if (open && open.index < limit) {
      const close = sql.indexOf(open[1], open.index + open[0].length)
      end = sql.indexOf(';', close + open[1].length)
    } else {
      end = sql.lastIndexOf(';', limit)
    }
    blocks.push({ name: match[2], start, text: sql.slice(start, end + 1) })
    re.lastIndex = end
  }
  return blocks
}

/** The last definition of a function in one migration. */
function lastFunction(sql, name) {
  const found = functionBlocks(sql).filter(
    (block) => !block.drop && block.name === name,
  )
  assert.ok(found.length, `${name} is defined`)
  return found[found.length - 1].text
}

const normaliseHeader = (text) =>
  text.replace(/^CREATE (OR REPLACE )?FUNCTION/, 'CREATE OR REPLACE FUNCTION')

/** Replaces exactly `count` occurrences, failing otherwise. */
function replaceCount(text, from, to, count = 1) {
  assert.equal(text.split(from).length - 1, count, `anchor x${count}: ${from}`)
  return text.split(from).join(to)
}

/** `CREATE POLICY` / `DROP POLICY` statements of a migration, in order. */
function policyStatements(sql) {
  const list = []
  const re =
    /\b(CREATE|DROP) POLICY\s+(?:IF EXISTS\s+)?"?(\w+)"?\s+ON\s+((?:\w+\.)?\w+)[^;]*;/g
  let match
  for (const source = code(sql); (match = re.exec(source));) {
    const table = match[3].includes('.') ? match[3] : `public.${match[3]}`
    list.push({ verb: match[1], name: match[2], table, text: match[0] })
  }
  return list
}

/** The balanced `( ... )` after a keyword of a policy statement. */
function clause(text, keyword) {
  const at = text.search(new RegExp(`\\b${keyword}\\s*\\(`))
  if (at < 0) return null
  let depth = 0
  let inString = false
  const start = text.indexOf('(', at)
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (char === "'") inString = !inString
    if (inString) continue
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  throw new Error(`unbalanced ${keyword}`)
}
const strip = (text) => text.replace(/\s+/g, '')

// --- The frozen legacy mapping ------------------------------------------------

/** legacy_role_permissions' VALUES rows: role -> Map(key -> scope|null). */
function legacyMapping() {
  const body = lastFunction(SQL_0126, 'legacy_role_permissions')
  const rows = [...body.matchAll(/\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g)]
  assert.ok(rows.length > 50)
  const mapping = new Map()
  for (const [, role, key, , scope] of rows) {
    if (!mapping.has(role)) mapping.set(role, new Map())
    assert.ok(!mapping.get(role).has(key), `${role} ${key} listed once`)
    mapping.get(role).set(key, scope ?? null)
  }
  return mapping
}

/** The permission catalogue seeded by 0126. */
function catalogue() {
  const insert =
    /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?\));\n/.exec(
      SQL_0126,
    )
  assert.ok(insert)
  const rows = [
    ...insert[1].matchAll(
      /\('([\w.]+)', '(\w+)', '((?:[^']|'')+)', '((?:[^']|'')+)',\s*'((?:[^']|'')+)',\s*'((?:[^']|'')+)',\s*(true|false), (NULL|ARRAY\[[^\]]*\]), ('\{\}'|ARRAY\[[^\]]*\]), (true|false), '(\w+)', (\d+)\)/g,
    ),
  ]
  const list = (value) =>
    value === 'NULL' || value === "'{}'"
      ? value === 'NULL'
        ? null
        : []
      : [...value.matchAll(/'([\w.]+)'/g)].map((m) => m[1])
  return new Map(
    rows.map((m) => [
      m[1],
      {
        key: m[1],
        group: m[2],
        nameAr: m[3],
        descriptionAr: m[5],
        scoped: m[7] === 'true',
        scopes: list(m[8]),
        requires: list(m[9]),
        adminOnly: m[10] === 'true',
        enforcedIn: m[11],
        sort: Number(m[12]),
      },
    ]),
  )
}

const LEGACY = legacyMapping()
const PERMISSIONS = catalogue()

/** has/scope for one legacy role under the frozen mapping. */
function perms(role) {
  const granted = LEGACY.get(role) ?? new Map()
  return {
    has: (key) => {
      assert.ok(PERMISSIONS.has(key), `known key ${key}`)
      return granted.has(key)
    },
    scope: (key) => {
      assert.ok(PERMISSIONS.has(key), `known key ${key}`)
      return granted.has(key) ? (granted.get(key) ?? 'all') : null
    },
  }
}

// Hand-derived from the gates (latest definitions through 0125, the API
// routes and the client routing): key -> { role: scope (or true) }.
const A = 'admin'
const S = 'supervisor'
const W = 'workshop'
const AWM = 'assistant_workshop_manager'
const WM = 'workshop_manager'
const M = 'monitor'
const LEGACY_EXPECTED = {
  'home.admin': { [A]: true, [M]: true },
  'home.foreman': { [S]: 'own' },
  'home.workshop': { [W]: 'workshop', [AWM]: 'all', [WM]: 'all' },
  'movements.read': {
    [A]: 'all',
    [S]: 'own',
    [W]: 'all',
    [AWM]: 'all',
    [WM]: 'all',
    [M]: 'all',
  },
  'movements.site.create': { [A]: 'all', [S]: 'own' },
  'movements.site.driver_change': { [A]: 'all', [S]: 'own' },
  'movements.site.contractor_code': { [S]: true },
  'movements.workshop.create': {
    [A]: true,
    [W]: true,
    [AWM]: true,
    [WM]: true,
  },
  'movements.workshop.classify': { [A]: true, [AWM]: true, [WM]: true },
  'movements.notify_foreman': { [A]: true, [W]: true, [AWM]: true, [WM]: true },
  'movements.exit_cross_context': { [A]: true },
  'movements.edit_delete': { [A]: true },
  'movements.import': { [A]: true },
  'movements.photos.manage': {
    [A]: 'all',
    [S]: 'own',
    [W]: 'workshop',
    [AWM]: 'workshop',
    [WM]: 'workshop',
  },
  'movements.photos.delete_any': { [A]: true },
  'movements.export': { [A]: true, [AWM]: true, [WM]: true, [M]: true },
  'movements.activity': { [A]: true },
  'reports.view': { [A]: 'all' },
  'inquiry.view': {
    [A]: true,
    [S]: true,
    [W]: true,
    [AWM]: true,
    [WM]: true,
    [M]: true,
  },
  'equipment.read': { [A]: true },
  'equipment.create': { [A]: true },
  'equipment.edit': { [A]: true },
  'equipment.delete': { [A]: true },
  'equipment.quick_create': {
    [A]: 'all',
    [S]: 'site',
    [W]: 'workshop',
    [AWM]: 'workshop',
    [WM]: 'workshop',
  },
  'equipment.change_code': { [A]: true },
  'equipment.import': { [A]: true },
  'equipment.tracker_link': { [A]: true },
  'equipment.location.view': { [A]: true },
  'drivers.read': { [A]: true },
  'drivers.create': { [A]: true },
  'drivers.edit': { [A]: true },
  'drivers.delete': { [A]: true },
  'drivers.quick_create': { [A]: true, [S]: true },
  'drivers.import': { [A]: true },
  'companies_projects.read': { [A]: true },
  'companies_projects.edit': { [A]: true },
  'lessors.read': { [A]: true },
  'lessors.edit': { [A]: true },
  'lessors.quick_create': { [A]: true, [S]: true },
  'users.read': {
    [A]: 'all',
    [W]: 'workshop',
    [AWM]: 'workshop',
    [WM]: 'workshop',
    [M]: 'all',
  },
  'users.manage': { [A]: true },
  'settings.equipment_types': { [A]: true },
  'settings.integrations': { [A]: true },
  'settings.roles': { [A]: true },
  'map.view': { [A]: true },
  'purchasing.view': {},
  'purchasing.manage': {},
}

// --- 0126 ---------------------------------------------------------------------

test('0126 and 0127 are new migrations ordered after 0125', () => {
  for (const number of ['0126', '0127'])
    assert.equal(FILES.filter((file) => file.includes(`_${number}_`)).length, 1)
  assert.ok(FILES.indexOf(fileOf('0126')) > FILES.indexOf(fileOf('0125')))
  assert.ok(FILES.indexOf(fileOf('0127')) > FILES.indexOf(fileOf('0126')))
  assert.equal(FILES[FILES.length - 1], fileOf('0127'))
  for (const sql of [SQL_0126, SQL_0127])
    assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('the catalogue is complete, well-formed and its rules are consistent', () => {
  assert.deepEqual(
    [...PERMISSIONS.keys()].sort(),
    Object.keys(LEGACY_EXPECTED).sort(),
  )
  const sorts = new Set()
  for (const permission of PERMISSIONS.values()) {
    assert.ok(!sorts.has(permission.sort), `unique sort ${permission.sort}`)
    sorts.add(permission.sort)
    assert.equal(permission.scoped, permission.scopes !== null, permission.key)
    for (const scope of permission.scopes ?? [])
      assert.ok(['all', 'site', 'workshop', 'companies', 'own'].includes(scope))
    for (const required of permission.requires)
      assert.ok(
        PERMISSIONS.has(required),
        `${permission.key} requires ${required}`,
      )
    assert.ok(
      ['database', 'interface', 'reserved'].includes(permission.enforcedIn),
    )
  }
  assert.deepEqual(
    [...PERMISSIONS.values()]
      .filter((p) => p.adminOnly)
      .map((p) => p.key)
      .sort(),
    ['settings.roles', 'users.manage'],
  )
  // Every key a rewritten object checks is enforced in the database.
  const checked = new Set([
    ...FUNCTION_REWRITES.flatMap((spec) => spec.keys),
    ...POLICY_REWRITES.flatMap((spec) => spec.keys),
  ])
  for (const key of checked) assert.ok(PERMISSIONS.has(key), key)
  for (const permission of PERMISSIONS.values())
    if (
      permission.enforcedIn === 'database' &&
      permission.key !== 'settings.roles'
    )
      assert.ok(
        checked.has(permission.key),
        `${permission.key} has a database gate`,
      )
})

test('new Arabic copy has no alif with hamza or madda', () => {
  for (const permission of PERMISSIONS.values()) {
    assert.doesNotMatch(permission.nameAr, /[أإآ]/, permission.key)
    assert.doesNotMatch(permission.descriptionAr, /[أإآ]/, permission.key)
  }
  const roles = /INSERT INTO public\.roles [\s\S]*?;\n/.exec(SQL_0126)[0]
  assert.doesNotMatch(roles, /[أإآ]/)
})

test('the frozen mapping equals the gate table, hard-coded in the function', () => {
  const body = code(lastFunction(SQL_0126, 'legacy_role_permissions'))
  assert.match(body, /LANGUAGE sql\s+IMMUTABLE\s+SECURITY INVOKER/)
  assert.ok(!/\bFROM public\./.test(body), 'reads no table')
  assert.deepEqual([...LEGACY.keys()].sort(), [...ALL_ROLES].sort())
  for (const [key, roles] of Object.entries(LEGACY_EXPECTED)) {
    for (const role of ALL_ROLES) {
      const expected = roles[role]
      const actual = LEGACY.get(role).has(key)
        ? (LEGACY.get(role).get(key) ?? true)
        : undefined
      assert.equal(actual, expected, `${role} ${key}`)
    }
  }
})

test('the legacy mapping obeys the catalogue rules', () => {
  for (const [role, granted] of LEGACY) {
    for (const [key, scope] of granted) {
      const permission = PERMISSIONS.get(key)
      assert.ok(permission, key)
      if (permission.scoped)
        assert.ok(permission.scopes.includes(scope), `${role} ${key}`)
      else assert.equal(scope, null, `${role} ${key}`)
      if (permission.adminOnly) assert.equal(role, 'admin', key)
      for (const required of permission.requires)
        assert.ok(granted.has(required), `${role}: ${key} requires ${required}`)
    }
  }
})

test('the system roles are seeded from the mapping, the suggestions follow the rules', () => {
  assert.match(
    code(SQL_0126),
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\)\s+SELECT r\.key, m\.permission_key, m\.scope\s+FROM public\.roles r\s+CROSS JOIN LATERAL public\.legacy_role_permissions\(r\.key\) AS m\s+WHERE r\.is_system;/,
  )
  const roles = /INSERT INTO public\.roles [\s\S]*?;\n/.exec(SQL_0126)[0]
  const seeded = [
    ...roles.matchAll(
      /\('(\w+)', '[^']+', '[^']+',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*', (true|false), true\)/g,
    ),
  ]
  assert.deepEqual(
    seeded
      .filter((m) => m[2] === 'true')
      .map((m) => m[1])
      .sort(),
    [...ALL_ROLES].sort(),
  )
  assert.deepEqual(
    seeded
      .filter((m) => m[2] === 'false')
      .map((m) => m[1])
      .sort(),
    ['equipment_officer', 'foreman_lead', 'purchasing'],
  )
  assert.match(roles, /'رئيس الفورمين'/)
  assert.match(roles, /'مسؤول المعدات'/)
  assert.match(roles, /'مشتريات'/)

  const suggestions =
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\)\s+VALUES([\s\S]*?);\n/.exec(
      SQL_0126,
    )[1]
  const byRole = new Map()
  for (const [, role, key, , scope] of suggestions.matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  )) {
    if (!byRole.has(role)) byRole.set(role, new Map())
    byRole.get(role).set(key, scope ?? null)
  }
  assert.deepEqual([...byRole.keys()].sort(), [
    'equipment_officer',
    'foreman_lead',
    'purchasing',
  ])
  for (const [role, granted] of byRole)
    for (const [key, scope] of granted) {
      const permission = PERMISSIONS.get(key)
      assert.ok(permission, key)
      if (permission.scoped)
        assert.ok(permission.scopes.includes(scope), `${role} ${key}`)
      else assert.equal(scope, null, `${role} ${key}`)
      assert.ok(!permission.adminOnly, `${role} ${key}`)
      for (const required of permission.requires)
        assert.ok(granted.has(required), `${role}: ${key} requires ${required}`)
    }
  // Nobody is assigned a suggestion: assignments come from profiles.role.
  assert.match(
    code(SQL_0126),
    /INSERT INTO public\.profile_roles \(profile_id, role_key\)\s+SELECT p\.id, p\.role\s+FROM public\.profiles p;/,
  )
})

test('the system ships inactive and only one function writes the flag', () => {
  assert.match(
    SQL_0126,
    /INSERT INTO public\.app_settings \(key, value\)\s+VALUES \('roles_system', '\{"enabled": false\}'::jsonb\);/,
  )
  const writes = [
    ...code(SQL_0126 + SQL_0127).matchAll(
      /(INSERT INTO|UPDATE)\s+public\.app_settings\b/g,
    ),
  ]
  assert.equal(writes.length, 2, 'the seed and set_roles_system_enabled')
  assert.match(
    code(lastFunction(SQL_0126, 'set_roles_system_enabled')),
    /UPDATE public\.app_settings\s+SET value = jsonb_build_object\('enabled', p_enabled\)/,
  )
  assert.ok(!/'\{"enabled":\s*true\}'/.test(code(SQL_0126 + SQL_0127)))
  // Enabling is refused while anybody blocks it.
  const enable = code(lastFunction(SQL_0126, 'set_roles_system_enabled'))
  assert.match(enable, /FROM public\.admin_roles_system_offenders\(\) AS o;/)
  assert.match(enable, /IF jsonb_array_length\(v_offenders\) > 0 THEN\s+RETURN/)
  const offenders = code(lastFunction(SQL_0126, 'admin_roles_system_offenders'))
  for (const reason of [
    'no_role',
    'unknown_role',
    'inactive_role',
    'admin_mismatch',
  ])
    assert.match(offenders, new RegExp(`'${reason}'`))
})

test('enabling needs the acknowledged preview row count', () => {
  const sql = code(SQL_0126)
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.set_roles_system_enabled\(\s+p_enabled boolean,\s+p_expected_preview_rows integer\s+\)/,
  )
  // One signature only: no one-argument overload is left callable.
  assert.equal(
    functionBlocks(SQL_0126).filter(
      (b) => b.name === 'set_roles_system_enabled',
    ).length,
    1,
  )
  for (const statement of [
    /REVOKE ALL ON FUNCTION public\.set_roles_system_enabled\(boolean, integer\) FROM PUBLIC, anon;/,
    /GRANT EXECUTE ON FUNCTION public\.set_roles_system_enabled\(boolean, integer\) TO authenticated;/,
    /COMMENT ON FUNCTION public\.set_roles_system_enabled\(boolean, integer\) IS/,
  ])
    assert.match(sql, statement)
  assert.ok(!/set_roles_system_enabled\(boolean\)/.test(sql))

  const body = code(lastFunction(SQL_0126, 'set_roles_system_enabled'))
  const offenders = body.indexOf("'reason', 'offenders'")
  const preview = body.indexOf('FROM public.admin_roles_system_preview();')
  const mismatch = body.indexOf(
    'IF p_expected_preview_rows IS DISTINCT FROM v_preview_rows THEN',
  )
  const write = body.indexOf('UPDATE public.app_settings')
  // Offenders first, then the acknowledgement, and only then the write; both
  // checks run only when enabling.
  assert.ok(offenders > 0 && offenders < preview && preview < mismatch)
  assert.ok(mismatch < write)
  assert.ok(body.indexOf('IF p_enabled THEN') < offenders)
  assert.match(
    body,
    /IF p_expected_preview_rows IS DISTINCT FROM v_preview_rows THEN\s+RETURN jsonb_build_object\(\s+'enabled', public\.roles_system_enabled\(\),\s+'changed', false,\s+'reason', 'preview_changed',\s+'offenders', '\[\]'::jsonb,\s+'preview_rows', v_preview_rows\s+\);/,
  )
  assert.match(
    body,
    /'reason', NULL,\s+'offenders', '\[\]'::jsonb,\s+'preview_rows', v_preview_rows/,
  )
})

test('legacy role changes follow while off and are refused while on', () => {
  const body = code(lastFunction(SQL_0126, 'sync_profile_role_assignment'))
  // While the flag is ON, a non-admin legacy change of a customised
  // assignment is refused.
  assert.match(
    body,
    /IF public\.roles_system_enabled\(\)\s+AND NEW\.role <> 'admin'\s+AND OLD\.role <> 'admin'\s+AND v_found\s+AND v_current IS DISTINCT FROM OLD\.role THEN\s+RAISE EXCEPTION 'roles_system_active_use_assignment'\s+USING ERRCODE = '55000'/,
  )
  // Otherwise (flag OFF, never customised, or an admin parity move) the
  // assignment follows NEW.role unconditionally.
  const refusal = body.indexOf(
    "RAISE EXCEPTION 'roles_system_active_use_assignment'",
  )
  const follow = body.indexOf(
    'INSERT INTO public.profile_roles AS pr (profile_id, role_key, assigned_at, assigned_by)',
  )
  assert.ok(refusal > 0 && follow > refusal)
  assert.match(
    body.slice(follow),
    /VALUES \(NEW\.id, NEW\.role, now\(\), auth\.uid\(\)\)\s+ON CONFLICT \(profile_id\) DO UPDATE\s+SET role_key = EXCLUDED\.role_key,[\s\S]*WHERE pr\.role_key IS DISTINCT FROM EXCLUDED\.role_key;/,
  )
  // No other condition (such as "still equals the old role") limits it.
  assert.ok(!/pr\.role_key = OLD\.role/.test(body))

  // admin_set_user_role refuses while the flag is on, before its UPDATE.
  const setRole = lastFunction(SQL_0127, 'admin_set_user_role')
  assert.match(
    setRole,
    /IF public\.roles_system_enabled\(\) THEN\s+RAISE EXCEPTION 'roles_system_active_use_assignment'\s+USING ERRCODE = '55000',[\s\S]*?END IF;\s+UPDATE public\.profiles\s+SET role = p_role/,
  )
})

test('the DEFINER reads of every unit need the movements.read scope all', () => {
  assert.match(
    lastFunction(SQL_0127, 'get_equipment_attention_report'),
    /IF auth\.uid\(\) IS NULL\s+OR public\.permission_scope\('reports\.view'\) IS DISTINCT FROM 'all'\s+OR public\.permission_scope\('movements\.read'\) IS DISTINCT FROM 'all' THEN\s+RAISE EXCEPTION 'admin required';/,
  )
  assert.match(
    lastFunction(SQL_0127, 'get_all_equipment_last_movement'),
    /WHERE public\.has_permission\('equipment\.read'\)\s+AND public\.permission_scope\('movements\.read'\) = 'all'/,
  )
  // Legacy-equivalent: only admin holds reports.view, and admin reads all.
  for (const role of ALL_ROLES) {
    const p = perms(role)
    assert.equal(
      p.scope('reports.view') === 'all' && p.scope('movements.read') === 'all',
      role === 'admin',
      role,
    )
  }
})

test('the two evaluation paths: legacy when off, assignments when on', () => {
  const scope = code(lastFunction(SQL_0126, 'permission_scope'))
  assert.match(scope, /WHEN p_key IS NULL OR auth\.uid\(\) IS NULL THEN NULL/)
  assert.match(scope, /WHEN public\.roles_system_enabled\(\) THEN \(/)
  assert.match(
    scope,
    /JOIN public\.roles r\s+ON r\.key = pr\.role_key\s+AND r\.is_active/,
  )
  assert.match(
    scope,
    /ELSE \(\s+SELECT COALESCE\(m\.scope, 'all'\)\s+FROM public\.profiles p\s+CROSS JOIN LATERAL public\.legacy_role_permissions\(p\.role\) AS m/,
  )
  assert.match(
    code(lastFunction(SQL_0126, 'has_permission')),
    /SELECT public\.permission_scope\(p_key\) IS NOT NULL;/,
  )
  const current = code(lastFunction(SQL_0126, 'current_permissions'))
  assert.match(current, /AND NOT public\.roles_system_enabled\(\)/)
  assert.match(current, /AND public\.roles_system_enabled\(\);/)
  assert.match(
    code(lastFunction(SQL_0126, 'roles_system_enabled')),
    /s\.value -> 'enabled' = 'true'::jsonb/,
  )
  // is_admin() and current_user_role() are not redefined.
  for (const sql of [SQL_0126, SQL_0127])
    assert.ok(
      !/FUNCTION public\.(is_admin|current_user_role)\(/.test(code(sql)),
    )
})

test('every SECURITY DEFINER function has a fixed search_path and no client default', () => {
  for (const sql of [SQL_0126, SQL_0127]) {
    for (const block of functionBlocks(sql)) {
      const header = block.text.slice(0, block.text.search(/\bAS\s+\$/))
      if (!/SECURITY DEFINER/.test(header)) continue
      assert.match(header, /SET search_path = public/, block.name)
      const trigger = /RETURNS trigger/.test(header)
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${block.name}\\([^)]*\\)\\s+FROM PUBLIC, anon${trigger ? ', authenticated' : ''};`,
      )
      assert.match(sql, revoke, block.name)
    }
  }
  // The admin functions of 0126 require an admin who holds settings.roles.
  for (const name of [
    'admin_upsert_role',
    'admin_set_role_permissions',
    'admin_assign_profile_role',
    'admin_delete_role',
    'admin_roles_system_offenders',
    'admin_roles_system_preview',
    'set_roles_system_enabled',
  ]) {
    const body = code(lastFunction(SQL_0126, name))
    assert.match(
      body,
      /IF auth\.uid\(\) IS NULL\s+OR public\.is_admin\(\) IS NOT TRUE\s+OR public\.has_permission\('settings\.roles'\) IS NOT TRUE THEN\s+RAISE EXCEPTION 'admin_required'/,
      name,
    )
    if (
      !['admin_roles_system_offenders', 'admin_roles_system_preview'].includes(
        name,
      )
    )
      assert.match(
        body,
        /pg_advisory_xact_lock\(hashtextextended\('roles_system', 0\)\)/,
        name,
      )
  }
})

test('the admin functions protect admin, system roles and assignments', () => {
  const upsert = code(lastFunction(SQL_0126, 'admin_upsert_role'))
  assert.match(upsert, /'system_role_locked'/)
  assert.match(upsert, /'role_in_use'/)
  const set = code(lastFunction(SQL_0126, 'admin_set_role_permissions'))
  for (const error of [
    'role_not_found',
    'invalid_permissions_payload',
    'duplicate_permission',
    'unknown_permission',
    'invalid_permission_scope',
    'admin_only_permission',
    'missing_required_permission',
    'admin_role_locked',
  ])
    assert.match(set, new RegExp(`'${error}'`), error)
  const assign = code(lastFunction(SQL_0126, 'admin_assign_profile_role'))
  for (const error of [
    'user_not_found',
    'role_not_found',
    'role_inactive',
    'cannot_change_own_admin',
    'admin_role_mismatch',
  ])
    assert.match(assign, new RegExp(`'${error}'`), error)
  const remove = code(lastFunction(SQL_0126, 'admin_delete_role'))
  assert.match(
    remove,
    /IF v_role\.is_system THEN\s+RAISE EXCEPTION 'system_role_locked'/,
  )
  assert.match(remove, /'role_in_use'/)
  assert.match(
    SQL_0126,
    /CONSTRAINT roles_system_active CHECK \(NOT is_system OR is_active\)/,
  )
  // A role with assignments cannot be deleted at the table level either.
  assert.match(
    SQL_0126,
    /role_key text NOT NULL REFERENCES public\.roles\(key\),\n/,
  )
})

test('the new tables are read-only for clients and audited', () => {
  const tables = [
    'permissions',
    'roles',
    'role_permissions',
    'profile_roles',
    'app_settings',
    'role_changes',
  ]
  const sql = code(SQL_0126)
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`),
    )
    assert.match(
      sql,
      new RegExp(
        `REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated;`,
      ),
    )
    assert.match(
      sql,
      new RegExp(`GRANT SELECT ON public\\.${table} TO authenticated;`),
    )
    assert.match(sql, new RegExp(`COMMENT ON TABLE public\\.${table} IS`))
  }
  assert.ok(
    !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\.(permissions|roles|role_permissions|profile_roles|app_settings|role_changes)\b/.test(
      sql,
    ),
  )
  const policies = policyStatements(SQL_0126)
  assert.equal(policies.length, 6)
  for (const policy of policies)
    assert.match(policy.text, /FOR SELECT TO authenticated/)
  for (const table of [
    'roles',
    'role_permissions',
    'profile_roles',
    'app_settings',
  ]) {
    assert.match(
      sql,
      new RegExp(
        `CREATE TRIGGER audit_role_change\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.audit_${table}_change\\(\\);`,
      ),
    )
    // Each audit function names only its own table's columns.
    assert.match(
      code(lastFunction(SQL_0126, `audit_${table}_change`)),
      /INSERT INTO public\.role_changes/,
    )
  }
  assert.match(
    sql,
    /CREATE TRIGGER sync_profile_role_assignment\s+AFTER INSERT OR UPDATE OF role ON public\.profiles/,
  )
})

// --- 0127 ---------------------------------------------------------------------

test('each rewritten function is its latest definition plus the documented replacements', () => {
  const rewritten = functionBlocks(SQL_0127)
    .filter((block) => !block.drop)
    .map((block) => block.name)
  assert.deepEqual(
    [...rewritten].sort(),
    FUNCTION_REWRITES.map((spec) => spec.name).sort(),
  )
  const index0127 = FILES.indexOf(fileOf('0127'))
  for (const spec of FUNCTION_REWRITES) {
    const defines = (sql) =>
      functionBlocks(sql).some(
        (block) => !block.drop && block.name === spec.name,
      )
    const source = sourceFile(spec.source, defines)
    // The source is the latest definition before 0127.
    for (const file of FILES.slice(FILES.indexOf(source) + 1, index0127))
      assert.ok(
        !functionBlocks(read(file)).some((block) => block.name === spec.name),
        `${spec.name} is redefined in ${file} after ${spec.source}`,
      )
    let expected = normaliseHeader(lastFunction(read(source), spec.name))
    for (const [from, to, count] of spec.replacements)
      expected = replaceCount(expected, from, to, count)
    assert.equal(lastFunction(SQL_0127, spec.name), expected, spec.name)

    const signature = escape(`public.${spec.name}(${spec.signature})`)
    if (spec.callable) {
      assert.match(
        SQL_0127,
        new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`),
      )
      assert.match(
        SQL_0127,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`),
      )
    } else {
      assert.match(
        SQL_0127,
        new RegExp(
          `REVOKE ALL ON FUNCTION ${signature}\\s+FROM PUBLIC, anon, authenticated;`,
        ),
      )
    }
    assert.match(
      SQL_0127,
      new RegExp(`\\('${signature}', '${escape(spec.keys.join(', '))}'\\)`),
    )
  }
})

test('the movement chain lock and the exit rules are untouched', () => {
  const body = lastFunction(SQL_0127, 'enforce_movement_sequence')
  assert.match(
    body,
    /PERFORM pg_advisory_xact_lock\(hashtextextended\(NEW\.equipment_id::text, 0\)\);/,
  )
  assert.match(body, /ORDER BY l\.recorded_at DESC, l\.id DESC/)
  for (const error of [
    'exit_equipment_in_workshop',
    'exit_not_entry_owner',
    'exit_equipment_on_site',
    'sequence would be invalid',
  ])
    assert.match(body, new RegExp(error))
  assert.match(
    lastFunction(SQL_0127, 'change_active_movement_driver'),
    /PERFORM pg_advisory_xact_lock\(hashtextextended\(v_entry\.equipment_id::text, 0\)\);/,
  )
})

test('each rewritten policy is its latest predicate with only role atoms replaced', () => {
  const index0127 = FILES.indexOf(fileOf('0127'))
  const created = policyStatements(SQL_0127).filter((p) => p.verb === 'CREATE')
  assert.equal(created.length, POLICY_REWRITES.length)
  for (const spec of POLICY_REWRITES) {
    const creates = (sql) =>
      policyStatements(sql).filter(
        (p) =>
          p.verb === 'CREATE' && p.name === spec.name && p.table === spec.table,
      )
    const source = sourceFile(spec.source, (sql) => creates(sql).length > 0)
    const sourceIndex = FILES.indexOf(source)
    const old = creates(read(source))
    assert.ok(old.length, `${spec.table} ${spec.name} in ${spec.source}`)
    const before = old[old.length - 1].text
    for (const file of FILES.slice(sourceIndex + 1, index0127))
      assert.ok(
        !policyStatements(read(file)).some(
          (p) => p.name === spec.name && p.table === spec.table,
        ),
        `${spec.name} touched again in ${file}`,
      )
    const command = new RegExp(`FOR\\s+${spec.cmd}\\s+TO\\s+authenticated`)
    assert.match(before, command)

    const after = created.find(
      (p) => p.name === spec.name && p.table === spec.table,
    )
    assert.ok(after, `${spec.name} recreated`)
    assert.match(after.text, command)
    assert.match(
      SQL_0127,
      new RegExp(
        `DROP POLICY IF EXISTS ${spec.name} ON ${escape(spec.table)};\\nCREATE POLICY ${spec.name} ON`,
      ),
    )
    for (const keyword of ['USING', 'WITH CHECK']) {
      const oldClause = clause(before, keyword)
      const newClause = clause(after.text, keyword)
      assert.equal(
        oldClause === null,
        newClause === null,
        `${spec.name} ${keyword}`,
      )
      if (oldClause === null) continue
      let expected = strip(oldClause)
      for (const [from, to, count] of spec.atoms) {
        const occurrences = strip(oldClause).split(strip(from)).length - 1
        if (occurrences === 0) continue
        expected = replaceCount(expected, strip(from), strip(to), count ?? 1)
      }
      assert.equal(strip(newClause), expected, `${spec.name} ${keyword}`)
      assert.ok(
        !/is_admin\(\)|current_user_role\(\)/.test(newClause),
        spec.name,
      )
    }
  }
})

test('every rewrite is equivalent for the six legacy roles under the frozen mapping', () => {
  for (const spec of [...FUNCTION_REWRITES, ...POLICY_REWRITES]) {
    assert.ok(spec.equivalence.length, spec.name)
    for (const rule of spec.equivalence)
      for (const role of rule.roles ?? ALL_ROLES)
        assert.equal(
          rule.new(perms(role)),
          rule.old(role),
          `${spec.name}: ${rule.label} for ${role}`,
        )
  }
})

test('after 0127 no live policy or function tests a role name, except by design', () => {
  // Latest policies across every migration.
  // A dropped table takes its policies with it (profile_projects, 0079).
  const policies = new Map()
  for (const file of FILES) {
    const sql = read(file)
    for (const p of policyStatements(sql)) {
      const key = `${p.table}:${p.name}`
      if (p.verb === 'DROP') policies.delete(key)
      else policies.set(key, p.text)
    }
    for (const m of sql.matchAll(
      /DROP TABLE(?: IF EXISTS)?\s+((?:public\.)?[a-z_]+)/gi,
    )) {
      const table = m[1].startsWith('public.') ? m[1] : 'public.' + m[1]
      for (const key of [...policies.keys()])
        if (key.startsWith(table + ':')) policies.delete(key)
    }
  }
  for (const [key, text] of policies)
    assert.ok(
      !/is_admin\(\)|current_user_role\(\)/.test(text),
      `${key} still tests a role`,
    )

  // Latest function bodies across every migration.
  const functions = new Map()
  for (const file of FILES)
    for (const block of functionBlocks(read(file)))
      if (block.drop) functions.delete(block.name)
      else functions.set(block.name, block.text)
  const ROLE_TEST = new RegExp(
    [
      /public\.is_admin\(\)/,
      /current_user_role\(\)\s*(=|<>|!=|IN\b|NOT IN\b)/,
      /v_role\s*(=|<>|!=|IS (NOT )?DISTINCT FROM|NOT IN|IN)\s*\(?'/,
      /v_role\s*=\s*ANY\s*\(/,
      /CASE\s+v_role\s+WHEN/,
      /\b\w+\.role\s*(=|<>|!=|IS (NOT )?DISTINCT FROM|NOT IN|IN)\s*\(?'/,
      /\b\w+\.role\s*=\s*ANY\s*\(/,
      /AND role = 'admin'/,
    ]
      .map((pattern) => pattern.source)
      .join('|'),
    'i',
  )
  // The widened test catches every shape it is meant to.
  for (const sample of [
    "v_role = ANY(ARRAY['admin'])",
    "CASE v_role WHEN 'admin' THEN",
    "me.role = 'admin'",
    "p.role IN ('workshop')",
    "x.role <> 'monitor'",
    "IF v_role NOT IN ('admin') THEN",
  ])
    assert.match(sample, ROLE_TEST, sample)
  const BY_DESIGN = new Set([
    // Admin parity: a legacy change to or from admin moves the assignment.
    'sync_profile_role_assignment',
    'is_admin',
    'current_user_role',
    'handle_new_user',
    'admin_upsert_role',
    'admin_set_role_permissions',
    'admin_assign_profile_role',
    'admin_delete_role',
    'admin_roles_system_offenders',
    'admin_roles_system_preview',
    'set_roles_system_enabled',
  ])
  for (const [name, text] of functions)
    if (!BY_DESIGN.has(name))
      assert.ok(!ROLE_TEST.test(code(text)), `${name} still tests a role`)
  // The six roles of the Edge Functions and the account form stay the
  // allowlist of admin_set_user_role.
  assert.match(
    code(functions.get('admin_set_user_role')),
    /IF p_role NOT IN \(/,
  )
  assert.deepEqual([...WORKSHOP_ROLES].sort(), [
    'assistant_workshop_manager',
    'workshop',
    'workshop_manager',
  ])
})
