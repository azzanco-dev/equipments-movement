const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the helpers are exercised exactly as the dialog uses them. Type-only
// imports (`@/i18n`, `@/components/ui`) are erased by the transpile step.
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

const lessorForm = loadLibModule('lessorForm')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)
const base = () => plain(lessorForm.EMPTY_LESSOR_FORM)

test('only the name is mandatory', () => {
  assertErrors(lessorForm.validateLessorForm(base()), {
    name: 'lessorNameRequired',
  })
  assertErrors(lessorForm.validateLessorForm({ ...base(), name: '  ' }), {
    name: 'lessorNameRequired',
  })
  // The contact details stay unvalidated, exactly as before.
  assertErrors(
    lessorForm.validateLessorForm({
      name: 'مؤسسة النقل',
      contact_person: '',
      contact_number: 'not-a-number',
    }),
    {},
  )
})

test('the payload trims text and turns empty optional fields into null', () => {
  const payload = plain(
    lessorForm.buildLessorPayload({
      name: '  مؤسسة النقل  ',
      contact_person: '  ',
      contact_number: '0500000000',
    }),
  )
  assertErrors(payload, {
    name: 'مؤسسة النقل',
    contact_person: null,
    contact_number: '0500000000',
  })
})

test('a record maps onto the form with nulls turned into empty strings', () => {
  const values = plain(
    lessorForm.lessorFormValues({
      id: 'lessor-1',
      name: 'مؤسسة النقل',
      contact_person: null,
      contact_number: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }),
  )
  assertErrors(values, {
    name: 'مؤسسة النقل',
    contact_person: '',
    contact_number: '',
  })
})
