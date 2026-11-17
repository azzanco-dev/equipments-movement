const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «عروض الاسعار» (migration 0199), the screens: the list, the quotation
// page, the print sheet, the dialogs, the terms template in Settings, the
// navigation, the token map and the form rules.
//
// Since migration 0200 (owner 2026-11-17, «مايحتاج التصنيف او الدورة,
// شيلها») a quotation is a plain document: no states, no approval, no
// client answer, and its official number QT-… is issued when it is created.
// The second half of this file asserts that none of that is left in the
// client code.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts))

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

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261116100000_0199_quotations.sql',
)

/** The `// quotations (0199)` … `// end quotations (0199)` block of each
 *  language. */
function quotationBlocks() {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = []
  let from = 0
  for (;;) {
    const start = source.indexOf('// quotations (0199)', from)
    if (start < 0) break
    const end = source.indexOf('// end quotations (0199)', start)
    assert.ok(end > start)
    blocks.push(source.slice(start, end))
    from = end + 1
  }
  return blocks
}

const keysOf = (block) =>
  [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((match) => match[1])

/** A source without its comments (they may say what is NOT there). */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The client files of the feature (the terms template page apart: it keeps
 *  its gate `sales.quotations.approve`). */
const QUOTATION_FILES = [
  ['src', 'lib', 'quotations.ts'],
  ['src', 'lib', 'quotationsData.ts'],
  ['src', 'screens', 'sales', 'QuotationsListScreen.tsx'],
  ['src', 'screens', 'sales', 'QuotationDetail.tsx'],
  ['src', 'components', 'sales', 'QuotationPrintSheet.tsx'],
  ['src', 'components', 'sales', 'QuotationFormDialog.tsx'],
  ['src', 'components', 'sales', 'DeleteQuotationDialog.tsx'],
]

/** The dialogs migration 0200 made pointless. */
const REMOVED_DIALOGS = [
  'ApproveQuotationDialog',
  'ReturnQuotationDialog',
  'QuotationOutcomeDialog',
]

/** The tokens the quotation functions still raise (0199 as left by 0200). */
const TOKENS = [
  'sales_manage_required',
  'invalid_quotation',
  'invalid_company',
  'invalid_project',
  'invalid_dates',
  'invalid_notes',
  'quotation_has_no_lines',
  'invalid_lines',
  'invalid_equipment_type',
  'duplicate_equipment_type',
  'invalid_price',
  'line_has_no_price',
  'invalid_note',
  'invalid_costs',
  'invalid_cost_name',
  'invalid_borne_by',
  'invalid_terms',
]

/** The tokens that went with the states. */
const GONE_TOKENS = [
  'quotation_approve_required',
  'invalid_outcome',
  'quotation_approved_locked',
  'quotation_not_draft',
  'quotation_not_approved',
  'quotation_number_issued',
]

// --- Files -------------------------------------------------------------------

test('every file of the feature exists', () => {
  for (const parts of [
    ['src', 'lib', 'quotations.ts'],
    ['src', 'lib', 'quotationsData.ts'],
    ['src', 'screens', 'sales', 'QuotationsListScreen.tsx'],
    ['src', 'screens', 'sales', 'QuotationDetail.tsx'],
    ['src', 'components', 'sales', 'QuotationPrintSheet.tsx'],
    ['src', 'components', 'sales', 'QuotationFormDialog.tsx'],
    ['src', 'components', 'sales', 'DeleteQuotationDialog.tsx'],
    ['src', 'components', 'quotations', 'QuotationTermsSettings.tsx'],
    ['src', 'components', 'quotations', 'QuotationTermFormDialog.tsx'],
  ])
    assert.ok(exists(...parts), parts.join('/'))
})

test('the dialogs of the removed states are deleted and imported nowhere', () => {
  for (const name of REMOVED_DIALOGS)
    assert.equal(
      exists('src', 'components', 'sales', `${name}.tsx`),
      false,
      name,
    )
  const removed = new RegExp(
    `${REMOVED_DIALOGS.join('|')}|ClearQuotationOutcomeDialog`,
  )
  for (const parts of [...QUOTATION_FILES, ['src', 'App.tsx']])
    assert.doesNotMatch(read(...parts), removed, parts.join('/'))
})

// --- Navigation --------------------------------------------------------------

test('the nav child is the last listed child of «المبيعات», on sales.view', () => {
  const nav = loadLibModule('navPermissions')
  const sales = nav.NAV_ENTRIES.find((entry) => entry.key === 'sales')
  const listed = sales.children.filter((child) => !child.hidden)
  const last = listed[listed.length - 1]
  assert.equal(last.key, 'sales/quotations')
  assert.deepEqual(JSON.parse(JSON.stringify(last.requires)), [
    { key: 'sales.view' },
  ])
  // /sales still lands where it did.
  assert.equal(nav.routePageOf(['sales']), 'sales/orders')
  assert.equal(nav.routePageOf(['sales', 'quotations']), 'sales/quotations')
  assert.equal(
    nav.routePageOf(['sales', 'quotations', 'q1']),
    'sales/quotations/:id',
  )
  assert.equal(
    nav.routePageOf(['settings', 'quotation-terms']),
    'settings/quotation-terms',
  )
  assert.equal(nav.routePageOf(['sales', 'x1']), 'sales/:id')
})

test('the routes: quotations before the client PO id fallback', () => {
  const nav = read('src', 'lib', 'navPermissions.ts')
  const quotations = nav.indexOf("if (second === 'quotations')")
  const fallback = nav.indexOf("return 'sales/:id'")
  assert.ok(quotations > 0 && fallback > quotations)
  assert.match(nav, /'sales\/quotations\/:id': \[\{ key: 'sales\.view' \}\]/)
  // The terms template page keeps its gate (the key's only use since 0200).
  assert.match(
    nav,
    /'settings\/quotation-terms': \[\{ key: 'sales\.quotations\.approve' \}\]/,
  )
  assert.match(nav, /'quotation-terms',\n\]\)/)
  const app = read('src', 'App.tsx')
  assert.match(
    app,
    /page === 'settings\/quotation-terms'\) && <AdminSettings \/>/,
  )
  assert.match(app, /page === 'sales\/quotations\/:id'/)
})

test('trail and tab titles of the pages', () => {
  const trail = read('src', 'lib', 'pageTrail.ts')
  assert.match(
    trail,
    /'sales\/quotations\/:id': \{\s+parents: \[SALES, \['quotations', '\/sales\/quotations'\]\]/,
  )
  assert.match(
    trail,
    /'settings\/quotation-terms': \{\s+parents: \[SETTINGS\],\s+name: 'quotationTermsSettings'/,
  )
  const title = read('src', 'lib', 'pageTitle.ts')
  assert.match(
    title,
    /'sales\/quotations': \{ kind: 'sub', name: 'quotations', section: 'sales' \}/,
  )
  assert.match(
    title,
    /'sales\/quotations\/:id': \{ kind: 'detail', section: 'quotations' \}/,
  )
  assert.match(title, /name: 'quotationTermsSettings',\s+section: 'settings'/)
})

test('the Settings page sits in AdminSettings like the banks', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(
    settings,
    /const showQuotationTerms = pathname === '\/settings\/quotation-terms'/,
  )
  const card = settings.indexOf("{opens('settings/quotation-terms') && (")
  assert.ok(card > 0)
  assert.ok(
    settings.indexOf("router.push('/settings/quotation-terms')", card) > card,
  )
  const page = read(
    'src',
    'components',
    'quotations',
    'QuotationTermsSettings.tsx',
  )
  // The gate: the one constant of the lib (the quotation form reads it too).
  assert.match(
    read('src', 'lib', 'quotations.ts'),
    /export const QUOTATION_TERMS_PERMISSION = 'sales\.quotations\.approve'/,
  )
  assert.match(page, /const canEdit = can\(QUOTATION_TERMS_PERMISSION\)/)
  assert.match(page, /useConfirm\(\)/)
  assert.match(page, /<ErrorState/)
  // The term form is the shared dialog (add and edit).
  assert.match(page, /<QuotationTermFormDialog[\s\S]*?term=\{editing\}/)
  const form = read(
    'src',
    'components',
    'quotations',
    'QuotationTermFormDialog.tsx',
  )
  assert.match(form, /quotationTermTemplateSchema/)
  // Edit sends the term's current position back, so it does not move.
  assert.match(form, /position: String\(term\.position\)/)
  assert.match(form, /updateQuotationTermTemplate\(term\.id, form\)/)
  assert.match(form, /insertQuotationTermTemplate\(form\)/)
})

// --- A term is its text alone (owner 2026-11-17, migration 0201) -------------

test('no term title is left in the client code', () => {
  for (const parts of [
    ...QUOTATION_FILES,
    ['src', 'components', 'quotations', 'QuotationTermsSettings.tsx'],
    ['src', 'components', 'quotations', 'QuotationTermFormDialog.tsx'],
    ['src', 'lib', 'formValidation.ts'],
  ])
    assert.doesNotMatch(
      codeOf(read(...parts)),
      /title_ar|title_en|QUOTATION_TERM_TITLE_MAX|quotationTermTitle|quotationTermColTitle/,
      parts.join('/'),
    )
  assert.doesNotMatch(
    read('src', 'i18n', 'translations.ts'),
    /quotationTermTitle|quotationTermColTitle/,
  )
  const data = read('src', 'lib', 'quotationsData.ts')
  assert.match(data, /'id,quotation_id,template_id,body_ar,body_en,position'/)
  assert.match(
    data,
    /'id,body_ar,body_en,position,is_default,created_at,updated_at'/,
  )
  // The payload of a template term: the two texts, the order, the switch.
  const q = loadLibModule('quotations')
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        q.quotationTermTemplatePayload({
          body_ar: ' نص ',
          body_en: ' Text ',
          position: '',
          is_default: false,
        }),
      ),
    ),
    { body_ar: 'نص', body_en: 'Text', position: 0, is_default: false },
  )
  // The page, the form and the PDF show the text under its number.
  const sheet = read('src', 'components', 'sales', 'QuotationPrintSheet.tsx')
  assert.match(sheet, /\{index \+ 1\}\. \{term\.body_en\}/)
})

// --- The terms from the list and from the form (owner 2026-11-17) ------------

test('«خيارات» of the list links to the terms template page', () => {
  const list = read('src', 'screens', 'sales', 'QuotationsListScreen.tsx')
  assert.match(
    list,
    /export const QUOTATION_TERMS_HREF = '\/settings\/quotation-terms'/,
  )
  // Shown only when the shell opens that page for the user.
  assert.match(list, /const optionsMenu = canOpenTerms \? \(/)
  assert.match(list, /canOpenTerms = false,/)
  // A real link inside the menu, labelled «الشروط والاحكام».
  assert.match(
    list,
    /<DropdownMenuItem asChild>\s+<AppLink href=\{QUOTATION_TERMS_HREF\}>[\s\S]*?\{t\('quotationTermsTitle'\)\}\s+<\/AppLink>/,
  )
  assert.match(list, /\{t\('options'\)\}/)
  assert.match(
    read('src', 'App.tsx'),
    /<QuotationsListScreen[\s\S]*?canOpenTerms=\{shell\.pages\.has\('settings\/quotation-terms'\)\}/,
  )
  // The shared menu item passes an `asChild` child through untouched.
  const menu = read('src', 'components', 'ui', 'DropdownMenu.tsx')
  assert.match(menu, /if \(props\.asChild\)/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.equal(
    (translations.match(/^    quotationListOptions:/gm) ?? []).length,
    2,
  )
})

test('the quotation form adds a term to the template and ticks it', () => {
  const form = read('src', 'components', 'sales', 'QuotationFormDialog.tsx')
  // Only for a holder of the template's key (RLS decides in the end).
  assert.match(form, /const canAddTerm = can\(QUOTATION_TERMS_PERMISSION\)/)
  assert.match(
    form,
    /\{canAddTerm && \(\s+<Button[\s\S]*?onClick=\{\(\) => setTermDialogOpen\(true\)\}[\s\S]*?\{t\('quotationTermAdd'\)\}/,
  )
  // A new term only (no `term` prop) and no explaining line (owner
  // 2026-11-17: «وشيل النص حق يضاف الشرط الى قالب الشروط»).
  const start = form.indexOf('<QuotationTermFormDialog')
  assert.ok(start > 0)
  const dialog = form.slice(start, form.indexOf('/>', start))
  assert.doesNotMatch(dialog, /\bterm=/)
  assert.doesNotMatch(dialog, /note=/)
  assert.doesNotMatch(
    read('src', 'i18n', 'translations.ts'),
    /quotationTermAddNote/,
  )
  // After the save: ticked, then the template read again without a flash.
  assert.match(
    dialog,
    /onSaved=\{\(id\) => \{\s+setTermDialogOpen\(false\)[\s\S]*?setCopied\(id, true\)\s+void loadTemplates\(true\)/,
  )
  assert.match(form, /if \(!quiet\) setTemplatesState\('loading'\)/)
})

// --- List config -------------------------------------------------------------

test('the list config: search, company and date filters, sorts', () => {
  const configs = read('src', 'lib', 'listConfigs.ts')
  const start = configs.indexOf('export const quotationsListConfig')
  assert.ok(start > 0)
  const config = configs.slice(start, configs.indexOf('\n}\n', start))
  assert.match(
    config,
    /searchFields: \['quote_number', 'company_name_ar', 'company_name_en'\]/,
  )
  assert.match(config, /defaultSort: 'updated_at'/)
  assert.match(config, /defaultDirection: 'desc'/)
  // The filters: the company and the two dates, nothing about a state.
  const filters = config.slice(
    config.indexOf('filterFields:'),
    config.indexOf('sortableFields:'),
  )
  assert.deepEqual(
    [...filters.matchAll(/key: '([a-z_]+)'/g)].map((match) => match[1]),
    ['company_id', 'issue_date', 'valid_until'],
  )
  assert.doesNotMatch(
    codeOf(config),
    /state|status|draft|approved|accepted|rejected|expired/,
  )
  for (const sort of [
    'updated_at',
    'issue_date',
    'valid_until',
    'quote_number',
  ])
    assert.match(config, new RegExp(`\\{ key: '${sort}'`))
})

// --- Tokens ------------------------------------------------------------------

test('the token map: every remaining token, none of the removed ones', () => {
  const q = loadLibModule('quotations')
  assert.deepEqual([...q.QUOTATION_ERROR_TOKENS].sort(), [...TOKENS].sort())
  // Each remaining token is one migration 0199 raises.
  const raised = new Set(
    [...MIGRATION.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  raised.add('sales_manage_required')
  for (const token of TOKENS) assert.ok(raised.has(token), token)
  for (const token of GONE_TOKENS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(q.QUOTATION_FORM_MESSAGES, token),
      false,
      token,
    )
    assert.equal(
      q.quotationErrorMessage({ message: token }),
      'quotationSaveFailed',
      token,
    )
  }
  // The only note left is a price row's.
  assert.equal(
    q.quotationErrorMessage({ message: 'invalid_note' }),
    'quotationErrLineNoteTooLong',
  )
  // `invalid_note` never answers for `invalid_notes`.
  assert.equal(
    q.quotationErrorMessage({ message: 'invalid_notes' }),
    'quotationErrNotesTooLong',
  )
  assert.equal(
    q.quotationErrorMessage({ message: 'something else' }),
    'quotationSaveFailed',
  )
})

// --- Form ----------------------------------------------------------------------

test('the form: no quantity or total, one save_quotation call', () => {
  const dialog = read('src', 'components', 'sales', 'QuotationFormDialog.tsx')
  // Code only: the comments may say what the form does NOT have.
  const code = dialog
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  // («{total}» is the terms count, «N من M محددة».)
  assert.doesNotMatch(code, /quantity|\btotals?\b(?!\})|الاجمالي|الكمية/i)
  assert.match(dialog, /await saveQuotation\(/)
  assert.match(dialog, /size="lg"/)
  assert.match(dialog, /inputMode="decimal"/)
  assert.match(dialog, /DEFAULT_QUOTATION_COSTS/)
  assert.match(dialog, /row\.is_default/)
  assert.match(dialog, /quotationTermsSelectedCount/)
  // A failed template load is an error with a retry, never «no terms».
  assert.match(
    dialog,
    /<ErrorState[\s\S]*?onRetry=\{\(\) => void loadTemplates\(\)\}/,
  )
  const data = read('src', 'lib', 'quotationsData.ts')
  assert.equal((data.match(/supabase\.rpc\('save_quotation'/g) ?? []).length, 1)
  // Create and edit alike: no wording of a draft, one save button each.
  assert.match(
    dialog,
    /editing \? t\('quotationSaveChanges'\) : t\('quotationSaveNew'\)/,
  )
  assert.doesNotMatch(dialog, /quotationFormDraftNotice|quotationSaveDraft/)
})

test('quotationFormSchema: the rules of the form', () => {
  const v = loadLibModule('formValidation')
  const line = (patch = {}) => ({
    equipment_type: 'حفار',
    daily_price: '',
    monthly_price: '18000',
    mob_demob_price: '',
    note: '',
    ...patch,
  })
  const form = (patch = {}) => ({
    company_id: 'c1',
    project_id: '',
    issue_date: '2026-11-16',
    valid_until: '2026-12-16',
    notes: '',
    lines: [line()],
    costs: [{ name: 'الديزل', borne_by: 'client' }],
    term_template_ids: [],
    keep_term_ids: [],
    ...patch,
  })
  const ok = v.quotationFormErrors(form())
  assert.equal(v.quotationFormHasErrors(ok), false)

  assert.equal(
    v.quotationFormErrors(form({ company_id: '' })).fields.company_id,
    'quotationCompanyRequired',
  )
  assert.equal(
    v.quotationFormErrors(form({ valid_until: '2026-11-01' })).fields
      .valid_until,
    'quotationErrInvalidDates',
  )
  assert.equal(
    v.quotationFormErrors(form({ lines: [] })).fields.lines,
    'quotationErrNoLines',
  )
  // A row with no price at all.
  assert.equal(
    v.quotationFormErrors(form({ lines: [line({ monthly_price: '' })] }))
      .lines[0],
    'quotationLinePriceRequired',
  )
  // A negative or non-numeric price; Arabic digits are read.
  assert.equal(
    v.quotationFormErrors(form({ lines: [line({ daily_price: '-5' })] }))
      .lines[0],
    'quotationErrInvalidPrice',
  )
  assert.equal(
    v.quotationFormErrors(form({ lines: [line({ daily_price: 'abc' })] }))
      .lines[0],
    'quotationErrInvalidPrice',
  )
  assert.equal(
    v.quotationFormHasErrors(
      v.quotationFormErrors(form({ lines: [line({ daily_price: '٩٠٠' })] })),
    ),
    false,
  )
  // The same type twice: the second row.
  const twice = v.quotationFormErrors(form({ lines: [line(), line()] }))
  assert.equal(twice.lines[0], undefined)
  assert.equal(twice.lines[1], 'quotationErrDuplicateType')
  // A cost name: 1 to 80 characters.
  assert.equal(
    v.quotationFormErrors(form({ costs: [{ name: ' ', borne_by: 'client' }] }))
      .costs[0],
    'quotationErrCostName',
  )
  assert.equal(
    v.quotationFormErrors(
      form({ costs: [{ name: 'x'.repeat(81), borne_by: 'lessor' }] }),
    ).costs[0],
    'quotationErrCostName',
  )
})

test('quotationTermTemplateSchema: texts and an optional position', () => {
  const v = loadLibModule('formValidation')
  const values = (patch = {}) => ({
    body_ar: 'خلال 30 يوم',
    body_en: 'Within 30 days',
    position: '',
    is_default: true,
    ...patch,
  })
  const none = (result) => assert.equal(Object.keys(result).length, 0)
  none(v.validateWithSchema(v.quotationTermTemplateSchema, values()))
  assert.equal(
    v.validateWithSchema(v.quotationTermTemplateSchema, values({ body_en: '' }))
      .body_en,
    'quotationTermBodyRequired',
  )
  assert.equal(
    v.validateWithSchema(
      v.quotationTermTemplateSchema,
      values({ body_ar: 'x'.repeat(1001) }),
    ).body_ar,
    'quotationTermBodyTooLong',
  )
  for (const bad of ['0', '-1', '1.5', 'a'])
    assert.equal(
      v.validateWithSchema(
        v.quotationTermTemplateSchema,
        values({ position: bad }),
      ).position,
      'quotationTermPositionInvalid',
      bad,
    )
  none(
    v.validateWithSchema(
      v.quotationTermTemplateSchema,
      values({ position: '3' }),
    ),
  )
})

test('«صالح لغاية» starts 30 days after the issue date', () => {
  const q = loadLibModule('quotations')
  assert.equal(q.quotationDefaultValidUntil('2026-11-16'), '2026-12-16')
  assert.equal(q.quotationDefaultValidUntil('2026-02-10'), '2026-03-12')
  assert.equal(q.quotationDefaultValidUntil(''), '')
})

// --- Page and dialogs ----------------------------------------------------------

test('the page: PDF for every reader, three options for a manager', () => {
  const page = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
  assert.doesNotMatch(page, /&& null\}/)
  for (const name of ['QuotationFormDialog', 'DeleteQuotationDialog'])
    assert.match(page, new RegExp(`<${name}\\b`), name)
  assert.match(page, /export type QuotationDialogKind = 'edit' \| 'delete'/)
  assert.match(page, /if \(onDeleted\) onDeleted\(\)/)
  assert.match(page, /can\('sales\.manage'\)/)
  // The approval key gates the terms template page only.
  assert.doesNotMatch(page, /sales\.quotations\.approve|canApprove/)
  // «خيارات»: edit, copy, delete — in that order, each for any quotation,
  // none with a blocker reason.
  const menu = page.slice(
    page.indexOf('const menuItems: MenuItem[] = canManage'),
    page.indexOf('const optionsMenu'),
  )
  assert.deepEqual(
    [...menu.matchAll(/label: '([A-Za-z]+)'/g)].map((match) => match[1]),
    ['quotationEdit', 'quotationCopy', 'quotationDelete'],
  )
  assert.doesNotMatch(page, /reason|Blocker|canDeleteQuotation/)
  // «تكرار العرض»: a confirmation first, then the copy, then the new
  // quotation's page (owner 2026-11-17).
  assert.match(
    page,
    /const copy = async \(\) => \{\s+if \(\s+!\(await confirm\(\{\s+title: t\('quotationCopyConfirmTitle'\),\s+description: t\('quotationCopyConfirmDesc'\),\s+confirmLabel: t\('quotationCopy'\),\s+\}\)\)\s+\)\s+return\s[\s\S]*?await copyQuotation\(quotation\.id\)[\s\S]*?onOpenQuotation\(result\.data\)/,
  )
  assert.match(page, /\{confirmDialog\}/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /quotationCopy: 'تكرار العرض',/)
  assert.match(translations, /quotationCopy: 'Duplicate quotation',/)
  assert.doesNotMatch(translations, /نسخ العرض/)
  assert.match(
    read('src', 'App.tsx'),
    /onOpenQuotation=\{\(id\) => router\.push\(`\/sales\/quotations\/\$\{id\}`\)\}/,
  )
  // «تصدير PDF» sits outside the manager's menu.
  assert.match(page, /\{optionsMenu\}\s+<Button[\s\S]*?t\('quotationPdf'\)/)
  // The one row of facts: the two dates, the creator, the last change.
  const facts = page.slice(
    page.indexOf('const facts: DescriptionListItem[] = ['),
    page.indexOf('const priceCell'),
  )
  assert.deepEqual(
    [...facts.matchAll(/key: '([A-Za-z]+)'/g)].map((match) => match[1]),
    ['issue', 'valid', 'createdBy', 'updatedAt'],
  )
  // No badge beside the number, no primary button, no phone bar.
  assert.doesNotMatch(page, /badges=|primaryButton|phoneBar/)
  // No timeline (owner: «شيل سجل العرض»).
  assert.doesNotMatch(page, /EventTimeline|quotation_events/)
  const list = read('src', 'screens', 'sales', 'QuotationsListScreen.tsx')
  assert.doesNotMatch(list, /&& null\}/)
  assert.match(list, /<QuotationFormDialog/)
  assert.match(list, /onSelectQuotation\(id\)/)
})

test('the list: no state column or tabs, a plain date, a plain number', () => {
  const list = read('src', 'screens', 'sales', 'QuotationsListScreen.tsx')
  assert.deepEqual(
    [...list.matchAll(/^\s{6}key: '([a-z_]+)',$/gm)].map((match) => match[1]),
    ['quote_number', 'client', 'types', 'valid_until', 'updated_at'],
  )
  assert.doesNotMatch(list, /<Tabs|TabsTrigger|<Badge|QUICK_TABS/)
  // «صالح لغاية»: the date with the display-only «ساري» / «منتهي» badge under
  // it (owner 2026-11-17); still no column, filter or tab of a stage.
  assert.match(
    list,
    /key: 'valid_until',[\s\S]*?<span className="tabular-nums">\{formatDate\(row\.valid_until\)\}<\/span>\s+<QuotationValidityBadge validUntil=\{row\.valid_until\} \/>/,
  )
  const q0 = loadLibModule('quotations')
  assert.equal(q0.quotationValidity('2026-11-17', '2026-11-17'), 'valid')
  assert.equal(q0.quotationValidity('2026-11-16', '2026-11-17'), 'expired')
  assert.equal(q0.quotationValidity('2026-12-01', '2026-11-17'), 'valid')
  assert.equal(q0.quotationValidity(null, '2026-11-17'), null)
  const badge = read('src', 'components', 'sales', 'QuotationValidityBadge.tsx')
  assert.match(badge, /tone=\{validity === 'valid' \? 'success' : 'neutral'\}/)
  assert.match(
    read('src', 'screens', 'sales', 'QuotationDetail.tsx'),
    /<QuotationValidityBadge validUntil=\{quotation\.valid_until\} \/>/,
  )
  // The PDF prints no such badge.
  assert.doesNotMatch(
    read('src', 'components', 'sales', 'QuotationPrintSheet.tsx'),
    /QuotationValidityBadge|quotationValidity/,
  )
  // The types: chips of the first three names, then «+N» with the rest.
  assert.match(
    list,
    /const \{ shown, rest \} = quotationTypeChips\(row\.type_names\)/,
  )
  assert.match(list, /<Tooltip content=\{rest\.join\('، '\)\}>/)
  const chips = q0.quotationTypeChips('A، B، C، D، E')
  assert.deepEqual([...chips.shown], ['A', 'B', 'C'])
  assert.deepEqual([...chips.rest], ['D', 'E'])
  assert.equal(q0.quotationTypeChips(null).shown.length, 0)
  // The number: plain bold text, not a pill (owner 2026-11-17), over the
  // issue date.
  assert.match(
    list,
    /key: 'quote_number',[\s\S]*?cell: \(row\) => \(\s+<span className="flex flex-col items-start gap-0\.5">\s+<bdi dir="ltr" className="font-semibold tabular-nums">\s+\{row\.quote_number\}\s+<\/bdi>\s+<span className="text-xs tabular-nums text-muted">\s+\{formatDate\(row\.issue_date\)\}/,
  )
  assert.doesNotMatch(list, /PoPill/)
  const pill = read('src', 'components', 'sales', 'PoPill.tsx')
  assert.match(
    pill,
    /isSupplierPoDraftRef\(number\) \? DRAFT_PILL_STYLE : PO_PILL_STYLE/,
  )
  const q = loadLibModule('quotations')
  const purchasing = loadLibModule('purchasing')
  // Three digits of sequence since migration 0202, more past 999.
  assert.ok(q.QUOTATION_NUMBER_PATTERN.test('QT-202611001'))
  assert.ok(q.QUOTATION_NUMBER_PATTERN.test('QT-2026111000'))
  assert.equal(q.QUOTATION_NUMBER_PATTERN.test('QT-20261101'), false)
  assert.equal(q.QUOTATION_NUMBER_PATTERN.test('QD-0001'), false)
  // A quotation number is never read as a PO draft reference (grey).
  assert.equal(purchasing.isSupplierPoDraftRef('QT-202611001'), false)
})

test('the data module calls only the three functions that remain', () => {
  const data = read('src', 'lib', 'quotationsData.ts')
  assert.deepEqual(
    [...data.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map((match) => match[1]),
    ['save_quotation', 'delete_quotation', 'copy_quotation'],
  )
  assert.doesNotMatch(
    data,
    /approve_quotation|return_quotation_approval|set_quotation_outcome/,
  )
  // The select is the view after 0200, column for column.
  const select = /QUOTATION_LIST_SELECT =\s+'([^']+)'/.exec(data)[1]
  assert.deepEqual(select.split(','), [
    'id',
    'company_id',
    'project_id',
    'quote_number',
    'issue_date',
    'valid_until',
    'notes',
    'created_by',
    'created_at',
    'updated_at',
    'company_name_ar',
    'company_name_en',
    'project_name_ar',
    'project_name_en',
    'created_by_name',
    'line_count',
    'type_names',
  ])
})

test('no state, approval or client answer is left in the client code', () => {
  const gone =
    /QuotationState|QuotationStatus|QuotationOutcome|QUOTATION_STATE|quotationStateOf|showsDaysLeft|daysLeftLabel|isQuotationDraftRef|QUOTATION_DRAFT_REF|quotationApprovalBlocker|canDeleteQuotation|quotationQuickState|withQuickState|approveQuotation|returnQuotationApproval|setQuotationOutcome|\bapproved_(at|by)|approved_by_name|\boutcome_(at|by|note)\b|\.outcome\b(?!\.)|\.status\b|\bstate=|QD-/
  for (const parts of QUOTATION_FILES)
    assert.doesNotMatch(codeOf(read(...parts)), gone, parts.join('/'))
  const q = loadLibModule('quotations')
  for (const name of [
    'QUOTATION_STATES',
    'QUOTATION_STATE_BADGE',
    'QUOTATION_PRINT_STATE_KEYS',
    'QUOTATION_DRAFT_REF_PATTERN',
    'quotationStateOf',
    'showsDaysLeft',
    'daysLeftLabel',
    'isQuotationDraftRef',
    'quotationApprovalBlocker',
    'canDeleteQuotation',
    'quotationQuickState',
    'withQuickState',
  ])
    assert.equal(name in q, false, name)
})

test('the delete dialog: any quotation, for good, a simple confirm', () => {
  const remove = read('src', 'components', 'sales', 'DeleteQuotationDialog.tsx')
  assert.match(remove, /deleteQuotation\(/)
  assert.match(remove, /variant="danger"/)
  assert.match(remove, /description=\{t\('quotationDeleteDesc'\)\}/)
  assert.match(remove, /quotationErrorMessage\(result\.error\)/)
  // No typing, no confirmation field.
  assert.doesNotMatch(remove, /<Input|<Field|closeConfirmationMatches/)
  // The text says it plainly, in both languages.
  const source = read('src', 'i18n', 'translations.ts')
  assert.match(
    source,
    /quotationDeleteDesc:\s+'يحذف العرض نهائيا[^']*رقم هذا العرض لن يستخدم مرة اخرى\.'/,
  )
  assert.match(
    source,
    /quotationDeleteDesc:\s+'Deletes the quotation for good[^']*its number will not be used again\.'/,
  )
})

test('the print sheet always prints the number and never a state', () => {
  const sheet = read('src', 'components', 'sales', 'QuotationPrintSheet.tsx')
  const facts = sheet.slice(
    sheet.indexOf('const headerFacts'),
    sheet.indexOf('const cell ='),
  )
  assert.match(facts, /\[\s+\{ key: 'quotationPrintNumber', value: number \},/)
  assert.deepEqual(
    [...facts.matchAll(/key: '([A-Za-z]+)'/g)].map((match) => match[1]),
    [
      'quotationPrintNumber',
      'quotationPrintIssueDate',
      'quotationPrintValidUntil',
    ],
  )
  assert.doesNotMatch(codeOf(sheet), /draft|Draft|state|Status|\.\.\.\(/)
  // The suggested file name is the number alone.
  assert.match(sheet, /document\.title = number\n/)
  const page = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
  const usage = page.slice(page.indexOf('<QuotationPrintSheet'))
  assert.doesNotMatch(usage.slice(0, usage.indexOf('/>')), /state=/)
})

// --- Translations ------------------------------------------------------------

test('the quotation keys: Arabic and English together, no hamza', () => {
  const [ar, en] = quotationBlocks()
  assert.ok(ar && en)
  assert.deepEqual(keysOf(ar).sort(), keysOf(en).sort())
  assert.doesNotMatch(ar, /[أإآ]/)
})

test('the keys of the removed pieces are gone from both languages', () => {
  const [ar, en] = quotationBlocks()
  const removed =
    /quotationState|quotationApprov|quotationReturn|Outcome|quotationDraftRef|quotationAccepted|quotationRejected|quotationPrintStatus|quotationErrNotDraft|quotationErrNotApproved|quotationErrNumberIssued|quotationErrNoteTooLong|quotationFormDraftNotice|quotationSaveDraft/
  for (const block of [ar, en])
    for (const key of keysOf(block)) assert.doesNotMatch(key, removed, key)
  // No wording of a draft, an approval or an answer in the texts of the
  // quotation itself. (The terms template lines are not about a quotation's
  // stage; «منتهي» / "Expired" came back on 2026-11-17 as the display-only
  // validity badge, its one key.)
  assert.doesNotMatch(ar, /مسودة|اعتماد|معتمد|رد العميل|مقبول|مرفوض/)
  assert.doesNotMatch(en, /\bdraft\b|approv|client's answer/i)
  assert.equal((ar.match(/منتهي/g) ?? []).length, 1)
  assert.match(ar, /quotationValidityExpired: 'منتهي',/)
  for (const block of [ar, en]) {
    const keys = new Set(keysOf(block))
    for (const key of ['quotationSaveNew', 'quotationDeleteDesc'])
      assert.ok(keys.has(key), key)
  }
})

// --- Review fixes (2026-11-16) -----------------------------------------------

test('an edit keeps the stored terms; the wrapper sends p_keep_term_ids', () => {
  const q = loadLibModule('quotations')
  const row = {
    company_id: 'c1',
    project_id: null,
    issue_date: '2026-11-16',
    valid_until: '2026-12-16',
    notes: null,
  }
  const terms = [
    {
      id: 't1',
      template_id: 'a',
      body_ar: 'x',
      body_en: 'x',
      position: 1,
    },
    {
      id: 't2',
      template_id: null,
      body_ar: 'y',
      body_en: 'y',
      position: 2,
    },
  ]
  const values = q.quotationFormValuesOf(row, [], [], terms)
  assert.deepEqual([...values.keep_term_ids], ['t1', 't2'])
  assert.equal(values.term_template_ids.length, 0)
  const data = read('src', 'lib', 'quotationsData.ts')
  assert.match(
    data,
    /p_keep_term_ids:\s+input\.id && values\.keep_term_ids\.length \? values\.keep_term_ids : null/,
  )
  const dialog = read('src', 'components', 'sales', 'QuotationFormDialog.tsx')
  assert.match(dialog, /keep_term_ids: editing \? keptTermIds : \[\]/)
  assert.match(dialog, /const shown = stored && !copied \? stored : template/)
  assert.match(dialog, /quotationTermRefresh/)
  assert.match(dialog, /quotationTermKeepStored/)
  assert.doesNotMatch(dialog, /quotationOrphanTermNote/)
  // The database side the client relies on.
  assert.match(MIGRATION, /p_keep_term_ids uuid\[\] DEFAULT NULL/)
})

test('the print sheet does not tear down the started print', () => {
  const sheet = read('src', 'components', 'sales', 'QuotationPrintSheet.tsx')
  const start = sheet.indexOf('if (printed.current) return')
  const end = sheet.indexOf('}, [logoSettled, number])', start)
  assert.ok(start > 0 && end > start)
  const effect = sheet.slice(start, end)
  // `finish` alone removes the listener and the fallback.
  assert.doesNotMatch(effect, /return \(\) =>/)
  assert.match(effect, /window\.removeEventListener\('afterprint', finish\)/)
  assert.match(effect, /window\.clearTimeout\(fallback\)/)
  assert.match(effect, /document\.title = previousTitle/)
})

test('a stale refusal closes its dialog and reaches the page notice', () => {
  const page = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
  // The one refusal that means the quotation is gone meanwhile.
  assert.match(
    page,
    /QUOTATION_STALE_MESSAGES: ReadonlySet<TranslationKey> = new Set\(\[\s+'quotationErrNotFound',\s+\]\)/,
  )
  assert.match(
    page,
    /if \(QUOTATION_STALE_MESSAGES\.has\(message\)\) \{\s+setDialog\(null\)\s+setActionError\(message\)/,
  )
  assert.equal((page.match(/onRefused=\{refused\}/g) ?? []).length, 1)
  assert.match(page, /onStale=\{refused\}/)
  assert.match(page, /if \(dialog && !canManage\) setDialog\(null\)/)
  const remove = read('src', 'components', 'sales', 'DeleteQuotationDialog.tsx')
  assert.match(remove, /onRefused\?\.\(key\)/)
  assert.doesNotMatch(remove, /onRefused\?\.\(\)/)
  const form = read('src', 'components', 'sales', 'QuotationFormDialog.tsx')
  assert.match(
    form,
    /STALE_MESSAGES: ReadonlySet<TranslationKey> = new Set\(\[\s+'quotationErrNotFound',\s+\]\)/,
  )
})
