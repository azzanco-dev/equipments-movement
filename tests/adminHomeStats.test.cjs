const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files,
// so the admin-home helpers are exercised exactly as the screen uses them.
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
        const alias = /^@\/lib\/(.+)$/.exec(request)
        if (alias) return loadLibModule(alias[1], cache)
        const relative = /^\.\/(.+)$/.exec(request)
        if (relative) return loadLibModule(relative[1], cache)
        // Type-only imports are erased; anything else is a real dependency the
        // helpers must not have.
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const cache = new Map()
const admin = loadLibModule('adminHomeStats', cache)
const buckets = loadLibModule('chartBuckets', cache)
// The export helper deliberately keeps Supabase and `xlsx` out of its module
// scope (the page loader is an argument, the workbook is a dynamic import), so
// it loads here exactly as it does in the browser.
const exporter = loadLibModule('adminHomeExport', cache)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- owner filter (multi-select, migration 0095) ---------------------------

test('normalizeOwnerFilters (reports) accepts all five known ownership_status values', () => {
  assert.deepEqual(plain(admin.normalizeOwnerFilters('alazani')), ['alazani'])
  assert.deepEqual(plain(admin.normalizeOwnerFilters('alazani,takween')), [
    'alazani',
    'takween',
  ])
  // Anything else is dropped rather than sent to a database function that
  // would reject it, so a hand-edited URL can never break the page.
  assert.deepEqual(plain(admin.normalizeOwnerFilters('alazani,owned')), [
    'alazani',
  ])
  assert.deepEqual(plain(admin.normalizeOwnerFilters('owned')), [])
  assert.deepEqual(plain(admin.normalizeOwnerFilters('')), [])
  assert.deepEqual(plain(admin.normalizeOwnerFilters(null)), [])
  assert.deepEqual(plain(admin.normalizeOwnerFilters(undefined)), [])
  assert.deepEqual(plain(admin.ALL_OWNERS), [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier',
  ])
})

test('report owner filters are deduplicated and canonically ordered', () => {
  // The same selection must always produce the same URL and the same request
  // signature, whatever order the user ticked the boxes in.
  assert.deepEqual(
    plain(admin.normalizeOwnerFilters('takween,alazani,takween')),
    ['alazani', 'takween'],
  )
  assert.deepEqual(
    plain(admin.normalizeOwnerFilters([' takween ', 'alazani'])),
    ['alazani', 'takween'],
  )
})

test('the report argument is NULL for "every owner", never an empty array', () => {
  assert.equal(admin.ownerFilterArgument([]), null)
  assert.equal(admin.ownerFilterArgument(null), null)
  assert.equal(admin.ownerFilterArgument(undefined), null)
  assert.deepEqual(plain(admin.ownerFilterArgument(['alazani'])), ['alazani'])
  assert.deepEqual(plain(admin.ownerFilterArgument(['takween', 'bogus'])), [
    'takween',
  ])
  assert.equal(admin.ownerFilterArgument(['bogus']), null)
})

// --- admin home owners (EM-199, 2026-09-29) --------------------------------

const HOME_THREE = ['alazani', 'third_party_f', 'third_party_partnership_b']

test('the admin home offers exactly Al-Azani, F and B', () => {
  assert.deepEqual(plain(admin.ADMIN_HOME_OWNERS), HOME_THREE)
  assert.ok(!admin.ADMIN_HOME_OWNERS.includes('takween'))
  assert.ok(!admin.ADMIN_HOME_OWNERS.includes('external_supplier'))
})

test('every admin home section starts on Al-Azani only (2026-09-30)', () => {
  assert.deepEqual(plain(admin.DEFAULT_HOME_OWNERS), ['alazani'])
  // The default is one of the offered options, and it is not the same as an
  // empty selection, which still means the three.
  assert.ok(
    admin.DEFAULT_HOME_OWNERS.every((owner) =>
      admin.ADMIN_HOME_OWNERS.includes(owner),
    ),
  )
  assert.deepEqual(plain(admin.homeOwnerArgument([])), HOME_THREE)
})

test('the fleet state cards share one drill-down vocabulary', () => {
  assert.deepEqual(plain(admin.FLEET_DRILL_STATES), [
    'total',
    'inside_site',
    'workshop',
    'available',
    'workshop_maintenance',
    'workshop_parking',
    'workshop_unclassified',
  ])
  // Every per-unit state the database classifies is reachable from a card.
  admin.FLEET_STATES.forEach((state) =>
    assert.ok(admin.FLEET_DRILL_STATES.includes(state), state),
  )
})

test('normalizeHomeOwnerFilters drops Takween, external suppliers and unknowns', () => {
  assert.deepEqual(
    plain(admin.normalizeHomeOwnerFilters('third_party_f,takween,alazani')),
    ['alazani', 'third_party_f'],
  )
  assert.deepEqual(
    plain(admin.normalizeHomeOwnerFilters(['external_supplier', 'bogus'])),
    [],
  )
  assert.deepEqual(plain(admin.normalizeHomeOwnerFilters(null)), [])
  // Already canonical, so normalizing the default changes nothing.
  assert.deepEqual(
    plain(admin.normalizeHomeOwnerFilters(admin.DEFAULT_HOME_OWNERS)),
    ['alazani'],
  )
  assert.deepEqual(
    plain(admin.normalizeHomeOwnerFilters(admin.ADMIN_HOME_OWNERS)),
    HOME_THREE,
  )
})

test('the home p_owners argument is never NULL and never leaves the three', () => {
  // An empty selection is the three owners, not "all five".
  assert.deepEqual(plain(admin.homeOwnerArgument([])), HOME_THREE)
  assert.deepEqual(plain(admin.homeOwnerArgument(null)), HOME_THREE)
  assert.deepEqual(plain(admin.homeOwnerArgument(undefined)), HOME_THREE)
  assert.deepEqual(plain(admin.homeOwnerArgument(admin.DEFAULT_HOME_OWNERS)), [
    'alazani',
  ])
  assert.deepEqual(plain(admin.homeOwnerArgument(['third_party_f'])), [
    'third_party_f',
  ])
  // Takween / external / unknown values never reach the database; a selection
  // of nothing else degrades to the three.
  assert.deepEqual(plain(admin.homeOwnerArgument(['takween', 'alazani'])), [
    'alazani',
  ])
  assert.deepEqual(plain(admin.homeOwnerArgument(['takween'])), HOME_THREE)
  assert.deepEqual(
    plain(admin.homeOwnerArgument(['external_supplier', 'bogus'])),
    HOME_THREE,
  )
})

test('the owner x state matrix only ever lists the three home owners', () => {
  const matrix = admin.parseOwnerStateMatrix({
    total: 9,
    cells: [
      { owner: 'external_supplier', state: 'inside', count: 2 },
      { owner: 'third_party_f', state: 'inside', count: 3 },
      { owner: 'takween', state: 'outside', count: 1 },
      { owner: 'alazani', state: 'inside', count: 3 },
    ],
  })
  assert.deepEqual(plain(matrix.owners), ['alazani', 'third_party_f'])
})

test('only Al-Azani counts as owned', () => {
  assert.equal(admin.isOwnedOwner('alazani'), true)
  assert.equal(admin.isOwnedOwner('takween'), false)
  assert.equal(admin.isOwnedOwner('external_supplier'), false)
})

// --- parsers ---------------------------------------------------------------

test('parseFleetState survives a malformed payload', () => {
  const empty = admin.parseFleetState(null)
  assert.equal(empty.total, 0)
  assert.deepEqual(plain(empty.byOwner), [])
  assert.deepEqual(plain(empty.byType), [])

  const parsed = admin.parseFleetState({
    total: 12,
    inside_sites: 5,
    in_workshop: 4,
    workshop_maintenance: 3,
    workshop_parking: 1,
    workshop_unclassified: 0,
    available: 3,
    idle_30: 6,
    idle_60: 4,
    idle_90: 2,
    never_moved: 1,
    // Negative and non-numeric values must not reach a component.
    by_owner: [
      { owner: 'alazani', total: 7, inside_sites: -1, available: 'x' },
      { owner: '', total: 4 },
    ],
    by_type: 'not-an-array',
  })
  assert.equal(parsed.total, 12)
  assert.equal(parsed.workshopMaintenance, 3)
  // The idle buckets are still in the payload but no longer parsed: the page
  // stopped showing ages (owner review, 2026-09-22), and leaving them in the
  // database keeps that a UI decision rather than a migration.
  assert.equal('idle30' in parsed, false)
  assert.equal('neverMoved' in parsed, false)
  assert.deepEqual(plain(parsed.byOwner), [
    {
      key: 'alazani',
      total: 7,
      insideSites: 0,
      inWorkshop: 0,
      available: 0,
    },
  ])
  assert.deepEqual(plain(parsed.byType), [])
})

test('parseAvailabilityRows returns flat counts, no owned/rented split', () => {
  const rows = admin.parseAvailabilityRows([
    { type: 'حفار', inside_sites: 4, in_workshop: 2, available: 3, total: 9 },
    { type: '', inside_sites: 1, total: 1 },
  ])
  assert.deepEqual(plain(rows), [
    { type: 'حفار', insideSites: 4, inWorkshop: 2, available: 3, total: 9 },
  ])
  assert.deepEqual(plain(admin.parseAvailabilityRows('nope')), [])
})

test('the availability page carries the database total, not the page length', () => {
  // Migration 0101 paginates this table server-side: `total_count` repeats on
  // every row, so the page count must never be derived from `rows.length`.
  const page = admin.parseAvailabilityPage([
    {
      type: 'حفار',
      inside_sites: 4,
      in_workshop: 2,
      available: 3,
      total: 9,
      total_count: 37,
    },
    {
      type: 'شيول',
      inside_sites: 1,
      in_workshop: 0,
      available: 2,
      total: 3,
      total_count: 37,
    },
  ])
  assert.equal(page.total, 37)
  assert.equal(page.rows.length, 2)
  // An empty page has no row to read the count from, and is a total of zero.
  assert.deepEqual(plain(admin.parseAvailabilityPage([])), {
    rows: [],
    total: 0,
  })
  assert.deepEqual(plain(admin.parseAvailabilityPage(null)), {
    rows: [],
    total: 0,
  })
})

test('parseFleetEquipmentPage keeps never-moved equipment identifiable', () => {
  const page = admin.parseFleetEquipmentPage([
    {
      total_count: 3,
      id: 'w',
      code: 'A-7',
      type: 'حفار',
      ownership_status: 'alazani',
      state: 'workshop_maintenance',
      since: '2026-09-20T07:00:00Z',
      last_movement_id: 'm7',
      last_movement_type: 'entry',
      last_movement_context: 'workshop',
      workshop_purpose: 'maintenance',
      company_name_ar: null,
    },
    {
      total_count: 3,
      id: 's',
      code: 'A-2',
      type: 'شيول',
      ownership_status: 'alazani',
      state: 'inside_site',
      since: '2026-09-19T07:00:00Z',
      last_movement_id: 'm2',
      last_movement_type: 'entry',
      last_movement_context: 'site',
      workshop_purpose: 'bogus',
      company_name_ar: 'شركة',
      company_name_en: 'Company',
      project_name_ar: 'مشروع',
      project_name_en: 'Project',
    },
    {
      total_count: 3,
      id: 'a',
      code: 'A-1',
      type: 'حفار',
      ownership_status: 'alazani',
      state: 'available',
      since: null,
    },
    { total_count: 3, id: '', code: 'dropped' },
  ])
  assert.equal(page.total, 3)
  assert.equal(page.rows.length, 3)
  assert.equal(page.rows[0].state, 'workshop_maintenance')
  assert.equal(page.rows[0].workshopPurpose, 'maintenance')
  assert.equal(page.rows[0].lastMovementId, 'm7')
  assert.equal(page.rows[0].companyNameAr, null)
  // An unknown purpose is dropped rather than rendered as a badge.
  assert.equal(page.rows[1].workshopPurpose, null)
  assert.equal(page.rows[1].companyNameEn, 'Company')
  assert.equal(page.rows[1].projectNameAr, 'مشروع')
  // The never-moved row keeps a null date rather than an empty string, so the
  // table can tell "no movements" from a date it failed to read.
  assert.equal(page.rows[2].since, null)
  assert.equal(page.rows[2].lastMovementType, null)
  assert.deepEqual(plain(admin.parseFleetEquipmentPage(null)), {
    rows: [],
    total: 0,
  })
})

test('parseLatestEntryRows reads the movement log view and drops id-less rows', () => {
  const rows = admin.parseLatestEntryRows([
    {
      id: 'm1',
      equipment_id: 'e1',
      equipment_code: 'A-1',
      equipment_type: 'حفار',
      equipment_ownership_status: 'alazani',
      movement_context: 'workshop',
      company_name_ar: null,
      supervisor_name: 'خالد',
      recorded_at: '2026-09-20T07:00:00Z',
    },
    { id: '', equipment_code: 'dropped' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].context, 'workshop')
  assert.equal(rows[0].foreman, 'خالد')
  assert.equal(rows[0].owner, 'alazani')
  assert.equal(rows[0].companyNameAr, null)
  assert.deepEqual(plain(admin.parseLatestEntryRows('nope')), [])
})

test('parseLatestEquipmentRows keeps the added date', () => {
  const rows = admin.parseLatestEquipmentRows([
    {
      id: 'e1',
      code: 'U001',
      type: 'حفار',
      ownership_status: 'third_party_f',
      created_at: '2026-09-29T10:00:00Z',
    },
    { code: 'no id' },
  ])
  assert.deepEqual(plain(rows), [
    {
      id: 'e1',
      code: 'U001',
      type: 'حفار',
      owner: 'third_party_f',
      createdAt: '2026-09-29T10:00:00Z',
    },
  ])
})

test('pageTotal prefers the exact count and falls back to the rows', () => {
  assert.equal(admin.pageTotal(42, 7), 42)
  assert.equal(admin.pageTotal(0, 0), 0)
  // A 7-row mini table asks for no count.
  assert.equal(admin.pageTotal(null, 7), 7)
  assert.equal(admin.pageTotal(undefined, 3), 3)
  assert.equal(admin.pageTotal(-1, 3), 3)
})

// --- the fleet mini tables and the card jumps (migration 0107) -------------

test('every state card jumps to the mini table that lists its units', () => {
  const target = (state) => plain(admin.fleetJumpTarget(state))
  assert.deepEqual(target('inside_site'), { table: 'inside' })
  assert.deepEqual(target('workshop'), { table: 'workshop', purpose: 'all' })
  assert.deepEqual(target('workshop_maintenance'), {
    table: 'workshop',
    purpose: 'maintenance',
  })
  assert.deepEqual(target('workshop_parking'), {
    table: 'workshop',
    purpose: 'parking',
  })
  assert.deepEqual(target('workshop_unclassified'), {
    table: 'workshop',
    purpose: 'unclassified',
  })
  assert.deepEqual(target('available'), { table: 'available' })
  assert.deepEqual(target('total'), { table: 'added' })
  // Every card has a table, and every jump target is a real mini table.
  for (const state of admin.FLEET_DRILL_STATES) {
    const jump = admin.fleetJumpTarget(state)
    assert.ok(admin.FLEET_MINI_TABLES.includes(jump.table), state)
    assert.equal(
      admin.fleetMiniTableDomId(jump.table),
      `admin-home-fleet-${jump.table}`,
    )
  }
})

test('the workshop chips map to p_purpose and fail closed to "all"', () => {
  assert.deepEqual(plain(admin.WORKSHOP_PURPOSE_FILTERS), [
    'all',
    'maintenance',
    'parking',
    'unclassified',
  ])
  assert.equal(admin.workshopPurposeArgument('all'), null)
  assert.equal(admin.workshopPurposeArgument('parking'), 'parking')
  assert.equal(
    admin.normalizeWorkshopPurposeFilter('unclassified'),
    'unclassified',
  )
  assert.equal(admin.normalizeWorkshopPurposeFilter('storage'), 'all')
  assert.equal(admin.normalizeWorkshopPurposeFilter(null), 'all')
  assert.equal(admin.FLEET_MINI_ROWS, 7)
  assert.deepEqual(plain(admin.FLEET_LIST_STATES), [
    'inside_site',
    'workshop',
    'available',
  ])
})

// --- server-side pagination ------------------------------------------------

test('pages are 1-based in the interface and 0-based in SQL', () => {
  assert.equal(admin.ADMIN_HOME_PAGE_SIZE, 20)
  assert.equal(admin.pageOffset(1, 20), 0)
  assert.equal(admin.pageOffset(3, 20), 40)
  assert.equal(admin.pageOffset(2, 500), 500)
  // A stale or hand-edited page reads as the first page rather than becoming a
  // negative offset the database would have to clamp.
  assert.equal(admin.pageOffset(0, 20), 0)
  assert.equal(admin.pageOffset(-4, 20), 0)
  assert.equal(admin.pageOffset(2, 0), 1)
})

test('pageCount is never zero and clampPage keeps the table on a real page', () => {
  assert.equal(admin.pageCount(0, 20), 1)
  assert.equal(admin.pageCount(20, 20), 1)
  assert.equal(admin.pageCount(21, 20), 2)
  assert.equal(admin.pageCount(37, 20), 2)
  // Narrowing a filter while page 4 is open must not leave the table on a page
  // the database has no rows for — that reads as "there is nothing here".
  assert.equal(admin.clampPage(4, 37, 20), 2)
  assert.equal(admin.clampPage(1, 0, 20), 1)
  assert.equal(admin.clampPage(0, 100, 20), 1)
  assert.equal(admin.clampPage(3, 100, 20), 3)
})

test('parseTotalCount refuses a malformed count instead of guessing', () => {
  assert.equal(admin.parseTotalCount([{ total_count: 12 }]), 12)
  assert.equal(admin.parseTotalCount([{ total_count: -3 }]), 0)
  assert.equal(admin.parseTotalCount([{ total_count: 'many' }]), 0)
  assert.equal(admin.parseTotalCount([]), 0)
  assert.equal(admin.parseTotalCount(null), 0)
})

// --- the Excel export of the fleet mini tables ---------------------------

test('collectAllPages walks every page of the current filter', async () => {
  const all = Array.from({ length: 12 }, (_, index) => ({ id: index }))
  const asked = []
  const collected = await exporter.collectAllPages(
    async (page, pageSize) => {
      asked.push([page, pageSize])
      const from = (page - 1) * pageSize
      return { rows: all.slice(from, from + pageSize), total: all.length }
    },
    { pageSize: 5 },
  )
  assert.deepEqual(asked, [
    [1, 5],
    [2, 5],
    [3, 5],
  ])
  assert.equal(collected.rows.length, 12)
  assert.equal(collected.total, 12)
  assert.equal(collected.capped, false)
})

test('collectAllPages stops at the cap and says the export was truncated', async () => {
  const collected = await exporter.collectAllPages(
    async (page, pageSize) => ({
      rows: Array.from({ length: pageSize }, (_, index) => ({
        id: (page - 1) * pageSize + index,
      })),
      total: 10_000,
    }),
    { pageSize: 4, maxRows: 10 },
  )
  // Exactly the cap, never a page past it, and the caller is told so it can
  // show the note instead of handing over a silently short file.
  assert.equal(collected.rows.length, 10)
  assert.equal(collected.capped, true)
})

test('collectAllPages terminates when a page comes back empty', async () => {
  // A total that disagrees with the rows (a row deleted mid-walk) must not
  // loop forever.
  let calls = 0
  const collected = await exporter.collectAllPages(
    async () => {
      calls += 1
      return { rows: calls === 1 ? [{ id: 1 }] : [], total: 99 }
    },
    { pageSize: 5 },
  )
  assert.equal(calls, 2)
  assert.equal(collected.rows.length, 1)
  assert.equal(collected.capped, true)
})

const exportLabels = {
  t: (key) => key,
  lang: 'ar',
  ownerLabel: (owner) => `owner:${owner}`,
}

const fleetRow = (overrides) => ({
  id: 'a',
  code: 'A-1',
  type: 'حفار',
  owner: 'alazani',
  state: 'inside_site',
  since: '2026-09-01T07:00:00Z',
  lastMovementId: 'm1',
  lastMovementType: 'entry',
  lastMovementContext: 'site',
  workshopPurpose: null,
  companyNameAr: 'شركة',
  companyNameEn: 'Company',
  projectNameAr: 'مشروع',
  projectNameEn: 'Project',
  ...overrides,
})

const cells = (columns, row) => columns.map((column) => column.value(row))

test('the inside-sites export mirrors the table and adds type and owner', () => {
  const columns = exporter.fleetEquipmentExcelColumns('inside', exportLabels)
  assert.deepEqual(plain(columns.map((column) => column.header)), [
    'adminHomeColEquipment',
    'adminHomeColCompanyProject',
    'adminHomeColSince',
    'adminHomeColType',
    'adminHomeColOwner',
  ])
  assert.equal(columns[2].type, 'date')
  assert.deepEqual(plain(cells(columns, fleetRow({}))), [
    'A-1',
    'شركة · مشروع',
    '2026-09-01T07:00:00Z',
    'حفار',
    'owner:alazani',
  ])
  // No company and no project is an empty cell, never a placeholder dash.
  assert.equal(
    columns[1].value(
      fleetRow({
        companyNameAr: null,
        companyNameEn: null,
        projectNameAr: null,
        projectNameEn: null,
      }),
    ),
    '',
  )
})

test('the workshop export writes the purpose as words', () => {
  const columns = exporter.fleetEquipmentExcelColumns('workshop', exportLabels)
  assert.equal(columns[1].header, 'adminHomeColPurpose')
  assert.equal(
    columns[1].value(fleetRow({ workshopPurpose: 'maintenance' })),
    'adminHomeMaintenance',
  )
  assert.equal(
    columns[1].value(fleetRow({ workshopPurpose: 'parking' })),
    'adminHomeParking',
  )
  assert.equal(
    columns[1].value(fleetRow({ workshopPurpose: null })),
    'adminHomeUnclassified',
  )
})

test('the available export never leaves a blank date', () => {
  const columns = exporter.fleetEquipmentExcelColumns('available', exportLabels)
  assert.deepEqual(plain(columns.map((column) => column.header)), [
    'adminHomeColEquipment',
    'adminHomeColType',
    'adminHomeColLastExit',
    'adminHomeColOwner',
  ])
  assert.match(columns[2].value(fleetRow({})), /^\d{2}\/\d{2}\/2026$/)
  // A unit that never moved gets the explicit wording: an empty cell in a
  // spreadsheet reads as missing data rather than as a fact.
  assert.equal(
    columns[2].value(fleetRow({ since: null })),
    'adminHomeNeverMoved',
  )
})

test('the latest-entries export reads «ورشة» for a workshop entry', () => {
  const columns = exporter.latestEntriesExcelColumns(exportLabels)
  const entry = {
    id: 'm1',
    equipmentId: 'e1',
    equipmentCode: 'A-1',
    equipmentType: 'حفار',
    owner: 'alazani',
    context: 'site',
    companyNameAr: 'شركة',
    companyNameEn: 'Company',
    projectNameAr: null,
    projectNameEn: null,
    foreman: null,
    recordedAt: '2026-09-20T07:00:00Z',
  }
  assert.deepEqual(plain(cells(columns, entry)), [
    'A-1',
    'شركة',
    '',
    '2026-09-20T07:00:00Z',
    'حفار',
    'owner:alazani',
  ])
  assert.equal(columns[3].type, 'date')
  assert.equal(
    columns[1].value({ ...entry, context: 'workshop' }),
    'workshopContext',
  )
})

test('the latest-equipment export carries the added date as a date cell', () => {
  const columns = exporter.latestEquipmentExcelColumns(exportLabels)
  assert.deepEqual(plain(columns.map((column) => column.header)), [
    'adminHomeColEquipment',
    'adminHomeColType',
    'adminHomeColOwner',
    'adminHomeColAddedAt',
  ])
  assert.equal(columns[3].type, 'date')
  assert.equal(exporter.FLEET_EXPORT_FILE_NAMES.added, 'latest-equipment')
})

test('parseForemanRecentMovements groups rows and keeps database order', () => {
  const groups = admin.parseForemanRecentMovements([
    {
      supervisor_id: 's1',
      foreman_name: 'خالد',
      total_movements: 40,
      movement_rank: 1,
      movement_id: 'm1',
      equipment_id: 'e1',
      equipment_code: 'A-1',
      movement_type: 'entry',
      movement_context: 'site',
      recorded_at: '2026-09-20T07:00:00Z',
    },
    {
      supervisor_id: 's1',
      foreman_name: 'خالد',
      total_movements: 40,
      movement_rank: 2,
      movement_id: 'm2',
      equipment_id: 'e2',
      equipment_code: 'A-2',
      movement_type: 'exit',
      movement_context: 'workshop',
      recorded_at: '2026-09-19T07:00:00Z',
    },
    {
      supervisor_id: 's2',
      foreman_name: '',
      total_movements: 5,
      movement_rank: 1,
      movement_id: 'm3',
      equipment_id: 'e3',
      equipment_code: 'B-9',
      movement_type: 'bogus',
      movement_context: 'nowhere',
      recorded_at: '2026-09-18T07:00:00Z',
    },
    // A row without a supervisor is not a foreman card.
    { supervisor_id: '', movement_id: 'm4' },
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].supervisorId, 's1')
  assert.equal(groups[0].totalMovements, 40)
  assert.deepEqual(
    plain(groups[0].movements).map((row) => row.id),
    ['m1', 'm2'],
  )
  assert.equal(groups[1].name, '')
  // Unknown enum values become null rather than reaching a badge as free text.
  assert.equal(groups[1].movements[0].type, null)
  assert.equal(groups[1].movements[0].context, null)
})

test('parseOwnerStateMatrix answers both directions from one snapshot', () => {
  const matrix = admin.parseOwnerStateMatrix({
    total: 9,
    cells: [
      { owner: 'alazani', state: 'inside_site', count: 4 },
      { owner: 'alazani', state: 'available', count: 2 },
      { owner: 'third_party_f', state: 'inside_site', count: 3 },
      // Never returned by the home functions any more; if one slipped through
      // it is not listed.
      { owner: 'takween', state: 'inside_site', count: 5 },
      { owner: '', state: 'inside_site', count: 99 },
    ],
  })
  assert.equal(matrix.total, 9)
  assert.equal(matrix.count('alazani', 'inside_site'), 4)
  assert.equal(matrix.count('third_party_f', 'available'), 0)
  assert.equal(matrix.count('nobody', 'inside_site'), 0)
  assert.deepEqual(plain(matrix.owners), ['alazani', 'third_party_f'])
})

// --- chart series ----------------------------------------------------------

test('aggregateDailySeries sums days into their bucket and drops the rest', () => {
  const range = buckets.buildChartBuckets('2026-01-01', '2026-03-31', 'month')
  const points = admin.aggregateDailySeries(range, [
    { day: '2026-01-05', entries: 2, exits: 1 },
    { day: '2026-01-31', entries: 3, exits: 0 },
    { day: '2026-03-01', entries: 1, exits: 4 },
    // Outside every bucket: dropped, never folded into the nearest one.
    { day: '2025-12-31', entries: 99, exits: 99 },
  ])
  assert.deepEqual(plain(points), [
    { key: '2026-01', entries: 5, exits: 1 },
    // A month with no movements stays at zero so the x axis is continuous.
    { key: '2026-02', entries: 0, exits: 0 },
    { key: '2026-03', entries: 1, exits: 4 },
  ])
})

test('parseYearlySeries sorts and rejects malformed years', () => {
  assert.deepEqual(
    plain(
      admin.parseYearlySeries([
        { year: 2026, entries: 5, exits: 4 },
        { year: 2024, entries: 1, exits: 1 },
        { year: 'x', entries: 9, exits: 9 },
      ]),
    ),
    [
      { year: 2024, entries: 1, exits: 1 },
      { year: 2026, entries: 5, exits: 4 },
    ],
  )
  assert.deepEqual(plain(admin.parseYearlySeries(null)), [])
})

test('buildYearlySeries fills gap years and always ends at the current year', () => {
  const points = admin.buildYearlySeries(
    [
      { year: 2024, entries: 10, exits: 9 },
      { year: 2026, entries: 3, exits: 2 },
    ],
    5,
    '2026-09-22',
  )
  // 2025 had no movements at all; without the zero the line would put 2024
  // next to 2026 and lie about the distance between them.
  assert.deepEqual(plain(points), [
    { key: '2024', entries: 10, exits: 9 },
    { key: '2025', entries: 0, exits: 0 },
    { key: '2026', entries: 3, exits: 2 },
  ])
})

test('buildYearlySeries never reaches past the requested window', () => {
  const points = admin.buildYearlySeries(
    [
      // Older than the 5-year window: ignored rather than stretching the axis.
      { year: 2015, entries: 50, exits: 50 },
      { year: 2023, entries: 1, exits: 1 },
    ],
    5,
    '2026-09-22',
  )
  assert.deepEqual(
    plain(points).map((point) => point.key),
    ['2023', '2024', '2025', '2026'],
  )
})

test('buildYearlySeries shows the current year alone when there is no data', () => {
  assert.deepEqual(plain(admin.buildYearlySeries([], 5, '2026-09-22')), [
    { key: '2026', entries: 0, exits: 0 },
  ])
})

// --- granularity -----------------------------------------------------------

test('normalizeGranularity fails closed on an unknown value', () => {
  assert.equal(admin.normalizeGranularity('day'), 'day')
  assert.equal(admin.normalizeGranularity('month'), 'month')
  assert.equal(admin.normalizeGranularity('year'), 'year')
  assert.equal(admin.normalizeGranularity('week'), 'month')
  assert.equal(admin.normalizeGranularity(null), 'month')
  assert.equal(admin.normalizeGranularity(undefined), 'month')
})

test('the day view asks for exactly 30 Saudi days', () => {
  const range = admin.adminHomeFlowRange('day', '2026-09-22')
  assert.deepEqual(plain(range), { from: '2026-08-24', to: '2026-09-22' })
  assert.equal(buckets.chartRangeDays(range.from, range.to), 30)
  assert.equal(
    buckets.buildChartBuckets(range.from, range.to, 'day').length,
    30,
  )
})

test('the month view covers twelve whole months inside the 400-day cap', () => {
  const range = admin.adminHomeFlowRange('month', '2026-09-22')
  assert.deepEqual(plain(range), { from: '2025-10-01', to: '2026-09-22' })
  assert.equal(
    buckets.buildChartBuckets(range.from, range.to, 'month').length,
    12,
  )
  // The database rejects anything past 400 days; a leap year is the long case.
  for (const today of ['2026-09-22', '2028-02-29', '2028-12-31']) {
    const window = admin.adminHomeFlowRange('month', today)
    assert.ok(
      buckets.chartRangeDays(window.from, window.to) <= 400,
      `month range from ${today} is too long`,
    )
  }
})

test('a January month view still starts twelve months back', () => {
  assert.deepEqual(plain(admin.adminHomeFlowRange('month', '2026-01-03')), {
    from: '2025-02-01',
    to: '2026-01-03',
  })
})
