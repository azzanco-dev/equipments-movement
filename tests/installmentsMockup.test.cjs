const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// /ui-kit «نموذج شاشات الاقساط» (owner 2026-11-18, «سويها في ui-kit»): the
// mockup is registered for review, and its in-memory store follows the rules
// of migration 0203 — a payment goes to the oldest unpaid row, a void takes
// it back, the money terms are locked by a posted payment — on sample data
// whose dates follow the given day.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function load(file, modules = {}) {
  const output = ts.transpileModule(read(...file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInContext(
    `(function (exports, require) {${output}\n})`,
    vm.createContext({}),
    { filename: file.join('/') },
  )(exports, (requested) => {
    if (requested in modules) return modules[requested]
    throw new Error(`Unexpected module: ${requested}`)
  })
  return exports
}

const lib = load(['src', 'lib', 'installments.ts'])
const data = load(['src', 'screens', 'ui-kit', 'installmentsMockupData.ts'], {
  '@/lib/installments': lib,
})
const mockup = read('src', 'screens', 'ui-kit', 'InstallmentsMockup.tsx')
const TODAY = '2026-11-18'
const byNumber = (store, number) =>
  store.contracts.find((contract) => contract.number === number)

test('the mockup is a /ui-kit section under review', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(
    kit,
    /import \{ InstallmentsMockup \} from '@\/screens\/ui-kit\/InstallmentsMockup'/,
  )
  assert.match(
    kit,
    /id: 'installments',\n    title: 'نموذج شاشات الاقساط',[\s\S]*?status: 'review',[\s\S]*?element: <InstallmentsMockup \/>/,
  )
})

test('sample data only: no database, tokens only, plain alif', () => {
  for (const source of [
    mockup,
    read('src', 'screens', 'ui-kit', 'installmentsMockupData.ts'),
  ]) {
    assert.doesNotMatch(source, /supabase|fetch\(|localStorage/)
    assert.doesNotMatch(source, /[أإآ]/)
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b/)
    assert.doesNotMatch(
      source,
      /\b(gray|slate|emerald|red|amber|blue)-\d{2,3}\b/,
    )
    assert.doesNotMatch(source, /tracking-|uppercase/)
  }
})

test('the contract takes a free title, not tied to equipment', () => {
  // Owner 2026-11-18: «مانبغى نحصرها على المعدات, فعطني حرية اني اسجل عنوان
  // العقد». The unit link stays optional.
  assert.match(mockup, /label="عنوان العقد"\s+required/)
  assert.doesNotMatch(mockup, /label="الوصف"/)
  assert.match(mockup, /<OptionalLabel text="المعدات المرتبطة" \/>/)
  const store = data.seedStore(TODAY)
  assert.ok(store.contracts.some((contract) => contract.equipment.length === 0))
  assert.equal(byNumber(store, 'INS-0005').description, 'ارض المستودع (السلي)')
})

test('the sample store: seven contracts, the nearest dues first', () => {
  const store = data.seedStore(TODAY)
  assert.deepEqual(
    Array.from(store.contracts, (contract) => contract.number),
    [
      'INS-0001',
      'INS-0002',
      'INS-0003',
      'INS-0004',
      'INS-0005',
      'INS-0006',
      'INS-0007',
    ],
  )
  assert.equal(byNumber(store, 'INS-0007').status, 'paid_off')
  const dues = data.openDues(store, TODAY)
  // Sorted by due date; the overdue row leads.
  for (let index = 1; index < dues.length; index += 1)
    assert.ok(dues[index - 1].row.dueDate <= dues[index].row.dueDate)
  assert.equal(dues[0].contract.number, 'INS-0004')
  assert.equal(dues[0].state, 'overdue')
  assert.equal(dues[0].days, -3)
  assert.equal(dues[1].state, 'due_today')
  assert.equal(dues[1].isPartial, true)
  assert.equal(dues[1].remaining, 8250)
  const overview = data.overviewOf(dues)
  assert.equal(overview.overdueCount, 1)
  assert.equal(overview.overdueAmount, 12500)
  assert.equal(overview.due7Count, 2)
  assert.equal(overview.due7Amount, 38250)
  assert.equal(overview.due30Amount, 112277.77)
  assert.equal(overview.activeContracts, 6)
  // A paid-off or cancelled contract has no open due.
  assert.ok(dues.every((item) => item.contract.status === 'active'))
})

test('a payment goes to the oldest row; a void takes it back', () => {
  const store = data.seedStore(TODAY)
  const loader = byNumber(store, 'INS-0004')
  const draft = {
    paidOn: TODAY,
    amount: 20000,
    method: 'transfer',
    reference: '',
    note: '',
  }
  const paid = data.recordPayment(store, loader.id, draft, TODAY)
  assert.equal(paid.ok, true)
  const after = byNumber(paid.store, 'INS-0004')
  assert.equal(after.rows[4].paidAmount, 12500)
  assert.equal(after.rows[5].paidAmount, 7500)
  assert.equal(
    data.overviewOf(data.openDues(paid.store, TODAY)).overdueCount,
    0,
  )

  const voided = data.voidPayment(paid.store, paid.id, 'تجربة')
  assert.equal(voided.ok, true)
  assert.equal(byNumber(voided.store, 'INS-0004').rows[4].paidAmount, 0)
  assert.equal(
    voided.store.payments.find((payment) => payment.id === paid.id).status,
    'voided',
  )
  assert.equal(
    data.voidPayment(voided.store, paid.id, 'مرة ثانية').token,
    'payment_already_voided',
  )
  assert.equal(
    data.voidPayment(paid.store, paid.id, '  ').token,
    'reason_required',
  )

  // The refusals of record_installment_payment.
  const refuse = (patch) =>
    data.recordPayment(store, loader.id, { ...draft, ...patch }, TODAY).token
  assert.equal(refuse({ amount: 250000.01 }), 'payment_exceeds_balance')
  assert.equal(refuse({ paidOn: '2026-11-19' }), 'invalid_paid_on')
  assert.equal(refuse({ amount: 0 }), 'invalid_payment_amount')
})

test('the payment of the rest closes the contract, its void reopens it', () => {
  const store = data.seedStore(TODAY)
  const land = byNumber(store, 'INS-0005')
  assert.equal(data.remainingOf(land), 40000)
  assert.equal(data.nextRowOf(land).isBalloon, true)
  const paid = data.recordPayment(
    store,
    land.id,
    { paidOn: TODAY, amount: 40000, method: 'cheque', reference: '', note: '' },
    TODAY,
  )
  assert.equal(byNumber(paid.store, 'INS-0005').status, 'paid_off')
  assert.equal(
    data.recordPayment(
      paid.store,
      land.id,
      { paidOn: TODAY, amount: 1, method: 'cash', reference: '', note: '' },
      TODAY,
    ).token,
    'contract_not_active',
  )
  const voided = data.voidPayment(paid.store, paid.id, 'تجربة')
  assert.equal(byNumber(voided.store, 'INS-0005').status, 'active')
})

test('the money terms are locked by a posted payment; the title is free', () => {
  const store = data.seedStore(TODAY)
  const contract = byNumber(store, 'INS-0003')
  const draft = {
    description: 'حفار كاتربيلر 320 (معدل)',
    financierId: contract.financierId,
    terms: contract.terms,
    notes: '',
    equipment: [],
  }
  const renamed = data.saveContract(store, contract.id, draft, TODAY)
  assert.equal(renamed.ok, true)
  assert.equal(
    byNumber(renamed.store, 'INS-0003').description,
    'حفار كاتربيلر 320 (معدل)',
  )
  assert.equal(byNumber(renamed.store, 'INS-0003').rows[0].paidAmount, 30000)
  assert.equal(
    data.saveContract(
      store,
      contract.id,
      { ...draft, terms: { ...contract.terms, installmentCount: 24 } },
      TODAY,
    ).token,
    'contract_has_payments',
  )
  assert.equal(
    data.saveContract(store, contract.id, { ...draft, description: ' ' }, TODAY)
      .token,
    'invalid_description',
  )
  assert.equal(
    data.cancelContract(store, contract.id, 'خطا').token,
    'contract_has_payments',
  )

  // A new contract takes the next number and its generated rows.
  const created = data.saveContract(
    store,
    null,
    {
      description: 'ارض',
      financierId: contract.financierId,
      terms: {
        totalAmount: 100000,
        downPayment: 10000,
        balloonAmount: 0,
        installmentCount: 9,
        frequencyMonths: 1,
        firstDueDate: '2026-12-01',
      },
      notes: '',
      equipment: [],
    },
    TODAY,
  )
  const fresh = byNumber(created.store, 'INS-0008')
  assert.equal(fresh.rows.length, 9)
  assert.equal(fresh.rows[0].amount, 10000)
  assert.equal(
    data.cancelContract(created.store, fresh.id, 'ادخل بالخطا').ok,
    true,
  )
})

test('a financier with contracts is not deleted, a name is not repeated', () => {
  const store = data.seedStore(TODAY)
  const used = store.financiers.find((item) => item.name === 'بنك الراجحي')
  const free = store.financiers.find((item) => item.name === 'بنك البلاد')
  const refused = data.deleteFinancier(store, used.id)
  assert.equal(refused.ok, false)
  assert.equal(
    lib.installmentErrorMessage({ message: refused.token }),
    'instErrFinancierInUse',
  )
  assert.equal(data.deleteFinancier(store, free.id).ok, true)
  assert.equal(
    lib.installmentErrorMessage({
      message: data.saveFinancier(store, null, ' بنك الرياض ').token,
    }),
    'instErrFinancierDuplicate',
  )
  assert.equal(data.saveFinancier(store, null, 'مصرف الانماء').ok, true)
})
