const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards wave 13 (owner decisions 2026-10-05): the «مورد خارجي» employment
// type (A), its automatic use by Quick Create decided in the database (B), the
// drivers list default filter (C) and the driver required on every site entry
// again (D). The database rule of D ships later as migration 0120, after the
// new UI is live.
const root = path.join(__dirname, '..')
const EXTERNAL = 'مورد خارجي'

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

/** Loads a source module with `@/...` and relative imports resolved; anything
 *  outside `src` is stubbed, because these tests only call pure helpers. */
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
          ? path.join(root, 'src', request.slice(2))
          : request.startsWith('.')
            ? path.join(path.dirname(resolved), request)
            : null
        if (!target || !fileExists(target))
          return new Proxy({}, { get: () => () => null })
        return loadModule(target, cache)
      },
    },
    { filename: resolved },
  )
  return exports
}

function candidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`]
}

function fileExists(file) {
  return candidates(file).some(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
}

function resolveFile(file) {
  for (const candidate of candidates(file))
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}

/** Values built inside the vm context have their own prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value))

function functionBody(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(source)
  assert.ok(match, `missing function: ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return source.slice(match.index, end)
}

function withoutComments(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const MIGRATION = '20261005110000_0119_external_driver_type.sql'
const sql = read('supabase', 'migrations', MIGRATION)
const stripped = withoutComments(sql)
const sql0109 = read(
  'supabase',
  'migrations',
  '20260930150000_0109_photo_and_quick_create_security.sql',
)

const lib = (name) => loadModule(path.join(root, 'src', 'lib', name))
const dataList = (name) =>
  loadModule(path.join(root, 'src', 'components', 'data-list', name))

// --- A: the employment type -------------------------------------------------

test('0119 is ordered after 0118 and is balanced', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at0118 = files.findIndex((file) => file.includes('_0118_'))
  assert.ok(at0118 >= 0 && files.indexOf(MIGRATION) > at0118)
  assert.equal((stripped.match(/\$\$/g) ?? []).length % 2, 0)
  let depth = 0
  for (const char of stripped) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    assert.ok(depth >= 0, 'unbalanced parentheses')
  }
  assert.equal(depth, 0, 'unbalanced parentheses')
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('the database allowlist and the frontend list are the same values', () => {
  const { DRIVER_EMPLOYMENT_TYPES, EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE } =
    lib('driverExcel')
  assert.equal(EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE, EXTERNAL)
  assert.ok(!/[أإآ]/.test(EXTERNAL))
  const check =
    /ADD CONSTRAINT drivers_employment_type_check\s+CHECK \(\s+employment_type IS NULL\s+OR employment_type IN \(([^)]*)\)\s+\)/.exec(
      stripped,
    )
  assert.ok(check, 'the new CHECK constraint is missing')
  const values = [...check[1].matchAll(/'([^']*)'/g)].map((match) => match[1])
  assert.deepEqual(values, plain(DRIVER_EMPLOYMENT_TYPES))
  // The six original values keep their order; one value is appended.
  assert.deepEqual(values.slice(0, 6), [
    'العزاني',
    'تكوين',
    'البناء',
    'البدراني',
    'امدادات العربة',
    'نقدي',
  ])
  assert.equal(values[6], EXTERNAL)
  // The old constraint is found in the catalog instead of by its name.
  assert.match(stripped, /c\.conrelid = 'public\.drivers'::regclass/)
  assert.match(stripped, /c\.contype = 'c'/)
  assert.match(stripped, /a\.attname = 'employment_type'/)
})

// --- B: Quick Create ----------------------------------------------------------

test('quick_create_driver is replaced by ONE function with a defaulted third argument', () => {
  assert.match(
    stripped,
    /DROP FUNCTION IF EXISTS public\.quick_create_driver\(text, text\);/,
  )
  assert.match(
    stripped,
    /CREATE FUNCTION public\.quick_create_driver\(\s+p_full_name text,\s+p_mobile_number text,\s+p_equipment_id uuid DEFAULT NULL\s+\)/,
  )
  // No CREATE OR REPLACE: that would leave the two-argument overload behind.
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.quick_create_driver/.test(sql))
  assert.ok(
    stripped.indexOf('DROP FUNCTION IF EXISTS public.quick_create_driver') <
      stripped.indexOf('CREATE FUNCTION public.quick_create_driver'),
  )
  assert.match(
    stripped,
    /REVOKE ALL ON FUNCTION public\.quick_create_driver\(text, text, uuid\) FROM PUBLIC, anon;/,
  )
  assert.match(
    stripped,
    /GRANT EXECUTE ON FUNCTION public\.quick_create_driver\(text, text, uuid\) TO authenticated;/,
  )
})

test('the body is 0109 verbatim plus the database-side ownership lookup', () => {
  const body = functionBody(sql, 'quick_create_driver')
  assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  // Every statement line of 0109's body is kept, except the INSERT that now
  // also writes the employment type.
  const old = functionBody(sql0109, 'quick_create_driver')
  const kept = old
    .split('\n')
    .slice(old.split('\n').findIndex((line) => line.startsWith('DECLARE')))
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith('INSERT INTO public.drivers') &&
        !line.startsWith('VALUES ('),
    )
  for (const line of kept)
    assert.ok(body.includes(line), `0109 line missing: ${line}`)
  const code = withoutComments(body)
  assert.match(
    code,
    /IF p_equipment_id IS NOT NULL THEN\s+SELECT 'مورد خارجي' INTO v_employment_type\s+FROM public\.equipment e\s+WHERE e\.id = p_equipment_id\s+AND e\.ownership_status = 'external_supplier';\s+END IF;/,
  )
  assert.match(
    code,
    /INSERT INTO public\.drivers\(full_name, mobile_number, employment_type\)\s+VALUES \(btrim\(p_full_name\), btrim\(p_mobile_number\), v_employment_type\)/,
  )
  // An existing driver (same mobile) is returned before the lookup, unchanged.
  assert.ok(
    code.indexOf('IF FOUND THEN RETURN v_driver; END IF;') <
      code.indexOf('FROM public.equipment e'),
  )
  assert.ok(!/UPDATE public\.drivers/.test(code))
})

test('0119 carries no movement rule: the driver requirement ships later', () => {
  assert.ok(!/site_entry_driver_required/.test(stripped))
  assert.ok(!/CREATE TRIGGER/.test(stripped))
  assert.ok(!/entry_exit_logs/.test(stripped))
})

test('the movement form sends the selected equipment to Quick Create', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(
    form,
    /rpc\('quick_create_driver', \{\s+p_full_name: quickDriver\.fullName\.trim\(\),\s+p_mobile_number: quickDriver\.mobile\.trim\(\),[\s\S]*?p_equipment_id: selected\?\.id \?\? null,\s+\}\)/,
  )
  // The client never sends the employment type itself.
  assert.ok(!/p_employment_type/.test(form))
})

// --- C: the drivers list default filter -------------------------------------

test('the drivers list hides the external supplier by default, NULL kept', () => {
  const configs = lib('listConfigs')
  const { driversListConfig } = configs
  const field = driversListConfig.filterFields.find(
    (entry) => entry.key === 'employment_type',
  )
  assert.ok(field.operators.includes('neq'))
  assert.equal(field.negationKeepsEmpty, true)
  assert.ok(field.options.some((option) => option.value === EXTERNAL))
  const defaults = plain(driversListConfig.defaultFilters)
  assert.deepEqual(defaults, [
    {
      id: 'default-employment-type',
      field: 'employment_type',
      operator: 'neq',
      value: EXTERNAL,
    },
  ])
  // The default is shown in the dialog as its own entry, not as "= value".
  const { matchingFilterChoice } = dataList('listFilterState')
  assert.equal(
    matchingFilterChoice(field, defaults[0]).label,
    'driversExceptExternalSupplier',
  )
  assert.equal(
    matchingFilterChoice(field, { operator: 'eq', value: EXTERNAL }),
    null,
  )
  // Only the drivers list has a default.
  for (const config of Object.values(configs))
    if (config !== driversListConfig)
      assert.equal(config.defaultFilters, undefined, config.id)
})

test('URL state: fresh visit, cleared, and a list without defaults', () => {
  const { listFiltersFromParam, listFiltersParam } = dataList('listFilterState')
  const { driversListConfig } = lib('listConfigs')
  assert.equal(listFiltersFromParam(null, driversListConfig)[0].value, EXTERNAL)
  assert.deepEqual(plain(listFiltersFromParam('[]', driversListConfig)), [])
  assert.deepEqual(plain(listFiltersFromParam('{bad', driversListConfig)), [])
  assert.equal(listFiltersParam([], driversListConfig), '[]')
  const noDefaults = { filterFields: driversListConfig.filterFields }
  assert.deepEqual(plain(listFiltersFromParam(null, noDefaults)), [])
  assert.equal(listFiltersParam([], noDefaults), null)
  // The allowlist still applies to a restored URL.
  const restored = listFiltersFromParam(
    JSON.stringify([
      { id: 'a', field: 'employment_type', operator: 'neq', value: 'x' },
      { id: 'b', field: 'secret_column', operator: 'eq', value: 'x' },
      { id: 'c', field: 'employment_type', operator: 'between', value: 'x' },
    ]),
    driversListConfig,
  )
  assert.deepEqual(
    plain(restored).map((filter) => filter.id),
    ['a'],
  )
})

function recorder() {
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
  return { query, calls }
}

test('"all except" keeps drivers whose employment type is empty', () => {
  const { applyListFilters } = lib('applyListFilters')
  const allowed = new Set(['employment_type'])
  const neq = {
    id: 'x',
    field: 'employment_type',
    operator: 'neq',
    value: EXTERNAL,
  }
  const keep = recorder()
  applyListFilters(keep.query, [neq], allowed, new Set(['employment_type']))
  assert.deepEqual(plain(keep.calls), [
    ['or', `employment_type.is.null,employment_type.neq."${EXTERNAL}"`],
  ])
  const notIn = recorder()
  applyListFilters(
    notIn.query,
    [{ ...neq, operator: 'not_in', value: `${EXTERNAL},نقدي` }],
    allowed,
    new Set(['employment_type']),
  )
  assert.deepEqual(plain(notIn.calls), [
    [
      'or',
      `employment_type.is.null,employment_type.not.in.("${EXTERNAL}","نقدي")`,
    ],
  ])
  // Other fields and other lists keep PostgREST's plain operators.
  const strict = recorder()
  applyListFilters(strict.query, [neq], allowed)
  assert.deepEqual(plain(strict.calls), [['neq', 'employment_type', EXTERNAL]])
  // The drivers screen passes the flagged fields.
  const screen = read('src', 'screens', 'drivers', 'DriversListScreen.tsx')
  assert.match(screen, /\.filter\(\(field\) => field\.negationKeepsEmpty\)/)
  assert.match(screen, /KEEP_EMPTY_ON_NEGATION,\s+\)/)
})

test('driver selectors never apply the list default', () => {
  for (const file of [
    ['src', 'components', 'movement', 'useMovementFormOptions.ts'],
    ['src', 'screens', 'MovementDetail.tsx'],
    ['src', 'screens', 'MovementImport.tsx'],
  ])
    assert.ok(
      !/employment_type|driversListConfig/.test(read(...file)),
      file.join('/'),
    )
})

// --- D: driver required on every site entry ---------------------------------

test('the form requires a driver on a site entry and focuses it in order', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(
    form,
    /driver: siteEntry && !driverId \? 'driverRequired' : undefined,/,
  )
  assert.match(
    form,
    /<Field\s+label=\{t\('driverName'\)\}\s+name="driver"\s+required\s+error=\{movementErrors\.driver && t\(movementErrors\.driver\)\}/,
  )
  assert.match(form, /'company',\s+'project',\s+'driver',\s+'exit_purpose',/)
  // Workshop movements never show the driver field.
  assert.equal((form.match(/name="driver"/g) ?? []).length, 1)
  assert.match(
    form,
    /\{!workshopMode && isEntry && \(\s+<Field\s+label=\{t\('driverName'\)\}/,
  )
  assert.ok(!/optional on a site ENTRY/.test(form))
})

test('the API refuses a site entry without a driver before inserting', () => {
  const route = read('app', 'api', 'movements', 'route.ts')
  assert.match(
    route,
    /const isSiteEntry = movementType === 'entry' && movementContext === 'site'\s+if \(isSiteEntry && !value\('driver_id'\)\) \{\s+return NextResponse\.json\(\s+\{ error: 'site_entry_driver_required' \},\s+\{ status: 400 \},/,
  )
  assert.ok(
    route.indexOf("'site_entry_driver_required'") <
      route.indexOf(".from('entry_exit_logs')"),
  )
})

test('the database code maps to 400 and to the driver message', () => {
  const { movementErrorCode, movementErrorStatus, MOVEMENT_ERROR_CODES } =
    lib('movementErrors')
  const { movementSaveErrorKey } = lib('movementSaveErrors')
  assert.ok(MOVEMENT_ERROR_CODES.includes('site_entry_driver_required'))
  assert.equal(
    movementErrorCode(
      'site_entry_driver_required\nHINT: Select the driver of the site entry.',
    ),
    'site_entry_driver_required',
  )
  assert.equal(movementErrorStatus('site_entry_driver_required'), 400)
  assert.equal(
    movementSaveErrorKey('site_entry_driver_required', true),
    'driverRequired',
  )
  // Older codes are unchanged.
  assert.equal(movementErrorCode('invalid driver_id'), 'driver_required')
  assert.equal(movementErrorStatus('driver_required'), 409)
})

test('the admin correction cannot clear the driver of a site entry', () => {
  const { movementEditKeepsDriver, validateMovementEdit } = lib('movementAdmin')
  const keeps = (movementType, movementContext, currentDriverId) =>
    movementEditKeepsDriver({ movementType, movementContext, currentDriverId })
  assert.equal(keeps('entry', 'site', 'd1'), true)
  assert.equal(keeps('entry', undefined, 'd1'), true)
  // A legacy driverless entry is not forced to get one; exits and workshop
  // rows are not concerned.
  assert.equal(keeps('entry', 'site', null), false)
  assert.equal(keeps('exit', 'site', 'd1'), false)
  assert.equal(keeps('entry', 'workshop', 'd1'), false)
  const values = {
    equipment_id: 'e',
    supervisor_id: 's',
    movement_date: '2026-10-01',
    company_id: 'c',
    project_id: 'p',
    contractor_code: '',
    driver_id: '',
    notes: '',
  }
  const now = new Date('2026-10-05T12:00:00Z')
  assert.equal(
    validateMovementEdit(values, 'site', now, true).driver_id,
    'movementEditDriverRequired',
  )
  assert.equal(validateMovementEdit(values, 'site', now).driver_id, undefined)
  assert.equal(
    validateMovementEdit({ ...values, driver_id: 'd2' }, 'site', now, true)
      .driver_id,
    undefined,
  )
  const dialog = read('src', 'components', 'movement', 'MovementEditDialog.tsx')
  assert.match(
    dialog,
    /const unchanged = movementEditUnchanged\(values, initial\) && !driverCleared/,
  )
  assert.match(
    dialog,
    /validateMovementEdit\(values, context, undefined, keepDriver\)/,
  )
  assert.match(dialog, /name="driver_id"\s+required=\{keepDriver\}/)
})

// --- Translations -------------------------------------------------------------

test('the wave-13 strings exist in both languages and follow the Arabic rule', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-13-drivers — start[\s\S]*?\/\/ wave-13-drivers — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  for (const block of blocks)
    for (const key of [
      'driversExceptExternalSupplier',
      'movementEditDriverRequired',
    ])
      assert.match(block, new RegExp(`\\b${key}:`))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic, 'the Arabic block is missing')
  assert.match(arabic, /driversExceptExternalSupplier: 'الكل عدا مورد خارجي'/)
  assert.ok(!/[أإآ]/.test(arabic))
})
