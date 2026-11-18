const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The pure installments module (src/lib/installments.ts): the terms check,
// the schedule and the row state mirror assert_installment_terms /
// generate_installment_schedule / installment_state of migration 0203, the
// allocation mirrors record_installment_payment. Made-up contracts, no
// network.
const ROOT = path.join(__dirname, '..')

function load(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInContext(
    `(function (exports, require) {${output}\n})`,
    vm.createContext({}),
    { filename: file },
  )(exports, (requested) => {
    throw new Error(`Unexpected module: ${requested}`)
  })
  return exports
}

const inst = load('installments')
const plain = (value) => JSON.parse(JSON.stringify(value))
const sum = (rows) =>
  rows.reduce((total, row) => total + Math.round(row.amount * 100), 0) / 100

const TERMS = {
  totalAmount: 1_150_000,
  downPayment: 150_000,
  balloonAmount: 0,
  installmentCount: 36,
  frequencyMonths: 1,
  firstDueDate: '2026-02-10',
}

test('the financed amount is the total without the down payment', () => {
  assert.equal(inst.financedAmount(TERMS), 1_000_000)
  assert.equal(
    inst.financedAmount({ totalAmount: 100.1, downPayment: 0.2 }),
    99.9,
  )
})

test('equal payments, the halala remainder on the last one', () => {
  const rows = inst.buildSchedule(TERMS)
  assert.equal(rows.length, 36)
  // 1,000,000 / 36 = 27,777.777… → 27,777.77 each, the rest on the last.
  assert.equal(rows[0].amount, 27_777.77)
  assert.equal(rows[34].amount, 27_777.77)
  assert.equal(rows[35].amount, 27_778.05)
  assert.equal(sum(rows), 1_000_000)
  assert.deepEqual(
    plain(rows.map((row) => row.seq)),
    Array.from({ length: 36 }, (_, index) => index + 1),
  )
  assert.equal(rows[0].dueDate, '2026-02-10')
  assert.equal(rows[1].dueDate, '2026-03-10')
  assert.equal(rows[35].dueDate, '2029-01-10')
  assert.ok(rows.every((row) => !row.isBalloon))
})

test('the final payment is the last row, the others share the rest', () => {
  const rows = inst.buildSchedule({
    ...TERMS,
    balloonAmount: 300_000,
    installmentCount: 13,
  })
  assert.equal(rows.length, 13)
  assert.equal(rows[12].amount, 300_000)
  assert.equal(rows[12].isBalloon, true)
  assert.equal(rows[12].seq, 13)
  assert.equal(rows[12].dueDate, '2027-02-10')
  // 700,000 over twelve regular payments.
  assert.equal(rows[0].amount, 58_333.33)
  assert.equal(rows[11].amount, 58_333.37)
  assert.equal(sum(rows), 1_000_000)
})

test('months are added to the first due date, a 31st stays the month end', () => {
  const rows = inst.buildSchedule({
    ...TERMS,
    installmentCount: 4,
    firstDueDate: '2026-01-31',
  })
  assert.deepEqual(plain(rows.map((row) => row.dueDate)), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ])
  assert.equal(inst.addMonths('2027-11-30', 3), '2028-02-29')
  assert.equal(inst.addMonths('2026-12-15', 1), '2027-01-15')
  const quarterly = inst.buildSchedule({
    ...TERMS,
    installmentCount: 3,
    frequencyMonths: 3,
  })
  assert.deepEqual(plain(quarterly.map((row) => row.dueDate)), [
    '2026-02-10',
    '2026-05-10',
    '2026-08-10',
  ])
})

test('the terms check answers with the token the database would raise', () => {
  const check = (patch) => inst.checkInstallmentTerms({ ...TERMS, ...patch })
  assert.equal(check({}), null)
  assert.equal(check({ totalAmount: 0 }), 'invalid_amount')
  assert.equal(check({ totalAmount: Number.NaN }), 'invalid_amount')
  assert.equal(check({ downPayment: -1 }), 'invalid_down_payment')
  assert.equal(check({ downPayment: 1_150_000 }), 'invalid_down_payment')
  assert.equal(check({ installmentCount: 0 }), 'invalid_installment_count')
  assert.equal(check({ installmentCount: 361 }), 'invalid_installment_count')
  assert.equal(check({ installmentCount: 1.5 }), 'invalid_installment_count')
  assert.equal(check({ frequencyMonths: 4 }), 'invalid_frequency')
  assert.equal(check({ firstDueDate: '' }), 'invalid_first_due_date')
  assert.equal(check({ firstDueDate: '10/02/2026' }), 'invalid_first_due_date')
  assert.equal(check({ balloonAmount: -1 }), 'invalid_balloon')
  // A final payment needs a regular one before it and stays under the
  // financed amount.
  assert.equal(
    check({ balloonAmount: 100, installmentCount: 1 }),
    'invalid_balloon',
  )
  assert.equal(check({ balloonAmount: 1_000_000 }), 'invalid_balloon')
  // Less than a halala a payment.
  assert.equal(
    check({ totalAmount: 0.05, downPayment: 0, installmentCount: 10 }),
    'invalid_amount',
  )
  // A past first due date is fine: running contracts are entered late.
  assert.equal(check({ firstDueDate: '2024-01-01' }), null)
  assert.deepEqual(plain(inst.buildSchedule({ ...TERMS, totalAmount: 0 })), [])
})

test('the state of a row by the Saudi day', () => {
  const state = (due, paid = 0) =>
    inst.installmentState(due, 1000, paid, '2026-11-18')
  assert.equal(state('2026-11-17'), 'overdue')
  assert.equal(state('2026-11-18'), 'due_today')
  assert.equal(state('2026-11-19'), 'due_soon')
  assert.equal(state('2026-12-18'), 'due_soon')
  assert.equal(state('2026-12-19'), 'upcoming')
  // A partly paid row keeps its state by date; a fully paid one is paid.
  assert.equal(state('2026-11-01', 400), 'overdue')
  assert.equal(state('2026-11-01', 1000), 'paid')
  assert.equal(inst.daysUntilDue('2026-11-25', '2026-11-18'), 7)
  assert.equal(inst.daysUntilDue('2026-11-15', '2026-11-18'), -3)
  for (const key of ['paid', 'overdue', 'due_today', 'due_soon', 'upcoming'])
    assert.ok(inst.INSTALLMENT_STATE_BADGE[key].key)
  assert.equal(inst.INSTALLMENT_STATE_BADGE.overdue.tone, 'danger')
})

test('a payment goes to the oldest unpaid row first', () => {
  const rows = [
    { id: 'c', seq: 3, dueDate: '2026-03-10', amount: 1000, paidAmount: 0 },
    { id: 'a', seq: 1, dueDate: '2026-01-10', amount: 1000, paidAmount: 1000 },
    { id: 'b', seq: 2, dueDate: '2026-02-10', amount: 1000, paidAmount: 250 },
  ]
  assert.deepEqual(plain(inst.allocatePayment(rows, 500)), [
    { id: 'b', amount: 500 },
  ])
  // One payment may cover more than one installment.
  assert.deepEqual(plain(inst.allocatePayment(rows, 1000.5)), [
    { id: 'b', amount: 750 },
    { id: 'c', amount: 250.5 },
  ])
  assert.deepEqual(plain(inst.allocatePayment(rows, 1750)), [
    { id: 'b', amount: 750 },
    { id: 'c', amount: 1000 },
  ])
  // More than what remains, or nothing: refused.
  assert.equal(inst.allocatePayment(rows, 1750.01), null)
  assert.equal(inst.allocatePayment(rows, 0), null)
  assert.equal(inst.allocatePayment(rows, -5), null)
})

test('a refused write is answered by its own message, never the raw text', () => {
  const message = (text) => inst.installmentErrorMessage({ message: text })
  assert.equal(message('contract_has_payments'), 'instErrContractHasPayments')
  // The longer token wins over the one it contains.
  assert.equal(message('invalid_payment_amount'), 'instErrPaymentAmount')
  assert.equal(message('invalid_payment'), 'instErrPayment')
  assert.equal(message('invalid_notes'), 'instErrNotes')
  assert.equal(message('invalid_note'), 'instErrNote')
  assert.equal(
    message(
      'duplicate key value violates unique constraint "installment_financiers_name_unique"',
    ),
    'instErrFinancierDuplicate',
  )
  assert.equal(
    message(
      'update or delete on table "installment_financiers" violates foreign key constraint "installment_contracts_financier_id_fkey"',
    ),
    'instErrFinancierInUse',
  )
  assert.equal(message('relation does not exist'), 'instSaveFailed')
  assert.equal(inst.installmentErrorMessage(null), 'instSaveFailed')
})

test('every label and message key exists in both languages, without hamza alif', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  const keys = new Set([
    'permissionGroupInstallments',
    'instSaveFailed',
    'instErrFinancierDuplicate',
    'instErrFinancierInUse',
    ...Object.values(inst.INSTALLMENT_ERROR_KEYS),
    ...Object.values(inst.INSTALLMENT_FREQUENCY_LABEL_KEYS),
    ...Object.values(inst.INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS),
    ...Object.values(inst.INSTALLMENT_STATE_BADGE).map((badge) => badge.key),
    ...Object.values(inst.INSTALLMENT_CONTRACT_STATUS_BADGE).map(
      (badge) => badge.key,
    ),
  ])
  for (const key of keys) {
    const found = source.match(new RegExp(`^\\s+${key}:`, 'gm')) ?? []
    assert.equal(found.length, 2, `${key} in Arabic and English`)
  }
  const blocks = [
    ...source.matchAll(
      /\/\/ installments \(0203\)\n([\s\S]*?)\/\/ end installments \(0203\)/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  // The roles page labels the group.
  const roles = fs.readFileSync(
    path.join(ROOT, 'src', 'lib', 'rolesAdmin.ts'),
    'utf8',
  )
  assert.match(roles, /installments: 'permissionGroupInstallments'/)
})
