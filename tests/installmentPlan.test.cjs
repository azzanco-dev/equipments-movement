const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The plan of a contract (migration 0209, owner 2026-11-22): ONE typed total
// with the VAT inside it («انا بكتب اجمالي المبلغ فقط»), the VAT in three
// options, the first payments (an amount or a percentage), the division
// that waits for the first due date and the allocation of a payment.
// src/lib/installmentPlan.ts, made-up numbers.

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

/** The approved drawing: one payment of 20%, 24 months. */
const input = (patch = {}) => ({
  totalAmount: 1150000,
  prepaid: 0,
  vatMode: 'separate',
  vatAmount: null,
  vatDue: 'undecided',
  vatDueDate: null,
  payments: [{ rate: 20, amount: null }],
  balloonAmount: 0,
  installmentCount: 24,
  frequencyMonths: 1,
  firstDueDate: null,
  ...patch,
})
const planOf = (patch) => plain(lib.buildInstallmentPlan(input(patch)))
const halalas = (value) => Math.round(value * 100)

test('no VAT: the typed total, nothing taken out of it', () => {
  const { plan, error } = planOf({ vatMode: 'none', totalAmount: 1000000 })
  assert.equal(error, null)
  assert.deepEqual([plan.total, plan.vat, plan.beforeVat], [1000000, 0, 1000000])
  assert.equal(plan.payments[0].amount, 200000)
  assert.deepEqual([plan.regular, plan.lastRegular], [33333.33, 33333.41])
})

test('inside the payments and installments: the same total, its VAT shown', () => {
  const { plan } = planOf({ vatMode: 'inside' })
  assert.deepEqual([plan.total, plan.vat, plan.beforeVat], [1150000, 150000, 1000000])
  // 20% of the total, and the VAT that is inside it.
  assert.deepEqual(plan.payments[0], { base: 200000, vat: 30000, amount: 230000 })
  assert.deepEqual(plan.installments, { base: 800000, vat: 120000, amount: 920000 })
  assert.deepEqual([plan.regular, plan.lastRegular], [38333.33, 38333.41])
})

test('a payment by itself: worked out of the total, the rest without VAT', () => {
  const { plan } = planOf()
  assert.deepEqual([plan.total, plan.vat, plan.beforeVat], [1150000, 150000, 1000000])
  // 20% of the amount before VAT, so the VAT is not counted twice.
  assert.equal(plan.payments[0].amount, 200000)
  assert.equal(plan.installments.amount, 800000)
  assert.deepEqual([plan.regular, plan.lastRegular], [33333.33, 33333.41])
})

test('an amount is final as typed, whatever the VAT', () => {
  for (const vatMode of ['none', 'inside', 'separate', 'unspecified']) {
    const { plan } = planOf({ vatMode, payments: [{ rate: null, amount: 100000 }] })
    assert.equal(plan.payments[0].amount, 100000, vatMode)
    assert.equal(plan.total, 1150000, vatMode)
  }
})

test('a changed VAT amount keeps the typed total', () => {
  const { plan } = planOf({ vatAmount: 100000 })
  assert.deepEqual([plan.total, plan.vat, plan.beforeVat], [1150000, 100000, 1050000])
  assert.equal(plan.payments[0].amount, 210000)
})

test('every halala of the typed total is in the plan', () => {
  for (const patch of [
    {},
    { vatMode: 'inside' },
    { vatMode: 'inside', totalAmount: 999999.99, installmentCount: 7 },
    { vatMode: 'none', totalAmount: 123456.78, prepaid: 1000, balloonAmount: 20000, payments: [] },
    { totalAmount: 1000000, payments: [{ rate: 33.3333, amount: null }], balloonAmount: 100000 },
    { totalAmount: 777777.77, vatAmount: 12345.67 },
  ]) {
    const { plan, error } = planOf(patch)
    assert.equal(error, null)
    const separate = input(patch).vatMode === 'separate'
    const sum =
      halalas(plan.prepaid) +
      plan.payments.reduce((total, row) => total + halalas(row.amount), 0) +
      plan.rows.reduce((total, row) => total + halalas(row.amount), 0) +
      (separate ? halalas(plan.vat) : 0)
    assert.equal(sum, halalas(plan.total), JSON.stringify(patch))
  }
})

test('an earlier contract: «غير محدد», its numbers as they were', () => {
  const { plan } = planOf({
    vatMode: 'unspecified',
    totalAmount: 500000,
    prepaid: 250000,
    payments: [],
    installmentCount: 10,
  })
  assert.deepEqual([plan.total, plan.vat, plan.installments.amount, plan.regular], [500000, 0, 250000, 25000])
})

test('when the VAT by itself is due', () => {
  // Not assumed to be at the end.
  assert.equal(planOf({ firstDueDate: '2027-01-15' }).plan.vatDueDate, null)
  assert.equal(planOf({ vatDue: 'last' }).plan.vatDueDate, null)
  const dated = planOf({ vatDue: 'last', firstDueDate: '2027-01-15' }).plan
  assert.equal(dated.vatDueDate, '2028-12-15')
  assert.equal(dated.rows[0].dueDate, '2027-01-15')
  assert.equal(
    planOf({ vatDue: 'date', vatDueDate: '2026-11-30' }).plan.vatDueDate,
    '2026-11-30',
  )
  assert.ok(planOf().plan.rows.every((row) => row.dueDate === null))
})

test('what is refused', () => {
  const refusal = (patch) => planOf(patch).error
  assert.equal(refusal({ vatAmount: 0 }), 'invalid_vat_amount')
  assert.equal(refusal({ vatAmount: 1150000 }), 'invalid_vat_amount')
  assert.equal(refusal({ payments: [{ rate: null, amount: 1000000 }] }), 'invalid_first_payments')
  assert.equal(refusal({ payments: [], prepaid: 1000000 }), 'invalid_down_payment')
  assert.equal(refusal({ installmentCount: 361 }), 'invalid_installment_count')
  assert.equal(refusal({ balloonAmount: 800000 }), 'invalid_balloon')
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
    installments_amount: '800000.00',
    balloon_amount: 0,
    vat_mode: 'separate',
    vat_due: 'last',
    vat_due_date: null,
  }
  const { plan } = plain(lib.planDivision(stored, '2027-01-15', 24, 1))
  assert.deepEqual([plan.regular, plan.lastRegular], [33333.33, 33333.41])
  assert.equal(plan.rows[23].dueDate, '2028-12-15')
  assert.equal(plan.vatDueDate, '2028-12-15')
  const undecided = plain(lib.planDivision({ ...stored, vat_due: 'undecided' }, '2027-01-15', 24, 1))
  assert.equal(undecided.plan.vatDueDate, null)
})

test('a new form chooses nothing', () => {
  const form = lib.emptyContractForm()
  assert.equal(form.vat_mode, '')
  assert.equal(form.vat_due, 'undecided')
  assert.deepEqual(plain(lib.INSTALLMENT_VAT_CHOICES), ['none', 'inside', 'separate'])
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

  const vat = (patch) => plain(lib.vatPayload({ ...lib.emptyContractForm(), ...patch }))
  assert.deepEqual(vat({ vat_mode: 'inside', vat_amount: '5' }), { mode: 'inside' })
  assert.deepEqual(vat({ vat_mode: 'separate' }), {
    mode: 'separate',
    amount: null,
    due: 'undecided',
    due_date: null,
    title: null,
    note: null,
  })
  // «مدفوعة» hides the planned day; it is not lost.
  const hidden = vat({
    vat_mode: 'separate', vat_due: 'date', vat_due_date: '2026-12-30',
    vat_paid: true, vat_paid_on: '2026-11-20',
  })
  assert.deepEqual([hidden.due, hidden.due_date, hidden.paid_on], ['date', '2026-12-30', '2026-11-20'])
  // Paid with no day asked: none is invented.
  assert.equal(
    vat({ vat_mode: 'separate', vat_due: 'date', vat_paid: true, vat_paid_on: '2026-11-20' }).due,
    'undecided',
  )
})

test('a payment: the chosen row, then the oldest due, then the undated', () => {
  const row = (id, kind, seq, due_date, paid_amount = 0) => ({
    id, kind, seq, due_date, amount: 100, paid_amount,
  })
  const rows = [
    row('v', 'vat', 1, null),
    row('i1', 'installment', 1, '2027-01-15'),
    row('p1', 'first_payment', 1, '2026-11-20', 100),
    row('i2', 'installment', 2, '2027-02-15'),
  ]
  const split = (amount, target) => {
    const result = lib.allocateToRows(rows, amount, target)
    return result && plain(result.map((item) => [item.row.id, item.amount]))
  }
  assert.deepEqual(split(250), [['i1', 100], ['i2', 100], ['v', 50]])
  // The VAT is paid without a day, before the first due date comes.
  assert.deepEqual(split(100, 'v'), [['v', 100]])
  assert.deepEqual(split(120, 'v'), [['v', 100], ['i1', 20]])
  assert.equal(split(300.01), null)
})

const storedRow = (patch) => ({
  id: 'p1', contract_id: 'c', kind: 'first_payment', seq: 1, title: 'one',
  note: null, rate: '30.0000', amount: '30000.00', paid_amount: '30000.00',
  due_date: null, is_balloon: false,
  ...patch,
})
const storedContract = {
  description: 'x', financier_id: 'f', total_amount: '115000.00',
  down_payment: '0.00', balloon_amount: '0.00', installment_count: 12,
  frequency_months: 1, first_due_date: null, notes: null, vat_mode: 'separate',
  vat_due: 'undecided', vat_amount: '15000.00', vat_due_date: null,
  contract_bank_name: null, contract_iban: null,
}

test('a paid percentage never locks the total: it stays what was paid', () => {
  const values = lib.contractFormValues(storedContract, [storedRow()], [])
  // Unchanged: still a percentage of the amount before VAT.
  assert.equal(lib.rateBaseOf(values), 100000)
  assert.equal(lib.firstPaymentsPayload(values.payments, 100000)[0].rate, 30)
  values.total_amount = '126500'
  const base = lib.rateBaseOf(values)
  assert.equal(base, 110000)
  const { input } = lib.planInputOf(values)
  const { plan, error } = lib.buildInstallmentPlan(input)
  assert.equal(error, null)
  assert.equal(plan.payments[0].amount, 30000)
  assert.equal(plan.installments.amount, 80000)
  const [sent] = plain(lib.firstPaymentsPayload(values.payments, base))
  assert.deepEqual([sent.rate, sent.amount], [null, 30000])
})

test('a paid VAT keeps its amount when the total is corrected', () => {
  const vatRow = storedRow({
    id: 'v', kind: 'vat', title: null, rate: null,
    amount: '15000.00', paid_amount: '1000.00', due_date: null,
  })
  const values = lib.contractFormValues(storedContract, [vatRow], [])
  assert.equal(lib.vatPayload(values).amount, 15000)
  // Without money on it, it follows the total.
  const open = lib.contractFormValues(storedContract, [], [])
  assert.equal(lib.vatPayload(open).amount, null)
})

test('a changed contract: the terms stored now, the free edits of the user', () => {
  const before = lib.contractFormValues(storedContract, [], [])
  const typed = { ...before, notes: 'typed', total_amount: '120000', vat_mode: 'none' }
  const now = lib.contractFormValues(
    { ...storedContract, first_due_date: '2027-01-15', description: 'renamed' },
    [storedRow()],
    [],
  )
  const merged = plain(lib.mergeStoredForm(typed, before, now))
  assert.equal(merged.first_due_date, '2027-01-15')
  assert.equal(merged.total_amount, '115000')
  assert.equal(merged.vat_mode, 'separate')
  assert.equal(merged.payments.length, 1)
  assert.equal(merged.notes, 'typed')
  assert.equal(merged.description, 'renamed')
})
