const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

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
          ? path.join(ROOT, 'src', request.slice(2))
          : request.startsWith('.')
            ? path.join(path.dirname(resolved), request)
            : null
        // A barrel (`@/components/ui`) or an outside package is stubbed: the
        // helpers under test never touch the components themselves.
        if (!target || !fileExists(target)) return stub()
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

function stub() {
  return new Proxy({}, { get: () => () => null })
}

const {
  filterBarOperator,
  dateRangeFilter,
  dateRangeKeys,
  countActiveFilters,
  splitFilterValues,
  inferDatePreset,
} = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'FilterBar.tsx'),
)
const configs = loadModule(path.join(ROOT, 'src', 'lib', 'listConfigs.ts'))

test('the bar only ever uses an operator the field allows', () => {
  // The allowlist is what keeps an arbitrary comparison out of PostgREST.
  for (const config of Object.values(configs))
    for (const field of config.filterFields) {
      const operator = filterBarOperator(field)
      assert.ok(
        field.operators.includes(operator),
        `${config.id}.${field.key}: ${operator} is not allowlisted`,
      )
    }
})

test('each field type maps to the comparison a user expects', () => {
  const date = {
    key: 'recorded_at',
    label: 'x',
    type: 'date',
    operators: ['eq', 'gt', 'between'],
  }
  const text = {
    key: 'name',
    label: 'x',
    type: 'text',
    operators: ['eq', 'like'],
  }
  const choice = {
    key: 'role',
    label: 'x',
    type: 'select',
    operators: ['eq', 'in'],
  }
  assert.equal(filterBarOperator(date), 'between')
  assert.equal(filterBarOperator(text), 'like')
  assert.equal(filterBarOperator(choice), 'eq')
})

test('a field that does not allow the preferred operator falls back', () => {
  // `/logs` allows only eq/neq on the movement type, and some date fields are
  // range-less; the bar must not invent an operator.
  assert.equal(
    filterBarOperator({
      key: 'movement_type',
      label: 'x',
      type: 'select',
      operators: ['neq'],
    }),
    'neq',
  )
  assert.equal(
    filterBarOperator({
      key: 'recorded_at',
      label: 'x',
      type: 'date',
      operators: ['gte', 'lte'],
    }),
    'gte',
  )
})

test('every filter field of every config can be rendered by the bar', () => {
  // The bar draws one control per field: options → select, date → range,
  // everything else → text box. A field with no usable type would render an
  // empty cell, so guard the shapes the configs actually ship.
  const types = new Set(['text', 'number', 'date', 'boolean', 'select'])
  for (const config of Object.values(configs))
    for (const field of config.filterFields) {
      assert.ok(
        types.has(field.type),
        `${config.id}.${field.key}: ${field.type}`,
      )
      assert.ok(field.operators.length > 0, `${config.id}.${field.key}`)
      if (field.type === 'select' || field.type === 'boolean')
        assert.ok(
          Array.isArray(field.options),
          `${config.id}.${field.key} needs options or an async search`,
        )
    }
})

/** Values built inside the vm context have their own prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value))

test('a multi-select field emits in', () => {
  assert.equal(
    filterBarOperator({
      key: 'company_id',
      label: 'x',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    }),
    'in',
  )
  assert.deepEqual(plain(splitFilterValues('a, b,,c')), ['a', 'b', 'c'])
  assert.deepEqual(plain(splitFilterValues('')), [])
})

const recordedAt = {
  key: 'recorded_at',
  label: 'x',
  type: 'date',
  operators: ['eq', 'gte', 'lte', 'between'],
}

test('the date range covers whole Saudi days', () => {
  // "today .. today" must be the whole Saudi day, not the instant at
  // midnight UTC that a bare date key compares as on a timestamp column.
  assert.deepEqual(
    plain(dateRangeFilter(recordedAt, '2026-09-01', '2026-09-01')),
    {
      operator: 'between',
      value: '2026-08-31T21:00:00.000Z',
      valueTo: '2026-09-01T20:59:59.999Z',
    },
  )
  assert.deepEqual(plain(dateRangeFilter(recordedAt, '2026-09-01', '')), {
    operator: 'gte',
    value: '2026-08-31T21:00:00.000Z',
  })
  assert.deepEqual(plain(dateRangeFilter(recordedAt, '', '2026-09-30')), {
    operator: 'lte',
    value: '2026-09-30T20:59:59.999Z',
  })
  assert.equal(dateRangeFilter(recordedAt, '', ''), null)
  // Never an operator the field does not allow.
  assert.equal(
    dateRangeFilter({ ...recordedAt, operators: ['eq'] }, '2026-09-01', ''),
    null,
  )
})

test('a stored range reads back as the same Saudi dates', () => {
  for (const [from, to] of [
    ['2026-09-01', '2026-09-15'],
    ['2026-09-01', ''],
    ['', '2026-09-15'],
  ]) {
    const stored = {
      id: '1',
      field: 'recorded_at',
      ...dateRangeFilter(recordedAt, from, to),
    }
    assert.deepEqual(plain(dateRangeKeys(stored)), { from, to })
  }
  // Links made before the range stored instants still show their dates.
  assert.deepEqual(
    plain(
      dateRangeKeys({
        id: '1',
        field: 'recorded_at',
        operator: 'between',
        value: '2026-09-01',
        valueTo: '2026-09-02',
      }),
    ),
    { from: '2026-09-01', to: '2026-09-02' },
  )
  assert.deepEqual(plain(dateRangeKeys(undefined)), { from: '', to: '' })
  assert.equal(inferDatePreset('2020-01-01', '2020-01-02'), 'custom')
})

test('the active count ignores empty filters', () => {
  assert.equal(
    countActiveFilters([
      { id: '1', field: 'a', operator: 'eq', value: 'x' },
      { id: '2', field: 'b', operator: 'eq', value: '' },
      { id: '3', field: 'c', operator: 'is_set', value: '' },
    ]),
    2,
  )
})

// Owner review 2026-09-29: filters live behind the toolbar's button, in a
// dialog; no list renders FilterBar inline any more.
const SCREENS = {
  'src/screens/equipment/EquipmentListScreen.tsx': 'equipmentListConfig',
  'src/screens/drivers/DriversListScreen.tsx': 'driversListConfig',
  'src/screens/companies/CompaniesListScreen.tsx': 'companiesListConfig',
  'src/screens/projects/ProjectsListScreen.tsx': 'projectsListConfig',
  'src/screens/lessors/LessorsListScreen.tsx': 'lessorsListConfig',
  'src/screens/AdminUsers.tsx': 'usersListConfig',
  'src/screens/admin-home/LogsScreen.tsx': 'logsListConfig',
}

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('each list hands its own allowlist to the toolbar filter dialog', () => {
  for (const [file, config] of Object.entries(SCREENS)) {
    const source = read(file)
    assert.match(
      source,
      new RegExp(String.raw`filterFields=\{${config}\.filterFields\}`),
      `${file} should pass ${config}.filterFields to the toolbar`,
    )
    assert.match(source, /filters=\{list\.filters\}/, file)
    assert.match(source, /onFilters=\{list\.setFilters\}/, file)
    assert.doesNotMatch(source, /<FilterBar\b/, `${file} renders FilterBar`)
  }
})

test('the toolbar opens the filter dialog only when there are fields', () => {
  const source = read('src/components/data-list/DataListToolbar.tsx')
  assert.doesNotMatch(source, /FilterBuilder/)
  assert.doesNotMatch(source, /createPortal/)
  assert.match(source, /hasFilters = !!filterFields\?\.length && !!onFilters/)
  assert.match(source, /<FilterDialog\b/)
  assert.match(source, /t\('filters'\)/)
  assert.match(source, /countActiveFilters\(filters\)/)
})

test('the filter dialog has a title, a description and footer actions', () => {
  const source = read('src/components/data-list/FilterDialog.tsx')
  assert.match(source, /title=\{t\('filters'\)\}/)
  assert.match(source, /description=\{t\('filterDialogDesc'\)\}/)
  assert.match(source, /t\('clearAll'\)/)
  assert.match(source, /t\('filterDialogDone'\)/)
  assert.match(source, /<FilterBar\b/)
})

test('name text filters are gone; the search box covers them', () => {
  for (const name of [
    'companiesListConfig',
    'projectsListConfig',
    'lessorsListConfig',
  ])
    assert.deepEqual(Array.from(configs[name].filterFields), [], name)
})

test('/logs filters company and project by id, several at once', () => {
  const keys = configs.logsListConfig.filterFields.map((field) => field.key)
  assert.ok(!keys.includes('company_name_ar'))
  assert.ok(!keys.includes('project_name_ar'))
  for (const key of ['company_id', 'project_id']) {
    const field = configs.logsListConfig.filterFields.find(
      (item) => item.key === key,
    )
    assert.ok(field, key)
    assert.equal(field.multiple, true)
    assert.deepEqual(Array.from(field.operators), ['in'])
    assert.equal(filterBarOperator(field), 'in')
  }
  const recorded = configs.logsListConfig.filterFields.find(
    (item) => item.key === 'recorded_at',
  )
  for (const operator of ['between', 'gte', 'lte'])
    assert.ok(recorded.operators.includes(operator), operator)
})

test('company and project searches are narrow, bounded and server-side', () => {
  const source = read('src/components/data-list/relationFilters.ts')
  assert.match(source, /RELATION_FILTER_LIMIT = 20\b/)
  assert.match(source, /\.select\('id,name_ar,name_en'\)/)
  assert.match(source, /\.limit\(RELATION_FILTER_LIMIT\)/)
  assert.match(source, /sanitizeSearchTerm\(query\)/)
  assert.match(source, /\.in\('id', /)
})

test('the /logs foreman filter is a bounded server-side search', () => {
  const source = read('src/screens/admin-home/LogsScreen.tsx')
  assert.match(source, /asyncFields=\{/)
  assert.match(source, /supervisor_id: foremanFilter/)
  assert.match(source, /from\('profile_names'\)/)
  assert.match(source, /FOREMAN_OPTION_LIMIT = 20\b/)
  // No preloaded foreman list is injected into the config any more.
  assert.doesNotMatch(source, /setForemen|\.limit\(200\)/)
})
