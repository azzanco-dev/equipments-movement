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

const driverForm = loadLibModule('driverForm')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)
const base = () => plain(driverForm.EMPTY_DRIVER_FORM)

test('only the full name is mandatory', () => {
  assertErrors(driverForm.validateDriverForm(base()), {
    full_name: 'fullNameRequired',
  })
  assertErrors(driverForm.validateDriverForm({ ...base(), full_name: '  ' }), {
    full_name: 'fullNameRequired',
  })
  assertErrors(
    driverForm.validateDriverForm({ ...base(), full_name: 'احمد محمد' }),
    {},
  )
})

test('an id or mobile number is validated only when it is filled in', () => {
  const named = { ...base(), full_name: 'احمد' }
  assertErrors(driverForm.validateDriverForm({ ...named, id_number: '' }), {})
  assertErrors(driverForm.validateDriverForm({ ...named, id_number: '123' }), {
    id_number: 'idNumberFormatInvalid',
  })
  assertErrors(
    driverForm.validateDriverForm({ ...named, id_number: '1023456789' }),
    {},
  )
  assertErrors(
    driverForm.validateDriverForm({ ...named, mobile_number: '12345' }),
    { mobile_number: 'mobileNumberFormatInvalid' },
  )
  assertErrors(
    driverForm.validateDriverForm({ ...named, mobile_number: '+966500000000' }),
    {},
  )
})

test('every broken rule is reported at once, one message per field', () => {
  assertErrors(
    driverForm.validateDriverForm({
      ...base(),
      id_number: '12',
      mobile_number: '99',
    }),
    {
      full_name: 'fullNameRequired',
      id_number: 'idNumberFormatInvalid',
      mobile_number: 'mobileNumberFormatInvalid',
    },
  )
})

test('quick create asks for the full name and a valid mobile number', () => {
  assertErrors(
    driverForm.validateQuickDriverForm({ fullName: '', mobile: '' }),
    { fullName: 'fullNameRequired', mobile: 'mobileNumberRequired' },
  )
  assertErrors(
    driverForm.validateQuickDriverForm({ fullName: 'احمد', mobile: '123' }),
    { mobile: 'mobileNumberFormatInvalid' },
  )
  assertErrors(
    driverForm.validateQuickDriverForm({
      fullName: 'احمد',
      mobile: '0500000000',
    }),
    {},
  )
})

test('a duplicate mobile or id number is attributed to that field', () => {
  assertErrors(
    driverForm.driverSaveFieldErrors({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "drivers_mobile_number_unique"',
    }),
    { mobile_number: 'mobileExists' },
  )
  assert.equal(
    driverForm.driverSaveFieldErrors({ code: '23505', message: 'other' }),
    null,
  )
})

test('the id keeps digits only and the mobile keeps a single leading plus', () => {
  assert.equal(driverForm.sanitizeIdNumber('10-234 56a789'), '1023456789')
  assert.equal(
    driverForm.sanitizeMobileNumber('+966 50-000+0000'),
    '+966500000000',
  )
  assert.equal(driverForm.sanitizeMobileNumber('05x00'), '0500')
})

test('the payload trims text and turns empty optional fields into null', () => {
  const payload = plain(
    driverForm.buildDriverPayload({
      full_name: '  احمد محمد  ',
      name_en: '  Ahmed  ',
      id_number: '1023456789',
      mobile_number: '',
      nationality: '',
      employment_type: '',
      job_title: '  سائق  ',
    }),
  )
  assertErrors(payload, {
    full_name: 'احمد محمد',
    name_en: 'Ahmed',
    id_number: '1023456789',
    mobile_number: null,
    nationality: null,
    employment_type: null,
    job_title: 'سائق',
  })
})

test('a record maps onto the form with nulls turned into empty strings', () => {
  const values = plain(
    driverForm.driverFormValues({
      id: 'driver-1',
      full_name: 'احمد',
      name_en: null,
      id_number: null,
      mobile_number: '0500000000',
      nationality: null,
      employment_type: null,
      job_title: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }),
  )
  assertErrors(values, {
    full_name: 'احمد',
    name_en: '',
    id_number: '',
    mobile_number: '0500000000',
    nationality: '',
    employment_type: '',
    job_title: '',
  })
})
