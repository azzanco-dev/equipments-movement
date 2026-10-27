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

test('a calendar year in Saudi time, with the days after today', () => {
  const range = year.inquiryYearRange(2026, NOW)
  // Saudi midnight = 21:00 UTC the day before.
  assert.equal(new Date(range.startMs).toISOString(), '2025-12-31T21:00:00.000Z')
  // The year is read up to the end of today (the Saudi midnight after it).
  assert.equal(new Date(range.endMs).toISOString(), '2026-10-26T21:00:00.000Z')
  const days = year.inquiryYearDays([], NaN, NOW, 2026)
  assert.equal(days.length, 365)
  assert.equal(days[0].day, year.saudiDay(Date.parse(saudi('2026-01-01'))))
  const today = days.findIndex((day) => day.day === year.saudiDay(NOW))
  assert.ok(days.slice(0, today + 1).every((day) => day.state === 'unrecorded'))
  assert.ok(days.slice(today + 1).every((day) => day.state === 'future'))
  // A past year is read whole.
  const past = year.inquiryYearRange(2025, NOW)
  assert.equal(new Date(past.endMs).toISOString(), '2025-12-31T21:00:00.000Z')
  assert.equal(year.inquiryYearDays([], NaN, NOW, 2024).length, 366)
  assert.equal(year.saudiYear(Date.parse('2025-12-31T21:30:00Z')), 2026)
})

test('the years to pick: this year back to the first year of the unit', () => {
  assert.deepEqual(plain(year.inquiryYearChoices(2024, NOW)), [2026, 2025, 2024])
  assert.deepEqual(plain(year.inquiryYearChoices(null, NOW)), [2026])
  assert.deepEqual(plain(year.inquiryYearChoices(2030, NOW)), [2026])
})

test('stays colour their days, later stays win, before creation stays blank', () => {
  const visits = timeline.buildEquipmentVisits([
    move('site', 'entry', '2026-01-10'),
    move('site', 'exit', '2026-01-20', { exit_purpose: 'maintenance' }),
    move('workshop', 'entry', '2026-01-20', { workshop_purpose: 'parking' }),
    move('workshop', 'exit', '2026-01-25'),
    move('workshop', 'entry', '2026-10-20', { workshop_purpose: 'out_of_service' }),
  ])
  const created = Date.parse('2026-01-05T00:00:00Z')
  const days = year.inquiryYearDays(visits, created, NOW, 2026)
  const at = (date) => days.find((day) => day.day === year.saudiDay(Date.parse(saudi(date))))
  assert.equal(at('2026-01-04').state, 'before')
  assert.equal(at('2026-01-06').state, 'unrecorded')
  assert.equal(at('2026-01-10').state, 'site')
  assert.equal(at('2026-01-19').state, 'site')
  // The exit day of the project is the entry day of the workshop: the
  // later stay wins.
  assert.equal(at('2026-01-20').state, 'parking')
  assert.equal(at('2026-01-25').state, 'parking')
  assert.equal(at('2026-01-26').state, 'unrecorded')
  // An open stay runs through today, and no further.
  assert.equal(at('2026-10-26').state, 'out_of_service')
  assert.equal(at('2026-10-27').state, 'future')

  const summary = plain(year.summarizeInquiryYear(days))
  assert.equal(summary.siteDays, 10)
  assert.equal(summary.counts.parking, 6)
  assert.equal(summary.counts.out_of_service, 7)
  assert.equal(summary.workshopDays, 13)
  assert.equal(summary.visitCount, 3)
  // Only the days from creation through today count.
  assert.equal(summary.counted, year.saudiDay(NOW) - year.saudiDay(created) + 1)
  assert.equal(summary.counted, summary.siteDays + summary.workshopDays + summary.unrecordedDays)
})

test('a stay open before the year starts colours from 1 January', () => {
  const visits = timeline.buildEquipmentVisits([move('site', 'entry', '2024-11-24')])
  const days = year.inquiryYearDays(visits, Date.parse('2024-01-01'), NOW, 2026)
  assert.ok(days.every((day) => day.state === 'site' || day.state === 'future'))
  assert.equal(year.summarizeInquiryYear(days).siteShare, 100)
})

test('the year groups into 12 calendar months with their counts', () => {
  const days = year.inquiryYearDays([], NaN, NOW, 2026)
  const months = plain(year.inquiryYearMonths(days))
  assert.equal(months.length, 12)
  assert.deepEqual([months[0].year, months[0].month, months[0].days.length], [2026, 0, 31])
  assert.equal(months[9].counts.unrecorded, 26)
  assert.equal(months[11].counts.unrecorded, 0)
  assert.equal(months.reduce((sum, month) => sum + month.days.length, 0), 365)
})

test('the screen: AI-style start, rings, journey in full, no filter', () => {
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  assert.match(screen, /<InquirySearch[\s\S]*?big=\{hero\}/)
  assert.match(screen, /t\('inquiryHeroTitle'\)/)
  // The strip, after the rings (owner 2026-10-27: «غير اخر 12 شهر لشريط»);
  // a stay on it opens its tile in the history.
  assert.match(
    screen,
    /<InquiryYearStrip\s+days=\{year\.days\}\s+months=\{year\.months\}\s+index=\{\d+\}\s+onSelectVisit=\{selectVisit\}/,
  )
  assert.doesNotMatch(screen, /<InquiryYearRings/)
  assert.match(screen, /getElementById\(inquiryVisitAnchor\(key\)\)/)
  // The chosen year is read for its days plus the movement before it.
  assert.match(screen, /\.gte\('recorded_at', start\)\s+\.lt\('recorded_at', end\)/)
  assert.match(screen, /\.lt\('recorded_at', start\)[\s\S]*?\.limit\(1\)/)
  // Recent units: this browser only, and storage failures are swallowed.
  assert.match(screen, /const RECENT_KEY = 'inquiry:recent'/)
  assert.match(screen, /try \{\s+window\.localStorage\.setItem/)
  // The PO left the status card for a small card under the facts (owner
  // 2026-10-27: «شيل بادج الPO», «خليه في كرت مصغر يسار تحت بيانات
  // المعدة»), for purchasing readers, while the unit is inside a project.
  assert.doesNotMatch(read('src', 'components', 'inquiry', 'InquiryNow.tsx'), /inquiryNoPo|\/purchasing\//)
  assert.match(screen, /permissions\.can\('purchasing\.view'\)/)
  assert.match(screen, /if \(!equipmentId \|\| !canSeePurchasing\) return/)
  assert.match(screen, /<\/section>\s+\{\/\*[\s\S]*?\*\/\}\s+\{po !== undefined && <InquiryPoCard po=\{po\}/)
  // The supplier of an external unit.
  assert.match(screen, /ownership_status === 'external_supplier' \? equipment\.lessor\?\.name/)
  // 2026-10-27: the state dot of each suggestion and recent unit, and the
  // page title above the field once the answer shows.
  assert.match(screen, /SUGGEST_SELECT = 'id,code,type,plate_number,chassis_number,equipment_state'/)
  // The code matches show after one read; the other matches join later.
  assert.match(screen, /\.select\(SUGGEST_SELECT\)\s+\.or\(filter\)/)
  assert.match(screen, /\.select\(SUGGEST_SELECT\)\s+\.in\('id', extraIds\)/)
  assert.match(screen, /term\.length >= COMPANY_NUMBER_MIN_LENGTH/)
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

test('the look: flat cards, one soft page wash, reduced motion respected', () => {
  const style = read('src', 'components', 'inquiry', 'inquiryStyle.tsx')
  for (const file of [
    style,
    read('src', 'components', 'inquiry', 'InquiryJourney.tsx'),
    read('src', 'components', 'inquiry', 'InquiryYear.tsx'),
    read('src', 'components', 'inquiry', 'InquiryNow.tsx'),
    read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
  ])
    assert.doesNotMatch(file, /linear-gradient|radial-gradient/)
  // The one gradient is the page background, in the stylesheet (owner
  // 2026-10-27: «تقدر تسوي gradient للخلفية حق الصفحة؟»).
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  assert.match(screen, /'inquiry-page-bg min-h-\[70vh\]/)
  // With an answer it stays at the top, fading out under «الوضع الحالي».
  assert.match(screen, /!hero && 'inquiry-page-bg--top'/)
  assert.match(screen, /'--inq-wash-end': `\$\{washEnd\}px`/)
  const wash = read('src', 'index.css')
  assert.match(wash, /\.inquiry-page-bg \{\s+--inq-glows:\s+radial-gradient\(/)
  assert.match(
    wash,
    /\.inquiry-page-bg--top \{\s+background-image:\s+linear-gradient\(\s+to bottom,\s+transparent var\(--inq-wash-end, 640px\),\s+var\(--surface\) calc\(var\(--inq-wash-end, 640px\) \+ 220px\)\s+\),\s+var\(--inq-glows\);/,
  )
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
    'inquiryActivityIn',
    'inquiryTimeline',
  ]) {
    const values = [...source.matchAll(new RegExp(`\\n\\s+${key}: '([^']*)'`, 'g'))]
    assert.equal(values.length, 2, key)
    assert.doesNotMatch(values[0][1], /[أإآ]/, key)
  }
})
