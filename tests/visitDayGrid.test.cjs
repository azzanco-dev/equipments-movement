const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Owner 2026-11-16: the day columns of the visits Excel export and «المستخلص».
// The pure rules of `src/lib/visitDayGrid.ts`.

const file = path.join(__dirname, '..', 'src', 'lib', 'visitDayGrid.ts')
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const lib = { exports: {} }
new Function('module', 'exports', 'require', code)(lib, lib.exports, require)
const grid = lib.exports

const NOW = Date.parse('2026-11-16T09:00:00+03:00')
const AR = grid.dayCodes('ar')
const at = (day, clock = '12:00') => `${day}T${clock}:00+03:00`
const visit = (entryId, context, from, to, extra = {}) => ({
  entryId,
  equipmentId: 'u1',
  context,
  workshopPurpose: null,
  entryAt: at(from),
  exitAt: to ? at(to) : null,
  ...extra,
})
const cells = (days) => days.map((day) => grid.unitDayCell(day, AR))

test('Saudi days and months', () => {
  // 22:30 UTC is already the next Saudi day.
  assert.equal(grid.saudiDayKeyOf('2026-10-31T22:30:00Z'), '2026-11-01')
  assert.equal(grid.monthDayKeys('2026-10').length, 31)
  assert.equal(grid.monthDayKeys('2026-02').length, 28)
  assert.deepEqual(grid.monthDayKeys('2026-13'), [])
  // 2 October 2026 is a Friday.
  assert.equal(grid.isFridayKey('2026-10-02'), true)
  assert.equal(grid.isFridayKey('2026-10-03'), false)
  assert.equal(grid.previousMonthKey(NOW), '2026-10')
  assert.equal(
    grid.previousMonthKey(Date.parse('2026-01-05T09:00:00+03:00')),
    '2025-12',
  )
  assert.deepEqual(grid.recentMonthKeys(NOW, 3), [
    '2026-11',
    '2026-10',
    '2026-09',
  ])
  assert.deepEqual(grid.monthBounds('2026-10'), {
    start: '2026-10-01T00:00:00.000+03:00',
    end: '2026-10-31T23:59:59.999+03:00',
  })
})

test('the month: a filter inside one month, else the previous month', () => {
  assert.equal(grid.monthKeyOfRange('2026-09-01', '2026-09-30'), '2026-09')
  assert.equal(grid.monthKeyOfRange('2026-09-10', '2026-09-12'), '2026-09')
  assert.equal(grid.monthKeyOfRange('2026-09-20', '2026-10-05'), null)
  assert.equal(grid.monthKeyOfRange('2026-09-01', null), null)
  assert.equal(
    grid.exportDaysMonth(
      [
        { from: null, to: null },
        { from: '2026-08-01', to: '2026-08-31' },
      ],
      NOW,
    ),
    '2026-08',
  )
  assert.equal(
    grid.exportDaysMonth([{ from: '2026-08-20', to: '2026-09-02' }], NOW),
    '2026-10',
  )
  assert.equal(grid.exportDaysMonth([], NOW), '2026-10')
})

test('a project visit: 10 a day, Fridays empty, the rest unrecorded or before', () => {
  // 5 to 9 October; the 9th is a Friday.
  const only = [visit('s1', 'site', '2026-10-05', '2026-10-09')]
  const days = grid.unitMonthDays(only, '2026-10', NOW, false)
  const row = cells(days)
  assert.deepEqual(row.slice(0, 4), ['', '', '', ''])
  assert.equal(days[0].kind, 'before')
  assert.deepEqual(row.slice(4, 9), [10, 10, 10, 10, ''])
  assert.equal(days[8].kind, 'site')
  assert.equal(days[8].friday, true)
  // After the exit the unit is known, so the days are «بدون تسجيل».
  assert.equal(row[9], '-')
  assert.equal(days[9].kind, 'unrecorded')
  // With an earlier visit the first days are unrecorded too.
  const known = grid.unitMonthDays(only, '2026-10', NOW, true)
  assert.equal(known[0].kind, 'unrecorded')
})

test('a workshop stop nested in an open project visit takes its days', () => {
  const visits = [
    visit('s1', 'site', '2026-09-20', null),
    visit('w1', 'workshop', '2026-10-06', '2026-10-08', {
      workshopPurpose: 'maintenance',
    }),
  ]
  const days = grid.unitMonthDays(visits, '2026-10', NOW, false)
  const row = cells(days)
  assert.deepEqual(row.slice(3, 9), [10, 10, 'ص', 'ص', 'ص', ''])
  // The visits sheet: the project row shows the letters, the stop its own days.
  const site = days.map((day) => grid.visitDayCell(day, visits[0], AR, NOW))
  assert.deepEqual(site.slice(3, 9), [10, 10, 'ص', 'ص', 'ص', ''])
  const stop = days.map((day) => grid.visitDayCell(day, visits[1], AR, NOW))
  assert.deepEqual(stop.slice(3, 9), ['', '', 'ص', 'ص', 'ص', ''])
  assert.deepEqual(grid.summarizeDayCells(site, AR), {
    hours: site.filter((cell) => cell === 10).length * 10,
    workshopDays: 3,
    unrecordedDays: 0,
  })
})

test('a shared day is counted once, for the visit that started last', () => {
  const visits = [
    visit('s1', 'site', '2026-10-05', '2026-10-12'),
    {
      ...visit('s2', 'site', '2026-10-12', '2026-10-14'),
      entryAt: at('2026-10-12', '16:31'),
    },
  ]
  const days = grid.unitMonthDays(visits, '2026-10', NOW, false)
  assert.equal(days[11].ownerEntryId, 's2')
  const first = days.map((day) => grid.visitDayCell(day, visits[0], AR, NOW))
  const second = days.map((day) => grid.visitDayCell(day, visits[1], AR, NOW))
  assert.equal(first[11], '')
  assert.equal(second[11], 10)
  const total =
    grid.summarizeDayCells(first, AR).hours +
    grid.summarizeDayCells(second, AR).hours
  assert.equal(total, grid.summarizeDayCells(cells(days), AR).hours)
})

test('workshop purposes, the open visit and the future', () => {
  const visits = [
    visit('w1', 'workshop', '2026-11-02', '2026-11-03', {
      workshopPurpose: 'parking',
    }),
    visit('w2', 'workshop', '2026-11-05', '2026-11-05', {
      workshopPurpose: 'out_of_service',
    }),
    visit('w3', 'workshop', '2026-11-09', '2026-11-09'),
    visit('s1', 'site', '2026-11-14', null),
  ]
  const days = grid.unitMonthDays(visits, '2026-11', NOW, false)
  const row = cells(days)
  assert.deepEqual(row.slice(0, 9), [
    '',
    'ق',
    'ق',
    '-',
    'خ',
    '-',
    '-',
    '-',
    'و',
  ])
  // The open project visit runs to today (16 November); the future is empty.
  assert.deepEqual(row.slice(13, 18), [10, 10, 10, '', ''])
  assert.equal(days[16].kind, 'future')
  assert.deepEqual(grid.summarizeDayCells(row, AR), {
    hours: 30,
    workshopDays: 4,
    unrecordedDays: 8,
  })
  // Latin letters for the English file.
  assert.deepEqual(grid.dayCodes('en'), {
    maintenance: 'M',
    parking: 'S',
    out_of_service: 'O',
    unclassified: 'W',
    unrecorded: '-',
  })
})

test('a visit row is empty outside its own span', () => {
  const visits = [visit('s1', 'site', '2026-10-05', '2026-10-07')]
  const days = grid.unitMonthDays(visits, '2026-10', NOW, true)
  const row = days.map((day) => grid.visitDayCell(day, visits[0], AR, NOW))
  assert.deepEqual(row.slice(0, 8), ['', '', '', '', 10, 10, 10, ''])
  assert.deepEqual(grid.summarizeDayCells(row, AR), {
    hours: 30,
    workshopDays: 0,
    unrecordedDays: 0,
  })
  assert.equal(grid.visitsByUnit(visits).get('u1').length, 1)
})
