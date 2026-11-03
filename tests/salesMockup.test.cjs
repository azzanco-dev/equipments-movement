const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-01: the sales phase starts with «PO العملاء». Its phase-1
// screens are reviewed on /ui-kit as mockups with sample data, in the
// purchasing look, together with the phase-1 decisions.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const mockup = read('src', 'screens', 'ui-kit', 'SalesMockup.tsx')
const data = read('src', 'screens', 'ui-kit', 'salesMockupData.ts')
const uiKit = read('src', 'screens', 'UiKit.tsx')
const sources = { mockup, data }

test('the section is registered on /ui-kit under review', () => {
  assert.match(
    uiKit,
    /import \{ SalesMockup \} from '@\/screens\/ui-kit\/SalesMockup'/,
  )
  const start = uiKit.indexOf("id: 'sales-mockup'")
  assert.ok(start > 0, 'the section has an id')
  const block = uiKit.slice(start, uiKit.indexOf('element:', start) + 40)
  assert.match(block, /title: 'نماذج شاشات المبيعات'/)
  assert.match(block, /status: 'review'/)
  assert.match(block, /element: <SalesMockup \/>/)
})

test('sample data only: no Supabase, no fetch, no randomness', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(
      source,
      /from '[^']*supabase|supabase\.(from|rpc)\(/i,
      `${name} imports or calls supabase`,
    )
    assert.doesNotMatch(source, /\bfetch\(/, `${name} fetches`)
    assert.doesNotMatch(source, /Math\.random/, `${name} is not deterministic`)
  }
})

test('the four screens sit behind sub-tabs on the shared segmented Tabs', () => {
  assert.match(mockup, /<TabsList variant="segmented"/)
  for (const label of [
    'قائمة PO العملاء',
    'صفحة PO العميل',
    'كرت المبيعات في صفحة المعدة',
    'تذكرة المعدة',
    'صفحة كرت المعدة',
    'قائمة كروت المعدات',
  ])
    assert.match(mockup, new RegExp(`label: '${label}'`), label)
  // The list's view switch: the PO list's black selected tab, units default.
  assert.match(mockup, /useState<ListView>\('units'\)/)
  assert.match(mockup, /className=\{PRIMARY_ACTIVE_TRIGGER\}/)
  assert.match(mockup, /t\('poUnitsViewUnits'\)/)
  assert.match(mockup, /t\('poUnitsViewOrders'\)/)
})

test('the decisions block lists the phase-1 decisions', () => {
  assert.match(mockup, /items = SALES_DECISIONS/)
  for (const title of [
    'PO عميل واحد = شركة واحدة + مشروع واحد',
    'رقم العميل هو الهوية',
    'بلا اعتماد حاليا',
    'بلا مرفق PDF في المرحلة الاولى',
  ])
    assert.ok(data.includes(title), title)
  assert.match(data, /بدون ضريبة/)
})

test('the client PO page has no approval and no PDF controls', () => {
  // The rendered page, after the mockup frame's own title and permission
  // note (which SAY there is no approval and no PDF).
  const start = mockup.indexOf(
    '<BackButton',
    mockup.indexOf('function ClientPoPageMockup('),
  )
  const end = mockup.indexOf('// --- 3. The «المبيعات» card')
  assert.ok(start > 0 && end > start)
  const page = mockup.slice(start, end)
  assert.doesNotMatch(page, /اعتماد|معتمد|مسودة|Approve|approval/)
  assert.doesNotMatch(page, /PDF|print|Print/)
  // The two actions of the pattern, the status badge, the four summary cards.
  assert.match(page, /تعديل/)
  assert.match(page, /اقفال/)
  assert.match(page, /<StatusBadge status=\{po\.status\} \/>/)
  assert.equal((page.match(/<StatCard/g) ?? []).length, 4)
  assert.match(page, /t\('supplierPoSummaryTotal'\)/)
  assert.match(page, /t\('supplierPoSummaryVat'\)/)
  assert.match(page, /t\('supplierPoSummaryTotalWithVat'\)/)
  assert.match(page, /t\('supplierPoEquipmentCount'\)/)
  // The mobile bottom bar of the pattern.
  assert.match(page, /sticky bottom-0 .*sm:hidden/)
  assert.match(page, /env\(safe-area-inset-bottom\)/)
})

test('amounts are per price unit and never summed across units', () => {
  assert.match(data, /export function clientPoTotalsByUnit/)
  assert.match(data, /SALE_RATE_UNITS[^=]*= \['month', 'day', 'hour'\]/)
  assert.match(mockup, /<RiyalSign /)
  assert.doesNotMatch(mockup, /reduce\(\(sum, line\) => sum \+ line\.price/)
})

test('the ticket carries two stubs: the supplier PO and the client PO', () => {
  const start = mockup.indexOf('function Ticket(')
  const end = mockup.indexOf('const TICKET_CASES')
  const ticket = mockup.slice(start, end)
  assert.equal((ticket.match(/<Stub\b/g) ?? []).length, 2)
  assert.match(ticket, /side="PO المورد"/)
  assert.match(ticket, /side="PO العميل"/)
  assert.match(ticket, /noPoLabel="بدون PO"/)
  assert.match(ticket, /noPoLabel="بدون PO عميل"/)
  // Four sample tickets: both, supplier only, client only, none.
  const tickets = [
    ...data.matchAll(
      /id: 't\d+',[\s\S]*?supplier_po_number: ('[^']+'|null),[\s\S]*?client_po_number: ('[^']+'|null),/g,
    ),
  ].map((m) => `${m[1] === 'null' ? 0 : 1}${m[2] === 'null' ? 0 : 1}`)
  assert.deepEqual([...tickets].sort(), ['00', '01', '10', '11'])
})

test('the card page: three samples, three side cards, the months table, the actions', () => {
  const start = mockup.indexOf('function CardPageMockup(')
  const end = mockup.indexOf('// --- 6. The equipment cards list')
  assert.ok(start > 0 && end > start)
  const page = mockup.slice(start, end)
  // Rented (both sides), owned, and — since phase 2 — a daily client line.
  assert.match(data, /rented: 'card1',\n\s+owned: 'card2',\n\s+daily: 'card10',/)
  assert.match(page, /CARD_SAMPLE_LABEL\[key\]/)
  for (const title of ['title="الحركة"', 'title="المبيعات"', 'title="المشتريات"'])
    assert.match(page, new RegExp(title), title)
  assert.match(page, /معدة مملوكة · بدون PO مورد/)
  assert.match(page, /انتقل للحركة/)
  assert.match(page, /انهاء الكرت/)
  // The summary strip's four figures and the months table's columns.
  assert.equal((page.match(/<StatCard/g) ?? []).length, 4)
  for (const header of [
    "header: 'الشهر'",
    "header: 'الساعات'",
    "header: 'مستحق العميل'",
    "header: 'مستحق المورد'",
    "header: 'الهامش'",
    "header: 'الحالة'",
  ])
    assert.ok(page.includes(header), header)
  // Phase 2 (owner 2026-11-03): the recording state replaces the deferred
  // timesheet attachment, «تسجيل شهر» opens the dialog, a row edits.
  assert.match(page, /<MonthStateBadge state=\{row\.state\} \/>/)
  assert.match(page, /تسجيل شهر/)
  assert.match(page, /<MonthRecordDialog/)
  assert.match(page, /كروت التشغيل/)
  // The visibility rule, no hiding between the two sides.
  assert.match(page, /2026-10-15/)
  assert.match(page, /sticky bottom-0 .*sm:hidden/)
  // Months are RECORDS; the awaited and running months are derived.
  assert.match(data, /export function cardMonthRows/)
  assert.match(data, /export function cardMonthFigures/)
})

test('the cards list: the four PO combinations and an ended card, open first', () => {
  const start = mockup.indexOf('function CardsListMockup(')
  const end = mockup.indexOf('// --- The decisions and the section')
  assert.ok(start > 0 && end > start)
  const list = mockup.slice(start, end)
  assert.match(list, /cellTextClassName="text-\[13px\]"/)
  assert.match(list, /cellClassName="py-2"/)
  for (const header of [
    "header: 'المعدة'",
    "header: 'الشركة · المشروع'",
    "header: 'الفترة'",
    "header: 'PO العميل'",
    "header: 'PO المورد'",
    "header: 'سعر البيع'",
    "header: 'سعر الشراء'",
  ])
    assert.ok(list.includes(header), header)
  assert.match(list, /مملوكة/)
  assert.match(list, /key: 'open_first'/)
  for (const field of ['الشركة', 'المشروع', 'الحالة', 'بدون PO عميل', 'بدون PO مورد'])
    assert.ok(mockup.includes(field), field)
  const cards = [
    ...data.matchAll(
      /id: 'card\d+',[\s\S]*?client_po_number: ('[^']+'|null),[\s\S]*?owned: (true|false),\n\s+supplier_po_number: ('[^']+'|null),/g,
    ),
  ]
  assert.ok(cards.length >= 8 && cards.length <= 12, `${cards.length} cards`)
  const combos = new Set(
    cards.map((m) => `${m[1] === 'null' ? 0 : 1}${m[3] === 'null' ? 0 : 1}`),
  )
  assert.deepEqual([...combos].sort(), ['00', '01', '10', '11'])
  assert.ok(cards.some((m) => m[2] === 'true'), 'an owned card')
  assert.equal((data.match(/status: 'ended'/g) ?? []).length, 1)
})

test('project tokens only: no hex colors, no Tailwind palette classes, no gradients', () => {
  const palette =
    /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${name} has a hex color`)
    assert.doesNotMatch(source, palette, `${name} uses a Tailwind palette class`)
    assert.doesNotMatch(source, /gradient/i, `${name} uses a gradient`)
  }
})

test('the new Arabic copy uses plain alif (no أ / إ / آ)', () => {
  for (const [name, source] of Object.entries(sources))
    assert.doesNotMatch(source, /[أإآ]/, `${name} has alif with hamza or madda`)
  const start = uiKit.indexOf("id: 'sales-mockup'")
  const block = uiKit.slice(start, uiKit.indexOf('element:', start))
  assert.doesNotMatch(block, /[أإآ]/)
})

test('logical direction utilities only', () => {
  assert.doesNotMatch(mockup, /\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-\d/)
})
