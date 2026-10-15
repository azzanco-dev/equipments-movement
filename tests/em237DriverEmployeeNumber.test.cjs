// EM-237 (migration 0131): «الرقم الوظيفي» (employee number) of a driver.
// Owner request 2026-10-14: one optional, trimmed, unique text field on the
// driver master record, in the form, the detail, the drivers list (column,
// server-side search, filter and sort) and the drivers Excel import.
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
const MIGRATION = '20261015110000_0131_driver_employee_number.sql'
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const HAMZA_ALIF = /[أإآ]/

/** Loads a source module; `@/...` and relative imports resolve to the real
 *  files, zod is the real package, anything else (xlsx...) is stubbed. */
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
const validation = lib('formValidation')
const driverForm = lib('driverForm')
const driverExcel = lib('driverExcel')
const { driversListConfig } = lib('listConfigs')

/** The SQL without `--` comments, so assertions read only statements. */
const STATEMENTS = SQL.replace(/--[^\n]*/g, '')

// --- Migration ---------------------------------------------------------------

test('0131 adds the optional column with a trimmed-length CHECK', () => {
  assert.match(
    STATEMENTS,
    /ALTER TABLE public\.drivers\s+ADD COLUMN IF NOT EXISTS employee_number text;/,
  )
  // Optional: no NOT NULL, no default.
  assert.ok(!/employee_number text\s+NOT NULL/i.test(STATEMENTS))
  assert.ok(!/employee_number text\s+DEFAULT/i.test(STATEMENTS))
  assert.match(
    STATEMENTS,
    /ADD CONSTRAINT drivers_employee_number_check\s+CHECK \(\s*employee_number IS NULL\s+OR char_length\(btrim\(employee_number\)\) BETWEEN 1 AND 30\s*\);/,
  )
  // The form and the import use the same maximum.
  assert.equal(lib('driverEmployeeNumber').DRIVER_EMPLOYEE_NUMBER_MAX, 30)
})

test('0131 keeps the employee number unique as upper(btrim(..)), NULLs free', () => {
  assert.match(
    STATEMENTS,
    /CREATE UNIQUE INDEX IF NOT EXISTS drivers_employee_number_unique\s+ON public\.drivers \(upper\(btrim\(employee_number\)\)\)\s+WHERE employee_number IS NOT NULL;/,
  )
  // A trigram index serves the list's `ilike '%term%'` search.
  assert.match(
    STATEMENTS,
    /CREATE INDEX IF NOT EXISTS drivers_employee_number_trgm_idx\s+ON public\.drivers USING gin \(employee_number extensions\.gin_trgm_ops\);/,
  )
})

test('0131 normalises on write: trimmed, blank stored as NULL', () => {
  const fn =
    /CREATE OR REPLACE FUNCTION public\.normalise_driver_employee_number\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SET search_path = public, pg_temp\s+AS \$\$([\s\S]*?)\$\$;/.exec(
      STATEMENTS,
    )
  assert.ok(fn, 'the trigger function exists with a fixed search_path')
  assert.match(
    fn[1],
    /NEW\.employee_number := nullif\(btrim\(NEW\.employee_number\), ''\);\s+RETURN NEW;/,
  )
  // It writes nothing but the new column, and is not SECURITY DEFINER.
  assert.equal((fn[1].match(/NEW\.\w+ :=/g) ?? []).length, 1)
  assert.ok(!/SECURITY DEFINER/i.test(STATEMENTS))
  // A trigger function is never callable directly.
  assert.match(
    STATEMENTS,
    /REVOKE ALL ON FUNCTION public\.normalise_driver_employee_number\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.ok(!/\bGRANT\b/i.test(STATEMENTS), 'no grant is added')
  assert.match(
    STATEMENTS,
    /DROP TRIGGER IF EXISTS normalise_driver_employee_number ON public\.drivers;\s+CREATE TRIGGER normalise_driver_employee_number\s+BEFORE INSERT OR UPDATE ON public\.drivers\s+FOR EACH ROW EXECUTE FUNCTION public\.normalise_driver_employee_number\(\);/,
  )
})

test('0131 rewrites no existing function, policy or view', () => {
  const functions = [
    ...STATEMENTS.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)/gi),
  ].map((match) => match[1])
  assert.deepEqual(functions, ['public.normalise_driver_employee_number'])
  assert.ok(!/\b(CREATE|ALTER|DROP) POLICY\b/i.test(STATEMENTS))
  assert.ok(!/\bCREATE (OR REPLACE )?VIEW\b/i.test(STATEMENTS))
  // The new trigger name is not used by an earlier migration.
  for (const file of fs.readdirSync(MIGRATIONS))
    if (file !== MIGRATION)
      assert.ok(
        !fs
          .readFileSync(path.join(MIGRATIONS, file), 'utf8')
          .includes('employee_number'),
        `${file} does not know employee_number`,
      )
  // quick_create_driver (latest 0119) inserts named columns and returns the
  // row type, so the new nullable column needs no rewrite there.
  const quick = fs.readFileSync(
    path.join(MIGRATIONS, '20261005110000_0119_external_driver_type.sql'),
    'utf8',
  )
  assert.match(
    quick,
    /INSERT INTO public\.drivers\(full_name, mobile_number, employment_type\)/,
  )
})

test('0131 header: owner decision, rollout, Arabic without hamza alif', () => {
  assert.match(SQL, /Owner request 2026-10-14/)
  assert.match(SQL, /«الرقم الوظيفي»/)
  assert.match(SQL, /Rollout: apply BEFORE deploying the UI/)
  assert.ok(!HAMZA_ALIF.test(SQL))
})

// --- Form: Zod schema, payload, database errors ------------------------------

test('the driver schema keeps the employee number optional and lenient', () => {
  const base = { ...driverForm.EMPTY_DRIVER_FORM, full_name: 'محمد علي' }
  const check = (employee_number) =>
    plain(driverForm.validateDriverForm({ ...base, employee_number }))
  assert.deepEqual(check(''), {})
  assert.deepEqual(check('   '), {})
  assert.deepEqual(check('E-1001'), {})
  assert.deepEqual(check('موظف/12 ب'), {})
  assert.deepEqual(check('x'.repeat(30)), {})
  // Measured once trimmed, like the CHECK.
  assert.deepEqual(check(`  ${'x'.repeat(30)}  `), {})
  assert.deepEqual(check('x'.repeat(31)), {
    employee_number: 'driverEmployeeNumberTooLong',
  })
  // The field sits in the visual order used to focus the first error.
  const order = [...driverForm.DRIVER_FIELD_ORDER]
  assert.ok(order.indexOf('employee_number') > order.indexOf('employment_type'))
  assert.ok(order.indexOf('employee_number') < order.indexOf('job_title'))
})

test('the payload trims the employee number and sends a blank as null', () => {
  const payload = (employee_number) =>
    driverForm.buildDriverPayload({
      ...driverForm.EMPTY_DRIVER_FORM,
      full_name: 'احمد',
      employee_number,
    }).employee_number
  assert.equal(payload(' E-7 '), 'E-7')
  assert.equal(payload(''), null)
  assert.equal(payload('  '), null)
  assert.equal(
    driverForm.driverFormValues({
      id: 'd',
      full_name: 'احمد',
      name_en: null,
      id_number: null,
      mobile_number: null,
      nationality: null,
      employment_type: null,
      job_title: null,
      employee_number: null,
      created_at: '',
      updated_at: '',
    }).employee_number,
    '',
  )
})

test('database rejections of the employee number land on its field', () => {
  const map = (error) =>
    plain(
      validation.mapDatabaseErrorToField(
        error,
        driverForm.DRIVER_DATABASE_RULES,
      ),
    )
  assert.deepEqual(
    map({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "drivers_employee_number_unique"',
      details: 'Key (upper(btrim(employee_number)))=(E-1001) already exists.',
    }),
    { employee_number: 'driverEmployeeNumberExists' },
  )
  assert.deepEqual(
    map({
      code: '23514',
      message:
        'new row for relation "drivers" violates check constraint "drivers_employee_number_check"',
    }),
    { employee_number: 'driverEmployeeNumberTooLong' },
  )
  // The other unique indexes keep their own fields.
  assert.deepEqual(
    map({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "drivers_mobile_number_unique"',
      details: 'Key (mobile_number)=(0500000000) already exists.',
    }),
    { mobile_number: 'mobileExists' },
  )
})

test('the form dialog renders the field with its error and the saved value', () => {
  const dialog = read('src/screens/drivers/DriverFormDialog.tsx')
  assert.match(
    dialog,
    /label=\{t\('driverEmployeeNumber'\)\}\s+name="employee_number"\s+error=\{errors\.employee_number && t\(errors\.employee_number\)\}/,
  )
  assert.match(dialog, /update\(\{ employee_number: event\.target\.value \}\)/)
  // Quick Create does not know the field.
  assert.ok(!read('src/components/EntryExitForm.tsx').includes('employee'))
})

// --- Excel import ------------------------------------------------------------

test('the import reads the column by key or Arabic header, trimmed', () => {
  const rows = plain(
    driverExcel.parseDriverRows([
      { full_name: 'علي', employee_number: '  E-1 ' },
      { full_name: 'سالم', 'الرقم الوظيفي': 'E-2' },
      { full_name: 'خالد', employee_number: '' },
      { full_name: 'ماجد' },
      { full_name: 'فهد', employee_number: 'x'.repeat(31) },
    ]),
  )
  assert.deepEqual(
    rows.map((row) => row.employee_number),
    ['E-1', 'E-2', null, null, 'x'.repeat(31)],
  )
  assert.deepEqual(rows[0].errors, [])
  assert.deepEqual(rows[4].errors, [
    driverExcel.DRIVER_EMPLOYEE_NUMBER_IMPORT_ERROR,
  ])
  assert.ok(rows.every((row) => row.duplicateEmployeeNumber === false))
})

test('the Excel helpers stay free of zod (listConfigs loads them)', () => {
  const source = read('src/lib/driverExcel.ts')
  assert.ok(!/from '@\/lib\/formValidation'/.test(source))
  assert.ok(!/from 'zod'/.test(source))
  assert.ok(!/^import/m.test(read('src/lib/driverEmployeeNumber.ts')))
})

test('a repeated employee number in the file is its own duplicate note', () => {
  const rows = plain(
    driverExcel.parseDriverRows([
      { full_name: 'علي', employee_number: 'e-1', mobile_number: '0500000001' },
      {
        full_name: 'سالم',
        employee_number: ' E-1 ',
        mobile_number: '0500000002',
      },
      {
        full_name: 'خالد',
        employee_number: 'E-2',
        mobile_number: '0500000001',
      },
    ]),
  )
  assert.deepEqual(
    rows.map((row) => [row.duplicateEmployeeNumber, row.duplicate]),
    [
      [false, false],
      [true, false],
      [false, true],
    ],
  )
  assert.equal(driverExcel.normalizeEmployeeNumber(' e-1 '), 'E-1')
})

test('the stored-duplicate lookup compares case-insensitively and safely', () => {
  const filter = driverExcel.employeeNumberLookupFilter
  assert.equal(filter([]), null)
  assert.equal(filter(['  ', '']), null)
  assert.equal(
    filter(['E-1', ' E-1 ', 'A2']),
    'employee_number.ilike.E-1,employee_number.ilike.A2',
  )
  // Characters ILIKE or PostgREST would read as syntax fall back to eq.
  assert.equal(filter(['E_1%']), 'employee_number.eq."E_1%"')
  assert.equal(filter(['a,b']), 'employee_number.eq."a,b"')
  assert.equal(filter(['a"b']), 'employee_number.eq."a\\"b"')
})

test('the import component previews, notes and inserts the employee number', () => {
  const component = read('src/components/DriverExcelImport.tsx')
  assert.match(
    component,
    /row\.errors\.length === 0 && !row\.duplicate && !row\.duplicateEmployeeNumber/,
  )
  assert.match(
    component,
    /if \(row\.duplicateEmployeeNumber\) return t\('driverEmployeeNumberDuplicate'\)/,
  )
  assert.match(component, /employee_number: row\.employee_number,/)
  assert.match(
    component,
    /\.select\('employee_number'\)\s+\.or\(employeeFilter\)/,
  )
  // A failed duplicate check stops the preview.
  assert.match(
    component,
    /idResult\.error \|\| mobileResult\.error \|\| employeeResult\.error/,
  )
})

// --- Drivers list and detail -------------------------------------------------

test('the drivers list searches, filters and sorts the employee number', () => {
  assert.ok(driversListConfig.searchFields.includes('employee_number'))
  const filter = driversListConfig.filterFields.find(
    (field) => field.key === 'employee_number',
  )
  assert.ok(filter, 'allowlisted filter')
  assert.equal(filter.type, 'text')
  assert.ok(
    driversListConfig.sortableFields.some(
      (field) => field.key === 'employee_number',
    ),
  )
  assert.ok(!HAMZA_ALIF.test(driversListConfig.searchPlaceholder.ar))
  // The driver selectors keep their shared search fields.
  assert.ok(!read('src/lib/driverOptions.ts').includes('employee_number'))
  const screen = read('src/screens/drivers/DriversListScreen.tsx')
  assert.match(screen, /const LIST_SELECT =\s+'[^']*,employee_number,[^']*'/)
  const table = read('src/screens/drivers/DriversTable.tsx')
  assert.match(
    table,
    /key: 'employee_number',\s+header: t\('driverEmployeeNumber'\),\s+sortable: true,/,
  )
})

test('the driver detail loads and shows the employee number', () => {
  assert.match(
    read('src/screens/drivers/useDriverDetail.ts'),
    /'id,[^']*,employee_number,[^']*'/,
  )
  assert.match(
    read('src/screens/drivers/DriverDetailDialog.tsx'),
    /label: t\('driverEmployeeNumber'\),\s+value: driver\.employee_number,/,
  )
})

// --- Translations ------------------------------------------------------------

test('the translation keys exist in both languages, Arabic without hamza alif', () => {
  const source = read('src/i18n/translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ wave-24-driver-employee-number — start\n([\s\S]*?)\/\/ wave-24-driver-employee-number — end/g,
    ),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2, 'one block per language')
  const keys = [
    'driverEmployeeNumber',
    'driverEmployeeNumberPlaceholder',
    'driverEmployeeNumberTooLong',
    'driverEmployeeNumberExists',
    'driverEmployeeNumberDuplicate',
  ]
  for (const block of blocks)
    for (const key of keys)
      assert.match(block, new RegExp(`\\b${key}:`), `${key} in every language`)
  assert.match(blocks[0], /driverEmployeeNumber: 'الرقم الوظيفي'/)
  assert.ok(!HAMZA_ALIF.test(blocks[0]))
  // Each block follows the wave-23-users block of its language.
  assert.equal(
    (
      source.match(
        /\/\/ wave-23-users — end\n\s+\/\/ wave-24-driver-employee-number — start/g,
      ) ?? []
    ).length,
    2,
  )
})
