const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The plan of a contract (migration 0209, owner 2026-11-22): the first
// payments (an amount or a percentage of the total), the VAT with each
// payment or at the end, the division that waits for the first due date and
// the allocation of a payment. src/lib/installmentPlan.ts, made-up numbers.

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

const lib = loadLibModule('installmentPlan')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

/** The approved example: a million, 20% and 100,000, 24 months. */
const input = (patch = {}) => ({
  totalAmount: 1000000,
  prepaid: 0,
  vatMode: 'exclusive',
  vatTiming: 'end',
  vatAmount: null,
  vatDueDate: null,
  payments: [
    { rate: 20, amount: null },
    { rate: null, amount: 100000 },
  ],
  balloonAmount: 0,
  installmentCount: 24,
  frequencyMonths: 1,
  firstDueDate: null,
  ...patch,
})
const planOf = (patch) => plain(lib.buildInstallmentPlan(input(patch)))
const halalas = (value) => Math.round(value * 100)

test('VAT at the end: payments and installments without it, one row for it', () => {
  const { plan, error } = planOf()
  assert.equal(error, null)
  assert.deepEqual(
    plan.payments.map((row) => row.amount),
    [200000, 100000],
  )
  assert.equal(plan.installments.amount, 700000)
  assert.equal(plan.regular, 29166.66)
  assert.equal(plan.lastRegular, 29166.82)
  assert.equal(plan.vat, 150000)
  assert.equal(plan.payable, 1150000)
})

test('VAT with each payment and installment', () => {
  const { plan } = planOf({ vatTiming: 'each' })
  assert.deepEqual(
    plan.payments.map((row) => [row.base, row.vat, row.amount]),
    [
      [200000, 30000, 230000],
      [100000, 15000, 115000],
    ],
  )
  assert.equal(plan.installments.amount, 805000)
  assert.equal(plan.installments.base, 700000)
  assert.equal(plan.regular, 33541.66)
  assert.equal(plan.lastRegular, 33541.82)
  assert.equal(plan.payable, 1150000)
  assert.equal(plan.vatDueDate, null)
})

test('inclusive and no VAT add nothing', () => {
  for (const vatMode of ['inclusive', 'exempt', 'unspecified']) {
    const { plan } = planOf({ vatMode, vatTiming: null })
    assert.equal(plan.vat, 0, vatMode)
    assert.equal(plan.payable, 1000000, vatMode)
    assert.equal(plan.installments.amount, 700000, vatMode)
  }
})

test('every halala is in the plan, whatever the VAT timing', () => {
  for (const patch of [
    {},
    { vatTiming: 'each' },
    { vatTiming: 'each', totalAmount: 999999.99, installmentCount: 7 },
    { totalAmount: 123456.78, prepaid: 1000, balloonAmount: 20000, payments: [] },
    { vatTiming: 'each', payments: [{ rate: 33.3333, amount: null }], balloonAmount: 100000 },
  ]) {
    const { plan, error } = planOf(patch)
    assert.equal(error, null)
    const sum =
      halalas(plan.prepaid) +
      plan.payments.reduce((total, row) => total + halalas(row.amount), 0) +
      plan.rows.reduce((total, row) => total + halalas(row.amount), 0) +
      (input(patch).vatTiming === 'end' ? halalas(plan.vat) : 0)
    assert.equal(sum, halalas(plan.payable), JSON.stringify(patch))
  }
})

test('the installments wait for the first due date, then take their days', () => {
  const waiting = planOf().plan
  assert.ok(waiting.rows.every((row) => row.dueDate === null))
  assert.equal(waiting.vatDueDate, null)
  const dated = planOf({ firstDueDate: '2027-01-15' }).plan
  assert.equal(dated.rows[0].dueDate, '2027-01-15')
  assert.equal(dated.rows[23].dueDate, '2028-12-15')
  // With the last installment, unless another day was chosen.
  assert.equal(dated.vatDueDate, '2028-12-15')
  assert.equal(
    planOf({ firstDueDate: '2027-01-15', vatDueDate: '2028-06-01' }).plan.vatDueDate,
    '2028-06-01',
  )
})

test('a typed VAT amount, and what is refused', () => {
  assert.equal(planOf({ vatAmount: 149000 }).plan.vat, 149000)
  const refusal = (patch) => planOf(patch).error
  assert.equal(refusal({ vatTiming: null }), 'invalid_vat_timing')
  assert.equal(refusal({ vatAmount: 0 }), 'invalid_vat_amount')
  assert.equal(refusal({ vatAmount: 1000000.01 }), 'invalid_vat_amount')
  assert.equal(refusal({ payments: [{ rate: null, amount: 1000000 }] }), 'invalid_first_payments')
  assert.equal(refusal({ payments: [], prepaid: 1000000 }), 'invalid_down_payment')
  assert.equal(refusal({ installmentCount: 361 }), 'invalid_installment_count')
  assert.equal(refusal({ balloonAmount: 700000 }), 'invalid_balloon')
  assert.equal(
    refusal({ payments: [{ rate: 20, amount: null, lockedAmount: 150000 }] }),
    'first_payment_locked',
  )
})

test('a percentage', () => {
  assert.equal(lib.parseInstallmentRate('20'), 20)
  assert.equal(lib.parseInstallmentRate('12.5%'), 12.5)
  assert.equal(lib.parseInstallmentRate('٢٠'), 20)
  for (const wrong of ['0', '100', '-5', '12.34567', 'x', ''])
    assert.equal(lib.parseInstallmentRate(wrong), null, wrong)
})

test('«تحديد تاريخ اول قسط» divides the stored amount, the payments untouched', () => {
  const stored = {
    installments_amount: '805000.00',
    balloon_amount: 0,
    vat_timing: 'each',
    vat_due_date: null,
  }
  const { plan } = plain(lib.planDivision(stored, '2027-01-15', 24, 1))
  assert.equal(plan.regular, 33541.66)
  assert.equal(plan.lastRegular, 33541.82)
  assert.equal(plan.rows[23].dueDate, '2028-12-15')
})

test('what the save sends', () => {
  const row = lib.newFirstPaymentRow('k', 'الدفعة الاولى')
  const paid = { ...row, kind: 'rate', value: '20', date: '2026-12-15', paidOn: '2026-11-20', paid: true }
  assert.deepEqual(plain(lib.firstPaymentsPayload([paid], 1000000)), [
    {
      id: null,
      title: 'الدفعة الاولى',
      rate: 20,
      amount: null,
      // The agreed day stays; only the payment takes the day it was paid.
      due_date: '2026-12-15',
      note: null,
      paid_on: '2026-11-20',
      method: 'transfer',
    },
  ])
  // A row with money on it never records a second payment.
  const [again] = plain(lib.firstPaymentsPayload([{ ...paid, lockedAmount: 200000 }], 1000000))
  assert.equal(again.paid_on, undefined)
  const vat = (vat_mode, vat_timing, vat_amount = '') =>
    plain(lib.vatPayload({ vat_mode, vat_timing, vat_amount, vat_due_date: '' }))
  assert.deepEqual(vat('inclusive', 'end'), { mode: 'inclusive' })
  assert.deepEqual(vat('exclusive', 'each'), { mode: 'exclusive', timing: 'each' })
  assert.deepEqual(vat('exclusive', 'end'), {
    mode: 'exclusive',
    timing: 'end',
    amount: null,
    due_date: null,
  })
})

test('a payment: the chosen row, then the oldest due, then the undated', () => {
  const row = (id, kind, seq, due_date, paid_amount = 0) => ({
    id, kind, seq, due_date, amount: 100, paid_amount,
  })
  const rows = [
    row('p2', 'first_payment', 2, null),
    row('i1', 'installment', 1, '2027-01-15'),
    row('p1', 'first_payment', 1, '2026-11-20', 100),
    row('i2', 'installment', 2, '2027-02-15'),
  ]
  const split = (amount, target) => {
    const result = lib.allocateToRows(rows, amount, target)
    return result && plain(result.map((item) => [item.row.id, item.amount]))
  }
  assert.deepEqual(split(250), [['i1', 100], ['i2', 100], ['p2', 50]])
  // A first payment is paid before the first due date comes.
  assert.deepEqual(split(100, 'p2'), [['p2', 100]])
  assert.deepEqual(split(120, 'p2'), [['p2', 100], ['i1', 20]])
  assert.equal(split(300.01), null)
})

const storedRow = (patch) => ({
  id: 'p1', contract_id: 'c', kind: 'first_payment', seq: 1, title: 'one',
  note: null, rate: '30.0000', base_amount: '30000.00', amount: '30000.00',
  vat_amount: 0, paid_amount: '30000.00', due_date: null, is_balloon: false,
  ...patch,
})
const storedContract = {
  description: 'x', financier_id: 'f', total_amount: '100000.00',
  down_payment: '0.00', balloon_amount: '0.00', installment_count: 12,
  frequency_months: 1, first_due_date: null, notes: null, vat_mode: 'exclusive',
  vat_timing: 'end', vat_amount: '15000.00', vat_due_date: null,
  contract_bank_name: null, contract_iban: null,
}

test('a paid percentage never locks the total: it stays what was paid', () => {
  const values = lib.contractFormValues(storedContract, [storedRow()], [])
  // Unchanged: still a percentage.
  assert.equal(lib.firstPaymentsPayload(values.payments, 100000)[0].rate, 30)
  values.total_amount = '110000'
  const { input } = lib.planInputOf(values)
  const { plan, error } = lib.buildInstallmentPlan(input)
  assert.equal(error, null)
  assert.equal(plan.payments[0].amount, 30000)
  assert.equal(plan.installments.amount, 80000)
  const [sent] = plain(lib.firstPaymentsPayload(values.payments, 110000))
  assert.deepEqual([sent.rate, sent.amount], [null, 30000])
})

test('a paid VAT keeps its amount when the total is corrected', () => {
  const vatRow = storedRow({
    id: 'v', kind: 'vat', title: null, rate: null, base_amount: null,
    amount: '15000.00', paid_amount: '1000.00', due_date: '2027-12-15',
  })
  const values = lib.contractFormValues(storedContract, [vatRow], [])
  assert.equal(lib.vatPayload(values).amount, 15000)
  // Without money on it, it follows the total.
  const open = lib.contractFormValues(storedContract, [], [])
  assert.equal(lib.vatPayload(open).amount, null)
})

test('a changed contract: the terms stored now, the free edits of the user', () => {
  const before = lib.contractFormValues(storedContract, [], [])
  const typed = { ...before, notes: 'typed', total_amount: '120000' }
  const now = lib.contractFormValues(
    { ...storedContract, first_due_date: '2027-01-15', description: 'renamed' },
    [storedRow()],
    [],
  )
  const merged = plain(lib.mergeStoredForm(typed, before, now))
  assert.equal(merged.first_due_date, '2027-01-15')
  assert.equal(merged.total_amount, '100000')
  assert.equal(merged.payments.length, 1)
  assert.equal(merged.notes, 'typed')
  assert.equal(merged.description, 'renamed')
})
