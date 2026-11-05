const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-05 («نهاية كل صف … درجة اكمال البيانات … دائرة احمر اصفر
// اخضر، سويها على الموردين بشوف اول»): the completeness ring of the
// suppliers list.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const lib = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'partyCompleteness.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Math, require: () => ({}) })
  return exports
})()

test('every field of the supplier form counts, the name included', () => {
  const fields = lib.LESSOR_COMPLETENESS_FIELDS.map((f) => f.field)
  // Owner 2026-11-05 took the city out of the form («شيل المدينة»).
  assert.equal(fields.length, 10)
  assert.ok(!fields.includes('city'))
  for (const field of ['name', 'tax_number', 'short_address', 'bank_name', 'iban'])
    assert.ok(fields.includes(field), field)
  // Every counted field is selected by the list (the ring reads the row).
  const select = /const LIST_SELECT =\s+'([^']+)'/.exec(
    read('src', 'screens', 'lessors', 'LessorsListScreen.tsx'),
  )[1].split(',')
  for (const field of fields) assert.ok(select.includes(field), field)
})

test('the share, its colour and the missing fields', () => {
  const { partyCompleteness, LESSOR_COMPLETENESS_FIELDS: F } = lib
  const only = partyCompleteness({ name: 'مؤسسة', email: '  ' }, F)
  assert.equal(only.filled, 1)
  assert.equal(only.percent, 10)
  assert.equal(only.tone, 'danger')
  assert.equal(only.missing.length, 9)
  assert.equal(only.missing[0], 'taxNumber')
  const full = Object.fromEntries(F.map((f) => [f.field, 'x']))
  assert.equal(partyCompleteness(full, F).tone, 'success')
  assert.equal(partyCompleteness(full, F).percent, 100)
  // Owner 2026-11-05: green from 90 % («خلي الاخضر عند 90»); 72 is yellow.
  const almost = { ...full, iban: null }
  assert.equal(partyCompleteness(almost, F).percent, 90)
  assert.equal(partyCompleteness(almost, F).tone, 'success')
  assert.equal(lib.completenessTone(49), 'danger')
  assert.equal(lib.completenessTone(50), 'warning')
  assert.equal(lib.completenessTone(72), 'warning')
  assert.equal(lib.completenessTone(89), 'warning')
})

test('the ring is the last column of the suppliers table, in token colours', () => {
  const table = read('src', 'screens', 'lessors', 'LessorsTable.tsx')
  const last = table.lastIndexOf("key: '")
  assert.equal(table.slice(last, last + 19), "key: 'completeness'")
  const ring = read('src', 'components', 'parties', 'CompletenessRing.tsx')
  // Light shades with a dark number (owner «خلي الالوان فاتحة»).
  assert.match(ring, /danger: 'var\(--progress-low\)'/)
  assert.match(ring, /warning: 'var\(--progress-mid\)'/)
  assert.match(ring, /success: 'var\(--progress-high\)'/)
  assert.match(ring, /text-\[var\(--fg\)\]/)
  const css = read('src', 'index.css')
  for (const token of ['--progress-low', '--progress-mid', '--progress-high'])
    assert.equal(css.match(new RegExp(`  ${token}: #`, 'g')).length, 2, token)
  assert.doesNotMatch(ring, /#[0-9a-f]{3,6}\b/i)
  assert.match(ring, /aria-label=\{summary\}/)
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/completenessSummary:/g).length, 2)
  assert.doesNotMatch(/completeness: '([^']*)'/.exec(tr)[1], /[أإآ]/)
})

test('the companies list ends with the same ring over the client form', () => {
  // Owner 2026-11-05: «اعتمد التعديلات هذي للشركات».
  const fields = [...lib.COMPANY_COMPLETENESS_FIELDS.map((f) => f.field)]
  assert.deepEqual(fields, [
    'name_ar',
    'name_en',
    'tax_number',
    'commercial_register',
    'short_address',
    'address',
    'contact_person',
    'contact_number',
    'email',
  ])
  const select = /const LIST_SELECT =\s+'([^']+)'/.exec(
    read('src', 'screens', 'companies', 'CompaniesListScreen.tsx'),
  )[1].split(',')
  for (const field of fields) assert.ok(select.includes(field), field)
  const table = read('src', 'screens', 'companies', 'CompaniesTable.tsx')
  const last = table.lastIndexOf("key: '")
  assert.equal(table.slice(last, last + 19), "key: 'completeness'")
  assert.match(table, /partyCompleteness\(row, COMPANY_COMPLETENESS_FIELDS\)/)
})

test('the ring shows the percent sign (owner «اضف نسبة داخل الدايرة»)', () => {
  const ring = read('src', 'components', 'parties', 'CompletenessRing.tsx')
  assert.match(ring, /\{value\.percent\}\s+\{\/\*[^*]*\*\/\}\s+<span className="text-\[8px\]">%<\/span>/)
  assert.match(ring, /const SIZE = 38/)
})
