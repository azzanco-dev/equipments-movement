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

function unit(n, { minutes, speed = 0, ignition = null } = {}) {
  return {
    unitId: hex(n),
    name: `U${n}`,
    position:
      minutes === undefined
        ? null
        : {
            lat: 24.7,
            lng: 46.7,
            speedKmh: speed,
            heading: 0,
            ignitionOn: ignition,
            deviceTime: minutesAgo(minutes),
            serverTime: minutesAgo(minutes),
          },
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

test('coverage and signal age', () => {
  const fleet = [
    eq(1, 'working'),
    eq(2, 'working'),
    eq(3, 'available'),
    eq(4, 'available'),
    eq(5, 'working'),
    eq(6, 'available', false),
  ]
  const units = [
    unit(1, { minutes: 5 }),
    unit(2, { minutes: 120 }),
    unit(3, { minutes: 60 * 30 }),
    unit(4), // never sent a position
    // 5 is linked but Afaqy no longer knows it
  ]
  const stats = plain(buildAfaqyStats(fleet, units, NOW))
  assert.equal(stats.fleet, 6)
  assert.equal(stats.linked, 5)
  assert.deepEqual(stats.signal, { recent: 1, stale: 1, silent: 1, none: 2 })
  assert.deepEqual(stats.lists.silent, [
    {
      id: 'e3',
      code: 'A103',
      type: 'حفار',
      lastSignal: minutesAgo(60 * 30),
      speedKmh: 0,
    },
  ])
  // The linked units with no position, or unknown to Afaqy.
  assert.deepEqual(ids(stats.lists.noSignal), ['e4', 'e5'])
  assert.equal(stats.lists.noSignal[0].lastSignal, null)
  assert.equal(stats.listTotals.noSignal, 2)
})

test('what the recently heard units do now, and the mismatches', () => {
  const fleet = [
    eq(1, 'working'),
    eq(2, 'maintenance'),
    eq(3, 'available'),
    eq(4, 'out_of_service'),
    eq(5, 'available'),
    eq(6, 'working'),
  ]
  const units = [
    unit(1, { minutes: 1, speed: 30, ignition: true }), // moving on site
    unit(2, { minutes: 1, speed: 0, ignition: true }), // idling in the workshop
    unit(3, { minutes: 1, speed: 40, ignition: true }), // out, moving
    unit(4, { minutes: 1, speed: 0, ignition: false }), // workshop, off
    unit(5, { minutes: 1, speed: 3, ignition: null }), // slow, unknown: off
    unit(6, { minutes: 90, speed: 50, ignition: true }), // stale: not «now»
  ]
  const stats = plain(buildAfaqyStats(fleet, units, NOW))
  assert.deepEqual(stats.now, { moving: 2, idling: 1, off: 2 })
  assert.deepEqual(ids(stats.lists.workshopRunning), ['e2'])
  assert.deepEqual(ids(stats.lists.availableMoving), ['e3'])
  assert.equal(stats.lists.availableMoving[0].speedKmh, 40)
  assert.deepEqual(ids(stats.lists.idling), ['e2'])
})

test('lists are sorted by code and capped', () => {
  const fleet = Array.from({ length: 40 }, (_, i) => eq(40 - i, 'working'))
  const units = fleet.map((_, i) =>
    unit(40 - i, { minutes: 1, speed: 0, ignition: true }),
  )
  const stats = plain(buildAfaqyStats(fleet, units, NOW))
  assert.equal(stats.now.idling, 40)
  assert.equal(stats.lists.idling.length, 30)
  assert.equal(stats.listTotals.idling, 40)
  assert.equal(stats.lists.idling[0].code, 'A101')
  assert.equal(stats.lists.idling[1].code, 'A102')
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
  assert.match(route, /listUnits\(\)/)
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
