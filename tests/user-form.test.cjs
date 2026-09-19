const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// src/lib/userForm.ts only has type-only imports, so it loads on its own.
function loadUserForm() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'userForm.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const userForm = loadUserForm()
const ROLES = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]

test('USER_ROLES lists every role exactly once', () => {
  assert.deepEqual([...userForm.USER_ROLES].sort(), [...ROLES].sort())
  assert.equal(
    new Set(userForm.USER_ROLES).size,
    userForm.USER_ROLES.length,
    'no duplicate roles',
  )
})

test('every role maps to a badge tone and a translation key', () => {
  for (const role of ROLES) {
    const badge = userForm.roleBadge(role)
    assert.equal(typeof badge.tone, 'string')
    assert.equal(typeof badge.key, 'string')
  }
})

test('admin is visually distinct from the other roles', () => {
  const nonAdminTones = new Set(
    ROLES.filter((role) => role !== 'admin').map(
      (role) => userForm.roleBadge(role).tone,
    ),
  )
  assert.equal(nonAdminTones.size, 1, 'the non-admin roles share one tone')
  assert.notEqual(userForm.roleBadge('admin').tone, [...nonAdminTones][0])
})

test('an unrecognized role fails closed to a neutral, unlabeled badge', () => {
  const badge = userForm.roleBadge('unknown_role')
  assert.equal(badge.tone, 'neutral')
  assert.equal(badge.key, 'unknownRole')
  for (const role of ROLES) {
    assert.notEqual(
      badge.key,
      userForm.roleBadge(role).key,
      'must not read as an existing role label',
    )
  }
})
