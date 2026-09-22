const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the equipment form helpers are exercised exactly as the dialog and the
// list table use them. Type-only imports (`@/i18n`, `@/components/ui`) are
// erased by the transpile step, so nothing else has to be stubbed.
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

const form = loadLibModule('equipmentForm')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)

const base = () => plain(form.EMPTY_EQUIPMENT_FORM)

test('the empty form starts as an owned, numbered, operational equipment', () => {
  const empty = base()
  assert.equal(empty.ownership_status, 'alazani')
  assert.equal(empty.numbering_status, 'numbered')
  assert.equal(empty.operational_status, 'operational')
  assert.equal(empty.lessor_id, '')
})

test('a code prefix suggests the owner and clears a stale supplier', () => {
  const withSupplier = {
    ...base(),
    ownership_status: 'external_supplier',
    lessor_id: 'lessor-1',
  }
  assert.equal(
    form.applyEquipmentCode(withSupplier, 'A145').ownership_status,
    'alazani',
  )
  assert.equal(form.applyEquipmentCode(withSupplier, 'A145').lessor_id, '')
  assert.equal(
    form.applyEquipmentCode(withSupplier, 'TK20').ownership_status,
    'takween',
  )
  assert.equal(
    form.applyEquipmentCode(withSupplier, 'F7').ownership_status,
    'third_party_f',
  )
  assert.equal(
    form.applyEquipmentCode(withSupplier, 'B3').ownership_status,
    'third_party_partnership_b',
  )
})

test('an unrecognised prefix keeps the supplier selection', () => {
  const withSupplier = {
    ...base(),
    ownership_status: 'external_supplier',
    lessor_id: 'lessor-1',
  }
  const next = form.applyEquipmentCode(withSupplier, 'ZZ9')
  assert.equal(next.ownership_status, 'external_supplier')
  assert.equal(next.lessor_id, 'lessor-1')
  assert.equal(next.code, 'ZZ9')
})

test('choosing any owner other than Other Owner clears lessor_id', () => {
  const withSupplier = {
    ...base(),
    ownership_status: 'external_supplier',
    lessor_id: 'lessor-1',
  }
  assert.equal(form.applyOwnershipStatus(withSupplier, 'takween').lessor_id, '')
  assert.equal(
    form.applyOwnershipStatus(withSupplier, 'external_supplier').lessor_id,
    'lessor-1',
  )
})

// The code, type, and QR value are `NOT NULL` in the database and already
// marked required in the dialog; only the plate rule is form-specific.
const complete = () => ({
  ...base(),
  code: 'A145',
  type: 'BOOM TRUCK',
  qr_value: 'EQ-1',
})

test('a numbered equipment needs at least one digit in the plate', () => {
  assertErrors(
    form.validateEquipmentForm({ ...complete(), plate_number: '' }),
    { plate_number: 'plateRequired' },
  )
  assertErrors(
    form.validateEquipmentForm({ ...complete(), plate_number: '1234-ABJ' }),
    {},
  )
  assertErrors(
    form.validateEquipmentForm({
      ...complete(),
      numbering_status: 'unnumbered',
      plate_number: '',
    }),
    {},
  )
})

test('the required code, type, and QR value each get their own message', () => {
  assertErrors(form.validateEquipmentForm(base()), {
    code: 'equipmentCodeRequired',
    type: 'equipmentTypeRequired',
    plate_number: 'plateRequired',
    qr_value: 'qrValueRequired',
  })
})

test('a duplicate code, QR value, or plate is attributed to that field', () => {
  const duplicate = (name) =>
    form.equipmentSaveFieldErrors({
      code: '23505',
      message: `duplicate key value violates unique constraint "${name}"`,
    })
  assertErrors(duplicate('idx_equipment_code'), {
    code: 'equipmentCodeExists',
  })
  assertErrors(duplicate('idx_equipment_qr_value'), {
    qr_value: 'qrValueExists',
  })
  assertErrors(duplicate('equipment_plate_parts_unique_idx'), {
    plate_number: 'plateNumberExists',
  })
  assert.equal(duplicate('some_other_idx'), null)
})

test('the workshop quick create asks for a code and a plate', () => {
  const draft = {
    plate: '',
    chassis: '',
    identifierType: 'plate',
    code: '',
    type: '',
    lessorId: '',
    numberingStatus: 'numbered',
  }
  assertErrors(form.validateQuickEquipmentForm(draft, true), {
    code: 'equipmentCodeRequired',
    plate: 'plateRequired',
  })
  // An unnumbered workshop record needs the plate only.
  assertErrors(
    form.validateQuickEquipmentForm(
      { ...draft, numberingStatus: 'unnumbered', plate: '1234' },
      true,
    ),
    {},
  )
})

test('the foreman quick create asks for the type and the supplier', () => {
  const draft = {
    plate: '1234',
    chassis: '',
    identifierType: 'plate',
    code: '',
    type: '',
    lessorId: '',
    numberingStatus: 'numbered',
  }
  assertErrors(form.validateQuickEquipmentForm(draft, false), {
    type: 'equipmentTypeRequired',
    lessorId: 'lessorRequired',
  })
  assertErrors(
    form.validateQuickEquipmentForm(
      { ...draft, type: 'BOOM TRUCK', lessorId: 'lessor-1' },
      false,
    ),
    {},
  )
  // Identifying by chassis asks for the chassis instead of the plate.
  assertErrors(
    form.validateQuickEquipmentForm(
      {
        ...draft,
        identifierType: 'chassis',
        plate: '',
        type: 'BOOM TRUCK',
        lessorId: 'lessor-1',
      },
      false,
    ),
    { chassis: 'chassisNumberRequired' },
  )
})

test('the payload drops the plate when the equipment is unnumbered', () => {
  const payload = plain(
    form.buildEquipmentPayload({
      ...base(),
      numbering_status: 'unnumbered',
      plate_number: '1234-ABJ',
      chassis_number: 'CH-1',
    }),
  )
  assert.equal(payload.plate_number, null)
  assert.equal(payload.chassis_number, 'CH-1')
  assert.equal(payload.master_data_complete, true)
})

test('the payload only stores lessor_id for Other Owner', () => {
  const rented = plain(
    form.buildEquipmentPayload({
      ...base(),
      plate_number: '1',
      ownership_status: 'external_supplier',
      lessor_id: 'lessor-1',
    }),
  )
  assert.equal(rented.lessor_id, 'lessor-1')
  const owned = plain(
    form.buildEquipmentPayload({
      ...base(),
      plate_number: '1',
      lessor_id: 'lessor-1',
    }),
  )
  assert.equal(owned.lessor_id, null)
})

test('empty optional fields become null and the year becomes a number', () => {
  const payload = plain(
    form.buildEquipmentPayload({ ...base(), manufacture_year: '2022' }),
  )
  assert.equal(payload.manufacture_year, 2022)
  assert.equal(payload.brand, null)
  assert.equal(payload.registration_type, null)
  assert.equal(payload.project_id, null)
  assert.equal(payload.last_maintenance_date, null)
})

test('a record maps onto the form with nulls turned into empty strings', () => {
  const values = plain(
    form.equipmentFormValues({
      id: 'eq-1',
      code: 'A1',
      type: 'BOOM TRUCK',
      plate_number: null,
      operational_status: 'stopped',
      ownership_status: 'takween',
      project_id: null,
      lessor_id: null,
      brand: null,
      model: null,
      manufacture_year: 2020,
      chassis_number: null,
      registration_type: null,
      qr_value: 'EQ-1',
      last_maintenance_date: null,
      registration_expiry: null,
      insurance_expiry: null,
      is_active: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }),
  )
  assert.equal(values.plate_number, '')
  assert.equal(values.manufacture_year, '2020')
  assert.equal(values.numbering_status, 'numbered')
  assert.equal(values.operational_status, 'stopped')
})

test('badge mapping keeps amber for warnings and never red for a status', () => {
  assertErrors(plain(form.operationalStatusBadge('operational')), {
    tone: 'success',
    key: 'operational',
  })
  assertErrors(plain(form.operationalStatusBadge('maintenance')), {
    tone: 'warning',
    key: 'maintenance',
  })
  assertErrors(plain(form.operationalStatusBadge('stopped')), {
    tone: 'neutral',
    key: 'stopped',
  })
  assert.equal(form.activeBadge(true).key, 'active')
  assertErrors(plain(form.activeBadge(false)), {
    tone: 'warning',
    key: 'inactive',
  })
})

test('every owner maps to its own label and quick-created rows are flagged', () => {
  assert.equal(form.ownershipBadge('alazani').key, 'ownershipAlazani')
  assert.equal(form.ownershipBadge('takween').key, 'ownershipTakween')
  assert.equal(form.ownershipBadge('third_party_f').key, 'ownershipThirdPartyF')
  assert.equal(
    form.ownershipBadge('third_party_partnership_b').key,
    'ownershipThirdPartyPartnershipB',
  )
  assert.equal(
    form.ownershipBadge('external_supplier').key,
    'ownershipExternalSupplier',
  )
  assert.equal(form.masterDataBadge(false).key, 'incompleteData')
  assert.equal(form.masterDataBadge(true), null)
  assert.equal(form.masterDataBadge(undefined), null)
})

test('a generated QR value is unique and keeps the EQ- prefix', () => {
  const value = form.genQrValue()
  assert.match(value, /^EQ-[0-9A-Z]+-[0-9A-Z]+$/)
  assert.notEqual(value, form.genQrValue())
})
