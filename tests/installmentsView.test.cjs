const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The pure helpers of the «الاقساط» screens (src/lib/installmentsView.ts):
// the count words, the monthly buckets of the chart, the contract's derived
// history, the financier figures, the URL state of the list page and the
// mapping of a refused write to its field. Made-up rows, no network.

const ROOT = path.join(__dirname, '..')

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
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
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const TODAY = '2026-11-18'

test('the count words, Arabic and English', () => {
  const ar = (fn, counts) => counts.map((count) => fn(count, 'ar'))
  assert.deepEqual(ar(view.daysWords, [1, 2, 3, 10, 11]), [
    'يوم',
    'يومين',
    '3 ايام',
    '10 ايام',
    '11 يوم',
  ])
  assert.deepEqual(ar(view.installmentsWords, [0, 1, 2, 5, 27]), [
    'لا توجد اقساط',
    'قسط واحد',
    'قسطين',
    '5 اقساط',
    '27 قسط',
  ])
  assert.deepEqual(ar(view.contractsWords, [0, 1, 2, 6, 12]), [
    'لا توجد عقود',
    'عقد واحد',
    'عقدين',
    '6 عقود',
    '12 عقد',
  ])
  assert.deepEqual(ar(view.activeContractsWords, [0, 1, 2, 6, 12]), [
    'لا توجد عقود سارية',
    'على عقد واحد ساري',
    'على عقدين ساريين',
    'على 6 عقود سارية',
    'على 12 عقد ساري',
  ])
  assert.deepEqual(ar(view.unitsWords, [1, 2, 3, 11]), [
    'معدة واحدة',
    'معدتين',
    '3 معدات',
    '11 معدة',
  ])
  assert.deepEqual(ar(view.whenWords, [0, -3, 7, -1, 2]), [
    'اليوم',
    'متاخر 3 ايام',
    'باقي 7 ايام',
    'متاخر يوم',
    'باقي يومين',
  ])
  // English keeps its number in front and its plural.
  assert.equal(view.daysWords(1, 'en'), '1 day')
  assert.equal(view.daysWords(3, 'en'), '3 days')
  assert.equal(view.installmentsWords(0, 'en'), 'No installments')
  assert.equal(view.installmentsWords(1, 'en'), '1 installment')
  assert.equal(view.installmentsWords(27, 'en'), '27 installments')
  assert.equal(view.contractsWords(2, 'en'), '2 contracts')
  assert.equal(view.activeContractsWords(1, 'en'), 'On 1 active contract')
  assert.equal(view.unitsWords(1, 'en'), '1 unit')
  assert.equal(view.whenWords(0, 'en'), 'Today')
  assert.equal(view.whenWords(-3, 'en'), '3 days overdue')
  assert.equal(view.whenWords(7, 'en'), 'In 7 days')
})

test('the month labels and the covered installments', () => {
  assert.equal(view.monthKeyOf('2026-11-18'), '2026-11')
  assert.equal(view.installmentMonthLabel('2026-11', 'ar'), 'نوفمبر 2026')
  assert.equal(view.installmentMonthLabel('2026-11', 'ar', true), 'نوفمبر')
  assert.equal(view.installmentMonthLabel('2027-01', 'en'), 'January 2027')
  assert.equal(view.installmentMonthLabel('2027-01', 'en', true), 'Jan')
  assert.equal(view.coveredSeqsLabel([5], 'ar'), '5')
  assert.equal(view.coveredSeqsLabel([6, 5], 'ar'), '5، 6')
  assert.equal(view.coveredSeqsLabel([5, 6, 7], 'en'), '5, 6, 7')
  assert.equal(view.coveredSeqsLabel([9, 5, 6, 7, 8], 'ar'), '5–9')
})

test('amounts: database numerics, sums in halalas, the typed field', () => {
  assert.equal(view.amountOf('12500.50'), 12500.5)
  assert.equal(view.amountOf(null), 0)
  assert.equal(view.amountOf('abc'), 0)
  assert.equal(view.sumAmounts([0.1, 0.2, '0.3', null]), 0.6)
  assert.equal(
    view.scheduleRemaining({ amount: 18250, paid_amount: 10000 }),
    8250,
  )
  assert.equal(view.isSchedulePaid({ amount: 100, paid_amount: 100 }), true)
  assert.equal(view.isSchedulePaid({ amount: 100, paid_amount: 99.99 }), false)
  assert.equal(view.paidPercent(50000, 300000), 17)
  assert.equal(view.paidPercent(320000, 320000), 100)
  assert.equal(view.paidPercent(10, 0), 0)

  assert.equal(view.parseInstallmentAmount('1,200,000'), 1200000)
  assert.equal(view.parseInstallmentAmount(' 30000.5 '), 30000.5)
  assert.equal(view.parseInstallmentAmount('١٢٥٠٠'), 12500)
  assert.equal(view.parseInstallmentAmount('12.345'), null)
  assert.equal(view.parseInstallmentAmount('-5'), null)
  assert.equal(view.parseInstallmentAmount(''), null)
  assert.equal(view.parseInstallmentAmount('abc'), null)
  assert.equal(view.amountInputText(30000), '30000')
  assert.equal(view.amountInputText('12500.50'), '12500.5')
  assert.equal(view.amountInputText(null), '')
})

test('the chart: twelve months from this one, the late rows left out', () => {
  assert.equal(view.cashflowWindowEnd(TODAY), '2027-11-01')
  assert.equal(view.cashflowWindowEnd('2026-12-31', 3), '2027-03-01')
  const months = view.monthlyDueBuckets(
    [
      // Late: not in the chart, even in this month.
      { due_date: '2026-11-06', remaining_amount: 21777.77 },
      { due_date: '2026-11-18', remaining_amount: 8250 },
      { due_date: '2026-11-25', remaining_amount: '30000' },
      { due_date: '2026-12-01', remaining_amount: 0.1 },
      { due_date: '2026-12-31', remaining_amount: 0.2 },
      { due_date: '2027-10-31', remaining_amount: 5 },
      // Beyond the window: ignored.
      { due_date: '2027-11-01', remaining_amount: 99 },
    ],
    TODAY,
  )
  assert.equal(months.length, 12)
  assert.deepEqual(
    Array.from(months.slice(0, 3), (month) => month.key),
    ['2026-11', '2026-12', '2027-01'],
  )
  assert.deepEqual(plain(months[0]), { key: '2026-11', total: 38250, count: 2 })
  assert.deepEqual(plain(months[1]), { key: '2026-12', total: 0.3, count: 2 })
  assert.deepEqual(plain(months[2]), { key: '2027-01', total: 0, count: 0 })
  assert.deepEqual(plain(months[11]), { key: '2027-10', total: 5, count: 1 })
  assert.equal(view.monthlyDueBuckets([], TODAY, 3).length, 3)
  assert.deepEqual(plain(view.currentMonthRange(TODAY)), {
    from: '2026-11-01',
    to: '2026-12-01',
  })
  assert.deepEqual(plain(view.currentMonthRange('2026-12-31')), {
    from: '2026-12-01',
    to: '2027-01-01',
  })
})

test('the financier figures are grouped from the contract summaries', () => {
  const figures = view.financierFigures([
    { financier_id: 'a', status: 'active', remaining_total: 250000 },
    { financier_id: 'a', status: 'paid_off', remaining_total: 0 },
    { financier_id: 'b', status: 'active', remaining_total: '0.1' },
    { financier_id: 'b', status: 'active', remaining_total: 0.2 },
    // A cancelled contract still ties its financier, and owes nothing.
    { financier_id: 'c', status: 'cancelled', remaining_total: 150000 },
  ])
  assert.deepEqual(plain(view.figuresOf(figures, 'a')), {
    contracts: 2,
    activeContracts: 1,
    remaining: 250000,
  })
  assert.deepEqual(plain(view.figuresOf(figures, 'b')), {
    contracts: 2,
    activeContracts: 2,
    remaining: 0.3,
  })
  assert.deepEqual(plain(view.figuresOf(figures, 'c')), {
    contracts: 1,
    activeContracts: 0,
    remaining: 0,
  })
  assert.deepEqual(plain(view.figuresOf(figures, 'none')), {
    contracts: 0,
    activeContracts: 0,
    remaining: 0,
  })
})

const payment = (patch) => ({
  id: 'p1',
  contract_id: 'c1',
  paid_on: '2026-10-01',
  amount: 30000,
  method: 'transfer',
  reference: null,
  note: null,
  status: 'posted',
  voided_at: null,
  voided_by_name: null,
  void_reason: null,
  created_by_name: 'مبارك',
  created_at: '2026-10-01T09:00:00+00:00',
  ...patch,
})

test('the contract history is derived, the newest first', () => {
  const contract = {
    status: 'active',
    closed_at: null,
    cancel_reason: null,
    created_at: '2026-09-01T08:00:00+00:00',
    created_by_name: 'مبارك',
  }
  const history = view.contractHistory(contract, [
    payment({ id: 'p1' }),
    payment({
      id: 'p2',
      amount: 3000,
      status: 'voided',
      created_by_name: 'سالم',
      created_at: '2026-10-29T10:00:00+00:00',
      voided_at: '2026-10-30T07:30:00+00:00',
      voided_by_name: 'مبارك',
      void_reason: 'المبلغ ادخل بالخطا',
    }),
  ])
  assert.deepEqual(
    Array.from(history, (event) => event.kind),
    ['payment_voided', 'payment_recorded', 'payment_recorded', 'created'],
  )
  assert.equal(history[0].detail, 'المبلغ ادخل بالخطا')
  assert.equal(history[0].amount, 3000)
  assert.equal(history[0].by, 'مبارك')
  assert.equal(history[0].at, '2026-10-30T07:30:00+00:00')
  assert.equal(history[1].by, 'سالم')
  assert.equal(history[3].at, contract.created_at)
  assert.equal(
    new Set(Array.from(history, (event) => event.key)).size,
    history.length,
  )

  // The full payment closes a paid-off contract: same instant as its
  // payment, shown right above it, by whoever recorded it.
  const closed = view.contractHistory(
    { ...contract, status: 'paid_off', closed_at: '2026-11-10T12:00:00+00:00' },
    [
      payment({ id: 'p1' }),
      payment({
        id: 'p3',
        created_by_name: 'سالم',
        created_at: '2026-11-10T12:00:00+00:00',
      }),
    ],
  )
  assert.deepEqual(
    Array.from(closed, (event) => event.kind),
    ['paid_off', 'payment_recorded', 'payment_recorded', 'created'],
  )
  assert.equal(closed[0].by, 'سالم')
  assert.equal(closed[0].amount, null)

  // A cancellation: its reason, and no name (the database keeps none).
  const cancelled = view.contractHistory(
    {
      ...contract,
      status: 'cancelled',
      closed_at: '2026-09-04T08:00:00+00:00',
      cancel_reason: 'ادخل العقد مرتين بالخطا',
    },
    [],
  )
  assert.deepEqual(
    Array.from(cancelled, (event) => event.kind),
    ['cancelled', 'created'],
  )
  assert.equal(cancelled[0].detail, 'ادخل العقد مرتين بالخطا')
  assert.equal(cancelled[0].by, null)
  // An active contract has no closing event.
  assert.ok(history.every((event) => event.kind !== 'paid_off'))
  for (const kind of [
    'created',
    'payment_recorded',
    'payment_voided',
    'paid_off',
    'cancelled',
  ])
    assert.match(view.INSTALLMENT_HISTORY_LABEL_KEYS[kind], /^instHistory/)
})

test('the units of a page of contracts are grouped by contract', () => {
  const unit = (contract, id, code) => ({
    contract_id: contract,
    equipment_id: id,
    code,
    type: null,
  })
  const map = view.unitsByContract([
    unit('c1', 'e1', 'A418'),
    unit('c2', 'e3', null),
    unit('c1', 'e2', 'A419'),
  ])
  assert.deepEqual(
    Array.from(map.get('c1'), (item) => item.code),
    ['A418', 'A419'],
  )
  // A unit the reader may not see keeps its place with no code.
  assert.equal(map.get('c2')[0].code, null)
  assert.equal(map.get('c3'), undefined)
})

test('which installments each payment covered', () => {
  const map = view.allocationSeqsByPayment([
    { payment_id: 'p1', amount: 7500, seq: 6 },
    { payment_id: 'p1', amount: 12500, seq: 5 },
    { payment_id: 'p2', amount: 100, seq: 1 },
  ])
  assert.deepEqual(plain(map.get('p1')), [5, 6])
  assert.deepEqual(plain(map.get('p2')), [1])
  assert.equal(map.get('p3'), undefined)
})

test('the list page state comes from its URL, with safe defaults', () => {
  const read = (query) => {
    const params = new URLSearchParams(query)
    return plain(view.readInstallmentsUrlState((name) => params.get(name)))
  }
  const base = { feedView: null, feedFinancier: null, contractChip: null, contractSort: null, contractSearch: '' }
  assert.deepEqual(read(''), { tab: 'dashboard', duesView: null, ...base })
  assert.deepEqual(read('tab=contracts&cq=x&csort=remaining&chip=overdue'), {
    tab: 'contracts',
    duesView: null,
    ...base,
    contractChip: 'overdue',
    contractSort: 'remaining',
    contractSearch: 'x',
  })
  assert.deepEqual(read('tab=dues&view=paid&fin=f1'), {
    tab: 'dues',
    duesView: 'paid',
    ...base,
    feedView: 'paid',
    feedFinancier: 'f1',
  })
  assert.equal(plain(view.readInstallmentsUrlState((n) => (n === 'tab' ? 'calendar' : null))).tab, 'calendar')
  // Anything unknown falls back: a pasted URL never breaks the page.
  assert.deepEqual(read('tab=x&view=late'), { tab: 'dashboard', duesView: null, ...base, feedView: 'late' })
  assert.equal(view.INSTALLMENT_CONTRACTS_URL_PREFIX, 'c')
  assert.equal(view.INSTALLMENT_DUES_URL_PREFIX, 'd')

  // The dues always open on «هذا الشهر» (owner 2026-11-21).
  assert.equal(view.DEFAULT_DUES_VIEW, 'month')
  assert.deepEqual([...view.INSTALLMENT_DUES_VIEWS], ['overdue', 'month', 'next30', 'all', 'paid'])
  assert.equal(view.installmentsListHref('dashboard'), '/installments')
  assert.equal(
    view.installmentsListHref('dues', 'overdue'),
    '/installments?tab=dues&view=overdue',
  )
  assert.equal(view.INSTALLMENTS_PAGE_SIZE, 20)
  const financiers = [{ id: 'f1', name: 'بنك' }]
  const fields = plain(
    view.withFinancierOptions(
      { filterFields: [{ key: 'financier_id', options: [] }, { key: 'status' }] },
      financiers,
    ),
  )
  assert.deepEqual(fields[0].options, [{ value: 'f1', label: 'بنك' }])
  assert.deepEqual(fields[1], { key: 'status' })
})

test('the money terms of the form, and the field of a refusal', () => {
  const values = {
    total_amount: '1,200,000',
    down_payment: '',
    balloon_amount: '0',
    installment_count: '36',
    frequency_months: '1',
    first_due_date: '2026-12-01',
  }
  assert.deepEqual(plain(view.installmentTermsOf(values)), {
    totalAmount: 1200000,
    downPayment: 0,
    balloonAmount: 0,
    installmentCount: 36,
    frequencyMonths: 1,
    firstDueDate: '2026-12-01',
  })
  assert.equal(view.installmentTermsOf({ ...values, total_amount: '' }), null)
  assert.equal(
    view.installmentTermsOf({ ...values, down_payment: '1.234' }),
    null,
  )
  assert.equal(
    view.installmentTermsOf({ ...values, installment_count: '' }),
    null,
  )

  const error = (message) => ({ message, code: '22023' })
  // The longest token wins: `invalid_notes` is never read as `invalid_note`.
  assert.equal(
    view.installmentErrorToken(error('invalid_notes')),
    'invalid_notes',
  )
  assert.equal(
    view.installmentErrorToken(error('invalid_payment_amount')),
    'invalid_payment_amount',
  )
  assert.equal(view.installmentErrorToken(error('something else')), null)
  assert.equal(view.installmentErrorToken(null), null)

  assert.deepEqual(
    plain(
      view.installmentFieldError(
        error('invalid_balloon'),
        view.INSTALLMENT_CONTRACT_TOKEN_FIELDS,
      ),
    ),
    { field: 'balloon_amount', key: 'instErrBalloon' },
  )
  assert.deepEqual(
    plain(
      view.installmentFieldError(
        error('payment_exceeds_balance'),
        view.INSTALLMENT_PAYMENT_TOKEN_FIELDS,
      ),
    ),
    { field: 'amount', key: 'instErrPaymentExceedsBalance' },
  )
  // A refusal that is not about one field stays a form-level message.
  assert.equal(
    view.installmentFieldError(
      error('contract_has_payments'),
      view.INSTALLMENT_CONTRACT_TOKEN_FIELDS,
    ),
    null,
  )
  assert.equal(
    view.installmentFieldError(
      error('raw database text'),
      view.INSTALLMENT_PAYMENT_TOKEN_FIELDS,
    ),
    null,
  )
  // Every mapped token is a token the database raises.
  const inst = loadLibModule('installments')
  for (const token of [
    ...Object.keys(view.INSTALLMENT_CONTRACT_TOKEN_FIELDS),
    ...Object.keys(view.INSTALLMENT_PAYMENT_TOKEN_FIELDS),
    ...view.INSTALLMENT_STALE_TOKENS,
  ])
    assert.ok(inst.INSTALLMENT_ERROR_TOKENS.includes(token), token)
})
