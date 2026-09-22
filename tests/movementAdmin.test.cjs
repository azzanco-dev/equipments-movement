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
  isValidMovementNotes,
  movementAdminErrorKey,
  movementDriverEditMode,
  movementEditUnchanged,
  normalizeMovementNotes,
} = loadLibModule('movementAdmin')

const {
  MOVEMENT_ADMIN_ERROR_CODES,
  movementAdminErrorCode,
  movementAdminErrorStatus,
} = loadLibModule('movementErrors')

test('the note is trimmed and an empty note clears the field', () => {
  assert.equal(normalizeMovementNotes('  تمت المعاينة  '), 'تمت المعاينة')
  assert.equal(normalizeMovementNotes(''), null)
  assert.equal(normalizeMovementNotes('   '), null)
})

test('the client length check mirrors the 1000-character database check', () => {
  assert.equal(MOVEMENT_NOTES_MAX_LENGTH, 1000)
  assert.equal(isValidMovementNotes(''), true)
  assert.equal(isValidMovementNotes('A'.repeat(1000)), true)
  // Trailing spaces are trimmed first, so they never push a valid note over.
  assert.equal(isValidMovementNotes(`${'A'.repeat(1000)}   `), true)
  assert.equal(isValidMovementNotes('A'.repeat(1001)), false)
})

test('Save stays disabled when neither the note nor the driver changed', () => {
  const base = { currentNotes: 'ملاحظة', currentDriverId: 'driver-1' }
  assert.equal(
    movementEditUnchanged({ ...base, notes: 'ملاحظة', driverId: 'driver-1' }),
    true,
  )
  assert.equal(
    movementEditUnchanged({ ...base, notes: '  ملاحظة ', driverId: null }),
    true,
  )
  assert.equal(
    movementEditUnchanged({ ...base, notes: 'ملاحظة اخرى', driverId: null }),
    false,
  )
  assert.equal(
    movementEditUnchanged({ ...base, notes: 'ملاحظة', driverId: 'driver-2' }),
    false,
  )
  // Clearing an existing note is a real change.
  assert.equal(
    movementEditUnchanged({ ...base, notes: '', driverId: 'driver-1' }),
    false,
  )
  assert.equal(
    movementEditUnchanged({
      notes: '',
      currentNotes: null,
      driverId: null,
      currentDriverId: null,
    }),
    true,
  )
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

test('migration 0104 error tokens map to stable API codes', () => {
  const cases = [
    ['admin_required', 'access_denied'],
    ['movement_not_found', 'movement_not_found'],
    ['invalid_driver', 'invalid_driver'],
    ['driver_not_supported', 'driver_not_supported'],
    ['open_visit_driver_change', 'open_visit_driver_change'],
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

test('a refused role is 403, a missing movement 404, a bad note 400', () => {
  assert.equal(movementAdminErrorStatus('access_denied'), 403)
  assert.equal(movementAdminErrorStatus('movement_not_found'), 404)
  assert.equal(movementAdminErrorStatus('movement_notes_too_long'), 400)
  for (const code of [
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
    invalid_driver: 'movementAdminInvalidDriver',
    driver_not_supported: 'movementAdminDriverNotSupported',
    open_visit_driver_change: 'movementAdminOpenVisitDriver',
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
  const [, ar, en] = source.split(/\n  (?:ar|en): \{\n/)
  const keys = [
    'movementActions',
    'movementEditDialogDesc',
    'movementEditOpenVisitDriverHint',
    'movementAdminDriverNotSupported',
    'movementAdminAccessDenied',
    'movementAdminInvalidDriver',
    'movementAdminOpenVisitDriver',
    'movementNotesTooLong',
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
})

test('the new Arabic copy never uses alif with hamza or madda', () => {
  const file = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts')
  const source = fs.readFileSync(file, 'utf8')
  const block = source.slice(
    source.indexOf('// wave6-J3'),
    source.indexOf('// wave6-J3') +
      source.slice(source.indexOf('// wave6-J3')).indexOf('\n  },'),
  )
  for (const forbidden of ['أ', 'إ', 'آ']) {
    assert.ok(!block.includes(forbidden), `forbidden letter: ${forbidden}`)
  }
})
