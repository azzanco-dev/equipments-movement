const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-05 («لما يضاف تعديل جديد في احد الحقول, عطني شي يعلمني …
// تنبيه عام, او في زر الحفظ»): the supplier form says what is unsaved.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const { changedFields } = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'formChanges.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Object })
  return exports
})()

test('changedFields compares trimmed text and lists the changed keys', () => {
  const start = { name: 'مؤسسة', city: '', iban: 'SA1' }
  assert.deepEqual([...changedFields(start, { ...start })], [])
  assert.deepEqual([...changedFields(start, { ...start, city: '  ' })], [])
  assert.deepEqual(
    [...changedFields(start, { ...start, city: 'الرياض', iban: '' })],
    ['city', 'iban'],
  )
})

test('the supplier form: the count beside save, no empty save, ask before discarding', () => {
  const form = read('src', 'screens', 'lessors', 'LessorFormDialog.tsx')
  assert.match(form, /const changed = changedFields\(initial, form\)\.length/)
  assert.match(form, /setInitial\(start\)/)
  assert.match(form, /t\('unsavedFieldsCount'\)\.replace\('\{count\}', String\(changed\)\)/)
  assert.match(form, /disabled=\{!!lessor && !dirty\}/)
  assert.match(form, /\{lessor \? t\('saveChanges'\) : t\('save'\)\}/)
  assert.match(form, /title: t\('unsavedChanges'\)/)
  assert.match(form, /\{confirmDialog\}/)
  // A successful save closes without asking.
  assert.match(form, /onOpenChange\(false\)\s+onSaved\(\)/)
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/unsavedFieldsCount:/g).length, 2)
  assert.doesNotMatch(/unsavedFieldsCount: '([^']*)'/.exec(tr)[1], /[أإآ]/)
})
