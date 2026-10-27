const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The inquiry page redesign (owner 2026-10-26, approved on /ui-kit, the
// month rings chosen): the last 12 months as Saudi days, and the screen's
// main rules. Made-up movements, no network.
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
const DAY = 86_400_000
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

test('the window is 365 Saudi days ending today', () => {
  const start = year.inquiryYearStart(NOW)
  // Saudi midnight = 21:00 UTC the day before.
  assert.equal(new Date(start).toISOString(), '2025-10-26T21:00:00.000Z')
  const days = year.inquiryYearDays([], NaN, NOW)
  assert.equal(days.length, 365)
  assert.equal(days[364].day, year.saudiDay(NOW))
  assert.ok(days.every((day) => day.state === 'unrecorded'))
})

test('stays colour their days, later stays win, before creation stays blank', () => {
  const visits = timeline.buildEquipmentVisits([
    move('site', 'entry', '2026-01-10'),
    move('site', 'exit', '2026-01-20', { exit_purpose: 'maintenance' }),
    move('workshop', 'entry', '2026-01-20', { workshop_purpose: 'parking' }),
    move('workshop', 'exit', '2026-01-25'),
    move('workshop', 'entry', '2026-10-20', { workshop_purpose: 'out_of_service' }),
  ])
  const created = Date.parse('2025-12-01T00:00:00Z')
  const days = year.inquiryYearDays(visits, created, NOW)
  const at = (date) => days.find((day) => day.day === year.saudiDay(Date.parse(saudi(date))))
  assert.equal(at('2025-11-30').state, 'before')
  assert.equal(at('2025-12-05').state, 'unrecorded')
  assert.equal(at('2026-01-10').state, 'site')
  assert.equal(at('2026-01-19').state, 'site')
  // The exit day of the project is the entry day of the workshop: the
  // later stay wins.
  assert.equal(at('2026-01-20').state, 'parking')
  assert.equal(at('2026-01-25').state, 'parking')
  assert.equal(at('2026-01-26').state, 'unrecorded')
  // An open stay runs through today.
  assert.equal(at('2026-10-26').state, 'out_of_service')

  const summary = plain(year.summarizeInquiryYear(days))
  assert.equal(summary.siteDays, 10)
  assert.equal(summary.counts.parking, 6)
  assert.equal(summary.counts.out_of_service, 7)
  assert.equal(summary.workshopDays, 13)
  assert.equal(summary.visitCount, 3)
  assert.equal(summary.counted, summary.siteDays + summary.workshopDays + summary.unrecordedDays)
})

test('a stay open before the window starts colours from its first day', () => {
  const visits = timeline.buildEquipmentVisits([move('site', 'entry', '2024-11-24')])
  const days = year.inquiryYearDays(visits, Date.parse('2024-01-01'), NOW)
  assert.ok(days.every((day) => day.state === 'site'))
  assert.equal(year.summarizeInquiryYear(days).siteShare, 100)
})

test('the days group into 13 calendar months with their counts', () => {
  const days = year.inquiryYearDays([], NaN, NOW)
  const months = plain(year.inquiryYearMonths(days))
  assert.equal(months.length, 13)
  assert.deepEqual([months[0].year, months[0].month, months[0].days.length], [2025, 9, 5])
  assert.deepEqual([months[12].year, months[12].month, months[12].days.length], [2026, 9, 26])
  assert.equal(months[1].daysInMonth, 30)
  assert.equal(months[1].counts.unrecorded, 30)
  assert.equal(
    months.reduce((sum, month) => sum + month.days.length, 0),
    365,
  )
})

test('the screen: AI-style start, rings, journey in full, no filter', () => {
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  assert.match(screen, /<InquirySearch[\s\S]*?big=\{hero\}/)
  assert.match(screen, /t\('inquiryHeroTitle'\)/)
  // The strip, after the rings (owner 2026-10-27: «غير اخر 12 شهر لشريط»);
  // a stay on it opens its tile in the history.
  assert.match(
    screen,
    /<InquiryYearStrip\s+days=\{year\.days\}\s+months=\{year\.months\}\s+index=\{5\}\s+onSelectVisit=\{selectVisit\}/,
  )
  assert.doesNotMatch(screen, /<InquiryYearRings/)
  assert.match(screen, /getElementById\(inquiryVisitAnchor\(key\)\)/)
  // The last 12 months are read for the window plus the movement before it.
  assert.match(screen, /\.gte\('recorded_at', start\)/)
  assert.match(screen, /\.lt\('recorded_at', start\)[\s\S]*?\.limit\(1\)/)
  // Recent units: this browser only, and storage failures are swallowed.
  assert.match(screen, /const RECENT_KEY = 'inquiry:recent'/)
  assert.match(screen, /try \{\s+window\.localStorage\.setItem/)
  // The PO chip only for purchasing readers.
  assert.match(screen, /permissions\.can\('purchasing\.view'\)/)
  assert.match(screen, /if \(!equipmentId \|\| !canSeePurchasing\)/)
  // The supplier of an external unit.
  assert.match(screen, /ownership_status === 'external_supplier' \? equipment\.lessor\?\.name/)
  // 2026-10-27: the state dot of each suggestion and recent unit, and the
  // page title above the field once the answer shows.
  assert.match(screen, /\.select\('id,code,type,plate_number,chassis_number,equipment_state'\)/)
  assert.match(screen, /\.select\('id,equipment_state'\)\s+\.in\('id', recentIds\.split\(','\)\)/)
  assert.match(screen, /hero \? 'sr-only' : 'inq-rise mb-3 text-center/)
  assert.match(read('src', 'components', 'inquiry', 'InquirySearch.tsx'), /<InquiryStateDot/)

  const journey = read('src', 'components', 'inquiry', 'InquiryJourney.tsx')
  assert.doesNotMatch(journey, /TabsTrigger|aria-expanded/)
  // Days without hours, underlined links to the movement.
  assert.doesNotMatch(journey, /formatDateTime/)
  assert.match(journey, /className="underline underline-offset-4 hover:decoration-2"/)
  // A workshop stay: the person responsible, not who recorded the exit.
  assert.match(journey, /site \? t\('inquiryForeman'\) : t\('inquiryMovementOwner'\)/)
  assert.doesNotMatch(journey, /exit\?\.supervisor_name \?\?/)
})

test('the look: flat state colours, no gradient, reduced motion respected', () => {
  const style = read('src', 'components', 'inquiry', 'inquiryStyle.tsx')
  for (const file of [
    style,
    read('src', 'components', 'inquiry', 'InquiryJourney.tsx'),
    read('src', 'components', 'inquiry', 'InquiryYear.tsx'),
    read('src', 'components', 'inquiry', 'InquiryNow.tsx'),
    read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
  ])
    assert.doesNotMatch(file, /linear-gradient|radial-gradient/)
  assert.match(style, /unrecorded: \{\s+fill: light\('var\(--chart-4\)'\)/)
  const css = read('src', 'index.css')
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s+\.inq-rise,\s+\.inq-grow,\s+\.inq-ring,\s+\.inq-dot \{\s+animation: none;/,
  )
})

test('the new Arabic keys exist in both languages, without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'inquiryHeroTitle',
    'inquiryNow',
    'inquiryJourney',
    'inquiryStateUnrecorded',
    'inquiryMovementOwner',
    'inquiryLast12Months',
  ]) {
    const values = [...source.matchAll(new RegExp(`\\n\\s+${key}: '([^']*)'`, 'g'))]
    assert.equal(values.length, 2, key)
    assert.doesNotMatch(values[0][1], /[أإآ]/, key)
  }
})
