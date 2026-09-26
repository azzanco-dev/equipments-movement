const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadExtractingModule } = require('./helpers/loadExtracting.cjs')

const {
  parsePublishRequest,
  missingErpFields,
  currentSystemDriverPayload,
  erpUserPayload,
  erpEmployeePayload,
  erpErrorDetails,
} = loadExtractingModule('publish')
const { validateExtractionForm, applyFormPatch, createDefaultForm } =
  loadExtractingModule('form')

const data = {
  full_name_ar: 'اسم عربي كامل',
  full_name_en: 'FULL ENGLISH NAME',
  id_number: '2554398733',
  date_of_birth: '2000-05-02',
  residence_expiry_date: '2026-07-31',
  nationality: 'اليمن',
  occupation: 'سائق شاحنة ثقيلة',
  email: 'driver@example.com',
  gender: 'Male',
  language: 'en',
  mobile_number: '0500000000',
  employment_type: 'العزاني',
  company: 'شركة تجريبية',
  date_of_joining: '2026-09-17',
  department: 'النقل',
  ctc: '3500.50',
  employee_number: '2554398733',
}

test('requires a selected target and a numeric identity', () => {
  assert.equal(
    parsePublishRequest({ data, targets: { currentSystem: false } }),
    null,
  )
  assert.equal(
    parsePublishRequest({
      data: { ...data, id_number: '12A' },
      targets: { currentSystem: true },
    }),
    null,
  )
  assert.ok(parsePublishRequest({ data, targets: { currentSystem: true } }))
})

test('converts visible day-month-year dates for publishing', () => {
  const parsed = parsePublishRequest({
    data: {
      ...data,
      date_of_birth: '02-05-2000',
      residence_expiry_date: '31-07-2026',
      date_of_joining: '17-09-2026',
      employee_number: '',
    },
    targets: { erpnext: true },
  })
  assert.equal(parsed.data.date_of_birth, '2000-05-02')
  assert.equal(parsed.data.residence_expiry_date, '2026-07-31')
  assert.equal(parsed.data.date_of_joining, '2026-09-17')
  assert.equal(parsed.data.employee_number, data.id_number)
})

test('local payload only contains columns that already exist', () => {
  assert.deepEqual(Object.keys(currentSystemDriverPayload(data)).sort(), [
    'employment_type',
    'full_name',
    'id_number',
    'job_title',
    'mobile_number',
    'name_en',
    'nationality',
  ])
})

test('ERP user is created from the reviewed identity data', () => {
  const payload = erpUserPayload(data)
  assert.equal(payload.email, data.email)
  assert.equal(payload.first_name, data.full_name_ar)
  assert.equal(payload.username, data.id_number)
  assert.equal(payload.language, 'en')
  assert.equal(payload.send_welcome_email, 0)
})

test('only Arabic and English user languages are accepted', () => {
  assert.equal(
    parsePublishRequest({
      data: { ...data, language: 'fr' },
      targets: { erpnext: true },
    }),
    null,
  )
  assert.equal(
    parsePublishRequest({
      data: { ...data, language: 'ar' },
      targets: { erpnext: true },
    }).data.language,
    'ar',
  )
})

test('ERP user errors expose useful messages without HTML or tokens', () => {
  const details = erpErrorDetails(
    {
      _server_messages: JSON.stringify([
        JSON.stringify({
          message: '<b>Role Profile Driver does not exist</b> token key:secret',
        }),
      ]),
    },
    417,
  )
  assert.equal(details, 'Role Profile Driver does not exist token [محجوب]')
  assert.equal(erpErrorDetails(undefined, 500), 'ERPNext HTTP 500')
})

test('ERP employee never writes expiry into issue date', () => {
  process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD =
    'custom_residence_permit_expiry_date'
  const availableFields = new Set([
    'custom_employee_name_en',
    'custom_nationality',
    'custom_residence_permit_number',
    'custom_rp_valid_upto',
    'ctc',
    'employee_number',
  ])
  const payload = erpEmployeePayload(data, availableFields)
  assert.equal(payload.custom_rp_valid_upto, data.residence_expiry_date)
  assert.equal(payload.custom_nationality, data.nationality)
  assert.equal(payload.user_id, data.email)
  assert.equal(payload.status, 'Inactive')
  assert.equal(payload.cell_number, data.mobile_number)
  assert.equal(payload.ctc, data.ctc)
  assert.equal(payload.employee_number, data.id_number)
  assert.ok(!('custom_rp_date_of_issue' in payload))
  delete process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD
})

test('the browser form reports each invalid field with a specific code', () => {
  const form = {
    ...createDefaultForm('26-09-2026'),
    full_name_ar: 'اسم',
    id_number: '12A',
    email: 'bad-email',
    mobile_number: '05',
    ctc: '1.234',
    date_of_birth: '31-02-2000',
  }
  const errors = validateExtractionForm(form, {
    currentSystem: true,
    erpnext: true,
  })
  assert.equal(errors.id_number, 'invalid_id_number')
  assert.equal(errors.email, 'invalid_email')
  assert.equal(errors.mobile_number, 'invalid_mobile')
  assert.equal(errors.ctc, 'invalid_ctc')
  assert.equal(errors.date_of_birth, 'invalid_date')
  assert.equal(errors.nationality, 'required')
  assert.equal(
    validateExtractionForm(form, { currentSystem: true, erpnext: false })
      .nationality,
    undefined,
  )
})

test('ERP-only required fields fail the ERPNext target, not the request', () => {
  const parsed = parsePublishRequest({
    data: { ...data, email: '', nationality: '' },
    targets: { currentSystem: true, erpnext: true },
  })
  assert.ok(parsed)
  assert.equal(missingErpFields(parsed.data).join(','), 'email,nationality')
})

test('the employee number follows the identity until edited', () => {
  let form = createDefaultForm('26-09-2026')
  form = applyFormPatch(form, { id_number: '123456' })
  assert.equal(form.employee_number, '123456')
  form = applyFormPatch(form, { employee_number: 'E-9' })
  form = applyFormPatch(form, { id_number: '654321' })
  assert.equal(form.employee_number, 'E-9')
})
