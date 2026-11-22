const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The pure rules of the unified installments page (owner 2026-11-21:
// «اعتمد الصفحات وابني»): src/lib/installmentsBoard.ts.

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

const board = loadLibModule('installmentsBoard')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const TODAY = '2026-11-19' // a Thursday

const due = (over) => ({
  id: over.id ?? over.due_date,
  contract_id: 'c1',
  contract_number: 'INS-0003',
  description: 'x',
  financier_id: 'f1',
  financier_name: 'f',
  seq: 1,
  installment_count: 12,
  amount: 1000,
  paid_amount: 0,
  remaining_amount: 1000,
  is_balloon: false,
  is_partial: false,
  state: 'upcoming',
  last_paid_on: null,
  ...over,
})

test('days and weeks: Sunday first, the week ends on Saturday', () => {
  assert.equal(board.addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(board.addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(board.weekdayOf('2026-11-22'), 0)
  assert.equal(board.weekEndOf(TODAY), '2026-11-21')
  assert.equal(board.weekEndOf('2026-11-21'), '2026-11-21')
})

test('the calendar grid of a month', () => {
  const weeks = board.monthGrid('2026-11')
  assert.equal(weeks.length, 5)
  assert.equal(weeks[0][0], '2026-11-01')
  assert.equal(weeks[4][1], '2026-11-30')
  assert.equal(weeks[4][2], null)
  const feb = board.monthGrid('2026-02')
  assert.equal(feb[0][0], '2026-02-01')
  assert.ok(feb.every((week) => week.length === 7))
  assert.equal(board.shiftMonth('2026-12', 1), '2027-01')
  assert.equal(board.shiftMonth('2026-01', -1), '2025-12')
})

test('the colour of a due row and its amount', () => {
  assert.equal(board.dueTone(due({ days_until_due: -3, state: 'overdue' })), 'danger')
  assert.equal(board.dueTone(due({ days_until_due: 7 })), 'warning')
  assert.equal(board.dueTone(due({ days_until_due: 8 })), 'info')
  assert.equal(board.dueTone(due({ days_until_due: -9, state: 'paid' })), 'success')
  assert.equal(board.dueShownAmount(due({ state: 'paid', amount: 900, remaining_amount: 0 })), 900)
  assert.equal(board.shortContractNumber('INS-0016'), '0016')
})

test('the dues feed in groups', () => {
  const rows = [
    due({ due_date: '2026-11-16', days_until_due: -3, state: 'overdue' }),
    due({ due_date: '2026-11-20', days_until_due: 1 }),
    due({ due_date: '2026-11-21', days_until_due: 2 }),
    due({ due_date: '2026-11-25', days_until_due: 6, remaining_amount: 250.5 }),
    due({ due_date: '2026-12-10', days_until_due: 21 }),
  ]
  const groups = plain(board.groupDues(rows, 'open', TODAY))
  assert.deepEqual(groups.map((g) => [g.kind, g.rows.length, g.total]), [
    ['overdue', 1, 1000],
    ['this_week', 2, 2000],
    ['next_week', 1, 250.5],
    ['month', 1, 1000],
  ])
  assert.equal(groups[3].month, '2026-12')
  const paid = plain(board.groupDues([
    due({ due_date: '2026-10-01', days_until_due: -49, state: 'paid', last_paid_on: '2026-11-02', remaining_amount: 0 }),
  ], 'paid', TODAY))
  assert.deepEqual(paid.map((g) => [g.kind, g.month, g.total]), [['paid_month', '2026-11', 1000]])
})

test('the contracts: figures, chips, shares, the card state', () => {
  const rows = [
    { id: 'a', financier_id: 'f1', status: 'active', first_due_date: '2026-01-31', payable_total: 1000, paid_overall: 400, remaining_total: 600, overdue_count: 1, last_due_date: '2026-12-31' },
    { id: 'b', financier_id: 'f2', status: 'active', first_due_date: '2026-06-01', payable_total: 1000, paid_overall: 0, remaining_total: 1000, overdue_count: 0, last_due_date: '2029-05-01' },
    { id: 'c', financier_id: 'f1', status: 'paid_off', first_due_date: '2025-02-01', payable_total: 500, paid_overall: 500, remaining_total: 0, overdue_count: 0, last_due_date: '2026-01-01' },
    { id: 'd', financier_id: 'f3', status: 'cancelled', first_due_date: null, payable_total: 900, paid_overall: 0, remaining_total: 900, overdue_count: 0, last_due_date: '2027-01-01' },
  ]
  const summary = plain(board.summarizeContracts(rows, TODAY))
  assert.deepEqual(summary, {
    activeCount: 2,
    activeFinanciers: 2,
    paid: 900,
    payable: 2500,
    paidPercent: 36,
    remaining: 1600,
    lastYear: 2029,
    endingThisYear: 1,
  })
  assert.deepEqual(plain(board.contractChipCounts(rows, TODAY)), {
    all: 4, overdue: 1, awaiting: 0, ending: 1, paid_off: 1, cancelled: 1,
  })
  // 0209: waiting for the first due date — only an active contract waits.
  const waiting = { ...rows[1], id: 'e', first_due_date: null, last_due_date: null }
  const withWaiting = plain(board.contractChipCounts([...rows, waiting], TODAY))
  assert.equal(withWaiting.awaiting, 1)
  assert.equal(withWaiting.ending, 1)
  assert.equal(board.readContractChip('awaiting'), 'awaiting')
  // 90 days from 1 September end before row a's last installment.
  assert.equal(plain(board.contractChipCounts(rows, '2026-09-01')).ending, 0)
  assert.deepEqual(plain(board.financierShares(rows)), [
    { financierId: 'f2', remaining: 1000, share: 63 },
    { financierId: 'f1', remaining: 600, share: 38 },
  ])
  assert.equal(board.contractCardState({ status: 'active', overdue_count: 2 }), 'overdue')
  assert.equal(board.contractCardState({ status: 'active', overdue_count: 0 }), 'active')
  assert.equal(board.contractCardState({ status: 'active', overdue_count: 0, first_due_date: null }), 'awaiting')
  assert.equal(board.contractCardState({ status: 'active', overdue_count: 1, first_due_date: null }), 'overdue')
  assert.equal(board.contractCardState({ status: 'cancelled', overdue_count: 0, first_due_date: null }), 'cancelled')
  // The share of the whole contract, with what was paid before entry.
  assert.equal(board.contractPaidPercent({ paid_overall: 500, payable_total: 1000 }), 50)
  assert.equal(board.currentSeq({ paid_count: 36, installment_count: 36 }), 36)
  assert.equal(board.currentSeq({ paid_count: 8, installment_count: 36 }), 9)
  assert.equal(board.financierTone([{ id: 'x' }, { id: 'y' }], 'y'), 2)
  assert.equal(board.financierTone([{ id: 'x' }], 'z'), 4)
  assert.equal(board.readContractChip('nope'), 'all')
  assert.equal(board.readDuesFeedView('paid'), 'paid')
  assert.equal(board.readContractSort(null), 'next_due')
})

test('the month ring', () => {
  const ring = plain(board.monthDueSummary([
    due({ amount: 1000, remaining_amount: 0 }),
    due({ amount: 500, remaining_amount: 500 }),
  ]))
  assert.deepEqual(ring, { due: 1500, paid: 1000, remaining: 500, percent: 67 })
})
