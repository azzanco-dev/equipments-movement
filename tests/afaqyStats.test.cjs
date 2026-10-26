const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «افاقي» on the admin home (owner 2026-10-26): the stats built from the
// program's fleet and the Afaqy units. Made-up ids, no network.
const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

function createLoader() {
  const cache = new Map()
  const sandbox = vm.createContext({ atob, URL, URLSearchParams })
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const file = path.join(root, 'src', 'lib', `${name}.ts`)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
    const exports = {}
    cache.set(name, exports)
    const wrapper = vm.runInContext(
      `(function (exports, require) {${output}\n})`,
      sandbox,
      { filename: file },
    )
    wrapper(exports, (requested) => {
      const match = /^@\/lib\/(.+)$/.exec(requested)
      if (match) return load(match[1])
      throw new Error(`Unexpected module: ${requested}`)
    })
    return exports
  }
  return load
}

const { buildAfaqyStats } = createLoader()('afaqyStats')
const plain = (value) => JSON.parse(JSON.stringify(value))

const NOW = Date.parse('2026-10-26T09:00:00Z')
const minutesAgo = (minutes) =>
  new Date(NOW - minutes * 60 * 1000).toISOString()
const hex = (n) => n.toString(16).padStart(24, '0')

/** A link state as the server maps it (`mapAfaqyLink`). */
function link(n, { minutes, gps = true } = {}) {
  return {
    unitId: hex(n),
    lastMessageAt: minutes === undefined ? null : minutesAgo(minutes),
    gpsValid: minutes === undefined ? null : gps,
  }
}

const eq = (n, state, linked = true) => ({
  id: `e${n}`,
  code: `A${100 + n}`,
  type: 'حفار',
  trackerUnitId: linked ? hex(n) : null,
  state,
})
/** The rows of a list, reduced to their ids. */
const ids = (rows) => rows.map((row) => row.id)

test('connected, not connected, no satellites, no signal', () => {
  const fleet = [
    eq(1, 'working'),
    eq(2, 'working'),
    eq(3, 'available'),
    eq(4, 'available'),
    eq(5, 'working'),
    eq(6, 'available', false),
    eq(7, 'working'),
  ]
  const links = [
    link(1, { minutes: 5 }), // connected
    link(2, { minutes: 30 }), // connected: exactly the limit
    link(3, { minutes: 31, gps: false }), // not connected, no satellites
    link(4), // never sent a message
    // 5 is linked but Afaqy no longer knows it
    link(7, { minutes: 2, gps: false }), // connected, no satellites
  ]
  const stats = plain(buildAfaqyStats(fleet, links, NOW))
  assert.equal(stats.fleet, 7)
  assert.equal(stats.linked, 6)
  assert.deepEqual(stats.connection, { online: 3, offline: 1, none: 2 })
  assert.equal(stats.noFix, 2)
  assert.deepEqual(stats.lists.offline, [
    { id: 'e3', code: 'A103', type: 'حفار', lastSignal: minutesAgo(31) },
  ])
  assert.deepEqual(ids(stats.lists.noFix), ['e3', 'e7'])
  assert.deepEqual(ids(stats.lists.noSignal), ['e4', 'e5'])
  assert.equal(stats.lists.noSignal[0].lastSignal, null)
  assert.deepEqual(stats.listTotals, { offline: 1, noFix: 2, noSignal: 2 })
})

test('lists are sorted by code and capped', () => {
  const fleet = Array.from({ length: 40 }, (_, i) => eq(40 - i, 'working'))
  const links = fleet.map((_, i) => link(40 - i, { minutes: 90 }))
  const stats = plain(buildAfaqyStats(fleet, links, NOW))
  assert.equal(stats.connection.offline, 40)
  assert.equal(stats.lists.offline.length, 30)
  assert.equal(stats.listTotals.offline, 40)
  assert.equal(stats.lists.offline[0].code, 'A101')
  assert.equal(stats.lists.offline[1].code, 'A102')
})

test('the link DTO: last message with or without a position, vLoc', () => {
  const { mapAfaqyLink } = createLoader()('afaqy')
  const id = hex(9)
  const dts = NOW - 38 * 60 * 1000
  // A command reply: no position, no GPS fix, still a message.
  assert.deepEqual(
    plain(
      mapAfaqyLink({
        _id: id,
        last_update: { dts, dtt: dts, vLoc: 0, vCon: 1 },
      }),
    ),
    { unitId: id, lastMessageAt: new Date(dts).toISOString(), gpsValid: false },
  )
  assert.deepEqual(
    plain(mapAfaqyLink({ _id: id, last_update: { dtt: dts, vLoc: 1 } })),
    { unitId: id, lastMessageAt: new Date(dts).toISOString(), gpsValid: true },
  )
  assert.deepEqual(plain(mapAfaqyLink({ _id: id })), {
    unitId: id,
    lastMessageAt: null,
    gpsValid: null,
  })
  assert.equal(mapAfaqyLink({ _id: 'bad' }), null)
  // The position route's DTO does not carry it.
  assert.doesNotMatch(
    read('src', 'lib', 'afaqy.ts'),
    /gpsValid\??: .*\n\s+position:/,
  )
})

test('the route: permission first, the fleet only, cached Afaqy units', () => {
  const route = read('app', 'api', 'afaqy', 'stats', 'route.ts')
  assert.match(
    route,
    /requirePermission\(request, 'equipment\.location\.view'\)/,
  )
  assert.match(route, /\.eq\('is_active', true\)/)
  assert.match(route, /\.eq\('status', 'active'\)/)
  // Owner 2026-10-26: Al-Azani and third-party F only.
  assert.match(
    route,
    /const AFAQY_STATS_OWNERS = \['alazani', 'third_party_f'\]/,
  )
  assert.match(route, /\.in\('ownership_status', AFAQY_STATS_OWNERS\)/)
  assert.match(route, /listUnitLinks\(\)/)
  assert.match(route, /buildAfaqyStats\(/)
  assert.match(route, /'Cache-Control': 'no-store'/)
})

test('the card: gated on the location permission, on the admin home', () => {
  const card = read('src', 'components', 'admin-home', 'AfaqySection.tsx')
  assert.match(
    card,
    /canViewEquipmentLocation\(permissionState, profile\?\.role\)/,
  )
  const home = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.match(
    home,
    /<AfaqySection onSelectEquipment=\{onSelectEquipment\} \/>/,
  )
})

test('the last signal in full words', () => {
  const { elapsedInWords } = createLoader()('elapsedWords')
  const at = (seconds) => new Date(NOW - seconds * 1000).toISOString()
  const day = 86_400
  assert.equal(elapsedInWords(at(60), 'ar', NOW), 'دقيقة')
  assert.equal(elapsedInWords(at(2 * 3600), 'ar', NOW), 'ساعتين')
  assert.equal(elapsedInWords(at(5 * day), 'ar', NOW), '5 ايام')
  assert.equal(elapsedInWords(at(7 * 30 * day), 'ar', NOW), '7 شهور')
  assert.equal(elapsedInWords(at(2 * 365 * day), 'ar', NOW), 'سنتين')
  assert.equal(elapsedInWords(at(12 * 365 * day), 'ar', NOW), '12 سنة')
  assert.equal(elapsedInWords(at(3 * 30 * day), 'en', NOW), '3 months')
  assert.equal(elapsedInWords(at(365 * day), 'en', NOW), '1 year')
  assert.equal(elapsedInWords('not a date', 'ar', NOW), null)
})

test('the tables: not connected, no satellites, no signal', () => {
  const card = read('src', 'components', 'admin-home', 'AfaqySection.tsx')
  assert.match(
    card,
    /\{ key: 'offline', title: 'afaqyHomeOfflineList', withSignal: true \}/,
  )
  assert.match(
    card,
    /\{ key: 'noFix', title: 'afaqyHomeNoFixList', withSignal: true \}/,
  )
  assert.match(
    card,
    /\{ key: 'noSignal', title: 'afaqyHomeNoSignalList', withSignal: false \}/,
  )
  assert.match(card, /elapsedInWords\(row\.lastSignal, lang\)/)
  const stats = read('src', 'lib', 'afaqyStats.ts')
  assert.match(stats, /export const AFAQY_ONLINE_MS = 30 \* 60 \* 1000/)
  const server = read('src', 'lib', 'server', 'afaqy.ts')
  assert.match(server, /export async function listUnitLinks\(\)/)
  assert.match(server, /const link = mapAfaqyLink\(row\)/)
})
