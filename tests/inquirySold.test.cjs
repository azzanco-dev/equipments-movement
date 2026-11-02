const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The inquiry page shows a SOLD unit as sold and the code changes as events
// (owner 2026-11-02, «ابغى اضمّن البيعات والتحويلات في صفحة الاستعلام»):
// «مباعة» is the final state from the last recorded exit — no sale date
// («مو شرط تاريخ البيع، من تاريخ اخر خروج … تكون اخر حالة مباعة») — and
// every row of `equipment_code_changes` is a dated event on «الرحلة» and a
// marker on the year strip. Made-up movements, no network.
const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

function load(name) {
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInContext(
    `(function (exports, require) {${output}\n})`,
    vm.createContext({}),
    { filename: file },
  )(exports, (requested) => {
    throw new Error(`Unexpected module: ${requested}`)
  })
  return exports
}

const year = load('inquiryYear')
const timeline = load('visitTimeline')
const plain = (value) => JSON.parse(JSON.stringify(value))

// 2026-10-26 09:00 Saudi time.
const NOW = Date.parse('2026-10-26T06:00:00Z')
const saudi = (date, hour = 9) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (hour - 3) * 3_600_000).toISOString()
let seq = 0
const move = (context, type, date, extra = {}) => ({
  id: `m${++seq}`,
  movement_context: context,
  movement_type: type,
  recorded_at: saudi(date),
  ...extra,
})
const change = (id, from, to, date, reason = null) => ({
  id,
  equipment_id: 'e1',
  old_code: from,
  new_code: to,
  changed_at: saudi(date, 14),
  reason,
})
const dayOf = (days, date) =>
  days.find((day) => day.day === year.saudiDay(Date.parse(saudi(date))))

test('only status = sold is sold; «منتهية» and active units are untouched', () => {
  assert.equal(year.inquirySoldOf('rental_ended', Date.parse(saudi('2026-03-01'))), null)
  assert.equal(year.inquirySoldOf('active', Date.parse(saudi('2026-03-01'))), null)
  assert.equal(year.inquirySoldOf(null, null), null)
  assert.equal(year.inquirySoldOf(undefined, 5), null)
  const at = Date.parse(saudi('2026-03-15'))
  assert.deepEqual(plain(year.inquirySoldOf('sold', at)), { since: at })
  // No movement at all: sold without a start.
  assert.deepEqual(plain(year.inquirySoldOf('sold', null)), { since: null })
  assert.deepEqual(plain(year.inquirySoldOf('sold', NaN)), { since: null })
  assert.ok(year.INQUIRY_STATE_ORDER.includes('sold'))
  assert.equal(year.INQUIRY_STATE_ORDER[year.INQUIRY_STATE_ORDER.length - 1], 'sold')
})

test('a sold unit is «مباعة» from its last exit through today', () => {
  const visits = timeline.buildEquipmentVisits([
    move('site', 'entry', '2026-01-10'),
    move('site', 'exit', '2026-03-15', { exit_purpose: 'work_completed' }),
  ])
  const firstAt = Date.parse(saudi('2026-01-10'))
  const lastAt = Date.parse(saudi('2026-03-15'))
  const sold = year.inquirySoldOf('sold', lastAt)
  const days = year.inquiryYearDays(visits, firstAt, NOW, 2026, sold)
  assert.equal(dayOf(days, '2026-01-09').state, 'before')
  assert.equal(dayOf(days, '2026-01-10').state, 'site')
  assert.equal(dayOf(days, '2026-03-14').state, 'site')
  // The exit day itself: the later state wins, as between two stays.
  assert.equal(dayOf(days, '2026-03-15').state, 'sold')
  assert.equal(dayOf(days, '2026-03-15').visit, null)
  assert.equal(dayOf(days, '2026-10-26').state, 'sold')
  assert.equal(dayOf(days, '2026-10-27').state, 'future')
  const summary = plain(year.summarizeInquiryYear(days))
  assert.equal(summary.siteDays, 64)
  assert.equal(summary.unrecordedDays, 0)
  assert.equal(summary.soldDays, year.saudiDay(NOW) - year.saudiDay(lastAt) + 1)
  assert.equal(summary.counts.sold, summary.soldDays)
  assert.equal(summary.counted, summary.siteDays + summary.soldDays)
  assert.equal(summary.visitCount, 1)
  // The same movements without the sale: «بدون تسجيل» after the exit, as
  // before («منتهية» goes this way too).
  const plainDays = year.inquiryYearDays(visits, firstAt, NOW, 2026)
  assert.equal(dayOf(plainDays, '2026-03-15').state, 'site')
  assert.equal(dayOf(plainDays, '2026-03-16').state, 'unrecorded')
  assert.equal(year.summarizeInquiryYear(plainDays).soldDays, 0)
  assert.deepEqual(
    plain(year.inquiryYearDays(visits, firstAt, NOW, 2026, year.inquirySoldOf('rental_ended', lastAt))),
    plain(plainDays),
  )
})

test('a sale before the year, or with no movement, covers every counted day', () => {
  // Sold after an exit in 2025: all of 2026 through today is sold.
  const visits = timeline.buildEquipmentVisits([
    move('site', 'entry', '2025-06-01'),
    move('site', 'exit', '2025-12-20', { exit_purpose: 'work_completed' }),
  ])
  const firstAt = Date.parse(saudi('2025-06-01'))
  const days = year.inquiryYearDays(
    visits,
    firstAt,
    NOW,
    2026,
    year.inquirySoldOf('sold', Date.parse(saudi('2025-12-20'))),
  )
  assert.ok(days.every((day) => day.state === 'sold' || day.state === 'future'))
  // The year of the exit: the stay, then sold from the exit day.
  const past = year.inquiryYearDays(
    visits,
    firstAt,
    NOW,
    2025,
    year.inquirySoldOf('sold', Date.parse(saudi('2025-12-20'))),
  )
  assert.equal(dayOf(past, '2025-12-19').state, 'site')
  assert.equal(dayOf(past, '2025-12-20').state, 'sold')
  assert.equal(dayOf(past, '2025-12-31').state, 'sold')
  // Never moved: counting starts at the creation and every day is sold.
  const created = Date.parse(saudi('2026-08-25', 11))
  const none = year.inquiryYearDays([], year.inquiryCountFrom(NaN, created), NOW, 2026, {
    since: null,
  })
  assert.equal(dayOf(none, '2026-08-24').state, 'before')
  assert.equal(dayOf(none, '2026-08-25').state, 'sold')
  assert.equal(dayOf(none, '2026-10-26').state, 'sold')
  assert.equal(year.summarizeInquiryYear(none).unrecordedDays, 0)
  assert.equal(
    year.summarizeInquiryYear(none).soldDays,
    year.saudiDay(NOW) - year.saudiDay(created) + 1,
  )
  // The months carry the sold count too.
  const months = plain(year.inquiryYearMonths(none))
  assert.equal(months[9].counts.sold, 26)
  assert.equal(months[7].counts.sold, 7)
})

test('code changes mark their day on the strip; outside the year they are skipped', () => {
  const days = year.inquiryYearDays([], Date.parse(saudi('2026-01-01')), NOW, 2026)
  const changes = [
    change('c3', 'A128', 'A228', '2026-09-01'),
    change('c1', 'A028', 'A128', '2026-02-10', 'ترقيم جديد'),
    change('c0', 'A001', 'A028', '2025-11-05'),
    change('c9', 'X', 'Y', '2027-01-01'),
    { ...change('c8', 'X', 'Y', '2026-05-05'), changed_at: 'not a date' },
  ]
  const markers = year.inquiryYearMarkers(changes, days)
  // `plain`: the arrays come from the vm realm.
  assert.deepEqual(plain(markers.map((marker) => marker.change.id)), ['c1', 'c3'])
  assert.equal(markers[0].position, 31 + 9)
  assert.equal(markers[0].day, year.saudiDay(Date.parse(saudi('2026-02-10'))))
  assert.equal(days[markers[1].position].day, year.saudiDay(Date.parse(saudi('2026-09-01'))))
  // A change late in the Saudi day stays on that day.
  const late = year.inquiryYearMarkers(
    [{ ...change('c5', 'A', 'B', '2026-03-01'), changed_at: '2026-03-01T20:30:00Z' }],
    days,
  )
  assert.equal(days[late[0].position].day, year.saudiDay(Date.parse(saudi('2026-03-01'))))
  assert.deepEqual(plain(year.inquiryYearMarkers(changes, [])), [])
})

test('the journey: changes in time order among the stays, «مباعة» last', () => {
  const visits = timeline.buildEquipmentVisits([
    move('site', 'entry', '2026-01-10'),
    move('site', 'exit', '2026-03-15', { exit_purpose: 'work_completed' }),
    move('workshop', 'entry', '2026-05-01', { workshop_purpose: 'parking' }),
    move('workshop', 'exit', '2026-05-20'),
  ])
  const items = timeline.buildTimelineItems(visits, NOW)
  // Newest first: open gap, workshop stay, gap, project stay.
  assert.deepEqual(plain(items.map((item) => item.kind)), ['gap', 'visit', 'gap', 'visit'])
  const changes = [
    change('c2', 'A128', 'A228', '2026-07-01', 'تحويل للورشة'),
    change('c1', 'A028', 'A128', '2026-02-01'),
    change('c0', 'A001', 'A028', '2025-06-01'),
  ]
  const journey = year.inquiryJourneyItems(items, changes)
  assert.deepEqual(
    plain(journey.map((item) => (item.kind === 'code_change' ? `code:${item.change.id}` : item.kind))),
    // c2 during the open gap (after the workshop exit), c1 during the
    // project stay (after its entry), c0 before everything.
    ['code:c2', 'gap', 'visit', 'gap', 'visit', 'code:c1', 'code:c0'],
  )
  assert.equal(journey[0].key, 'code:c2')
  assert.equal(journey[0].sortAt, changes[0].changed_at)
  // Without changes the items are untouched.
  assert.deepEqual(plain(year.inquiryJourneyItems(items, [])), plain(items))

  // Sold: the open «بدون تسجيل» stretch goes, «مباعة» leads, the rest stays.
  const lastAt = Date.parse(saudi('2026-05-20'))
  const sold = year.inquiryJourneyItems(items, changes, year.inquirySoldOf('sold', lastAt))
  assert.deepEqual(
    plain(sold.map((item) => (item.kind === 'code_change' ? `code:${item.change.id}` : item.kind))),
    ['sold', 'code:c2', 'visit', 'gap', 'visit', 'code:c1', 'code:c0'],
  )
  assert.equal(sold[0].since, new Date(lastAt).toISOString())
  // A closed gap between two stays is kept.
  assert.equal(sold[3].kind, 'gap')
  assert.equal(sold[3].gap.open, false)
  // No movement at all: «مباعة» alone, without a date.
  const alone = year.inquiryJourneyItems([], [], { since: null })
  assert.deepEqual(plain(alone), [{ kind: 'sold', key: 'sold', sortAt: '', since: null }])
  // «منتهية» is not sold.
  assert.deepEqual(
    plain(year.inquiryJourneyItems(items, [], year.inquirySoldOf('rental_ended', lastAt))),
    plain(items),
  )
})

test('the screen reads status and the last movement, and passes them on', () => {
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  // The equipment row already carried `status`; the last movement's instant
  // comes from `get_last_movement` (SECURITY DEFINER, like the state).
  assert.match(screen, /created_at,ownership_status,status,lessor:lessors\(id,name\)/)
  assert.match(screen, /recorded_at: string \| null\s+\}> \| null/)
  assert.match(screen, /inquirySoldOf\(equipment\?\.status, lastMovementAt\)/)
  assert.match(screen, /inquiryYearDays\(yearVisits, countFrom, now, selectedYear, sold\)/)
  assert.match(screen, /markers: inquiryYearMarkers\(codeChanges, days\)/)
  assert.match(screen, /<InquiryNow visits=\{visits\} state=\{state\} now=\{now\} sold=\{sold\} \/>/)
  assert.match(screen, /markers=\{year\.markers\}/)
  assert.match(screen, /codeChanges=\{codeChanges\}\s+sold=\{sold\}/)
  // The header: «مباعة» over the derived state; «منتهية» still through the
  // shared badge.
  assert.match(screen, /\) : sold \? \([\s\S]*?t\('equipmentStatusSold'\)[\s\S]*?<EquipmentStateBadge state=\{state\} assetStatus=\{equipment\.status\} \/>/)
  // The year section shows for a sold unit without movements too.
  assert.match(screen, /\{\(visits\.length > 0 \|\| sold\) && \(/)

  const now = read('src', 'components', 'inquiry', 'InquiryNow.tsx')
  assert.match(now, /if \(sold\) \{\s+key = 'sold'/)
  assert.match(now, /t\('inquirySoldNoMovements'\)/)
  const journey = read('src', 'components', 'inquiry', 'InquiryJourney.tsx')
  assert.match(journey, /inquiryJourneyItems\(buildTimelineItems\(visits, now\), codeChanges, sold\)/)
  assert.match(journey, /item\.kind === 'code_change' \?/)
  assert.match(journey, /<SoldTile since=\{item\.since\} \/>/)
  assert.match(journey, /t\('inquiryCodeChangeReason'\)/)
  const strip = read('src', 'components', 'inquiry', 'InquiryYear.tsx')
  // A 2 px line on the day with the change as its tooltip.
  assert.match(strip, /markers\.map\(\(marker\) => \{[\s\S]*?title=\{label\}[\s\S]*?w-0\.5/)
  assert.match(strip, /insetInlineStart: `calc\(\$\{pct\(marker\.position\)\}% - 1px\)`/)
})

test('the look: tokens only, flat, Arabic without hamza', () => {
  const style = read('src', 'components', 'inquiry', 'inquiryStyle.tsx')
  assert.match(
    style,
    /sold: \{\s+fill: 'color-mix\(in srgb, var\(--chart-stroke-4\) 30%, var\(--bg\)\)',\s+tint: 'color-mix\(in srgb, var\(--chart-stroke-4\) 55%, var\(--bg\)\)',\s+stroke: 'var\(--chart-text\)',\s+\}/,
  )
  assert.match(style, /sold: 'equipmentStatusSold'/)
  const files = [
    style,
    read('src', 'lib', 'inquiryYear.ts'),
    read('src', 'components', 'inquiry', 'InquiryJourney.tsx'),
    read('src', 'components', 'inquiry', 'InquiryYear.tsx'),
    read('src', 'components', 'inquiry', 'InquiryNow.tsx'),
    read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
  ]
  for (const file of files) {
    assert.doesNotMatch(file, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(
      file,
      /\b(?:bg|text|border|ring|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|green|emerald|amber|blue|sky|indigo|violet|yellow|orange)-\d{2,3}\b/,
    )
    assert.doesNotMatch(file, /linear-gradient|radial-gradient/)
    // No new coloured border on the tiles.
    assert.doesNotMatch(file, /border(?:Color)?:\s*['"`]?(?:var|color-mix)/)
    // Logical direction utilities only.
    assert.doesNotMatch(file, /\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-\d/)
  }
  const source = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'inquirySoldNoMovements',
    'inquirySoldSinceExit',
    'inquiryCodeChange',
    'inquiryCodeChanges',
    'inquiryCodeChangeReason',
  ]) {
    const values = [...source.matchAll(new RegExp(`\\n\\s+${key}: '([^']*)'`, 'g'))]
    assert.equal(values.length, 2, key)
    assert.doesNotMatch(values[0][1], /[أإآ]/, key)
  }
  // The decisions are written down for the next agent.
  const agents = read('AGENTS.md')
  assert.match(agents, /مو شرط تاريخ البيع/)
  assert.match(agents, /equipment_code_changes[^\n]*«الرحلة»|«الرحلة»[^\n]*equipment_code_changes/)
})
