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
  employer_name: 'صاحب عمل تجريبي',
  email: 'driver@example.com',
  gender: 'Male',
  mobile_number: '0500000000',
  employment_type: 'العزاني',
  company: 'شركة تجريبية',
  date_of_joining: '2026-09-17',
  department: 'النقل',
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
  process.env.ERPNEXT_EMPLOYER_NAME_FIELD = 'custom_sponsor_name'
  const availableFields = new Set([
    'custom_employee_name_en',
    'custom_nationality',
    'custom_residence_permit_number',
    'custom_rp_valid_upto',
  ])
  const payload = erpEmployeePayload(data, availableFields)
  assert.equal(payload.custom_rp_valid_upto, data.residence_expiry_date)
  assert.equal(payload.custom_nationality, data.nationality)
  assert.equal(payload.user_id, data.email)
  assert.ok(!('custom_sponsor_name' in payload))
  assert.ok(!('custom_employer_name' in payload))
  assert.ok(!('custom_rp_date_of_issue' in payload))
  delete process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD
  delete process.env.ERPNEXT_EMPLOYER_NAME_FIELD
})
