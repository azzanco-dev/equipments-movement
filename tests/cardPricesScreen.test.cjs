// Card pricing («اسعار المعدات», owner decisions 2026-11-04, migration 0174):
// the one listed sales page, the four earlier sales pages hidden (URL only),
// the card page's months section behind SHOW_CARD_MONTHS, and the pure
// helpers of src/lib/sales.ts — the margin rule must equal the view's.
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
const configs = loadLibModule('listConfigs')
const pricesList = loadLibModule('cardPricesList')

const HAMZA_ALIF = /[أإآ]/
const PALETTE =
  /\b(?:bg|text|border)-(?:gray|zinc|slate|emerald|green|amber|red|blue)-\d{2,3}\b/

const NEW_FILES = [
  ['src', 'screens', 'sales', 'CardPricesScreen.tsx'],
  ['src', 'components', 'sales', 'CardPricingCells.tsx'],
  ['src', 'components', 'sales', 'CardPricingDialogs.tsx'],
  ['src', 'lib', 'cardPricesList.ts'],
]

// --- Navigation --------------------------------------------------------------------

test('«اسعار المعدات» is the third child of «المبيعات» (0185); the two phase 2 pages are hidden, still gated and routable', () => {
  const entry = nav.NAV_ENTRIES.find((item) => item.key === 'sales')
  assert.deepEqual(plain(entry.children[2]), {
    key: 'sales/prices',
    requires: [{ key: 'sales.view' }],
  })
  const hidden = entry.children.filter((child) => child.hidden)
  assert.deepEqual(plain(hidden.map((child) => child.key)), [
    'sales/timesheets',
    'sales/months',
  ])
  for (const child of entry.children)
    assert.deepEqual(plain(child.requires), [{ key: 'sales.view' }])
  // The sidebar lists the client POs, the cards and the prices (0185).
  const state = {
    status: 'ready',
    permissions: new Map([['sales.view', 'all']]),
  }
  const items = nav.visibleNavItems(state)
  assert.deepEqual(plain(items.find((item) => item.key === 'sales')), {
    key: 'sales',
    children: ['sales/orders', 'sales/cards', 'sales/prices'],
  })
  // /sales lands on the client POs (0185); the hidden pages still open by URL.
  assert.equal(nav.routePageOf(['sales']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'prices']), 'sales/prices')
  assert.equal(nav.routePageOf(['sales', 'orders']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'cards']), 'sales/cards')
  assert.equal(nav.routePageOf(['sales', 'timesheets']), 'sales/timesheets')
  assert.equal(nav.routePageOf(['sales', 'months']), 'sales/months')
  assert.equal(nav.routePageOf(['sales', 'p1']), 'sales/:id')
  const plan = nav.planShell(state)
  assert.equal(plan.landing, 'sales/orders')
  for (const page of [
    'sales/prices',
    'sales/orders',
    'sales/cards',
    'sales/timesheets',
    'sales/months',
    'sales/:id',
    'sales/cards/:id',
  ])
    assert.ok(plan.pages.has(page), page)
  assert.deepEqual(plain(nav.pageGate('sales/prices')), [{ key: 'sales.view' }])
  // Nothing without the key.
  const none = nav.planShell({
    status: 'ready',
    permissions: new Map([['purchasing.view', 'all']]),
  })
  assert.ok(!none.pages.has('sales/prices'))
  assert.ok(!none.pages.has('sales/orders'))
  // The route, the label, the title.
  const app = read('src', 'App.tsx')
  assert.match(app, /'sales\/prices': 'cardPrices',/)
  assert.match(app, /page === 'sales\/prices' && \(\s+<CardPricesScreen/)
  assert.match(
    app,
    /import\('@\/screens\/sales\/CardPricesScreen'\)\.then\(\s+\(module\) => module\.CardPricesScreen,/,
  )
  const titles = read('src', 'lib', 'pageTitle.ts')
  assert.match(
    titles,
    /'sales\/prices': \{ kind: 'sub', name: 'cardPrices', section: 'sales' \}/,
  )
})

// --- The list config and the always-on condition ------------------------------------------

test('cardPricesListConfig: search, no default filter since 0189, the owner / supplier / company / project / status filters, the sorts', () => {
  const config = configs.cardPricesListConfig
  assert.equal(config.id, 'cardPrices')
  assert.deepEqual(plain(config.searchFields), [
    'equipment_code',
    'equipment_plate_digits',
    'equipment_chassis_number',
    'supplier_po_number',
  ])
  // Owner 2026-11-07 (0184): the latest modification first.
  assert.equal(config.defaultSort, 'last_modified_at')
  assert.equal(config.defaultDirection, 'desc')
  // 0189 (owner 2026-11-11): a card is neither open nor ended — no
  // `is_open` filter.
  assert.deepEqual(plain(config.filterFields.map((field) => field.key)), [
    'pricing_status',
    'equipment_ownership_status',
    'equipment_lessor_id',
    'company_id',
    'project_id',
  ])
  // The supplier only while the owner filter selects «مالك اخر» (the
  // purchasing lists' field).
  const supplier = config.filterFields.find(
    (field) => field.key === 'equipment_lessor_id',
  )
  assert.deepEqual(plain(supplier.visibleWhen), {
    field: 'equipment_ownership_status',
    includes: 'external_supplier',
  })
  const status = config.filterFields.find(
    (field) => field.key === 'pricing_status',
  )
  assert.deepEqual(plain(status.options.map((option) => option.value)), [
    'draft',
    'approved',
  ])
  // It opened on the open cards until 0189; now every card on a supplier PO.
  assert.equal(config.defaultFilters, undefined)
  assert.equal(pricesList.CARD_PRICES_DEFAULT_FILTER, undefined)
  assert.deepEqual(plain(config.sortableFields.map((field) => field.key)), [
    'equipment_code',
    'company_name_ar',
    'supplier_price',
    'card_client_price',
    'card_margin_pct',
    'pricing_status',
    'last_modified_at',
  ])
})

test('the query always carries supplier_line_id IS NOT NULL, whatever the filters', () => {
  assert.equal(pricesList.CARD_PRICES_REQUIRED_COLUMN, 'supplier_line_id')
  const calls = []
  const recorder = {
    not: (...args) => {
      calls.push(args)
      return recorder
    },
  }
  assert.equal(pricesList.withSupplierLineOnly(recorder), recorder)
  assert.deepEqual(calls, [['supplier_line_id', 'is', null]])
  const screen = read('src', 'screens', 'sales', 'CardPricesScreen.tsx')
  assert.match(
    screen,
    /withSupplierLineOnly\(\s+supabase\s+\.from\('sales_equipment_cards'\)\s+\.select\(CARD_PRICES_SELECT, \{ count: 'exact' \}\),\s+\)/,
  )
  // Server-side search, filters and paging; a failed load is an error state.
  assert.match(
    screen,
    /buildSearchFilter\(\s+cardPricesListConfig\.searchFields,/,
  )
  assert.match(screen, /applyListFilters\(\s+query,\s+list\.filters,/)
  assert.match(
    screen,
    /\.range\(\(list\.page - 1\) \* list\.pageSize, list\.page \* list\.pageSize - 1\)/,
  )
  assert.match(
    screen,
    /<ErrorState\s+description=\{t\('cardPricesLoadError'\)\}\s+onRetry=\{fetchRows\}\s+\/>/,
  )
})

// --- The batch save and the approval actions ------------------------------------------------

test('the save sends only the changed, non-approved rows in ONE set_equipment_card_client_prices call', () => {
  const screen = read('src', 'screens', 'sales', 'CardPricesScreen.tsx')
  assert.match(
    screen,
    /const changed = rows\.filter\(\s+\(row\) => row\.pricing_status !== 'approved' && isChanged\(row\),\s+\)/,
  )
  assert.match(
    screen,
    // 0185: each item carries the chosen unit too.
    /const items: CardPriceBatchItem\[\] = changed\.map\(\(row\) => \(\{\s+card_id: row\.card_id,\s+price: parseCardPrice\(draftOf\(row\)\),\s+rate_unit: unitOf\(row\),\s+\}\)\)/,
  )
  assert.match(screen, /await setEquipmentCardClientPrices\(items\)/)
  assert.equal(
    (screen.match(/setEquipmentCardClientPrices\(/g) ?? []).length,
    1,
  )
  assert.doesNotMatch(
    screen,
    /\.from\('equipment_cards'\)|\.update\(|\.insert\(|\.rpc\(/,
  )
  // sales.manage for the inputs and the bar, sales.approve for the actions.
  assert.match(screen, /const canManage = can\('sales\.manage'\)/)
  assert.match(screen, /const canApprove = can\('sales\.approve'\)/)
  assert.match(screen, /\{canManage && !loadError && rows\.length > 0 && \(/)
  assert.match(
    screen,
    /disabled=\{changed\.length === 0 \|\| invalid\.length > 0\}/,
  )
  // An approved price is read-only with the lock.
  assert.match(screen, /if \(approved \|\| !canManage\)/)
  assert.match(screen, /<Lock\s+size=\{14\}/)
  // The approve action is disabled with its reason; the return opens the dialog.
  assert.match(
    screen,
    /cardPricingApprovalBlocker\(\{\s+\.\.\.row,\s+unsaved: isChanged\(row\),\s+\}\)/,
  )
  assert.match(screen, /disabled=\{blocker !== null\}/)
  assert.match(screen, /onClick=\{\(\) => setReturning\(target\(row\)\)\}/)
  // The sticky bar and the toast.
  assert.match(screen, /sticky bottom-0 z-10/)
  assert.match(
    screen,
    /t\('cardPricesSaved'\)\.replace\(\s+'\{prices\}',\s+pricesCountLabel\(result\.data, lang\),/,
  )

  const data = read('src', 'lib', 'salesData.ts')
  for (const fn of [
    'set_equipment_card_client_price',
    'set_equipment_card_client_prices',
    'approve_equipment_card_pricing',
    'return_equipment_card_pricing',
  ])
    assert.match(data, new RegExp(`supabase\\.rpc\\('${fn}'`), fn)
  assert.match(
    data,
    /p_items: items\.map\(\(item\) => \(\{\s+card_id: item\.card_id,\s+price: item\.price,\s+rate_unit: item\.rate_unit,\s+\}\)\)/,
  )
  // The dialogs call the two approval functions.
  const dialogs = read('src', 'components', 'sales', 'CardPricingDialogs.tsx')
  assert.match(dialogs, /await approveEquipmentCardPricing\(card\.card_id\)/)
  assert.match(
    dialogs,
    /await returnEquipmentCardPricing\(\{\s+cardId: card\.card_id,\s+note,\s+\}\)/,
  )
  assert.match(
    dialogs,
    /validateWithSchema\(cardPricingReturnSchema, \{ note \}\)/,
  )
})

// --- The card page -------------------------------------------------------------------

test('the card page hides the months behind SHOW_CARD_MONTHS = false and shows the pricing', () => {
  const page = read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx')
  assert.match(page, /export const SHOW_CARD_MONTHS = false/)
  // The section, its button, its reads and its dialog are gated; the code stays.
  assert.match(page, /\{SHOW_CARD_MONTHS && \(\s+<Card padded=\{false\}/)
  assert.match(
    page,
    /\{canManage && SHOW_CARD_MONTHS && recordButton\('sm'\)\}/,
  )
  assert.match(
    page,
    /\{canManage && SHOW_CARD_MONTHS && recordButton\('md'\)\}/,
  )
  assert.match(
    page,
    /\{canManage && SHOW_CARD_MONTHS && \(\s+<RecordCardMonthDialog/,
  )
  assert.match(
    page,
    /SHOW_CARD_MONTHS\s+\? supabase\s+\.from\('sales_card_months'\)/,
  )
  assert.match(
    page,
    /SHOW_CARD_MONTHS\s+\? supabase\s+\.from\('sales_card_month_slots'\)/,
  )
  assert.match(page, /<RecordCardMonthDialog/)
  // The pricing: the client price in its unit (0185), the status badge with
  // the approver, the approve / return actions for sales.approve.
  assert.match(page, /const canApprove = can\('sales\.approve'\)/)
  assert.match(page, /label: t\('cardPriceClient'\)/)
  assert.match(page, /unit=\{card\.card_client_price_unit\}/)
  assert.match(
    page,
    /<CardPricingStatusBadge\s+status=\{pricingStatus\}\s+approvedBy=\{card\.pricing_approved_by_name\}\s+approvedAt=\{card\.pricing_approved_at\}/,
  )
  assert.match(
    page,
    /action=\{canApprove \? pricingButton\('sm'\) : undefined\}/,
  )
  assert.match(
    page,
    /const approvalBlocker = cardPricingApprovalBlocker\(card\)/,
  )
  assert.match(page, /<ApproveCardPricingDialog/)
  assert.match(page, /<ReturnCardPricingDialog/)
  // The timeline labels a supplier PO event exactly as the PO page does.
  assert.match(page, /supplierPoEventLabel\(event\.event_type, t, lang\)/)
  assert.doesNotMatch(page, /SUPPLIER_PO_EVENT_LABEL_KEYS\[event\.event_type\]/)
  // An unknown event type falls back to the generic update label.
  assert.match(
    read('src', 'lib', 'purchasing.ts'),
    /SUPPLIER_PO_EVENT_LABEL_KEYS\[eventType\] \?\? 'supplierPoEventUpdated'/,
  )
  // 0187: equipment_removed is named there too (purchasing lists it as well).
  assert.deepEqual(plain(sales.SALES_SUPPLIER_PO_EVENT_LABEL_KEYS), {
    approval_returned: 'supplierPoEventApprovalReturned',
    equipment_removed: 'supplierPoEventEquipmentRemoved',
  })
  assert.deepEqual(plain(sales.EQUIPMENT_CARD_EVENT_LABEL_KEYS), {
    month_recorded: 'cardMonthEventRecorded',
    month_updated: 'cardMonthEventUpdated',
    month_deleted: 'cardMonthEventDeleted',
    client_price_changed: 'cardPricingEventPriceChanged',
    pricing_approved: 'cardPricingEventApproved',
    pricing_returned: 'cardPricingEventReturned',
    card_ended: 'equipmentCardEventEnded',
    card_reopened: 'equipmentCardEventReopened',
  })
  // The select carries the trailing columns of the view.
  const data = read('src', 'lib', 'salesData.ts')
  assert.match(
    data,
    /export const CARD_PRICING_COLUMNS =\s+'card_client_price,pricing_status,pricing_approved_at,pricing_approved_by,pricing_approved_by_name,card_margin,card_margin_pct,supplier_po_approval_status,card_client_price_unit'/,
  )
  assert.match(data, /has_supplier_po,\$\{CARD_PRICING_COLUMNS\}`/)
})

// --- The pure helpers ----------------------------------------------------------------

test('cardMargin / cardMarginPct mirror the view: the same unit on both sides (0185), over the client price', () => {
  assert.equal(sales.cardMargin(1500, 'month', 1000, 'month'), 500)
  assert.equal(sales.cardMargin('1500.00', 'month', '1000.00', 'month'), 500)
  assert.equal(sales.cardMargin(1000, 'month', 1500, 'month'), -500)
  // An owned Al-Azani unit with a 0-priced line keeps the full client price.
  assert.equal(sales.cardMargin(1200, 'month', 0, 'month'), 1200)
  // 0185: two daily prices have a margin; two different units none.
  assert.equal(sales.cardMargin(150, 'day', 100, 'day'), 50)
  assert.equal(sales.cardMargin(1500, 'month', 100, 'day'), null)
  assert.equal(sales.cardMargin(null, 'month', 1000, 'month'), null)
  assert.equal(sales.cardMargin(1500, 'month', null, 'month'), null)
  assert.equal(sales.cardMargin(1500.555, 'month', 1000, 'month'), 500.56)
  // The percentage: rounded to 2 decimals, null without a margin or at 0.
  assert.equal(sales.cardMarginPct(500, 1500), 33.33)
  assert.equal(sales.cardMarginPct(1200, 1200), 100)
  assert.equal(sales.cardMarginPct(-500, 1000), -50)
  assert.equal(sales.cardMarginPct(null, 1500), null)
  assert.equal(sales.cardMarginPct(0, 0), null)
  assert.equal(sales.formatMarginPct(36.36), '36.4%')
  assert.equal(sales.formatMarginPct(null), '—')
  assert.equal(
    sales.cardMarginBlocker({
      clientPrice: null,
      clientRateUnit: 'month',
      supplierPrice: 1,
      supplierRateUnit: 'month',
    }),
    'no_client_price',
  )
  assert.equal(
    sales.cardMarginBlocker({
      clientPrice: 1,
      clientRateUnit: 'month',
      supplierPrice: null,
      supplierRateUnit: 'month',
    }),
    'no_supplier_price',
  )
  assert.equal(
    sales.cardMarginBlocker({
      clientPrice: 1,
      clientRateUnit: 'month',
      supplierPrice: 1,
      supplierRateUnit: 'day',
    }),
    'units_differ',
  )
  assert.equal(
    sales.cardMarginBlocker({
      clientPrice: 1,
      clientRateUnit: 'day',
      supplierPrice: 1,
      supplierRateUnit: 'day',
    }),
    null,
  )
  // The same rule as the migration's view (the text of both).
  const migration = read(
    'supabase',
    'migrations',
    '20261104110000_0174_equipment_card_pricing.sql',
  )
  assert.match(
    migration,
    /sp\.supplier_rate_unit = 'month'\s+THEN round\(c\.client_price - sp\.supplier_price, 2\)/,
  )
  assert.match(
    migration,
    /round\(m\.card_margin \/ c\.client_price \* 100, 2\)/,
  )
})

test('cardPricingApprovalBlocker: the reasons in the order the user can fix them', () => {
  const ok = {
    pricing_status: 'draft',
    card_client_price: 1500,
    supplier_line_id: 'l1',
    supplier_price: 1000,
  }
  assert.equal(sales.cardPricingApprovalBlocker(ok), null)
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, pricing_status: 'approved' }),
    'cardPricingErrorNotDraft',
  )
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, unsaved: true }),
    'cardPricingBlockedUnsaved',
  )
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, card_client_price: null }),
    'cardPricingBlockedNoClientPrice',
  )
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, supplier_line_id: null }),
    'cardPricingBlockedNoSupplierLine',
  )
  // 0189: a supplier PO is neither open nor closed; a line is enough.
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, supplier_po_status: 'closed' }),
    null,
  )
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, supplier_price: null }),
    'cardPricingBlockedNoSupplierPrice',
  )
  // 0 counts as a price (an Al-Azani unit on an internal PO).
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, supplier_price: 0 }),
    null,
  )
  // Two different units are approvable (0185: no unit-match rule).
  assert.equal(
    sales.cardPricingApprovalBlocker({ ...ok, supplier_rate_unit: 'day' }),
    null,
  )
})

test('the price value, its schema, the count label and the status badge', () => {
  for (const value of [
    '0',
    '1500',
    '1500.5',
    '1500.55',
    ' 1500 ',
    '9999999999.99',
  ])
    assert.ok(sales.isValidCardPrice(value), value)
  for (const value of ['', '-1', '1.555', 'abc', '1,500', '12345678901'])
    assert.ok(!sales.isValidCardPrice(value), value)
  assert.equal(sales.parseCardPrice(' 1500.50 '), 1500.5)
  assert.equal(sales.parseCardPrice(''), null)
  assert.equal(sales.parseCardPrice('x'), null)
  // The Zod schema: empty = no price, else a valid price.
  assert.equal(v.cardPriceSchema.safeParse('').success, true)
  assert.equal(v.cardPriceSchema.safeParse('1500.5').success, true)
  const bad = v.cardPriceSchema.safeParse('1.555')
  assert.equal(bad.success, false)
  assert.equal(bad.error.issues[0].message, 'cardPriceInvalid')
  assert.deepEqual(
    plain(
      v.validateWithSchema(v.cardPricingReturnSchema, {
        note: 'x'.repeat(501),
      }),
    ),
    {
      note: 'cardMonthNoteTooLong',
    },
  )
  assert.deepEqual(
    plain(v.validateWithSchema(v.cardPricingReturnSchema, { note: '' })),
    {},
  )
  // «سعر» / «سعرين» / «3 اسعار» / «11 سعرا».
  assert.equal(sales.pricesCountLabel(1, 'ar'), 'سعر')
  assert.equal(sales.pricesCountLabel(2, 'ar'), 'سعرين')
  assert.equal(sales.pricesCountLabel(3, 'ar'), '3 اسعار')
  assert.equal(sales.pricesCountLabel(11, 'ar'), '11 سعرا')
  assert.equal(sales.pricesCountLabel(1, 'en'), '1 price')
  assert.equal(sales.pricesCountLabel(4, 'en'), '4 prices')
  assert.deepEqual(plain(sales.CARD_PRICING_STATUS_BADGE), {
    draft: { key: 'cardPricingDraft', tone: 'neutral' },
    approved: { key: 'cardPricingApproved', tone: 'success' },
  })
  assert.equal(sales.cardPricingStatusOf('approved'), 'approved')
  assert.equal(sales.cardPricingStatusOf(null), 'draft')
})

test('the 0174 tokens map to safe messages; the raw text never shows', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20261104110000_0174_equipment_card_pricing.sql',
  )
  const raised = new Set(
    [...migration.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  for (const token of raised)
    assert.ok(sales.CARD_PRICING_ERROR_TOKENS.includes(token), token)
  for (const token of sales.CARD_PRICING_ERROR_TOKENS)
    assert.ok(sales.CARD_PRICING_FORM_MESSAGES[token], token)
  assert.equal(
    sales.cardPricingFormMessage({ message: 'card_pricing_approved_locked' }),
    'cardPricingErrorApprovedLocked',
  )
  assert.equal(
    sales.cardPricingFormMessage({ message: 'card_pricing_no_supplier_price' }),
    'cardPricingErrorNoSupplierPrice',
  )
  assert.equal(
    sales.cardPricingFormMessage({ message: 'sales_approve_required' }),
    'cardPricingErrorApproveRequired',
  )
  assert.equal(
    sales.cardPricingFormMessage({ message: 'anything else' }),
    'supplierPoSaveFailed',
  )
  assert.equal(sales.cardPricingFormMessage(null), 'supplierPoSaveFailed')
  // Every message is a translation key in both languages.
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of new Set(Object.values(sales.CARD_PRICING_FORM_MESSAGES)))
    assert.equal(
      (translations.match(new RegExp(`^\\s+${key}:`, 'gm')) ?? []).length,
      2,
      key,
    )
  // The event details of the three pricing events.
  assert.equal(
    sales.equipmentCardEventDetail(
      {
        event_type: 'client_price_changed',
        payload: { old_price: 1000, new_price: 1200 },
      },
      'ar',
    ),
    '1,000.00 ← 1,200.00',
  )
  assert.equal(
    sales.equipmentCardEventDetail(
      {
        event_type: 'client_price_changed',
        payload: { old_price: null, new_price: 1200 },
      },
      'en',
    ),
    '— → 1,200.00',
  )
  assert.equal(
    sales.equipmentCardEventDetail(
      {
        event_type: 'pricing_approved',
        payload: {
          client_price: 1500,
          supplier_po_number: 'SPO260046',
          supplier_po_approved: true,
        },
      },
      'ar',
      undefined,
      undefined,
      (po) => `PO ${po}`,
    ),
    '1,500.00 · PO SPO260046',
  )
  assert.equal(
    sales.equipmentCardEventDetail(
      {
        event_type: 'pricing_returned',
        payload: { note: 'سعر قديم', supplier_po_returned: false },
      },
      'ar',
      undefined,
      undefined,
      undefined,
      () => 'returned',
    ),
    'سعر قديم',
  )
})

// --- The copy and the look ------------------------------------------------------------

test('the new copy uses the plain alif and tokens, never palette colours', () => {
  for (const file of NEW_FILES) {
    const source = read(...file)
    assert.doesNotMatch(source, HAMZA_ALIF, file.join('/'))
    assert.doesNotMatch(source, PALETTE, file.join('/'))
  }
  const translations = read('src', 'i18n', 'translations.ts')
  const block = translations.slice(
    translations.indexOf('// card pricing (migration 0174'),
    translations.indexOf('// sales-screens — end'),
  )
  assert.ok(block.length > 100)
  assert.doesNotMatch(block, HAMZA_ALIF)
  for (const key of [
    'cardPrices',
    'cardPricesDesc',
    'cardPriceClientMonthly',
    'cardPriceSupplier',
    'cardPriceMarginPct',
    'cardPricingStatus',
    'cardPricingApprove',
    'cardPricingReturn',
    'cardPriceSaveCount',
    'cardPricesSaved',
    'supplierPoEventApprovalReturned',
  ])
    assert.equal(
      (translations.match(new RegExp(`^\\s+${key}:`, 'gm')) ?? []).length,
      2,
      key,
    )
  // The main-list look on the prices table.
  const screen = read('src', 'screens', 'sales', 'CardPricesScreen.tsx')
  assert.match(screen, /cellTextClassName="text-\[13px\]"/)
  assert.match(screen, /cellClassName="py-2"/)
  // The AGENTS.md bullet.
  const agents = read('AGENTS.md')
  assert.match(
    agents,
    /Card pricing \(«اسعار المعدات», owner decisions 2026-11-04, migration 0174\)/,
  )
  assert.match(agents, /SHOW_CARD_MONTHS/)
})
