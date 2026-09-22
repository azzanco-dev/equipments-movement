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

test('an empty selection serializes to no URL parameter at all', () => {
  assert.equal(admin.serializeOwnerFilters([]), null)
  assert.equal(admin.serializeOwnerFilters(['bogus']), null)
  assert.equal(
    admin.serializeOwnerFilters(['takween', 'alazani']),
    'alazani,takween',
  )
})

test('the database argument is NULL for "every owner", never an empty array', () => {
  // The functions in 0095 treat NULL and an empty array the same, but only one
  // of them may leave the client, so "no filter" has one representation.
  assert.equal(admin.ownerFilterArgument([]), null)
  assert.deepEqual(plain(admin.ownerFilterArgument(['alazani'])), ['alazani'])
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

test('the availability table shows the top ten until it is expanded', () => {
  const all = Array.from({ length: 14 }, (_, index) => ({
    type: `type-${index}`,
    insideSites: 0,
    inWorkshop: 0,
    available: 0,
    total: 100 - index,
  }))
  assert.equal(admin.AVAILABILITY_TOP_TYPES, 10)
  assert.equal(admin.visibleAvailabilityRows(all, '', false).length, 10)
  assert.equal(admin.visibleAvailabilityRows(all, '', true).length, 14)
  // The search must still find a type outside the top ten, expanded or not.
  assert.deepEqual(
    admin.visibleAvailabilityRows(all, 'type-13', false).map((row) => row.type),
    ['type-13'],
  )
  assert.equal(admin.visibleAvailabilityRows(all, '  ', false).length, 10)
})

test('parseNoMovementRows keeps never-moved equipment identifiable', () => {
  const rows = admin.parseNoMovementRows([
    {
      id: 'a',
      code: 'A-1',
      type: 'حفار',
      ownership_status: 'alazani',
      last_movement_at: null,
      last_movement_type: null,
      days_since: null,
    },
    {
      id: 'b',
      code: 'B-1',
      type: 'شيول',
      ownership_status: 'takween',
      last_movement_at: '2026-01-01T00:00:00Z',
      last_movement_type: 'exit',
      last_movement_context: 'site',
      days_since: 42,
    },
    { id: '', code: 'dropped' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].lastMovementAt, null)
  assert.equal(rows[0].daysSince, null)
  assert.equal(rows[1].lastMovementType, 'exit')
  assert.equal(rows[1].lastMovementContext, 'site')
  assert.equal(rows[1].daysSince, 42)
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
