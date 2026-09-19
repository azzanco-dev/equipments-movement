const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// src/lib/projectForm.ts only has type-only imports, so it loads on its own.
function loadProjectForm() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'projectForm.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const projectForm = loadProjectForm()
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const base = () => plain(projectForm.EMPTY_PROJECT_FORM)

test('both the Arabic and English names are mandatory', () => {
  assert.equal(
    projectForm.validateProjectForm(base()),
    'projectValidationError',
  )
  assert.equal(
    projectForm.validateProjectForm({ ...base(), name_ar: 'مشروع الرياض' }),
    'projectValidationError',
  )
  assert.equal(
    projectForm.validateProjectForm({
      name_ar: 'مشروع الرياض',
      name_en: 'Riyadh Project',
    }),
    null,
  )
})

test('the payload trims both names', () => {
  const payload = plain(
    projectForm.buildProjectPayload({
      name_ar: '  مشروع الرياض  ',
      name_en: '  Riyadh Project  ',
    }),
  )
  assert.deepEqual(payload, {
    name_ar: 'مشروع الرياض',
    name_en: 'Riyadh Project',
  })
})

test('a record maps onto the form as-is', () => {
  const values = plain(
    projectForm.projectFormValues({
      id: 'project-1',
      name_ar: 'مشروع الرياض',
      name_en: 'Riyadh Project',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }),
  )
  assert.deepEqual(values, {
    name_ar: 'مشروع الرياض',
    name_en: 'Riyadh Project',
  })
})
