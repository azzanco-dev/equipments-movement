const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the home helpers are exercised exactly as the home screen uses them.
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

const home = loadLibModule('homeStats')

// The module runs in its own vm realm, so the objects it returns do not share
// this realm's prototypes. Comparing plain copies keeps the assertions strict.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const lastMovement = (type, context, purpose, recordedAt) => ({
  movement_type: type,
  movement_context: context,
  workshop_purpose: purpose,
  recorded_at: recordedAt,
})

test('foreman stats default to zero for anything unusable', () => {
  assert.deepEqual(plain(home.parseForemanHomeStats(null)), {
    entriesToday: 0,
    exitsToday: 0,
    insideNow: 0,
  })
  assert.deepEqual(
    plain(
      home.parseForemanHomeStats({
        entries_today: 4,
        exits_today: '9',
        inside_now: -3,
      }),
    ),
    { entriesToday: 4, exitsToday: 0, insideNow: 0 },
  )
})

test('workshop stats read the counts and the pending entries', () => {
  const stats = home.parseWorkshopHomeStats({
    inside_now: 21,
    maintenance: 13,
    parking: 6,
    pending_classification: 2,
    pending: [
      {
        id: 'log-1',
        equipment_id: 'eq-1',
        equipment_code: 'B-19',
        equipment_type: 'بوكلين',
        recorded_at: '2026-09-17T09:00:00Z',
      },
      // A row whose equipment the caller cannot read still classifies.
      {
        id: 'log-2',
        equipment_id: 'eq-2',
        recorded_at: '2026-09-15T05:00:00Z',
      },
      // Never render a row without the entry id the RPC classifies by.
      { equipment_code: 'X-1' },
    ],
  })
  assert.equal(stats.insideNow, 21)
  assert.equal(stats.maintenance, 13)
  assert.equal(stats.parking, 6)
  assert.equal(stats.pendingClassification, 2)
  assert.equal(stats.pending.length, 2)
  assert.deepEqual(plain(stats.pending[0]), {
    id: 'log-1',
    equipmentId: 'eq-1',
    equipmentCode: 'B-19',
    equipmentType: 'بوكلين',
    recordedAt: '2026-09-17T09:00:00Z',
  })
  assert.equal(stats.pending[1].equipmentCode, '—')
  assert.deepEqual(plain(home.parseWorkshopHomeStats(undefined).pending), [])
})

test('elapsed days are counted on Saudi calendar days', () => {
  // 22:30 UTC on 14 Sep is already 01:30 on 15 Sep in Riyadh.
  assert.equal(
    home.daysSinceSaudi('2026-09-14T22:30:00Z', '2026-09-15T08:00:00Z'),
    0,
  )
  assert.equal(
    home.daysSinceSaudi('2026-09-14T20:59:59Z', '2026-09-15T08:00:00Z'),
    1,
  )
  assert.equal(
    home.daysSinceSaudi('2026-09-01T06:00:00Z', '2026-09-11T06:00:00Z'),
    10,
  )
  assert.equal(home.daysSinceSaudi(null, '2026-09-11T06:00:00Z'), 0)
  // A clock skew must never produce a negative "since" count.
  assert.equal(
    home.daysSinceSaudi('2026-09-20T06:00:00Z', '2026-09-11T06:00:00Z'),
    0,
  )
})

test('equipment state follows the latest movement across both contexts', () => {
  const now = '2026-09-17T09:00:00Z'
  assert.equal(home.equipmentStateFromLastMovement(null, 'x', now), undefined)
  assert.deepEqual(
    plain(
      home.equipmentStateFromLastMovement(
        lastMovement('exit', 'site', null, '2026-09-11T09:00:00Z'),
        'ignored',
        now,
      ),
    ),
    { kind: 'outside' },
  )
  assert.deepEqual(
    plain(
      home.equipmentStateFromLastMovement(
        lastMovement('entry', 'site', null, '2026-09-15T09:00:00Z'),
        'شركة · مشروع',
        now,
      ),
    ),
    { kind: 'inside_site', location: 'شركة · مشروع', days: 2 },
  )
  // A foreman gets the workshop state even though the workshop rows are hidden.
  assert.deepEqual(
    plain(
      home.equipmentStateFromLastMovement(
        lastMovement(
          'entry',
          'workshop',
          'maintenance',
          '2026-09-11T09:00:00Z',
        ),
        'ignored',
        now,
      ),
    ),
    { kind: 'inside_workshop', purpose: 'maintenance', days: 6 },
  )
  // An unexpected purpose value degrades to "not classified yet".
  assert.deepEqual(
    plain(
      home.equipmentStateFromLastMovement(
        lastMovement('entry', 'workshop', 'unknown', '2026-09-17T06:00:00Z'),
        'ignored',
        now,
      ),
    ),
    { kind: 'inside_workshop', purpose: null, days: 0 },
  )
})
