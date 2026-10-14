// EM-236 (migration 0129): «جديدة» means "created within the last 7 days",
// not "never moved"; the manual master_data_complete flag leaves the UI.
// EM-235: the equipment list's owner filter is a multi-select.
// Pure and regex checks only, like the rest of the suite: no database is
// reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261014100000_0129_new_badge_by_created_at.sql'
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')
const PREVIOUS = migration('0125')

/** Loads a source module; `@/...` and relative imports resolve to the real
 *  files, zod is the real package, anything else is stubbed. */
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
      Date,
      Math,
      Number,
      String,
      Object,
      Array,
      JSON,
      Set,
      Map,
      parseInt,
      React: { createElement: () => null },
      require(request) {
        if (request.startsWith('@/'))
          return loadModule(path.join(ROOT, 'src', request.slice(2)), cache)
        if (request.startsWith('.'))
          return loadModule(path.join(path.dirname(resolved), request), cache)
        if (request === 'zod') return require('zod')
        return new Proxy({}, { get: () => () => null, apply: () => null })
      },
    },
    { filename: resolved },
  )
  return exports
}

function resolveFile(file) {
  for (const candidate of [file, `${file}.ts`, `${file}.tsx`])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}

const cache = new Map()
const lib = (name) => loadModule(path.join(ROOT, 'src', 'lib', name), cache)
const state = lib('equipmentState')
const form = lib('equipmentForm')
const configs = lib('listConfigs')
const { translations } = loadModule(
  path.join(ROOT, 'src', 'i18n', 'translations.ts'),
  cache,
)
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- Migration helpers ---------------------------------------------------------

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

/** The `admin_equipment_state` definition up to its lateral join. */
function viewBlock(sql) {
  const start = sql.indexOf(
    'CREATE OR REPLACE VIEW public.admin_equipment_state',
  )
  assert.ok(start >= 0, 'admin_equipment_state')
  const end = sql.indexOf(') m ON true;', start) + ') m ON true;'.length
  return sql.slice(start, end)
}

/** Replaces exactly `count` occurrences, failing when the anchor differs. */
function replaceAll(text, from, to, count = 1) {
  assert.equal(text.split(from).length - 1, count, `anchor x${count}: ${from}`)
  return text.split(from).join(to)
}

const NEW_RULE = 'created_at >= now() - public.equipment_new_window()'

// --- The migration file --------------------------------------------------------

test('0129 is a new migration ordered after 0128', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0129_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0128_/.test(file)),
  )
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  const sql = code(SQL)
  assert.ok(!/CREATE (UNIQUE )?INDEX/.test(sql))
  assert.ok(!/DROP (COLUMN|TABLE|FUNCTION|VIEW)/i.test(sql))
  assert.ok(!/SECURITY DEFINER/.test(sql))
  // The flag is retired from the UI only: the database does not touch it.
  assert.ok(!/master_data_complete/.test(sql))
  // Arabic in comments: plain alif only.
  assert.ok(!/[أإآ]/.test(SQL))
})

test('the 7-day window is defined once, as an IMMUTABLE SQL function', () => {
  const block = functionBlock(SQL, 'equipment_new_window')
  assert.match(
    block,
    /RETURNS interval\s+LANGUAGE sql\s+IMMUTABLE\s+SET search_path = public, pg_temp/,
  )
  assert.match(block, /SELECT interval '7 days'/)
  const sql = code(SQL)
  // The number lives in exactly one place of the SQL.
  assert.equal(sql.match(/'7 days'/g).length, 1)
  assert.equal(sql.match(/interval '/g).length, 1)
  // Both consumers call the function instead of repeating the interval:
  // its CREATE, REVOKE, GRANT and COMMENT, then one call in equipment_is_new
  // and one in the view.
  assert.equal(sql.match(/public\.equipment_new_window\(\)/g).length, 6)
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.equipment_new_window\(\) FROM PUBLIC, anon;/,
  )
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.equipment_new_window\(\) TO authenticated;/,
  )
  // Defined before anything calls it.
  assert.ok(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.equipment_new_window(') <
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.equipment_is_new('),
  )
  // The UI mirror carries the same number.
  assert.equal(state.EQUIPMENT_NEW_DAYS, 7)
})

test('equipment_is_new is 0125 verbatim except the body, grants restated', () => {
  const before = code(functionBlock(PREVIOUS, 'equipment_is_new'))
  const after = code(functionBlock(SQL, 'equipment_is_new'))
  const expected = replaceAll(
    before,
    '  SELECT NOT EXISTS (\n' +
      '    SELECT 1\n' +
      '    FROM public.entry_exit_logs l\n' +
      '    WHERE l.equipment_id = p_equipment.id\n' +
      '  )\n',
    `  SELECT p_equipment.${NEW_RULE}\n`,
  )
  assert.equal(after, expected)
  assert.match(
    after,
    /LANGUAGE sql\s+STABLE\s+SECURITY INVOKER\s+SET search_path = public, pg_temp/,
  )
  // No movement table is read any more.
  assert.ok(!/entry_exit_logs/.test(after))
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.equipment_is_new\(public\.equipment\)\s+FROM PUBLIC, anon;/,
  )
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.equipment_is_new\(public\.equipment\)\s+TO authenticated;/,
  )
})

test('the state view is 0125 verbatim except the is_new expression', () => {
  const before = code(viewBlock(PREVIOUS))
  const after = code(viewBlock(SQL))
  const expected = replaceAll(
    before,
    '  (m.id IS NULL) AS is_new\nFROM',
    `  (e.${NEW_RULE}) AS is_new\nFROM`,
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The state mapping is untouched: "no movement" still reads available.
  assert.match(after, /WHEN m\.id IS NULL THEN 'available'/)
  assert.match(
    SQL,
    /REVOKE ALL ON public\.admin_equipment_state FROM PUBLIC, anon;/,
  )
  assert.match(
    SQL,
    /GRANT SELECT ON public\.admin_equipment_state TO authenticated;/,
  )
  // The window function is created before the view that calls it.
  assert.ok(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.equipment_new_window(') <
      SQL.indexOf('CREATE OR REPLACE VIEW public.admin_equipment_state'),
  )
})

test('nothing else is recreated: the fleet RPC reads is_new from the view', () => {
  for (const name of [
    'equipment_state_from_movement',
    'equipment_state',
    'get_admin_fleet_equipment',
    'get_admin_fleet_state',
    'get_workshop_home_stats',
  ])
    assert.ok(
      !new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`).test(
        SQL,
      ),
      `${name} is not recreated`,
    )
  // The latest fleet RPC (0127) returns the view's column unchanged, so it
  // follows the new rule by itself.
  const fleet = code(
    functionBlock(migration('0127'), 'get_admin_fleet_equipment'),
  )
  assert.match(fleet, /s\.is_new\n  FROM public\.admin_equipment_state s/)
  // 0129 is the only migration after 0125 that defines is_new.
  const number = (file) => Number((file.match(/_(\d{4})_/) ?? [])[1])
  const later = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => number(file) > 125 && file !== MIGRATION)
  assert.ok(later.length >= 3, 'the migrations after 0125 are read')
  for (const file of later) {
    const text = code(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    assert.ok(!/AS is_new\b/.test(text), `${file} does not define is_new`)
  }
})

// --- The UI mirror ------------------------------------------------------------

test('isEquipmentNew mirrors the 7-day rule and ignores a missing date', () => {
  const now = Date.parse('2026-10-14T09:00:00Z')
  const daysAgo = (days) => new Date(now - days * 86400000).toISOString()
  assert.equal(state.isEquipmentNew(daysAgo(0), now), true)
  assert.equal(state.isEquipmentNew(daysAgo(6.9), now), true)
  assert.equal(state.isEquipmentNew(daysAgo(7), now), true)
  assert.equal(state.isEquipmentNew(daysAgo(7.01), now), false)
  assert.equal(state.isEquipmentNew(daysAgo(30), now), false)
  assert.equal(state.isEquipmentNew(null, now), false)
  assert.equal(state.isEquipmentNew(undefined, now), false)
  assert.equal(state.isEquipmentNew('not a date', now), false)
  // The state line still appends the mark only to an available unit.
  const t = (key) => translations.ar[key]
  assert.equal(state.equipmentStateText(t, 'available', true), 'متاحة · جديدة')
  // "No movement" is no longer "new" anywhere in the mirror.
  const source = read('src/lib/equipmentState.ts')
  assert.ok(!/latest === null/.test(source))
})

test('the inquiry derives the mark from created_at, not from the chain', () => {
  const source = read('src/screens/inquiry/EquipmentInquiryScreen.tsx')
  assert.match(
    source,
    /\.select\('id,code,type,plate_number,chassis_number,created_at'\)/,
  )
  assert.match(source, /isNew: isEquipmentNew\(row\?\.created_at\)/)
  assert.ok(!/isNew: latest === null/.test(source))
})

// --- The equipment list ---------------------------------------------------------

test('the list filters «جديدة» server-side on the computed boolean', () => {
  const list = configs.equipmentListConfig
  const field = list.filterFields.find(
    (item) => item.key === 'equipment_is_new',
  )
  assert.ok(field)
  assert.equal(field.label, 'equipmentStateNew')
  assert.deepEqual(plain(field.operators), ['eq'])
  assert.deepEqual(plain(field.options), [
    { value: 'true', label: 'نعم', labelI18n: 'yes' },
    { value: 'false', label: 'لا', labelI18n: 'no' },
  ])
  assert.notEqual(field.multiple, true)
  // No defaults: a fresh visit shows every unit.
  assert.equal(list.defaultFilters, undefined)
  // The retired flag has no filter and is not selected any more.
  assert.equal(
    list.filterFields.find((item) => item.key === 'master_data_complete'),
    undefined,
  )
  assert.ok(
    !/master_data_complete/.test(
      read('src/screens/equipment/EquipmentListScreen.tsx'),
    ),
  )
  assert.match(
    read('src/screens/equipment/EquipmentListScreen.tsx'),
    /equipment_is_new/,
  )
})

test('the «جديدة» filter reaches PostgREST as equipment_is_new=eq.true', () => {
  const { applyListFilters } = lib('applyListFilters')
  const calls = []
  const query = new Proxy(
    {},
    {
      get:
        (_, method) =>
        (...args) => {
          calls.push([method, ...args])
          return query
        },
    },
  )
  applyListFilters(
    query,
    [{ id: '1', field: 'equipment_is_new', operator: 'eq', value: 'true' }],
    new Set(configs.equipmentListConfig.filterFields.map((f) => f.key)),
  )
  assert.deepEqual(plain(calls), [['eq', 'equipment_is_new', 'true']])
})

test('the owner filter is a multi-select over `in` with the same five owners', () => {
  const list = configs.equipmentListConfig
  const field = list.filterFields.find(
    (item) => item.key === 'ownership_status',
  )
  assert.ok(field)
  assert.equal(field.multiple, true)
  assert.ok(field.operators.includes('in'))
  assert.deepEqual(plain(field.options.map((option) => option.value)), [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier',
  ])
  assert.deepEqual(plain(field.options.map((option) => option.labelI18n)), [
    'ownershipAlazani',
    'ownershipTakween',
    'ownershipThirdPartyF',
    'ownershipThirdPartyPartnershipB',
    'ownershipExternalSupplier',
  ])
  // Like the drivers' employment type: the bar renders `MultiSelect` for a
  // `multiple` field and picks `in` for it (FilterBar.tsx imports the UI
  // barrel, so its rule is checked at the source).
  const drivers = configs.driversListConfig.filterFields.find(
    (item) => item.key === 'employment_type',
  )
  assert.equal(drivers.multiple, true)
  assert.ok(drivers.operators.includes('in'))
  const bar = read('src/components/data-list/FilterBar.tsx')
  assert.match(
    bar,
    /if \(field\.multiple\) return pickOperator\(field, \['in', 'eq'\]\)/,
  )
  assert.match(bar, /if \(field\.multiple\)\s+return \(\s+<MultiSelect/)
  // Two owners ticked → one `in` call with both values.
  const { applyListFilters } = lib('applyListFilters')
  const calls = []
  const query = new Proxy(
    {},
    {
      get:
        (_, method) =>
        (...args) => {
          calls.push([method, ...args])
          return query
        },
    },
  )
  applyListFilters(
    query,
    [
      {
        id: '1',
        field: 'ownership_status',
        operator: 'in',
        value: 'alazani,takween',
      },
    ],
    new Set(list.filterFields.map((f) => f.key)),
  )
  // `plain`: the arrays come from the module's vm realm.
  assert.deepEqual(plain(calls), [
    ['in', 'ownership_status', ['alazani', 'takween']],
  ])
})

// --- The retired flag -----------------------------------------------------------

test('master_data_complete and its badge left the screens and the form', () => {
  assert.equal(form.masterDataBadge, undefined)
  const payload = plain(
    form.buildEquipmentPayload({
      ...plain(form.EMPTY_EQUIPMENT_FORM),
      code: 'A1',
      type: 'حفار',
      qr_value: 'EQ-1',
    }),
  )
  assert.ok(!('master_data_complete' in payload))
  for (const file of [
    'src/screens/equipment/EquipmentTable.tsx',
    'src/screens/EquipmentDetail.tsx',
    'src/lib/equipmentForm.ts',
    'src/lib/types.ts',
  ])
    assert.ok(
      !/master_data_complete|masterDataBadge|incompleteData/.test(read(file)),
      file,
    )
  // The translation key is gone from both languages and nothing uses it.
  assert.equal(translations.ar.incompleteData, undefined)
  assert.equal(translations.en.incompleteData, undefined)
  assert.ok(!/incompleteData/.test(read('src/i18n/translations.ts')))
  // The keys the new filter reuses exist in both languages.
  for (const key of ['equipmentStateNew', 'yes', 'no']) {
    assert.ok(translations.ar[key], `ar ${key}`)
    assert.ok(translations.en[key], `en ${key}`)
  }
})
