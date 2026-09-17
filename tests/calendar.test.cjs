const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/calendar.ts (no imports of its own) so the pure calendar
// math backing DatePicker is exercised exactly as written, without a bundler.
function loadCalendar() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'calendar.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const {
  parseDateKey,
  isValidDateKey,
  formatDateKey,
  daysInMonth,
  firstWeekdayOfMonth,
  weekdayOfDateKey,
  addMonths,
  addDaysToDateKey,
  addMonthsToDateKey,
  startOfWeek,
  endOfWeek,
  compareDateKeys,
  buildMonthGrid,
} = loadCalendar()

// Objects returned from loadCalendar() come back from a separate vm context,
// so compare fields individually rather than with assert.deepEqual
// (cross-realm plain objects are not reference-equal to Object.prototype in
// this realm).
function assertParts(actual, year, month, day) {
  assert.equal(actual.year, year)
  assert.equal(actual.month, month)
  assert.equal(actual.day, day)
}

test('parseDateKey accepts valid keys and rejects malformed or impossible dates', () => {
  assertParts(parseDateKey('2026-09-17'), 2026, 9, 17)
  for (const value of [
    '',
    'x',
    '2026-9-17',
    '2026-13-01',
    '2026-02-30',
    '2026-00-10',
    '2026-01-00',
  ])
    assert.equal(parseDateKey(value), null, value)
})

test('isValidDateKey mirrors parseDateKey for empty/null/undefined input', () => {
  assert.equal(isValidDateKey('2026-09-17'), true)
  assert.equal(isValidDateKey('2026-02-30'), false)
  assert.equal(isValidDateKey(''), false)
  assert.equal(isValidDateKey(null), false)
  assert.equal(isValidDateKey(undefined), false)
})

test('formatDateKey zero-pads month and day', () => {
  assert.equal(formatDateKey(2026, 9, 7), '2026-09-07')
  assert.equal(formatDateKey(2026, 12, 31), '2026-12-31')
})

test('daysInMonth handles 30/31-day months and leap years', () => {
  assert.equal(daysInMonth(2026, 1), 31)
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2026, 2), 28) // 2026 is not a leap year
  assert.equal(daysInMonth(2028, 2), 29) // 2028 is a leap year
})

test('firstWeekdayOfMonth and weekdayOfDateKey agree with the calendar', () => {
  // 1 Sep 2026 is a Tuesday, 17 Sep 2026 is a Thursday.
  assert.equal(firstWeekdayOfMonth(2026, 9), 2)
  assert.equal(weekdayOfDateKey('2026-09-01'), 2)
  assert.equal(weekdayOfDateKey('2026-09-17'), 4)
  assert.equal(weekdayOfDateKey('bad'), null)
})

test('addMonths wraps across year boundaries in both directions', () => {
  function assertYm(actual, year, month) {
    assert.equal(actual.year, year)
    assert.equal(actual.month, month)
  }
  assertYm(addMonths(2026, 12, 1), 2027, 1)
  assertYm(addMonths(2026, 1, -1), 2025, 12)
  assertYm(addMonths(2026, 6, 12), 2027, 6)
  assertYm(addMonths(2026, 6, -18), 2024, 12)
})

test('addDaysToDateKey crosses month and year boundaries', () => {
  assert.equal(addDaysToDateKey('2026-09-17', 1), '2026-09-18')
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysToDateKey('2026-03-01', -1), '2026-02-28')
  assert.equal(addDaysToDateKey('bad', 1), null)
})

test('addMonthsToDateKey clamps the day into the target month', () => {
  assert.equal(addMonthsToDateKey('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsToDateKey('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonthsToDateKey('2026-09-17', -1), '2026-08-17')
})

test('startOfWeek and endOfWeek bracket the Sunday-start week', () => {
  // 17 Sep 2026 (Thu) sits in the week of Sun 13 Sep - Sat 19 Sep.
  assert.equal(startOfWeek('2026-09-17'), '2026-09-13')
  assert.equal(endOfWeek('2026-09-17'), '2026-09-19')
  // A Sunday is the start of its own week.
  assert.equal(startOfWeek('2026-09-13'), '2026-09-13')
})

test('compareDateKeys orders lexicographically', () => {
  assert.equal(compareDateKeys('2026-09-17', '2026-09-18'), -1)
  assert.equal(compareDateKeys('2026-09-18', '2026-09-17'), 1)
  assert.equal(compareDateKeys('2026-09-17', '2026-09-17'), 0)
})

test('buildMonthGrid pads Sunday-start weeks and lists every day once', () => {
  const grid = buildMonthGrid(2026, 9) // Sep 2026 starts on Tuesday
  assert.equal(grid.length - 2, 30) // 2 leading blanks + 30 days
  assert.equal(grid[0], null)
  assert.equal(grid[1], null)
  assert.equal(grid[2].dateKey, '2026-09-01')
  assert.equal(grid[2].day, 1)
  assert.equal(grid[grid.length - 1].dateKey, '2026-09-30')
  assert.equal(grid[grid.length - 1].day, 30)
})
