const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-23, approved in Figma («اعتمد»): Settings › «البنوك» as wide
// tiles — the logo, the name and a «...» menu with «تعديل» / «حذف»; no
// counts on the tile («شيل منها الموردين والجهات»), but a bank in use by a
// supplier, a financier or a contract has «حذف» locked with its reason.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const lib = (() => {
  const code = ts.transpileModule(read('src', 'lib', 'banks.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => ({}), Map, Object })
  return exports
})()

test('the use is read with the bank, the installments only for their readers', () => {
  assert.equal(lib.banksSelect(false), 'id,name,lessors(count)')
  assert.equal(
    lib.banksSelect(true),
    'id,name,lessors(count),installment_financiers(count),installment_contracts(count)',
  )
  const page = read('src', 'components', 'banks', 'BanksSettings.tsx')
  assert.match(page, /const withInstallments = permissions\.can\('installments\.view'\)/)
  assert.match(page, /usage: bankUsageCount\(row\)/)
})

test('the use adds suppliers, financiers and contracts', () => {
  assert.equal(lib.bankUsageCount({ lessors: [{ count: 0 }] }), 0)
  assert.equal(
    lib.bankUsageCount({
      lessors: [{ count: 2 }],
      installment_financiers: [{ count: 4 }],
      installment_contracts: [{ count: 5 }],
    }),
    11,
  )
  // A contract alone (the financier's bank differs) still counts.
  assert.equal(lib.bankUsageCount({ lessors: [], installment_contracts: [{ count: 1 }] }), 1)
  assert.equal(lib.bankUsageCount({}), 0)
})

test('any foreign key refusal reads «مستخدم», not «لموردين»', () => {
  assert.equal(lib.bankInUse({ code: '23503' }), true)
  assert.equal(lib.bankInUse({ code: '23505' }), false)
  const tr = read('src', 'i18n', 'translations.ts')
  assert.match(tr, /bankInUse: 'لا يمكن حذف البنك لانه مستخدم\.'/)
  assert.doesNotMatch(tr, /مستخدم لموردين/)
})

test('tiles with a «...» menu; delete locked for a used bank; no table, no counts', () => {
  const page = read('src', 'components', 'banks', 'BanksSettings.tsx')
  assert.doesNotMatch(page, /DataTable|RelativeTime|linkedLessorsCount|updated_at/)
  assert.match(page, /grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4/)
  assert.match(page, /<BankLogo name=\{row\.name\} \/>/)
  assert.match(page, /\{canEdit && \(\s*<BankOptionsMenu/)
  assert.match(page, /const used = row\.usage > 0/)
  assert.match(page, /disabled=\{used\}/)
  assert.match(page, /t\('bankUsedCannotDelete'\)/)
  // The edit dialog: the rename notice, and the logo warning when it has one.
  assert.match(page, /\{editing && \(\s*<Notice tone="info"/)
  assert.match(page, /\{editingHasLogo && \(\s*<Notice tone="warning"/)
})

test('the new Arabic copy of the tiles has no hamza on the alif', () => {
  const tr = read('src', 'i18n', 'translations.ts')
  for (const block of tr.match(/\/\/ banks — start[\s\S]*?\/\/ banks — end/g))
    assert.doesNotMatch(block.split('// the tiles')[1] ?? '', /[أإآ]/)
})
