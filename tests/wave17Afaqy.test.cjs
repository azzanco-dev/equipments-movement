const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards wave 17: the Afaqy AVL tracker link (migration 0122, the server
// client, the admin routes, the sync matching and the admin UI pieces).
// Nothing here reaches the network: every Afaqy answer is a fixture shaped
// like the read-only probe of 2026-10-08, with made-up ids.
const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

// Loads a src/lib module (and its `@/lib/...` imports) into one sandbox.
function createLoader(globals = {}) {
  const cache = new Map()
  const sandbox = vm.createContext({ atob, URL, URLSearchParams, ...globals })
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

// Cross-realm objects (vm) are compared by value.
const plain = (value) => JSON.parse(JSON.stringify(value))

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaa1'
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbb2'
const ID_C = 'ccccccccccccccccccccccc3'
const ID_D = 'ddddddddddddddddddddddd4'

const NOW = Date.UTC(2026, 9, 8, 9, 0, 0)

/** A raw unit shaped like the probe output. */
function rawUnit(id, name, overrides = {}) {
  return {
    _id: id,
    name,
    imei: '359632100000001',
    icon: 'x',
    driver_id: null,
    updated_at: '2026-10-01 10:00:00',
    last_update: {
      dtt: NOW - 120000,
      dts: NOW - 60000,
      spd: 42,
      ang: 270,
      alt: 600,
      acc: 1,
      lastloc: { lat: 24.7136, lng: 46.6753 },
      lat: 24.7136,
      lng: 46.6753,
      prms: { odometer: 123456, sat: 11, hdop: 0.8 },
      sensors_chDate: {
        acc: [
          {
            sensorValue: {
              sensorId: 's',
              name: 'ACC',
              value: 1,
              representation: 'ON',
            },
            changeDate: NOW - 600000,
          },
        ],
      },
      ...overrides,
    },
  }
}

// --- names -------------------------------------------------------------------

test('a unit name splits into the code of the first parentheses and the plate', () => {
  const { parseUnitName } = createLoader()('afaqy')
  for (const [name, code, plate] of [
    ['(A055) 8631 URA', 'A055', '8631 URA'],
    ['  (a055 )  8631   URA ', 'A055', '8631 URA'],
    ['(A055)8631 URA', 'A055', '8631 URA'],
    ['(A055)', 'A055', null],
    ['(A055) (A056) 8631 URA', 'A055', '8631 URA'],
    ['(A055 -2) 8631 URA', 'A055 -2', '8631 URA'],
    ['(TK12) 1234567890', 'TK12', '1234567890'],
    ['() 8631 URA', null, '8631 URA'],
    ['8631 URA', null, '8631 URA'],
    ['', null, null],
    [null, null, null],
    [42, null, null],
  ])
    assert.deepEqual(
      plain(parseUnitName(name)),
      { code, plate },
      JSON.stringify(name),
    )
})

// --- the DTO -----------------------------------------------------------------

test('a raw unit maps to the small DTO', () => {
  const { mapAfaqyUnit, toUnitListItem } = createLoader()('afaqy')
  const unit = mapAfaqyUnit(rawUnit(ID_A, ' (A055) 8631 URA '))
  assert.deepEqual(plain(unit), {
    unitId: ID_A,
    name: '(A055) 8631 URA',
    imei: '359632100000001',
    position: {
      lat: 24.7136,
      lng: 46.6753,
      speedKmh: 42,
      heading: 270,
      ignitionOn: true,
      deviceTime: new Date(NOW - 120000).toISOString(),
      serverTime: new Date(NOW - 60000).toISOString(),
      satellites: 11,
      odometer: 123456,
    },
  })
  // Nothing else of the raw unit leaves the server.
  assert.deepEqual(Object.keys(unit).sort(), [
    'imei',
    'name',
    'position',
    'unitId',
  ])
  assert.deepEqual(plain(toUnitListItem(unit)), {
    unitId: ID_A,
    name: '(A055) 8631 URA',
    code: 'A055',
    plate: '8631 URA',
    imei: '359632100000001',
    hasPosition: true,
    lastSeen: new Date(NOW - 60000).toISOString(),
  })
})

test('missing or broken readings are handled, never thrown', () => {
  const { mapAfaqyUnit } = createLoader()('afaqy')
  const noUpdate = rawUnit(ID_A, '(A1)')
  delete noUpdate.last_update
  assert.equal(mapAfaqyUnit(noUpdate).position, null)

  const noLoc = rawUnit(ID_A, '(A1)')
  delete noLoc.last_update.lastloc
  // Falls back to the top-level lat/lng.
  assert.equal(mapAfaqyUnit(noLoc).position.lat, 24.7136)
  delete noLoc.last_update.lat
  assert.equal(mapAfaqyUnit(noLoc).position, null)

  for (const lastloc of [
    { lat: 0, lng: 0 },
    { lat: 91, lng: 46 },
    { lat: 'x', lng: 46 },
    null,
  ]) {
    const unit = rawUnit(ID_A, '(A1)', { lastloc, lat: undefined })
    assert.equal(mapAfaqyUnit(unit).position, null, JSON.stringify(lastloc))
  }

  // Ignition from the sensor when `acc` is absent; unknown when neither.
  const sensorOnly = rawUnit(ID_A, '(A1)', { acc: undefined })
  sensorOnly.last_update.sensors_chDate.acc[0].sensorValue.value = 0
  assert.equal(mapAfaqyUnit(sensorOnly).position.ignitionOn, false)
  const noIgnition = rawUnit(ID_A, '(A1)', {
    acc: undefined,
    sensors_chDate: {},
  })
  assert.equal(mapAfaqyUnit(noIgnition).position.ignitionOn, null)

  // An impossible device clock is no time; bad numbers are null.
  const badClock = rawUnit(ID_A, '(A1)', { dtt: 5, dts: 'x', spd: -1 })
  const position = mapAfaqyUnit(badClock).position
  assert.equal(position.deviceTime, null)
  assert.equal(position.serverTime, null)
  assert.equal(position.speedKmh, null)

  // Without a valid id the unit is dropped.
  for (const bad of [null, {}, { _id: 'short' }, { _id: 7 }, 'x'])
    assert.equal(mapAfaqyUnit(bad), null)
  // An odd IMEI is left out.
  const odd = rawUnit(ID_A, '(A1)')
  odd.imei = 'a b'
  assert.equal('imei' in mapAfaqyUnit(odd), false)
})

test('staleness, Saudi time and the Google Maps link', () => {
  const { mapAfaqyUnit, isPositionStale, formatSaudiDateTime, googleMapsUrl } =
    createLoader()('afaqy')
  const fresh = mapAfaqyUnit(rawUnit(ID_A, '(A1)')).position
  assert.equal(isPositionStale(fresh, NOW), false)
  assert.equal(isPositionStale(fresh, NOW + 61 * 60 * 1000), true)
  const noTime = { ...plain(fresh), deviceTime: null, serverTime: null }
  assert.equal(isPositionStale(noTime, NOW), true)

  // 09:00 UTC is 12:00 PM in Riyadh, whatever the machine timezone.
  assert.equal(
    formatSaudiDateTime(new Date(NOW).toISOString()),
    '08/10/2026 12:00 PM',
  )
  assert.equal(
    formatSaudiDateTime('2026-10-08T21:05:00.000Z'),
    '09/10/2026 12:05 AM',
  )
  assert.equal(formatSaudiDateTime('nope'), '')
  assert.equal(
    googleMapsUrl(24.7136, 46.6753),
    'https://www.google.com/maps?q=24.713600,46.675300',
  )
})

// --- the token lifetime ------------------------------------------------------

function jwt(claims) {
  const part = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.signature`
}

test('the expire text is Saudi time and the JWT exp is read', () => {
  const { parseAfaqyExpire, jwtExpiryMs, tokenRefreshAt } =
    createLoader()('afaqy')
  // 2026-11-07 15:00:00 in Riyadh is 12:00 UTC.
  assert.equal(
    parseAfaqyExpire('2026-11-07 15:00:00'),
    Date.UTC(2026, 10, 7, 12, 0, 0),
  )
  for (const bad of [null, 5, '', '2026-11-07', '07/11/2026 15:00:00'])
    assert.equal(parseAfaqyExpire(bad), null, String(bad))

  const exp = Math.floor(NOW / 1000) + 30 * 24 * 3600
  assert.equal(jwtExpiryMs(jwt({ exp, sub: 'x' })), exp * 1000)
  for (const bad of [null, 'abc', 'a.b.c', 'a.###.c', jwt({ sub: 'x' })])
    assert.equal(jwtExpiryMs(bad), null)

  const minute = 60 * 1000
  // A 30-day token is reused for at most 12 hours.
  assert.equal(
    tokenRefreshAt(jwt({ exp }), '2026-11-07 15:00:00', NOW),
    NOW + 12 * 60 * minute,
  )
  // Five minutes before the EARLIEST known expiry.
  const soon = Math.floor((NOW + 30 * minute) / 1000)
  assert.equal(
    tokenRefreshAt(jwt({ exp: soon }), '2026-11-07 15:00:00', NOW),
    soon * 1000 - 5 * minute,
  )
  // Nothing readable: one hour (minus the margin).
  assert.equal(tokenRefreshAt('x', null, NOW), NOW + 55 * minute)
  // Already (almost) expired: still at least a minute.
  assert.equal(
    tokenRefreshAt(jwt({ exp: Math.floor(NOW / 1000) }), null, NOW),
    NOW + minute,
  )
})

// --- the sync plan -----------------------------------------------------------

function equipmentRow(id, code, unitId = null, extra = {}) {
  return {
    id,
    code,
    tracker_unit_id: unitId,
    tracker_unit_name: unitId ? `(${code})` : null,
    is_active: true,
    ...extra,
  }
}

test('units match current codes first, then previous codes', () => {
  const { planTrackerSync } = createLoader()('afaqySync')
  const plan = plain(
    planTrackerSync({
      units: [
        { unitId: ID_A, name: '(a055) 8631 URA' },
        { unitId: ID_B, name: '(A115) 1111 AAA' },
        { unitId: ID_C, name: '(Z999) 2222 BBB' },
        { unitId: ID_D, name: 'no code here' },
      ],
      equipment: [
        equipmentRow('e1', ' A055 '),
        equipmentRow('e2', 'F84'),
        equipmentRow('e3', 'B7'),
      ],
      // A115 was renamed to F84 (the unit still carries the old label).
      codeChanges: [{ equipment_id: 'e2', old_code: 'a115' }],
    }),
  )
  assert.deepEqual(plan.sets, [
    {
      equipmentId: 'e1',
      unitId: ID_A,
      unitName: '(a055) 8631 URA',
      replacing: false,
    },
    {
      equipmentId: 'e2',
      unitId: ID_B,
      unitName: '(A115) 1111 AAA',
      replacing: false,
    },
  ])
  assert.deepEqual(plan.clears, [])
  assert.deepEqual(plan.unmatchedUnits, [
    { unitId: ID_C, name: '(Z999) 2222 BBB', code: 'Z999' },
    { unitId: ID_D, name: 'no code here', code: null },
  ])
  assert.deepEqual(plan.conflicts, [])
})

test('a current code wins over another unit previous code', () => {
  const { planTrackerSync } = createLoader()('afaqySync')
  const plan = plain(
    planTrackerSync({
      units: [{ unitId: ID_A, name: '(A115)' }],
      equipment: [equipmentRow('e1', 'A115'), equipmentRow('e2', 'F84')],
      codeChanges: [{ equipment_id: 'e2', old_code: 'A115' }],
    }),
  )
  assert.deepEqual(
    plan.sets.map((set) => set.equipmentId),
    ['e1'],
  )
})

test('existing links are kept and conflicts are reported, not written', () => {
  const { planTrackerSync } = createLoader()('afaqySync')
  const input = {
    units: [
      { unitId: ID_A, name: '(A1) renamed' }, // already linked to e1
      { unitId: ID_B, name: '(A2)' }, // e2 is linked to ID_D (manual)
      { unitId: ID_C, name: '(A3)' }, // ID_C is linked to e4 (manual)
      { unitId: ID_D, name: '(DUP)' }, // two equipment share the code
      { unitId: 'eeeeeeeeeeeeeeeeeeeeeee5', name: '(A6)' },
      { unitId: 'fffffffffffffffffffffff6', name: '(A6) second' },
    ],
    equipment: [
      equipmentRow('e1', 'A1', ID_A),
      equipmentRow('e2', 'A2', ID_D),
      equipmentRow('e3', 'A3'),
      equipmentRow('e4', 'X4', ID_C),
      equipmentRow('e5', 'dup'),
      equipmentRow('e6', 'DUP'),
      equipmentRow('e7', 'A6'),
    ],
    codeChanges: [],
  }
  const plan = plain(planTrackerSync(input))
  assert.equal(plan.alreadyLinked, 1)
  assert.deepEqual(plan.renames, [
    { equipmentId: 'e1', unitName: '(A1) renamed' },
  ])
  assert.deepEqual(plan.sets, [])
  assert.deepEqual(plan.clears, [])
  const byUnit = (a, b) => a[1].localeCompare(b[1])
  assert.deepEqual(
    plan.conflicts
      .map((conflict) => [
        conflict.reason,
        conflict.unitId,
        conflict.equipment.map((row) => row.id),
      ])
      .sort(byUnit),
    [
      ['ambiguous_code', ID_D, ['e5', 'e6']],
      ['equipment_linked_to_other_unit', ID_B, ['e2']],
      ['unit_linked_elsewhere', ID_C, ['e4', 'e3']],
      ['several_units', 'eeeeeeeeeeeeeeeeeeeeeee5', ['e7']],
      ['several_units', 'fffffffffffffffffffffff6', ['e7']],
    ].sort(byUnit),
  )

  // force: the old links are cleared first, then the matched ones written.
  const forced = plain(planTrackerSync({ ...input, force: true }))
  assert.deepEqual([...forced.clears].sort(), ['e2', 'e4'])
  assert.deepEqual(
    forced.sets.map((set) => [set.equipmentId, set.unitId, set.replacing]),
    [
      ['e2', ID_B, true],
      ['e3', ID_C, true],
    ],
  )
  // Ambiguous codes and several units stay conflicts even with force.
  assert.deepEqual(forced.conflicts.map((conflict) => conflict.reason).sort(), [
    'ambiguous_code',
    'several_units',
    'several_units',
  ])
})

test('the report counts the writes and lists equipment left without a unit', () => {
  const { planTrackerSync, summarizeTrackerSync } = createLoader()('afaqySync')
  const equipment = [
    equipmentRow('e1', 'A1'),
    equipmentRow('e2', 'A2'),
    equipmentRow('e3', 'A10'),
    equipmentRow('e4', 'A9'),
    equipmentRow('e5', 'SOLD', null, { is_active: false }),
  ]
  const plan = planTrackerSync({
    units: [
      { unitId: ID_A, name: '(A1)' },
      { unitId: ID_B, name: '(A2)' },
    ],
    equipment,
    codeChanges: [],
  })
  const report = plain(
    summarizeTrackerSync({
      plan,
      equipment,
      unitsTotal: 2,
      failedClears: new Set(),
      failedSets: new Set(['e2']),
    }),
  )
  assert.equal(report.linked, 1)
  assert.equal(report.relinked, 0)
  assert.equal(report.failed, 1)
  assert.equal(report.unitsTotal, 2)
  assert.deepEqual(
    report.conflicts.map((conflict) => [conflict.reason, conflict.code]),
    [['update_failed', 'A2']],
  )
  // Active only, natural code order, the failed one included.
  assert.deepEqual(
    report.equipmentWithoutUnit.map((row) => row.code),
    ['A2', 'A9', 'A10'],
  )
  assert.equal(report.equipmentWithoutUnitTotal, 3)
})

// --- the server client -------------------------------------------------------

const USER = 'unit-test-user'
const PASSWORD = 'unit-test-password-value'

function afaqy({ env, respond } = {}) {
  const calls = []
  const logs = []
  const record = (...args) => logs.push(JSON.stringify(args))
  const clock = { value: NOW }
  class FakeDate extends Date {
    static now() {
      return clock.value
    }
  }
  const load = createLoader({
    process: {
      env: env ?? { AFAQY_USERNAME: USER, AFAQY_PASSWORD: PASSWORD },
    },
    console: { error: record, warn: record, log: record, info: record },
    AbortController,
    clearTimeout,
    setTimeout,
    Date: FakeDate,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, init, body })
      return respond(url, body, init)
    },
  })
  return { load, calls, logs, clock }
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const TOKEN = jwt({ exp: Math.floor(NOW / 1000) + 30 * 24 * 3600 })

function provider(units, { failLists = 0 } = {}) {
  let listFailures = failLists
  return (url, body, init) => {
    if (url.endsWith('/auth/login'))
      return json({
        message: 'success',
        status_code: 200,
        data: { token: TOKEN, expire: '2026-11-07 15:00:00', user: {} },
        extra: [],
      })
    if (url.endsWith('/units/lists')) {
      if (listFailures > 0) {
        listFailures -= 1
        return json({ message: 'Unauthenticated.' }, 401)
      }
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
      const { offset, limit, filters } = body.data
      const pool = filters?.id
        ? units.filter((unit) => filters.id.value.includes(unit._id))
        : units
      return json({
        message: 'success',
        status_code: 200,
        data: pool.slice(offset, offset + limit),
        extra: [],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
}

test('the client logs in once, pages through the units and maps them', async () => {
  const units = Array.from({ length: 501 }, (_, index) =>
    rawUnit(index.toString(16).padStart(24, '0'), `(A${index})`),
  )
  const { load, calls, logs } = afaqy({ respond: provider(units) })
  const { fetchAllUnits } = load('server/afaqy')
  const result = await fetchAllUnits()
  assert.equal(result.ok, true)
  assert.equal(result.value.length, 501)
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ['/auth/login', '/units/lists', '/units/lists'],
  )
  assert.equal(new URL(calls[0].url).origin, 'https://api.afaqy.pro')
  assert.deepEqual(plain(calls[0].body), {
    data: { username: USER, password: PASSWORD },
  })
  assert.deepEqual(plain(calls[1].body.data), {
    offset: 0,
    limit: 500,
    simplify: 0,
    projection: ['basic', 'last_update'],
  })
  assert.equal(calls[2].body.data.offset, 500)
  for (const call of calls) {
    assert.equal(call.init.method, 'POST')
    assert.equal(call.init.cache, 'no-store')
    assert.ok(call.init.signal)
  }
  assert.deepEqual(logs, [])
})

test('a 401 renews the token once; failures are short codes and never logged', async () => {
  const units = [rawUnit(ID_A, '(A1)')]
  const renewed = afaqy({ respond: provider(units, { failLists: 1 }) })
  const ok = await renewed.load('server/afaqy').fetchAllUnits()
  assert.equal(ok.ok, true)
  assert.equal(
    renewed.calls.filter((call) => call.url.endsWith('/auth/login')).length,
    2,
  )

  for (const [respond, code] of [
    [() => json({}, 401), 'auth_failed'],
    [() => json({ data: { token: 'x' } }), 'provider_error'],
    [() => json({}, 500), 'http_error'],
    [
      () => {
        throw new Error(`connect failed ${PASSWORD}`)
      },
      'network_error',
    ],
  ]) {
    const { load, logs } = afaqy({ respond })
    const result = await load('server/afaqy').fetchAllUnits()
    assert.deepEqual(plain(result), { ok: false, error: code })
    assert.deepEqual(logs, [])
  }

  const stillFailing = afaqy({ respond: provider(units, { failLists: 2 }) })
  assert.deepEqual(
    plain(await stillFailing.load('server/afaqy').fetchAllUnits()),
    { ok: false, error: 'auth_failed' },
  )
})

test('without the credentials nothing is requested', async () => {
  for (const env of [
    {},
    { AFAQY_USERNAME: USER },
    { AFAQY_PASSWORD: PASSWORD },
    {
      AFAQY_USERNAME: USER,
      AFAQY_PASSWORD: PASSWORD,
      AFAQY_API_URL: 'http://x',
    },
    {
      AFAQY_USERNAME: USER,
      AFAQY_PASSWORD: PASSWORD,
      AFAQY_API_URL: 'https://x/?a=1',
    },
  ]) {
    const { load, calls } = afaqy({ env, respond: provider([]) })
    const client = load('server/afaqy')
    assert.equal(client.isAfaqyConfigured(), false)
    assert.deepEqual(plain(await client.listUnits()), {
      ok: false,
      error: 'not_configured',
    })
    assert.deepEqual(plain(await client.getUnitPosition(ID_A)), {
      ok: false,
      error: 'not_configured',
    })
    assert.equal(calls.length, 0)
  }
  // A custom base URL keeps its path.
  const custom = afaqy({
    env: {
      AFAQY_USERNAME: USER,
      AFAQY_PASSWORD: PASSWORD,
      AFAQY_API_URL: 'https://example.test/api/',
    },
    respond: provider([]),
  })
  await custom.load('server/afaqy').fetchAllUnits()
  assert.equal(custom.calls[0].url, 'https://example.test/api/auth/login')
})

test('the list is cached for five minutes and the token is reused', async () => {
  const { load, calls, clock } = afaqy({
    respond: provider([rawUnit(ID_A, '(A1)')]),
  })
  const { listUnits } = load('server/afaqy')
  const [first, second] = await Promise.all([listUnits(), listUnits()])
  assert.equal(first.value.length, 1)
  assert.equal(second.value.length, 1)
  assert.equal(calls.length, 2) // login + one page
  clock.value += 4 * 60 * 1000
  await listUnits()
  assert.equal(calls.length, 2)
  clock.value += 2 * 60 * 1000
  await listUnits()
  assert.equal(calls.length, 3) // the cached token, one more page
  await listUnits({ fresh: true })
  assert.equal(calls.length, 4)
})

test('positions use the id filter, are re-checked and cached for a minute', async () => {
  const units = [rawUnit(ID_A, '(A1)'), rawUnit(ID_B, '(A2)')]
  const respond = provider(units)
  const { load, calls, clock } = afaqy({
    // An API that ignores the filter must not leak other units.
    respond: (url, body, init) =>
      url.endsWith('/units/lists')
        ? json({ data: units })
        : respond(url, body, init),
  })
  const { getUnitPosition, getUnitsPositions } = load('server/afaqy')
  const one = await getUnitPosition(ID_A)
  assert.equal(one.ok, true)
  assert.equal(one.value.unitId, ID_A)
  const listCall = calls.find((call) => call.url.endsWith('/units/lists'))
  assert.deepEqual(plain(listCall.body.data.filters), {
    id: { value: [ID_A], op: 'in' },
  })
  assert.equal(listCall.body.data.limit, 1)

  const before = calls.length
  await getUnitPosition(ID_A)
  assert.equal(calls.length, before)
  clock.value += 61 * 1000
  await getUnitPosition(ID_A)
  assert.equal(calls.length, before + 1)

  // Unknown and invalid ids are simply absent.
  const many = await getUnitsPositions([ID_C, 'bad', ID_A])
  assert.deepEqual(plain(many.value.map((unit) => unit.unitId)), [ID_A])
  assert.equal((await getUnitPosition(ID_C)).value, null)
})

test('an unknown id falls back to the full list instead of failing', async () => {
  const units = [rawUnit(ID_A, '(A1)'), rawUnit(ID_B, '(A2)')]
  const respond = provider(units)
  const { load, calls } = afaqy({
    // Probed: an unknown id fails the whole filtered request this way.
    respond: (url, body, init) =>
      url.endsWith('/units/lists') && body.data.filters
        ? json({ message: 'validation_error', status_code: 405, errors: {} })
        : respond(url, body, init),
  })
  const { getUnitsPositions } = load('server/afaqy')
  const result = await getUnitsPositions([ID_C, ID_B])
  assert.equal(result.ok, true)
  assert.deepEqual(plain(result.value.map((unit) => unit.unitId)), [ID_B])
  const lists = calls.filter((call) => call.url.endsWith('/units/lists'))
  assert.equal(lists.length, 2)
  assert.equal(lists[1].body.data.filters, undefined)
})

test('the server module keeps its rules: no logs, no throw, no public variable', () => {
  const source = read('src', 'lib', 'server', 'afaqy.ts')
  assert.ok(!/console\./.test(source))
  assert.ok(!/\bthrow\b/.test(source))
  assert.ok(!/catch \(/.test(source))
  assert.ok(!/process\.env\.NEXT_PUBLIC_/.test(source))
  assert.match(source, /UNITS_CACHE_MS = 5 \* 60 \* 1000/)
  assert.match(source, /POSITION_CACHE_MS = 60 \* 1000/)
  assert.match(source, /filters: \{ id: \{ value: batch, op: 'in' \} \}/)
  // Read-only: the only Afaqy paths are the login and the unit list.
  const paths = [...source.matchAll(/'(\/[a-z]+\/[a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(paths)].sort(), ['/units/lists'])
  assert.match(source, /\/auth\/login`/)
})

// --- the client answers ------------------------------------------------------

test('route answers are read strictly', () => {
  const { parseUnitsResponse, parsePositionResponse, parseSyncResponse } =
    createLoader()('afaqy')
  const item = {
    unitId: ID_A,
    name: '(A1)',
    code: 'A1',
    plate: null,
    imei: null,
    hasPosition: false,
    lastSeen: null,
  }
  assert.deepEqual(
    plain(parseUnitsResponse(200, { units: [item, { x: 1 }] })),
    {
      kind: 'ok',
      units: [item],
    },
  )
  assert.equal(
    parseUnitsResponse(503, { error: 'not_configured' }).kind,
    'not_configured',
  )
  for (const [status, body] of [
    [200, null],
    [200, { units: 'x' }],
    [403, { units: [] }],
    [502, { error: 'provider_unavailable' }],
    [503, { error: 'other' }],
  ])
    assert.equal(parseUnitsResponse(status, body).kind, 'error')

  assert.equal(
    parsePositionResponse(404, { error: 'not_linked' }).kind,
    'not_linked',
  )
  assert.equal(
    parsePositionResponse(404, { error: 'unit_not_found' }).kind,
    'unit_not_found',
  )
  assert.equal(
    parsePositionResponse(404, { error: 'equipment_not_found' }).kind,
    'error',
  )
  assert.equal(
    parsePositionResponse(200, {
      unit: { unitId: ID_A, name: '(A1)', position: null },
    }).kind,
    'ok',
  )
  assert.equal(
    parsePositionResponse(200, {
      unit: { unitId: ID_A, name: '(A1)', position: { lat: 'x' } },
    }).kind,
    'error',
  )
  const report = {
    unitsTotal: 2,
    linked: 1,
    relinked: 0,
    alreadyLinked: 1,
    failed: 0,
    equipmentWithoutUnitTotal: 0,
    unmatchedUnits: [],
    equipmentWithoutUnit: [],
    conflicts: [],
  }
  assert.equal(parseSyncResponse(200, { report }).kind, 'ok')
  assert.equal(
    parseSyncResponse(200, { report: { ...report, linked: '1' } }).kind,
    'error',
  )
  assert.equal(parseSyncResponse(500, { error: 'failed' }).kind, 'error')
})

test('the client sends the bearer token and never throws', async () => {
  const { loadEquipmentPosition, runAfaqySync } = createLoader({
    AbortController,
  })('afaqy')
  const session = (token) => ({
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
    },
  })
  const calls = []
  const answer = await loadEquipmentPosition(
    session('abc'),
    '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    undefined,
    async (url, init) => {
      calls.push({ url, init })
      return { status: 404, json: async () => ({ error: 'not_linked' }) }
    },
  )
  assert.equal(answer.kind, 'not_linked')
  assert.equal(
    calls[0].url,
    '/api/afaqy/position?equipmentId=1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  )
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc')
  assert.equal(calls[0].init.cache, 'no-store')

  const syncCalls = []
  await runAfaqySync(session('abc'), false, async (url, init) => {
    syncCalls.push({ url, init })
    return { status: 500, json: async () => ({}) }
  })
  assert.equal(syncCalls[0].url, '/api/afaqy/sync')
  assert.equal(syncCalls[0].init.method, 'POST')
  assert.equal(syncCalls[0].init.body, '{"force":false}')

  let requested = false
  const none = await loadEquipmentPosition(
    session(null),
    'x',
    undefined,
    async () => {
      requested = true
      return { status: 200, json: async () => ({}) }
    },
  )
  assert.equal(none.kind, 'error')
  assert.equal(requested, false)
  assert.equal(
    (
      await loadEquipmentPosition(session('abc'), 'x', undefined, async () => {
        throw new Error('offline')
      })
    ).kind,
    'error',
  )
})

test('the unit search matches code, name and IMEI, at most the limit', () => {
  const { searchUnitList } = createLoader()('afaqy')
  const units = [
    { unitId: ID_A, name: '(A10) 1 AAA', code: 'A10', imei: '111' },
    { unitId: ID_B, name: '(A1) 8631 URA', code: 'A1', imei: '222' },
    { unitId: ID_C, name: '(B2) 9999 XYZ', code: 'B2', imei: '333' },
  ].map((unit) => ({ plate: null, hasPosition: true, lastSeen: null, ...unit }))
  const ids = (list) => plain(list.map((unit) => unit.unitId))
  assert.deepEqual(ids(searchUnitList(units, 'a1')), [ID_B, ID_A])
  assert.deepEqual(ids(searchUnitList(units, '8631ura')), [ID_B])
  assert.deepEqual(ids(searchUnitList(units, '333')), [ID_C])
  assert.equal(searchUnitList(units, '', 2).length, 2)
  assert.deepEqual(ids(searchUnitList(units, 'none')), [])
})

// --- the routes --------------------------------------------------------------

test('the admin check uses the caller token and fails closed', () => {
  const helper = read('src', 'lib', 'server', 'adminRequest.ts')
  assert.match(
    helper,
    /if \(!authorization\?\.startsWith\('Bearer '\)\) \{\s+return \{ ok: false, error: 'unauthorized' \}/,
  )
  assert.match(helper, /supabase\.auth\.getClaims\(accessToken\)/)
  assert.match(helper, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(helper, /await supabase\.rpc\('is_admin'\)/)
  assert.match(
    helper,
    /if \(roleError \|\| isAdmin !== true\) \{\s+return \{ ok: false, error: 'forbidden' \}/,
  )
  assert.ok(!/SERVICE_ROLE|service_role/i.test(helper))
})

test('every Afaqy route is admin-only, uncached and never leaks provider text', () => {
  const routes = {
    units: ['GET', 'listUnits('],
    position: ['GET', 'getUnitPosition('],
    sync: ['POST', 'listUnits('],
  }
  for (const [name, [method, call]] of Object.entries(routes)) {
    const route = read('app', 'api', 'afaqy', name, 'route.ts')
    assert.match(
      route,
      new RegExp(`export async function ${method}\\(request: Request\\)`),
    )
    const others = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
      (verb) => verb !== method,
    )
    assert.ok(
      !new RegExp(`export async function (${others.join('|')})`).test(route),
      name,
    )
    assert.match(route, /const admin = await requireAdmin\(request\)/)
    // The role is checked first in the handler, before Afaqy or the
    // database is asked.
    const handler = route.slice(route.indexOf('export async function'))
    const adminAt = handler.indexOf('requireAdmin(request)')
    assert.ok(adminAt > 0 && adminAt < handler.indexOf(call), name)
    for (const later of [
      "from('equipment')",
      'readForce(',
      'isAfaqyConfigured()',
    ])
      if (handler.includes(later))
        assert.ok(adminAt < handler.indexOf(later), `${name} ${later}`)
    assert.match(route, /'Cache-Control': 'no-store'/)
    assert.match(route, /export const runtime = 'nodejs'/)
    assert.ok(
      !/SERVICE_ROLE|service_role|process\.env|password/i.test(route),
      name,
    )
    // Only short codes are logged, never an error object.
    for (const [, args] of route.matchAll(/console\.error\(([^)]*)\)/g))
      assert.match(args, /\{\s*code: /, name)
  }
  const sync = read('app', 'api', 'afaqy', 'sync', 'route.ts')
  // Writes go through the caller's client, one row each, and are verified.
  assert.match(sync, /\.update\(values\)\s+\.eq\('id', id\)\s+\.select\('id'\)/)
  assert.match(sync, /data\.length === 1/)
  assert.ok(sync.indexOf('plan.clears') < sync.indexOf('plan.sets'))
  const position = read('app', 'api', 'afaqy', 'position', 'route.ts')
  assert.match(position, /reply\(\{ error: 'not_linked' \}, 404\)/)
  assert.match(position, /reply\(\{ error: 'unit_not_found' \}, 404\)/)
  assert.match(position, /UUID_PATTERN\.test\(equipmentId\)/)
})

// --- the UI ------------------------------------------------------------------

test('the location card is admin-only and never asks for other roles', () => {
  const card = read('src', 'components', 'afaqy', 'EquipmentLocationCard.tsx')
  assert.match(
    card,
    /if \(profile\?\.role !== 'admin'\) return null\s+return <LocationCardContent \{\.\.\.props\} \/>/,
  )
  // The request lives in the inner component only.
  assert.ok(
    card.indexOf('loadEquipmentPosition(') >
      card.indexOf('function LocationCardContent'),
  )
  assert.match(card, /target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(card, /isPositionStale\(position\)/)
  for (const screen of [
    read('src', 'screens', 'EquipmentDetail.tsx'),
    read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
  ])
    assert.match(
      screen,
      /<EquipmentLocationCard\s+equipmentId=\{equipment\.id\}/,
    )

  const form = read('src', 'screens', 'equipment', 'EquipmentFormDialog.tsx')
  assert.match(form, /const isAdmin = profile\?\.role === 'admin'/)
  assert.match(
    form,
    /\{isAdmin && \(\s+<Field\s+label=\{t\('afaqyTrackerUnit'\)\}/,
  )
  assert.match(form, /if \(!open \|\| !isAdmin\) return/)
  assert.match(form, /trackerLink\.state === 'ready' &&/)

  const map = read('src', 'components', 'map', 'LocationMap.tsx')
  assert.match(map, /import\('\.\/LeafletProjectsMap'\)/)
  assert.doesNotMatch(map, /^import [^t].*LeafletProjectsMap/m)

  for (const file of [
    card,
    map,
    read('src', 'components', 'afaqy', 'AfaqySettings.tsx'),
  ]) {
    assert.ok(!/(gray|green|amber|emerald|yellow|red|blue)-\d/.test(file))
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(file))
    assert.ok(!/@\/lib\/server\/|AFAQY_/.test(file))
  }
  assert.ok(!/@\/lib\/server\//.test(read('src', 'lib', 'afaqy.ts')))
  assert.ok(!/@\/lib\/server\//.test(read('src', 'lib', 'afaqySync.ts')))
})

test('the wave 17 copy exists in both languages and uses the plain alif', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-17-afaqy — start([\s\S]*?)\/\/ wave-17-afaqy — end/g,
  )
  assert.equal(blocks?.length, 2)
  const keys = (block) => [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.ok(keys(blocks[0]).length >= 40)
  assert.ok(!/[أإآ]/.test(blocks[0]), 'new Arabic copy uses the plain alif')
})

test('the env example documents the Afaqy variables with placeholders', () => {
  const example = read('.env.example')
  assert.match(example, /^AFAQY_USERNAME=your-afaqy-username$/m)
  assert.match(example, /^AFAQY_PASSWORD=your-afaqy-password$/m)
  assert.match(example, /^AFAQY_API_URL=https:\/\/api\.afaqy\.pro$/m)
})

// --- the migration -----------------------------------------------------------

test('migration 0122 adds the link columns, their checks and the unique index', () => {
  const sql = read(
    'supabase',
    'migrations',
    '20261008110000_0122_equipment_tracker.sql',
  )
  const body = sql.replace(/--[^\n]*/g, '')
  assert.match(
    body,
    /ALTER TABLE public\.equipment\s+ADD COLUMN IF NOT EXISTS tracker_unit_id text NULL,\s+ADD COLUMN IF NOT EXISTS tracker_unit_name text NULL,\s+ADD COLUMN IF NOT EXISTS tracker_linked_at timestamptz NULL;/,
  )
  assert.match(
    body,
    /CREATE UNIQUE INDEX IF NOT EXISTS equipment_tracker_unit_id_key\s+ON public\.equipment \(tracker_unit_id\)\s+WHERE tracker_unit_id IS NOT NULL;/,
  )
  assert.match(body, /tracker_unit_id ~ '\^\[0-9a-fA-F\]\{24\}\$'/)
  assert.match(body, /char_length\(tracker_unit_name\) <= 200/)
  assert.match(body, /CONSTRAINT equipment_tracker_link_complete CHECK/)
  for (const column of [
    'tracker_unit_id',
    'tracker_unit_name',
    'tracker_linked_at',
  ])
    assert.match(
      body,
      new RegExp(`COMMENT ON COLUMN public\\.equipment\\.${column} IS`),
    )
  // Additive only: no policy, grant, function, view or data change.
  assert.ok(
    !/\b(POLICY|GRANT|REVOKE|FUNCTION|VIEW|TRIGGER|UPDATE public|DELETE FROM|DROP COLUMN|DROP TABLE)\b/i.test(
      body,
    ),
  )
  // The patterns of the app mirror the database checks.
  const lib = read('src', 'lib', 'afaqy.ts')
  assert.match(lib, /AFAQY_UNIT_ID_PATTERN = \/\^\[0-9a-fA-F\]\{24\}\$\//)
  assert.match(lib, /AFAQY_UNIT_NAME_MAX = 200/)
  assert.match(
    read('src', 'screens', 'equipment', 'EquipmentFormDialog.tsx'),
    /equipment_tracker_unit_id_key/,
  )
})
