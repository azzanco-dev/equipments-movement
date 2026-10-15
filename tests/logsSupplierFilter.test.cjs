// Owner request 2026-10-15 (migration 0132): the supplier («المورد») in the
// admin log, both views (also embedded in the workshop managers' home). A
// multi-select filter over `lessors`, offered only while the owner filter
// selects «مالك اخر», dropped when the owner stops selecting it, and the
// supplier name as a muted line under the equipment, with no new column.
// Pure and source checks only, like the rest of the suite: no database.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261015120000_0132_movement_views_lessor.sql'
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}

/** Loads a source module with `@/...` and relative imports resolved; anything
 *  outside `src` (or a missing file) is a stub: only pure helpers are called. */
function loadModule(file, cache = new Map()) {
  const resolved = resolveFile(file)
  if (cache.has(resolved)) return cache.get(resolved)
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(resolved, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      React: { createElement: () => null },
      require(request) {
        const target = request.startsWith('@/')
          ? path.join(ROOT, 'src', request.slice(2))
          : request.startsWith('.')
            ? path.join(path.dirname(resolved), request)
            : null
        if (!target || !fileExists(target)) return stub()
        return loadModule(target, cache)
      },
    },
    { filename: resolved },
  )
  return exports
}
const candidates = (file) => [file, `${file}.ts`, `${file}.tsx`]
const fileExists = (file) =>
  candidates(file).some(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
function resolveFile(file) {
  for (const candidate of candidates(file))
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}
const stub = () => new Proxy({}, { get: () => () => null })

const cache = new Map()
const src = (...parts) => path.join(ROOT, 'src', ...parts)
const supplier = loadModule(src('lib', 'equipmentSupplier.ts'), cache)
const filterState = loadModule(
  src('components', 'data-list', 'listFilterState.ts'),
  cache,
)
const { filterBarOperator } = loadModule(
  src('components', 'data-list', 'FilterBar.tsx'),
  cache,
)
const { logsListConfig } = loadModule(src('lib', 'listConfigs.ts'), cache)
const { adminVisitsListConfig } = loadModule(src('lib', 'visitsList.ts'), cache)
const { applyListFilters } = loadModule(
  src('lib', 'applyListFilters.ts'),
  cache,
)
const { SupabaseLoadError } = loadModule(src('lib', 'supabaseResult.ts'), cache)
const { translations } = loadModule(src('i18n', 'translations.ts'), cache)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const HAMZA_ALIFS = /[أإآ]/

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

/** Replaces exactly one occurrence, failing when the anchor is missing. */
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `anchor found once: ${from}`)
  return text.replace(from, to)
}

test('0132 is a new migration after 0131, and 0124 is the latest view source', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0132_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0131_/.test(file)),
  )
  const between = files.slice(
    files.findIndex((file) => /_0124_/.test(file)) + 1,
    files.indexOf(MIGRATION),
  )
  for (const file of between) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
    assert.doesNotMatch(sql, /VIEW public\.movement_log_search/, file)
    assert.doesNotMatch(sql, /VIEW public\.movement_visits/, file)
  }
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  // Only the two views: no data change, no index, no function.
  const body = code(SQL)
  assert.doesNotMatch(body, /CREATE (UNIQUE )?INDEX/)
  assert.doesNotMatch(body, /\b(UPDATE|DELETE FROM|INSERT INTO)\b/)
  assert.doesNotMatch(body, /CREATE (OR REPLACE )?FUNCTION/)
  assert.equal((body.match(/CREATE OR REPLACE VIEW/g) ?? []).length, 2)
  // equipment.lessor_id is already indexed (0037), so none is added.
  assert.match(
    migration('0037'),
    /CREATE INDEX IF NOT EXISTS equipment_lessor_id_idx\s+ON public\.equipment \(lessor_id\)/,
  )
  assert.doesNotMatch(SQL, HAMZA_ALIFS)
})

test('movement_log_search is 0124 verbatim plus the supplier id and name appended', () => {
  const before = code(viewBlock(migration('0124'), 'movement_log_search'))
  const after = code(viewBlock(SQL, 'movement_log_search'))
  let expected = replaceOnce(
    before,
    '  d.full_name AS driver_full_name\nFROM',
    '  d.full_name AS driver_full_name,\n' +
      '  e.lessor_id AS equipment_lessor_id,\n' +
      '  ls.name AS equipment_lessor_name\nFROM',
  )
  expected = replaceOnce(
    expected,
    'LEFT JOIN public.drivers d ON d.id = l.driver_id;',
    'LEFT JOIN public.drivers d ON d.id = l.driver_id\n' +
      'LEFT JOIN public.lessors ls ON ls.id = e.lessor_id;',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The existing equipment join is reused; one lessors join on its key.
  assert.equal((after.match(/JOIN public\.equipment /g) ?? []).length, 1)
  assert.equal((after.match(/JOIN public\.lessors /g) ?? []).length, 1)
})

test('movement_visits is 0124 verbatim plus the supplier id and name appended', () => {
  const before = code(viewBlock(migration('0124'), 'movement_visits'))
  const after = code(viewBlock(SQL, 'movement_visits'))
  let expected = replaceOnce(
    before,
    '  dv.full_name AS driver_full_name\nFROM',
    '  dv.full_name AS driver_full_name,\n' +
      '  e.lessor_id AS equipment_lessor_id,\n' +
      '  ls.name AS equipment_lessor_name\nFROM',
  )
  expected = replaceOnce(
    expected,
    'LEFT JOIN public.drivers dv ON dv.id = p.driver_id\n',
    'LEFT JOIN public.drivers dv ON dv.id = p.driver_id\n' +
      'LEFT JOIN public.lessors ls ON ls.id = e.lessor_id\n',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The pairing window is untouched: same partition, same (recorded_at, id).
  assert.match(
    after,
    /PARTITION BY l\.equipment_id, l\.movement_context\s+ORDER BY l\.recorded_at, l\.id/,
  )
  assert.match(after, /WHERE p\.movement_type = 'entry';$/)
})

test('both views restate their grants and name the new columns in the comment', () => {
  for (const view of ['movement_log_search', 'movement_visits']) {
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON public\\.${view} FROM PUBLIC, anon;`),
    )
    assert.match(
      SQL,
      new RegExp(`GRANT SELECT ON public\\.${view} TO authenticated;`),
    )
    const comment = SQL.slice(SQL.indexOf(`COMMENT ON VIEW public.${view}`))
    const text = comment.slice(0, comment.indexOf(';\n'))
    // 0124's comment is kept (driver_full_name) and extended.
    assert.match(text, /driver_full_name \(0124\)/)
    assert.match(text, /equipment_lessor_name \(0132\)/)
  }
})

// --- Configs -----------------------------------------------------------------

test('both admin log configs allowlist the supplier as an in-only multi-select', () => {
  for (const config of [logsListConfig, adminVisitsListConfig]) {
    const keys = config.filterFields.map((field) => field.key)
    const field = config.filterFields.find(
      (item) => item.key === 'equipment_lessor_id',
    )
    assert.ok(field, config.id)
    assert.deepEqual(Array.from(field.operators), ['in'])
    assert.equal(field.multiple, true)
    assert.equal(filterBarOperator(field), 'in')
    assert.equal(field.label, 'supplierFilter')
    assert.deepEqual(plain(field.visibleWhen), {
      field: 'equipment_ownership_status',
      includes: 'external_supplier',
    })
    // Placed right after the owner filter it depends on.
    assert.equal(
      keys.indexOf('equipment_lessor_id'),
      keys.indexOf('equipment_ownership_status') + 1,
    )
    // The owner filter offers «مالك اخر».
    const owner = config.filterFields.find(
      (item) => item.key === 'equipment_ownership_status',
    )
    assert.ok(
      owner.options.some((option) => option.value === 'external_supplier'),
    )
  }
})

/** Records every PostgREST builder call. */
function recordingQuery() {
  const calls = []
  const query = new Proxy(
    {},
    {
      get: (_, method) =>
        method === 'calls'
          ? calls
          : (...args) => {
              calls.push([method, ...args])
              return query
            },
    },
  )
  return query
}

test('the supplier filter reaches PostgREST as one in over equipment_lessor_id', () => {
  for (const config of [logsListConfig, adminVisitsListConfig]) {
    const query = recordingQuery()
    applyListFilters(
      query,
      [
        {
          id: 'o',
          field: 'equipment_ownership_status',
          operator: 'eq',
          value: 'external_supplier',
        },
        {
          id: 's',
          field: 'equipment_lessor_id',
          operator: 'in',
          value: 'l1,l2',
        },
      ],
      new Set(config.filterFields.map((field) => field.key)),
    )
    assert.deepEqual(plain(query.calls), [
      ['eq', 'equipment_ownership_status', 'external_supplier'],
      ['in', 'equipment_lessor_id', ['l1', 'l2']],
    ])
  }
})

// --- Visibility ----------------------------------------------------------------

const SUPPLIER = {
  key: 'equipment_lessor_id',
  visibleWhen: {
    field: 'equipment_ownership_status',
    includes: 'external_supplier',
  },
}
const owner = (operator, value) => ({
  id: 'o',
  field: 'equipment_ownership_status',
  operator,
  value,
})
const supplierPick = {
  id: 's',
  field: 'equipment_lessor_id',
  operator: 'in',
  value: 'l1',
}

test('the supplier is offered only while the owner selects «مالك اخر»', () => {
  const { isFilterFieldVisible } = filterState
  assert.equal(isFilterFieldVisible(SUPPLIER, []), false)
  assert.equal(
    isFilterFieldVisible(SUPPLIER, [owner('eq', 'external_supplier')]),
    true,
  )
  assert.equal(isFilterFieldVisible(SUPPLIER, [owner('eq', 'alazani')]), false)
  // A multi-value owner selection that includes it.
  assert.equal(
    isFilterFieldVisible(SUPPLIER, [owner('in', 'alazani,external_supplier')]),
    true,
  )
  assert.equal(
    isFilterFieldVisible(SUPPLIER, [owner('in', 'alazani,takween')]),
    false,
  )
  // Negative owner filters never select it.
  assert.equal(
    isFilterFieldVisible(SUPPLIER, [owner('neq', 'external_supplier')]),
    false,
  )
  assert.equal(
    isFilterFieldVisible(SUPPLIER, [owner('not_in', 'external_supplier')]),
    false,
  )
  // A field without a rule is always offered.
  assert.equal(isFilterFieldVisible({ key: 'x' }, []), true)
})

test('changing the owner away from «مالك اخر» drops the supplier filter', () => {
  const { withoutHiddenFilters } = filterState
  const fields = logsListConfig.filterFields
  const kept = withoutHiddenFilters(
    [owner('eq', 'external_supplier'), supplierPick],
    fields,
  )
  assert.deepEqual(
    plain(kept).map((filter) => filter.field),
    ['equipment_ownership_status', 'equipment_lessor_id'],
  )
  const changed = withoutHiddenFilters(
    [owner('eq', 'takween'), supplierPick],
    fields,
  )
  assert.deepEqual(
    plain(changed).map((filter) => filter.field),
    ['equipment_ownership_status'],
  )
  const removed = withoutHiddenFilters([supplierPick], fields)
  assert.deepEqual(plain(removed), [])
})

test('a URL carrying a supplier without the owner is read without it', () => {
  const { listFiltersFromParam } = filterState
  for (const config of [logsListConfig, adminVisitsListConfig]) {
    assert.deepEqual(
      plain(listFiltersFromParam(JSON.stringify([supplierPick]), config)),
      [],
    )
    const both = listFiltersFromParam(
      JSON.stringify([owner('eq', 'external_supplier'), supplierPick]),
      config,
    )
    assert.equal(both.length, 2)
  }
})

test('the filter bar hides the dependent field and prunes it on every change', () => {
  const source = read('src/components/data-list/FilterBar.tsx')
  assert.match(source, /const result = withoutHiddenFilters\(changed, fields\)/)
  assert.match(
    source,
    /fields\.filter\(\(field\) =>\s*isFilterFieldVisible\(field, filters\),?\s*\)/,
  )
  assert.match(source, /\{visibleFields\.map\(/)
})

// --- Loader --------------------------------------------------------------------

/** A fake client whose every query records its calls and resolves `result`. */
function fakeClient(result) {
  const calls = []
  const query = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  for (const method of ['select', 'order', 'limit', 'or', 'in'])
    query[method] = (...args) => {
      calls.push([method, ...args])
      return query
    }
  return {
    calls,
    from: (table) => {
      calls.push(['from', table])
      return query
    },
  }
}

test('the supplier options are a bounded server-side search over lessors', async () => {
  const client = fakeClient({
    data: [{ id: 'l1', name: 'مؤسسة النخبة' }],
    error: null,
  })
  const field = supplier.lessorFilterOptions(client)
  assert.deepEqual(plain(await field.loadOptions('')), [
    { value: 'l1', label: 'مؤسسة النخبة' },
  ])
  assert.deepEqual(plain(client.calls), [
    ['from', 'lessors'],
    ['select', 'id,name'],
    ['order', 'name'],
    ['order', 'id'],
    ['limit', 20],
  ])
  client.calls.length = 0
  await field.loadOptions('النخبة')
  const or = client.calls.find(([method]) => method === 'or')
  assert.ok(or, 'a typed term searches server-side')
  assert.match(or[1], /^name_search\.ilike\./)
})

test('a failed supplier search throws instead of reading as no results', async () => {
  const field = supplier.lessorFilterOptions(
    fakeClient({ data: null, error: { message: 'boom' } }),
  )
  await assert.rejects(field.loadOptions(''), (error) => {
    assert.ok(error instanceof SupabaseLoadError)
    // The raw PostgREST message never reaches the control.
    assert.doesNotMatch(error.message, /boom/)
    return true
  })
})

test('ids restored from the URL are named in one in query', async () => {
  const client = fakeClient({
    data: [
      { id: 'l1', name: 'A' },
      { id: 'l2', name: 'B' },
    ],
    error: null,
  })
  const field = supplier.lessorFilterOptions(client)
  assert.deepEqual(plain(await field.resolveOptions(['l1', 'l2'])), [
    { value: 'l1', label: 'A' },
    { value: 'l2', label: 'B' },
  ])
  assert.deepEqual(plain(client.calls), [
    ['from', 'lessors'],
    ['select', 'id,name'],
    ['in', 'id', ['l1', 'l2']],
  ])
  assert.deepEqual(plain(await field.resolveOptions([])), [])
})

test('both log views pass the supplier search under equipment_lessor_id', () => {
  const source = read('src/screens/admin-home/LogsScreen.tsx')
  assert.match(
    source,
    /const supplierFilter: FilterBarAsyncField = lessorFilterOptions\(supabase\)/,
  )
  const logs = source.slice(source.indexOf('const LOGS_ASYNC_FILTERS'))
  assert.match(
    logs.slice(0, logs.indexOf('}')),
    /\[SUPPLIER_FILTER_KEY\]: supplierFilter/,
  )
  const visits = source.slice(source.indexOf('const VISITS_ASYNC_FILTERS'))
  assert.match(
    visits.slice(0, visits.indexOf('}')),
    /\[SUPPLIER_FILTER_KEY\]: supplierFilter/,
  )
  assert.equal(supplier.SUPPLIER_FILTER_KEY, 'equipment_lessor_id')
})

// --- Supplier line -------------------------------------------------------------

test('the supplier line shows only for «مالك اخر» units that have a supplier', () => {
  const { equipmentSupplierLine } = supplier
  assert.equal(
    equipmentSupplierLine({
      equipment_ownership_status: 'external_supplier',
      equipment_lessor_name: 'مؤسسة النخبة',
    }),
    'مؤسسة النخبة',
  )
  assert.equal(
    equipmentSupplierLine({
      equipment_ownership_status: 'external_supplier',
      equipment_lessor_name: null,
    }),
    null,
  )
  assert.equal(
    equipmentSupplierLine({
      equipment_ownership_status: 'external_supplier',
      equipment_lessor_name: '  ',
    }),
    null,
  )
  assert.equal(
    equipmentSupplierLine({ equipment_ownership_status: 'external_supplier' }),
    null,
  )
  for (const other of [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    null,
  ])
    assert.equal(
      equipmentSupplierLine({
        equipment_ownership_status: other,
        equipment_lessor_name: 'مؤسسة النخبة',
      }),
      null,
      String(other),
    )
  const line = read('src/components/data-list/EquipmentSupplierLine.tsx')
  assert.match(
    line,
    /const name = equipmentSupplierLine\(row\)\s+if \(!name\) return null/,
  )
  assert.match(line, /className="block text-xs text-muted"/)
})

/** The `key: '...'` values declared between two anchors of a source file. */
function columnKeys(source, from, to) {
  const start = source.indexOf(from)
  assert.ok(start >= 0, from)
  const block = source.slice(start, source.indexOf(to, start))
  return Array.from(block.matchAll(/^\s+key: '([^']+)'/gm), (match) => match[1])
}

test('the line sits inside the equipment cell; no table column is added', () => {
  const logs = read('src/screens/admin-home/LogsScreen.tsx')
  assert.deepEqual(
    columnKeys(
      logs,
      'const contextColumn: DataTableColumn<LogRow>',
      '\n  return (',
    ),
    [
      'movement_context',
      'workshop_purpose',
      'equipment_code',
      'equipment_type',
      'movement_type',
      'company',
      'driver_name',
      'supervisor_name',
      'recorded_at',
    ],
  )
  const logEquipment = logs.slice(
    logs.indexOf("key: 'equipment_code'"),
    logs.indexOf("key: 'equipment_type'"),
  )
  assert.match(logEquipment, /<EquipmentSupplierLine row=\{row\} \/>/)
  // Selected for the line only; nothing renders or exports the id.
  assert.match(logs, /const LIST_SELECT = `[^`]*,equipment_lessor_name`/)
  assert.doesNotMatch(logs, /equipment_lessor_id[^`]*`$/m)

  const visits = read('src/components/visits/VisitsTable.tsx')
  assert.deepEqual(
    columnKeys(
      visits,
      'const columns = useMemo<DataTableColumn<EquipmentVisitRow>[]>',
      '\n  }, [',
    ),
    [
      'equipment_code',
      'is_open',
      'movement_context',
      'workshop_purpose',
      'company_project',
      'driver_name',
      'entry_supervisor_name',
      'entry_at',
      'exit_at',
      'duration_minutes',
    ],
  )
  const visitEquipment = visits.slice(
    visits.indexOf("key: 'equipment_code'"),
    visits.indexOf("key: 'is_open'"),
  )
  assert.match(
    visitEquipment,
    /\{isLog && <EquipmentSupplierLine row=\{visit\} \/>\}/,
  )
  // Only the admin log (and the managers' embedded copy) reads the name.
  assert.match(
    visits,
    /isLog\s*\?\s*EQUIPMENT_VISITS_LOG_SELECT\s*:\s*EQUIPMENT_VISITS_SELECT/,
  )
  const visitsLib = loadModule(src('lib', 'visitsList.ts'), cache)
  assert.equal(
    visitsLib.EQUIPMENT_VISITS_LOG_SELECT,
    `${visitsLib.EQUIPMENT_VISITS_SELECT},equipment_lessor_name`,
  )
  assert.ok(
    !visitsLib.EQUIPMENT_VISITS_SELECT.split(',').includes(
      'equipment_lessor_name',
    ),
  )
})

// --- Translations --------------------------------------------------------------

test('the supplier label and line exist in both languages, Arabic without hamza alif', () => {
  assert.equal(translations.ar.supplierFilter, 'المورد')
  assert.equal(translations.en.supplierFilter, 'Supplier')
  assert.match(translations.ar.equipmentSupplierLine, /\{name\}/)
  assert.match(translations.en.equipmentSupplierLine, /\{name\}/)
  for (const key of ['supplierFilter', 'equipmentSupplierLine'])
    assert.doesNotMatch(translations.ar[key], HAMZA_ALIFS, key)
})
