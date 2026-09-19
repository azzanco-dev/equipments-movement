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

const { movementErrorCode, movementErrorStatus } =
  loadLibModule('movementErrors')
const { siteExitEquipmentArgs } = loadLibModule('exitEquipmentSearch')

test('the site exit owner rule maps to its own code and 403', () => {
  // Migration 0087 raises this token with SQLSTATE 42501.
  assert.equal(
    movementErrorCode('exit_not_entry_owner'),
    'exit_not_entry_owner',
  )
  assert.equal(
    movementErrorCode(
      'exit_not_entry_owner\nHINT: Only the foreman who registered the entry, or an admin, may register this exit.',
    ),
    'exit_not_entry_owner',
  )
  assert.equal(movementErrorStatus('exit_not_entry_owner'), 403)
})

test('a site exit on equipment inside the workshop maps to its own code and 403', () => {
  // Migration 0088 raises this token with SQLSTATE 42501.
  assert.equal(
    movementErrorCode(
      'exit_equipment_in_workshop\nHINT: The equipment is inside the workshop; a site exit cannot close a workshop entry.',
    ),
    'exit_equipment_in_workshop',
  )
  assert.equal(movementErrorStatus('exit_equipment_in_workshop'), 403)
})

test('the existing trigger messages keep their codes and 409', () => {
  const cases = {
    'movement time cannot be in the future': 'future_time',
    'company_id is required for an entry': 'company_required',
    'project_id is required for an entry': 'project_required',
    'driver_id is required for an entry': 'driver_required',
    'invalid driver_id': 'driver_required',
    'no prior entry found for this equipment': 'no_prior_entry',
    'sequence would be invalid': 'invalid_sequence',
  }
  for (const [message, code] of Object.entries(cases)) {
    assert.equal(movementErrorCode(message), code)
    assert.equal(movementErrorStatus(code), 409)
  }
})

test('an unknown database message never leaks and stays generic', () => {
  assert.equal(
    movementErrorCode(
      'duplicate key value violates unique constraint "entry_exit_logs_pkey"',
    ),
    'movement_save_failed',
  )
  assert.equal(movementErrorStatus('movement_save_failed'), 409)
})

test('a role rejection from the trigger is a 403 access denial', () => {
  assert.equal(movementErrorCode('foreman role required'), 'access_denied')
  assert.equal(movementErrorStatus('access_denied'), 403)
})

// The helper runs in a vm realm, so its objects are compared field by field.
function assertArgs(actual, expected) {
  assert.equal(actual.p_search, expected.p_search)
  assert.equal(actual.p_ownership_status, expected.p_ownership_status)
  assert.equal(actual.p_plate_digits, expected.p_plate_digits)
}

test('the exit equipment search sends null instead of empty arguments', () => {
  assertArgs(siteExitEquipmentArgs('', ''), {
    p_search: null,
    p_ownership_status: null,
    p_plate_digits: null,
  })
  assertArgs(siteExitEquipmentArgs('  ', 'alazani'), {
    p_search: null,
    p_ownership_status: 'alazani',
    p_plate_digits: null,
  })
})

test('a digits-only term still probes plate digits', () => {
  assertArgs(siteExitEquipmentArgs('4821', ''), {
    p_search: '4821',
    p_ownership_status: null,
    p_plate_digits: '4821',
  })
  assert.equal(siteExitEquipmentArgs('48 21', '').p_plate_digits, '4821')
})

test('a code-like term stays plain text and never becomes plate parts', () => {
  // Same regression as the movement log search: "a341" must not be split.
  const args = siteExitEquipmentArgs('a341', '')
  assert.equal(args.p_search, 'a341')
  assert.equal(args.p_plate_digits, null)
})
