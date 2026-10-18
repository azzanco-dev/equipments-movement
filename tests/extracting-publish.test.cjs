const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadExtractingModule } = require('./helpers/loadExtracting.cjs')

const {
  parsePublishRequest,
  missingErpFields,
  currentSystemDriverPayload,
  currentSystemDriverUpdatePayload,
  erpUserPayload,
  erpEmployeePayload,
  erpEmployeeUpdatePayload,
  erpErrorDetails,
} = loadExtractingModule('publish')
const { parseLookupRequest, publishModeFor, hasExistingRecord } =
  loadExtractingModule('lookup')
const {
  validateExtractionForm,
  applyFormPatch,
  createDefaultForm,
  UPDATE_FIELDS,
} = loadExtractingModule('form')

/** Values an update must never carry, whatever the form holds. */
const NEVER_UPDATED = [
  'id_number',
  'email',
  'password',
  'new_password',
  'username',
  'language',
  'company',
  'employment_type',
  'department',
  'date_of_joining',
  'ctc',
  'employee_number',
  'status',
  'user_id',
]

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

test('the ERPNext password is optional, untrimmed and sent as new_password', () => {
  assert.ok(!('new_password' in erpUserPayload(data)))
  const parsed = parsePublishRequest({
    data: { ...data, password: ' Pass word9 ' },
    targets: { erpnext: true },
  })
  assert.equal(parsed.data.password, ' Pass word9 ')
  assert.equal(erpUserPayload(parsed.data).new_password, ' Pass word9 ')
  assert.ok(!('new_password' in currentSystemDriverPayload(parsed.data)))
  assert.equal(
    parsePublishRequest({
      data: { ...data, password: 'short' },
      targets: { erpnext: true },
    }),
    null,
  )
})

test('the publish mode defaults to create and rejects unknown modes', () => {
  const targets = { currentSystem: true }
  assert.equal(parsePublishRequest({ data, targets }).mode, 'create')
  assert.equal(
    parsePublishRequest({ data, targets, mode: 'create' }).mode,
    'create',
  )
  assert.equal(
    parsePublishRequest({ data, targets, mode: 'update' }).mode,
    'update',
  )
  for (const mode of ['upsert', '', null, true, 1, {}])
    assert.equal(
      parsePublishRequest({ data, targets, mode }),
      null,
      String(mode),
    )
})

test('the update allowlist is exactly the OCR identity fields', () => {
  assert.deepEqual([...UPDATE_FIELDS].sort(), [
    'date_of_birth',
    'full_name_ar',
    'full_name_en',
    'gender',
    'mobile_number',
    'nationality',
    'occupation',
    'residence_expiry_date',
  ])
  for (const key of NEVER_UPDATED) assert.ok(!UPDATE_FIELDS.includes(key), key)
})

test('the driver update writes only non-empty identity columns, never the key or employment type', () => {
  const parsed = parsePublishRequest({
    data: { ...data, mobile_number: '', nationality: ' ', occupation: '' },
    targets: { currentSystem: true },
    mode: 'update',
  })
  const update = currentSystemDriverUpdatePayload(parsed.data)
  // Compared as JSON: the module runs in its own VM realm.
  assert.equal(
    JSON.stringify(update),
    JSON.stringify({
      full_name: data.full_name_ar,
      name_en: data.full_name_en,
    }),
  )
  for (const key of NEVER_UPDATED) assert.ok(!(key in update), key)
  // Every written column is one the create payload already maps, and the
  // create payload itself is unchanged.
  const create = currentSystemDriverPayload(parsed.data)
  assert.deepEqual(Object.keys(create).sort(), [
    'employment_type',
    'full_name',
    'id_number',
    'job_title',
    'mobile_number',
    'name_en',
    'nationality',
  ])
  assert.equal(create.employment_type, data.employment_type)
  assert.equal(create.mobile_number, null)
  for (const column of Object.keys(update)) assert.ok(column in create, column)
  const full = currentSystemDriverUpdatePayload(
    parsePublishRequest({ data, targets: { currentSystem: true } }).data,
  )
  assert.deepEqual(Object.keys(full).sort(), [
    'full_name',
    'job_title',
    'mobile_number',
    'name_en',
    'nationality',
  ])
  assert.equal(full.job_title, data.occupation)
})

test('the employee update writes identity fields only, never employment or account data', () => {
  const availableFields = new Set([
    'custom_employee_name_en',
    'custom_nationality',
    'custom_residence_permit_number',
    'custom_rp_valid_upto',
    'ctc',
    'employee_number',
  ])
  const parsed = parsePublishRequest({
    data: { ...data, password: 'Secret123', full_name_en: '' },
    targets: { erpnext: true },
    mode: 'update',
  })
  const update = erpEmployeeUpdatePayload(parsed.data, availableFields)
  assert.deepEqual(Object.keys(update).sort(), [
    'cell_number',
    'custom_nationality',
    'custom_rp_valid_upto',
    'date_of_birth',
    'designation',
    'first_name',
    'gender',
  ])
  for (const key of NEVER_UPDATED) assert.ok(!(key in update), key)
  assert.ok(!('custom_residence_permit_number' in update), 'match key')
  assert.ok(!('custom_employee_name_en' in update), 'empty value skipped')
  assert.equal(update.first_name, data.full_name_ar)
  assert.equal(update.gender, data.gender)
  assert.equal(update.date_of_birth, data.date_of_birth)
  assert.equal(update.cell_number, data.mobile_number)
  assert.equal(update.designation, data.occupation)
  assert.equal(update.custom_nationality, data.nationality)
  assert.equal(update.custom_rp_valid_upto, data.residence_expiry_date)
  assert.ok(!Object.values(update).includes(''))
  // Every written field is one the create payload maps, and the create
  // payload itself is unchanged.
  const create = erpEmployeePayload(parsed.data, availableFields)
  for (const field of Object.keys(update)) assert.ok(field in create, field)
  assert.equal(create.user_id, data.email)
  assert.equal(create.status, 'Inactive')
  assert.equal(create.date_of_joining, data.date_of_joining)
  assert.equal(create.company, data.company)
  assert.equal(create.employment_type, data.employment_type)
  assert.equal(create.custom_residence_permit_number, data.id_number)
  assert.equal(create.employee_number, data.id_number)
  // The custom name field is resolved with the configured name when present.
  const named = erpEmployeeUpdatePayload(
    parsePublishRequest({ data, targets: { erpnext: true }, mode: 'update' })
      .data,
    availableFields,
  )
  assert.equal(named.custom_employee_name_en, data.full_name_en)
})

test('the lookup body uses the form residence-number rule', () => {
  assert.equal(
    parseLookupRequest({ id_number: ' 2554398733 ' }).idNumber,
    '2554398733',
  )
  assert.equal(parseLookupRequest({ id_number: '12A' }), null)
  assert.equal(parseLookupRequest({ id_number: '1234' }), null)
  assert.equal(parseLookupRequest({ id_number: 2554398733 }), null)
  assert.equal(parseLookupRequest(null), null)
})

test('the page sends update only for an admin with a matching selected target', () => {
  const driver = { id: 'd1', full_name: 'سائق', mobile_number: null }
  const employee = {
    name: 'HR-EMP-1',
    employee_name: 'Driver',
    user_id: '',
    cell_number: '',
  }
  const found = (canUpdate, extra = {}) => ({
    idNumber: '2554398733',
    canUpdate,
    currentSystem: driver,
    erpnext: { configured: true, employee },
    ...extra,
  })
  const both = { currentSystem: true, erpnext: true }
  assert.equal(publishModeFor(found(true), '2554398733', both), 'update')
  assert.equal(publishModeFor(found(true), ' 2554398733 ', both), 'update')
  // A non-admin keeps the create flow even when a record exists.
  assert.equal(publishModeFor(found(false), '2554398733', both), 'create')
  // No lookup yet, or a lookup for a number the admin has since changed.
  assert.equal(publishModeFor(null, '2554398733', both), 'create')
  assert.equal(publishModeFor(found(true), '9999999999', both), 'create')
  // The record must exist in a SELECTED target.
  const erpOnly = found(true, { currentSystem: null })
  assert.equal(
    publishModeFor(erpOnly, '2554398733', {
      currentSystem: true,
      erpnext: false,
    }),
    'create',
  )
  assert.equal(
    publishModeFor(erpOnly, '2554398733', {
      currentSystem: false,
      erpnext: true,
    }),
    'update',
  )
  const nothing = found(true, {
    currentSystem: null,
    erpnext: { configured: false },
  })
  assert.equal(hasExistingRecord(nothing, both), false)
  assert.equal(publishModeFor(nothing, '2554398733', both), 'create')
  const erpError = found(true, {
    currentSystem: null,
    erpnext: { configured: true, error: 'erp_connection_failed' },
  })
  assert.equal(publishModeFor(erpError, '2554398733', both), 'create')
})

// Security audit run-1, E-19 (owner decision 2026-10-18): create mode never
// binds a login to an existing Employee and never reuses an existing ERPNext
// User; both stay admin-only through update mode. Source checks on the route.
test('create mode refuses an existing Employee and an existing ERPNext User', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const route = fs
    .readFileSync(
      path.join(__dirname, '..', 'app', 'api', 'extracting', 'publish', 'route.ts'),
      'utf8',
    )
    .replace(/\r\n/g, '\n')
  // The Employee refusal comes right after the lookup and before any user or
  // employee write; it is keyed on mode !== 'update'.
  const lookup = route.indexOf('await findEmployeeByResidence(erp, data.id_number)')
  const refuse = route.indexOf("if (existingEmployee && mode !== 'update')")
  const ensureUser = route.indexOf('await ensureErpUser(erp, data, mode)')
  assert.ok(lookup > 0 && refuse > lookup && ensureUser > refuse)
  assert.match(route, /error: 'erp_employee_exists'/)
  // An existing User is reused only in update mode.
  assert.match(route, /if \(lookup\.ok\) \{\s*if \(mode !== 'update'\) return \{ exists: true as const \}/)
  assert.match(route, /error: 'erp_user_exists'/)
  // Create mode no longer writes cell_number / user_id onto an existing Employee.
  assert.doesNotMatch(route, /update\.cell_number = data\.mobile_number/)
  const messages = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'extracting', 'messages.ts'),
    'utf8',
  )
  assert.match(messages, /erp_employee_exists: 'extractingErrErpEmployeeExists'/)
  assert.match(messages, /erp_user_exists: 'extractingErrErpUserExists'/)
  const translations = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  for (const key of ['extractingErrErpEmployeeExists', 'extractingErrErpUserExists'])
    assert.equal((translations.match(new RegExp(`${key}:`, 'g')) ?? []).length, 2, key)
})
