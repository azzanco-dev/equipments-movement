const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// src/lib/companyForm.ts only has type-only imports, so it loads on its own.
function loadCompanyForm() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'companyForm.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const companyForm = loadCompanyForm()
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const base = () => plain(companyForm.EMPTY_COMPANY_FORM)

test('both the Arabic and English names are mandatory', () => {
  assert.equal(
    companyForm.validateCompanyForm(base()),
    'companyValidationError',
  )
  assert.equal(
    companyForm.validateCompanyForm({ ...base(), name_ar: 'شركة العزاني' }),
    'companyValidationError',
  )
  assert.equal(
    companyForm.validateCompanyForm({
      ...base(),
      name_ar: '  ',
      name_en: 'Azani Co.',
    }),
    'companyValidationError',
  )
  assert.equal(
    companyForm.validateCompanyForm({
      name_ar: 'شركة العزاني',
      name_en: 'Azani Co.',
    }),
    null,
  )
})

test('the payload trims both names', () => {
  const payload = plain(
    companyForm.buildCompanyPayload({
      name_ar: '  شركة العزاني  ',
      name_en: '  Azani Co.  ',
    }),
  )
  assert.deepEqual(payload, {
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
  assert.deepEqual(values, {
    name_ar: 'شركة العزاني',
    name_en: 'Azani Co.',
  })
})
