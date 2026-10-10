// wave 18 — field validation with Zod schemas (owner decision 2026-10-10)
// plus the database error → field maps. Every message is a translation key.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// and `zod` to the installed package. Type-only imports are erased.
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
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const cache = new Map()
const v = loadLibModule('formValidation', cache)
const driver = loadLibModule('driverForm', cache)
const equipment = loadLibModule('equipmentForm', cache)
const user = loadLibModule('userForm', cache)
const movementAdmin = loadLibModule('movementAdmin', cache)

/** The message key of one field after `safeParse`. */
const keyOf = (schema, values, field) =>
  v.fieldErrorsFromZod(schema.safeParse(values))[field]

test('fieldErrorsFromZod keeps the first issue per field and {} when valid', () => {
  const schema = v.driverFormSchema
  const ok = {
    full_name: 'محمد علي',
    name_en: '',
    id_number: '',
    mobile_number: '',
  }
  assert.deepEqual(plain(v.fieldErrorsFromZod(schema.safeParse(ok))), {})
  // A blank required name says «مطلوب», never also "too short".
  assert.equal(
    keyOf(schema, { ...ok, full_name: '   ' }, 'full_name'),
    'fullNameRequired',
  )
  // A missing value (wrong type) falls back to the generic key.
  assert.deepEqual(
    plain(v.fieldErrorsFromZod(v.companyFormSchema.safeParse({}))),
    { name_ar: 'required', name_en: 'required' },
  )
})

test('primitives: mobileNumber, idNumber, requiredText, optionalText, plate, code', () => {
  const mobile = v.mobileNumber()
  for (const good of ['', '0501234567', '+966501234567', ' 0501234567 '])
    assert.equal(mobile.safeParse(good).success, true, good)
  for (const bad of ['12345', '05012345678901234', '05-0123', 'abc1234567'])
    assert.equal(
      mobile.safeParse(bad).error?.issues[0].message,
      'mobileNumberFormatInvalid',
      bad,
    )
  assert.equal(
    v.mobileNumber('mobileNumberRequired').safeParse('').error?.issues[0]
      .message,
    'mobileNumberRequired',
  )

  const id = v.idNumber()
  assert.equal(id.safeParse('').success, true)
  assert.equal(id.safeParse('1023456789').success, true)
  assert.equal(
    id.safeParse('1234').error?.issues[0].message,
    'idNumberFormatInvalid',
  )
  assert.equal(
    id.safeParse('12a456').error?.issues[0].message,
    'idNumberFormatInvalid',
  )

  const name = v.requiredText('fullNameRequired', {
    min: 2,
    max: 150,
    lengthKey: 'nameLengthInvalid',
  })
  assert.equal(name.safeParse('').error?.issues[0].message, 'fullNameRequired')
  assert.equal(
    name.safeParse('م').error?.issues[0].message,
    'nameLengthInvalid',
  )
  assert.equal(
    name.safeParse('x'.repeat(151)).error?.issues[0].message,
    'nameLengthInvalid',
  )
  assert.equal(name.safeParse('عبدالله').success, true)

  const optional = v.optionalText({ max: 3 })
  assert.equal(optional.safeParse('').success, true)
  assert.equal(
    optional.safeParse('abcd').error?.issues[0].message,
    'textTooLong',
  )

  // Plates: the digits make the plate; Arabic letters and dashes are fine.
  assert.equal(v.plate().safeParse('1234-ABJ').success, true)
  assert.equal(v.plate().safeParse('ا ب ج 1234').success, true)
  assert.equal(
    v.plate().safeParse('ABJ').error?.issues[0].message,
    'plateRequired',
  )

  // Codes: any non-blank text, dashes included.
  assert.equal(v.code().safeParse('TK-0012').success, true)
  assert.equal(
    v.code().safeParse('  ').error?.issues[0].message,
    'equipmentCodeRequired',
  )
})

test('driver form schema: lenient, with the database lengths and formats', () => {
  const base = {
    full_name: 'Ali',
    name_en: '',
    id_number: '',
    mobile_number: '',
    nationality: '',
    employment_type: '',
    job_title: '',
  }
  assert.deepEqual(plain(driver.validateDriverForm(base)), {})
  assert.deepEqual(
    plain(
      driver.validateDriverForm({
        ...base,
        full_name: 'A',
        name_en: 'B',
        id_number: '12',
        mobile_number: '123',
      }),
    ),
    {
      full_name: 'nameLengthInvalid',
      name_en: 'nameLengthInvalid',
      id_number: 'idNumberFormatInvalid',
      mobile_number: 'mobileNumberFormatInvalid',
    },
  )
  assert.deepEqual(
    plain(driver.validateQuickDriverForm({ fullName: '', mobile: '' })),
    { fullName: 'fullNameRequired', mobile: 'mobileNumberRequired' },
  )
})

test('equipment form schema: plate only when numbered, sensible year', () => {
  const base = {
    ...equipment.EMPTY_EQUIPMENT_FORM,
    code: 'A-101',
    type: 'حفار',
    plate_number: '1234-ABJ',
    qr_value: 'EQ-1',
  }
  assert.deepEqual(plain(equipment.validateEquipmentForm(base)), {})
  assert.deepEqual(
    plain(
      equipment.validateEquipmentForm({
        ...base,
        plate_number: '',
        manufacture_year: '85',
      }),
    ),
    {
      plate_number: 'plateRequired',
      manufacture_year: 'manufactureYearInvalid',
    },
  )
  assert.deepEqual(
    plain(
      equipment.validateEquipmentForm({
        ...base,
        numbering_status: 'unnumbered',
        plate_number: '',
        manufacture_year: '2019',
      }),
    ),
    {},
  )
  assert.equal(
    keyOf(
      v.equipmentFormSchema,
      { ...base, manufacture_year: '2200' },
      'manufacture_year',
    ),
    'manufactureYearInvalid',
  )
})

test('quick equipment schema follows the panel mode', () => {
  const empty = {
    plate: '',
    chassis: '',
    identifierType: 'chassis',
    code: '',
    type: '',
    lessorId: '',
    numberingStatus: 'numbered',
  }
  assert.deepEqual(plain(equipment.validateQuickEquipmentForm(empty, true)), {
    code: 'equipmentCodeRequired',
    plate: 'plateRequired',
  })
  assert.deepEqual(plain(equipment.validateQuickEquipmentForm(empty, false)), {
    chassis: 'chassisNumberRequired',
    type: 'equipmentTypeRequired',
    lessorId: 'lessorRequired',
  })
})

test('other form schemas carry their own keys', () => {
  assert.equal(
    keyOf(v.projectFormSchema, { name_ar: '', name_en: 'x' }, 'name_ar'),
    'projectNameArRequired',
  )
  assert.equal(
    keyOf(v.lessorFormSchema, { name: ' ' }, 'name'),
    'lessorNameRequired',
  )
  assert.equal(
    keyOf(v.quickLessorFormSchema, { name: 'x'.repeat(151) }, 'name'),
    'lessorNameTooLong',
  )
  assert.equal(
    keyOf(v.equipmentTypeFormSchema, { name: '' }, 'name'),
    'equipmentTypeRequired',
  )
  assert.equal(
    keyOf(v.signInFormSchema, { email: '', password: '' }, 'password'),
    'passwordRequired',
  )
  assert.equal(
    keyOf(
      v.passwordChangeFormSchema,
      { password: '12345678', confirmation: '12345679' },
      'confirmation',
    ),
    'passwordsDoNotMatch',
  )
  assert.equal(
    keyOf(
      v.passwordChangeFormSchema,
      { password: '123', confirmation: '123' },
      'password',
    ),
    'passwordMinLength',
  )
  assert.equal(
    keyOf(v.driverChangeFormSchema, { driver_id: '' }, 'driver_id'),
    'driverChangeDriverRequired',
  )
  assert.equal(
    keyOf(v.workshopOpeningFormSchema, { equipment_id: '' }, 'equipment_id'),
    'movementEditEquipmentRequired',
  )
})

test('user schemas: create needs a password, edit only checks a typed one', () => {
  assert.deepEqual(
    plain(
      user.validateUserForm({
        full_name: '',
        email: 'x',
        password: '',
        role: 'monitor',
      }),
    ),
    {
      full_name: 'fullNameRequired',
      email: 'invalidUserEmail',
      password: 'passwordRequired',
    },
  )
  const edit = {
    full_name: 'Sara',
    email: 'sara@example.com',
    role: 'monitor',
    password: '',
    mobile_number: '',
  }
  assert.deepEqual(plain(user.validateUserEditForm(edit)), {})
  assert.deepEqual(
    plain(
      user.validateUserEditForm({
        ...edit,
        password: 'short',
        mobile_number: '12',
      }),
    ),
    { password: 'passwordMinLength', mobile_number: 'userMobileInvalid' },
  )
  // Spaces and dashes are typing aids for the user mobile.
  assert.deepEqual(
    plain(
      user.validateUserEditForm({ ...edit, mobile_number: '+966 50-123-4567' }),
    ),
    {},
  )
  assert.deepEqual(plain(user.userEditServerFieldErrors('last_admin')), {
    role: 'lastAdminRequired',
  })
  assert.equal(user.userEditServerFieldErrors('other'), null)
})

test('mapDatabaseErrorToField: kinds, raised tokens first, null otherwise', () => {
  assert.equal(v.databaseErrorKind({ code: '23505' }), 'unique')
  assert.equal(v.databaseErrorKind({ code: '23514' }), 'check')
  assert.equal(v.databaseErrorKind({ code: '23503' }), 'foreignKey')
  assert.equal(v.databaseErrorKind({ code: '22001' }), 'tooLong')
  assert.equal(v.databaseErrorKind({ code: 'P0001' }), null)

  const rules = [
    {
      on: 'raised',
      match: 'equipment_code_previously_used',
      field: 'code',
      key: 'equipmentCodePreviouslyUsed',
    },
    {
      on: 'unique',
      match: 'equipment_code',
      field: 'code',
      key: 'equipmentCodeExists',
    },
    { on: 'tooLong', field: 'notes', key: 'textTooLong' },
  ]
  // The previous-code token is raised WITH 23505: the token wins.
  assert.deepEqual(
    plain(
      v.mapDatabaseErrorToField(
        { code: '23505', message: 'equipment_code_previously_used' },
        rules,
      ),
    ),
    { code: 'equipmentCodePreviouslyUsed' },
  )
  assert.deepEqual(
    plain(
      v.mapDatabaseErrorToField(
        {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "idx_equipment_code"',
        },
        rules,
      ),
    ),
    { code: 'equipmentCodeExists' },
  )
  assert.deepEqual(
    plain(
      v.mapDatabaseErrorToField(
        { code: '22001', message: 'value too long' },
        rules,
      ),
    ),
    { notes: 'textTooLong' },
  )
  assert.equal(
    v.mapDatabaseErrorToField(
      { code: '42501', message: 'permission denied' },
      rules,
    ),
    null,
  )
  assert.equal(v.mapDatabaseErrorToField(null, rules), null)
})

test('driver database map', () => {
  const map = (error) => plain(driver.driverSaveFieldErrors(error))
  assert.deepEqual(
    map({
      code: '23505',
      message: 'violates unique constraint "drivers_mobile_number_unique"',
    }),
    { mobile_number: 'mobileExists' },
  )
  assert.deepEqual(
    map({
      code: '23505',
      message: 'violates unique constraint "drivers_id_number_key"',
    }),
    { id_number: 'driverIdExists' },
  )
  assert.deepEqual(
    map({
      code: '23514',
      message: 'violates check constraint "drivers_full_name_check"',
    }),
    { full_name: 'nameLengthInvalid' },
  )
  assert.deepEqual(
    map({
      code: '23514',
      message: 'violates check constraint "drivers_name_en_check"',
    }),
    { name_en: 'nameLengthInvalid' },
  )
  assert.deepEqual(
    map({
      code: '23514',
      message: 'violates check constraint "drivers_employment_type_check"',
    }),
    { employment_type: 'valueNotInList' },
  )
  assert.deepEqual(
    map({
      code: '23514',
      message: 'violates check constraint "drivers_nationality_check"',
    }),
    { nationality: 'valueNotInList' },
  )
  assert.equal(map({ code: '42501', message: 'permission denied' }), null)
  assert.deepEqual(
    plain(
      driver.quickDriverSaveFieldErrors({
        code: 'P0001',
        message: 'invalid_quick_driver',
      }),
    ),
    { mobile: 'mobileNumberFormatInvalid' },
  )
})

test('equipment database maps', () => {
  const map = (error) => plain(equipment.equipmentSaveFieldErrors(error))
  assert.deepEqual(
    map({
      code: '23505',
      message: 'unique constraint "equipment_plate_parts_unique_idx"',
    }),
    { plate_number: 'plateNumberExists' },
  )
  assert.deepEqual(
    map({
      code: '23505',
      message: 'unique constraint "idx_equipment_qr_value"',
    }),
    { qr_value: 'qrValueExists' },
  )
  assert.deepEqual(
    map({ code: '23505', message: 'equipment_code_previously_used' }),
    { code: 'equipmentCodePreviouslyUsed' },
  )
  assert.deepEqual(map({ code: 'P0001', message: 'invalid_plate_number' }), {
    plate_number: 'plateNumberInvalid',
  })
  assert.deepEqual(
    map({
      code: '23514',
      message: 'check constraint "equipment_plate_digits_format"',
    }),
    { plate_number: 'plateNumberInvalid' },
  )
  assert.deepEqual(
    map({
      code: '23503',
      message: 'foreign key constraint "equipment_type_fkey"',
    }),
    { type: 'equipmentTypeNotFound' },
  )
  assert.deepEqual(
    map({
      code: '23503',
      message: 'foreign key constraint "equipment_project_id_fkey"',
    }),
    { project_id: 'projectNotFound' },
  )
  assert.deepEqual(
    map({
      code: '23503',
      message: 'foreign key constraint "equipment_lessor_id_fkey"',
    }),
    { lessor_id: 'lessorNotFound' },
  )
  // The tracker unit index (0122) has its own message in the dialog.
  assert.equal(
    map({
      code: '23505',
      message: 'unique constraint "equipment_tracker_unit_id_key"',
    }),
    null,
  )

  const quick = (error) => plain(equipment.quickEquipmentSaveFieldErrors(error))
  assert.deepEqual(
    quick({ code: 'P0001', message: 'duplicate equipment code' }),
    { code: 'equipmentCodeExists' },
  )
  assert.deepEqual(
    quick({ code: 'P0001', message: 'invalid_equipment_type' }),
    { type: 'equipmentTypeNotFound' },
  )
  assert.deepEqual(quick({ code: 'P0001', message: 'invalid_lessor' }), {
    lessorId: 'lessorNotFound',
  })
  assert.equal(
    quick({ code: 'P0001', message: 'invalid_quick_equipment' }),
    null,
  )
})

test('movement correction API codes land on their field', () => {
  const map = (code) => plain(movementAdmin.movementEditFieldErrors(code))
  assert.deepEqual(map('future_time'), {
    movement_date: 'movementEditFutureTime',
  })
  assert.deepEqual(map('invalid_driver'), {
    driver_id: 'movementAdminInvalidDriver',
  })
  assert.deepEqual(map('contractor_code_too_long'), {
    contractor_code: 'contractorCodeTooLong',
  })
  assert.deepEqual(map('movement_notes_too_long'), {
    notes: 'movementNotesTooLong',
  })
  assert.equal(map('invalid_sequence'), null)
  assert.equal(map(undefined), null)
})

test('wave-18 translation keys exist in both languages without hamza alif', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  const blocks = source.split('// wave-18-validation — start').slice(1)
  assert.equal(blocks.length, 2)
  const keys = blocks.map((block) =>
    [
      ...block.split('// wave-18-validation — end')[0].matchAll(/^\s+(\w+):/gm),
    ].map((match) => match[1]),
  )
  assert.deepEqual(keys[0], keys[1])
  assert.ok(!/[أإآ]/.test(blocks[0].split('// wave-18-validation — end')[0]))
})
