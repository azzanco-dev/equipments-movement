const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the helpers are exercised exactly as the dialog uses them. Type-only
// imports (`@/i18n`, `@/components/ui`) are erased by the transpile step.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
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
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const companyForm = loadLibModule('companyForm')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)
const base = () => plain(companyForm.EMPTY_COMPANY_FORM)

test('both the Arabic and English names are mandatory', () => {
  assertErrors(companyForm.validateCompanyForm(base()), {
    name_ar: 'companyNameArRequired',
    name_en: 'companyNameEnRequired',
  })
  assertErrors(
    companyForm.validateCompanyForm({ ...base(), name_ar: 'شركة العزاني' }),
    { name_en: 'companyNameEnRequired' },
  )
  assertErrors(
    companyForm.validateCompanyForm({
      ...base(),
      name_ar: '  ',
      name_en: 'Azani Co.',
    }),
    { name_ar: 'companyNameArRequired' },
  )
  assertErrors(
    companyForm.validateCompanyForm({
      name_ar: 'شركة العزاني',
      name_en: 'Azani Co.',
    }),
    {},
  )
})

test('a duplicate name is attributed to the name that caused it', () => {
  assertErrors(
    companyForm.companySaveFieldErrors({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "idx_companies_name_en"',
    }),
    { name_en: 'duplicateCompany' },
  )
  assert.equal(companyForm.companySaveFieldErrors({ code: '42501' }), null)
})

test('the payload trims both names', () => {
  const payload = plain(
    companyForm.buildCompanyPayload({
      name_ar: '  شركة العزاني  ',
      name_en: '  Azani Co.  ',
    }),
  )
  assertErrors(payload, {
    name_ar: 'شركة العزاني',
    name_en: 'Azani Co.',
  })
})

test('a record maps onto the form as-is', () => {
  const values = plain(
    companyForm.companyFormValues({
      id: 'company-1',
      name_ar: 'شركة العزاني',
      name_en: 'Azani Co.',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }),
  )
  assertErrors(values, {
    name_ar: 'شركة العزاني',
    name_en: 'Azani Co.',
  })
})
