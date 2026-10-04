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
  adminVisitsListConfig,
  buildVisitSearchFilter,
  foremanVisitsListConfig,
  formatVisitDuration,
  visitContextFilter,
  visitExportColumns,
  visitExportFileName,
  visitOwnerLabel,
  visitSortField,
  visitStateView,
  visitsListConfig,
  EQUIPMENT_VISITS_SELECT,
  SUPPLIER_LOOKUP_CHUNK_SIZE,
  chunkItems,
  distinctDriverIds,
  withCurrentDrivers,
  distinctEquipmentIds,
  driverMobilesById,
  supplierNamesByEquipment,
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

test('a text term probes code, type, plate, driver and company number only', () => {
  // The type and the driver are matched through their normalized columns
  // (migration 0116), which get the normalized (lower-case) term.
  assert.equal(
    buildVisitSearchFilter('A12'),
    'equipment_code.ilike.%A12%,' +
      'equipment_type_search.ilike.%a12%,' +
      'equipment_plate_number.ilike.%A12%,' +
      'driver_name_search.ilike.%a12%,' +
      'contractor_equipment_code.ilike.%A12%',
  )
})

test('the company number (contractor code) is searched with the sanitized term', () => {
  // EM-198: a visit is found by the company number typed on its ENTRY.
  const filter = buildVisitSearchFilter('  TK-7,(x)  ')
  assert.ok(filter.includes('contractor_equipment_code.ilike.%TK-7 x%'))
  // The structural characters never reach the pattern.
  assert.ok(!/contractor_equipment_code\.ilike\.[^,]*[()]/.test(filter))
})

test('a digits-only term probes the company number and the plate digits', () => {
  const filter = buildVisitSearchFilter('٠٤٢')
  assert.ok(filter.includes('contractor_equipment_code.ilike.%042%'))
  assert.ok(filter.includes('equipment_plate_digits.ilike.%042%'))
})

test('a lettered company number is matched as written, never split', () => {
  const filter = buildVisitSearchFilter('B15')
  assert.ok(filter.includes('contractor_equipment_code.ilike.%B15%'))
  assert.ok(!filter.includes('plate_digits'))
  assert.ok(!filter.includes('plate_letters'))
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

test('the select list carries the company number appended by 0106', () => {
  const columns = EQUIPMENT_VISITS_SELECT.split(',')
  assert.ok(columns.includes('contractor_equipment_code'))
  assert.ok(visitsListConfig.searchFields.includes('contractor_equipment_code'))
})

test('the context filter maps all to no predicate', () => {
  assert.equal(visitContextFilter('site'), 'site')
  assert.equal(visitContextFilter('workshop'), 'workshop')
  assert.equal(visitContextFilter('all'), null)
})

// ---------------------------------------------------------------------------
// Admin log visits view
// ---------------------------------------------------------------------------

test('the admin visits filters are an allowlist of movement_visits columns', () => {
  const keys = adminVisitsListConfig.filterFields.map((field) => field.key)
  assert.deepEqual(
    [...keys].sort(),
    [
      'company_id',
      'entry_at',
      'entry_supervisor_id',
      'equipment_ownership_status',
      'is_open',
      'project_id',
      'workshop_purpose',
    ].sort(),
  )
  // Every filter key is a column the view's select list also reads.
  const columns = EQUIPMENT_VISITS_SELECT.split(',')
  for (const key of ['company_id', 'project_id'])
    assert.ok(columns.includes(key), key)
  // The owner filter offers the same five owners as the movement log.
  const owner = adminVisitsListConfig.filterFields.find(
    (field) => field.key === 'equipment_ownership_status',
  )
  assert.deepEqual(
    [...owner.options.map((option) => option.value)],
    [
      'alazani',
      'takween',
      'third_party_f',
      'third_party_partnership_b',
      'external_supplier',
    ],
  )
  // Search and sort are the home tab's, so the two views never diverge.
  assert.equal(adminVisitsListConfig.defaultSort, 'entry_at')
  assert.equal(adminVisitsListConfig.defaultDirection, 'desc')
  assert.notEqual(adminVisitsListConfig.id, visitsListConfig.id)
})

test('visits filter company and project by id, several at once', () => {
  // Owner request 2026-09-30: selects, never the old name text boxes.
  for (const config of [adminVisitsListConfig, foremanVisitsListConfig]) {
    const keys = config.filterFields.map((field) => field.key)
    assert.ok(!keys.includes('company_name_ar'), config.id)
    assert.ok(!keys.includes('project_name_ar'), config.id)
    for (const key of ['company_id', 'project_id']) {
      const field = config.filterFields.find((item) => item.key === key)
      assert.ok(field, `${config.id} ${key}`)
      assert.equal(field.type, 'select')
      assert.equal(field.multiple, true)
      assert.deepEqual([...field.operators], ['in'])
    }
  }
})

test('the foreman home filters by company and project only', () => {
  assert.deepEqual(
    [...foremanVisitsListConfig.filterFields.map((field) => field.key)],
    ['company_id', 'project_id'],
  )
  // Same search and sort as the other two visits lists, under its own id.
  assert.equal(foremanVisitsListConfig.defaultSort, 'entry_at')
  assert.deepEqual(
    [...foremanVisitsListConfig.searchFields],
    [...visitsListConfig.searchFields],
  )
  assert.notEqual(foremanVisitsListConfig.id, visitsListConfig.id)
  assert.notEqual(foremanVisitsListConfig.id, adminVisitsListConfig.id)
  // A workshop visit has no company or project: the workshop home has no
  // filters at all.
  assert.deepEqual([...visitsListConfig.filterFields], [])
})

test('new Arabic copy in the visits configs has no hamza or madda alif', () => {
  const labels = []
  for (const config of [
    visitsListConfig,
    adminVisitsListConfig,
    foremanVisitsListConfig,
  ]) {
    labels.push(config.searchPlaceholder.ar)
    for (const field of config.filterFields) {
      if (typeof field.label === 'object') labels.push(field.label.ar)
      for (const option of field.options ?? []) labels.push(option.label)
    }
  }
  for (const label of labels) assert.ok(!/[أإآ]/.test(label), label)
})

// ---------------------------------------------------------------------------
// Visits export
// ---------------------------------------------------------------------------

const fakeT = (key) => `[${key}]`
// The helpers run in their own vm realm; compare plain data, not realms.
const plain = (value) => JSON.parse(JSON.stringify(value))

function visit(overrides = {}) {
  return {
    entry_id: 'n1',
    exit_id: 'x1',
    equipment_id: 'e1',
    equipment_code: 'A12',
    equipment_type: 'Loader',
    equipment_plate_number: '1234 ABC',
    movement_context: 'site',
    workshop_purpose: null,
    company_id: 'c1',
    company_name_ar: 'شركة',
    company_name_en: 'Company',
    project_id: 'p1',
    project_name_ar: 'مشروع',
    project_name_en: 'Project',
    entry_supervisor_id: 's1',
    entry_supervisor_name: 'Foreman',
    exit_supervisor_id: 's1',
    driver_id: null,
    driver_name: null,
    entry_at: '2026-09-20T07:00:00Z',
    exit_at: '2026-09-20T10:00:00Z',
    is_open: false,
    duration_minutes: 180,
    contractor_equipment_code: 'TK-7',
    ...overrides,
  }
}

test('the visits export writes plain text, the company number and Saudi dates', () => {
  const columns = visitExportColumns(fakeT, 'en')
  const headers = columns.map((column) => column.header)
  assert.ok(headers.includes('[contractorEquipmentCode]'))
  assert.ok(headers.includes('[visitEntryAt]'))
  const row = visit()
  const cell = (header) =>
    columns.find((column) => column.header === header).value(row)
  assert.equal(cell('[contractorEquipmentCode]'), 'TK-7')
  assert.equal(cell('[company]'), 'Company')
  assert.equal(cell('[logsColContext]'), '[logsSites]')
  assert.equal(cell('[visitState]'), '[visitClosed]')
  // A driverless entry (allowed since 2026-09-23) is an empty cell, not "—".
  assert.equal(cell('[driverName]'), '')
  assert.equal(cell('[visitDuration]'), '3 hours')
  const dates = columns.filter((column) => column.type === 'date')
  assert.equal(dates.length, 2)
})

test('the export carries owner and supplier right after the equipment columns', () => {
  const headers = visitExportColumns(fakeT, 'ar').map((column) => column.header)
  assert.deepEqual(plain(headers.slice(0, 6)), [
    '[equipmentCodeLabel]',
    '[equipmentType]',
    '[plateNumber]',
    '[ownershipStatus]',
    '[lessor]',
    '[contractorEquipmentCode]',
  ])
  assert.ok(
    EQUIPMENT_VISITS_SELECT.split(',').includes('equipment_ownership_status'),
  )
})

test('the owner cell uses the short owner labels and never goes blank', () => {
  const labels = {
    exportOwnerAlazani: 'Al-Azani',
    ownershipTakween: 'Takween',
    exportOwnerThirdPartyF: 'F',
    exportOwnerThirdPartyB: 'B',
    adminHomeOwnerExternal: 'Other',
  }
  const t = (key) => labels[key] ?? key
  assert.equal(visitOwnerLabel('alazani', t), 'Al-Azani')
  assert.equal(visitOwnerLabel('takween', t), 'Takween')
  assert.equal(visitOwnerLabel('third_party_f', t), 'F')
  assert.equal(visitOwnerLabel('third_party_partnership_b', t), 'B')
  assert.equal(visitOwnerLabel('external_supplier', t), 'Other')
  assert.equal(visitOwnerLabel('something_new', t), 'something_new')
  assert.equal(visitOwnerLabel(null, t), '')
  assert.equal(visitOwnerLabel(undefined, t), '')
})

test('the supplier cell comes from the looked-up map and is empty without a lessor', () => {
  const suppliers = new Map([['e1', 'Gulf Rentals']])
  const columns = visitExportColumns(fakeT, 'en', suppliers)
  const supplier = columns.find((column) => column.header === '[lessor]')
  const owner = columns.find((column) => column.header === '[ownershipStatus]')
  assert.equal(supplier.value(visit()), 'Gulf Rentals')
  assert.equal(supplier.value(visit({ equipment_id: 'e2' })), '')
  // Without a lookup the cell is simply empty.
  const bare = visitExportColumns(fakeT, 'en')
  assert.equal(
    bare.find((column) => column.header === '[lessor]').value(visit()),
    '',
  )
  assert.equal(
    owner.value(visit({ equipment_ownership_status: 'takween' })),
    '[ownershipTakween]',
  )
})

test('supplier names are mapped from the equipment rows, object or array', () => {
  const map = supplierNamesByEquipment([
    { id: 'a', lessor: { name: ' Alpha ' } },
    { id: 'b', lessor: [{ name: 'Beta' }] },
    { id: 'c', lessor: null },
    { id: 'd', lessor: { name: '  ' } },
    { id: 'e' },
  ])
  assert.deepEqual(plain([...map.entries()]), [
    ['a', 'Alpha'],
    ['b', 'Beta'],
  ])
  // A second chunk adds to the same map.
  supplierNamesByEquipment([{ id: 'f', lessor: { name: 'Phi' } }], map)
  assert.equal(map.get('f'), 'Phi')
})

test('equipment ids are de-duplicated and looked up in bounded chunks', () => {
  const ids = distinctEquipmentIds([
    { equipment_id: 'a' },
    { equipment_id: 'b' },
    { equipment_id: 'a' },
    { equipment_id: '' },
  ])
  assert.deepEqual(plain(ids), ['a', 'b'])
  const many = Array.from({ length: 250 }, (_, index) => `id${index}`)
  const chunks = chunkItems(many, SUPPLIER_LOOKUP_CHUNK_SIZE)
  assert.ok(chunks.every((chunk) => chunk.length <= SUPPLIER_LOOKUP_CHUNK_SIZE))
  assert.equal(chunks.flat().length, 250)
  assert.deepEqual(plain(chunkItems([], 100)), [])
})

test('an open visit exports no exit instant', () => {
  const columns = visitExportColumns(fakeT, 'ar')
  const exit = columns.find((column) => column.header === '[visitExitAt]')
  assert.equal(
    exit.value(visit({ is_open: true, exit_id: null, exit_at: null })),
    null,
  )
  const context = columns.find((column) => column.header === '[logsColContext]')
  assert.equal(
    context.value(
      visit({ movement_context: 'workshop', workshop_purpose: 'parking' }),
    ),
    '[parkingPurpose]',
  )
})

test('the visits export file is named by context and Saudi day', () => {
  // 22:30 UTC is already the next day in Saudi Arabia (UTC+03:00).
  assert.equal(
    visitExportFileName('all', '2026-09-28T22:30:00Z'),
    'visits-all-20260929.xlsx',
  )
  assert.equal(
    visitExportFileName('site', '2026-09-28T10:00:00Z'),
    'visits-site-20260928.xlsx',
  )
})

test('the driver mobile is exported from the lookup, empty when unknown', () => {
  const mobiles = driverMobilesById([
    { id: 'd1', mobile_number: ' 0500000001 ' },
    { id: 'd2', mobile_number: null },
  ])
  assert.deepEqual(plain([...mobiles.entries()]), [['d1', '0500000001']])
  assert.deepEqual(
    plain(
      distinctDriverIds([
        { driver_id: 'd1' },
        { driver_id: null },
        { driver_id: 'd1' },
      ]),
    ),
    ['d1'],
  )
  const columns = visitExportColumns(fakeT, 'en', new Map(), mobiles)
  const headers = columns.map((column) => column.header)
  const mobile = columns[headers.indexOf('[exportColDriverMobile]')]
  assert.equal(
    headers.indexOf('[exportColDriverMobile]'),
    headers.indexOf('[driverName]') + 1,
  )
  assert.equal(mobile.value(visit({ driver_id: 'd1' })), '0500000001')
  assert.equal(mobile.value(visit({ driver_id: 'd2' })), '')
  assert.equal(mobile.value(visit({ driver_id: null })), '')
})

test('a visit shows its latest driver change, else the entry driver', () => {
  const change = (over) => ({
    id: 'c1',
    entry_log_id: 'e1',
    new_driver_id: 'd9',
    new_driver_name: 'Late Driver',
    changed_at: '2026-10-01T10:00:00+00:00',
    ...over,
  })
  const rows = [
    { entry_id: 'e1', driver_id: null, driver_name: null },
    { entry_id: 'e2', driver_id: 'd1', driver_name: 'Entry Driver' },
  ]
  const out = withCurrentDrivers(rows, [
    change({ id: 'c1' }),
    // Same instant: the higher id wins, whatever the input order.
    change({ id: 'c3', new_driver_id: 'd7', new_driver_name: 'Last' }),
    change({ id: 'c2', new_driver_id: 'd8', new_driver_name: 'Middle' }),
  ])
  assert.deepEqual(plain(out[0]), {
    entry_id: 'e1',
    driver_id: 'd7',
    driver_name: 'Last',
  })
  // No change: the entry driver stays, and the input row is not mutated.
  assert.deepEqual(plain(out[1]), plain(rows[1]))
  assert.equal(rows[0].driver_name, null)
  // A later instant beats a higher id.
  const later = withCurrentDrivers(rows, [
    change({ id: 'c9' }),
    change({
      id: 'c1',
      new_driver_name: 'Newest',
      changed_at: '2026-10-02T10:00:00+00:00',
    }),
  ])
  assert.equal(later[0].driver_name, 'Newest')
})
