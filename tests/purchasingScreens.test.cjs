// purchasing-screens (owner decision 2026-10-19): the first three purchasing
// screens are MOCKUPS on /ui-kit, built on the shared components and on pure
// logic that moves unchanged to the real routes later: the Zod schemas of
// src/lib/formValidation.ts, the 0136 token → field mapping of
// src/lib/purchasing.ts, the list config and the translation block.
//
// Source checks only: the section exists on /ui-kit, the mockup reaches no
// database and calls no 0136 RPC, the schemas and the token mapping behave,
// every translation key exists in both languages, and the new Arabic copy
// carries no hamza alif.
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
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const v = loadLibModule('formValidation')
const purchasing = loadLibModule('purchasing')

const MOCKUP = ['src', 'screens', 'ui-kit', 'PurchasingMockup.tsx']
const DATA = ['src', 'screens', 'ui-kit', 'purchasingMockupData.ts']
const PAGE = ['src', 'screens', 'UiKit.tsx']
const LIB = ['src', 'lib', 'purchasing.ts']
const TRANSLATIONS = ['src', 'i18n', 'translations.ts']

const HAMZA_ALIF = /[أإآ]/

// --- The /ui-kit section -------------------------------------------------------

test('the purchasing mockup is a screen section of /ui-kit', () => {
  const page = read(...PAGE)
  assert.match(
    page,
    /import \{ PurchasingMockup \} from '@\/screens\/ui-kit\/PurchasingMockup'/,
  )
  const screens = page.slice(
    page.indexOf('const SCREEN_SECTIONS'),
    page.indexOf('const COMPONENT_SECTIONS'),
  )
  assert.match(screens, /id: 'purchasing-mockup'/)
  assert.match(screens, /title: 'نماذج شاشات المشتريات'/)
  assert.match(screens, /element: <PurchasingMockup \/>/)
  // Review material, not approved yet.
  const section = screens.slice(screens.indexOf("id: 'purchasing-mockup'"))
  assert.match(section.slice(0, section.indexOf('element:')), /status: 'review'/)
})

test('the mockup renders the three screens and their states with sample data only', () => {
  // Comments name the RPC each dialog will call later; only code counts.
  const uncommented = (text) => text.replace(/^\s*\/\/.*$/gm, '')
  const source = uncommented(read(...MOCKUP))
  const data = uncommented(read(...DATA))
  for (const [name, text] of [
    ['PurchasingMockup', source],
    ['purchasingMockupData', data],
  ]) {
    assert.doesNotMatch(
      text,
      /from ['"][^'"]*supabase[^'"]*['"]/i,
      `${name} has no Supabase import`,
    )
    assert.doesNotMatch(text, /\.rpc\(/, `${name} calls no RPC`)
    assert.doesNotMatch(text, /\bfetch\(/, `${name} makes no request`)
  }
  // No 0136 function is called (they are only named in comments).
  for (const fn of [
    'create_supplier_po',
    'add_supplier_po_equipment',
    'update_supplier_po_equipment_price',
    'close_supplier_po',
  ])
    assert.doesNotMatch(
      source,
      new RegExp(`rpc\\(\\s*['"]${fn}`),
      `${fn} is not called`,
    )
  // The three mockups and the token table.
  for (const name of [
    'PoListMockup',
    'CreatePoDialog',
    'PoPageMockup',
    'PoPageMockupV2',
    'EventTimeline',
    'AddEquipmentDialog',
    'EditPriceDialog',
    'EventsList',
    'EquipmentPurchasingCardMockup',
    'TokenTable',
  ])
    assert.match(source, new RegExp(`function ${name}\\(`), name)
  // The states each mockup can show.
  assert.match(source, /type DemoState = 'data' \| 'loading' \| 'empty' \| 'error'/)
  // The real list config and the shared components, not ad hoc ones.
  assert.match(source, /supplierPosListConfig/)
  assert.match(source, /<DataListToolbar/)
  assert.match(source, /<DataTable/)
  assert.match(source, /<AsyncSearchSelect/)
  assert.match(source, /<DetailHeader/)
  assert.match(source, /<InfoGridSection/)
  assert.match(source, /useConfirm\(\)/)
  assert.match(source, /<EquipmentIdentifierTag/)
  // The permission note above each mockup (the PO page twice: the current
  // page and the proposed detail-page pattern, owner request 2026-10-19).
  assert.equal(
    (source.match(/permission="[^"]*purchasing\.view[^"]*"/g) ?? []).length,
    4,
  )
  // The proposed pattern: summary strip, two-column body, card list on
  // narrow screens, bottom action bar on mobile, timeline.
  const v2 = source.slice(
    source.indexOf('function PoPageMockupV2('),
    source.indexOf('function EquipmentPurchasingCardMockup('),
  )
  assert.match(v2, /<StatCard/)
  assert.match(v2, /xl:grid-cols-3/)
  assert.match(v2, /xl:col-span-2/)
  // Wide cards, not a table (owner 2026-10-19); sort through a select.
  assert.doesNotMatch(v2, /<DataTable[\s>]/)
  assert.match(v2, /rounded-xl border bg-bg p-3 sm:p-4/)
  assert.match(v2, /aria-label=\{t\('sortBy'\)\}/)
  assert.match(v2, /lineSupplierName\(line\.unit, row, t\)/)
  assert.match(v2, /sticky bottom-0[^"]*sm:hidden/)
  assert.match(v2, /env\(safe-area-inset-bottom\)/)
  assert.match(v2, /<EventTimeline/)
  assert.match(v2, /<DescriptionList/)
  // No hardcoded palette colors (tokens only).
  assert.doesNotMatch(
    source,
    /\b(?:bg|text|border)-(?:gray|zinc|slate|emerald|green|amber|red|blue)-\d{2,3}\b/,
  )
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b/)
})

// --- The Zod schemas -------------------------------------------------------------

const errors = (schema, values) => plain(v.validateWithSchema(schema, values))

test('supplierPoFormSchema: a party (lessor or owner class), company, project and start date are mandatory', () => {
  assert.deepEqual(
    errors(v.supplierPoFormSchema, {
      lessor_id: '',
      owner_class: '',
      company_id: '',
      project_id: '',
      start_date: '',
      notes: '',
    }),
    {
      lessor_id: 'supplierPoPartyRequired',
      company_id: 'supplierPoCompanyRequired',
      project_id: 'supplierPoProjectRequired',
      start_date: 'supplierPoStartDateRequired',
    },
  )
  // An owner class is a party of its own (0138: no supplier row needed).
  assert.deepEqual(
    errors(v.supplierPoFormSchema, {
      lessor_id: '',
      owner_class: 'takween',
      company_id: 'c1',
      project_id: 'p1',
      start_date: '2026-10-19',
      notes: 'x'.repeat(v.SUPPLIER_PO_NOTES_MAX),
    }),
    {},
  )
  assert.deepEqual(
    errors(v.supplierPoFormSchema, {
      lessor_id: 'l1',
      owner_class: '',
      company_id: 'c1',
      project_id: 'p1',
      start_date: '2026-10-19',
      notes: 'x'.repeat(v.SUPPLIER_PO_NOTES_MAX + 1),
    }),
    { notes: 'supplierPoNotesTooLong' },
  )
  // The picker's values.
  assert.deepEqual(plain(purchasing.partyFromOptionValue('class:alazani')), {
    lessor_id: '',
    owner_class: 'alazani',
  })
  assert.deepEqual(plain(purchasing.partyFromOptionValue('l1')), {
    lessor_id: 'l1',
    owner_class: '',
  })
  assert.equal(
    purchasing.partyOptionValue({ lessor_id: null, owner_class: 'third_party_f' }),
    'class:third_party_f',
  )
  assert.equal(
    purchasing.partyOptionValue({ lessor_id: 'l1', owner_class: null }),
    'l1',
  )
  assert.deepEqual(plain(purchasing.SUPPLIER_PO_OWNER_CLASSES), [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
  ])
  assert.equal(v.SUPPLIER_PO_NOTES_MAX, 1000)
  assert.equal(v.SUPPLIER_PO_LINE_NOTE_MAX, 500)
})

test('supplierPoLineFormSchema: the unit, and a valid price when one is typed (optional since 0138)', () => {
  const schema = v.supplierPoLineFormSchema
  // No owner-based rule and no mandatory price (owner 2026-10-20).
  assert.deepEqual(errors(schema, { equipment_id: '', price: '', note: '' }), {
    equipment_id: 'supplierPoEquipmentRequired',
  })
  assert.deepEqual(errors(schema, { equipment_id: 'e1', price: '', note: '' }), {})
  for (const price of ['0', '0.00', '1250', '1250.5', '9999999999.99'])
    assert.deepEqual(
      errors(schema, { equipment_id: 'e1', price, note: '' }),
      {},
      price,
    )
  for (const price of ['-1', '12.345', 'abc', '1,250', '12345678901'])
    assert.deepEqual(
      errors(schema, { equipment_id: 'e1', price, note: '' }),
      { price: 'supplierPoPriceInvalid' },
      price,
    )
  assert.deepEqual(
    errors(schema, {
      equipment_id: 'e1',
      price: '10',
      note: 'x'.repeat(501),
    }),
    { note: 'supplierPoLineNoteTooLong' },
  )
  // «تعديل السعر» asks for the price.
  assert.deepEqual(errors(v.supplierPoPriceFormSchema, { price: '' }), {
    price: 'supplierPoPriceRequired',
  })
  assert.deepEqual(errors(v.supplierPoPriceFormSchema, { price: '5' }), {})
  // The create call's payload: an empty price is null, never 0.
  assert.deepEqual(
    plain(
      purchasing.supplierPoEquipmentPayload([
        { equipment_id: 'e1', price: '', note: '' },
        { equipment_id: 'e2', price: ' 1250.5 ', note: ' x ' },
      ]),
    ),
    [
      { equipment_id: 'e1', price: null, note: null },
      { equipment_id: 'e2', price: 1250.5, note: 'x' },
    ],
  )
})

// --- The 0136 token mapping -----------------------------------------------------------

const MIGRATIONS = [
  '20261018130000_0136_purchasing_supplier_pos.sql',
  // 0137 re-creates add_supplier_po_equipment with one more token.
  '20261019100000_0137_supplier_po_equipment_at_project.sql',
  // 0138: the party, the optional price, the PO created with its equipment.
  '20261020100000_0138_supplier_po_party_and_optional_price.sql',
  // 0139: create_supplier_po re-created with is_internal never NULL.
  '20261020110000_0139_supplier_po_is_internal_default.sql',
  // 0140: party_class computed column (no token).
  '20261020120000_0140_supplier_po_party_class.sql',
  // 0142: update_supplier_po and update_supplier_po_equipment (two tokens).
  '20261022100000_0142_supplier_po_update.sql',
  // 0148: the same entry day (entry_date_mismatch, po_start_date_locked).
  '20261025100000_0148_supplier_po_same_entry_day.sql',
]

test('every stable token of migrations 0136 to 0138 is known and mapped', () => {
  const sql = MIGRATIONS.map((file) => read('supabase', 'migrations', file)).join('\n')
  const raised = new Set(
    [...sql.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  assert.deepEqual(
    [...raised].sort(),
    [...purchasing.SUPPLIER_PO_ERROR_TOKENS].sort(),
  )
  const fieldTokens = new Set(
    [
      ...purchasing.SUPPLIER_PO_CREATE_FIELD_RULES,
      ...purchasing.SUPPLIER_PO_LINE_FIELD_RULES,
      ...purchasing.SUPPLIER_PO_PRICE_FIELD_RULES,
      ...purchasing.SUPPLIER_PO_LINE_EDIT_FIELD_RULES,
      ...purchasing.SUPPLIER_PO_EDIT_FIELD_RULES,
    ].map((rule) => rule.match),
  )
  for (const token of raised)
    assert.ok(
      fieldTokens.has(token) || token in purchasing.SUPPLIER_PO_FORM_MESSAGES,
      `${token} maps to a field or a form message`,
    )
})

test('the token → field mapping of the three dialogs', () => {
  const raisedError = (token, code = '22023') => ({ code, message: token })
  const map = (error, rules) => plain(v.mapDatabaseErrorToField(error, rules))

  // «امر شراء جديد»
  assert.deepEqual(
    map(raisedError('invalid_company'), purchasing.SUPPLIER_PO_CREATE_FIELD_RULES),
    { company_id: 'supplierPoErrorInvalidCompany' },
  )
  assert.deepEqual(
    map(raisedError('invalid_project'), purchasing.SUPPLIER_PO_CREATE_FIELD_RULES),
    { project_id: 'supplierPoErrorInvalidProject' },
  )
  assert.deepEqual(
    map(raisedError('invalid_lessor'), purchasing.SUPPLIER_PO_CREATE_FIELD_RULES),
    { lessor_id: 'supplierPoErrorInvalidSupplier' },
  )
  assert.deepEqual(
    map(
      raisedError('invalid_start_date'),
      purchasing.SUPPLIER_PO_CREATE_FIELD_RULES,
    ),
    { start_date: 'supplierPoStartDateRequired' },
  )
  // «اضافة معدة»: the price field for the internal rule, whatever SQLSTATE.
  assert.deepEqual(
    map(
      raisedError('internal_price_must_be_zero'),
      purchasing.SUPPLIER_PO_LINE_FIELD_RULES,
    ),
    { price: 'supplierPoPriceInternalMustBeZero' },
  )
  assert.deepEqual(
    map(raisedError('invalid_price'), purchasing.SUPPLIER_PO_LINE_FIELD_RULES),
    { price: 'supplierPoPriceInvalid' },
  )
  assert.deepEqual(
    map(
      raisedError('invalid_equipment'),
      purchasing.SUPPLIER_PO_LINE_FIELD_RULES,
    ),
    { equipment_id: 'supplierPoErrorInvalidEquipment' },
  )
  // Form-level tokens map to no field…
  for (const [token, code] of [
    ['card_overlap', '23P01'],
    ['equipment_already_on_open_po', '23505'],
    ['po_closed', '55000'],
    ['purchasing_manage_required', '42501'],
  ]) {
    assert.equal(
      map(raisedError(token, code), purchasing.SUPPLIER_PO_LINE_FIELD_RULES),
      null,
      token,
    )
    assert.equal(
      map(raisedError(token, code), purchasing.SUPPLIER_PO_CREATE_FIELD_RULES),
      null,
      token,
    )
  }
  // …and to their safe messages.
  assert.equal(
    purchasing.supplierPoFormMessage(raisedError('card_overlap', '23P01')),
    'supplierPoErrorCardOverlap',
  )
  assert.equal(
    purchasing.supplierPoFormMessage(
      raisedError('equipment_already_on_open_po', '23505'),
    ),
    'supplierPoErrorAlreadyOnOpenPo',
  )
  assert.equal(
    purchasing.supplierPoFormMessage(raisedError('po_closed', '55000')),
    'supplierPoErrorClosed',
  )
  assert.equal(
    purchasing.supplierPoFormMessage(
      raisedError('purchasing_manage_required', '42501'),
    ),
    'supplierPoErrorManageRequired',
  )
  assert.equal(
    purchasing.supplierPoFormMessage(raisedError('invalid_po')),
    'supplierPoNotFound',
  )
  assert.equal(
    purchasing.supplierPoFormMessage(raisedError('invalid_line')),
    'supplierPoErrorInvalidLine',
  )
  // Anything else (or a raw PostgREST failure) is the generic safe message:
  // the database text itself is never a translation key.
  assert.equal(
    purchasing.supplierPoFormMessage({
      code: 'PGRST301',
      message: 'JWT expired',
    }),
    'supplierPoSaveFailed',
  )
  assert.equal(purchasing.supplierPoFormMessage(null), 'supplierPoSaveFailed')

  // The dialog outcome: a field when a rule matches, else one message.
  const outcome = (error, rules) =>
    plain(
      purchasing.supplierPoErrorOutcome(error, (e) =>
        v.mapDatabaseErrorToField(e, rules),
      ),
    )
  assert.deepEqual(
    outcome(
      raisedError('internal_price_must_be_zero'),
      purchasing.SUPPLIER_PO_LINE_FIELD_RULES,
    ),
    { fieldErrors: { price: 'supplierPoPriceInternalMustBeZero' } },
  )
  assert.deepEqual(
    outcome(
      raisedError('card_overlap', '23P01'),
      purchasing.SUPPLIER_PO_LINE_FIELD_RULES,
    ),
    { message: 'supplierPoErrorCardOverlap' },
  )
})

test('status badge, event labels and the price format', () => {
  assert.deepEqual(plain(purchasing.SUPPLIER_PO_STATUS_BADGE), {
    open: { key: 'supplierPoStatusOpen', tone: 'success' },
    closed: { key: 'supplierPoStatusClosed', tone: 'neutral' },
  })
  // The event types of the CHECK as 0149 re-created it (the 0136 five, 0142's
  // updated and line_updated, 0149's equipment_removed and reopened).
  const sql = read('supabase', 'migrations', '20261025110000_0149_reopen_spo260001_spo260002.sql')
  const check = /event_type IN \(([^)]+)\)/.exec(sql)
  const types = [...check[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(
    Object.keys(purchasing.SUPPLIER_PO_EVENT_LABEL_KEYS).sort(),
    types,
  )
  assert.equal(purchasing.formatSupplierPoPrice(0), '0.00')
  assert.equal(purchasing.formatSupplierPoPrice(1250), '1,250.00')
  assert.equal(purchasing.formatSupplierPoPrice('12750.5'), '12,750.50')
  assert.equal(purchasing.formatSupplierPoPrice(null), '—')
  const t = (key) => key
  assert.equal(
    purchasing.supplierPoSupplierLabel(
      { is_internal: false, lessor: { name: 'X' } },
      t,
    ),
    'X',
  )
  assert.equal(
    purchasing.supplierPoSupplierLabel({ is_internal: true, lessor: null }, t),
    'supplierPoInternalSupplier',
  )
  assert.ok(purchasing.SUPPLIER_PO_EVENTS_LIMIT >= 10)
  assert.ok(purchasing.SUPPLIER_PO_EVENTS_LIMIT <= 20)
})

// --- The list config -------------------------------------------------------------------

test('supplierPosListConfig: PO number search, allowlisted filters, standard sizes', () => {
  // listConfigs.ts imports modules outside src/lib; read the source.
  const source = read('src', 'lib', 'listConfigs.ts')
  const start = source.indexOf('export const supplierPosListConfig')
  assert.ok(start > 0)
  const next = source.indexOf('export const', start + 1)
  const config = source.slice(start, next > 0 ? next : undefined)
  assert.match(config, /id: 'supplierPos'/)
  assert.match(config, /searchFields: \['po_number'\]/)
  const filterKeys = [...config.matchAll(/^\s{6}key: '(\w+)',$/gm)].map(
    (m) => m[1],
  )
  assert.deepEqual(filterKeys, [
    'status',
    // 0140: «المالك ثم المورد» like the log (party_class computed column).
    'party_class',
    'lessor_id',
    'company_id',
    'project_id',
    // 0138: the computed column, «تحتاج اسعار» = gt 0.
    'unpriced_count',
  ])
  assert.match(
    config.replace(/\s+/g, ' '),
    /key: 'lessor_id', label: 'supplierPoSupplier', type: 'select', operators: \['in'\], options: \[\], multiple: true, visibleWhen: \{ field: 'party_class', includes: 'external_supplier' \},/,
  )
  for (const owner of [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
    'external_supplier',
  ])
    assert.match(config, new RegExp(`value: '${owner}',`), owner)
  assert.match(
    config.replace(/\s+/g, ' '),
    /key: 'unpriced_count', label: 'supplierPoNeedsPrices', type: 'select', operators: \['gt', 'eq'\], options: \[\], choices: \[ \{ key: 'needs_prices', operator: 'gt', value: '0', label: 'yes' \}, \{ key: 'all_priced', operator: 'eq', value: '0', label: 'no' \}, \],/,
  )
  // No page-size override: the standard 20 / 50 / 100 / 200 / 350 / 500.
  assert.doesNotMatch(config, /pageSizeOptions/)
})

// --- Translations ---------------------------------------------------------------------

/** The keys of one language's `// purchasing-screens` block. */
function blockKeys(lang) {
  const source = read(...TRANSLATIONS)
  const langStart = source.indexOf(`\n  ${lang}: {`)
  const start = source.indexOf('// purchasing-screens — start', langStart)
  const end = source.indexOf('// purchasing-screens — end', start)
  assert.ok(start > langStart && end > start, `${lang} block exists`)
  const block = source.slice(start, end)
  return {
    block,
    keys: [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]),
  }
}

test('every purchasing translation key exists in Arabic and English', () => {
  const ar = blockKeys('ar')
  const en = blockKeys('en')
  assert.ok(ar.keys.length > 40)
  assert.deepEqual(ar.keys, en.keys)
  assert.equal(new Set(ar.keys).size, ar.keys.length, 'keys are unique')
  // Every key the lib and the mockup use is in the block (or an existing key).
  const source = read(...TRANSLATIONS)
  const allKeys = new Set(
    [...source.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]),
  )
  const used = new Set([
    ...[...read(...MOCKUP).matchAll(/\bt\('(\w+)'\)/g)].map((m) => m[1]),
    ...[...read(...LIB).matchAll(/'(supplierPo\w+|equipmentPurchasing\w+)'/g)].map(
      (m) => m[1],
    ),
  ])
  for (const key of used) assert.ok(allKeys.has(key), `${key} is translated`)
  // The names the owner decided.
  assert.match(ar.block, /supplierPoEquipment: 'معدات الـ PO'/)
  assert.match(ar.block, /supplierPoInternalSupplier: 'العزاني'/)
  assert.match(ar.block, /supplierPoStatusOpen: 'مفتوح'/)
  assert.match(ar.block, /supplierPoStatusClosed: 'مغلق'/)
  assert.match(
    ar.block,
    /supplierPoErrorCardOverlap:\s*'للمعدة كرت لشركة او مشروع اخر في هذه الفترة\.'/,
  )
  // Owner 2026-10-20: the party is picked explicitly; the old wording is gone.
  assert.doesNotMatch(ar.block, /بدون مورد = معدات العزاني/)
  assert.match(ar.block, /supplierPoOwnerAlazani: 'شركة عبدالله احمد العزاني للمقاولات'/)
  assert.match(ar.block, /supplierPoOwnerF: 'معدات F'/)
})

test('new Arabic copy uses the plain alif (no أ / إ / آ)', () => {
  const { block } = blockKeys('ar')
  assert.doesNotMatch(block, HAMZA_ALIF, 'the translation block')
  for (const file of [MOCKUP, DATA, LIB]) {
    const lines = read(...file)
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => HAMZA_ALIF.test(line))
    assert.deepEqual(
      lines,
      [],
      `${file.join('/')} has alif with hamza/madda on lines ${lines
        .map(([n]) => n)
        .join(', ')}`,
    )
  }
  // The UiKit section entry and the list config addition.
  const page = read(...PAGE)
  const entry = page.slice(
    page.indexOf("id: 'purchasing-mockup'"),
    page.indexOf("id: 'roles-mockup'"),
  )
  assert.doesNotMatch(entry, HAMZA_ALIF)
  const config = read('src', 'lib', 'listConfigs.ts')
  assert.doesNotMatch(
    config.slice(config.indexOf('export const supplierPosListConfig')),
    HAMZA_ALIF,
  )
  const validation = read('src', 'lib', 'formValidation.ts')
  assert.doesNotMatch(
    validation.slice(validation.indexOf('purchasing-screens (migration 0136)')),
    HAMZA_ALIF,
  )
})

// --- The real screens (2026-10-19) -----------------------------------------------------

test('the purchasing section, routes and page gates are keyed on purchasing.view', () => {
  const nav = read('src', 'lib', 'navPermissions.ts')
  // A parent with its sections (owner 2026-10-19), the PO list first; listed
  // in the sidebar since 2026-10-20 («اظهر التبويب»).
  assert.match(
    nav.replace(/\s+/g, ' '),
    /\{ key: 'purchasing', requires: \[\{ key: 'purchasing\.view' \}\], children: \[ \{ key: 'purchasing\/orders', requires: \[\{ key: 'purchasing\.view' \}\] \}, \/\/[^\n]*?\{ key: 'purchasing\/units', requires: \[\{ key: 'purchasing\.view' \}\] \}, \], \}/,
  )
  // The pages open for purchasing.view, the menu lists the parent with its
  // section, and a purchasing-only user lands on the PO list.
  const navLib = loadLibModule('navPermissions')
  const state = {
    status: 'ready',
    permissions: new Map([['purchasing.view', 'all']]),
  }
  assert.ok(navLib.canOpenPage(state.permissions, 'purchasing/orders'))
  assert.ok(navLib.canOpenPage(state.permissions, 'purchasing/:id'))
  assert.deepEqual(plain(navLib.visibleNavItems(state)), [
    { key: 'purchasing', children: ['purchasing/orders', 'purchasing/units'] },
  ])
  const plan = navLib.planShell(state)
  assert.equal(plan.kind, 'admin')
  assert.equal(plan.landing, 'purchasing/orders')
  assert.equal(navLib.routePageOf(['purchasing']), 'purchasing/orders')
  assert.equal(navLib.routePageOf(['purchasing', 'orders']), 'purchasing/orders')
  // 2026-10-24: «المعدات في المشاريع».
  assert.equal(navLib.routePageOf(['purchasing', 'units']), 'purchasing/units')
  assert.ok(navLib.canOpenPage(state.permissions, 'purchasing/units'))
  assert.equal(navLib.routePageOf(['purchasing', 'abc']), 'purchasing/:id')
  assert.match(nav, /'purchasing\/:id': \[\{ key: 'purchasing\.view' \}\]/)
  assert.match(
    nav.replace(/\s+/g, ' '),
    /if \(!second \|\| second === 'orders'\) return 'purchasing\/orders' if \(second === 'units'\) return 'purchasing\/units' return 'purchasing\/:id'/,
  )
  const shellPages = nav.slice(
    nav.indexOf('const ADMIN_SHELL_PAGES'),
    nav.indexOf('const FIELD_SHELL_PAGES'),
  )
  assert.match(shellPages, /'purchasing',\s+'purchasing\/orders',\s+'purchasing\/units',\s+'purchasing\/:id',/)
  // Only the admin shell: the field homes never list it.
  const fieldPages = nav.slice(
    nav.indexOf('const FIELD_SHELL_PAGES'),
    nav.indexOf('export const SHELL_PAGES'),
  )
  assert.doesNotMatch(fieldPages, /purchasing/)

  const app = read('src', 'App.tsx')
  assert.match(app, /purchasing: \{ label: 'purchasing', icon: <ShoppingCart size=\{18\} \/> \}/)
  assert.match(app, /'purchasing\/orders': 'supplierPos'/)
  assert.match(app, /page === 'purchasing\/:id' \? \(\s+<SupplierPoDetail/)
  assert.match(app, /\{page === 'purchasing\/orders' && \(\s+<SupplierPosListScreen/)
  assert.match(app, /onOpenPo=\{\s+shell\.pages\.has\('purchasing\/:id'\)/)
})

test('the real screens read through RLS and write only through the 0136 functions', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  for (const fn of [
    'create_supplier_po',
    'add_supplier_po_equipment',
    'update_supplier_po_equipment_price',
    'close_supplier_po',
  ])
    assert.match(data, new RegExp(`supabase\\.rpc\\('${fn}'`), fn)
  // No direct insert / update / delete on a purchasing table.
  assert.doesNotMatch(data, /\.(insert|update|upsert|delete)\(/)
  for (const file of [
    ['src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx'],
    ['src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'],
    ['src', 'components', 'purchasing', 'EquipmentPurchasingCard.tsx'],
  ]) {
    const source = read(...file)
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/, file.join('/'))
    assert.doesNotMatch(source, /\.rpc\(/, `${file.join('/')} calls the lib, not rpc`)
    assert.match(source, /usePermissions\(\)/, `${file.join('/')} gates by permissions`)
  }
  // The dialogs call the lib wrappers and map the tokens to fields.
  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /addSupplierPoEquipment\(/)
  assert.match(add, /SUPPLIER_PO_LINE_FIELD_RULES/)
  // 0137: only the units inside the PO's company and project are offered;
  // owner 2026-10-22: never a unit already on the PO.
  assert.match(
    add,
    /equipmentAtProjectOptionLoader\(party, po\.company_id, po\.project_id, \{\s*excludeEquipmentIds:/,
  )
  const poPage = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(poPage, /excludeEquipmentIds=\{lines\.flatMap\(/)
  // Owner 2026-10-22: one PO has one party — no supplier on the line cards
  // or in the sort, and one «اضافة معدة» button (the section's, primary).
  assert.doesNotMatch(poPage, /lineSupplierName/)
  assert.match(poPage, /type SortKey = 'equipment' \| 'period' \| 'price'/)
  assert.equal((poPage.match(/setAddOpen\(true\)/g) ?? []).length, 2, 'section button + mobile bar')
  const dataLib = read('src', 'lib', 'purchasingData.ts')
  // 0138: the party's open site visits (its lessor, or its owner class)...
  const visitsFn = dataLib.slice(
    dataLib.indexOf('function partyOpenVisits('),
    dataLib.indexOf('export function partyOptionLoader('),
  )
  assert.match(visitsFn, /\.from\('movement_visits'\)/)
  assert.match(visitsFn, /\.eq\('is_open', true\)/)
  assert.match(visitsFn, /\.eq\('movement_context', 'site'\)/)
  assert.match(visitsFn, /\.eq\('equipment_ownership_status', party\.owner_class\)/)
  assert.match(visitsFn, /\.eq\('equipment_lessor_id', party\.lessor_id\)/)
  // ...narrowed to the PO's company and project for «اضافة معدة».
  const loader = dataLib.slice(
    dataLib.indexOf('export function equipmentAtProjectOptionLoader'),
  )
  assert.match(loader, /partyOpenVisits\(party\)/)
  assert.match(loader, /\.eq\('company_id', companyId\)/)
  assert.match(loader, /\.eq\('project_id', projectId\)/)
  assert.match(loader, /\.not\('equipment_id', 'in', /)
  // The create dialog: the party first, then only its places and units, the
  // start date from the earliest entry, everything saved in one call.
  const createDialog = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  // Owner 2026-10-21: the owner select (four fixed owners + «مورد خارجي»),
  // then the supplier field sliding in only for an external supplier.
  assert.match(createDialog, /const EXTERNAL = 'external_supplier'/)
  assert.match(createDialog, /SUPPLIER_PO_OWNER_CLASSES\.map\(/)
  assert.match(createDialog, /\{ value: EXTERNAL, label: t\('supplierPoOwnerExternal'\) \}/)
  assert.match(createDialog, /grid-rows-\[1fr\] opacity-100/)
  assert.match(createDialog, /grid-rows-\[0fr\] opacity-0/)
  assert.match(createDialog, /aria-hidden=\{!external\}/)
  assert.match(createDialog, /disabled=\{!external\}/)
  assert.match(createDialog, /fetchPartyOpenVisits\(current\)/)
  assert.match(createDialog, /visitCompanyOptions\(visits, lang\)/)
  assert.match(createDialog, /visitProjectOptions\(visits, form\.company_id, lang\)/)
  assert.match(createDialog, /createSupplierPo\(form, lines\)/)
  // 0148: the start date follows the entry day of the ticked units.
  assert.match(createDialog, /const pickedDay = useMemo\(/)
  const create = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(create, /createSupplierPo\(/)
  assert.match(create, /SUPPLIER_PO_CREATE_FIELD_RULES/)
  // 0142: «تعديل المعدة» saves the price and the note in one call...
  const edit = read('src', 'components', 'purchasing', 'EditLineDialog.tsx')
  assert.match(edit, /updateSupplierPoEquipment\(/)
  assert.match(edit, /SUPPLIER_PO_LINE_EDIT_FIELD_RULES/)
  assert.match(edit, /supplierPoLineEditFormSchema/)
  // ...and «تعديل الامر» the start date and the notes.
  const editPo = read('src', 'components', 'purchasing', 'EditSupplierPoDialog.tsx')
  assert.match(editPo, /updateSupplierPo\(/)
  assert.match(editPo, /SUPPLIER_PO_EDIT_FIELD_RULES/)
  assert.match(editPo, /supplierPoEditFormSchema/)
  // The equipment page card renders nothing without purchasing.view.
  const card = read('src', 'components', 'purchasing', 'EquipmentPurchasingCard.tsx')
  assert.match(card, /const allowed = can\('purchasing\.view'\)/)
  assert.match(card, /if \(!allowed\) return null/)
  const detail = read('src', 'screens', 'EquipmentDetail.tsx')
  assert.match(detail, /<EquipmentPurchasingCard equipmentId=\{equipment\.id\} onOpenPo=\{onOpenPo\} \/>/)
})

test('the mockup section of /ui-kit still names no route of its own', () => {
  const mockup = read('src', 'screens', 'ui-kit', 'PurchasingMockup.tsx')
  assert.doesNotMatch(mockup, /from '@\/lib\/purchasingData'/)
  // Only comments name the functions there.
  assert.doesNotMatch(mockup.replace(/^\s*\/\/.*$/gm, ''), /\.rpc\(/)
})

// --- The PO list: owner OR supplier (owner 2026-10-22) ---------------------------

test('supplierPoPartyOrFilter: the owner and supplier filters are OR-ed in the PO list', () => {
  const f = (field, operator, value, id = field) => ({ id, field, operator, value })
  const status = f('status', 'eq', 'open')
  // Both set: the non-external owners OR the ticked suppliers; the rest
  // stays for the generic pass.
  const both = purchasing.supplierPoPartyOrFilter([
    status,
    f('party_class', 'in', 'takween,external_supplier'),
    f('lessor_id', 'in', 'l1,l2'),
  ])
  assert.equal(both.clause, 'party_class.in.("takween"),lessor_id.in.("l1","l2")')
  assert.deepEqual(both.rest, [status])
  // Only «مالك اخر» ticked: the suppliers alone.
  assert.equal(
    purchasing.supplierPoPartyOrFilter([
      f('party_class', 'in', 'external_supplier'),
      f('lessor_id', 'in', 'l1'),
    ]).clause,
    'lessor_id.in.("l1")',
  )
  // One of the two missing (or empty): the generic pass applies them.
  assert.equal(purchasing.supplierPoPartyOrFilter([f('party_class', 'in', 'takween')]), null)
  assert.equal(purchasing.supplierPoPartyOrFilter([f('lessor_id', 'in', 'l1')]), null)
  assert.equal(
    purchasing.supplierPoPartyOrFilter([f('party_class', 'in', 'takween'), f('lessor_id', 'in', '')]),
    null,
  )
  // A negated owner filter is not rewritten.
  assert.equal(
    purchasing.supplierPoPartyOrFilter([f('party_class', 'not_in', 'takween'), f('lessor_id', 'in', 'l1')]),
    null,
  )
  const screen = read('src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx')
  assert.match(screen, /const partyOr = supplierPoPartyOrFilter\(list\.filters\)/)
  assert.match(screen, /if \(partyOr\) query = query\.or\(partyOr\.clause\)/)
  assert.match(screen, /partyOr \? partyOr\.rest : list\.filters/)
})

// --- «خيارات» and the close confirmation (owner 2026-10-22) ------------------------

test('the PO page closes through a typed order number, from the options menu', () => {
  const page = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  // No bare close button and no plain confirm any more.
  assert.doesNotMatch(page, /useConfirm|closeSupplierPo|variant="danger"/)
  // One menu element, rendered in the header and in the mobile bar.
  assert.equal((page.match(/<SupplierPoOptionsMenu/g) ?? []).length, 1)
  assert.equal((page.match(/\{optionsMenu\(/g) ?? []).length, 2, 'desktop header + mobile bar')
  assert.match(page, /<EditSupplierPoDialog/)
  assert.match(page, /<CloseSupplierPoDialog/)
  const menu = read('src', 'components', 'purchasing', 'SupplierPoOptionsMenu.tsx')
  assert.match(menu, /DropdownMenuTrigger asChild/)
  assert.match(menu, /t\('supplierPoEdit'\)/)
  assert.match(menu, /tone="danger"[\s\S]*t\('supplierPoClose'\)/)
  // Owner 2026-10-22: «تصدير PDF» is the first item, for every reader; the
  // management items only with their handlers.
  assert.ok(menu.indexOf("t('supplierPoPdf')") < menu.indexOf("t('supplierPoEdit')"))
  assert.match(menu, /const manage = Boolean\(onEdit && onClose\)/)
  assert.match(page, /onEdit=\{showActions \? \(\) => setEditOpen\(true\) : undefined\}/)
  const close = read('src', 'components', 'purchasing', 'CloseSupplierPoDialog.tsx')
  assert.match(close, /closeSupplierPo\(po\.id\)/)
  assert.match(close, /disabled=\{!matches\}/)
  assert.match(close, /if \(!matches \|\| saving\) return/)
  // The matcher ignores case and spaces, nothing else.
  const src = close.slice(close.indexOf('export function closeConfirmationMatches'), close.indexOf('/**', close.indexOf('export function closeConfirmationMatches')))
  const matches = new Function(`${src.replace(/: string/g, '').replace(/\): boolean/, ')').replace('export ', '')}; return closeConfirmationMatches`)()
  assert.equal(matches(' spo26 0001 ', 'SPO260001'), true)
  assert.equal(matches('SPO260002', 'SPO260001'), false)
  assert.equal(matches('', 'SPO260001'), false)
})

// --- «تصدير PDF» of a PO (owner 2026-10-22): the print dialog, no page -------------

test('the PO PDF prints a hidden sheet from the PO page itself', () => {
  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  // No tab, no route: the button mounts the sheet, the sheet prints.
  assert.doesNotMatch(detail, /window\.open|print\/po|sessionStorage/)
  assert.match(detail, /onExport=\{\(\) => setPrinting\(true\)\}/)
  assert.doesNotMatch(detail, /pdfButton|FileDown/)
  assert.match(detail, /\{printing && \(\s*<SupplierPoPrintSheet/)
  assert.match(detail, /onDone=\{\(\) => setPrinting\(false\)\}/)
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.doesNotMatch(sheet, /supabase|fetch\(|sessionStorage/)
  assert.match(sheet, /createPortal\(/)
  assert.match(sheet, /document\.body,\s*\)/)
  assert.match(sheet, /className="po-print-sheet print-export hidden /)
  assert.match(sheet, /window\.addEventListener\('afterprint', finish\)/)
  assert.match(sheet, /window\.requestAnimationFrame\(\(\) => window\.print\(\)\)/)
  assert.match(sheet, /@page \{ size: A4 portrait;/)
  // Only the sheet prints, on paper colors, while it exists.
  const css = read('src', 'index.css')
  assert.match(css, /html:has\(\.po-print-sheet\) body > :not\(\.po-print-sheet\) \{\s*display: none !important;/)
  assert.match(css, /\.po-print-sheet \{\s*display: block !important;/)
  assert.match(css, /html:has\(\.print-export\) \{/)
  // No route of its own any more.
  const navSource = read('src', 'lib', 'navPermissions.ts')
  assert.doesNotMatch(navSource, /print\/po/)
})
