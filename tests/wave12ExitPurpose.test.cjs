// Wave 12: the purpose of a site EXIT in the lists, filters and exports
// (migration 0118). Pure and regex checks only, like the rest of the suite: no
// database is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261005100000_0118_exit_purpose_in_views.sql'
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
        // `listConfigs` reaches `driverExcel`, which uses the spreadsheet
        // library at module scope.
        if (request === 'xlsx') return require('xlsx')
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
const purpose = loadLibModule('exitPurpose', cache)
const visits = loadLibModule('visitsList', cache)
const configs = loadLibModule('listConfigs', cache)
const logSearch = loadLibModule('movementLogSearch', cache)
const admin = loadLibModule('adminHomeStats', cache)
const exporter = loadLibModule('adminHomeExport', cache)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const fakeT = (key) => `[${key}]`

// --- Migration ---------------------------------------------------------------

/** The definition without comment lines, so only the SQL is compared. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

/** `CREATE OR REPLACE VIEW public.<name>` up to its terminating `;`. */
function viewBlock(sql, name) {
  const start = sql.lastIndexOf(`CREATE OR REPLACE VIEW public.${name}`)
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf(';\n', start) + 1)
}

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

test('0118 is a new migration ordered after 0117', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0118_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0117_/.test(file)),
  )
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  // The filter needs no index (see the migration's index note).
  assert.ok(!/CREATE (UNIQUE )?INDEX/.test(code(SQL)))
})

test('movement_log_search is 0116 verbatim plus exit_purpose appended', () => {
  const before = code(viewBlock(migration('0116'), 'movement_log_search'))
  const after = code(viewBlock(SQL, 'movement_log_search'))
  const expected = replaceOnce(
    before,
    '  p.name_ar_search AS project_name_ar_search\nFROM',
    '  p.name_ar_search AS project_name_ar_search,\n  l.exit_purpose AS exit_purpose\nFROM',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
})

test('movement_visits is 0116 verbatim plus the paired exit purpose appended', () => {
  const before = code(viewBlock(migration('0116'), 'movement_visits'))
  const after = code(viewBlock(SQL, 'movement_visits'))
  let expected = replaceOnce(
    before,
    '    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id\n',
    '    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id,\n' +
      '    LEAD(l.exit_purpose) OVER visit_order AS next_exit_purpose\n',
  )
  expected = replaceOnce(
    expected,
    '  public.normalize_search_text(p.driver_name) AS driver_name_search\nFROM',
    '  public.normalize_search_text(p.driver_name) AS driver_name_search,\n' +
      '  CASE\n' +
      "    WHEN p.next_movement_type = 'exit' THEN p.next_exit_purpose\n" +
      '  END AS exit_purpose\nFROM',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The pairing window is untouched: same partition, same (recorded_at, id).
  assert.match(
    after,
    /PARTITION BY l\.equipment_id, l\.movement_context\s+ORDER BY l\.recorded_at, l\.id/,
  )
})

test('admin_equipment_state is 0107 verbatim plus last_exit_purpose appended', () => {
  const before = code(viewBlock(migration('0107'), 'admin_equipment_state'))
  const after = code(viewBlock(SQL, 'admin_equipment_state'))
  let expected = replaceOnce(
    before,
    '  m.project_id AS last_project_id\nFROM',
    '  m.project_id AS last_project_id,\n  m.exit_purpose AS last_exit_purpose\nFROM',
  )
  expected = replaceOnce(
    expected,
    '    l.project_id\n  FROM public.entry_exit_logs l',
    '    l.project_id,\n    l.exit_purpose\n  FROM public.entry_exit_logs l',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
})

test('get_admin_fleet_equipment is 0107 verbatim plus one OUT column', () => {
  const before = code(
    functionBlock(migration('0107'), 'get_admin_fleet_equipment'),
  )
  const after = code(functionBlock(SQL, 'get_admin_fleet_equipment'))
  let expected = replaceOnce(
    before,
    'CREATE OR REPLACE FUNCTION',
    'CREATE FUNCTION',
  )
  expected = replaceOnce(
    expected,
    '  project_name_en text\n)',
    '  project_name_en text,\n  last_exit_purpose text\n)',
  )
  expected = replaceOnce(
    expected,
    '    p.name_en AS project_name_en\n  FROM',
    '    p.name_en AS project_name_en,\n    s.last_exit_purpose\n  FROM',
  )
  assert.equal(after, expected)
  // Dropped first (the result type changes), with the same signature, and
  // the grants and the comment are repeated.
  const signature =
    'public\\.get_admin_fleet_equipment\\(text, text\\[\\], text, int, int\\)'
  const drop = SQL.search(new RegExp(`DROP FUNCTION IF EXISTS ${signature};`))
  assert.ok(drop >= 0 && drop < SQL.indexOf('CREATE FUNCTION'))
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION\\s+${signature}\\s+FROM PUBLIC, anon;`),
  )
  assert.match(
    SQL,
    new RegExp(
      `GRANT EXECUTE ON FUNCTION\\s+${signature}\\s+TO authenticated;`,
    ),
  )
  assert.match(SQL, new RegExp(`COMMENT ON FUNCTION\\s+${signature} IS`))
  assert.match(after, /SECURITY INVOKER\s+SET search_path = public, pg_temp/)
  assert.ok(!/SECURITY DEFINER/.test(code(SQL)))
})

test('every recreated view repeats its revoke and grant', () => {
  for (const name of [
    'movement_log_search',
    'movement_visits',
    'admin_equipment_state',
  ]) {
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON public\\.${name} FROM PUBLIC, anon;\\s*GRANT SELECT ON public\\.${name} TO authenticated;`,
      ),
    )
    assert.match(SQL, new RegExp(`COMMENT ON VIEW public\\.${name} IS`))
  }
})

// --- Shared helpers ----------------------------------------------------------

test('the purpose helpers accept the two stored values only', () => {
  assert.equal(purpose.exitPurposeOrNull('maintenance'), 'maintenance')
  assert.equal(purpose.exitPurposeOrNull('work_completed'), 'work_completed')
  assert.equal(purpose.exitPurposeOrNull('parking'), null)
  assert.equal(purpose.exitPurposeOrNull(null), null)
  assert.equal(
    purpose.exitPurposeExportLabel('maintenance', fakeT),
    '[exitPurposeMaintenance]',
  )
  assert.equal(
    purpose.exitPurposeExportLabel('work_completed', fakeT),
    '[exitPurposeWorkCompleted]',
  )
  assert.equal(purpose.exitPurposeExportLabel(null, fakeT), '')
  assert.equal(purpose.exitPurposeExportLabel('bogus', fakeT), '')
})

test('the filter offers exactly the stored values, with plain-alif Arabic', () => {
  const field = purpose.EXIT_PURPOSE_FILTER_FIELD
  assert.equal(field.key, 'exit_purpose')
  assert.equal(field.type, 'select')
  assert.deepEqual(plain(field.operators), ['eq'])
  assert.deepEqual(
    plain(field.options.map((option) => option.value)),
    plain([...purpose.EXIT_PURPOSES]),
  )
  for (const option of field.options) assert.ok(!/[أإآ]/.test(option.label))
})

test('both admin log views allowlist the exit purpose filter', () => {
  const logs = configs.logsListConfig.filterFields.map((field) => field.key)
  assert.ok(logs.includes('exit_purpose'))
  const visitKeys = visits.adminVisitsListConfig.filterFields.map(
    (field) => field.key,
  )
  assert.ok(visitKeys.includes('exit_purpose'))
  // The home lists keep their own small filter sets.
  for (const config of [
    visits.visitsListConfig,
    visits.foremanVisitsListConfig,
  ])
    assert.ok(
      !config.filterFields.some((field) => field.key === 'exit_purpose'),
    )
})

// --- Visits ------------------------------------------------------------------

const visit = (overrides) => ({
  entry_id: 'en1',
  exit_id: 'ex1',
  equipment_id: 'e1',
  movement_context: 'site',
  entry_at: '2026-09-20T07:00:00Z',
  exit_at: '2026-09-20T10:00:00Z',
  is_open: false,
  exit_purpose: 'maintenance',
  ...overrides,
})

test('a closed visit shows the purpose of its exit; nothing otherwise', () => {
  assert.equal(visits.visitExitPurpose(visit()), 'maintenance')
  assert.equal(
    visits.visitExitPurpose(visit({ exit_purpose: 'work_completed' })),
    'work_completed',
  )
  // Open (or its exit hidden): the state alone.
  assert.equal(
    visits.visitExitPurpose(
      visit({ is_open: true, exit_id: null, exit_at: null }),
    ),
    null,
  )
  assert.equal(visits.visitExitPurpose(visit({ exit_id: null })), null)
  // Workshop visits and exits before 0111 carry NULL.
  assert.equal(
    visits.visitExitPurpose(
      visit({ movement_context: 'workshop', exit_purpose: null }),
    ),
    null,
  )
  assert.equal(visits.visitExitPurpose(visit({ exit_purpose: null })), null)
  assert.ok(visits.EQUIPMENT_VISITS_SELECT.split(',').includes('exit_purpose'))
})

test('the visits export writes the purpose right after the state', () => {
  const columns = visits.visitExportColumns(fakeT, 'ar')
  const headers = columns.map((column) => column.header)
  const at = headers.indexOf('[exitPurpose]')
  assert.equal(at, headers.indexOf('[visitState]') + 1)
  const cell = (row) => columns[at].value(row)
  assert.equal(cell(visit()), '[exitPurposeMaintenance]')
  assert.equal(
    cell(visit({ exit_purpose: 'work_completed' })),
    '[exitPurposeWorkCompleted]',
  )
  assert.equal(cell(visit({ is_open: true, exit_id: null, exit_at: null })), '')
  assert.equal(cell(visit({ exit_purpose: null })), '')
})

// --- Movement log ------------------------------------------------------------

test('the home log reads the purpose and the row mapper keeps it', () => {
  assert.ok(
    logSearch.MOVEMENT_LOG_SUPERVISOR_SELECT.split(',').includes(
      'exit_purpose',
    ),
  )
  const mapped = logSearch.mapMovementLogRow({
    id: 'm1',
    equipment_id: 'e1',
    supervisor_id: 'u1',
    movement_type: 'exit',
    movement_context: 'site',
    driver_name: null,
    recorded_at: '2026-09-20T10:00:00Z',
    created_at: '2026-09-20T10:00:00Z',
    exit_purpose: 'work_completed',
  })
  assert.equal(mapped.exit_purpose, 'work_completed')
  const legacy = logSearch.mapMovementLogRow({
    id: 'm2',
    equipment_id: 'e1',
    supervisor_id: 'u1',
    movement_type: 'exit',
    driver_name: null,
    recorded_at: '2026-09-20T10:00:00Z',
    created_at: '2026-09-20T10:00:00Z',
  })
  assert.equal(legacy.exit_purpose, null)
})

test('the /logs list and the inquiry timeline select the purpose', () => {
  const logs = fs.readFileSync(
    path.join(ROOT, 'src', 'screens', 'admin-home', 'LogsScreen.tsx'),
    'utf8',
  )
  assert.match(
    logs,
    /const LIST_SELECT = `\$\{MOVEMENT_LOG_ADMIN_SELECT\},[^`]*exit_purpose`/,
  )
  const inquiry = fs.readFileSync(
    path.join(ROOT, 'src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
    'utf8',
  )
  assert.match(inquiry, /driver_name,exit_purpose'/)
  assert.match(inquiry, /exit_purpose: row\.exit_purpose \?\? null/)
})

// --- Admin home «المتاحة» ----------------------------------------------------

test('the fleet rows carry the purpose of the last site exit', () => {
  const page = admin.parseFleetEquipmentPage([
    {
      total_count: 3,
      id: 'a',
      code: 'A-1',
      state: 'available',
      last_exit_purpose: 'maintenance',
    },
    {
      total_count: 3,
      id: 'b',
      code: 'A-2',
      state: 'available',
      last_exit_purpose: 'bogus',
    },
    // A payload from before 0118 has no such key at all.
    { total_count: 3, id: 'c', code: 'A-3', state: 'available' },
  ])
  assert.deepEqual(plain(page.rows.map((row) => row.exitPurpose)), [
    'maintenance',
    null,
    null,
  ])
})

test('the available export adds the purpose after the last exit', () => {
  const columns = exporter.fleetEquipmentExcelColumns('available', {
    t: fakeT,
    lang: 'ar',
    ownerLabel: (owner) => owner,
  })
  const headers = columns.map((column) => column.header)
  const at = headers.indexOf('[exitPurpose]')
  assert.equal(at, headers.indexOf('[adminHomeColLastExit]') + 1)
  assert.equal(
    columns[at].value({ exitPurpose: 'work_completed' }),
    '[exitPurposeWorkCompleted]',
  )
  assert.equal(columns[at].value({ exitPurpose: null }), '')
  // The inside and workshop exports are unchanged.
  for (const table of ['inside', 'workshop'])
    assert.ok(
      !exporter
        .fleetEquipmentExcelColumns(table, {
          t: fakeT,
          lang: 'ar',
          ownerLabel: (owner) => owner,
        })
        .some((column) => column.header === '[exitPurpose]'),
    )
})
