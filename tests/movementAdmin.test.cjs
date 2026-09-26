const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
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

const {
  MOVEMENT_NOTES_MAX_LENGTH,
  MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH,
  MOVEMENT_EDIT_FIELD_ORDER,
  buildMovementEditPayload: buildPayloadInSandbox,
  isValidMovementNotes,
  localDateKey,
  movementAdminErrorKey,
  movementDriverEditMode,
  movementEditRecordedAt,
  movementEditUnchanged,
  normalizeMovementNotes,
  validateMovementEdit: validateInSandbox,
} = loadLibModule('movementAdmin')

// Objects built inside the vm sandbox carry that realm's Object prototype,
// which `deepStrictEqual` rejects; compare their plain JSON shape instead.
const plain = (value) => JSON.parse(JSON.stringify(value))
const validateMovementEdit = (...args) => plain(validateInSandbox(...args))
const buildMovementEditPayload = (...args) =>
  plain(buildPayloadInSandbox(...args))

const {
  MOVEMENT_ADMIN_ERROR_CODES,
  movementAdminErrorCode,
  movementAdminErrorStatus,
} = loadLibModule('movementErrors')

// Local-time instants, so the assertions hold in any test time zone.
const RECORDED = new Date(2026, 8, 20, 14, 30, 15, 250)
const NOW = new Date(2026, 8, 26, 10, 0, 0, 0)

const base = {
  equipment_id: 'equipment-1',
  supervisor_id: 'supervisor-1',
  movement_date: localDateKey(RECORDED),
  company_id: 'company-1',
  project_id: 'project-1',
  contractor_code: 'C-12',
  driver_id: 'driver-1',
  notes: 'ملاحظة',
}

test('the note is trimmed and an empty note clears the field', () => {
  assert.equal(normalizeMovementNotes('  تمت المعاينة  '), 'تمت المعاينة')
  assert.equal(normalizeMovementNotes(''), null)
  assert.equal(normalizeMovementNotes('   '), null)
})

test('the client length checks mirror the database checks', () => {
  assert.equal(MOVEMENT_NOTES_MAX_LENGTH, 1000)
  assert.equal(MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH, 50)
  assert.equal(isValidMovementNotes(''), true)
  assert.equal(isValidMovementNotes('A'.repeat(1000)), true)
  // Trailing spaces are trimmed first, so they never push a valid note over.
  assert.equal(isValidMovementNotes(`${'A'.repeat(1000)}   `), true)
  assert.equal(isValidMovementNotes('A'.repeat(1001)), false)
})

test('the local date key follows the browser day', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
  assert.equal(localDateKey(new Date(2026, 11, 31, 0, 1)), '2026-12-31')
})

test('per-field validation of a site correction', () => {
  assert.deepEqual(validateMovementEdit(base, 'site', NOW), {})
  const empty = {
    ...base,
    equipment_id: '',
    supervisor_id: '',
    movement_date: '',
    company_id: '',
    project_id: '',
    contractor_code: 'X'.repeat(51),
    notes: 'A'.repeat(1001),
  }
  assert.deepEqual(validateMovementEdit(empty, 'site', NOW), {
    equipment_id: 'movementEditEquipmentRequired',
    supervisor_id: 'movementEditSupervisorRequired',
    movement_date: 'movementDateRequired',
    company_id: 'movementEditCompanyRequired',
    project_id: 'movementEditProjectRequired',
    contractor_code: 'contractorCodeTooLong',
    notes: 'movementNotesTooLong',
  })
  // A future day is refused before the round trip.
  assert.deepEqual(
    validateMovementEdit({ ...base, movement_date: '2026-09-27' }, 'site', NOW),
    { movement_date: 'movementEditFutureTime' },
  )
  assert.deepEqual(
    validateMovementEdit({ ...base, movement_date: '2026-09-26' }, 'site', NOW),
    {},
  )
})

test('a workshop correction never asks for site-only fields', () => {
  const workshop = {
    ...base,
    company_id: '',
    project_id: '',
    contractor_code: 'X'.repeat(80),
    driver_id: '',
  }
  assert.deepEqual(validateMovementEdit(workshop, 'workshop', NOW), {})
})

test('the field order follows the dialog', () => {
  assert.deepEqual(
    [...MOVEMENT_EDIT_FIELD_ORDER],
    [
      'equipment_id',
      'supervisor_id',
      'movement_date',
      'company_id',
      'project_id',
      'contractor_code',
      'driver_id',
      'notes',
    ],
  )
})

test('an unchanged day sends the stored instant untouched', () => {
  const original = RECORDED.toISOString()
  assert.equal(
    movementEditRecordedAt(localDateKey(RECORDED), original, NOW),
    original,
  )
})

test('a new day keeps the original local time of day', () => {
  const result = new Date(
    movementEditRecordedAt('2026-09-18', RECORDED.toISOString(), NOW),
  )
  assert.equal(localDateKey(result), '2026-09-18')
  assert.equal(result.getHours(), 14)
  assert.equal(result.getMinutes(), 30)
  assert.equal(result.getSeconds(), 15)
})

test('moving to today at a later hour is capped at now', () => {
  const late = new Date(2026, 8, 20, 18, 0)
  assert.equal(
    movementEditRecordedAt(localDateKey(NOW), late.toISOString(), NOW),
    NOW.toISOString(),
  )
})

test('Save stays disabled when nothing changed', () => {
  assert.equal(movementEditUnchanged({ ...base }, base), true)
  assert.equal(
    movementEditUnchanged({ ...base, notes: '  ملاحظة ' }, base),
    true,
  )
  // A cleared driver is not a change: the database never removes a driver.
  assert.equal(movementEditUnchanged({ ...base, driver_id: '' }, base), true)
  for (const patch of [
    { equipment_id: 'equipment-2' },
    { supervisor_id: 'supervisor-2' },
    { movement_date: '2026-09-18' },
    { company_id: 'company-2' },
    { project_id: 'project-2' },
    { contractor_code: 'C-13' },
    { driver_id: 'driver-2' },
    { notes: 'ملاحظة اخرى' },
    // Clearing an existing note is a real change.
    { notes: '' },
  ])
    assert.equal(movementEditUnchanged({ ...base, ...patch }, base), false)
})

test('the payload sends every field and the full note', () => {
  const payload = buildMovementEditPayload(
    { ...base, contractor_code: '  C-12  ', notes: '  جديد  ' },
    {
      context: 'site',
      originalRecordedAt: RECORDED.toISOString(),
      currentDriverId: 'driver-1',
      driverMode: 'admin',
      now: NOW,
    },
  )
  assert.deepEqual(payload, {
    equipment_id: 'equipment-1',
    supervisor_id: 'supervisor-1',
    recorded_at: RECORDED.toISOString(),
    company_id: 'company-1',
    project_id: 'project-1',
    contractor_equipment_code: 'C-12',
    driver_id: null,
    notes: 'جديد',
  })
  // A cleared note is sent as '' so the database stores NULL.
  assert.equal(
    buildMovementEditPayload(
      { ...base, notes: '   ' },
      {
        context: 'site',
        originalRecordedAt: RECORDED.toISOString(),
        currentDriverId: 'driver-1',
        driverMode: 'admin',
      },
    ).notes,
    '',
  )
})

test('only a closed visit or an EXIT sends the driver in place', () => {
  const params = {
    context: 'site',
    originalRecordedAt: RECORDED.toISOString(),
    currentDriverId: 'driver-1',
    now: NOW,
  }
  const changed = { ...base, driver_id: 'driver-2' }
  assert.equal(
    buildMovementEditPayload(changed, { ...params, driverMode: 'admin' })
      .driver_id,
    'driver-2',
  )
  // An open visit appends through change_active_movement_driver instead.
  assert.equal(
    buildMovementEditPayload(changed, {
      ...params,
      driverMode: 'driver_change',
    }).driver_id,
    null,
  )
  // Workshop movements send no site fields and no driver.
  const workshop = buildMovementEditPayload(changed, {
    ...params,
    context: 'workshop',
    driverMode: 'unsupported',
  })
  assert.equal(workshop.driver_id, null)
  assert.equal(workshop.company_id, null)
  assert.equal(workshop.project_id, null)
  assert.equal(workshop.contractor_equipment_code, null)
})

test('an open site ENTRY keeps the append-only driver path', () => {
  assert.equal(
    movementDriverEditMode({
      movementType: 'entry',
      movementContext: 'site',
      hasLaterMovement: false,
    }),
    'driver_change',
  )
  // A closed visit is corrected on the row itself.
  assert.equal(
    movementDriverEditMode({
      movementType: 'entry',
      movementContext: 'site',
      hasLaterMovement: true,
    }),
    'admin',
  )
  assert.equal(
    movementDriverEditMode({
      movementType: 'exit',
      movementContext: 'site',
      hasLaterMovement: false,
    }),
    'admin',
  )
  // Workshop movements are recorded without a driver at all.
  for (const movementType of ['entry', 'exit']) {
    assert.equal(
      movementDriverEditMode({
        movementType,
        movementContext: 'workshop',
        hasLaterMovement: false,
      }),
      'unsupported',
    )
  }
  // A missing context defaults to `site`, never to "no driver".
  assert.equal(
    movementDriverEditMode({
      movementType: 'entry',
      movementContext: null,
      hasLaterMovement: true,
    }),
    'admin',
  )
})

test('migration 0105 error tokens map to stable API codes', () => {
  const cases = [
    ['admin_required', 'access_denied'],
    ['movement_not_found', 'movement_not_found'],
    ['invalid_payload', 'invalid_movement_payload'],
    ['future_time', 'future_time'],
    ['invalid_sequence', 'invalid_sequence'],
    ['invalid_driver', 'invalid_driver'],
    ['driver_not_supported', 'driver_not_supported'],
    ['open_visit_driver_change', 'open_visit_driver_change'],
    ['contractor_code_too_long', 'contractor_code_too_long'],
    ['movement_notes_too_long', 'movement_notes_too_long'],
    ['entry_has_later_exit', 'entry_has_later_exit'],
    ['movement_not_last', 'movement_not_last'],
  ]
  for (const [message, code] of cases) {
    assert.equal(movementAdminErrorCode(message, 'update'), code)
    assert.equal(movementAdminErrorCode(message, 'delete'), code)
    assert.ok(MOVEMENT_ADMIN_ERROR_CODES.includes(code))
  }
})

test('the PostgreSQL HINT that PostgREST appends does not confuse the mapping', () => {
  assert.equal(
    movementAdminErrorCode(
      'entry_has_later_exit\nHINT: Delete the exit of this visit first.',
      'delete',
    ),
    'entry_has_later_exit',
  )
  assert.equal(
    movementAdminErrorCode(
      'open_visit_driver_change\nHINT: Use change_active_movement_driver while the visit is open.',
    ),
    'open_visit_driver_change',
  )
})

test('unknown and missing messages fall back per operation', () => {
  assert.equal(movementAdminErrorCode(null), 'movement_update_failed')
  assert.equal(movementAdminErrorCode('', 'delete'), 'movement_delete_failed')
  // Raw PostgreSQL text must never reach the user as-is.
  assert.equal(
    movementAdminErrorCode(
      'permission denied for table entry_exit_logs (SQLSTATE 42501)',
      'delete',
    ),
    'movement_delete_failed',
  )
})

test('a refused role is 403, a missing movement 404, bad input 400', () => {
  assert.equal(movementAdminErrorStatus('access_denied'), 403)
  assert.equal(movementAdminErrorStatus('movement_not_found'), 404)
  for (const code of [
    'invalid_movement_payload',
    'contractor_code_too_long',
    'movement_notes_too_long',
  ])
    assert.equal(movementAdminErrorStatus(code), 400)
  for (const code of [
    'future_time',
    'invalid_sequence',
    'entry_has_later_exit',
    'movement_not_last',
    'invalid_driver',
    'driver_not_supported',
    'open_visit_driver_change',
    'movement_update_failed',
    'movement_delete_failed',
  ]) {
    assert.equal(movementAdminErrorStatus(code), 409)
  }
})

test('every API code has a safe translation key, per operation', () => {
  const expected = {
    access_denied: 'movementAdminAccessDenied',
    movement_not_found: 'movementNotFound',
    invalid_movement_payload: 'movementEditInvalidPayload',
    future_time: 'movementEditFutureTime',
    invalid_sequence: 'movementEditSequenceError',
    invalid_driver: 'movementAdminInvalidDriver',
    driver_not_supported: 'movementAdminDriverNotSupported',
    open_visit_driver_change: 'movementAdminOpenVisitDriver',
    contractor_code_too_long: 'contractorCodeTooLong',
    movement_notes_too_long: 'movementNotesTooLong',
    entry_has_later_exit: 'movementDeleteEntryHasExit',
    movement_not_last: 'movementDeleteNotLast',
    movement_update_failed: 'movementEditFailed',
    movement_delete_failed: 'movementDeleteFailed',
  }
  for (const code of MOVEMENT_ADMIN_ERROR_CODES) {
    assert.equal(movementAdminErrorKey(code), expected[code])
  }
  assert.equal(movementAdminErrorKey('unauthorized'), 'authError')
  assert.equal(movementAdminErrorKey(undefined), 'movementEditFailed')
  assert.equal(
    movementAdminErrorKey(undefined, 'delete'),
    'movementDeleteFailed',
  )
  assert.equal(
    movementAdminErrorKey('who_knows', 'delete'),
    'movementDeleteFailed',
  )
})

test('every translation key used by the admin actions exists in ar and en', () => {
  const file = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts')
  const source = fs.readFileSync(file, 'utf8')
  const [, ar, en] = source.split(/\n {2}(?:ar|en): \{\n/)
  const keys = [
    'movementActions',
    'editMovement',
    'movementCorrectionDialogDesc',
    'movementEditDateHint',
    'movementEditEquipmentRequired',
    'movementEditSupervisorRequired',
    'movementEditCompanyRequired',
    'movementEditProjectRequired',
    'movementEditFutureTime',
    'movementEditInvalidPayload',
    'movementEditDriverPartial',
    'movementEditSequenceError',
    'movementEditOpenVisitDriverHint',
    'movementAdminDriverNotSupported',
    'movementAdminAccessDenied',
    'movementAdminInvalidDriver',
    'movementAdminOpenVisitDriver',
    'movementNotesTooLong',
    'movementDateRequired',
    'contractorCodeTooLong',
    'confirmDeleteMovement',
    'dialogDescMovementDelete',
    'movementDeleted',
    'movementDeleteFailed',
    'movementDeleteEntryHasExit',
    'movementDeleteNotLast',
  ]
  for (const key of keys) {
    assert.ok(new RegExp(`\\n    ${key}:`).test(ar), `missing ar key: ${key}`)
    assert.ok(new RegExp(`\\n    ${key}:`).test(en), `missing en key: ${key}`)
  }
  // The keys of the removed separate forms are gone.
  for (const key of ['movementEditDialogDesc', 'existingDriverEditHint'])
    assert.ok(!source.includes(`\n    ${key}:`), `stale key: ${key}`)
})

test('the new Arabic copy never uses alif with hamza or madda', () => {
  const file = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts')
  const source = fs.readFileSync(file, 'utf8')
  for (const marker of ['// wave6-J3', '// wave6-J4']) {
    const start = source.indexOf(marker)
    assert.ok(start >= 0, `missing block ${marker}`)
    const block = source.slice(start, source.indexOf('\n\n', start))
    for (const forbidden of ['أ', 'إ', 'آ']) {
      assert.ok(!block.includes(forbidden), `${marker}: ${forbidden}`)
    }
  }
})
