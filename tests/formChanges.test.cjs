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
  // 0182: a new supplier passes its id so its details open next.
  assert.match(form, /onOpenChange\(false\)\s+(?:\/\/[^\n]*\s+)?onSaved\(lessor \? undefined : result\.data\?\.\[0\]\?\.id\)/)
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

test('the redesigned details dialogs (owner «حسن الdialog حق التفاصيل … خليها جمالي اكثر»)', () => {
  const shared = read('src', 'components', 'parties', 'PartyDetailsDialog.tsx')
  const has = (text, piece) => assert.ok(text.includes(piece), piece)
  // Header: avatar, name, the muted line under it and the completeness ring.
  has(shared, '<CompletenessRing value={completeness} />')
  has(shared, '{subheading && <p className="text-sm text-muted">{subheading}</p>}')
  // One soft card per section, the facts as a definition list in two columns.
  has(shared, 'className="rounded-xl border bg-[var(--surface)] p-4"')
  has(shared, '<dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">')
  // Empty: «غير مسجل»; copy to the clipboard; links for the phone and mail.
  has(shared, "t('detailsNotRecorded')")
  // Owner «غير مسجل خليها لون افتح»: the lighter placeholder token.
  has(shared, 'className="text-xs font-normal text-placeholder"')
  has(shared, 'navigator.clipboard.writeText(value)')
  assert.doesNotMatch(shared, /#[0-9a-f]{3,6}\b/i)
  for (const [file, fields] of [
    [['src', 'screens', 'lessors', 'LessorDetailsDialog.tsx'], 'LESSOR_COMPLETENESS_FIELDS'],
    [['src', 'screens', 'companies', 'CompanyDetailsDialog.tsx'], 'COMPANY_COMPLETENESS_FIELDS'],
  ]) {
    const dialog = read(...file)
    has(dialog, fields)
    has(dialog, 'href: telHref(')
    has(dialog, 'mailto:')
  }
  // The client's English name under the Arabic one, same edge (owner
  // «… مفروض يكون تحت بعض»): a line of its own, only the name LTR.
  const company = read('src', 'screens', 'companies', 'CompanyDetailsDialog.tsx')
  has(company, '<bdi dir="ltr">{company.name_en}</bdi>')
  // The sidebar's icons (owner «ايقونة الشركات في السايدبار خليها هي في
  // التفاصيل … ونفس الشي للموردين»): Briefcase for clients, Building2 for
  // suppliers, as NAV_ICONS in src/App.tsx.
  const app = read('src', 'App.tsx')
  has(app, "companies: { label: 'companies', icon: <Briefcase size={18} /> }")
  has(app, "lessors: { label: 'lessors', icon: <Building2 size={18} /> }")
  has(company, 'icon={<Briefcase size={22} />}')
  has(read('src', 'screens', 'lessors', 'LessorDetailsDialog.tsx'), 'icon={<Building2 size={22} />}')
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/detailsNotRecorded:/g).length, 2)
})
