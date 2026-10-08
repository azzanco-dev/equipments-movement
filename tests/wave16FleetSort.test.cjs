// Wave 16: column sorting for the admin home fleet mini tables (migration
// 0121). Pure and regex checks only, like the rest of the suite: no database
// is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261008100000_0121_fleet_equipment_sort.sql'
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')

/** Loads a src/lib module; `@/lib/...` imports resolve to the real files. */
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      String,
      Object,
      Array,
      JSON,
      require(request) {
        const alias = /^@\/lib\/(.+)$/.exec(request)
        if (alias) return loadLibModule(alias[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const cache = new Map()
const admin = loadLibModule('adminHomeStats', cache)
const exporter = loadLibModule('adminHomeExport', cache)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- Migration ---------------------------------------------------------------

/** The definition without comment lines, so only the SQL is compared. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

/** A function definition up to the end of its `$$` body. */
function functionBlock(sql, name) {
  const start = sql.search(
    new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)) + 3)
}

/** Replaces exactly one occurrence, failing when the anchor is missing. */
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `anchor found once: ${from}`)
  return text.replace(from, to)
}

/** The allowlist the function checks, in source order. */
function sqlSortAllowlist(sql) {
  const match = /IF v_sort NOT IN \(([^)]*)\) THEN/.exec(code(sql))
  assert.ok(match, 'the p_sort allowlist check exists')
  return match[1].match(/'[^']+'/g).map((value) => value.slice(1, -1))
}

test('0121 is a new migration ordered after 0120', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0121_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0120_/.test(file)),
  )
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  assert.ok(!/CREATE (UNIQUE )?INDEX/.test(code(SQL)))
  assert.ok(!/SECURITY DEFINER/.test(code(SQL)))
})

test('get_admin_fleet_equipment is 0118 verbatim plus p_sort and its order', () => {
  const before = code(
    functionBlock(migration('0118'), 'get_admin_fleet_equipment'),
  )
  const after = code(functionBlock(SQL, 'get_admin_fleet_equipment'))
  let expected = replaceOnce(
    before,
    '  p_offset int DEFAULT 0\n)',
    '  p_offset int DEFAULT 0,\n  p_sort text DEFAULT NULL\n)',
  )
  expected = replaceOnce(
    expected,
    '  v_states text[];\nBEGIN',
    "  v_states text[];\n  v_sort text := COALESCE(p_sort, 'last_movement_desc');\nBEGIN",
  )
  // The new check sits between the purpose checks and the owner filter.
  const check = /\n {2}IF v_sort NOT IN \([\s\S]*?\n {2}END IF;\n/.exec(after)
  assert.ok(check, 'the sort check exists')
  expected = replaceOnce(
    expected,
    '\n  v_owners := public.admin_home_owner_filter(p_owners);',
    `${check[0].slice(0, -1)}\n  v_owners := public.admin_home_owner_filter(p_owners);`,
  )
  // The old order stays as the tail; only CASE terms are put in front of it.
  const order =
    /\n {2}ORDER BY\n([\s\S]*?)\n {4}s\.last_movement_at DESC NULLS LAST, s\.id\n/.exec(
      after,
    )
  assert.ok(order, 'the order keeps its old tail')
  for (const term of order[1].split(/,\n(?= {4}CASE WHEN)/))
    assert.match(
      term.trim(),
      /^CASE WHEN v_sort = '[a-z_]+' THEN [\s\S]+ END (ASC|DESC) NULLS LAST,?$/,
    )
  expected = replaceOnce(
    expected,
    '\n  ORDER BY s.last_movement_at DESC NULLS LAST, s.id\n',
    `\n  ORDER BY\n${order[1]}\n    s.last_movement_at DESC NULLS LAST, s.id\n`,
  )
  assert.equal(after, expected)
  // Unchanged security shape.
  assert.match(after, /SECURITY INVOKER\s+SET search_path = public, pg_temp/)
  assert.match(
    after,
    /IF v_role IS NULL OR v_role NOT IN \('admin', 'monitor'\)/,
  )
  assert.match(
    check[0],
    /RAISE EXCEPTION 'unknown fleet sort' USING ERRCODE = '22023';/,
  )
})

test('the five-argument function is dropped, the six-argument one granted', () => {
  const old =
    'public\\.get_admin_fleet_equipment\\(text, text\\[\\], text, int, int\\)'
  const next =
    'public\\.get_admin_fleet_equipment\\(text, text\\[\\], text, int, int, text\\)'
  const drop = SQL.search(new RegExp(`DROP FUNCTION IF EXISTS ${old};`))
  assert.ok(drop >= 0)
  assert.ok(
    drop < SQL.indexOf('CREATE FUNCTION public.get_admin_fleet_equipment('),
  )
  // Exactly one definition, so a five-named-argument call (the deployed UI)
  // resolves to it through the defaulted p_sort with no ambiguous overload.
  assert.equal(code(SQL).match(/CREATE (OR REPLACE )?FUNCTION/g).length, 1)
  assert.match(code(SQL), /p_sort text DEFAULT NULL\n\)/)
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION\\s+${next}\\s+FROM PUBLIC, anon;`),
  )
  assert.match(
    SQL,
    new RegExp(`GRANT EXECUTE ON FUNCTION\\s+${next}\\s+TO authenticated;`),
  )
  assert.match(SQL, new RegExp(`COMMENT ON FUNCTION\\s+${next} IS`))
  assert.ok(!new RegExp(`(REVOKE|GRANT|COMMENT)[^;]*${old}`).test(code(SQL)))
})

test('the database and the client allowlist the same sort keys', () => {
  assert.deepEqual(sqlSortAllowlist(SQL), plain([...admin.FLEET_SORT_KEYS]))
  assert.equal(admin.DEFAULT_FLEET_SORT_KEY, 'last_movement_desc')
  // Every non-default key has its own ORDER BY term; the default is the tail.
  const body = code(functionBlock(SQL, 'get_admin_fleet_equipment'))
  for (const key of admin.FLEET_SORT_KEYS) {
    if (key === 'last_movement_desc') continue
    const direction = key.endsWith('_asc') ? 'ASC' : 'DESC'
    assert.match(
      body,
      new RegExp(
        `CASE WHEN v_sort = '${key}' THEN [\\s\\S]+? END ${direction} NULLS LAST`,
      ),
      key,
    )
  }
  assert.ok(!/v_sort = 'last_movement_desc'/.test(body.split('BEGIN')[1]))
  // Company and project sort by their Arabic names, the returned values.
  assert.match(body, /v_sort = 'company_asc' THEN c\.name_ar END ASC/)
  assert.match(body, /v_sort = 'company_asc' THEN p\.name_ar END ASC/)
})

// --- Client allowlist --------------------------------------------------------

test('a header sort maps to an allowlisted p_sort, the default to none', () => {
  const arg = (key, direction) => admin.fleetSortArgument({ key, direction })
  // The default order (either date column, newest first) sends nothing.
  assert.equal(arg('since', 'desc'), null)
  assert.equal(arg('lastExit', 'desc'), null)
  assert.equal(arg('since', 'asc'), 'last_movement_asc')
  assert.equal(arg('lastExit', 'asc'), 'last_movement_asc')
  assert.equal(arg('code', 'asc'), 'code_asc')
  assert.equal(arg('code', 'desc'), 'code_desc')
  assert.equal(arg('type', 'desc'), 'type_desc')
  assert.equal(arg('owner', 'asc'), 'owner_asc')
  assert.equal(arg('companyProject', 'desc'), 'company_desc')
  assert.equal(arg('purpose', 'asc'), 'workshop_purpose_asc')
  assert.equal(arg('exitPurpose', 'desc'), 'exit_purpose_desc')
  // Fails closed.
  assert.equal(arg('foreman', 'asc'), null)
  assert.equal(arg('state', 'asc'), null)
  assert.equal(arg('toString', 'asc'), null)
  assert.equal(arg('__proto__', 'asc'), null)
  assert.equal(arg('code', 'sideways'), null)
  assert.equal(admin.fleetSortArgument(null), null)
  assert.equal(admin.fleetSortArgument(undefined), null)
  for (const field of Object.values(admin.FLEET_SORT_COLUMNS))
    for (const direction of ['asc', 'desc'])
      assert.ok(admin.isFleetSortKey(`${field}_${direction}`))
  assert.equal(admin.isFleetSortKey('code; DROP TABLE equipment'), false)
})

test('p_sort is only sent for an allowlisted, non-default order', () => {
  const base = {
    state: 'inside_site',
    owners: ['alazani'],
    page: 2,
    pageSize: 20,
  }
  // The default request is the five arguments the deployed UI sends.
  assert.deepEqual(plain(admin.fleetEquipmentRpcArgs(base)), {
    p_state: 'inside_site',
    p_owners: ['alazani'],
    p_purpose: null,
    p_limit: 20,
    p_offset: 20,
  })
  for (const sort of [null, undefined, 'last_movement_desc', 'bogus'])
    assert.ok(!('p_sort' in admin.fleetEquipmentRpcArgs({ ...base, sort })))
  assert.equal(
    admin.fleetEquipmentRpcArgs({ ...base, sort: 'code_desc' }).p_sort,
    'code_desc',
  )
  // The workshop chip still reaches p_purpose, and only for the workshop.
  assert.equal(
    admin.fleetEquipmentRpcArgs({
      ...base,
      state: 'workshop',
      purpose: 'parking',
      sort: 'owner_asc',
    }).p_purpose,
    'parking',
  )
  assert.equal(
    admin.fleetEquipmentRpcArgs({ ...base, purpose: 'parking' }).p_purpose,
    null,
  )
})

// --- Export ------------------------------------------------------------------

test('the export walks every page in the order the table shows', async () => {
  // A stand-in for the database: it honours p_sort the way 0121 does for
  // code, and pages with p_limit / p_offset.
  const units = ['A-3', 'A-1', 'A-4', 'A-2', 'A-5'].map((value, index) => ({
    id: `u${index}`,
    code: value,
  }))
  const calls = []
  const database = (args) => {
    calls.push(args)
    const rows = [...units]
    if (args.p_sort === 'code_asc')
      rows.sort((a, b) => a.code.localeCompare(b.code))
    if (args.p_sort === 'code_desc')
      rows.sort((a, b) => b.code.localeCompare(a.code))
    return {
      rows: rows.slice(args.p_offset, args.p_offset + args.p_limit),
      total: rows.length,
    }
  }
  const collected = await exporter.collectAllPages(
    async (page, pageSize) =>
      database(
        admin.fleetEquipmentRpcArgs({
          state: 'available',
          owners: ['alazani'],
          page,
          pageSize,
          sort: 'code_desc',
        }),
      ),
    { pageSize: 2 },
  )
  assert.deepEqual(plain(collected.rows.map((row) => row.code)), [
    'A-5',
    'A-4',
    'A-3',
    'A-2',
    'A-1',
  ])
  assert.equal(calls.length, 3)
  assert.ok(calls.every((args) => args.p_sort === 'code_desc'))
})

test('the table, its pages and its export share one sort argument', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin-home', 'FleetMiniTables.tsx'),
    'utf8',
  )
  // The collapsed card reads the default order; the expanded table its sort.
  assert.match(
    source,
    /const sortArgument = expanded && defaultSort \? fleetSortArgument\(sort\) : null/,
  )
  assert.match(
    source,
    /loadPage\(expanded \? page : 1, pageSize, expanded, signal, sortArgument\)/,
  )
  assert.match(
    source,
    /loadPage\(exportPage, size, true, controller\.signal, sortArgument\)/,
  )
  // A new order goes back to page 1.
  assert.match(
    source,
    /const changeSort = [^{]*\{\s*setSort\(\{ key, direction \}\)\s*setPage\(1\)/,
  )
  // All three state loaders forward the sort to the database call.
  for (const state of ['inside_site', 'workshop', 'available'])
    assert.match(
      source,
      new RegExp(`state: '${state}',[^}]*pageSize, sort \\}`),
      state,
    )
  // Each state table starts on the database's default order.
  assert.equal(
    source.match(
      /defaultSort=\{\{ key: (sinceColumn|lastExitColumn)\.key, direction: 'desc' \}\}/g,
    ).length,
    3,
  )
})
