// sales-screens (owner approval 2026-11-02, migration 0169): the real sales
// phase-1 screens mirror the purchasing screens — «PO العملاء» with its two
// views, the client PO page, the «المبيعات» card of the equipment page, the
// second stub of the «المعدات في المشاريع» ticket, «كروت المعدات» and the
// card page — behind the `sales.view` gates. Source checks plus the pure
// helpers of src/lib/sales.ts and the Zod schemas.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts))

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
        throw new Error(`Unexpected module: ${request}`)
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

const HAMZA_ALIF = /[أإآ]/
const PALETTE =
  /\b(?:bg|text|border)-(?:gray|zinc|slate|emerald|green|amber|red|blue)-\d{2,3}\b/

const SCREENS = [
  ['src', 'screens', 'sales', 'ClientPosListScreen.tsx'],
  ['src', 'screens', 'sales', 'ClientPoUnitsList.tsx'],
  ['src', 'screens', 'sales', 'ClientPoDetail.tsx'],
  ['src', 'screens', 'sales', 'EquipmentCardsScreen.tsx'],
  ['src', 'screens', 'sales', 'EquipmentCardDetail.tsx'],
  // Phase 2 (migration 0172).
  ['src', 'screens', 'sales', 'CardMonthsBatchScreen.tsx'],
  ['src', 'screens', 'sales', 'CardMonthsListScreen.tsx'],
]
const COMPONENTS = fs
  .readdirSync(path.join(ROOT, 'src', 'components', 'sales'))
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ['src', 'components', 'sales', name])
const LIBS = [
  ['src', 'lib', 'sales.ts'],
  ['src', 'lib', 'salesData.ts'],
]
const ALL = [...SCREENS, ...COMPONENTS, ...LIBS]

// --- Routes and gates --------------------------------------------------------------

test('the sales section: a parent with its children on sales.view, like purchasing', () => {
  const entry = nav.NAV_ENTRIES.find((item) => item.key === 'sales')
  assert.deepEqual(plain(entry), {
    key: 'sales',
    requires: [{ key: 'sales.view' }],
    children: [
      { key: 'sales/orders', requires: [{ key: 'sales.view' }] },
      { key: 'sales/cards', requires: [{ key: 'sales.view' }] },
      // Phase 2 (0172): «كروت التشغيل» and «الشهور».
      { key: 'sales/timesheets', requires: [{ key: 'sales.view' }] },
      { key: 'sales/months', requires: [{ key: 'sales.view' }] },
    ],
  })
  // Right after purchasing in menu order.
  const keys = nav.NAV_ENTRIES.map((item) => item.key)
  assert.equal(keys[keys.indexOf('purchasing') + 1], 'sales')
  // The detail pages gate on sales.view too.
  assert.deepEqual(plain(nav.pageGate('sales/:id')), [{ key: 'sales.view' }])
  assert.deepEqual(plain(nav.pageGate('sales/cards/:id')), [
    { key: 'sales.view' },
  ])
  // /sales opens the orders list; /sales/cards/:id is a card.
  assert.equal(nav.routePageOf(['sales']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'orders']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'cards']), 'sales/cards')
  assert.equal(nav.routePageOf(['sales', 'cards', 'c1']), 'sales/cards/:id')
  assert.equal(nav.routePageOf(['sales', 'p1']), 'sales/:id')
  // A sales.view holder (the custom «المبيعات» role) lands on the section.
  const plan = nav.planShell({
    status: 'ready',
    permissions: new Map([['sales.view', 'all']]),
  })
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'sales/orders')
  assert.deepEqual([...plan.pages].sort(), [
    'sales',
    'sales/:id',
    'sales/cards',
    'sales/cards/:id',
    'sales/months',
    'sales/orders',
    'sales/timesheets',
  ])
  // Nothing without the key.
  const none = nav.planShell({
    status: 'ready',
    permissions: new Map([['purchasing.view', 'all']]),
  })
  assert.ok(!none.pages.has('sales/orders'))
  assert.ok(!none.pages.has('sales/:id'))
})

test('App.tsx routes the four sales pages and the equipment page gets the sales card', () => {
  const app = read('src', 'App.tsx')
  assert.match(
    app,
    /sales: \{ label: 'sales', icon: <Receipt size=\{18\} \/> \}/,
  )
  assert.match(app, /'sales\/orders': 'clientPos',/)
  assert.match(app, /'sales\/cards': 'equipmentCards',/)
  assert.match(app, /page === 'sales\/:id' \? \(\s+<ClientPoDetail/)
  assert.match(app, /page === 'sales\/cards\/:id' \? \(\s+<EquipmentCardDetail/)
  assert.match(app, /page === 'sales\/orders' && \(\s+<ClientPosListScreen/)
  assert.match(app, /page === 'sales\/cards' && \(\s+<EquipmentCardsScreen/)
  // The equipment page opens a client PO only when the shell opens it.
  assert.match(
    app,
    /onOpenClientPo=\{\s+shell\.pages\.has\('sales\/:id'\)\s+\? \(id\) => router\.push\(`\/sales\/\$\{id\}`\)\s+: undefined\s+\}/,
  )
  const detail = read('src', 'screens', 'EquipmentDetail.tsx')
  assert.match(
    detail,
    /<EquipmentSalesCard equipmentId=\{equipment\.id\} onOpenPo=\{onOpenClientPo\} \/>/,
  )
  // The card renders nothing (and requests nothing) without sales.view.
  const card = read('src', 'components', 'sales', 'EquipmentSalesCard.tsx')
  assert.match(card, /const allowed = can\('sales\.view'\)/)
  assert.match(card, /if \(!allowed\) return null/)
  assert.match(card, /if \(!allowed\) return\s/)
  // Tab titles.
  const titles = read('src', 'lib', 'pageTitle.ts')
  assert.match(titles, /sales: \{ kind: 'top', name: 'sales' \}/)
  assert.match(
    titles,
    /'sales\/:id': \{ kind: 'detail', section: 'clientPos' \}/,
  )
  assert.match(
    titles,
    /'sales\/cards\/:id': \{ kind: 'detail', section: 'equipmentCards' \}/,
  )
  // The roles page labels the new permission group.
  const roles = read('src', 'lib', 'rolesAdmin.ts')
  assert.match(roles, /sales: 'permissionGroupSales',/)
})

test('the purchasing structure review page moved to /sales-structure', () => {
  assert.ok(!exists('app', 'sales', 'page.tsx'), 'app/sales/page.tsx is gone')
  const page = read('app', 'sales-structure', 'page.tsx')
  assert.match(
    page,
    /import \{ PurchasingStructure \} from '@\/screens\/sales\/PurchasingStructure'/,
  )
  // Its gate is unchanged (settings.roles, fail closed).
  const structure = read('src', 'screens', 'sales', 'PurchasingStructure.tsx')
  assert.match(
    structure,
    /const access = rolesPageAccess\(permissions\.status, permissions\.permissions\)/,
  )
  assert.match(structure, /\/sales-structure/)
})

// --- Writes through the RPC wrappers only --------------------------------------------

test('every write goes through the five 0169 functions; no direct insert / update', () => {
  const data = read('src', 'lib', 'salesData.ts')
  for (const fn of [
    'create_client_po',
    'add_client_po_equipment',
    'update_client_po',
    'update_client_po_equipment',
    'close_client_po',
  ])
    assert.match(data, new RegExp(`supabase\\.rpc\\('${fn}'`), fn)
  for (const file of [...SCREENS, ...COMPONENTS]) {
    const source = read(...file)
    const name = file.join('/')
    assert.doesNotMatch(source, /\.rpc\(/, `${name} calls no RPC directly`)
    assert.doesNotMatch(
      source,
      /\.from\('(?:client_po[a-z_]*|equipment_cards)'\)[\s\S]*?\.(?:insert|update|upsert|delete)\(/,
      `${name} never writes a sales table`,
    )
    assert.doesNotMatch(source, /\.(?:insert|upsert|delete)\(/, name)
  }
  // The dialogs call the wrappers.
  assert.match(
    read('src', 'components', 'sales', 'CreateClientPoDialog.tsx'),
    /await createClientPo\(form, lines\)/,
  )
  assert.match(
    read('src', 'components', 'sales', 'AddClientPoEquipmentDialog.tsx'),
    /await addClientPoEquipment\(\{/,
  )
  assert.match(
    read('src', 'components', 'sales', 'EditClientPoDialog.tsx'),
    /await updateClientPo\(\{/,
  )
  assert.match(
    read('src', 'components', 'sales', 'EditClientPoLineDialog.tsx'),
    /await updateClientPoEquipment\(\{/,
  )
  assert.match(
    read('src', 'components', 'sales', 'CloseClientPoDialog.tsx'),
    /await closeClientPo\(po\.id\)/,
  )
})

// --- Selects name only columns of the views ---------------------------------------------

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261102120000_0169_client_pos.sql',
)

function viewBody(name) {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE VIEW public.${name}`)
  assert.ok(start > 0, name)
  const end = MIGRATION.indexOf('COMMENT ON VIEW', start)
  return MIGRATION.slice(start, end)
}

test('the selects of the screens name only columns of the 0169 views', () => {
  const data = read('src', 'lib', 'salesData.ts')
  const selectOf = (name) => {
    const match = new RegExp(`export const ${name} =\\s+'([^']+)'`).exec(data)
    assert.ok(match, name)
    return match[1].split(',')
  }
  const check = (constant, view) => {
    const sql = viewBody(view)
    for (const column of selectOf(constant))
      assert.match(
        sql,
        new RegExp(`(AS |\\.)${column}[, \\n]`),
        `${view}.${column}`,
      )
  }
  check('SALES_PO_UNITS_SELECT', 'sales_po_units')
  check('EQUIPMENT_CARDS_SELECT', 'sales_equipment_cards')
  check('SITE_UNITS_CLIENT_SELECT', 'purchasing_site_units')
  // The list configs' search, filter and sort fields are view columns too.
  const configs = read('src', 'lib', 'listConfigs.ts')
  const fieldsOf = (name, next) => {
    const block = configs.slice(
      configs.indexOf(`export const ${name}`),
      next ? configs.indexOf(`export const ${next}`) : undefined,
    )
    return [
      ...block.matchAll(/^\s{4}'(\w+)',$/gm),
      ...block.matchAll(/^\s{6}key: '(\w+)',$/gm),
      ...block.matchAll(/\{ key: '(\w+)', label:/g),
    ].map((m) => m[1])
  }
  const units = fieldsOf('clientPoUnitsListConfig', 'clientPosListConfig')
  assert.ok(units.length >= 12)
  for (const field of units)
    assert.match(
      viewBody('sales_po_units'),
      new RegExp(`(AS |\\.)${field}[, \\n]`),
      field,
    )
  // The phase-2 «الشهور» config (0172) follows it in the file.
  const cards = fieldsOf('equipmentCardsListConfig', 'cardMonthsListConfig')
  assert.ok(cards.length >= 12)
  for (const field of cards)
    assert.match(
      viewBody('sales_equipment_cards'),
      new RegExp(`(AS |\\.)${field}[, \\n]`),
      field,
    )
  // The orders list reads client_pos columns and the computed column.
  const orders = fieldsOf('clientPosListConfig', 'equipmentCardsListConfig')
  for (const field of orders)
    assert.ok(
      MIGRATION.includes(`  ${field} `) ||
        (MIGRATION.includes(`unpriced_count(`) && field === 'unpriced_count') ||
        [
          'company_id',
          'project_id',
          'status',
          'po_number',
          'issue_date',
          'expiry_date',
          'created_at',
          'updated_at',
        ].includes(field),
      field,
    )
})

// --- The look: tokens, plain alif, logical direction, real links ------------------------

test('tokens only, plain alif, logical direction utilities, AppLink for navigation', () => {
  for (const file of ALL) {
    const source = read(...file)
    const name = file.join('/')
    assert.doesNotMatch(source, PALETTE, `${name} uses no palette class`)
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b/, `${name} uses no hex`)
    assert.doesNotMatch(source, HAMZA_ALIF, `${name} uses the plain alif`)
    assert.doesNotMatch(
      source,
      /\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-\d/,
      `${name} uses logical direction utilities`,
    )
    assert.doesNotMatch(source, /\bprettier-ignore\b/, name)
  }
  // The new translation block: both languages, the same keys, plain alif.
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ sales-screens — start[^\n]*\n([\s\S]*?)\/\/ sales-screens — end/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  const keysOf = (block) =>
    [...block.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keysOf(blocks[0][1]), keysOf(blocks[1][1]))
  assert.ok(keysOf(blocks[0][1]).length > 80)
  assert.doesNotMatch(blocks[0][1], HAMZA_ALIF)
  // Real links: the PO pill, «تفاصيل», the rows and the ticket's client stub.
  const pill = read('src', 'components', 'sales', 'PoPill.tsx')
  assert.match(pill, /<AppLink\s+href=\{href\}/)
  const list = read('src', 'screens', 'sales', 'ClientPosListScreen.tsx')
  assert.match(
    list,
    /<Button size="sm" variant="primary" asChild>\s+<AppLink\s+href=\{`\/sales\/\$\{row\.id\}`\}/,
  )
  const units = read('src', 'screens', 'sales', 'ClientPoUnitsList.tsx')
  assert.match(
    units,
    /rowHref=\{\(row\) => `\/sales\/\$\{row\.client_po_id\}`\}/,
  )
  const cards = read('src', 'screens', 'sales', 'EquipmentCardsScreen.tsx')
  assert.match(
    cards,
    /rowHref=\{\(row\) => `\/sales\/cards\/\$\{row\.card_id\}`\}/,
  )
  const tickets = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(
    tickets,
    /<AppLink\s+href=\{`\/sales\/\$\{row\.client_po_id\}`\}/,
  )
  // The client stub only for a sales reader whose shell opens the PO page;
  // the supplier stub unchanged.
  assert.match(
    tickets,
    /const showClient = can\('sales\.view'\) && Boolean\(onSelectClientPo\)/,
  )
  assert.match(
    tickets,
    /<AppLink\s+href=\{`\/purchasing\/\$\{row\.supplier_po_id\}`\}/,
  )
  assert.match(tickets, /canManageSales && \(/)
})

test('the list screens: two views with the purchasing URL rule, the approved table look, error states', () => {
  const list = read('src', 'screens', 'sales', 'ClientPosListScreen.tsx')
  assert.match(list, /const VIEWS: PoListView\[\] = \['units', 'orders'\]/)
  assert.match(list, /return hasOrdersState\(params\) \? 'orders' : 'units'/)
  assert.match(list, /className=\{PRIMARY_ACTIVE_TRIGGER\}/)
  assert.match(list, /\.from\('client_pos'\)/)
  assert.match(list, /\.select\(CLIENT_PO_LIST_SELECT, \{ count: 'exact' \}\)/)
  assert.match(list, /cellTextClassName="text-\[13px\]"/)
  assert.match(list, /cellClassName="py-2"/)
  assert.match(
    list,
    /<ErrorState description=\{loadError\} onRetry=\{fetchRows\} \/>/,
  )
  assert.match(list, /const canManage = can\('sales\.manage'\)/)
  const units = read('src', 'screens', 'sales', 'ClientPoUnitsList.tsx')
  assert.match(units, /export const CLIENT_PO_UNITS_URL_PREFIX = 'u'/)
  assert.match(units, /\.from\('sales_po_units'\)/)
  assert.match(units, /\.select\(SALES_PO_UNITS_SELECT, \{ count: 'exact' \}\)/)
  // The supplier side's PO muted under the client pill.
  assert.match(units, /<PoPill number=\{row\.supplier_po_number\} muted \/>/)
  const cards = read('src', 'screens', 'sales', 'EquipmentCardsScreen.tsx')
  assert.match(cards, /\.from\('sales_equipment_cards'\)/)
  assert.match(
    cards,
    /\.select\(EQUIPMENT_CARDS_SELECT, \{ count: 'exact' \}\)/,
  )
  assert.match(
    cards,
    /<ErrorState\s+description=\{t\('equipmentCardsLoadError'\)\}/,
  )
})

test('the client PO page: the approved pattern, sales.manage actions, no approval or PDF', () => {
  const page = read('src', 'screens', 'sales', 'ClientPoDetail.tsx')
  assert.match(page, /const canManage = can\('sales\.manage'\)/)
  assert.match(page, /<StatCard/)
  assert.match(page, /xl:grid-cols-3 xl:grid-rows-\[auto_1fr\]/)
  assert.match(page, /xl:col-span-2/)
  assert.match(page, /rounded-xl border bg-bg p-3 sm:p-4/)
  assert.match(page, /aria-label=\{t\('sortBy'\)\}/)
  assert.match(page, /sticky bottom-0[^"]*sm:hidden/)
  assert.match(page, /env\(safe-area-inset-bottom\)/)
  assert.match(page, /<ClientPoEventsTimeline/)
  assert.match(page, /<DescriptionList/)
  assert.match(page, /<QuantityCell/)
  assert.doesNotMatch(
    page,
    /approval_status|canApprove|ApproveSupplierPoDialog|PrintSheet|supplierPoPdf|printing/,
  )
  // One amount per unit, never summed across units.
  assert.match(page, /clientPoTotalsByUnit\(lines\)/)
  assert.match(
    page,
    /<SalePricesByUnit parts=\{totalsByUnit\} amount=\{vatOf\} \/>/,
  )
  const menu = read('src', 'components', 'sales', 'ClientPoOptionsMenu.tsx')
  assert.doesNotMatch(menu, /onExport|onApprove/)
  // The card page: no «انهاء الكرت» (no function yet), the months table
  // of phase 2 (tests/salesPhase2Screens.test.cjs), both event tables.
  const card = read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx')
  assert.doesNotMatch(
    card,
    /end_equipment_card|endCard|onEndCard|variant="danger"/,
  )
  assert.doesNotMatch(card, /equipmentCardPhase2Hint/)
  assert.match(card, /\.from\('sales_card_months'\)/)
  assert.match(card, /\.from\('client_po_events'\)/)
  assert.match(card, /\.from\('supplier_po_events'\)/)
  assert.match(card, /\.from\('movement_visits'\)/)
})

// --- The pure helpers ----------------------------------------------------------------------

test('clientPoTotalsByUnit: one total per unit, month → day → hour, unpriced counted', () => {
  assert.deepEqual(
    plain(
      sales.clientPoTotalsByUnit([
        { price: 950, rate_unit: 'hour' },
        { price: '18500', rate_unit: 'month' },
        { price: null, rate_unit: 'day' },
        { price: 24000, rate_unit: 'month' },
        { price: 1400, rate_unit: 'day' },
      ]),
    ),
    {
      parts: [
        { unit: 'month', total: 42500 },
        { unit: 'day', total: 1400 },
        { unit: 'hour', total: 950 },
      ],
      unpriced: 1,
    },
  )
  assert.deepEqual(plain(sales.clientPoTotalsByUnit([])), {
    parts: [{ unit: 'month', total: 0 }],
    unpriced: 0,
  })
  assert.deepEqual(plain(sales.clientPoTotalFigures(1000)), {
    exclVat: 1000,
    vat: 150,
    inclVat: 1150,
  })
  assert.deepEqual(plain(sales.SALE_RATE_UNITS), ['month', 'day', 'hour'])
  assert.equal(sales.saleRateUnitOf('hour'), 'hour')
  assert.equal(sales.saleRateUnitOf('week'), 'month')
})

test('quantityLabel: the dual and the 3–10 plural in Arabic, the unit of the line', () => {
  const ar = (quantity, unit) => sales.quantityLabel(quantity, unit, 'ar')
  assert.equal(ar(null, 'month'), null)
  assert.equal(ar(1, 'month'), 'شهر')
  assert.equal(ar(2, 'month'), 'شهرين')
  assert.equal(ar(6, 'month'), '6 اشهر')
  assert.equal(ar(12, 'month'), '12 شهرا')
  assert.equal(ar('400', 'hour'), '400 ساعة')
  assert.equal(ar(3, 'hour'), '3 ساعات')
  assert.equal(ar(2, 'day'), 'يومين')
  assert.equal(ar(2.5, 'month'), '2.5 شهر')
  assert.equal(sales.quantityLabel(1, 'month', 'en'), '1 month')
  assert.equal(sales.quantityLabel(400, 'hour', 'en'), '400 hours')
  assert.equal(sales.equipmentCardStatus({ is_open: true }), 'open')
  assert.equal(sales.equipmentCardStatus({ period_to: '2026-09-30' }), 'ended')
})

test('the Zod schemas of the four forms', () => {
  const errors = (schema, values) => plain(v.validateWithSchema(schema, values))
  assert.deepEqual(
    errors(v.clientPoFormSchema, {
      company_id: '',
      project_id: '',
      po_number: '',
      issue_date: '',
      expiry_date: '',
      standard_hours: '',
      notes: '',
    }),
    {
      company_id: 'supplierPoCompanyRequired',
      project_id: 'supplierPoProjectRequired',
      po_number: 'clientPoNumberRequired',
      issue_date: 'clientPoIssueDateRequired',
      standard_hours: 'clientPoStandardHoursRequired',
    },
  )
  const valid = {
    company_id: 'c1',
    project_id: 'p1',
    po_number: ' PO20241200550 ',
    issue_date: '2026-10-01',
    expiry_date: '2027-03-31',
    standard_hours: '260',
    notes: '',
  }
  assert.deepEqual(errors(v.clientPoFormSchema, valid), {})
  assert.deepEqual(
    errors(v.clientPoFormSchema, { ...valid, expiry_date: '2026-09-30' }),
    { expiry_date: 'clientPoExpiryBeforeIssue' },
  )
  assert.deepEqual(
    errors(v.clientPoFormSchema, { ...valid, po_number: 'x'.repeat(61) }),
    { po_number: 'clientPoNumberInvalid' },
  )
  for (const hours of ['0', '-5', '12.5', 'abc'])
    assert.deepEqual(
      errors(v.clientPoFormSchema, { ...valid, standard_hours: hours }),
      { standard_hours: 'clientPoStandardHoursInvalid' },
      hours,
    )
  const line = {
    equipment_id: 'e1',
    price: '',
    rate_unit: 'hour',
    standard_hours: '',
    quantity: '',
    note: '',
  }
  assert.deepEqual(errors(v.clientPoLineFormSchema, line), {})
  assert.deepEqual(
    errors(v.clientPoLineFormSchema, { ...line, equipment_id: '' }),
    { equipment_id: 'supplierPoEquipmentRequired' },
  )
  assert.deepEqual(
    errors(v.clientPoLineFormSchema, { ...line, quantity: '0' }),
    { quantity: 'clientPoQuantityInvalid' },
  )
  assert.deepEqual(
    errors(v.clientPoLineFormSchema, {
      ...line,
      quantity: '6.5',
      price: '950',
    }),
    {},
  )
  assert.deepEqual(
    errors(v.clientPoLineFormSchema, { ...line, price: '12.345' }),
    { price: 'supplierPoPriceInvalid' },
  )
  assert.deepEqual(
    errors(v.clientPoLineEditFormSchema, {
      price: '10',
      rate_unit: 'month',
      standard_hours: '208',
      quantity: '',
      note: 'x'.repeat(501),
    }),
    { note: 'supplierPoLineNoteTooLong' },
  )
  assert.deepEqual(
    errors(v.clientPoEditFormSchema, {
      issue_date: '2026-10-01',
      expiry_date: '2026-01-01',
      notes: '',
    }),
    { expiry_date: 'clientPoExpiryBeforeIssue' },
  )
  // The create payload: empty = null, never 0.
  assert.deepEqual(
    plain(
      sales.clientPoEquipmentPayload([
        {
          equipment_id: 'e1',
          price: '',
          rate_unit: 'month',
          standard_hours: '',
          quantity: '',
          note: '',
        },
        {
          equipment_id: 'e2',
          price: ' 950 ',
          rate_unit: 'hour',
          standard_hours: '208',
          quantity: '400',
          note: ' x ',
        },
      ]),
    ),
    [
      {
        equipment_id: 'e1',
        price: null,
        rate_unit: 'month',
        standard_hours: null,
        quantity: null,
        note: null,
      },
      {
        equipment_id: 'e2',
        price: 950,
        rate_unit: 'hour',
        standard_hours: 208,
        quantity: 400,
        note: 'x',
      },
    ],
  )
})

test('every stable token of 0169 is known and mapped to a field or a message', () => {
  const raised = new Set(
    [...MIGRATION.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  assert.deepEqual([...raised].sort(), [...sales.CLIENT_PO_ERROR_TOKENS].sort())
  const fieldTokens = new Set(
    [
      ...sales.CLIENT_PO_CREATE_FIELD_RULES,
      ...sales.CLIENT_PO_LINE_FIELD_RULES,
      ...sales.CLIENT_PO_LINE_EDIT_FIELD_RULES,
      ...sales.CLIENT_PO_EDIT_FIELD_RULES,
    ].map((rule) => rule.match),
  )
  for (const token of raised)
    assert.ok(
      fieldTokens.has(token) || token in sales.CLIENT_PO_FORM_MESSAGES,
      `${token} maps to a field or a form message`,
    )
  const raisedError = (token) => ({ code: '22023', message: token })
  const map = (error, rules) => plain(v.mapDatabaseErrorToField(error, rules))
  assert.deepEqual(
    map(raisedError('duplicate_po_number'), sales.CLIENT_PO_CREATE_FIELD_RULES),
    { po_number: 'clientPoErrorDuplicateNumber' },
  )
  assert.deepEqual(
    map(raisedError('invalid_expiry_date'), sales.CLIENT_PO_EDIT_FIELD_RULES),
    { expiry_date: 'clientPoExpiryBeforeIssue' },
  )
  assert.deepEqual(
    map(
      raisedError('equipment_already_on_open_client_po'),
      sales.CLIENT_PO_LINE_FIELD_RULES,
    ),
    { equipment_id: 'clientPoErrorAlreadyOnOpenPo' },
  )
  assert.deepEqual(
    map(raisedError('invalid_quantity'), sales.CLIENT_PO_LINE_EDIT_FIELD_RULES),
    { quantity: 'clientPoQuantityInvalid' },
  )
  assert.equal(
    sales.clientPoFormMessage({ code: '55000', message: 'client_po_closed' }),
    'clientPoErrorClosed',
  )
  assert.equal(
    sales.clientPoFormMessage({
      code: '42501',
      message: 'sales_manage_required',
    }),
    'clientPoErrorManageRequired',
  )
  assert.equal(
    sales.clientPoFormMessage({ message: 'boom' }),
    'supplierPoSaveFailed',
  )
  // Every mapped key exists in both languages.
  const translations = read('src', 'i18n', 'translations.ts')
  const arKeys = new Set(
    [
      ...translations
        .slice(0, translations.indexOf('  en: {'))
        .matchAll(/^ {4}(\w+):/gm),
    ].map((m) => m[1]),
  )
  const enKeys = new Set(
    [
      ...translations
        .slice(translations.indexOf('  en: {'))
        .matchAll(/^ {4}(\w+):/gm),
    ].map((m) => m[1]),
  )
  const keys = [
    ...Object.values(sales.CLIENT_PO_FORM_MESSAGES),
    ...Object.values(sales.CLIENT_PO_EVENT_LABEL_KEYS),
    ...Object.values(sales.SALE_RATE_UNIT_LABEL_KEYS),
    ...Object.values(sales.SALE_PER_UNIT_KEYS),
    ...[
      ...sales.CLIENT_PO_CREATE_FIELD_RULES,
      ...sales.CLIENT_PO_LINE_FIELD_RULES,
      ...sales.CLIENT_PO_LINE_EDIT_FIELD_RULES,
      ...sales.CLIENT_PO_EDIT_FIELD_RULES,
    ].map((rule) => rule.key),
  ]
  for (const key of keys) {
    assert.ok(arKeys.has(key), `ar ${key}`)
    assert.ok(enKeys.has(key), `en ${key}`)
  }
})

test('clientPoEventDetail renders the payloads of 0169', () => {
  const codeOf = (id) => (id === 'e1' ? 'A055' : null)
  const price = (value) =>
    value === null || value === undefined ? '—' : `${value}`
  const unit = (value) =>
    ({ month: 'شهري', day: 'يومي', hour: 'بالساعة' })[value]
  const detail = (event_type, payload) =>
    sales.clientPoEventDetail(
      { event_type, payload },
      codeOf,
      price,
      (d) => d,
      unit,
    )
  assert.equal(detail('created', { po_number: 'PO1' }), 'PO1')
  assert.equal(
    detail('equipment_added', {
      equipment_id: 'e1',
      price: 950,
      rate_unit: 'hour',
    }),
    'A055 · 950 · بالساعة',
  )
  assert.equal(
    detail('equipment_added', {
      equipment_id: 'e1',
      price: null,
      rate_unit: 'month',
    }),
    'A055 · شهري',
  )
  assert.equal(
    detail('price_changed', {
      equipment_id: 'e1',
      old_price: 18000,
      new_price: 18500,
      old_rate_unit: 'month',
      new_rate_unit: 'month',
    }),
    'A055 · 18000 → 18500',
  )
  assert.equal(
    detail('line_updated', {
      equipment_id: 'e1',
      old_rate_unit: 'month',
      new_rate_unit: 'day',
      old_standard_hours: 260,
      new_standard_hours: 208,
    }),
    'A055 · شهري → يومي · 260 → 208',
  )
  assert.equal(
    detail('updated', {
      old_issue_date: '2026-10-01',
      new_issue_date: '2026-10-01',
      old_expiry_date: null,
      new_expiry_date: '2027-03-31',
    }),
    '— → 2027-03-31',
  )
  assert.equal(detail('closed', {}), null)
})
