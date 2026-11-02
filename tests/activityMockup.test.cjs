const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-02 («خلنا نسوي سجل تعديلات المعدات، يكون ضمن النشاط، وصفحة
// النشاط يبغالها اعادة بناء برضه»): the rebuilt activity page is reviewed on
// /ui-kit first — one list over the movement log and the equipment change log
// of migration 0168, with the «سجل التعديلات» card of the equipment page.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const mockup = read('src', 'screens', 'ui-kit', 'ActivityMockup.tsx')
const data = read('src', 'screens', 'ui-kit', 'activityMockupData.ts')
const uiKit = read('src', 'screens', 'UiKit.tsx')
const sources = { mockup, data }

test('the section is registered on /ui-kit under review', () => {
  assert.match(
    uiKit,
    /import \{ ActivityMockup \} from '@\/screens\/ui-kit\/ActivityMockup'/,
  )
  const start = uiKit.indexOf("id: 'activity-redesign'")
  assert.ok(start > 0, 'the section has an id')
  const block = uiKit.slice(start, uiKit.indexOf('element:', start) + 60)
  assert.match(block, /title: 'نموذج صفحة النشاط الجديدة'/)
  assert.match(block, /status: 'review'/)
  assert.match(block, /element: <ActivityMockup \/>/)
})

test('sample data only: no Supabase, no fetch, deterministic', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(
      source,
      /from '[^']*supabase|supabase\.(from|rpc)\(/i,
      `${name} imports or calls supabase`,
    )
    assert.doesNotMatch(source, /\bfetch\(/, `${name} fetches`)
    assert.doesNotMatch(source, /Math\.random/, `${name} is not deterministic`)
  }
  // «منذ …» is computed against a fixed instant, never Date.now().
  assert.match(data, /export const ACTIVITY_NOW = Date\.parse\(/)
  assert.doesNotMatch(mockup, /Date\.now\(\)/)
  assert.match(mockup, /elapsedInWords\(at, lang, ACTIVITY_NOW\)/)
})

test('one list over both logs, in the approved main-list table look', () => {
  assert.match(data, /export type ActivityKind = 'movement' \| 'equipment'/)
  assert.match(
    data,
    /export type ActivityAction = 'create' \| 'update' \| 'delete'/,
  )
  // Both kinds and all three actions appear in the sample.
  for (const kind of ['movement', 'equipment'])
    assert.match(data, new RegExp(`kind: '${kind}'`))
  for (const action of ['create', 'update', 'delete'])
    assert.match(data, new RegExp(`action: '${action}'`))
  // 13 px cells with 8 px above and below (owner 2026-10-29).
  assert.match(mockup, /cellTextClassName="text-\[13px\]"/)
  assert.match(mockup, /cellClassName="py-2"/)
  // The columns the owner asked for.
  for (const header of ['الوقت', 'المستخدم', 'النوع', 'السجل', 'التغييرات'])
    assert.match(mockup, new RegExp(`header: '${header}'`), header)
  // The identity cell: the code bold as a real link, a muted line under it.
  assert.match(
    mockup,
    /<AppLink\s+href=\{row\.href\}\s+className="w-fit font-semibold hover:underline"/,
  )
  assert.match(
    mockup,
    /<span className="text-xs text-muted">\{recordLine\(row\)\}<\/span>/,
  )
  // The badge tone follows the action: green create, neutral update, red delete.
  assert.match(
    mockup,
    /create: 'success',\s+update: 'neutral',\s+delete: 'danger'/,
  )
  // Chips: three, then «+N».
  assert.match(mockup, /const CHIPS_SHOWN = 3/)
  assert.match(mockup, /\+\{rest\}/)
})

test('toolbar: search, the kind switch, the filter dialog with the month presets, the sort', () => {
  assert.match(mockup, /<SearchInput/)
  assert.match(mockup, /<TabsList variant="segmented" aria-label="النوع">/)
  for (const label of ['الكل', 'الحركات', 'المعدات'])
    assert.match(mockup, new RegExp(`label: '${label}'`), label)
  assert.match(mockup, /<Dialog\s+open=\{open\}/)
  for (const label of ['الاجراء', 'المستخدم', 'الحقل'])
    assert.match(mockup, new RegExp(`label="${label}"`), label)
  assert.match(mockup, /<DateRangeFilter/)
  assert.match(mockup, /saudiMonthKeys\(0, TODAY\)/)
  // «الحقل» is for equipment changes only and leaves the state with the kind.
  assert.match(mockup, /filters\.kind !== 'movement' && \(/)
  assert.match(mockup, /next\.kind === 'movement' && next\.fields\.length/)
  assert.match(mockup, /\{ value: 'at', label: 'الوقت' \}/)
})

test('an expandable row on desktop, cards on phones', () => {
  assert.match(
    mockup,
    /expandable=\{\{\s+render: \(row\) => <ChangesPanel row=\{row\} lang=\{lang\} \/>,\s+\}\}/,
  )
  assert.match(mockup, /<div className="hidden md:block">/)
  assert.match(mockup, /<div className="space-y-2 md:hidden">/)
  assert.match(mockup, /function ActivityCard\(/)
  // The panel shows every field before and after.
  for (const header of ['الحقل', 'قبل', 'بعد'])
    assert.match(mockup, new RegExp(`<span>${header}</span>`), header)
})

test('the equipment page card: last 5 changes and «عرض الكل» to the filtered activity page', () => {
  assert.match(mockup, /function EquipmentChangesCardMockup\(/)
  assert.match(mockup, /cardUnitChanges\(5\)/)
  assert.match(mockup, /title="سجل التعديلات"/)
  assert.match(mockup, /maxRows=\{5\}/)
  assert.match(
    mockup,
    /const allHref = `\/activity\?kind=equipment&q=\$\{CARD_UNIT\.code\}`/,
  )
  assert.match(mockup, /viewAllHref=\{allHref\}/)
  assert.match(data, /code: 'A028'/)
})

test('project tokens only: no hex colors, no Tailwind palette classes, no gradient', () => {
  const palette =
    /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{3,8}\b/,
      `${name} has a hex color`,
    )
    assert.doesNotMatch(
      source,
      palette,
      `${name} uses a Tailwind palette class`,
    )
    assert.doesNotMatch(source, /gradient/i, `${name} uses a gradient`)
    // Logical direction utilities only.
    assert.doesNotMatch(
      source,
      /\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/,
      `${name} uses a physical direction class`,
    )
  }
  assert.doesNotMatch(mockup, /from 'recharts'/)
})

test('the new Arabic copy uses plain alif (no أ / إ / آ)', () => {
  for (const [name, source] of Object.entries(sources))
    assert.doesNotMatch(source, /[أإآ]/, `${name} has alif with hamza or madda`)
  const start = uiKit.indexOf("id: 'activity-redesign'")
  const block = uiKit.slice(start, uiKit.indexOf('element:', start))
  assert.doesNotMatch(block, /[أإآ]/)
})
