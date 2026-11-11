// Migration 0185 on the SALES side (owner decisions 2026-11-08): the four price
// units (month / week / day / hour), the days of a month record and the dues
// per unit, the card's own client price unit and the margin only between two
// prices of the same unit, the manual card end / reopening, the cards
// awaiting their end, and the sidebar «المبيعات» with «PO العملاء» and
// «كروت المعدات» listed again. Pure helpers of src/lib/sales.ts against the
// migration's SQL, plus source checks of the screens.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

/** Loads a src/lib module with its `@/lib/...` imports and the real Zod. */
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      Intl,
      URLSearchParams,
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        return new Proxy({}, { get: () => () => null })
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const v = loadLibModule('formValidation')
const sales = loadLibModule('sales')
const nav = loadLibModule('navPermissions')

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261108100000_0185_price_units_days_card_end.sql',
)
const HAMZA_ALIF = /[أإآ]/

/** card_month_due of 0185, written out for the comparison. */
function dbCardMonthDue(price, unit, hours, standard, days) {
  const round = (value) => Math.round(value * 100) / 100
  if (price === null) return null
  if (unit === 'hour') return hours === null ? null : round(price * hours)
  if (unit === 'month' && standard > 0)
    return hours === null ? null : round((price * hours) / standard)
  if (unit === 'day') return days === null ? null : round(price * days)
  if (unit === 'week') return days === null ? null : round((price * days) / 7)
  return null
}

// --- Navigation ----------------------------------------------------------------------

test('«المبيعات»: PO العملاء, كروت المعدات, اسعار المعدات listed; the phase 2 pages hidden; /sales lands on the client POs', () => {
  const entry = nav.NAV_ENTRIES.find((item) => item.key === 'sales')
  assert.deepEqual(
    plain(entry.children.map((child) => [child.key, Boolean(child.hidden)])),
    [
      ['sales/orders', false],
      ['sales/cards', false],
      ['sales/prices', false],
      ['sales/timesheets', true],
      ['sales/months', true],
    ],
  )
  const state = {
    status: 'ready',
    permissions: new Map([['sales.view', 'all']]),
  }
  assert.deepEqual(
    plain(nav.visibleNavItems(state).find((item) => item.key === 'sales')),
    {
      key: 'sales',
      children: ['sales/orders', 'sales/cards', 'sales/prices'],
    },
  )
  assert.equal(nav.routePageOf(['sales']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'orders']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'prices']), 'sales/prices')
  assert.equal(nav.routePageOf(['sales', 'timesheets']), 'sales/timesheets')
  assert.equal(nav.routePageOf(['sales', 'months']), 'sales/months')
  const plan = nav.planShell(state)
  assert.equal(plan.landing, 'sales/orders')
  for (const page of ['sales/timesheets', 'sales/months'])
    assert.ok(plan.pages.has(page), page)
  // The months stay hidden on the card page too.
  assert.match(
    read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx'),
    /export const SHOW_CARD_MONTHS = false/,
  )
})

// --- The four units ------------------------------------------------------------------

test('the four units: labels, suffixes, totals per unit and the quantity words', () => {
  assert.deepEqual(plain(sales.SALE_RATE_UNITS), [
    'month',
    'week',
    'day',
    'hour',
  ])
  assert.equal(sales.SALE_RATE_UNIT_LABEL_KEYS.week, 'saleRateUnitWeek')
  assert.equal(sales.SALE_PER_UNIT_KEYS.week, 'salePerWeek')
  assert.equal(sales.saleRateUnitOf('week'), 'week')
  // The migration's CHECKs carry the same four.
  assert.match(
    MIGRATION,
    /client_po_equipment_rate_unit_check\s+CHECK \(rate_unit IN \('month', 'week', 'day', 'hour'\)\)/,
  )
  assert.match(MIGRATION, /client_price_unit text NOT NULL DEFAULT 'month'/)
  assert.deepEqual(
    plain(
      sales.clientPoTotalsByUnit([
        { price: 700, rate_unit: 'week' },
        { price: 300, rate_unit: 'week' },
        { price: 1000, rate_unit: 'month' },
      ]).parts,
    ),
    [
      { unit: 'month', total: 1000 },
      { unit: 'week', total: 1000 },
    ],
  )
  const ar = (quantity) => sales.quantityLabel(quantity, 'week', 'ar')
  assert.equal(ar(1), 'اسبوع')
  assert.equal(ar(2), 'اسبوعين')
  assert.equal(ar(8), '8 اسابيع')
  assert.equal(ar(12), '12 اسبوعا')
  assert.equal(sales.quantityLabel(8, 'week', 'en'), '8 weeks')
  assert.equal(sales.quantityLabel(1, 'week', 'en'), '1 week')
})

test('contractHours: monthly = quantity × standard hours, hourly = quantity, weekly and daily none', () => {
  const line = (rate_unit, quantity = 6, standard_hours = 260) => ({
    rate_unit,
    quantity,
    standard_hours,
  })
  assert.equal(sales.contractHours(line('month')), 1560)
  assert.equal(sales.contractHours(line('hour', 400)), 400)
  assert.equal(sales.contractHours(line('week', 8)), null)
  assert.equal(sales.contractHours(line('day', 30)), null)
  assert.equal(
    sales.contractHoursTotal([
      line('month'),
      line('week', 8),
      line('hour', 40),
    ]),
    1600,
  )
})

// --- The dues per unit -----------------------------------------------------------------

test('cardMonthDue mirrors the 0185 card_month_due for the four units, null days included', () => {
  const body = MIGRATION.slice(
    MIGRATION.indexOf('CREATE FUNCTION public.card_month_due('),
    MIGRATION.indexOf('COMMENT ON FUNCTION public.card_month_due'),
  )
  assert.match(body, /WHEN p_price IS NULL THEN NULL/)
  assert.match(
    body,
    /WHEN p_rate_unit = 'hour' THEN round\(p_price \* p_hours, 2\)/,
  )
  assert.match(
    body,
    /WHEN p_rate_unit = 'month' AND p_standard_hours > 0\s+THEN round\(p_price \* p_hours \/ p_standard_hours, 2\)/,
  )
  assert.match(
    body,
    /WHEN p_rate_unit = 'day' THEN round\(p_price \* p_days, 2\)/,
  )
  assert.match(
    body,
    /WHEN p_rate_unit = 'week' THEN round\(p_price \* p_days \/ 7, 2\)/,
  )
  const cases = [
    [13000, 'month', 248, 260, null],
    [13000, 'month', 248, 260, 20],
    [13000, 'month', null, 260, 20],
    [100, 'month', 10, 0, 5],
    [950, 'hour', 12.5, 260, null],
    [950, 'hour', null, 260, 5],
    [1400, 'day', 0, 260, 20],
    [1400, 'day', 200, 260, null],
    [1400, 'day', 0, 260, 22.5],
    [7000, 'week', 0, 260, 22],
    [7000, 'week', 0, 260, null],
    [null, 'week', 0, 260, 22],
    [100, 'year', 10, 260, 10],
  ]
  for (const [price, unit, hours, standard, days] of cases)
    assert.equal(
      sales.cardMonthDue(price, unit, hours, standard, days),
      dbCardMonthDue(price, unit, hours, standard, days),
      JSON.stringify([price, unit, hours, standard, days]),
    )
  assert.equal(sales.cardMonthDue(7000, 'week', 0, 260, 22), 22000)
})

test('cardMonthFigures: a daily or weekly line needs the days («ادخل الايام»), the supplier on the same days', () => {
  const card = {
    client_line_id: 'c1',
    client_price: 700,
    client_rate_unit: 'week',
    supplier_line_id: 's1',
    supplier_price: 70,
    supplier_rate_unit: 'day',
    owned: false,
    due_standard_hours: 260,
  }
  assert.deepEqual(plain(sales.cardMonthFigures(card, 200, null)), {
    client: { value: null, blocker: 'no_days' },
    supplier: { value: null, blocker: 'no_days' },
    margin: { value: null, blocker: 'no_days' },
  })
  assert.deepEqual(plain(sales.cardMonthFigures(card, 200, 14)), {
    client: { value: 1400, blocker: null },
    supplier: { value: 980, blocker: null },
    margin: { value: 420, blocker: null },
  })
  // A monthly line still needs the hours, whatever the days.
  assert.equal(
    sales.cardMonthFigures(
      { ...card, client_rate_unit: 'month', client_price: 26000 },
      null,
      20,
    ).client.blocker,
    'no_hours',
  )
  // The stored figures read the days of the row.
  const stored = sales.storedCardMonthFigures({
    ...card,
    hours: 0,
    days: null,
    client_due: null,
    supplier_due: null,
    margin: null,
  })
  assert.equal(stored.client.blocker, 'no_days')
  // The days field: 0 to 31, two decimals; empty = none.
  for (const ok of ['0', '22', '22.5', '31', '30.25'])
    assert.ok(sales.isValidCardMonthDays(ok), ok)
  for (const bad of ['-1', '32', '1.234', 'abc'])
    assert.ok(!sales.isValidCardMonthDays(bad), bad)
  assert.equal(sales.parseCardMonthDays(''), null)
  assert.equal(sales.parseCardMonthDays(' 22 '), 22)
  assert.equal(sales.formatDaysText(22, 'ar'), '22 يوم')
  assert.equal(sales.formatDaysText(1, 'en'), '1 day')
  // The old daily hint is gone; «ادخل الايام» replaces it.
  const translations = read('src', 'i18n', 'translations.ts')
  assert.doesNotMatch(
    translations,
    /cardMonthDailyHint|cardPriceMarginDailyHint/,
  )
  assert.match(translations, /cardMonthEnterDays: 'ادخل الايام'/)
})

// --- The card's client price unit and the margin ----------------------------------------

test('cardMargin only between two prices of the same unit, as the 0185 view', () => {
  assert.match(
    MIGRATION,
    /AND sp\.supplier_rate_unit = c\.client_price_unit\s+THEN round\(c\.client_price - sp\.supplier_price, 2\)/,
  )
  for (const unit of ['month', 'week', 'day', 'hour'])
    assert.equal(sales.cardMargin(150, unit, 100, unit), 50, unit)
  assert.equal(sales.cardMargin(1500, 'month', 100, 'day'), null)
  assert.equal(sales.cardMargin(1500, 'week', 1000, 'month'), null)
  assert.equal(sales.cardMargin(1500, null, 1000, 'month'), null)
  assert.equal(
    sales.cardMarginBlocker({
      clientPrice: 1500,
      clientRateUnit: 'month',
      supplierPrice: 100,
      supplierRateUnit: 'day',
    }),
    'units_differ',
  )
  // No unit-match rule for the approval.
  assert.equal(
    sales.cardPricingApprovalBlocker({
      pricing_status: 'draft',
      card_client_price: 1500,
      supplier_line_id: 'l1',
      supplier_po_status: 'open',
      supplier_price: 100,
    }),
    null,
  )
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /cardPriceMarginUnitsDiffer: 'وحدتان مختلفتان'/)
})

test('«اسعار المعدات»: the unit select, the supplier unit for an unpriced card, a unit change counts, the payload', () => {
  const screen = read('src', 'screens', 'sales', 'CardPricesScreen.tsx')
  const data = read('src', 'lib', 'salesData.ts')
  assert.match(data, /card_client_price_unit'/)
  assert.match(
    screen,
    /row\.card_client_price === null && isSaleRateUnit\(row\.supplier_rate_unit\)\s+\? row\.supplier_rate_unit\s+: savedUnit\(row\)/,
  )
  assert.match(
    screen,
    /isPriceChanged\(row\) \|\|\s+\(row\.card_client_price !== null && unitOf\(row\) !== savedUnit\(row\)\)/,
  )
  assert.match(screen, /<Select\s+size="sm"/)
  assert.match(screen, /rate_unit: unitOf\(row\),/)
  assert.match(
    screen,
    /cardMargin\(\s+client,\s+unit,\s+row\.supplier_price,\s+row\.supplier_rate_unit,\s+\)/,
  )
  assert.match(
    data,
    /supabase\.rpc\('set_equipment_card_client_price', \{\s+p_card_id: input\.cardId,\s+p_price: input\.price,\s+p_rate_unit: input\.rateUnit,/,
  )
  assert.match(
    data,
    /p_items: items\.map\(\(item\) => \(\{\s+card_id: item\.card_id,\s+price: item\.price,\s+rate_unit: item\.rate_unit,\s+\}\)\)/,
  )
  // The 0185 setter takes the unit (NULL = unchanged).
  assert.match(
    MIGRATION,
    /CREATE FUNCTION public\.set_equipment_card_client_price\(\s+p_card_id uuid,\s+p_price numeric,\s+p_rate_unit text DEFAULT NULL\s+\)/,
  )
})

// --- The card end: built for 0185, removed by 0189 -----------------------------------------

test('«انهاء الكرت» is gone since 0189; its past events still read', () => {
  // Owner 2026-11-11 («وحتى المعدة نشيل منها البداية والنهاية ومفتوح»): a
  // card has no period, so nothing ends or reopens it.
  const data = read('src', 'lib', 'salesData.ts')
  assert.doesNotMatch(data, /end_equipment_card|reopen_equipment_card/)
  assert.ok(
    !fs.existsSync(
      path.join(ROOT, 'src', 'components', 'sales', 'EndCardDialog.tsx'),
    ),
  )
  const page = read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx')
  assert.doesNotMatch(page, /cardOptions|setEndDialog|EndCardDialog|period_to/)
  assert.equal(sales.CARD_END_ERROR_TOKENS, undefined)
  assert.equal(sales.cardEndFormMessage, undefined)
  assert.equal(sales.END_CARD_FIELD_RULES, undefined)
  assert.equal(v.endCardFormSchema, undefined)
  const dropped = read(
    'supabase',
    'migrations',
    '20261111100000_0189_po_start_date_only.sql',
  )
  assert.match(
    dropped,
    /DROP FUNCTION public\.end_equipment_card\(uuid, date, text\);\s+DROP FUNCTION public\.reopen_equipment_card\(uuid, text\);/,
  )
  // The other 0185 tokens: the unit on the setter, the days on the month.
  assert.equal(
    sales.CARD_PRICING_FORM_MESSAGES.invalid_rate_unit,
    'saleRateUnitInvalid',
  )
  assert.equal(
    sales.CARD_MONTH_FORM_MESSAGES.invalid_days,
    'cardMonthDaysInvalid',
  )
  // The events and their details.
  assert.equal(
    sales.EQUIPMENT_CARD_EVENT_LABEL_KEYS.card_ended,
    'equipmentCardEventEnded',
  )
  assert.equal(
    sales.EQUIPMENT_CARD_EVENT_LABEL_KEYS.card_reopened,
    'equipmentCardEventReopened',
  )
  const detail = (event_type, payload) =>
    sales.equipmentCardEventDetail(
      { event_type, payload },
      'ar',
      undefined,
      (price) => price.toFixed(2),
      undefined,
      undefined,
      {
        perUnit: (unit) => ({ month: '/ شهر', day: '/ يوم' })[unit] ?? unit,
        endedOn: (day) => `بتاريخ ${day.split('-').reverse().join('/')}`,
      },
    )
  assert.equal(
    detail('card_ended', { period_to: '2026-11-08', note: 'انتهى العمل' }),
    'بتاريخ 08/11/2026 · انتهى العمل',
  )
  assert.equal(
    detail('card_reopened', { note: 'خطا', old_period_to: '2026-11-08' }),
    'خطا',
  )
  assert.equal(
    detail('client_price_changed', {
      old_price: 1000,
      new_price: 1200,
      old_unit: 'month',
      new_unit: 'day',
    }),
    '1000.00 / شهر ← 1200.00 / يوم',
  )
  assert.equal(
    detail('client_price_changed', {
      old_price: 1000,
      new_price: 1200,
      old_unit: 'month',
      new_unit: 'month',
    }),
    '1000.00 ← 1200.00',
  )
})

// --- The cards awaiting their end: built for 0185, removed by 0189 -------------------------

test('«بانتظار الانهاء» is gone since 0189: no switch, no view read', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'lib', 'cardsAwaitingEnd.ts')))
  const data = read('src', 'lib', 'salesData.ts')
  assert.doesNotMatch(data, /sales_cards_awaiting_end|CARDS_AWAITING_END_LIMIT/)
  const screen = read('src', 'screens', 'sales', 'EquipmentCardsScreen.tsx')
  assert.doesNotMatch(screen, /awaiting|is_open|period_from|period_to/)
  // The list shows the entry day of the card's visit instead of a period.
  assert.match(screen, /key: 'entry_at',\s+header: t\('supplierPoEntryDate'\),/)
  assert.match(
    screen,
    /rowHref=\{\(row\) => `\/sales\/cards\/\$\{row\.card_id\}`\}/,
  )
  assert.match(
    read(
      'supabase',
      'migrations',
      '20261111100000_0189_po_start_date_only.sql',
    ),
    /DROP VIEW public\.sales_cards_awaiting_end;/,
  )
})

test('the 0185 translation block: Arabic and English, no hamza on alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ sales-0185 — start[\s\S]*?\/\/ sales-0185 — end/g,
    ),
  ].map((m) => m[0])
  assert.equal(blocks.length, 2)
  const keys = (block) => [...block.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.doesNotMatch(blocks[0], HAMZA_ALIF)
  for (const key of [
    'saleRateUnitWeek',
    'salePerWeek',
    'cardMonthDays',
    'equipmentCardEnd',
    'equipmentCardReopenOverlap',
    'equipmentCardsAwaitingEnd',
  ])
    assert.ok(keys(blocks[0]).includes(key), key)
  assert.match(
    blocks[0],
    /equipmentCardReopenOverlap: 'المعدة لها كرت لاحق، لا يمكن اعادة الفتح\.'/,
  )
})
