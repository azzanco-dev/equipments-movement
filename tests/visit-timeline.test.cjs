const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/visitTimeline.ts (no imports of its own) so the visit pairing
// used by the equipment inquiry timeline is exercised exactly as written,
// without a bundler.
function loadVisitTimeline() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'visitTimeline.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const {
  buildEquipmentVisits,
  buildOutsideGaps,
  buildTimelineItems,
  msToDays,
  sortMovements,
  summarizeVisits,
  visitDurationMs,
} = loadVisitTimeline()

const DAY = 24 * 60 * 60 * 1000

function movement(id, type, recordedAt, extra = {}) {
  return {
    id,
    movement_context: extra.context ?? 'site',
    movement_type: type,
    recorded_at: recordedAt,
    company_name: extra.company ?? null,
    project_name: extra.project ?? null,
    workshop_purpose: extra.purpose ?? null,
    supervisor_name: extra.supervisor ?? null,
    driver_name: extra.driver ?? null,
    photo_count: extra.photos ?? 0,
  }
}

test('an entry and the following exit become one closed visit', () => {
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-03-01T06:00:00Z', {
      company: 'Takween',
      project: 'Riyadh North',
      photos: 2,
    }),
    movement('m2', 'exit', '2026-03-04T06:00:00Z', { photos: 1 }),
  ])

  assert.equal(visits.length, 1)
  const visit = visits[0]
  assert.equal(visit.key, 'm1')
  assert.equal(visit.context, 'site')
  assert.equal(visit.entry.id, 'm1')
  assert.equal(visit.exit.id, 'm2')
  assert.equal(visit.open, false)
  assert.equal(visit.orphanExit, false)
  assert.equal(visit.startedAt, '2026-03-01T06:00:00Z')
  assert.equal(visit.endedAt, '2026-03-04T06:00:00Z')
  // Sorting follows the newest instant in the visit, not the entry.
  assert.equal(visit.sortAt, '2026-03-04T06:00:00Z')
  // Photos from both ends of the visit count together.
  assert.equal(visit.photoCount, 3)
  assert.equal(visitDurationMs(visit), 3 * DAY)
})

test('an entry with no exit stays an open visit measured up to now', () => {
  const now = Date.parse('2026-03-06T06:00:00Z')
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-03-01T06:00:00Z'),
    movement('m2', 'exit', '2026-03-02T06:00:00Z'),
    movement('m3', 'entry', '2026-03-04T06:00:00Z'),
  ])

  assert.equal(visits.length, 2)
  // Newest first.
  assert.equal(visits[0].key, 'm3')
  assert.equal(visits[0].open, true)
  assert.equal(visits[0].exit, null)
  assert.equal(visits[0].endedAt, null)
  assert.equal(visitDurationMs(visits[0], now), 2 * DAY)
  assert.equal(visits[1].open, false)
})

test('a legacy exit with no entry before it is its own lone segment', () => {
  const visits = buildEquipmentVisits([
    movement('old', 'exit', '2026-01-05T06:00:00Z'),
    movement('m1', 'entry', '2026-02-01T06:00:00Z'),
    movement('m2', 'exit', '2026-02-03T06:00:00Z'),
  ])

  assert.equal(visits.length, 2)
  const lone = visits[1]
  assert.equal(lone.key, 'exit:old')
  assert.equal(lone.orphanExit, true)
  assert.equal(lone.open, false)
  assert.equal(lone.entry, null)
  assert.equal(lone.exit.id, 'old')
  assert.equal(lone.startedAt, null)
  assert.equal(lone.endedAt, '2026-01-05T06:00:00Z')
  // A lone exit has no measurable duration and must not fake one.
  assert.equal(visitDurationMs(lone), null)
})

test('site and workshop visits are paired independently', () => {
  const visits = buildEquipmentVisits([
    movement('s1', 'entry', '2026-04-01T06:00:00Z', { company: 'Takween' }),
    movement('w1', 'entry', '2026-04-02T06:00:00Z', {
      context: 'workshop',
      purpose: 'maintenance',
    }),
    movement('w2', 'exit', '2026-04-03T06:00:00Z', { context: 'workshop' }),
    movement('s2', 'exit', '2026-04-05T06:00:00Z'),
  ])

  assert.equal(visits.length, 2)
  const site = visits.find((v) => v.context === 'site')
  const workshop = visits.find((v) => v.context === 'workshop')
  // The workshop exit must not close the open site visit, and vice versa.
  assert.equal(site.entry.id, 's1')
  assert.equal(site.exit.id, 's2')
  assert.equal(workshop.entry.id, 'w1')
  assert.equal(workshop.exit.id, 'w2')
  assert.equal(workshop.entry.workshop_purpose, 'maintenance')
})

test('identical timestamps pair deterministically by id', () => {
  const same = '2026-05-01T06:00:00Z'
  // Arrays come back from a separate vm context, so compare joined keys
  // rather than with assert.deepEqual (cross-realm arrays are never
  // reference-equal to this realm's Array.prototype).
  const build = (rows) =>
    buildEquipmentVisits(rows)
      .map((v) => v.key)
      .join('|')
  const rows = [
    movement('b', 'exit', same),
    movement('a', 'entry', same),
    movement('c', 'entry', same),
  ]
  // `a` (entry) < `b` (exit) < `c` (entry) by id at the same instant, so `b`
  // closes `a` and `c` stays open, whatever order the rows arrive in.
  assert.equal(build(rows), 'c|a')
  assert.equal(build([...rows].reverse()), 'c|a')
  assert.equal(
    sortMovements(rows)
      .map((m) => m.id)
      .join('|'),
    'a|b|c',
  )
})

test('an entry that follows an unclosed entry leaves the earlier one open', () => {
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-06-01T06:00:00Z'),
    movement('m2', 'entry', '2026-06-02T06:00:00Z'),
    movement('m3', 'exit', '2026-06-03T06:00:00Z'),
  ])

  assert.equal(visits.length, 2)
  // The newest entry is the one the exit closes; the stale one is not dropped.
  assert.equal(visits[0].key, 'm2')
  assert.equal(visits[0].exit.id, 'm3')
  assert.equal(visits[1].key, 'm1')
  assert.equal(visits[1].open, true)
})

test('the summary counts visits, days per context, and the current state', () => {
  const now = Date.parse('2026-07-10T06:00:00Z')
  const visits = buildEquipmentVisits([
    movement('s1', 'entry', '2026-07-01T06:00:00Z'),
    movement('s2', 'exit', '2026-07-05T06:00:00Z'),
    movement('w1', 'entry', '2026-07-06T06:00:00Z', { context: 'workshop' }),
    movement('w2', 'exit', '2026-07-08T06:00:00Z', { context: 'workshop' }),
    movement('s3', 'entry', '2026-07-09T06:00:00Z'),
  ])

  const summary = summarizeVisits(visits, now)
  assert.equal(summary.status, 'inside_site')
  assert.equal(summary.visitCount, 3)
  // 4 closed days plus 1 day of the still-open visit.
  assert.equal(summary.siteDays, 5)
  assert.equal(summary.workshopDays, 2)
  assert.equal(summary.lastMovementAt, '2026-07-09T06:00:00Z')
})

test('an open workshop visit reports the workshop as the current state', () => {
  const now = Date.parse('2026-08-02T06:00:00Z')
  const visits = buildEquipmentVisits([
    movement('w1', 'entry', '2026-08-01T06:00:00Z', {
      context: 'workshop',
      purpose: 'parking',
    }),
  ])
  assert.equal(summarizeVisits(visits, now).status, 'inside_workshop')
})

test('an empty history summarizes as outside with nothing counted', () => {
  const summary = summarizeVisits(buildEquipmentVisits([]))
  assert.equal(summary.status, 'outside')
  assert.equal(summary.visitCount, 0)
  assert.equal(summary.siteDays, 0)
  assert.equal(summary.workshopDays, 0)
  assert.equal(summary.lastMovementAt, null)
})

test('a visit shorter than a day still counts as one day', () => {
  assert.equal(msToDays(0), 0)
  assert.equal(msToDays(60 * 1000), 1)
  assert.equal(msToDays(DAY), 1)
  assert.equal(msToDays(3 * DAY), 3)
})

// Outside gaps: periods the equipment is outside both site and workshop,
// between one visit's exit and the next visit's entry.

test('a multi-day gap between two closed visits uses day-after/day-before boundaries', () => {
  // The owner's own example: exit 10-9, next entry 20-9 -> gap 11-9..19-9 (9 days).
  // The second visit is left open (still inside) so there is no trailing gap
  // to isolate this closed gap from.
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    movement('m3', 'entry', '2026-09-20T06:00:00Z'),
  ])

  const gaps = buildOutsideGaps(visits)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startDayKey, '2026-09-11')
  assert.equal(gaps[0].endDayKey, '2026-09-19')
  assert.equal(gaps[0].days, 9)
  assert.equal(gaps[0].open, false)
})

test('a next-day re-entry produces no gap', () => {
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    // Re-enters the very next calendar day: zero full days outside.
    movement('m3', 'entry', '2026-09-11T06:00:00Z'),
  ])

  assert.equal(buildOutsideGaps(visits).length, 0)
})

test('a same-day re-entry also produces no gap', () => {
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    movement('m3', 'entry', '2026-09-10T18:00:00Z'),
  ])

  assert.equal(buildOutsideGaps(visits).length, 0)
})

test('the trailing gap after the last exit is open-ended through today', () => {
  const now = Date.parse('2026-09-15T06:00:00Z')
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
  ])

  const gaps = buildOutsideGaps(visits, now)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startDayKey, '2026-09-11')
  assert.equal(gaps[0].endDayKey, null)
  assert.equal(gaps[0].open, true)
  assert.equal(gaps[0].days, 5)
})

test('an open visit never trails a gap: the equipment reads as still inside', () => {
  const now = Date.parse('2026-09-20T06:00:00Z')
  // Immediate next-day re-entry, then never exits again: no gap before it
  // (next-day re-entry) and no fabricated gap after it (it is still open).
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    movement('m3', 'entry', '2026-09-11T06:00:00Z'),
  ])

  assert.equal(buildOutsideGaps(visits, now).length, 0)
})

test('a workshop visit between two site visits is not a gap when transitions are immediate', () => {
  const visits = buildEquipmentVisits([
    movement('s1', 'entry', '2026-09-01T06:00:00Z'),
    // Straight from the site into the workshop the same day: no gap.
    movement('s2', 'exit', '2026-09-05T06:00:00Z'),
    movement('w1', 'entry', '2026-09-05T09:00:00Z', {
      context: 'workshop',
      purpose: 'maintenance',
    }),
    // Nine days in the workshop, then straight back onto a site: still no
    // gap, even though the two SITE visits are nine days apart.
    movement('w2', 'exit', '2026-09-14T06:00:00Z', { context: 'workshop' }),
    movement('s3', 'entry', '2026-09-14T09:00:00Z'),
  ])

  assert.equal(buildOutsideGaps(visits).length, 0)
})

test('a workshop visit between two site visits still surfaces a real gap around it', () => {
  const visits = buildEquipmentVisits([
    movement('s1', 'entry', '2026-09-01T06:00:00Z'),
    movement('s2', 'exit', '2026-09-05T06:00:00Z'),
    // The workshop entry is four days later: that time outside is a real gap.
    movement('w1', 'entry', '2026-09-09T06:00:00Z', {
      context: 'workshop',
      purpose: 'parking',
    }),
    movement('w2', 'exit', '2026-09-11T06:00:00Z', { context: 'workshop' }),
    movement('s3', 'entry', '2026-09-11T09:00:00Z'),
  ])

  const gaps = buildOutsideGaps(visits)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startDayKey, '2026-09-06')
  assert.equal(gaps[0].endDayKey, '2026-09-08')
  assert.equal(gaps[0].days, 3)
})

test('the Saudi calendar day rolls over at 21:00 UTC, not at UTC midnight', () => {
  // 21:30 UTC is 00:30 Saudi time the next day, so the exit's Saudi day is
  // 9-11, not 9-10; the gap must start the day after that (9-12).
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T21:30:00Z'),
    movement('m3', 'entry', '2026-09-13T06:00:00Z'),
  ])

  const gaps = buildOutsideGaps(visits)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startDayKey, '2026-09-12')
  assert.equal(gaps[0].endDayKey, '2026-09-12')
  assert.equal(gaps[0].days, 1)
})

test('summarizeVisits totals gapDays across every gap, including the open one', () => {
  const now = Date.parse('2026-09-25T06:00:00Z')
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    movement('m3', 'entry', '2026-09-20T06:00:00Z'),
    movement('m4', 'exit', '2026-09-22T06:00:00Z'),
  ])

  // Closed gap 9-11..9-19 (9 days) plus the open trailing gap from 9-23
  // through 9-25 (3 days).
  assert.equal(summarizeVisits(visits, now).gapDays, 12)
})

test('buildTimelineItems merges gaps and visits newest-first', () => {
  const visits = buildEquipmentVisits([
    movement('m1', 'entry', '2026-09-01T06:00:00Z'),
    movement('m2', 'exit', '2026-09-10T06:00:00Z'),
    movement('m3', 'entry', '2026-09-20T06:00:00Z'),
    movement('m4', 'exit', '2026-09-25T06:00:00Z'),
  ])

  const items = buildTimelineItems(visits, Date.parse('2026-09-25T06:00:00Z'))
  assert.equal(items.map((item) => item.kind).join('|'), 'visit|gap|visit')
  // Newest first: the most recent visit comes before the gap that precedes it.
  assert.equal(items[0].visit.key, 'm3')
  assert.equal(items[1].gap.days, 9)
  assert.equal(items[2].visit.key, 'm1')
})
