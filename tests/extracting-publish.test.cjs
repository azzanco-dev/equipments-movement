const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadPublishModule() {
  const file = path.join(
    __dirname,
    '..',
    'src',
    'lib',
    'extracting',
    'publish.ts',
  )
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, process }, { filename: file })
  return exports
}

const { parsePublishRequest, currentSystemDriverPayload, erpEmployeePayload } =
  loadPublishModule()

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
  assert.equal(payload.ctc, data.ctc)
  assert.equal(payload.employee_number, data.id_number)
  assert.ok(!('custom_rp_date_of_issue' in payload))
  delete process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD
})
