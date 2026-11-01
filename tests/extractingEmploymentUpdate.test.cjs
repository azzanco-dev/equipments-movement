const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadExtractingModule } = require('./helpers/loadExtracting.cjs')

// Owner 2026-11-01: «في صفحة الاستخراج ضمّن تغيير كلمة المرور، وبيانات
// التوظيف، الشركة نوع التوظيف القسم تاريخ المباشرة الراتب رقم الموظف في حال
// كانت مسجلة في الحقول تبعها».

const {
  parsePublishRequest,
  currentSystemDriverUpdatePayload,
  erpEmployeeUpdatePayload,
  erpUserPasswordUpdate,
} = loadExtractingModule('publish')
const { EMPLOYMENT_UPDATE_FIELDS, parseEmploymentEdited } =
  loadExtractingModule('form')

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

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
  employment_type: 'تكوين',
  company: 'شركة تجريبية',
  date_of_joining: '2026-09-17',
  department: 'النقل',
  ctc: '3500.50',
  employee_number: 'E-77',
}

const availableFields = new Set(['ctc', 'employee_number', 'custom_nationality'])

test('the employment fields are exactly the six the owner named', () => {
  assert.deepEqual([...EMPLOYMENT_UPDATE_FIELDS].sort(), [
    'company',
    'ctc',
    'date_of_joining',
    'department',
    'employee_number',
    'employment_type',
  ])
  // Anything else in the body is dropped.
  assert.deepEqual(
    [...parseEmploymentEdited(['company', 'email', 'status', 'ctc', 7])].sort(),
    ['company', 'ctc'],
  )
  assert.equal(parseEmploymentEdited('company').size, 0)
})

test('update mode writes only the edited employment fields, non-empty', () => {
  const parsed = parsePublishRequest({
    data: { ...data, department: '' },
    targets: { erpnext: true, currentSystem: true },
    mode: 'update',
    employment_edited: ['company', 'ctc', 'department', 'employee_number'],
  })
  assert.deepEqual([...parsed.employmentEdited].sort(), [
    'company',
    'ctc',
    'department',
    'employee_number',
  ])
  const update = erpEmployeeUpdatePayload(
    parsed.data,
    availableFields,
    parsed.employmentEdited,
  )
  assert.equal(update.company, data.company)
  assert.equal(update.ctc, data.ctc)
  assert.equal(update.employee_number, data.employee_number)
  // Edited but empty: never clears the stored value.
  assert.ok(!('department' in update))
  // Not edited: the form's value (a default) is never written.
  assert.ok(!('date_of_joining' in update))
  assert.ok(!('employment_type' in update))
  // Identity fields are still written; account data never.
  assert.equal(update.first_name, data.full_name_ar)
  for (const key of ['status', 'user_id', 'new_password', 'email'])
    assert.ok(!(key in update), key)

  // The driver row takes the employment type only when edited.
  assert.ok(
    !('employment_type' in currentSystemDriverUpdatePayload(parsed.data, parsed.employmentEdited)),
  )
  const typed = parsePublishRequest({
    data,
    targets: { currentSystem: true },
    mode: 'update',
    employment_edited: ['employment_type'],
  })
  assert.equal(
    currentSystemDriverUpdatePayload(typed.data, typed.employmentEdited).employment_type,
    data.employment_type,
  )
})

test('create mode ignores the edited list and keeps writing the whole form', () => {
  const parsed = parsePublishRequest({
    data,
    targets: { erpnext: true },
    employment_edited: ['company'],
  })
  assert.equal(parsed.mode, 'create')
  assert.equal(parsed.employmentEdited.size, 0)
})

test('a typed password becomes the User update, untrimmed; none without one', () => {
  const parsed = parsePublishRequest({
    data: { ...data, password: ' Pass word9 ' },
    targets: { erpnext: true },
    mode: 'update',
  })
  assert.equal(
    JSON.stringify(erpUserPasswordUpdate(parsed.data)),
    JSON.stringify({ new_password: ' Pass word9 ' }),
  )
  const none = parsePublishRequest({ data, targets: { erpnext: true }, mode: 'update' })
  assert.equal(erpUserPasswordUpdate(none.data), null)
})

test('the route, client and hook carry the edited list and the password failure', () => {
  const route = read('app', 'api', 'extracting', 'publish', 'route.ts')
  assert.match(route, /return \{ userId, status: 'updated' as const \}/)
  assert.match(route, /error: 'erp_user_password_failed'/)
  // A user changed here makes a later employee failure partial.
  assert.match(route, /status: user\.status === 'existing' \? 'failed' : 'partial'/)

  const client = read('src', 'lib', 'extracting', 'client.ts')
  assert.match(
    client,
    /\.\.\.\(mode === 'update' \? \{ employment_edited: employmentEdited \} : \{\}\)/,
  )
  const hook = read('src', 'components', 'extracting', 'useExtraction.ts')
  assert.match(hook, /if \(isEmploymentField\(key\) && !employmentEdited\.has\(key\)\)/)
  assert.match(hook, /setEmploymentEdited\(new Set\(\)\)/)

  const messages = read('src', 'lib', 'extracting', 'messages.ts')
  assert.match(messages, /erp_user_password_failed: 'extractingErrErpUserPassword'/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.equal(
    (translations.match(/extractingErrErpUserPassword:/g) ?? []).length,
    2,
  )
  const ar = translations.slice(0, translations.indexOf('  en: {'))
  for (const key of [
    'extractingErrErpUserPassword',
    'extractingUpdateNotice',
    'extractingUpdateNoticeSuffix',
  ]) {
    const match = new RegExp(`${key}:\\s*'([^']*)'`).exec(ar)
    assert.ok(match, key)
    assert.doesNotMatch(match[1], /[أإآ]/, key)
  }
})
