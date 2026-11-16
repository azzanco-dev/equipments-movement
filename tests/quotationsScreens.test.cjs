const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «عروض الاسعار» (migration 0199), the screens: the list, the quotation
// page, the print sheet, the dialogs, the terms template in Settings, the
// navigation, the token map and the form rules.

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

// --- Files -------------------------------------------------------------------

test('every file of the feature exists', () => {
  for (const parts of [
    ['src', 'lib', 'quotations.ts'],
    ['src', 'lib', 'quotationsData.ts'],
    ['src', 'screens', 'sales', 'QuotationsListScreen.tsx'],
    ['src', 'screens', 'sales', 'QuotationDetail.tsx'],
    ['src', 'components', 'sales', 'QuotationPrintSheet.tsx'],
    ['src', 'components', 'sales', 'QuotationFormDialog.tsx'],
    ['src', 'components', 'sales', 'ApproveQuotationDialog.tsx'],
    ['src', 'components', 'sales', 'ReturnQuotationDialog.tsx'],
    ['src', 'components', 'sales', 'QuotationOutcomeDialog.tsx'],
    ['src', 'components', 'sales', 'DeleteQuotationDialog.tsx'],
    ['src', 'components', 'quotations', 'QuotationTermsSettings.tsx'],
  ])
    assert.ok(exists(...parts), parts.join('/'))
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
  // The terms template page: approvers only.
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
  assert.match(page, /'sales\.quotations\.approve'/)
  assert.match(page, /quotationTermTemplateSchema/)
  assert.match(page, /useConfirm\(\)/)
  assert.match(page, /<ErrorState/)
  // Edit sends the term's current position back, so it does not move.
  assert.match(page, /position: String\(row\.position\)/)
})

// --- List config -------------------------------------------------------------

test('the list config: search, filters, sorts', () => {
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
  for (const key of ['state', 'company_id', 'issue_date', 'valid_until'])
    assert.match(config, new RegExp(`key: '${key}'`))
  for (const state of ['draft', 'approved', 'accepted', 'rejected', 'expired'])
    assert.match(config, new RegExp(`value: '${state}'`))
  for (const sort of [
    'updated_at',
    'issue_date',
    'valid_until',
    'quote_number',
  ])
    assert.match(config, new RegExp(`\\{ key: '${sort}'`))
})

// --- Tokens ------------------------------------------------------------------

test('the token map covers every token of the migration', () => {
  const q = loadLibModule('quotations')
  const raised = new Set(
    [...MIGRATION.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  // The internal counters are never reached by a screen.
  raised.delete('quotation_number_sequence_missing')
  raised.delete('quotation_draft_sequence_missing')
  raised.add('sales_manage_required')
  for (const token of raised)
    assert.ok(
      Object.prototype.hasOwnProperty.call(q.QUOTATION_FORM_MESSAGES, token),
      token,
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
    title_ar: 'الدفع',
    title_en: 'Payment',
    body_ar: 'خلال 30 يوم',
    body_en: 'Within 30 days',
    position: '',
    is_default: true,
    ...patch,
  })
  const none = (result) => assert.equal(Object.keys(result).length, 0)
  none(v.validateWithSchema(v.quotationTermTemplateSchema, values()))
  assert.equal(
    v.validateWithSchema(
      v.quotationTermTemplateSchema,
      values({ title_en: '' }),
    ).title_en,
    'quotationTermTitleRequired',
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

test('the page wires every dialog; the placeholders are gone', () => {
  const page = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
  assert.doesNotMatch(page, /&& null\}/)
  for (const name of [
    'QuotationFormDialog',
    'ApproveQuotationDialog',
    'ReturnQuotationDialog',
    'QuotationOutcomeDialog',
    'ClearQuotationOutcomeDialog',
    'DeleteQuotationDialog',
  ])
    assert.match(page, new RegExp(`<${name}\\b`), name)
  assert.match(page, /if \(onDeleted\) onDeleted\(\)/)
  assert.match(page, /onRefused=\{refused\}/)
  assert.match(page, /can\('sales\.manage'\)/)
  assert.match(page, /can\('sales\.quotations\.approve'\)/)
  // No timeline (owner: «شيل سجل العرض»).
  assert.doesNotMatch(page, /EventTimeline|quotation_events/)
  const list = read('src', 'screens', 'sales', 'QuotationsListScreen.tsx')
  assert.doesNotMatch(list, /&& null\}/)
  assert.match(list, /<QuotationFormDialog/)
  assert.match(list, /onSelectQuotation\(id\)/)
})

test('the dialogs call their functions and map the tokens', () => {
  const dir = ['src', 'components', 'sales']
  const approve = read(...dir, 'ApproveQuotationDialog.tsx')
  assert.match(approve, /approveQuotation\(/)
  assert.match(approve, /quotationApproveDescDraftRef/)
  const back = read(...dir, 'ReturnQuotationDialog.tsx')
  assert.match(back, /returnQuotationApproval\(/)
  const outcome = read(...dir, 'QuotationOutcomeDialog.tsx')
  assert.match(outcome, /<RadioGroup/)
  assert.match(outcome, /outcome: null/)
  const remove = read(...dir, 'DeleteQuotationDialog.tsx')
  assert.match(remove, /deleteQuotation\(/)
  assert.match(remove, /variant="danger"/)
  for (const source of [approve, back, outcome, remove])
    assert.match(source, /quotationErrorMessage\(result\.error\)/)
})

test('the print sheet omits the number for a draft reference', () => {
  const sheet = read('src', 'components', 'sales', 'QuotationPrintSheet.tsx')
  assert.match(sheet, /const draftRef = isQuotationDraftRef\(number\)/)
  assert.match(sheet, /\.\.\.\(draftRef\s+\? \[\]/)
})

// --- Translations ------------------------------------------------------------

test('the quotation keys: Arabic and English together, no hamza', () => {
  const [ar, en] = quotationBlocks()
  assert.ok(ar && en)
  assert.deepEqual(keysOf(ar).sort(), keysOf(en).sort())
  assert.doesNotMatch(ar, /[أإآ]/)
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
      title_ar: 'x',
      title_en: 'x',
      body_ar: 'x',
      body_en: 'x',
      position: 1,
    },
    {
      id: 't2',
      template_id: null,
      title_ar: 'y',
      title_en: 'y',
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
  for (const key of [
    'quotationErrNotDraft',
    'quotationErrNotApproved',
    'quotationErrApprovedLocked',
    'quotationErrNumberIssued',
    'quotationErrNotFound',
  ])
    assert.match(page, new RegExp(`'${key}'`), key)
  assert.match(
    page,
    /if \(QUOTATION_STALE_MESSAGES\.has\(message\)\) \{\s+setDialog\(null\)\s+setActionError\(message\)/,
  )
  assert.equal((page.match(/onRefused=\{refused\}/g) ?? []).length, 5)
  assert.match(page, /onStale=\{refused\}/)
  assert.match(page, /if \(!renders\) setDialog\(null\)/)
  for (const name of [
    'ApproveQuotationDialog',
    'ReturnQuotationDialog',
    'QuotationOutcomeDialog',
    'DeleteQuotationDialog',
  ]) {
    const source = read('src', 'components', 'sales', `${name}.tsx`)
    assert.match(source, /onRefused\?\.\(key\)/, name)
    assert.doesNotMatch(source, /onRefused\?\.\(\)/, name)
  }
})
