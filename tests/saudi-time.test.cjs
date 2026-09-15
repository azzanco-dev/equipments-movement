const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/saudiTime.ts with a fixed "now" so period math is deterministic.
function loadSaudiTime(nowIso) {
  const file = path.join(__dirname, '..', 'src', 'lib', 'saudiTime.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [nowIso]))
    }
    static now() {
      return new RealDate(nowIso).getTime()
    }
  }
  const exports = {}
  vm.runInNewContext(code, { exports, Date: FixedDate }, { filename: file })
  return exports
}

test('day keys follow Saudi time, not UTC', () => {
  // 22:30 UTC on 14 Sep is already 01:30 on 15 Sep in Riyadh.
  const time = loadSaudiTime('2026-09-14T22:30:00Z')
  assert.equal(time.saudiDateKey(), '2026-09-15')
  assert.equal(time.saudiDateKey('2026-09-14T20:59:59Z'), '2026-09-14')
})

test('day bounds cover the full Saudi day inclusively', () => {
  const time = loadSaudiTime('2026-09-15T08:00:00Z')
  assert.equal(time.saudiDayStart('2026-09-15'), '2026-09-14T21:00:00.000Z')
  assert.equal(time.saudiDayEnd('2026-09-15'), '2026-09-15T20:59:59.999Z')
})

test('preset periods use Monday weeks and month starts in Saudi time', () => {
  // Tuesday 15 Sep 2026, 10:00 Riyadh.
  const time = loadSaudiTime('2026-09-15T07:00:00Z')
  assert.deepEqual(
    { ...time.saudiPeriodKeys('today') },
    { from: '2026-09-15', to: '2026-09-15' },
  )
  assert.deepEqual(
    { ...time.saudiPeriodKeys('week') },
    { from: '2026-09-14', to: '2026-09-15' },
  )
  assert.deepEqual(
    { ...time.saudiPeriodKeys('month') },
    { from: '2026-09-01', to: '2026-09-15' },
  )
  // A Sunday belongs to the week that started the previous Monday.
  const sunday = loadSaudiTime('2026-09-20T07:00:00Z')
  assert.equal(sunday.saudiPeriodKeys('week').from, '2026-09-14')
})

test('date keys reject empty, malformed, and impossible dates', () => {
  const time = loadSaudiTime('2026-09-15T07:00:00Z')
  assert.equal(time.isDateKey('2026-09-15'), true)
  for (const value of ['', null, undefined, '2026-9-15', '2026-13-01', 'x'])
    assert.equal(time.isDateKey(value), false, String(value))
})
