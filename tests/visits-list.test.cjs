const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the visits helpers are exercised exactly as the home tab uses them. The
// type-only imports in visitsList.ts (`Language`, `DataListConfig`) are erased
// by the transpile, so no React or Next module is ever required here.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const {
  buildVisitSearchFilter,
  formatVisitDuration,
  visitSortField,
  visitStateView,
  visitsListConfig,
  EQUIPMENT_VISITS_SELECT,
} = loadLibModule('visitsList')

// ---------------------------------------------------------------------------
// Search filter
// ---------------------------------------------------------------------------

test('an empty or wholly structural term produces no filter', () => {
  assert.equal(buildVisitSearchFilter(''), null)
  assert.equal(buildVisitSearchFilter('   '), null)
  assert.equal(buildVisitSearchFilter('%_*'), null)
})

test('the search term cannot break out of the PostgREST or() filter', () => {
  // Commas, dots and parentheses are structural in `or=(...)`; `%`/`_`/`*` are
  // LIKE wildcards. None of them may survive into the pattern.
  const filter = buildVisitSearchFilter('a,b.c(d)%e_f*g')
  assert.ok(filter)
  for (const part of filter.split(',')) {
    const value = part.slice(part.indexOf('.ilike.') + '.ilike.'.length)
    assert.equal(value, '%a b c d e f g%')
  }
})

test('a text term probes code, type, plate and the driver snapshot only', () => {
  assert.equal(
    buildVisitSearchFilter('A12'),
    'equipment_code.ilike.%A12%,' +
      'equipment_type.ilike.%A12%,' +
      'equipment_plate_number.ilike.%A12%,' +
      'driver_name.ilike.%A12%',
  )
})

test('a digits-only term additionally probes the normalized plate digits', () => {
  const filter = buildVisitSearchFilter('١٢٣٤')
  // Arabic-Indic digits are converted before the term reaches the pattern.
  assert.ok(filter.includes('equipment_code.ilike.%1234%'))
  assert.ok(filter.includes('equipment_plate_digits.ilike.%1234%'))
})

test('a term with letters is never split into plate letters', () => {
  // "a341" must not become "digits 341 + letter A", which used to match every
  // plate containing an A.
  const filter = buildVisitSearchFilter('a341')
  assert.ok(!filter.includes('plate_digits'))
  assert.ok(!filter.includes('plate_letters'))
})

// ---------------------------------------------------------------------------
// Visit state
// ---------------------------------------------------------------------------

// The helper runs inside a `vm` realm, so its objects have a different Object
// prototype and never pass a strict deep comparison; the fields are asserted
// one by one instead.
function assertStateView(actual, expected) {
  assert.equal(actual.state, expected.state)
  assert.equal(actual.tone, expected.tone)
  assert.equal(actual.labelKey, expected.labelKey)
}

test('a visit with an exit is closed and neutral', () => {
  assertStateView(
    visitStateView({
      is_open: false,
      exit_id: 'e1',
      exit_at: '2026-09-20T10:00:00Z',
    }),
    { state: 'closed', tone: 'neutral', labelKey: 'visitClosed' },
  )
})

test('a visit the database marked open is green', () => {
  assertStateView(
    visitStateView({ is_open: true, exit_id: null, exit_at: null }),
    { state: 'open', tone: 'success', labelKey: 'visitOpen' },
  )
})

test('a missing exit side reads as still inside, whatever is_open says', () => {
  // The EXIT can be hidden from this caller by RLS. "Still inside" is the safe
  // reading; inventing an end instant is not.
  assert.equal(
    visitStateView({ is_open: false, exit_id: null, exit_at: null }).state,
    'open',
  )
  assert.equal(
    visitStateView({ is_open: false, exit_id: 'e1', exit_at: null }).state,
    'open',
  )
})

// ---------------------------------------------------------------------------
// Duration humaniser
// ---------------------------------------------------------------------------

test('Arabic number agreement: singular, dual, plural, then singular again', () => {
  assert.equal(formatVisitDuration(0, 'ar'), '0 دقيقة')
  assert.equal(formatVisitDuration(1, 'ar'), 'دقيقة')
  assert.equal(formatVisitDuration(2, 'ar'), 'دقيقتان')
  assert.equal(formatVisitDuration(5, 'ar'), '5 دقائق')
  assert.equal(formatVisitDuration(10, 'ar'), '10 دقائق')
  assert.equal(formatVisitDuration(11, 'ar'), '11 دقيقة')
  assert.equal(formatVisitDuration(59, 'ar'), '59 دقيقة')
})

test('the largest whole unit wins: minutes, then hours, then days', () => {
  assert.equal(formatVisitDuration(60, 'ar'), 'ساعة')
  assert.equal(formatVisitDuration(120, 'ar'), 'ساعتان')
  assert.equal(formatVisitDuration(5 * 60 + 59, 'ar'), '5 ساعات')
  assert.equal(formatVisitDuration(23 * 60 + 59, 'ar'), '23 ساعة')
  assert.equal(formatVisitDuration(24 * 60, 'ar'), 'يوم')
  assert.equal(formatVisitDuration(2 * 24 * 60, 'ar'), 'يومان')
  assert.equal(formatVisitDuration(3 * 24 * 60 + 90, 'ar'), '3 ايام')
  assert.equal(formatVisitDuration(11 * 24 * 60, 'ar'), '11 يوما')
})

test('no Arabic duration word uses a hamza or madda alif', () => {
  for (const minutes of [0, 1, 2, 5, 11, 60, 120, 300, 1440, 2880, 4320]) {
    const text = formatVisitDuration(minutes, 'ar')
    assert.ok(!/[أإآ]/.test(text), `${minutes} -> ${text}`)
  }
})

test('English duration keeps plain plurals', () => {
  assert.equal(formatVisitDuration(1, 'en'), '1 minute')
  assert.equal(formatVisitDuration(45, 'en'), '45 minutes')
  assert.equal(formatVisitDuration(60, 'en'), '1 hour')
  assert.equal(formatVisitDuration(3 * 60, 'en'), '3 hours')
  assert.equal(formatVisitDuration(24 * 60, 'en'), '1 day')
  assert.equal(formatVisitDuration(5 * 24 * 60, 'en'), '5 days')
})

test('a missing or impossible duration has no text at all', () => {
  assert.equal(formatVisitDuration(null, 'ar'), null)
  assert.equal(formatVisitDuration(undefined, 'ar'), null)
  assert.equal(formatVisitDuration(-1, 'ar'), null)
  assert.equal(formatVisitDuration(Number.NaN, 'ar'), null)
})

// ---------------------------------------------------------------------------
// List config
// ---------------------------------------------------------------------------

test('sorting is an allowlist, defaulting to the entry instant', () => {
  assert.equal(visitSortField('entry_at'), 'entry_at')
  assert.equal(visitSortField('exit_at'), 'exit_at')
  assert.equal(visitSortField('duration_minutes'), 'entry_at')
  assert.equal(visitSortField('id; drop table'), 'entry_at')
  assert.equal(visitSortField(null), 'entry_at')
  assert.equal(visitSortField(undefined), 'entry_at')
})

test('the visits list defaults to the newest visit first', () => {
  assert.equal(visitsListConfig.defaultSort, 'entry_at')
  assert.equal(visitsListConfig.defaultDirection, 'desc')
  // Every sortable key must be one the fetcher will actually accept.
  for (const field of visitsListConfig.sortableFields)
    assert.equal(visitSortField(field.key), field.key)
})

test('the select list carries every column the tab renders', () => {
  const columns = EQUIPMENT_VISITS_SELECT.split(',')
  for (const column of [
    'entry_id',
    'exit_id',
    'equipment_code',
    'equipment_type',
    'movement_context',
    'workshop_purpose',
    'company_name_ar',
    'project_name_ar',
    'entry_at',
    'exit_at',
    'is_open',
    'duration_minutes',
  ])
    assert.ok(columns.includes(column), column)
  // `select('*')` is never acceptable for a list query.
  assert.ok(!columns.includes('*'))
})
