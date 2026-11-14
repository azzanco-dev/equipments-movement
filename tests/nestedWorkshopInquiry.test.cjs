const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Nested workshop stays, the screen side of part 2 (owner 2026-11-14): a
// project visit stays open until work is completed and a workshop stay is a
// stop inside it. The inquiry shows one visit with its stops, the gaps count
// only days no visit covers, the admin home and «المعدات في المشاريع» mark a
// unit that is in the workshop while its project visit is open. Made-up
// movements, no network.
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

const saudi = (date, hour = 9) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (hour - 3) * 3_600_000).toISOString()
let seq = 0
const move = (context, type, date, extra = {}) => ({
  id: `m${String(++seq).padStart(3, '0')}`,
  movement_context: context,
  movement_type: type,
  recorded_at: saudi(date),
  ...extra,
})
const visitsOf = (...movements) => timeline.buildEquipmentVisits(movements)
const dayKeys = (gaps) => Array.from(gaps).map((gap) => `${gap.startDayKey}..${gap.endDayKey}:${gap.days}`)

// 2026-11-14 09:00 Saudi time.
const NOW = Date.parse(saudi('2026-11-14'))

// N1: project entry 1 Sep, workshop 3 Oct -> 8 Oct, the project visit open.
function n1() {
  return visitsOf(
    move('site', 'entry', '2026-09-01', { project_name: 'P' }),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2026-10-08'),
  )
}
// N2: N1, then the project exit 20 Oct.
function n2() {
  return visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2026-10-08'),
    move('site', 'exit', '2026-10-20'),
  )
}
// N3: the project exit 5 Oct while the unit is in the workshop, the workshop
// exit 8 Oct.
function n3() {
  return visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('site', 'exit', '2026-10-05'),
    move('workshop', 'exit', '2026-10-08'),
  )
}

test('gaps: N1 has none while the project visit is open, and no trailing stretch', () => {
  assert.equal(timeline.buildOutsideGaps(n1(), NOW).length, 0)
})

test('gaps: N2 keeps the unit in the project to 20 Oct, a later entry gaps from there', () => {
  const visits = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2026-10-08'),
    move('site', 'exit', '2026-10-20'),
    move('site', 'entry', '2026-11-01'),
  )
  // Not 9 Oct -> 31 Oct: the project covered the days to 20 Oct.
  assert.deepEqual(dayKeys(timeline.buildOutsideGaps(visits, NOW)), ['2026-10-21..2026-10-31:11'])
  // Closed N2 alone: the trailing stretch counts from the furthest end (20 Oct).
  const trailing = timeline.buildOutsideGaps(n2(), NOW)
  assert.equal(trailing.length, 1)
  assert.equal(trailing[0].open, true)
  assert.equal(trailing[0].startDayKey, '2026-10-21')
})

test('gaps: N3 ends at the later workshop exit (8 Oct), not the project exit', () => {
  const visits = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('site', 'exit', '2026-10-05'),
    move('workshop', 'exit', '2026-10-08'),
    move('site', 'entry', '2026-10-15'),
  )
  assert.deepEqual(dayKeys(timeline.buildOutsideGaps(visits, NOW)), ['2026-10-09..2026-10-14:6'])
})

test('gaps: serial data keeps today\'s gaps and an open visit never trails', () => {
  const serial = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('site', 'exit', '2026-09-10'),
    move('workshop', 'entry', '2026-09-12', { workshop_purpose: 'parking' }),
    move('workshop', 'exit', '2026-09-14'),
    move('site', 'entry', '2026-09-20'),
  )
  assert.deepEqual(dayKeys(timeline.buildOutsideGaps(serial, NOW)), [
    '2026-09-11..2026-09-11:1',
    '2026-09-15..2026-09-19:5',
  ])
  // The gap items still sit between their visits, newest first.
  const items = timeline.buildTimelineItems(serial, NOW)
  assert.equal(items.map((item) => item.kind).join('|'), 'visit|gap|visit|gap|visit')
})

test('a nested stop is omitted from the items, its gap stays', () => {
  const visits = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-10-03', { workshop_purpose: 'maintenance' }),
    move('site', 'exit', '2026-10-05'),
    move('workshop', 'exit', '2026-10-08'),
    move('site', 'entry', '2026-10-15'),
  )
  const { nestedKeys } = timeline.groupWorkshopStops(visits)
  const items = timeline.buildTimelineItems(visits, NOW, nestedKeys)
  assert.equal(items.map((item) => item.kind).join('|'), 'visit|gap|visit')
  assert.equal(items[1].gap.days, 6)
  assert.equal(items[2].visit.exit.recorded_at, saudi('2026-10-05'))
})

test('grouping: a stop that started inside a project visit nests, serial data does not', () => {
  const { nestedKeys, stopsByVisit } = timeline.groupWorkshopStops(n1())
  assert.equal(nestedKeys.size, 1)
  assert.equal(stopsByVisit.size, 1)
  const stops = [...stopsByVisit.values()][0]
  assert.equal(stops.length, 1)
  assert.equal(stops[0].context, 'workshop')

  // N3: started before the project exit, so nested although it ends after.
  assert.equal(timeline.groupWorkshopStops(n3()).nestedKeys.size, 1)

  // Old data: the project exit «للصيانة», then a separate workshop visit.
  const old = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('site', 'exit', '2026-09-10', { exit_purpose: 'maintenance' }),
    move('workshop', 'entry', '2026-09-11', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2026-09-15'),
  )
  assert.equal(timeline.groupWorkshopStops(old).nestedKeys.size, 0)

  // Newest stop first, and only the stops of THAT visit.
  const two = visitsOf(
    move('site', 'entry', '2026-09-01'),
    move('workshop', 'entry', '2026-09-05', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2026-09-07'),
    move('workshop', 'entry', '2026-09-20', { workshop_purpose: 'parking' }),
    move('workshop', 'exit', '2026-09-22'),
    move('site', 'exit', '2026-10-01'),
    move('site', 'entry', '2026-10-10'),
    move('workshop', 'entry', '2026-10-12', { workshop_purpose: 'out_of_service' }),
  )
  const grouped = timeline.groupWorkshopStops(two)
  assert.equal(grouped.nestedKeys.size, 3)
  const first = two.find((visit) => visit.context === 'site' && visit.exit)
  const second = two.find((visit) => visit.context === 'site' && visit.open)
  assert.equal(grouped.stopsByVisit.get(first.key).length, 2)
  assert.equal(grouped.stopsByVisit.get(first.key)[0].entry.workshop_purpose, 'parking')
  assert.equal(grouped.stopsByVisit.get(second.key).length, 1)
})

test('nested workshop days: whole days per stop, clipped to the project visit', () => {
  const visits = n3()
  const project = visits.find((visit) => visit.context === 'site')
  const stops = timeline.groupWorkshopStops(visits).stopsByVisit.get(project.key)
  // 3 -> 5 Oct (the project exit) = 2 days, not the 5 days to 8 Oct.
  assert.equal(timeline.nestedWorkshopDays(project, stops, NOW), 2)
  const open = n1()
  const openProject = open.find((visit) => visit.context === 'site')
  const openStops = timeline.groupWorkshopStops(open).stopsByVisit.get(openProject.key)
  assert.equal(timeline.nestedWorkshopDays(openProject, openStops, NOW), 5)
})

test('summarizeVisits counts a nested stop once, as workshop', () => {
  const summary = timeline.summarizeVisits(n1(), NOW)
  const projectDays = Math.round((NOW - Date.parse(saudi('2026-09-01'))) / 86_400_000)
  assert.equal(summary.workshopDays, 5)
  assert.equal(summary.siteDays, projectDays - 5)
  assert.equal(summary.status, 'inside_site')
  assert.equal(summary.gapDays, 0)
})

test('the open visit line: from its first day shown to today, with its days', () => {
  const visits = n1()
  const days = year.inquiryYearDays(visits, Date.parse(saudi('2026-01-01')), NOW, 2026)
  const { stopsByVisit } = timeline.groupWorkshopStops(visits)
  const line = year.inquiryOpenVisitLine(days, visits, stopsByVisit, NOW)
  assert.ok(line)
  const firstDay = days[0].day
  assert.equal(line.startPosition, year.saudiDay(Date.parse(saudi('2026-09-01'))) - firstDay)
  assert.equal(line.endPosition, year.saudiDay(NOW) - firstDay)
  // 1 Sep through 14 Nov: 30 + 31 + 14 = 75 days; the stop covers 3 -> 8 Oct.
  assert.equal(line.totalDays, 75)
  assert.equal(line.workshopDays, 6)
  // The same days the strip colours as workshop.
  const stripWorkshop = days.filter((day) => day.state === 'maintenance').length
  assert.equal(stripWorkshop, line.workshopDays)
  assert.equal(line.visit.open, true)
})

test('the open visit line: none without stops, for a closed project visit, or outside the year', () => {
  const plain = visitsOf(move('site', 'entry', '2026-09-01'))
  const plainDays = year.inquiryYearDays(plain, Date.parse(saudi('2026-01-01')), NOW, 2026)
  assert.equal(
    year.inquiryOpenVisitLine(plainDays, plain, timeline.groupWorkshopStops(plain).stopsByVisit, NOW),
    null,
  )
  const closed = n2()
  const closedDays = year.inquiryYearDays(closed, Date.parse(saudi('2026-01-01')), NOW, 2026)
  assert.equal(
    year.inquiryOpenVisitLine(closedDays, closed, timeline.groupWorkshopStops(closed).stopsByVisit, NOW),
    null,
  )
  // A past year the open visit has not reached yet.
  const visits = n1()
  const past = year.inquiryYearDays(visits, Date.parse(saudi('2025-01-01')), NOW, 2025)
  assert.equal(
    year.inquiryOpenVisitLine(past, visits, timeline.groupWorkshopStops(visits).stopsByVisit, NOW),
    null,
  )
})

test('a project visit opened in an earlier year still colours the year', () => {
  // The screen reads the latest movement before the window PER CONTEXT: the
  // project entry (2025) is kept although a workshop exit (2025) is later.
  const visits = visitsOf(
    move('site', 'entry', '2025-12-01'),
    move('workshop', 'entry', '2025-12-10', { workshop_purpose: 'maintenance' }),
    move('workshop', 'exit', '2025-12-20'),
  )
  const days = year.inquiryYearDays(visits, Date.parse(saudi('2025-01-01')), NOW, 2026)
  assert.equal(days[0].state, 'site')
  assert.equal(days[days.length - 1].state, 'future')
})

test('the screen reads the open visits and merges their entries by id', () => {
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  assert.match(screen, /parseEquipmentPresence\(presenceResult\.data\)/)
  assert.match(screen, /if \(!presence\) setInquiryState\('error'\)/)
  assert.doesNotMatch(screen, /get_last_movement|equipmentStateFromMovement/)
  assert.match(screen, /equipmentStateFromPresence\(\{/)
  assert.match(screen, /lastMovementAt: Number\.isFinite\(lastAt\) \? lastAt : null,\s+presence,/)
  // The year read: the movement before the window per context.
  assert.match(screen, /\.eq\('movement_context', context\)/)
  // The open entries are fetched by id when the first page lacks them.
  assert.match(screen, /openPresence\.siteEntryId, openPresence\.workshopEntryId/)
  assert.match(screen, /\.in\('id', missing\)/)
  assert.match(screen, /setMovementsError\(true\)/)
  // Paging never doubles a merged row.
  assert.match(screen, /rows\.filter\(\(row\) => !known\.has\(row\.id\)\)/)
  // The open visit line comes from the history's visits and their stops.
  assert.match(screen, /inquiryOpenVisitLine\(\s+days,\s+visits,\s+groupWorkshopStops\(visits\)\.stopsByVisit,\s+now,\s+\)/)
})

test('«الحين»: the project nested in the workshop box, and the return line', () => {
  const now = read('src', 'components', 'inquiry', 'InquiryNow.tsx')
  assert.match(now, /groupWorkshopStops\(visits\)\.stopsByVisit\.get\(openSite\.key\)/)
  assert.match(now, /className="mt-4 space-y-2\.5 rounded-xl p-3\.5"/)
  assert.match(now, /style=\{\{ backgroundColor: siteTone\.fill \}\}/)
  assert.match(now, /<InquiryIconTile colors=\{siteTone\} size=\{30\}>/)
  assert.match(now, /t\('inquiryNestedUnder'\)/)
  assert.match(now, /t\('inquiryOpenVisit'\)/)
  assert.match(now, /style=\{inquiryInnerFill\(siteTone\)\}/)
  // The line after a stop: wrench, 12 px, medium, the stop state's stroke.
  assert.match(now, /t\('inquiryReturnedFromWorkshop'\)/)
  assert.match(now, /text-xs font-medium/)
  assert.match(now, /<Wrench size=\{13\}/)
  // The reader whose access hides the visits: the presence row's project.
  assert.match(now, /presence\?\.siteOpen && \(presence\.siteProjectNameAr \|\| presence\.siteProjectNameEn\)/)
  assert.match(now, /underProject = presenceProject/)
})

test('«سجل الزيارات»: the stops inside the project tile, anchored for the strip', () => {
  const journey = read('src', 'components', 'inquiry', 'InquiryJourney.tsx')
  assert.match(journey, /const \{ nestedKeys, stopsByVisit \} = groupWorkshopStops\(visits\)/)
  assert.match(journey, /stops=\{stopsByVisit\.get\(item\.visit\.key\)\}/)
  assert.match(journey, /id=\{inquiryVisitAnchor\(stop\.key\)\}/)
  assert.match(journey, /highlightedKey === stop\.key/)
  assert.match(journey, /t\('inquiryWorkshopStops'\)\.replace\('\{count\}', String\(stops\.length\)\)/)
  assert.match(journey, /t\('inquiryStopOpenNow'\)/)
  assert.match(journey, /inquiryNestedWorkshopDays/)
  assert.match(journey, /t\(site \? 'inquiryVisitStillOpen' : 'inquiryStillInside'\)/)
  // The count in the header stays the number of all visits.
  assert.match(journey, /String\(visits\.length\)/)
})

test('the year strip draws the open visit line with its caption', () => {
  const strip = read('src', 'components', 'inquiry', 'InquiryYear.tsx')
  assert.match(strip, /openVisitLine\?: InquiryOpenVisitLine \| null/)
  assert.match(strip, /className="relative h-\[3px\]"/)
  assert.match(strip, /t\('inquiryYearOpenVisitCaption'\)/)
  assert.match(strip, /\.replace\('\{workshop\}', String\(openVisitLine\.workshopDays\)\)/)
})

test('admin home: the row parser, the workshop tabs and the workshop table', () => {
  const stats = read('src', 'lib', 'adminHomeStats.ts')
  assert.match(stats, /siteProjectNameAr: optionalText\(row, 'site_project_name_ar'\)/)
  assert.match(stats, /siteCompanyNameEn: optionalText\(row, 'site_company_name_en'\)/)
  const line = read('src', 'components', 'admin-home', 'NestedProjectLine.tsx')
  assert.match(line, /t\('nestedUnderProjectLine'\)/)
  assert.match(line, /if \(!row\.siteProjectNameAr && !row\.siteProjectNameEn\) return null/)
  assert.match(line, /block text-xs text-muted/)
  assert.match(read('src', 'components', 'admin-home', 'WorkshopCard.tsx'), /<NestedProjectLine row=\{row\} \/>/)
  const tables = read('src', 'components', 'admin-home', 'FleetMiniTables.tsx')
  assert.match(tables, /const workshopColumns = \[\s+workshopCodeColumn,/)
  assert.match(tables, /<NestedProjectLine row=\{row\} \/>/)
})

test('admin home: a database without the columns shows nothing', () => {
  const file = path.join(root, 'src', 'lib', 'adminHomeStats.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  const stubs = {
    '@/lib/exitPurpose': { exitPurposeOrNull: (value) => value ?? null },
  }
  vm.runInContext(
      `(function (exports, require) {${output}\n})`,
      vm.createContext({}),
      { filename: file },
  )(exports, (requested) => {
    if (stubs[requested]) return stubs[requested]
    return new Proxy({}, { get: () => () => null })
  })
  const rows = exports.parseFleetEquipmentRows([
    { id: 'u1', code: 'A1', type: 'T', ownership_status: 'alazani' },
    {
      id: 'u2',
      code: 'A2',
      type: 'T',
      ownership_status: 'alazani',
      site_project_name_ar: 'الدرعية',
      site_project_name_en: null,
    },
  ])
  assert.equal(rows[0].siteProjectNameAr, null)
  assert.equal(rows[0].siteCompanyNameAr, null)
  assert.equal(rows[1].siteProjectNameAr, 'الدرعية')
  assert.equal(rows[1].siteProjectNameEn, null)
})

test('«المعدات في المشاريع»: the «في الورشة» badge on an open visit only', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  const select = /export const SITE_UNITS_SELECT =\s+'([^']+)'/.exec(data)[1].split(',')
  assert.ok(select.includes('in_workshop'))
  assert.match(data, /in_workshop\?: boolean \| null/)
  const screen = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(
    screen,
    /row\.visit_state !== 'exited' && row\.in_workshop === true && \(\s+<Badge tone="warning" size="sm">\s+\{t\('siteUnitInWorkshopBadge'\)\}/,
  )
})

test('the new keys exist in both languages, the Arabic without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'inquiryNestedUnder',
    'inquiryOpenVisit',
    'inquiryVisitStillOpen',
    'inquiryReturnedFromWorkshop',
    'inquiryYearOpenVisitCaption',
    'inquiryWorkshopStops',
    'inquiryStopOpenNow',
    'inquiryStopUntilNow',
    'inquiryNestedWorkshopDays',
    'inquiryNestedWorkshopDaysOne',
    'nestedUnderProjectLine',
    'siteUnitInWorkshopBadge',
  ]) {
    const matches = source.match(new RegExp(`^\\s+${key}: '(.*)',$`, 'gm')) ?? []
    assert.equal(matches.length, 2, `${key} in Arabic and English`)
    const arabic = /: '(.*)',$/.exec(matches[0])[1]
    assert.doesNotMatch(arabic, /[أإآ]/, `${key} has no hamza`)
  }
})
