const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the search helpers are exercised exactly as the screens use them.
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

const { sanitizeSearchTerm } = loadLibModule('search')
const { buildMovementSearchFilter, mapMovementLogRow } =
  loadLibModule('movementLogSearch')

test('the search term cannot break out of a PostgREST filter', () => {
  // Commas, dots and parentheses are structural in `or=(...)`; `%`/`_`/`*` are
  // LIKE wildcards. All of them must be neutralised before interpolation.
  assert.equal(
    sanitizeSearchTerm('  a,b.c(d)e:f"g\\h%i_j*k  '),
    'a b c d e f g h i j k',
  )
  assert.equal(sanitizeSearchTerm('   '), '')
  assert.ok(sanitizeSearchTerm('x'.repeat(500)).length <= 100)
})

test('an empty search adds no filter at all', () => {
  assert.equal(buildMovementSearchFilter(''), null)
  assert.equal(buildMovementSearchFilter('   %%  '), null)
})

test('search covers equipment, driver snapshot and contractor code', () => {
  const filter = buildMovementSearchFilter('A12')
  assert.ok(filter.includes('equipment_code.ilike.%A12%'))
  assert.ok(filter.includes('equipment_type.ilike.%A12%'))
  assert.ok(filter.includes('equipment_plate_number.ilike.%A12%'))
  assert.ok(filter.includes('equipment_chassis_number.ilike.%A12%'))
  assert.ok(filter.includes('driver_name.ilike.%A12%'))
  assert.ok(filter.includes('contractor_equipment_code.ilike.%A12%'))
  // Owner decision pending: notes and the foreman name stay out of search.
  assert.ok(!filter.includes('notes.'))
  assert.ok(!filter.includes('supervisor_name.'))
  // Company/project names only for the foreman list, which searched them before.
  assert.ok(!filter.includes('company_name_ar'))
  assert.ok(
    buildMovementSearchFilter('A12', { includeCompanyProject: true }).includes(
      'company_name_ar.ilike.%A12%',
    ),
  )
})

test('a code-like term is plain text and never becomes plate letters', () => {
  // Regression: "a341" used to add plate_letters_en.ilike.%A%, which matched
  // every plate containing an A (440 of 788 equipment rows in production).
  const filter = buildMovementSearchFilter('a341')
  assert.ok(filter.includes('equipment_code.ilike.%a341%'))
  assert.ok(!filter.includes('equipment_plate_letters_en'))
  assert.ok(!filter.includes('equipment_plate_digits'))
})

test('Arabic-Indic digits are searched as ASCII digits', () => {
  const filter = buildMovementSearchFilter('١٢٣٤')
  assert.ok(filter.includes('equipment_code.ilike.%1234%'))
  assert.ok(filter.includes('equipment_plate_digits.ilike.%1234%'))
})

test('a digits-only query still probes plate digits', () => {
  const filter = buildMovementSearchFilter('4821')
  assert.ok(filter.includes('equipment_plate_digits.ilike.%4821%'))
  assert.ok(!filter.includes('equipment_plate_letters_en'))
})

test('flat view rows rebuild the nested shape the cards expect', () => {
  const log = mapMovementLogRow({
    id: 'log-1',
    equipment_id: 'eq-1',
    supervisor_id: 'sup-1',
    movement_type: 'entry',
    movement_context: 'site',
    driver_id: 'drv-1',
    driver_name: 'سائق',
    recorded_at: '2026-09-15T08:00:00Z',
    created_at: '2026-09-15T08:01:00Z',
    company_id: 'co-1',
    project_id: null,
    equipment_code: 'A001',
    equipment_type: 'حفار',
    equipment_plate_number: '1234-ABC',
    equipment_chassis_number: 'CH-9',
    company_name_ar: 'شركة',
    company_name_en: 'Company',
    supervisor_name: 'فورمين',
    driver_mobile_number: '0500000000',
  })
  assert.equal(log.equipment.code, 'A001')
  assert.equal(log.equipment.plate_number, '1234-ABC')
  assert.equal(log.supervisor.full_name, 'فورمين')
  assert.equal(log.company.name_ar, 'شركة')
  assert.equal(log.project, null)
  assert.equal(log.driver.mobile_number, '0500000000')
})
