const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
// Type-only imports (`@/i18n`) are erased by the transpile step.
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

/** vm-realm objects have a foreign prototype, so compare plain copies. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)

const v = loadLibModule('formValidation')

test('fieldErrors keeps only the fields that failed', () => {
  assertErrors(v.fieldErrors({ a: undefined, b: undefined }), {})
  assertErrors(v.fieldErrors({ a: 'plateRequired', b: undefined }), {
    a: 'plateRequired',
  })
})

test('hasErrors is false for a valid form', () => {
  assert.equal(v.hasErrors({}), false)
  assert.equal(v.hasErrors({ a: undefined }), false)
  assert.equal(v.hasErrors({ a: 'plateRequired' }), true)
})

test('firstErrorField follows the visual order, not the object order', () => {
  const order = ['first', 'second', 'third']
  assert.equal(
    v.firstErrorField({ third: 'saveFailed', second: 'plateRequired' }, order),
    'second',
  )
  assert.equal(v.firstErrorField({ first: 'saveFailed' }, order), 'first')
  assert.equal(v.firstErrorField({}, order), null)
  // A field outside the order is never picked.
  assert.equal(v.firstErrorField({ other: 'saveFailed' }, order), null)
})

test('clearFieldErrors drops only the edited fields', () => {
  const errors = { a: 'plateRequired', b: 'saveFailed' }
  assertErrors(v.clearFieldErrors(errors, ['a']), { b: 'saveFailed' })
  // Nothing to clear returns the same object, so React does not re-render.
  assert.equal(v.clearFieldErrors(errors, ['c']), errors)
})

test('required fails on a missing or blank value only', () => {
  assert.equal(v.required('', 'plateRequired'), 'plateRequired')
  assert.equal(v.required('   ', 'plateRequired'), 'plateRequired')
  assert.equal(v.required(null, 'plateRequired'), 'plateRequired')
  assert.equal(v.required('A145', 'plateRequired'), undefined)
})

test('pattern and digitsRange leave an empty optional field alone', () => {
  assert.equal(v.pattern('', /^\d+$/, 'plateRequired'), undefined)
  assert.equal(v.pattern('  ', /^\d+$/, 'plateRequired'), undefined)
  assert.equal(v.pattern('12a', /^\d+$/, 'plateRequired'), 'plateRequired')
  assert.equal(v.pattern(' 123 ', /^\d+$/, 'plateRequired'), undefined)
  assert.equal(v.digitsRange('', 5, 20, 'plateRequired'), undefined)
  assert.equal(v.digitsRange('123', 5, 20, 'plateRequired'), 'plateRequired')
  assert.equal(v.digitsRange('1023456789', 5, 20, 'plateRequired'), undefined)
})

test('duplicateFieldErrors only maps a unique violation it can name', () => {
  const rules = [
    { match: 'name_ar', field: 'name_ar', key: 'duplicateCompany' },
  ]
  assertErrors(
    v.duplicateFieldErrors(
      { code: '23505', message: 'duplicate key ... "idx_companies_name_ar"' },
      rules,
    ),
    { name_ar: 'duplicateCompany' },
  )
  // A different constraint, a different error code, or no error at all stays
  // unattributed so the caller shows its own safe top-level message.
  assert.equal(
    v.duplicateFieldErrors({ code: '23505', message: 'other_idx' }, rules),
    null,
  )
  assert.equal(
    v.duplicateFieldErrors({ code: '23503', message: 'name_ar' }, rules),
    null,
  )
  assert.equal(v.duplicateFieldErrors(null, rules), null)
})
