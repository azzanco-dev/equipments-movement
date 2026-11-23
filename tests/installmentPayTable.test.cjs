const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «جدول السداد» of the contract page (owner 2026-11-23: «نبغى نشتغل على صفحة
// تفاصيل العقد وخصوصا جدول الاقساط», model 1 of the table approved, then
// «الكارد حق الدفعات والضريبة, سوي منه نماذج اخرى», «نموذج C», «ابدا»):
// one card in place of «الدفعات الاولى», «جدول الاقساط» and «دفعة الضريبة».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      String,
      Array,
      Map,
      Set,
      BigInt,
      Intl,
      URLSearchParams,
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

const view = loadLibModule('installmentsView')
const TABLE = read('src', 'components', 'installments', 'ContractPaymentTable.tsx')
const PAGE = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')

const rows = (paidCount, total) =>
  Array.from({ length: total }, (_, index) => ({ seq: index + 1, paid: index < paidCount }))
// Array.from: a list copied inside the module belongs to its own realm.
const seqs = (list) => Array.from(list, (row) => row.seq)

test('the near installments: one before the first unpaid, six at most', () => {
  assert.equal(view.NEAR_INSTALLMENTS, 6)
  // 24 installments, 10 paid: from the 10th (the last paid) on.
  assert.deepEqual(seqs(view.nearInstallments(rows(10, 24))), [10, 11, 12, 13, 14, 15])
  // Nothing paid: the first six.
  assert.deepEqual(seqs(view.nearInstallments(rows(0, 24))), [1, 2, 3, 4, 5, 6])
  // Near the end: the last six, never fewer.
  assert.deepEqual(seqs(view.nearInstallments(rows(22, 24))), [19, 20, 21, 22, 23, 24])
  // Everything paid: the last six.
  assert.deepEqual(seqs(view.nearInstallments(rows(24, 24))), [19, 20, 21, 22, 23, 24])
  // A short list is shown whole.
  assert.deepEqual(seqs(view.nearInstallments(rows(2, 4))), [1, 2, 3, 4])
})

test('the page shows one «جدول السداد» in place of the three cards', () => {
  assert.match(PAGE, /<ContractPaymentTable\b/)
  assert.doesNotMatch(PAGE, /FirstPaymentsCard|VatPaymentCard|PayableRowCard/)
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'components', 'installments', 'InstallmentPayableRows.tsx')))
  // The table's actions follow the key and the contract's state.
  assert.match(PAGE, /canAct=\{canManage && active\}/)
  assert.match(PAGE, /canName=\{canManage && !cancelled\}/)
  assert.match(PAGE, /onPay=\{payRow\}/)
  assert.match(PAGE, /onName=\{\(row\) => open\(\{ kind: 'row_name', row \}\)\}/)
  assert.match(PAGE, /onSetDate=\{\(row\) => open\(\{ kind: 'payment_date', row \}\)\}/)
})

test('the table: three groups, one grid, «تسديد» per row, «...» for the rest', () => {
  // The groups in their order: the first payments, the installments, the VAT.
  assert.ok(TABLE.indexOf("key: 'first'") < TABLE.indexOf("key: 'installments'"))
  assert.ok(TABLE.indexOf("key: 'installments'") < TABLE.indexOf("key: 'vat'"))
  // The head and every row share one grid, so the columns line up.
  assert.match(TABLE, /const GRID =\n\s*'md:grid md:grid-cols-\[/)
  assert.equal([...TABLE.matchAll(/\bGRID,/g)].length, 2)
  // «تسديد» pays THAT row; the late one is the primary button.
  assert.match(TABLE, /variant=\{late \? 'primary' : 'outline'\}\n\s*onClick=\{\(\) => onPay\(row\)\}/)
  assert.match(TABLE, /canAct && !paid && \(/)
  // «تسمية» for an installment, «تحديد التاريخ» for an undated payment.
  assert.match(TABLE, /const canSetDate = canAct && !paid && row\.kind !== 'installment' && !date/)
  assert.match(TABLE, /const canRename = canName && row\.kind === 'installment'/)
  // A late row is tinted, a paid one muted, a paid row says when.
  assert.match(TABLE, /late && 'bg-danger-soft'/)
  assert.match(TABLE, /t\('instPaidOnShort'\)\.replace\('\{date\}', formatDate\(paidOn\)\)/)
  // The near installments until «عرض كل الاقساط».
  assert.match(TABLE, /const shownInstallments = showAll \? viewInstallments : nearRows/)
  // The count covers the installments still to be divided.
  assert.match(TABLE, /allRows\.length \+ \(waiting \? contract\.installment_count : 0\)/)
  // A cancelled contract owes nothing.
  assert.match(TABLE, /<Money value=\{cancelled \? 0 : contract\.remaining_total\} \/>/)
})

test('the copy of both languages, no alif with hamza or madda', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ installment-pay-table \(2026-11-23\)\n([\s\S]*?)\/\/ end installment-pay-table \(2026-11-23\)/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const keys = (block) => [...block.matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0][1]), keys(blocks[1][1]))
  for (const key of keys(blocks[0][1])) assert.match(TABLE, new RegExp(`'${key}'`), key)
})

// «صغر المسافات والقابز والخطوط شوي», «وخصوصا كروت الارقام», «والجانبية».
test('the contract page is tighter: small figures, dense facts, compact files', () => {
  assert.equal([...PAGE.matchAll(/<StatCard\n\s+size="sm"/g)].length, 4)
  assert.match(PAGE, /<DescriptionList items=\{facts\} dense /)
  assert.match(PAGE, /<div className="card space-y-3 p-3">/)
  const stat = read('src', 'components', 'ui', 'StatCard.tsx')
  // Opt-in: every other screen keeps the default size.
  assert.match(stat, /size = 'md',/)
  assert.match(stat, /small \? 'text-lg' : 'text-2xl'/)
  const list = read('src', 'components', 'ui', 'DescriptionList.tsx')
  assert.match(list, /dense = false,/)
  const files = read('src', 'components', 'installments', 'InstallmentContractFiles.tsx')
  assert.match(files, /size=\{file\.size_bytes\}\n\s+compact\n/)
  assert.match(TABLE, /text-\[13px\]/)
})

// «التاب الافتراضي (الكل) وخليه يمين اول واحد».
test('«الكل» is the first tab and the default view', () => {
  assert.match(TABLE, /const view: PaymentTableView = chosenView \?\? 'all'/)
  const all = TABLE.indexOf('<TabsTrigger value="all">')
  assert.ok(all > 0 && all < TABLE.indexOf('<TabsTrigger value="open">'))
  assert.ok(TABLE.indexOf('<TabsTrigger value="open">') < TABLE.indexOf('<TabsTrigger value="paid">'))
})
