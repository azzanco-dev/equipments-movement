// sales phase 2 (owner approval 2026-11-04 of the /ui-kit mockup, migration
// 0172 «كروت التشغيل»): the batch entry of one project's month
// (/sales/timesheets), the «الشهور» list (/sales/months), the months table and
// the «تسجيل شهر» dialog of the card page, and the contract hours on the
// client PO page. Source checks plus the pure helpers of src/lib/sales.ts:
// the live due rule must equal card_month_due, the contract-hours rule, the
// month labels and states, the event details and the 0172 token mapping.
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
        // listConfigs reaches the Excel helpers; these tests call pure
        // helpers only, so anything else is stubbed.
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
const monthsList = loadLibModule('cardMonthsList')
const saudi = loadLibModule('saudiTime')

const HAMZA_ALIF = /[أإآ]/
const PALETTE =
  /\b(?:bg|text|border)-(?:gray|zinc|slate|emerald|green|amber|red|blue)-\d{2,3}\b/

const NEW_FILES = [
  ['src', 'screens', 'sales', 'CardMonthsBatchScreen.tsx'],
  ['src', 'screens', 'sales', 'CardMonthsListScreen.tsx'],
  ['src', 'components', 'sales', 'RecordCardMonthDialog.tsx'],
  ['src', 'components', 'sales', 'CardMonthCells.tsx'],
  ['src', 'components', 'sales', 'CardMonthPicker.tsx'],
  ['src', 'components', 'sales', 'UnitIdentityCell.tsx'],
  ['src', 'lib', 'cardMonthsList.ts'],
]
const TOUCHED = [
  ['src', 'screens', 'sales', 'EquipmentCardDetail.tsx'],
  ['src', 'screens', 'sales', 'ClientPoDetail.tsx'],
  ['src', 'lib', 'sales.ts'],
  ['src', 'lib', 'salesData.ts'],
]

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261103110000_0172_equipment_card_months.sql',
)

function viewBody(name) {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE VIEW public.${name}`)
  assert.ok(start > 0, name)
  const end = MIGRATION.indexOf('COMMENT ON VIEW', start)
  return MIGRATION.slice(start, end)
}

// --- Routes, gates and titles --------------------------------------------------------

test('the two new children of «المبيعات» on sales.view, their routes and tab titles', () => {
  const entry = nav.NAV_ENTRIES.find((item) => item.key === 'sales')
  const keys = plain(entry.children.map((child) => child.key))
  assert.deepEqual(keys, [
    'sales/orders',
    'sales/cards',
    'sales/timesheets',
    'sales/months',
  ])
  for (const child of entry.children)
    assert.deepEqual(plain(child.requires), [{ key: 'sales.view' }])
  assert.equal(nav.routePageOf(['sales', 'timesheets']), 'sales/timesheets')
  assert.equal(nav.routePageOf(['sales', 'months']), 'sales/months')
  // Still a client PO id for anything else.
  assert.equal(nav.routePageOf(['sales', 'p1']), 'sales/:id')
  const plan = nav.planShell({
    status: 'ready',
    permissions: new Map([['sales.view', 'all']]),
  })
  assert.ok(plan.pages.has('sales/timesheets'))
  assert.ok(plan.pages.has('sales/months'))
  assert.equal(plan.landing, 'sales/orders')
  const none = nav.planShell({
    status: 'ready',
    permissions: new Map([['purchasing.view', 'all']]),
  })
  assert.ok(!none.pages.has('sales/timesheets'))
  assert.ok(!none.pages.has('sales/months'))
  // The tab titles: «كروت التشغيل · المبيعات», «الشهور · المبيعات».
  const titles = read('src', 'lib', 'pageTitle.ts')
  assert.match(
    titles,
    /'sales\/timesheets': \{ kind: 'sub', name: 'cardTimesheets', section: 'sales' \}/,
  )
  assert.match(
    titles,
    /'sales\/months': \{ kind: 'sub', name: 'cardMonths', section: 'sales' \}/,
  )
  const app = read('src', 'App.tsx')
  assert.match(app, /'sales\/timesheets': 'cardTimesheets',/)
  assert.match(app, /'sales\/months': 'cardMonths',/)
  assert.match(
    app,
    /page === 'sales\/timesheets' && \(\s+<CardMonthsBatchScreen/,
  )
  assert.match(app, /page === 'sales\/months' && \(\s+<CardMonthsListScreen/)
})

// --- The writes go through the three 0172 functions only ------------------------------

test('every month write is one of the three 0172 wrappers; the batch is ONE call', () => {
  const data = read('src', 'lib', 'salesData.ts')
  for (const fn of [
    'record_equipment_card_month',
    'record_equipment_card_months',
    'delete_equipment_card_month',
  ])
    assert.match(data, new RegExp(`supabase\\.rpc\\('${fn}'`), fn)
  // The month is sent as the first day of its month, the batch hours as
  // JSON numbers (the function refuses strings).
  assert.match(data, /p_month: monthStartOf\(month\)/)
  assert.match(data, /p_month: monthStartOf\(input\.month\)/)
  assert.match(data, /hours: item\.hours,/)
  for (const file of NEW_FILES) {
    const source = read(...file)
    const name = file.join('/')
    assert.doesNotMatch(source, /\.rpc\(/, `${name} calls no RPC directly`)
    assert.doesNotMatch(source, /\.(?:insert|upsert|delete)\(/, name)
  }
  const batch = read('src', 'screens', 'sales', 'CardMonthsBatchScreen.tsx')
  assert.match(batch, /await recordEquipmentCardMonths\(month, items\)/)
  // Only the new or changed rows are sent; an empty field is never saved.
  assert.match(batch, /const changed = valid\.filter\(/)
  assert.match(batch, /!row\.recorded \|\|\s+Number\(row\.hours\) !== hours/)
  assert.match(
    batch,
    /\.filter\(\(\{ draft \}\) => draft\.hours\.trim\(\) !== ''\)/,
  )
  // The success toast and the error mapping.
  assert.match(batch, /t\('cardMonthsSaved'\)/)
  assert.match(batch, /cardMonthFormMessage\(result\.error\)/)
  assert.match(batch, /<ErrorState/)
  assert.match(batch, /const canManage = can\('sales\.manage'\)/)
  // The selection lives in the URL.
  assert.match(batch, /const PARAM_COMPANY = 'company'/)
  assert.match(batch, /const PARAM_PROJECT = 'project'/)
  assert.match(batch, /const PARAM_MONTH = 'month'/)
  assert.match(batch, /window\.history\.replaceState\(/)
  const dialog = read('src', 'components', 'sales', 'RecordCardMonthDialog.tsx')
  assert.match(dialog, /await recordEquipmentCardMonth\(\{/)
  assert.match(dialog, /await deleteEquipmentCardMonth\(\{/)
  assert.match(dialog, /validateWithSchema\(cardMonthFormSchema, form\)/)
  assert.match(
    dialog,
    /mapDatabaseErrorToField\(error, CARD_MONTH_FIELD_RULES\)/,
  )
})

// --- The selects and the list config name only columns of the 0172 views ----------------

test('the selects and the «الشهور» config name only columns of the 0172 views', () => {
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
  check('CARD_MONTH_SLOTS_SELECT', 'sales_card_month_slots')
  check('CARD_MONTHS_SELECT', 'sales_card_months')
  check('CARD_PENDING_SLOTS_SELECT', 'sales_card_month_slots')
  // The events select names the table's columns.
  for (const column of selectOf('EQUIPMENT_CARD_EVENT_SELECT'))
    assert.match(
      MIGRATION.slice(
        MIGRATION.indexOf('CREATE TABLE public.equipment_card_events'),
        MIGRATION.indexOf('CREATE INDEX equipment_card_events_card_seq_idx'),
      ),
      new RegExp(`\\n  ${column} `),
      column,
    )
  const config = configs.cardMonthsListConfig
  const sql = viewBody('sales_card_month_slots')
  const fields = [
    ...config.searchFields,
    ...config.filterFields.map((field) => field.key),
    ...config.sortableFields.map((field) => field.key),
  ]
  assert.ok(fields.length >= 12)
  for (const field of fields)
    assert.match(sql, new RegExp(`(AS |\\.)${field}[, \\n]`), field)
  // The default: the previous Saudi month, visible and removable; pending
  // months first.
  assert.equal(config.defaultSort, 'recorded')
  assert.equal(config.defaultDirection, 'asc')
  assert.equal(
    monthsList.CARD_MONTHS_DEFAULT_MONTH,
    saudi.saudiMonthKeys(1).from,
  )
  assert.match(monthsList.CARD_MONTHS_DEFAULT_MONTH, /^\d{4}-\d{2}-01$/)
  assert.deepEqual(plain(config.defaultFilters), [
    {
      id: 'default-month',
      field: 'month',
      operator: 'eq',
      value: monthsList.CARD_MONTHS_DEFAULT_MONTH,
    },
  ])
  // listConfigs keeps exporting configs only (its tests iterate every export).
  for (const value of Object.values(configs))
    assert.ok(Array.isArray(value.filterFields), 'a list config')
  assert.ok(monthsList.hasMonthOrCompanyFilter([config.defaultFilters[0]]))
  assert.ok(
    monthsList.hasMonthOrCompanyFilter([
      { id: 'c', field: 'company_id', operator: 'in', value: 'c1,c2' },
    ]),
  )
  assert.ok(
    !monthsList.hasMonthOrCompanyFilter([
      { id: 'p', field: 'project_id', operator: 'in', value: 'p1' },
      { id: 'm', field: 'month', operator: 'eq', value: '' },
    ]),
  )
  // The screen never reads the view whole: a month or a company always.
  const list = read('src', 'screens', 'sales', 'CardMonthsListScreen.tsx')
  assert.match(list, /\.from\('sales_card_month_slots'\)/)
  assert.match(
    list,
    /\.select\(CARD_MONTH_SLOTS_SELECT, \{ count: 'exact' \}\)/,
  )
  assert.match(
    list,
    /const effective = hasMonthOrCompanyFilter\(list\.filters\)\s+\? list\.filters\s+: \[\.\.\.list\.filters, CARD_MONTHS_DEFAULT_FILTER\]/,
  )
  assert.match(
    list,
    /if \(!hasMonthOrCompanyFilter\(filters\)\)\s+setFilters\(\[\.\.\.filters, CARD_MONTHS_DEFAULT_FILTER\]\)/,
  )
  assert.match(
    list,
    /rowHref=\{\(row\) => `\/sales\/cards\/\$\{row\.card_id\}`\}/,
  )
  assert.match(list, /cellTextClassName="text-\[13px\]"/)
  assert.match(list, /cellClassName="py-2"/)
  assert.match(list, /<ErrorState\s+description=\{t\('cardMonthsLoadError'\)\}/)
  // The batch screen reads the slots by company + project + month, bounded.
  assert.match(
    data,
    /\.eq\('company_id', input\.companyId\)\s+\.eq\('project_id', input\.projectId\)\s+\.eq\('month', monthStartOf\(input\.month\)\)/,
  )
  assert.match(data, /\.limit\(CARD_MONTH_BATCH_LIMIT\)/)
  assert.match(data, /\.limit\(CARD_PLACES_LIMIT\)/)
})

// --- The card page and the client PO page -----------------------------------------------

test('the card page: the real months table, the consumed header, the latest month cards, the card events', () => {
  const card = read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx')
  assert.match(card, /\.from\('sales_card_months'\)/)
  assert.match(card, /\.from\('sales_card_month_slots'\)/)
  assert.match(card, /\.eq\('recorded', false\)/)
  assert.match(card, /\.from\('equipment_card_events'\)/)
  assert.match(card, /\.order\('seq', \{ ascending: false \}\)/)
  assert.match(card, /compareTimelineItems/)
  assert.match(card, /<RecordCardMonthDialog/)
  assert.match(card, /const canManage = can\('sales\.manage'\)/)
  assert.match(card, /recordedHoursTotal\(months\)/)
  assert.match(card, /contractHours\(\{/)
  assert.match(card, /t\('cardMonthConsumed'\)/)
  assert.match(card, /t\('cardMonthRemaining'\)/)
  assert.match(card, /storedCardMonthFigures\(/)
  assert.match(card, /t\('cardMonthLatestHint'\)/)
  assert.match(card, /t\('clientPoContractHours'\)/)
  assert.doesNotMatch(card, /equipmentCardPhase2Hint|equipmentCardMonthsNote/)
  // The timeline reads a detail in its own direction (Arabic month details).
  const timeline = read('src', 'components', 'sales', 'EventTimeline.tsx')
  assert.match(timeline, /<bdi dir="auto">\{item\.detail\}<\/bdi>/)
  // The client PO page: the line's total hours and the PO's total.
  const po = read('src', 'screens', 'sales', 'ClientPoDetail.tsx')
  assert.match(po, /<HoursFigure hours=\{contractHours\(line\)\} \/>/)
  assert.match(po, /contractHoursTotal\(lines\)/)
  assert.match(po, /t\('clientPoContractHours'\)/)
})

// --- The look: tokens, plain alif, logical direction ---------------------------------------

test('tokens only, plain alif and logical direction in the new and touched files', () => {
  for (const file of [...NEW_FILES, ...TOUCHED]) {
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
  }
  // The new translation keys: both languages, plain alif in Arabic.
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
  assert.ok(keysOf(blocks[0][1]).includes('cardTimesheets'))
  assert.ok(keysOf(blocks[0][1]).includes('cardMonths'))
  const phase2 = blocks[0][1].slice(blocks[0][1].indexOf('cardTimesheets:'))
  assert.doesNotMatch(phase2, HAMZA_ALIF)
  // The batch screen's month picker is the presets' primary-tab look.
  const picker = read('src', 'components', 'sales', 'CardMonthPicker.tsx')
  assert.match(picker, /className=\{PRIMARY_ACTIVE_TRIGGER\}/)
  assert.match(picker, /monthPresetLabel\(/)
})

// --- The pure helpers -----------------------------------------------------------------------

/** The database rule, for the comparison: card_month_due of 0172. */
function dbCardMonthDue(price, unit, hours, standard) {
  if (price === null || hours === null) return null
  if (unit === 'hour') return Math.round(price * hours * 100) / 100
  if (unit === 'month' && standard > 0)
    return Math.round(((price * hours) / standard) * 100) / 100
  return null
}

test('cardMonthDue mirrors card_month_due: month ÷ standard hours, hour × hours, day null', () => {
  // The function body of the migration says exactly this.
  const body = MIGRATION.slice(
    MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.card_month_due'),
    MIGRATION.indexOf('COMMENT ON FUNCTION public.card_month_due'),
  )
  assert.match(body, /WHEN p_price IS NULL OR p_hours IS NULL THEN NULL/)
  assert.match(
    body,
    /WHEN p_rate_unit = 'hour' THEN round\(p_price \* p_hours, 2\)/,
  )
  assert.match(
    body,
    /WHEN p_rate_unit = 'month' AND p_standard_hours > 0\s+THEN round\(p_price \* p_hours \/ p_standard_hours, 2\)/,
  )
  assert.match(body, /ELSE NULL/)
  const cases = [
    [13000, 'month', 248, 260],
    [18500, 'month', 260, 260],
    [950, 'hour', 12.5, 260],
    [1400, 'day', 20, 260],
    [null, 'month', 100, 260],
    [100, 'month', null, 260],
    [100, 'month', 10, 0],
    [1234.56, 'month', 7.25, 208],
  ]
  for (const [price, unit, hours, standard] of cases)
    assert.equal(
      sales.cardMonthDue(price, unit, hours, standard),
      dbCardMonthDue(price, unit, hours, standard),
      JSON.stringify([price, unit, hours, standard]),
    )
  assert.equal(sales.cardMonthDue('13000', 'month', 248, 260), 12400)
  // The figures of a card: the supplier on the SAME hours and divisor, the
  // margin = client − COALESCE(supplier, 0) (the view's rule), owned → no
  // supplier due.
  const rented = {
    client_line_id: 'l1',
    client_price: 18500,
    client_rate_unit: 'month',
    supplier_line_id: 's1',
    supplier_price: 13000,
    supplier_rate_unit: 'month',
    owned: false,
    due_standard_hours: 260,
  }
  assert.deepEqual(plain(sales.cardMonthFigures(rented, 248)), {
    client: { value: 17646.15, blocker: null },
    supplier: { value: 12400, blocker: null },
    margin: { value: 5246.15, blocker: null },
  })
  assert.deepEqual(
    plain(sales.cardMonthFigures({ ...rented, owned: true }, 260)),
    {
      client: { value: 18500, blocker: null },
      supplier: { value: null, blocker: 'owned' },
      margin: { value: 18500, blocker: null },
    },
  )
  assert.deepEqual(
    plain(sales.cardMonthFigures({ ...rented, client_price: null }, 100)),
    {
      client: { value: null, blocker: 'unpriced' },
      supplier: { value: 5000, blocker: null },
      margin: { value: null, blocker: 'unpriced' },
    },
  )
  assert.deepEqual(
    plain(
      sales.cardMonthFigures(
        { ...rented, client_rate_unit: 'day', supplier_rate_unit: 'day' },
        100,
      ),
    ),
    {
      client: { value: null, blocker: 'daily' },
      supplier: { value: null, blocker: 'daily' },
      margin: { value: null, blocker: 'daily' },
    },
  )
  assert.deepEqual(
    plain(
      sales.cardMonthFigures(
        { ...rented, client_line_id: null, supplier_line_id: null },
        null,
      ),
    ),
    {
      client: { value: null, blocker: 'no_line' },
      supplier: { value: null, blocker: 'no_line' },
      margin: { value: null, blocker: 'no_line' },
    },
  )
  assert.equal(sales.cardMonthFigures(rented, null).client.blocker, 'no_hours')
  // The stored figures of a recorded month come from the view's columns.
  assert.deepEqual(
    plain(
      sales.storedCardMonthFigures({
        ...rented,
        hours: '248.00',
        client_due: '17646.15',
        supplier_due: null,
        margin: '17646.15',
        supplier_line_id: null,
      }),
    ),
    {
      client: { value: 17646.15, blocker: null },
      supplier: { value: null, blocker: 'no_line' },
      margin: { value: 17646.15, blocker: null },
    },
  )
  // The totals per unit never add a month and an hour.
  assert.deepEqual(
    plain(
      sales.cardMonthTotalsByUnit([
        { value: 100, unit: 'month' },
        { value: 50, unit: 'hour' },
        { value: null, unit: 'month' },
        { value: 25, unit: 'month' },
      ]),
    ),
    [
      { unit: 'month', total: 125 },
      { unit: 'hour', total: 50 },
    ],
  )
  assert.deepEqual(plain(sales.cardMonthTotalsByUnit([])), [])
})

test('contractHours: quantity × standard hours for a monthly line, the quantity for an hourly one, none for a daily one', () => {
  const line = (quantity, rate_unit, standard_hours = 260) => ({
    quantity,
    rate_unit,
    standard_hours,
  })
  assert.equal(sales.contractHours(line(6, 'month')), 1560)
  assert.equal(sales.contractHours(line('6', 'month', 208)), 1248)
  assert.equal(sales.contractHours(line(400, 'hour')), 400)
  assert.equal(sales.contractHours(line(20, 'day')), null)
  assert.equal(sales.contractHours(line(null, 'month')), null)
  assert.equal(sales.contractHours(line(0, 'month')), null)
  assert.equal(sales.contractHours(line(6, 'month', 0)), null)
  assert.equal(sales.contractHours(line(2.5, 'month')), 650)
  assert.equal(
    sales.contractHoursTotal([
      line(6, 'month'),
      line(400, 'hour'),
      line(20, 'day'),
    ]),
    1960,
  )
  assert.equal(
    sales.contractHoursTotal([line(20, 'day'), line(null, 'month')]),
    null,
  )
  assert.equal(sales.formatHours(1560), '1,560')
  assert.equal(sales.formatHours('248.50'), '248.5')
  assert.equal(
    sales.recordedHoursTotal([{ hours: '248.00' }, { hours: 12.5 }]),
    260.5,
  )
})

test('month keys, labels, states and the count words', () => {
  assert.equal(sales.monthKeyOf('2026-10-01'), '2026-10')
  assert.equal(sales.monthStartOf('2026-10'), '2026-10-01')
  assert.equal(sales.shiftMonth('2026-01', -1), '2025-12')
  assert.equal(sales.shiftMonth('2026-11', 2), '2027-01')
  assert.deepEqual(plain(sales.monthKeysBetween('2026-11', '2027-02')), [
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ])
  assert.deepEqual(plain(sales.monthKeysBetween('2026-11', '2026-10')), [])
  assert.equal(sales.currentSaudiMonthKey('2026-11-04'), '2026-11')
  assert.equal(sales.monthLabel('2026-10', 'ar'), 'اكتوبر 2026')
  assert.equal(sales.monthLabel('2026-10', 'en'), 'October 2026')
  assert.equal(sales.monthShortLabel('2026-10', 'ar'), 'اكتوبر (10)')
  assert.equal(sales.monthShortLabel('2026-10', 'en'), 'Oct (10)')
  assert.equal(sales.monthsCountLabel(1, 'ar'), 'شهر')
  assert.equal(sales.monthsCountLabel(2, 'ar'), 'شهرين')
  assert.equal(sales.monthsCountLabel(3, 'ar'), '3 شهور')
  assert.equal(sales.monthsCountLabel(11, 'ar'), '11 شهرا')
  assert.equal(sales.monthsCountLabel(1, 'en'), '1 month')
  assert.equal(sales.monthsCountLabel(3, 'en'), '3 months')
  // The states: recorded, the running month of an open card, else awaited.
  const state = (slot) => sales.cardMonthState(slot, '2026-11')
  assert.equal(state({ recorded: true, month: '2026-09-01' }), 'recorded')
  assert.equal(
    state({ recorded: false, month: '2026-09-01', is_open: true }),
    'pending',
  )
  assert.equal(
    state({ recorded: false, month: '2026-11-01', is_open: true }),
    'running',
  )
  assert.equal(
    state({ recorded: false, month: '2026-11-01', is_open: false }),
    'pending',
  )
  assert.deepEqual(plain(sales.CARD_MONTH_STATE_BADGE), {
    recorded: { key: 'cardMonthStateRecorded', tone: 'success' },
    pending: { key: 'cardMonthStatePending', tone: 'warning' },
    running: { key: 'cardMonthStateRunning', tone: 'info' },
  })
  // The hours the form accepts: 0 to 9999, two decimals.
  for (const ok of ['0', '248', '248.5', '9999', '12.25'])
    assert.ok(sales.isValidCardMonthHours(ok), ok)
  for (const bad of ['', '-1', '10000', '1.234', 'abc', '1e3'])
    assert.ok(!sales.isValidCardMonthHours(bad), bad)
  assert.equal(sales.parseCardMonthHours(' 248.5 '), 248.5)
  assert.equal(sales.parseCardMonthHours(''), null)
  assert.equal(sales.parseCardMonthHours('10000'), null)
})

test('the card event details: «اكتوبر (10): 248 ساعة», «سبتمبر (9): 260 ← 240»', () => {
  const hours = (value) => `${sales.formatHours(value)} ساعة`
  const detail = (event_type, payload, lang = 'ar') =>
    sales.equipmentCardEventDetail({ event_type, payload }, lang, hours)
  assert.equal(
    detail('month_recorded', { month: '2026-10-01', hours: 248, note: null }),
    'اكتوبر (10): 248 ساعة',
  )
  assert.equal(
    detail('month_updated', {
      month: '2026-09-01',
      hours: 240,
      old_hours: 260,
      note: null,
      old_note: null,
    }),
    'سبتمبر (9): 260 ← 240',
  )
  assert.equal(
    detail(
      'month_updated',
      { month: '2026-09-01', hours: 240, old_hours: 260 },
      'en',
    ),
    'Sep (9): 260 → 240',
  )
  // A note-only change keeps the hours.
  assert.equal(
    detail('month_updated', {
      month: '2026-09-01',
      hours: 240,
      old_hours: 240,
    }),
    'سبتمبر (9): 240 ساعة',
  )
  assert.equal(
    detail('month_deleted', {
      month: '2026-08-01',
      old_hours: '260.00',
      note: null,
    }),
    'اغسطس (8): 260 ساعة',
  )
  assert.equal(detail('other', {}), null)
  assert.deepEqual(plain(sales.EQUIPMENT_CARD_EVENT_LABEL_KEYS), {
    month_recorded: 'cardMonthEventRecorded',
    month_updated: 'cardMonthEventUpdated',
    month_deleted: 'cardMonthEventDeleted',
  })
})

test('every stable token of 0172 is known and mapped; the dialog schema', () => {
  // The eight tokens 0172 raises itself, plus sales_manage_required from
  // assert_sales_manage() (0169), which every writer calls first.
  const raised = new Set([
    ...[...MIGRATION.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
    'sales_manage_required',
  ])
  assert.match(MIGRATION, /PERFORM public\.assert_sales_manage\(\);/)
  assert.deepEqual(
    [...raised].sort(),
    [...sales.CARD_MONTH_ERROR_TOKENS].sort(),
  )
  for (const token of raised)
    assert.ok(token in sales.CARD_MONTH_FORM_MESSAGES, `${token} has a message`)
  const raisedError = (token) => ({ code: '55000', message: token })
  const map = (error) =>
    plain(v.mapDatabaseErrorToField(error, sales.CARD_MONTH_FIELD_RULES))
  assert.deepEqual(map(raisedError('month_outside_card')), {
    month: 'cardMonthErrorOutsideCard',
  })
  assert.deepEqual(map(raisedError('month_in_future')), {
    month: 'cardMonthErrorInFuture',
  })
  assert.deepEqual(map({ code: '22023', message: 'invalid_hours' }), {
    hours: 'cardMonthHoursInvalid',
  })
  assert.deepEqual(map({ code: '22023', message: 'invalid_note' }), {
    note: 'cardMonthNoteTooLong',
  })
  assert.equal(map({ code: 'P0002', message: 'card_month_not_found' }), null)
  assert.equal(
    sales.cardMonthFormMessage({
      code: 'P0002',
      message: 'card_month_not_found',
    }),
    'cardMonthErrorNotFound',
  )
  assert.equal(
    sales.cardMonthFormMessage({
      code: '42501',
      message: 'sales_manage_required',
    }),
    'clientPoErrorManageRequired',
  )
  assert.equal(
    sales.cardMonthFormMessage({ message: 'boom' }),
    'supplierPoSaveFailed',
  )
  assert.deepEqual(
    plain(
      sales.cardMonthErrorOutcome(raisedError('month_in_future'), (error) =>
        v.mapDatabaseErrorToField(error, sales.CARD_MONTH_FIELD_RULES),
      ),
    ),
    { fieldErrors: { month: 'cardMonthErrorInFuture' } },
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
  for (const key of [
    ...Object.values(sales.CARD_MONTH_FORM_MESSAGES),
    ...Object.values(sales.EQUIPMENT_CARD_EVENT_LABEL_KEYS),
    ...Object.values(sales.CARD_MONTH_STATE_BADGE).map((badge) => badge.key),
    ...sales.CARD_MONTH_FIELD_RULES.map((rule) => rule.key),
  ]) {
    assert.ok(arKeys.has(key), `ar ${key}`)
    assert.ok(enKeys.has(key), `en ${key}`)
  }
  // The Zod schema of «تسجيل شهر».
  const errors = (values) =>
    plain(v.validateWithSchema(v.cardMonthFormSchema, values))
  assert.deepEqual(errors({ month: '', hours: '', note: '' }), {
    month: 'cardMonthMonthRequired',
    hours: 'cardMonthHoursRequired',
  })
  assert.deepEqual(errors({ month: '2026-10', hours: '248', note: '' }), {})
  assert.deepEqual(errors({ month: '2026-10', hours: '10000', note: '' }), {
    hours: 'cardMonthHoursInvalid',
  })
  assert.deepEqual(errors({ month: '2026-10', hours: '1.234', note: '' }), {
    hours: 'cardMonthHoursInvalid',
  })
  assert.deepEqual(
    errors({ month: '2026-10', hours: '12', note: 'x'.repeat(501) }),
    { note: 'cardMonthNoteTooLong' },
  )
})
