const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// src/lib/lessorForm.ts only has type-only imports, so it loads on its own.
function loadLessorForm() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'lessorForm.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const lessorForm = loadLessorForm()
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const base = () => plain(lessorForm.EMPTY_LESSOR_FORM)

test('only the name is mandatory', () => {
  assert.equal(lessorForm.validateLessorForm(base()), 'lessorNameRequired')
  assert.equal(
    lessorForm.validateLessorForm({ ...base(), name: '  ' }),
    'lessorNameRequired',
  )
  assert.equal(
    lessorForm.validateLessorForm({ ...base(), name: 'مؤسسة النقل' }),
    null,
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
  assert.deepEqual(payload, {
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
  assert.deepEqual(values, {
    name: 'مؤسسة النقل',
    contact_person: '',
    contact_number: '',
  })
})
