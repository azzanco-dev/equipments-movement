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
function link(n, { minutes, satellites = 9 } = {}) {
  return {
    unitId: hex(n),
    lastMessageAt: minutes === undefined ? null : minutesAgo(minutes),
    satellites: minutes === undefined ? null : satellites,
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
    link(2, { minutes: 24 * 60 }), // connected: exactly the limit
    link(3, { minutes: 24 * 60 + 1, satellites: 0 }), // not connected
    link(4), // never sent a message
    // 5 is linked but Afaqy no longer knows it
    link(7, { minutes: 2, satellites: null }), // connected, count unknown
  ]
  const stats = plain(buildAfaqyStats(fleet, links, NOW))
  assert.equal(stats.fleet, 7)
  assert.equal(stats.linked, 6)
  assert.deepEqual(stats.connection, { online: 3, offline: 1, none: 2 })
  assert.equal(stats.noFix, 2)
  assert.deepEqual(stats.lists.offline, [
    {
      id: 'e3',
      code: 'A103',
      type: 'حفار',
      lastSignal: minutesAgo(24 * 60 + 1),
    },
  ])
  assert.deepEqual(ids(stats.lists.noFix), ['e3', 'e7'])
  assert.deepEqual(ids(stats.lists.noSignal), ['e4', 'e5'])
  assert.equal(stats.lists.noSignal[0].lastSignal, null)
  assert.deepEqual(stats.listTotals, { offline: 1, noFix: 2, noSignal: 2 })
})

test('lists are sorted by code and capped', () => {
  const fleet = Array.from({ length: 40 }, (_, i) => eq(40 - i, 'working'))
  const links = fleet.map((_, i) => link(40 - i, { minutes: 2 * 24 * 60 }))
  const stats = plain(buildAfaqyStats(fleet, links, NOW))
  assert.equal(stats.connection.offline, 40)
  assert.equal(stats.lists.offline.length, 30)
  assert.equal(stats.listTotals.offline, 40)
  assert.equal(stats.lists.offline[0].code, 'A101')
  assert.equal(stats.lists.offline[1].code, 'A102')
})

test('the link DTO: last message with or without a position, satellites', () => {
  const { mapAfaqyLink } = createLoader()('afaqy')
  const id = hex(9)
  const dts = NOW - 38 * 60 * 1000
  const at = new Date(dts).toISOString()
  // A025: the last message had no fix (vLoc 0) yet 12 satellites are known.
  assert.deepEqual(
    plain(
      mapAfaqyLink({
        _id: id,
        last_update: { dts, vLoc: 0, chPrams: { sat: { v: 12, cdt: dts } } },
      }),
    ),
    { unitId: id, lastMessageAt: at, satellites: 12 },
  )
  // Falls back to prms.sat; the device time when there is no server time.
  assert.deepEqual(
    plain(
      mapAfaqyLink({ _id: id, last_update: { dtt: dts, prms: { sat: 0 } } }),
    ),
    { unitId: id, lastMessageAt: at, satellites: 0 },
  )
  assert.deepEqual(plain(mapAfaqyLink({ _id: id })), {
    unitId: id,
    lastMessageAt: null,
    satellites: null,
  })
  assert.equal(mapAfaqyLink({ _id: 'bad' }), null)
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
  for (const [key, title, description, withSignal] of [
    ['offline', 'afaqyHomeOfflineList', 'afaqyHomeOfflineListDesc', true],
    ['noFix', 'afaqyHomeNoFixList', 'afaqyHomeNoFixListDesc', true],
    ['noSignal', 'afaqyHomeNoSignalList', 'afaqyHomeNoSignalListDesc', false],
  ])
    assert.match(
      card,
      new RegExp(
        `key: '${key}',\\s+title: '${title}',\\s+description: '${description}',\\s+withSignal: ${withSignal},`,
      ),
      key,
    )
  assert.match(card, /elapsedInWords\(row\.lastSignal, lang\)/)
  const stats = read('src', 'lib', 'afaqyStats.ts')
  // Owner 2026-10-26: «خليها 24 ساعة».
  assert.match(stats, /export const AFAQY_ONLINE_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(card, /description: 'afaqyHomeOfflineListDesc'/)
  const server = read('src', 'lib', 'server', 'afaqy.ts')
  assert.match(server, /export async function listUnitLinks\(\)/)
  assert.match(server, /const link = mapAfaqyLink\(row\)/)
})
