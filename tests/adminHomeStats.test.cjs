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

test('normalizeOwnerFilters accepts only known ownership_status values', () => {
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
})

test('owner filters are deduplicated and canonically ordered', () => {
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

test('the database argument is NULL for "every owner", never an empty array', () => {
  // The functions in 0095/0101 treat NULL and an empty array the same, but only
  // one of them may leave the client, so "no filter" has one representation.
  assert.equal(admin.ownerFilterArgument([]), null)
  assert.equal(admin.ownerFilterArgument(null), null)
  assert.equal(admin.ownerFilterArgument(undefined), null)
  assert.deepEqual(plain(admin.ownerFilterArgument(['alazani'])), ['alazani'])
  // Sections hold plain strings, so the argument is validated on its way out:
  // an unknown value is dropped rather than sent to a function that would
  // reject the whole request, and a selection of nothing but unknown values
  // degrades to "every owner".
  assert.deepEqual(plain(admin.ownerFilterArgument(['takween', 'bogus'])), [
    'takween',
  ])
  assert.equal(admin.ownerFilterArgument(['bogus']), null)
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

test('parseOutsideEquipmentPage keeps never-moved equipment identifiable', () => {
  const page = admin.parseOutsideEquipmentPage([
    {
      total_count: 2,
      id: 'b',
      code: 'B-1',
      type: 'شيول',
      ownership_status: 'takween',
      last_movement_at: '2026-01-01T00:00:00Z',
      last_movement_type: 'exit',
      last_movement_context: 'site',
    },
    {
      total_count: 2,
      id: 'a',
      code: 'A-1',
      type: 'حفار',
      ownership_status: 'alazani',
      last_movement_at: null,
      last_movement_type: null,
    },
    { total_count: 2, id: '', code: 'dropped' },
  ])
  assert.equal(page.total, 2)
  assert.equal(page.rows.length, 2)
  assert.equal(page.rows[0].lastMovementType, 'exit')
  assert.equal(page.rows[0].lastMovementContext, 'site')
  // The never-moved row keeps a null date rather than an empty string, so the
  // table can tell "no movements" from a date it failed to read.
  assert.equal(page.rows[1].lastMovementAt, null)
  assert.equal(page.rows[1].lastMovementType, null)
  // The idle-days column is gone with the threshold (owner review 2026-09-22).
  assert.equal('daysSince' in page.rows[0], false)
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

// --- the Excel export of the outside table ---------------------------------

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

test('the export sheet mirrors the table and never leaves a blank date', async () => {
  const sheet = exporter.outsideEquipmentSheetData(
    [
      {
        id: 'a',
        code: 'A-1',
        type: 'حفار',
        owner: 'alazani',
        lastMovementAt: '2026-09-01T07:00:00Z',
        lastMovementType: 'exit',
        lastMovementContext: 'site',
      },
      {
        id: 'b',
        code: 'B-1',
        type: 'شيول',
        owner: 'takween',
        lastMovementAt: null,
        lastMovementType: null,
        lastMovementContext: null,
      },
    ],
    { t: (key) => key, ownerLabel: (owner) => `owner:${owner}` },
  )
  assert.deepEqual(plain(sheet.headers), [
    'adminHomeColEquipment',
    'adminHomeColType',
    'adminHomeColOwner',
    'adminHomeColLastMovement',
  ])
  assert.equal(sheet.body.length, 2)
  assert.deepEqual(plain(sheet.body[0].slice(0, 3)), [
    'A-1',
    'حفار',
    'owner:alazani',
  ])
  assert.match(sheet.body[0][3], /^\d{2}\/\d{2}\/2026$/)
  // A unit that never moved gets the explicit wording: an empty cell in a
  // spreadsheet reads as missing data rather than as a fact.
  assert.equal(sheet.body[1][3], 'adminHomeNeverMoved')
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
      { owner: 'takween', state: 'inside_site', count: 3 },
      { owner: '', state: 'inside_site', count: 99 },
    ],
  })
  assert.equal(matrix.total, 9)
  assert.equal(matrix.count('alazani', 'inside_site'), 4)
  assert.equal(matrix.count('takween', 'available'), 0)
  assert.equal(matrix.count('nobody', 'inside_site'), 0)
  assert.deepEqual(plain(matrix.owners), ['alazani', 'takween'])
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
