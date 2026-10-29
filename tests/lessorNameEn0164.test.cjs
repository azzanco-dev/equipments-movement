// Migration 0164 (owner 2026-10-29, «والمورد عربي وانجليزي»): the supplier
// carries an optional English name, entered in the supplier form and printed
// under the Arabic name on the bilingual supplier PO PDF.
//
// Source checks plus the pure party helper.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261029140000_0164_lessor_name_en.sql'
const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()

/** Loads src/lib/purchasing.ts (its only runtime import is pure). */
function loadLib(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Intl,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

test('0164 is the single 0164 migration, after 0163', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0164 present')
  assert.match(migrations[at - 1], /_0163_/)
  assert.equal(migrations.filter((file) => /_0164_/.test(file)).length, 1)
})

test('the column: optional, never blank, at most 200 characters', () => {
  assert.match(sql, /alter table public\.lessors add column if not exists name_en text;/)
  assert.match(
    sql,
    /add constraint lessors_name_en_check check \(name_en is null or \(btrim\(name_en\) <> '' and char_length\(name_en\) <= 200\)\);/,
  )
  // A plain column: no function, view, policy or grant.
  assert.doesNotMatch(sql, /create (or replace )?(function|view)|policy|grant/i)
})

test('the supplier form edits it and saves a blank as null', () => {
  const form = read('src', 'lib', 'lessorForm.ts')
  assert.match(form, /name_en: form\.name_en\.trim\(\) \|\| null,/)
  assert.match(form, /name_en: lessor\.name_en \?\? '',/)
  const dialog = read('src', 'screens', 'lessors', 'LessorFormDialog.tsx')
  assert.match(dialog, /label=\{t\('lessorNameEn'\)\}\s+name="name_en"/)
  assert.match(dialog, /dir="ltr"\s+maxLength=\{200\}/)
  assert.match(
    read('src', 'screens', 'lessors', 'LessorsListScreen.tsx'),
    /'id,name,name_en,contact_person,contact_number,created_at,updated_at'/,
  )
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of ['lessorNameEn', 'lessorNameEnPlaceholder', 'lessorNameEnHint']) {
    assert.equal(translations.split(`    ${key}: `).length, 3, key)
  }
})

test('the PO reads it and the PDF prints it under the Arabic name', () => {
  assert.match(read('src', 'lib', 'purchasingData.ts'), /lessor:lessors\(id,name,name_en\),company/)
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(sheet, /const supplier = supplierPoSupplierNames\(po, ar, en\)/)
  assert.match(sheet, /\{supplier\.ar\}\s+\{supplier\.en && \(\s+<>\s+<br \/>\s+<En>\{supplier\.en\}<\/En>/)
  assert.doesNotMatch(read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'), /supplier=\{/)
})

test('supplierPoSupplierNames: owner class, lessor, internal', () => {
  const { supplierPoSupplierNames } = loadLib('purchasing')
  const ar = (key) => `ar:${key}`
  const en = (key) => `en:${key}`
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: false, owner_class: 'takween', lessor: null }, ar, en)),
    { ar: 'ar:supplierPoOwnerTakween', en: 'en:supplierPoOwnerTakween' },
  )
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: false, lessor: { name: ' اركاس ', name_en: ' Arkas ' } }, ar, en)),
    { ar: 'اركاس', en: 'Arkas' },
  )
  // No English name yet: the Arabic alone.
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: false, lessor: { name: 'اركاس', name_en: '  ' } }, ar, en)),
    { ar: 'اركاس', en: null },
  )
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: true, lessor: null }, ar, en)),
    { ar: 'ar:supplierPoInternalSupplier', en: 'en:supplierPoInternalSupplier' },
  )
})
