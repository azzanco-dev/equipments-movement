// The supplier's English name: added by migration 0164 (owner 2026-10-29,
// «والمورد عربي وانجليزي») and taken out again the same day («معليش نقدر نلغي
// الاسم الانجليزي للمورد؟»): no screen reads or writes `lessors.name_en`, and
// migration 0165 drops the column once those screens are live.
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

const ADD = '20261029140000_0164_lessor_name_en.sql'
const DROP = '20261029150000_0165_drop_lessor_name_en.sql'
const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (file) =>
  read('supabase', 'migrations', file)
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

test('0164 stays applied history; 0165 follows it and drops the column', () => {
  const at = migrations.indexOf(ADD)
  assert.ok(at > 0, 'migration 0164 present')
  assert.match(migrations[at - 1], /_0163_/)
  assert.equal(migrations[at + 1], DROP)
  assert.equal(migrations.filter((file) => /_0165_/.test(file)).length, 1)
  assert.match(norm(ADD), /alter table public\.lessors add column if not exists name_en text;/)
  const drop = norm(DROP)
  assert.match(drop, /alter table public\.lessors drop constraint if exists lessors_name_en_check;/)
  assert.match(drop, /alter table public\.lessors drop column if exists name_en;/)
  assert.doesNotMatch(drop, /create|grant|policy|cascade/i)
})

test('no screen reads or writes the supplier English name', () => {
  const files = [
    ['src', 'lib', 'lessorForm.ts'],
    ['src', 'lib', 'purchasing.ts'],
    ['src', 'screens', 'lessors', 'LessorFormDialog.tsx'],
    ['src', 'screens', 'lessors', 'LessorsListScreen.tsx'],
    ['src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx'],
  ]
  for (const parts of files) {
    assert.doesNotMatch(read(...parts), /name_en|lessorNameEn/, parts.join('/'))
  }
  const lessorType = /export interface Lessor {[^}]*}/.exec(read('src', 'lib', 'types.ts'))[0]
  assert.doesNotMatch(lessorType, /name_en/)
  const lessorRef = /export interface LessorRef {[^}]*}/.exec(read('src', 'lib', 'purchasingData.ts'))[0]
  assert.doesNotMatch(lessorRef, /name_en/)
  assert.match(
    read('src', 'screens', 'lessors', 'LessorsListScreen.tsx'),
    /'id,name,contact_person,contact_number,created_at,updated_at'/,
  )
  assert.match(read('src', 'lib', 'purchasingData.ts'), /lessor:lessors\(id,name\),company/)
  assert.doesNotMatch(read('src', 'i18n', 'translations.ts'), /lessorNameEn/)
})

test('supplierPoSupplierNames: an owner class in both languages, a lessor in Arabic only', () => {
  const { supplierPoSupplierNames } = loadLib('purchasing')
  const ar = (key) => `ar:${key}`
  const en = (key) => `en:${key}`
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: false, owner_class: 'takween', lessor: null }, ar, en)),
    { ar: 'ar:supplierPoOwnerTakween', en: 'en:supplierPoOwnerTakween' },
  )
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: false, lessor: { name: ' اركاس ' } }, ar, en)),
    { ar: 'اركاس', en: null },
  )
  assert.deepEqual(
    plain(supplierPoSupplierNames({ is_internal: true, lessor: null }, ar, en)),
    { ar: 'ar:supplierPoInternalSupplier', en: 'en:supplierPoInternalSupplier' },
  )
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(sheet, /const supplier = supplierPoSupplierNames\(po, ar, en\)/)
})
