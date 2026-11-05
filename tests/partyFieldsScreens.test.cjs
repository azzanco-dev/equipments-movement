const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// EM-260 (0175): the supplier and client screens — the form schemas and the
// database-error map, the list search, the Excel import headers and checks,
// the details dialogs, the PO PDF lines and the new copy.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

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

const cache = new Map()
const lessorForm = loadLibModule('lessorForm', cache)
const companyForm = loadLibModule('companyForm', cache)
const partyImport = loadLibModule('partyImport', cache)
const party = loadLibModule('partyFields', cache)
const search = loadLibModule('search', cache)
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const lessor = (patch) => ({
  ...plain(lessorForm.EMPTY_LESSOR_FORM),
  name: 'مؤسسة النقل',
  ...patch,
})
const company = (patch) => ({
  ...plain(companyForm.EMPTY_COMPANY_FORM),
  name_ar: 'شركة العزاني',
  name_en: 'Azani Co.',
  ...patch,
})

test('every new field is optional; the shapes are messages under the field', () => {
  assert.deepEqual(plain(lessorForm.validateLessorForm(lessor({}))), {})
  assert.deepEqual(plain(companyForm.validateCompanyForm(company({}))), {})
  // Spaces, dashes and Arabic-Indic digits are fine: the trigger strips them.
  assert.deepEqual(
    plain(
      lessorForm.validateLessorForm(
        lessor({
          tax_number: '300-000-000-000-003',
          commercial_register: '١٠١٠ ١٢٣ ٤٥٦',
          iban: 'sa03 8000 0000 6080 1016 7519',
          email: 'Info@Example.com',
          bank_name: 'مصرف الراجحي',
        }),
      ),
    ),
    {},
  )
  assert.deepEqual(
    plain(
      lessorForm.validateLessorForm(
        lessor({
          tax_number: '12345',
          commercial_register: '12',
          iban: 'GB00 1234',
          email: 'no-at-sign',
          bank_name: 'x'.repeat(101),
        }),
      ),
    ),
    {
      tax_number: 'taxNumberFormatInvalid',
      commercial_register: 'commercialRegisterFormatInvalid',
      email: 'emailFormatInvalid',
      bank_name: 'bankNameTooLong',
      iban: 'ibanFormatInvalid',
    },
  )
  assert.deepEqual(
    plain(
      companyForm.validateCompanyForm(
        company({ contact_number: '0'.repeat(31), city: 'x'.repeat(61) }),
      ),
    ),
    { contact_number: 'contactNumberTooLong', city: 'cityTooLong' },
  )
})

test('the payload is normalised as the trigger stores it', () => {
  const payload = plain(
    lessorForm.buildLessorPayload(
      lessor({
        tax_number: ' 300 000 000 000 003 ',
        iban: 'sa03-8000 0000 6080 1016 7519',
        email: ' Info@Example.COM ',
        bank_name: '  ',
      }),
    ),
  )
  assert.equal(payload.tax_number, '300000000000003')
  assert.equal(payload.iban, 'SA0380000000608010167519')
  assert.equal(payload.email, 'info@example.com')
  assert.equal(payload.bank_name, null)
  assert.equal(party.formatIban(payload.iban), 'SA03 8000 0000 6080 1016 7519')
})

test('a refused save names its field: duplicates and CHECKs of both tables', () => {
  assert.deepEqual(
    plain(
      lessorForm.lessorSaveFieldErrors({
        code: '23505',
        message: 'duplicate key value violates unique constraint "lessors_tax_number_unique"',
      }),
    ),
    { tax_number: 'taxNumberExistsLessor' },
  )
  assert.deepEqual(
    plain(
      lessorForm.lessorSaveFieldErrors({
        code: '23514',
        message: 'new row violates check constraint "lessors_iban_check"',
      }),
    ),
    { iban: 'ibanFormatInvalid' },
  )
  assert.deepEqual(
    plain(
      companyForm.companySaveFieldErrors({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "companies_commercial_register_unique"',
      }),
    ),
    { commercial_register: 'commercialRegisterExistsCompany' },
  )
  // The name rules of 0009 still win for a name.
  assert.deepEqual(
    plain(
      companyForm.companySaveFieldErrors({
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_companies_name_ar"',
      }),
    ),
    { name_ar: 'duplicateCompany' },
  )
  assert.equal(lessorForm.lessorSaveFieldErrors({ code: '42501' }), null)
})

test('both lists search the two numbers, with no new column', () => {
  assert.deepEqual(
    [...search.LESSOR_SEARCH_FIELDS],
    ['name_search', 'contact_person_search', 'contact_number', 'tax_number', 'commercial_register'],
  )
  assert.deepEqual(
    [...search.COMPANY_SEARCH_FIELDS],
    ['name_ar_search', 'name_en', 'tax_number', 'commercial_register'],
  )
  // The selectors and the projects keep the two names only.
  assert.deepEqual([...search.COMPANY_PROJECT_SEARCH_FIELDS], ['name_ar_search', 'name_en'])
  const configs = read('src', 'lib', 'listConfigs.ts')
  assert.match(configs, /searchFields: \[\.\.\.COMPANY_SEARCH_FIELDS\]/)
  for (const table of ['LessorsTable', 'CompaniesTable']) {
    const dir = table === 'LessorsTable' ? 'lessors' : 'companies'
    assert.doesNotMatch(read('src', 'screens', dir, `${table}.tsx`), /tax_number|iban/, table)
  }
})

test('the list rows carry every field the dialogs save', () => {
  assert.match(
    read('src', 'screens', 'lessors', 'LessorsListScreen.tsx'),
    /'id,name,contact_person,contact_number,tax_number,commercial_register,address,short_address,city,email,bank_name,iban,created_at,updated_at'/,
  )
  assert.match(
    read('src', 'screens', 'companies', 'CompaniesListScreen.tsx'),
    /'id,name_ar,name_en,tax_number,commercial_register,address,short_address,city,email,contact_person,contact_number,created_at,updated_at'/,
  )
})

const t = (key) => key
const normalizeKey = (key) => key.trim().toLowerCase().replace(/[\s_-]+/g, '_')

test('the import headers: Arabic, English, raw keys and the form labels', () => {
  const headers = partyImport.matchPartyHeaders(
    ['الرقم الضريبي', 'CR Number', 'العنوان', 'city', 'البريد', 'اسم البنك', 'IBAN', 'جهة الاتصال', 'الجوال', 'unrelated'],
    partyImport.LESSOR_IMPORT_PARTY_FIELDS,
    t,
    normalizeKey,
  )
  assert.deepEqual(plain(headers), {
    tax_number: 'الرقم الضريبي',
    commercial_register: 'CR Number',
    address: 'العنوان',
    // No city column since the owner took the city out (2026-11-05).
    email: 'البريد',
    bank_name: 'اسم البنك',
    iban: 'IBAN',
    contact_person: 'جهة الاتصال',
    contact_number: 'الجوال',
  })
  // The client import never takes a bank column.
  assert.deepEqual(
    plain(partyImport.matchPartyHeaders(['iban', 'bank'], partyImport.COMPANY_IMPORT_PARTY_FIELDS, t, normalizeKey)),
    {},
  )
})

test('an import row is normalised and a bad cell names its message', () => {
  const errors = []
  const values = partyImport.readPartyValues(
    { a: '300-000-000-000-003', b: '12', c: 'sa03 8000 0000 6080 1016 7519', d: '' },
    { tax_number: 'a', commercial_register: 'b', iban: 'c', email: 'd' },
    ['tax_number', 'commercial_register', 'iban', 'email'],
    t,
    errors,
  )
  assert.deepEqual(plain(values), {
    tax_number: '300000000000003',
    commercial_register: '12',
    iban: 'SA0380000000608010167519',
    email: null,
  })
  assert.deepEqual(errors, ['commercialRegisterFormatInvalid'])
  assert.deepEqual(
    plain(partyImport.partyImportPayload(values, ['tax_number', 'email', 'iban'])),
    { tax_number: '300000000000003', iban: 'SA0380000000608010167519' },
  )
})

test('a tax number or CR already stored or repeated in the file is marked', () => {
  const rows = [
    { tax_number: '300000000000003', commercial_register: null, _errors: [] },
    { tax_number: '300000000000003', commercial_register: '1010', _errors: [] },
    { tax_number: null, commercial_register: '2020', _errors: [] },
  ]
  partyImport.markPartyDuplicates(
    rows,
    { tax_number: new Set(), commercial_register: new Set(['2020']) },
    t,
  )
  assert.deepEqual(
    rows.map((row) => row._errors),
    [[], ['taxNumberDuplicate'], ['commercialRegisterDuplicate']],
  )
  assert.deepEqual(plain(partyImport.partyNumbersOf(rows)), {
    tax_number: ['300000000000003'],
    commercial_register: ['1010', '2020'],
  })
})

test('both imports read the optional columns and check the stored numbers', () => {
  const excel = read('src', 'lib', 'excel.ts')
  assert.match(excel, /export function parseLessorsExcel\(/)
  assert.match(excel, /export function downloadLessorTemplate\(/)
  assert.match(excel, /matchPartyHeaders\([\s\S]*?COMPANY_IMPORT_PARTY_FIELDS/)
  for (const [file, table, fields] of [
    [['src', 'screens', 'companies', 'CompanyImportDialog.tsx'], 'companies', 'COMPANY_IMPORT_PARTY_FIELDS'],
    [['src', 'screens', 'lessors', 'LessorImportDialog.tsx'], 'lessors', 'LESSOR_IMPORT_PARTY_FIELDS'],
  ]) {
    const source = read(...file)
    assert.match(source, new RegExp(`fetchTakenPartyNumbers\\('${table}'`), table)
    assert.match(source, /markPartyDuplicates\(/, table)
    assert.match(source, new RegExp(`partyImportPayload\\(\\w+, ${fields}\\)`), table)
  }
})

test('the details dialogs show the facts; the forms carry the sections', () => {
  const lessorDetails = read('src', 'screens', 'lessors', 'LessorDetailsDialog.tsx')
  for (const key of ['partyOfficialSection', 'partyContactSection', 'partyBankSection', 'formatIban'])
    assert.match(lessorDetails, new RegExp(key))
  assert.doesNotMatch(read('src', 'screens', 'companies', 'CompanyDetailsDialog.tsx'), /iban|bank/i)
  for (const dialog of [
    ['src', 'screens', 'lessors', 'LessorFormDialog.tsx'],
    ['src', 'screens', 'companies', 'CompanyFormDialog.tsx'],
  ]) {
    const source = read(...dialog)
    assert.match(source, /title="partyOfficialSection"/)
    assert.match(source, /title="partyContactSection"/)
    assert.match(source, /SaveFieldErrors\(result\.error\)/)
  }
  assert.match(read('src', 'screens', 'lessors', 'LessorFormDialog.tsx'), /title="partyBankSection"/)
})

test('the supplier PO PDF prints the VAT and CR numbers only when set', () => {
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(sheet, /\['supplierPoPrintVatNumber', po\.lessor\?\.tax_number\]/)
  assert.match(sheet, /\['supplierPoPrintCrNumber', po\.lessor\?\.commercial_register\]/)
  assert.match(sheet, /value \? \(/)
  assert.match(
    read('src', 'lib', 'purchasingData.ts'),
    /lessor:lessors\(id,name,tax_number,commercial_register\)/,
  )
})

test('the new copy exists in both languages without hamza or madda on alif', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(/\/\/ party-fields — start[^\n]*\n([\s\S]*?)\/\/ party-fields — end/g),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2)
  const keys = (block) => [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.doesNotMatch(blocks[0], /[أإآ]/)
  for (const key of ['bankName', 'partyBankSection', 'bankNameTooLong', 'iban', 'taxNumber'])
    assert.ok(keys(blocks[0]).includes(key), key)
  for (const placeholder of [
    'البحث باسم الشركة او الرقم الضريبي او الرقم الوطني الموحد',
    'البحث بالاسم او جهة الاتصال او الجوال او الرقم الضريبي او الرقم الوطني الموحد',
  ])
    assert.ok(read('src', 'lib', 'listConfigs.ts').includes(placeholder))
})
