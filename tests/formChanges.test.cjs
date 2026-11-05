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
  assert.match(form, /const changed = changedSet\.size/)
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

test('each changed field is coloured until saved (owner «تعلم لون على الحقل الي تعدل»)', () => {
  const form = read('src', 'screens', 'lessors', 'LessorFormDialog.tsx')
  // Editing only: a new record is not marked (owner «مايحتاج … مستند جديد»).
  assert.match(form, /new Set<string>\(\s*(lessor|company) \? changedFields\(initial, form\) : \[\],?\s*\)/)
  // The three sections, the name and the bank all follow the set.
  assert.equal(form.match(/changed=\{changedSet\}/g).length, 3)
  assert.match(form, /changedSet\.has\('name'\) \? CHANGED_CONTROL_CLASS : undefined/)
  assert.match(form, /changedSet\.has\('bank_name'\)/)
  const section = read('src', 'components', 'parties', 'PartyFormSection.tsx')
  assert.match(section, /const isChanged = !!changed\?\.has\(spec\.field\)/)
  assert.match(section, /isChanged \? CHANGED_CONTROL_CLASS : undefined/)
  assert.match(section, /changed=\{isChanged\}/)
  const mark = read('src', 'components', 'parties', 'changedField.tsx')
  // Token colours only: light blue (owner «خليه ازرق»).
  assert.ok(
    mark.includes(
      'border-[color-mix(in_srgb,var(--info)_55%,transparent)] bg-[var(--info-soft)]',
    ),
  )
  assert.doesNotMatch(mark, /progress-mid/)
  assert.doesNotMatch(mark, /#[0-9a-f]{3,6}\b/i)
  assert.match(mark, /<span className="sr-only">\{t\('fieldChanged'\)\}<\/span>/)
  assert.match(
    read('src', 'components', 'parties', 'ShortAddressInput.tsx'),
    /changed && CHANGED_CONTROL_CLASS/,
  )
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/fieldChanged:/g).length, 2)
})

test('the supplier details dialog is wide (owner «وسع dialog تفاصيل المورد»)', () => {
  assert.match(read('src', 'screens', 'lessors', 'LessorDetailsDialog.tsx'), /size="lg"/)
  assert.match(read('src', 'components', 'parties', 'PartyDetailsDialog.tsx'), /size={size}/)
})

test('the client form and details follow the supplier ones (owner «اعتمد التعديلات هذي للشركات»)', () => {
  const form = read('src', 'screens', 'companies', 'CompanyFormDialog.tsx')
  // Editing only: a new record is not marked (owner «مايحتاج … مستند جديد»).
  assert.match(form, /new Set<string>\(\s*(lessor|company) \? changedFields\(initial, form\) : \[\],?\s*\)/)
  assert.equal(form.match(/changed=\{changedSet\}/g).length, 2)
  assert.match(form, /changedSet\.has\('name_ar'\) \? CHANGED_CONTROL_CLASS : undefined/)
  assert.match(form, /changedSet\.has\('name_en'\) \? CHANGED_CONTROL_CLASS : undefined/)
  assert.match(form, /t\('unsavedFieldsCount'\)\.replace\('\{count\}', String\(changed\)\)/)
  assert.match(form, /disabled=\{!!company && !dirty\}/)
  assert.match(form, /title: t\('unsavedChanges'\)/)
  assert.match(form, /\{confirmDialog\}/)
  assert.match(form, /size="lg"/)
  assert.match(read('src', 'screens', 'companies', 'CompanyDetailsDialog.tsx'), /size="lg"/)
})

test('the client details heading: the English name under the Arabic one, same edge', () => {
  const dialog = read('src', 'screens', 'companies', 'CompanyDetailsDialog.tsx')
  assert.match(dialog, /<span className="block text-sm font-normal text-muted">\s+<bdi dir="ltr">\{company\.name_en\}<\/bdi>/)
  assert.doesNotMatch(dialog, /text-muted" dir="ltr"/)
})
