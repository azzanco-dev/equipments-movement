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

test('month keys cover this month to today and the two whole months before', () => {
  // 31 Oct 2026, 23:30 Riyadh (20:30 UTC): still October in Saudi time.
  const time = loadSaudiTime('2026-10-31T20:30:00Z')
  assert.deepEqual(
    { ...time.saudiMonthKeys(0) },
    { from: '2026-10-01', to: '2026-10-31' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(1) },
    { from: '2026-09-01', to: '2026-09-30' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(2) },
    { from: '2026-08-01', to: '2026-08-31' },
  )
  // 21:30 UTC on 31 Oct is already 1 Nov in Riyadh.
  const november = loadSaudiTime('2026-10-31T21:30:00Z')
  assert.deepEqual(
    { ...november.saudiMonthKeys(0) },
    { from: '2026-11-01', to: '2026-11-01' },
  )
})

test('month keys cross the year and follow February', () => {
  const time = loadSaudiTime('2026-09-15T07:00:00Z')
  assert.deepEqual(
    { ...time.saudiMonthKeys(1, '2027-01-10') },
    { from: '2026-12-01', to: '2026-12-31' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(2, '2027-01-10') },
    { from: '2026-11-01', to: '2026-11-30' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(1, '2027-03-05') },
    { from: '2027-02-01', to: '2027-02-28' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(1, '2028-03-05') },
    { from: '2028-02-01', to: '2028-02-29' },
  )
  assert.deepEqual(
    { ...time.saudiMonthKeys(0, '2027-03-05') },
    { from: '2027-03-01', to: '2027-03-05' },
  )
})

test('month preset labels are the English month with its number', () => {
  const time = loadSaudiTime('2026-10-31T07:00:00Z')
  assert.equal(time.monthPresetLabel(0), 'Oct (10)')
  assert.equal(time.monthPresetLabel(1), 'Sep (9)')
  assert.equal(time.monthPresetLabel(2), 'Aug (8)')
  assert.equal(time.monthPresetLabel(0, '2027-01-10'), 'Jan (1)')
  assert.equal(time.monthPresetLabel(1, '2027-01-10'), 'Dec (12)')
  assert.equal(time.monthPresetLabel(2, '2027-01-10'), 'Nov (11)')
  assert.deepEqual(
    [...time.MONTH_PRESETS].map((preset) => time.MONTH_PRESET_BACK[preset]),
    [2, 1, 0],
  )
  // The tabs read oldest to newest: Aug (8) · Sep (9) · Oct (10).
  assert.deepEqual(
    [...time.MONTH_PRESETS].map((preset) =>
      time.monthPresetLabel(time.MONTH_PRESET_BACK[preset]),
    ),
    ['Aug (8)', 'Sep (9)', 'Oct (10)'],
  )
})
