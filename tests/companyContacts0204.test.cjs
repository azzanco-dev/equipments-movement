const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Migration 0204 and its screens (owner 2026-11-19):
//   «ابغى خيار اضافة بيانات شخص مسؤول جديد, ويكون فيه تعيين له حسب الشركة
//   وحسب المشروع, الاسم رقم التواصل الايميل» — the responsible persons of a
//   client company, one of which a quotation COPIES as its «عناية»;
//   «في قاعدة البيانات اضف اسناد الشركة والمشروع … لكن الفلتر يكون حسب
//   الشركة مبدئيا»; «لا خليهم منفصلين» (the company row's own contact stays
//   apart); and the three working-hours numbers as fields of the quotation.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const HAMZA_ALIF = /[أإآ]/
const MIGRATION = read(
  'supabase',
  'migrations',
  '20261119100000_0204_company_contacts_quotation_hours.sql',
)

const cache = new Map()
function load(request) {
  const file = path.join(ROOT, 'src', ...request.split('/')) + '.ts'
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const localRequire = (name) =>
    name.startsWith('@/') ? load(name.slice(2)) : require(name)
  new Function('module', 'exports', 'require', code)(
    mod,
    mod.exports,
    localRequire,
  )
  return mod.exports
}

/** The body of one function of the migration. */
function functionBody(name) {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`)
  assert.ok(start > 0, name)
  const end = MIGRATION.indexOf('\n$$;', start)
  return MIGRATION.slice(start, end)
}

// --- The migration -------------------------------------------------------------

test('0204: the two tables are read-only for clients', () => {
  assert.match(
    MIGRATION,
    /CREATE TABLE public\.company_contacts \([\s\S]*?company_id uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/,
  )
  assert.match(
    MIGRATION,
    /CREATE TABLE public\.company_contact_projects \([\s\S]*?PRIMARY KEY \(contact_id, project_id\)/,
  )
  // An editable table carries updated_at with the shared trigger; the link
  // table carries created_at only.
  assert.match(
    MIGRATION,
    /CREATE TRIGGER company_contacts_updated_at\s+BEFORE UPDATE ON public\.company_contacts\s+FOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\)/,
  )
  for (const table of ['company_contacts', 'company_contact_projects']) {
    assert.match(
      MIGRATION,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
    )
    assert.match(
      MIGRATION,
      new RegExp(
        `REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated;`,
      ),
    )
    assert.match(
      MIGRATION,
      new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO authenticated;`),
    )
  }
  // Read by sales or by the companies keys; no write policy at all.
  assert.equal(
    (MIGRATION.match(/CREATE POLICY [a-z_]+ ON public\.company_contact/g) ?? [])
      .length,
    2,
  )
  assert.doesNotMatch(
    MIGRATION,
    /ON public\.company_contact[a-z_]*\s+FOR (INSERT|UPDATE|DELETE|ALL)/,
  )
  for (const key of [
    'sales.view',
    'companies_projects.read',
    'companies_projects.edit',
  ])
    assert.ok(MIGRATION.includes(`public.has_permission('${key}')`), key)
})

test('0204: the writers of a person check the key first', () => {
  const gate = functionBody('assert_company_contacts_manage')
  assert.match(
    gate,
    /public\.has_permission\('sales\.manage'\)\s+OR public\.has_permission\('companies_projects\.edit'\)/,
  )
  assert.match(gate, /'company_contacts_manage_required'/)
  assert.match(
    MIGRATION,
    /REVOKE ALL ON FUNCTION public\.assert_company_contacts_manage\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  for (const name of ['save_company_contact', 'delete_company_contact']) {
    const body = functionBody(name)
    assert.match(body, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
    const code = body.slice(body.indexOf('BEGIN'))
    assert.match(
      code,
      /^BEGIN\s+PERFORM public\.assert_company_contacts_manage\(\);/,
    )
  }
  const save = functionBody('save_company_contact')
  for (const token of [
    'invalid_contact',
    'invalid_company',
    'invalid_name',
    'invalid_contact_number',
    'invalid_email',
    'invalid_project',
  ])
    assert.ok(save.includes(`'${token}'`), token)
  // A person never moves to another company; the projects are replaced.
  assert.match(save, /p_company_id <> v_c\.company_id/)
  assert.match(save, /ON CONFLICT \(contact_id, project_id\) DO NOTHING/)
  assert.match(
    MIGRATION,
    /GRANT EXECUTE ON FUNCTION public\.save_company_contact\(uuid, uuid, text, text, text, uuid\[\]\)\s+TO authenticated;/,
  )
})

test('0204: a quotation holds a COPY, and no foreign key to the person', () => {
  const alter = MIGRATION.slice(
    MIGRATION.indexOf('ALTER TABLE public.quotations'),
    MIGRATION.indexOf('COMMENT ON COLUMN public.quotations.contact_id'),
  )
  // Deleting a person must not touch a quotation row (its updated_at).
  assert.match(alter, /ADD COLUMN contact_id uuid,/)
  assert.doesNotMatch(alter, /REFERENCES/)
  for (const column of [
    'attention_name',
    'attention_number',
    'attention_email',
  ])
    assert.match(alter, new RegExp(`ADD COLUMN ${column} text`))
  assert.match(alter, /daily_hours numeric\(4, 2\) NOT NULL DEFAULT 10/)
  assert.match(alter, /monthly_days smallint NOT NULL DEFAULT 26/)
  assert.match(alter, /monthly_hours numeric\(5, 2\) NOT NULL DEFAULT 260/)
  const remove = functionBody('delete_company_contact')
  assert.doesNotMatch(remove, /quotations/)
  // The company row's own contact is not copied into the list.
  assert.doesNotMatch(
    MIGRATION,
    /INSERT INTO public\.company_contacts[\s\S]{0,200}FROM public\.companies/,
  )
})

test('0204: save_quotation takes «عناية» and the hours, old calls still work', () => {
  // The ten-parameter function is dropped: two overloads that differ by
  // trailing defaults could not be told apart by a named call.
  assert.match(
    MIGRATION,
    /DROP FUNCTION public\.save_quotation\(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid\[\], uuid\[\]\);/,
  )
  const save = functionBody('save_quotation')
  assert.match(
    save,
    /p_keep_term_ids uuid\[\] DEFAULT NULL,\s+p_attention jsonb DEFAULT NULL,\s+p_hours jsonb DEFAULT NULL\s+\)/,
  )
  assert.match(save, /^FUNCTION public\.save_quotation\(/)
  assert.match(save, /PERFORM public\.assert_sales_manage\(\);/)
  for (const token of ['invalid_attention', 'invalid_hours'])
    assert.ok(save.includes(`'${token}'`), token)
  // NULL keeps what the quotation has; a changed client drops «عناية».
  assert.match(
    save,
    /IF p_attention IS NULL THEN\s+IF p_id IS NOT NULL AND v_q\.company_id = p_company_id THEN/,
  )
  // The person is linked only while it belongs to this client.
  assert.match(
    save,
    /WHERE c\.id = v_text::uuid AND c\.company_id = p_company_id;/,
  )
  // 0201's rules are all still there.
  for (const token of [
    'invalid_quotation',
    'quotation_has_no_lines',
    'duplicate_equipment_type',
    'line_has_no_price',
    'invalid_terms',
  ])
    assert.ok(save.includes(`'${token}'`), token)
  assert.match(save, /p_keep_term_ids/)
  // The copy and the archive carry the new columns; the view appends them.
  assert.match(
    functionBody('copy_quotation'),
    /v_src\.contact_id, v_src\.attention_name, v_src\.attention_number, v_src\.attention_email,\s+v_src\.daily_hours, v_src\.monthly_days, v_src\.monthly_hours/,
  )
  assert.match(functionBody('delete_quotation'), /attention, hours\s+\)/)
  const view = MIGRATION.slice(
    MIGRATION.indexOf('CREATE OR REPLACE VIEW public.quotation_list'),
  )
  assert.match(
    view,
    /^CREATE OR REPLACE VIEW public\.quotation_list\s+WITH \(security_invoker = true\)/,
  )
  assert.match(
    view,
    /ln\.type_names,\s+q\.contact_id,\s+q\.attention_name,\s+q\.attention_number,\s+q\.attention_email,\s+q\.daily_hours,\s+q\.monthly_days,\s+q\.monthly_hours\s+FROM public\.quotations q/,
  )
  assert.match(MIGRATION, /NOTIFY pgrst, 'reload schema';\s*$/)
})

// --- The pure rules ------------------------------------------------------------

test('the working hours: defaults, the product, the bounds', () => {
  const q = load('lib/quotations')
  assert.deepEqual(
    { ...q.QUOTATION_DEFAULT_HOURS },
    { daily_hours: '10', monthly_days: '26', monthly_hours: '260' },
  )
  assert.equal(q.quotationMonthlyHoursOf('10', '26'), '260')
  assert.equal(q.quotationMonthlyHoursOf('8', '30'), '240')
  assert.equal(q.quotationMonthlyHoursOf('8.5', '26'), '221')
  assert.equal(q.quotationMonthlyHoursOf('١٠', '٢٦'), '260')
  assert.equal(q.quotationMonthlyHoursOf('', '26'), '')
  assert.equal(q.quotationMonthlyHoursOf('x', '26'), '')
  for (const ok of ['10', '8.5', '24', '0.25', '١٠'])
    assert.equal(q.isValidDailyHours(ok), true, ok)
  for (const bad of ['', '0', '25', '-1', '8.125', 'x'])
    assert.equal(q.isValidDailyHours(bad), false, bad)
  for (const ok of ['1', '26', '31'])
    assert.equal(q.isValidMonthlyDays(ok), true)
  for (const bad of ['', '0', '32', '26.5', 'x'])
    assert.equal(q.isValidMonthlyDays(bad), false, bad)
  for (const ok of ['260', '744', '221.5'])
    assert.equal(q.isValidMonthlyHours(ok), true)
  for (const bad of ['', '0', '745', '1.234'])
    assert.equal(q.isValidMonthlyHours(bad), false, bad)
  assert.deepEqual(
    q.quotationHoursPayload({
      daily_hours: ' 8.5 ',
      monthly_days: '٢٦',
      monthly_hours: '221',
    }),
    { daily_hours: 8.5, monthly_days: 26, monthly_hours: 221 },
  )
  assert.equal(q.quotationHoursText('10.00'), '10')
  assert.equal(q.quotationHoursText(8.5), '8.5')
  assert.equal(q.quotationHoursText(null), '')
  // The schema reports each number under its own field.
  const v = load('lib/formValidation')
  const form = (patch) => ({
    company_id: 'c1',
    project_id: '',
    issue_date: '2026-11-19',
    valid_until: '2026-12-19',
    notes: '',
    lines: [
      {
        equipment_type: 'حفار',
        daily_price: '',
        monthly_price: '18000',
        mob_demob_price: '',
        note: '',
      },
    ],
    costs: [],
    term_template_ids: [],
    keep_term_ids: [],
    attention: null,
    daily_hours: '10',
    monthly_days: '26',
    monthly_hours: '260',
    ...patch,
  })
  assert.equal(v.quotationFormHasErrors(v.quotationFormErrors(form({}))), false)
  assert.equal(
    v.quotationFormErrors(form({ daily_hours: '30' })).fields.daily_hours,
    'quotationErrDailyHours',
  )
  assert.equal(
    v.quotationFormErrors(form({ monthly_days: '26.5' })).fields.monthly_days,
    'quotationErrMonthlyDays',
  )
  assert.equal(
    v.quotationFormErrors(form({ monthly_hours: '' })).fields.monthly_hours,
    'quotationErrMonthlyHours',
  )
  const printLib = load('lib/quotationPrint')
  assert.deepEqual(
    printLib.quotationWorkingHoursOf({
      daily_hours: '8.50',
      monthly_days: 30,
      monthly_hours: '255.00',
    }),
    { dailyHours: 8.5, monthlyDays: 30, monthlyHours: 255 },
  )
  // A row without hours (read before 0204) prints the standard month.
  assert.deepEqual(printLib.quotationWorkingHoursOf({}), {
    dailyHours: 10,
    monthlyDays: 26,
    monthlyHours: 260,
  })
})

test('«عناية»: the copy of a row, and what the save sends', () => {
  const q = load('lib/quotations')
  assert.equal(
    q.quotationAttentionOf({
      contact_id: null,
      attention_name: null,
      attention_number: '055',
      attention_email: null,
    }),
    null,
  )
  assert.deepEqual(
    q.quotationAttentionOf({
      contact_id: 'p1',
      attention_name: ' خالد ',
      attention_number: '055',
      attention_email: null,
    }),
    { contact_id: 'p1', name: 'خالد', contact_number: '055', email: null },
  )
  // No «عناية»: an EMPTY object, which clears it (SQL NULL would keep it).
  assert.deepEqual(q.quotationAttentionPayload(null), {})
  assert.deepEqual(
    q.quotationAttentionPayload({
      contact_id: 'p1',
      name: '  ',
      contact_number: null,
      email: null,
    }),
    {},
  )
  assert.deepEqual(
    q.quotationAttentionPayload({
      contact_id: 'p1',
      name: ' خالد ',
      contact_number: ' 055 ',
      email: '  ',
    }),
    { contact_id: 'p1', name: 'خالد', contact_number: '055', email: null },
  )
  // A refusal of either names its field.
  const rules = q.QUOTATION_FIELD_RULES
  assert.deepEqual(
    rules
      .filter((rule) => /invalid_(attention|hours)/.test(String(rule.match)))
      .map((rule) => [rule.match, rule.field, rule.key]),
    [
      ['invalid_attention', 'attention', 'quotationErrInvalidAttention'],
      ['invalid_hours', 'daily_hours', 'quotationErrInvalidHours'],
    ],
  )
  const data = read('src', 'lib', 'quotationsData.ts')
  assert.match(
    data,
    /p_attention: quotationAttentionPayload\(values\.attention\),\s+p_hours: quotationHoursPayload\(values\),/,
  )
})

test('a person: the form rules and the refusals', () => {
  const c = load('lib/companyContacts')
  const form = (patch) => ({ ...c.EMPTY_COMPANY_CONTACT_FORM, ...patch })
  assert.deepEqual(c.companyContactFormErrors(form({ name: 'خالد' })), {})
  assert.equal(
    c.companyContactFormErrors(form({ name: '  ' })).name,
    'companyContactNameRequired',
  )
  assert.equal(
    c.companyContactFormErrors(form({ name: 'x'.repeat(121) })).name,
    'companyContactNameTooLong',
  )
  assert.equal(
    c.companyContactFormErrors(
      form({ name: 'a', contact_number: '1'.repeat(31) }),
    ).contact_number,
    'companyContactNumberTooLong',
  )
  assert.equal(
    c.companyContactFormErrors(form({ name: 'a', email: 'nope' })).email,
    'companyContactEmailInvalid',
  )
  assert.deepEqual(
    c.companyContactFormErrors(form({ name: 'a', email: ' a@b.co ' })),
    {},
  )
  // The tokens of save_company_contact / delete_company_contact.
  assert.deepEqual(c.companyContactErrorOutcome({ message: 'invalid_email' }), {
    fieldErrors: { email: 'companyContactEmailInvalid' },
  })
  assert.deepEqual(
    c.companyContactErrorOutcome({ message: 'invalid_project' }),
    { fieldErrors: { project_ids: 'companyContactErrProject' } },
  )
  assert.deepEqual(
    c.companyContactErrorOutcome({
      message: 'company_contacts_manage_required',
    }),
    { message: 'companyContactErrManage' },
  )
  assert.deepEqual(
    c.companyContactErrorOutcome({ message: 'invalid_contact' }),
    {
      message: 'companyContactErrNotFound',
    },
  )
  // Never the raw error.
  assert.deepEqual(
    c.companyContactErrorOutcome({ message: 'relation "x" does not exist' }),
    { message: 'companyContactSaveFailed' },
  )
  assert.deepEqual(
    c.companyContactSummary({ contact_number: '055', email: null }),
    ['055'],
  )
})

// --- The screens ---------------------------------------------------------------

test('the persons are read by the company alone and written by the functions', () => {
  const data = read('src', 'lib', 'companyContactsData.ts')
  assert.deepEqual(
    [...data.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map((match) => match[1]),
    ['save_company_contact', 'delete_company_contact'],
  )
  // «الفلتر يكون حسب الشركة مبدئيا»: no project filter on the read.
  assert.match(data, /\.eq\('company_id', companyId\)/)
  assert.doesNotMatch(data, /\.eq\('project_id'|\.in\('project_id'/)
  assert.match(data, /\.limit\(COMPANY_CONTACTS_LIMIT\)/)
  // A failed read throws: an error state, never «no persons».
  assert.match(
    data,
    /if \(error\) throw new Error\('company_contacts_load_failed'\)/,
  )
  assert.doesNotMatch(data, /\.insert\(|\.update\(|\.delete\(/)
})

test('the quotation form: «عناية» from the client’s persons, and the hours', () => {
  const form = read('src', 'components', 'sales', 'QuotationFormDialog.tsx')
  // Another client drops the old «عناية» and reads its own persons.
  assert.match(
    form,
    /if \(value === companyId\) return\s+\/\/[^\n]*\n\s+setAttention\(null\)\s+clearField\('attention'\)\s+void loadContacts\(value, true\)/,
  )
  // A company with exactly one person gets it at once.
  assert.match(
    form,
    /if \(pickOnly && rows\.length === 1\) setAttention\(attentionOf\(rows\[0\]\)\)/,
  )
  // A new person is added from the field and chosen at once.
  assert.match(
    form,
    /createLabel=\{t\('companyContactAdd'\)\}\s+alwaysShowCreate/,
  )
  assert.match(
    form,
    /<CompanyContactFormDialog[\s\S]*?companyId=\{companyId\}[\s\S]*?setAttention\(\{\s+contact_id: id,/,
  )
  // A stored copy whose person is gone stays selectable.
  assert.match(form, /const STORED_ATTENTION = '__stored__'/)
  assert.match(form, /if \(value === STORED_ATTENTION\) return/)
  // The monthly hours follow daily × days until the user types them.
  assert.match(
    form,
    /if \(field !== 'monthly_hours' && !monthlyTouched\)\s+next\.monthly_hours = quotationMonthlyHoursOf\(/,
  )
  assert.match(
    form,
    /if \(field === 'monthly_hours'\) setMonthlyTouched\(true\)/,
  )
  assert.match(form, /setHours\(\{ \.\.\.QUOTATION_DEFAULT_HOURS \}\)/)
})

test('the company dialogs list the persons; the page shows the copy', () => {
  const formDialog = read(
    'src',
    'screens',
    'companies',
    'CompanyFormDialog.tsx',
  )
  // A saved client only (a new one has no id yet).
  assert.match(
    formDialog,
    /\{company && \(\s+<CompanyContactsSection\s+key=\{`contacts-\$\{company\.id\}`\}\s+companyId=\{company\.id\}\s+canEdit=\{canSave\}/,
  )
  assert.match(
    read('src', 'screens', 'companies', 'CompanyDetailsDialog.tsx'),
    /<CompanyContactsSection[\s\S]*?canEdit=\{canEditDocuments\}/,
  )
  const section = read(
    'src',
    'components',
    'companies',
    'CompanyContactsSection.tsx',
  )
  assert.match(section, /state === 'error' \? \(\s+<ErrorState/)
  assert.match(section, /await confirm\(\{/)
  const page = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
  assert.match(page, /const attention = quotationAttentionOf\(quotation\)/)
  assert.match(page, /\{t\('quotationHoursTitle'\)\}/)
})

test('the translations: both languages, plain alif', () => {
  const { translations } = load('i18n/translations')
  const keys = Object.keys(translations.ar).filter((key) =>
    /^(companyContact|quotationAttention|quotationHours|quotationDailyHours|quotationMonthly|quotationErrDailyHours|quotationErrMonthly|quotationErrInvalid(Attention|Hours))/.test(
      key,
    ),
  )
  assert.ok(keys.length >= 40, String(keys.length))
  for (const key of keys) {
    assert.equal(typeof translations.en[key], 'string', `en.${key}`)
    assert.doesNotMatch(translations.ar[key], HAMZA_ALIF, key)
  }
  assert.equal(translations.ar.quotationAttention, 'عناية')
  assert.equal(translations.ar.companyContactsTitle, 'الاشخاص المسؤولون')
  assert.equal(translations.ar.companyContactAdd, 'اضافة شخص مسؤول')
})
