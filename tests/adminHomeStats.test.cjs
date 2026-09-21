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

// --- owner filter ----------------------------------------------------------

test('normalizeOwnerFilter accepts only known ownership_status values', () => {
  assert.equal(admin.normalizeOwnerFilter('alazani'), 'alazani')
  assert.equal(
    admin.normalizeOwnerFilter('external_supplier'),
    'external_supplier',
  )
  // Anything else means "every owner" rather than a filter the database would
  // reject, so a hand-edited URL can never break the page.
  assert.equal(admin.normalizeOwnerFilter('owned'), null)
  assert.equal(admin.normalizeOwnerFilter(''), null)
  assert.equal(admin.normalizeOwnerFilter(null), null)
  assert.equal(admin.normalizeOwnerFilter(undefined), null)
})

test('only Al-Azani counts as owned', () => {
  assert.equal(admin.isOwnedOwner('alazani'), true)
  assert.equal(admin.isOwnedOwner('takween'), false)
  assert.equal(admin.isOwnedOwner('third_party_f'), false)
  assert.equal(admin.isOwnedOwner('external_supplier'), false)
})

// --- fleet state -----------------------------------------------------------

test('parseFleetState reads the payload and defaults every missing count', () => {
  const state = admin.parseFleetState({
    total: 812,
    inside_sites: 498,
    in_workshop: 159,
    workshop_maintenance: 96,
    workshop_parking: 63,
    workshop_unclassified: 0,
    available: 155,
    idle_30: 120,
    idle_60: 95,
    idle_90: 81,
    never_moved: 7,
    by_owner: [
      {
        owner: 'alazani',
        total: 402,
        inside_sites: 248,
        in_workshop: 79,
        available: 75,
      },
      { owner: '', total: 9 },
    ],
    by_type: [
      {
        type: 'حفار',
        total: 60,
        inside_sites: 40,
        in_workshop: 10,
        available: 10,
      },
    ],
  })
  assert.equal(state.total, 812)
  assert.equal(state.workshopUnclassified, 0)
  assert.equal(state.neverMoved, 7)
  // A group without an identity is dropped rather than rendered as a blank row.
  assert.equal(state.byOwner.length, 1)
  assert.equal(state.byOwner[0].key, 'alazani')
  assert.equal(state.byType[0].key, 'حفار')
})

test('parseFleetState survives a malformed payload', () => {
  const zero = admin.parseFleetState(null)
  assert.equal(zero.total, 0)
  assert.deepEqual(plain(zero.byOwner), [])
  const junk = admin.parseFleetState({
    total: 'many',
    inside_sites: -4,
    by_owner: 'nope',
  })
  assert.equal(junk.total, 0)
  assert.equal(junk.insideSites, 0)
  assert.deepEqual(plain(junk.byOwner), [])
})

// --- no movement -----------------------------------------------------------

test('parseNoMovementRows keeps never-moved equipment distinguishable', () => {
  const rows = admin.parseNoMovementRows([
    {
      id: 'a',
      code: 'A101',
      type: 'حفار',
      ownership_status: 'alazani',
      last_movement_at: null,
      last_movement_type: null,
      last_movement_context: null,
      days_since: null,
    },
    {
      id: 'b',
      code: 'B7',
      type: 'قلاب',
      ownership_status: 'takween',
      last_movement_at: '2026-06-01T09:00:00Z',
      last_movement_type: 'exit',
      last_movement_context: 'site',
      days_since: 112,
    },
    // No id: not a row that can be linked to, so it is dropped.
    { id: '', code: 'X' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].lastMovementAt, null)
  assert.equal(rows[0].daysSince, null)
  assert.equal(rows[1].lastMovementType, 'exit')
  assert.equal(rows[1].daysSince, 112)
})

test('parseNoMovementRows rejects an unexpected movement type or context', () => {
  const [row] = admin.parseNoMovementRows([
    {
      id: 'a',
      code: 'A1',
      type: 'x',
      ownership_status: 'alazani',
      last_movement_at: '2026-01-01T00:00:00Z',
      last_movement_type: 'transfer',
      last_movement_context: 'yard',
      days_since: -3,
    },
  ])
  assert.equal(row.lastMovementType, null)
  assert.equal(row.lastMovementContext, null)
  // A negative day count is impossible, so it is treated as unknown.
  assert.equal(row.daysSince, null)
})

// --- availability ----------------------------------------------------------

test('rented is derived so the owned and rented halves always sum to the total', () => {
  const [row] = admin.parseAvailabilityRows([
    {
      type: 'شيول',
      total: 50,
      inside_sites: 30,
      in_workshop: 12,
      available: 8,
      owned_total: 20,
      owned_inside_sites: 14,
      owned_in_workshop: 4,
      owned_available: 2,
    },
  ])
  assert.equal(row.rented.total, 30)
  assert.equal(row.rented.insideSites, 16)
  assert.equal(row.rented.inWorkshop, 8)
  assert.equal(row.rented.available, 6)
  assert.equal(row.owned.total + row.rented.total, row.all.total)
})

test('an owned count larger than the total never produces a negative rented count', () => {
  const [row] = admin.parseAvailabilityRows([
    { type: 'x', total: 3, owned_total: 9 },
  ])
  assert.equal(row.rented.total, 0)
})

// --- entries series --------------------------------------------------------

test('aggregateDailySeries folds Saudi days into the chart buckets', () => {
  const range = buckets.buildChartBuckets('2026-01-01', '2026-03-15', 'month')
  assert.deepEqual(plain(range.map((bucket) => bucket.key)), [
    '2026-01',
    '2026-02',
    '2026-03',
  ])
  const points = admin.aggregateDailySeries(range, [
    { day: '2026-01-05', entries: 3, exits: 1 },
    { day: '2026-01-31', entries: 2, exits: 0 },
    { day: '2026-02-14', entries: 7, exits: 4 },
    // Outside the range: dropped rather than folded into the nearest bucket.
    { day: '2025-12-31', entries: 99, exits: 99 },
    { day: '2026-03-20', entries: 50, exits: 50 },
  ])
  assert.deepEqual(plain(points), [
    { key: '2026-01', entries: 5, exits: 1 },
    { key: '2026-02', entries: 7, exits: 4 },
    // A bucket with no movements stays at zero so the line keeps its x axis.
    { key: '2026-03', entries: 0, exits: 0 },
  ])
})

test('aggregateDailySeries sums duplicate days and matches a daily range', () => {
  const range = buckets.buildChartBuckets('2026-05-01', '2026-05-03', 'day')
  const points = admin.aggregateDailySeries(range, [
    { day: '2026-05-01', entries: 1, exits: 0 },
    { day: '2026-05-01', entries: 2, exits: 3 },
    { day: '2026-05-03', entries: 4, exits: 4 },
  ])
  assert.deepEqual(plain(points), [
    { key: '2026-05-01', entries: 3, exits: 3 },
    { key: '2026-05-02', entries: 0, exits: 0 },
    { key: '2026-05-03', entries: 4, exits: 4 },
  ])
})

test('parseDailySeries drops rows without a usable day', () => {
  const rows = admin.parseDailySeries([
    { day: '2026-05-01T00:00:00', entries: 2, exits: 1 },
    { day: 'not-a-day', entries: 5, exits: 5 },
    { entries: 5 },
  ])
  assert.deepEqual(plain(rows), [{ day: '2026-05-01', entries: 2, exits: 1 }])
})

// --- owner x state matrix --------------------------------------------------

test('parseOwnerStateMatrix answers both drill directions from one payload', () => {
  const matrix = admin.parseOwnerStateMatrix({
    total: 12,
    cells: [
      { owner: 'alazani', state: 'inside_site', count: 5 },
      { owner: 'alazani', state: 'available', count: 2 },
      { owner: 'takween', state: 'inside_site', count: 4 },
      { owner: 'takween', state: 'workshop_parking', count: 1 },
      { owner: '', state: 'inside_site', count: 99 },
    ],
  })
  assert.equal(matrix.total, 12)
  // owner -> states
  assert.equal(matrix.count('alazani', 'inside_site'), 5)
  assert.equal(matrix.count('alazani', 'workshop_parking'), 0)
  // state -> owners, from the same snapshot
  assert.equal(matrix.count('takween', 'inside_site'), 4)
  // Only owners that actually have units, in the canonical order.
  assert.deepEqual(plain(matrix.owners), ['alazani', 'takween'])
})

// --- foreman activity ------------------------------------------------------

test('parseForemanActivity keeps a foreman whose name the caller cannot read', () => {
  const rows = admin.parseForemanActivity([
    {
      supervisor_id: '11111111-1111-1111-1111-111111111111',
      foreman_name: null,
      entries: 9,
      exits: 7,
      open_visits: 2,
    },
    { supervisor_id: '', foreman_name: 'x' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '')
  assert.equal(rows[0].entries, 9)
  assert.equal(rows[0].openVisits, 2)
})

// --- period presets --------------------------------------------------------

test('this year runs from 1 January in Saudi time to today', () => {
  assert.deepEqual(plain(admin.adminHomePeriodKeys('year', '2026-09-21')), {
    from: '2026-01-01',
    to: '2026-09-21',
  })
  // Early January is still a valid single-day range rather than an empty one.
  assert.deepEqual(plain(admin.adminHomePeriodKeys('year', '2026-01-01')), {
    from: '2026-01-01',
    to: '2026-01-01',
  })
})

test('last 12 months stays inside the 400-day cap the database enforces', () => {
  const range = admin.adminHomePeriodKeys('last12', '2026-09-21')
  assert.deepEqual(plain(range), { from: '2025-09-22', to: '2026-09-21' })
  const days =
    (Date.parse(`${range.to}T00:00:00Z`) -
      Date.parse(`${range.from}T00:00:00Z`)) /
      86400000 +
    1
  assert.ok(days <= 400, `range is ${days} days`)
  // A leap year is the long case and must still fit.
  const leap = admin.adminHomePeriodKeys('last12', '2028-03-01')
  const leapDays =
    (Date.parse(`${leap.to}T00:00:00Z`) -
      Date.parse(`${leap.from}T00:00:00Z`)) /
      86400000 +
    1
  assert.ok(leapDays <= 400, `leap range is ${leapDays} days`)
})

test('isAdminHomePeriod fails closed on an unknown period', () => {
  assert.equal(admin.isAdminHomePeriod('year'), true)
  assert.equal(admin.isAdminHomePeriod('last12'), true)
  assert.equal(admin.isAdminHomePeriod('week'), false)
  assert.equal(admin.isAdminHomePeriod(null), false)
})
