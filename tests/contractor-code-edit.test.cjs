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
  CONTRACTOR_CODE_MAX_LENGTH,
  contractorCodeErrorKey,
  contractorCodeUnchanged,
  isValidContractorCode,
  normalizeContractorCode,
} = loadLibModule('contractorCodeEdit')

test('the contractor code is trimmed and an empty code clears the field', () => {
  assert.equal(normalizeContractorCode('  TK-114  '), 'TK-114')
  assert.equal(normalizeContractorCode('TK-114'), 'TK-114')
  assert.equal(normalizeContractorCode(''), null)
  assert.equal(normalizeContractorCode('   '), null)
})

test('the client length check mirrors the 50-character database check', () => {
  assert.equal(CONTRACTOR_CODE_MAX_LENGTH, 50)
  assert.equal(isValidContractorCode(''), true)
  assert.equal(isValidContractorCode('   '), true)
  assert.equal(isValidContractorCode('A'.repeat(50)), true)
  // Trailing spaces are trimmed first, so they never push a valid code over.
  assert.equal(isValidContractorCode(`${'A'.repeat(50)}   `), true)
  assert.equal(isValidContractorCode('A'.repeat(51)), false)
})

test('an unchanged code is detected so Save stays disabled', () => {
  assert.equal(contractorCodeUnchanged('TK-114', 'TK-114'), true)
  assert.equal(contractorCodeUnchanged('  TK-114 ', 'TK-114'), true)
  assert.equal(contractorCodeUnchanged('', null), true)
  assert.equal(contractorCodeUnchanged('   ', undefined), true)
  assert.equal(contractorCodeUnchanged('TK-115', 'TK-114'), false)
  // Clearing an existing code is a real change.
  assert.equal(contractorCodeUnchanged('', 'TK-114'), false)
  assert.equal(contractorCodeUnchanged('TK-114', null), false)
})

test('migration 0093 error tokens map to safe translation keys', () => {
  assert.equal(
    contractorCodeErrorKey('contractor_code_not_allowed'),
    'contractorCodeNotAllowed',
  )
  assert.equal(
    contractorCodeErrorKey('entry_not_accessible'),
    'contractorCodeNotAllowed',
  )
  assert.equal(
    contractorCodeErrorKey('visit_is_closed'),
    'contractorCodeVisitClosed',
  )
  assert.equal(
    contractorCodeErrorKey('contractor_code_too_long'),
    'contractorCodeTooLong',
  )
})

test('the PostgreSQL HINT that PostgREST appends does not confuse the mapping', () => {
  assert.equal(
    contractorCodeErrorKey(
      'visit_is_closed\nHINT: The visit is no longer open, so its contractor code cannot be edited.',
    ),
    'contractorCodeVisitClosed',
  )
  assert.equal(
    contractorCodeErrorKey(
      'entry_not_accessible\nHINT: No open site entry of yours matches this movement.',
    ),
    'contractorCodeNotAllowed',
  )
})

test('unknown and missing messages fall back to the generic failure', () => {
  assert.equal(contractorCodeErrorKey(null), 'contractorCodeUpdateFailed')
  assert.equal(contractorCodeErrorKey(undefined), 'contractorCodeUpdateFailed')
  assert.equal(contractorCodeErrorKey(''), 'contractorCodeUpdateFailed')
  // Raw PostgreSQL text must never reach the user as-is.
  assert.equal(
    contractorCodeErrorKey(
      'permission denied for table entry_exit_logs (SQLSTATE 42501)',
    ),
    'contractorCodeUpdateFailed',
  )
})
