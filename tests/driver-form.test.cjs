const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// src/lib/driverForm.ts only has type-only imports, so it loads on its own.
function loadDriverForm() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'driverForm.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const driverForm = loadDriverForm()
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const base = () => plain(driverForm.EMPTY_DRIVER_FORM)

test('only the full name is mandatory', () => {
  assert.equal(driverForm.validateDriverForm(base()), 'driverValidationError')
  assert.equal(
    driverForm.validateDriverForm({ ...base(), full_name: '  ' }),
    'driverValidationError',
  )
  assert.equal(
    driverForm.validateDriverForm({ ...base(), full_name: 'احمد محمد' }),
    null,
  )
})

test('an id or mobile number is validated only when it is filled in', () => {
  const named = { ...base(), full_name: 'احمد' }
  assert.equal(driverForm.validateDriverForm({ ...named, id_number: '' }), null)
  assert.equal(
    driverForm.validateDriverForm({ ...named, id_number: '123' }),
    'driverValidationError',
  )
  assert.equal(
    driverForm.validateDriverForm({ ...named, id_number: '1023456789' }),
    null,
  )
  assert.equal(
    driverForm.validateDriverForm({ ...named, mobile_number: '12345' }),
    'driverValidationError',
  )
  assert.equal(
    driverForm.validateDriverForm({ ...named, mobile_number: '+966500000000' }),
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
  assert.deepEqual(payload, {
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
  assert.deepEqual(values, {
    full_name: 'احمد',
    name_en: '',
    id_number: '',
    mobile_number: '0500000000',
    nationality: '',
    employment_type: '',
    job_title: '',
  })
})
