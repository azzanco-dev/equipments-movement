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

const projectForm = loadLibModule('projectForm')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const assertErrors = (actual, expected) =>
  assert.deepEqual(plain(actual), expected)
const base = () => plain(projectForm.EMPTY_PROJECT_FORM)

test('both the Arabic and English names are mandatory', () => {
  assertErrors(projectForm.validateProjectForm(base()), {
    name_ar: 'projectNameArRequired',
    name_en: 'projectNameEnRequired',
  })
  assertErrors(
    projectForm.validateProjectForm({ ...base(), name_ar: 'مشروع الرياض' }),
    { name_en: 'projectNameEnRequired' },
  )
  assertErrors(
    projectForm.validateProjectForm({
      name_ar: 'مشروع الرياض',
      name_en: 'Riyadh Project',
    }),
    {},
  )
})

test('the payload trims both names', () => {
  const payload = plain(
    projectForm.buildProjectPayload({
      name_ar: '  مشروع الرياض  ',
      name_en: '  Riyadh Project  ',
    }),
  )
  assertErrors(payload, {
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
  assertErrors(values, {
    name_ar: 'مشروع الرياض',
    name_en: 'Riyadh Project',
  })
})
