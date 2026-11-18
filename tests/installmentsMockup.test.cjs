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
// whose dates follow the given day. The same day he chose the design of the
// older `company-installments` mockup on this simplified model: one page with
// four tabs and the contract page, whose history is derived from the store.

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
  assert.equal(data.unitOf('A291').type, 'حفار')
  assert.equal(data.unitOf('ZZ'), null)
})

test('one page with four tabs and the contract page, on the simple model', () => {
  for (const tab of ['dashboard', 'contracts', 'dues', 'financiers'])
    assert.match(mockup, new RegExp(`<TabsTrigger value="${tab}">`))
  for (const label of ['اللوحة', 'العقود', 'الاستحقاقات', 'الجهات'])
    assert.ok(mockup.includes(label), label)
  for (const piece of [
    'function DashboardTab(',
    'function CashflowBars(',
    'function ContractsTab(',
    'function DuesTab(',
    'function FinanciersTab(',
    'function ContractPage(',
    'function PaymentCard(',
  ])
    assert.ok(mockup.includes(piece), piece)
  // A refusal shows the safe message of its token, never the token.
  assert.match(mockup, /t\(installmentErrorMessage\(\{ message: token \}\)\)/)
  // What the simplified model dropped stays out, and so does the review
  // chrome of the older mockup.
  assert.doesNotMatch(
    mockup,
    /الضريبة|الارباح|الرسوم|تاريخ العقد|رقم العقد لدى الجهة|تاجير تمويلي|موقوفة|PDF/,
  )
  assert.doesNotMatch(
    mockup,
    /vatAmount|profitAmount|feesAmount|assetPrice|financier_ref|is_active/,
  )
  assert.doesNotMatch(
    mockup,
    /StateTabs|PermissionNote|SimulationField|TokenTable|installments\.(view|manage|pay)/,
  )
})

test('the sample store: eight contracts, the nearest dues first', () => {
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
      'INS-0008',
    ],
  )
  assert.equal(byNumber(store, 'INS-0007').status, 'paid_off')
  assert.equal(byNumber(store, 'INS-0007').closedOn, '2026-04-02')
  const cancelled = byNumber(store, 'INS-0008')
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.cancelReason, 'ادخل العقد مرتين بالخطا')
  assert.equal(cancelled.closedOn, '2026-11-12')
  const dues = data.openDues(store, TODAY)
  // Sorted by due date; the two overdue rows lead, the oldest first.
  for (let index = 1; index < dues.length; index += 1)
    assert.ok(dues[index - 1].row.dueDate <= dues[index].row.dueDate)
  assert.equal(dues[0].contract.number, 'INS-0006')
  assert.equal(dues[0].state, 'overdue')
  assert.equal(dues[0].days, -12)
  assert.equal(dues[1].contract.number, 'INS-0004')
  assert.equal(dues[1].state, 'overdue')
  assert.equal(dues[1].days, -3)
  assert.equal(dues[2].state, 'due_today')
  assert.equal(dues[2].isPartial, true)
  assert.equal(dues[2].remaining, 8250)
  const overview = data.overviewOf(dues)
  assert.equal(overview.overdueCount, 2)
  assert.equal(overview.overdueAmount, 34277.77)
  assert.equal(overview.due7Count, 2)
  assert.equal(overview.due7Amount, 38250)
  assert.equal(overview.due30Amount, 112277.77)
  assert.equal(overview.activeContracts, 6)
  // A paid-off or cancelled contract has no open due.
  assert.ok(dues.every((item) => item.contract.status === 'active'))
})

test('the dues views and the monthly bars of the dashboard', () => {
  const store = data.seedStore(TODAY)
  const dues = data.openDues(store, TODAY)
  const count = (view) => data.duesInView(dues, view, TODAY).length
  assert.equal(count('overdue'), 2)
  // This month: the two overdue rows, the one due today and the one in a week.
  assert.equal(count('month'), 4)
  assert.equal(count('next30'), 6)
  assert.equal(count('all'), dues.length)
  assert.equal(data.sumDues(data.duesInView(dues, 'overdue', TODAY)), 34277.77)
  assert.equal(data.sumDues(data.duesInView(dues, 'next30', TODAY)), 112277.77)
  assert.equal(data.sumDues(dues), data.overviewOf(dues).remainingTotal)
  assert.equal(data.monthKeyOf('2026-11-18'), '2026-11')

  const months = data.monthlyDues(dues, TODAY)
  assert.deepEqual(
    Array.from(months.slice(0, 3), (month) => month.key),
    ['2026-11', '2026-12', '2027-01'],
  )
  assert.equal(months.length, 12)
  // The bars leave the overdue rows out: the month keeps what is still coming.
  assert.deepEqual({ ...months[0] }, { key: '2026-11', total: 38250, count: 2 })
  assert.deepEqual(
    { ...months[1] },
    { key: '2026-12', total: 104027.77, count: 5 },
  )
  assert.equal(data.monthlyDues(dues, TODAY, 3).length, 3)
})

test('the contract summary and the financier figures', () => {
  const store = data.seedStore(TODAY)
  const loader = data.summaryOf(byNumber(store, 'INS-0004'), TODAY)
  assert.equal(loader.financed, 300000)
  assert.equal(loader.paid, 50000)
  assert.equal(loader.remaining, 250000)
  assert.equal(loader.percent, 17)
  assert.equal(loader.paidCount, 4)
  assert.equal(loader.rowCount, 24)
  assert.equal(loader.overdueCount, 1)
  assert.equal(loader.overdueAmount, 12500)
  assert.equal(loader.next.seq, 5)
  assert.equal(loader.firstDue, '2026-07-15')
  assert.equal(loader.lastDue, '2028-06-15')
  assert.equal(data.rowRemaining(byNumber(store, 'INS-0002').rows[13]), 8250)

  const paidOff = data.summaryOf(byNumber(store, 'INS-0007'), TODAY)
  assert.equal(paidOff.percent, 100)
  assert.equal(paidOff.next, null)
  // A closed contract counts nothing as overdue.
  const cancelled = data.summaryOf(byNumber(store, 'INS-0008'), '2030-01-01')
  assert.equal(cancelled.overdueCount, 0)
  assert.equal(cancelled.financed, 150000)

  const stats = (name) =>
    data.financierStats(
      store,
      store.financiers.find((item) => item.name === name).id,
    )
  assert.deepEqual(
    { ...stats('عبداللطيف جميل') },
    { contracts: 2, activeContracts: 1, remaining: 250000 },
  )
  // The cancelled contract still ties its financier.
  assert.equal(stats('الجبر التجارية').contracts, 2)
  assert.equal(stats('الجبر التجارية').activeContracts, 1)
  assert.deepEqual(
    { ...stats('بنك البلاد') },
    { contracts: 0, activeContracts: 0, remaining: 0 },
  )
})

test('the contract history is derived from the store, the newest first', () => {
  const store = data.seedStore(TODAY)
  const excavator = byNumber(store, 'INS-0003')
  const history = data.historyOf(store, excavator.id)
  for (let index = 1; index < history.length; index += 1)
    assert.ok(history[index - 1].order > history[index].order)
  // Nine payments, the mistaken one and its void, then the creation last.
  assert.equal(history.length, 12)
  assert.deepEqual(
    Array.from(history.slice(0, 2), (event) => event.kind),
    ['payment_voided', 'payment_recorded'],
  )
  assert.equal(history[0].detail, 'المبلغ ادخل بالخطا')
  assert.equal(history[0].amount, 3000)
  assert.equal(history[0].on, '2026-10-30')
  assert.equal(history[0].by, data.MOCK_USER)
  assert.equal(history[1].by, 'سالم')
  assert.equal(history[1].on, '2026-10-29')
  assert.equal(history[history.length - 1].kind, 'created')
  assert.equal(history[history.length - 1].on, excavator.createdOn)

  // The full payment closes the history of a paid-off contract.
  const closed = data.historyOf(store, byNumber(store, 'INS-0007').id)
  assert.equal(closed[0].kind, 'paid_off')
  assert.equal(closed[0].on, '2026-04-02')
  assert.equal(closed[1].kind, 'payment_recorded')

  assert.deepEqual(
    Array.from(
      data.historyOf(store, byNumber(store, 'INS-0008').id),
      (event) => event.kind,
    ),
    ['cancelled', 'created'],
  )
  assert.deepEqual(Array.from(data.historyOf(store, 'missing')), [])

  // A live payment and its void: who, when and why.
  const land = byNumber(store, 'INS-0005')
  const paid = data.recordPayment(
    store,
    land.id,
    {
      paidOn: '2026-11-10',
      amount: 40000,
      method: 'cash',
      reference: '',
      note: '',
    },
    TODAY,
  )
  const after = data.historyOf(paid.store, land.id)
  assert.equal(after[0].kind, 'paid_off')
  assert.equal(after[0].on, '2026-11-10')
  assert.equal(after[1].on, TODAY)
  const voided = data.voidPayment(paid.store, paid.id, 'خطا', TODAY, 'سالم')
  const reopened = data.historyOf(voided.store, land.id)
  assert.equal(reopened[0].kind, 'payment_voided')
  assert.equal(reopened[0].by, 'سالم')
  assert.equal(reopened[0].on, TODAY)
  assert.ok(reopened.every((event) => event.kind !== 'paid_off'))
  assert.equal(byNumber(voided.store, 'INS-0005').closedOn, null)
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
  // Its own overdue row is paid; the one of the other contract stays.
  assert.equal(
    data.overviewOf(data.openDues(paid.store, TODAY)).overdueCount,
    1,
  )
  assert.equal(data.summaryOf(after, TODAY).overdueCount, 0)

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
  const fresh = byNumber(created.store, 'INS-0009')
  assert.equal(fresh.rows.length, 9)
  assert.equal(fresh.rows[0].amount, 10000)
  const cancelled = data.cancelContract(
    created.store,
    fresh.id,
    'ادخل بالخطا',
    TODAY,
  )
  assert.equal(cancelled.ok, true)
  assert.equal(byNumber(cancelled.store, 'INS-0009').closedOn, TODAY)
  assert.equal(
    byNumber(cancelled.store, 'INS-0009').cancelledBy,
    data.MOCK_USER,
  )
  // Without a day the cancellation still goes through.
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
