import {
  addMonths,
  allocatePayment,
  buildSchedule,
  checkInstallmentTerms,
  financedAmount,
  fromHalalas,
  installmentState,
  toHalalas,
  type InstallmentContractStatus,
  type InstallmentPaymentMethod,
  type InstallmentState,
  type InstallmentTerms,
} from '@/lib/installments'

/**
 * Sample data and an in-memory store for the /ui-kit mockup of «الاقساط»
 * (owner 2026-11-18, «سويها في ui-kit»). Every action follows the function
 * of migration 0203 it stands for, rule by rule, on the pure module
 * `src/lib/installments.ts`, and answers a refusal with the token the
 * database would raise. Nothing here reads or writes the database.
 *
 * The contract page's history is DERIVED (`historyOf`): 0203 keeps no event
 * table, so the store only remembers who did what and in which order — the
 * creation, each payment, each void, the cancellation.
 */

export interface MockFinancier {
  id: string
  name: string
}

export interface MockRow {
  seq: number
  /** yyyy-mm-dd */
  dueDate: string
  amount: number
  isBalloon: boolean
  paidAmount: number
}

export interface MockContract {
  id: string
  number: string
  description: string
  financierId: string
  terms: InstallmentTerms
  notes: string
  /** Codes of the linked units; empty = no link. */
  equipment: string[]
  status: InstallmentContractStatus
  cancelReason: string | null
  createdBy: string
  /** yyyy-mm-dd */
  createdOn: string
  /** A counter: the greater, the later the contract changed. */
  touched: number
  /** The store clock when the contract was created (the history order). */
  createdSeq: number
  /** The day the contract was paid off or cancelled; null while active. */
  closedOn: string | null
  /** The store clock of that closing. */
  closedSeq: number | null
  cancelledBy: string | null
  rows: MockRow[]
}

export interface MockPayment {
  id: string
  contractId: string
  /** yyyy-mm-dd */
  paidOn: string
  amount: number
  method: InstallmentPaymentMethod
  reference: string
  note: string
  status: 'posted' | 'voided'
  voidReason: string | null
  by: string
  /** The day the payment was recorded (it may be after `paidOn`). */
  recordedOn: string
  /** The store clock when it was recorded (the history order). */
  recordedSeq: number
  voidedBy: string | null
  voidedOn: string | null
  voidedSeq: number | null
  allocations: { seq: number; amount: number }[]
}

export interface MockStore {
  financiers: MockFinancier[]
  contracts: MockContract[]
  payments: MockPayment[]
  /** The last issued contract sequence (INS-0007 → 7). */
  lastSeq: number
  /** A counter for ids and for `touched`. */
  clock: number
}

export type MockResult =
  { ok: true; store: MockStore; id: string } | { ok: false; token: string }

/** The signed-in user of the mockup. */
export const MOCK_USER = 'مبارك'

/** The units the optional link offers in the mockup. */
export const MOCK_UNITS: readonly { code: string; type: string }[] = [
  { code: 'A291', type: 'حفار' },
  { code: 'A305', type: 'شيول' },
  { code: 'A112', type: 'رافعة' },
  { code: 'A418', type: 'قلاب' },
  { code: 'A419', type: 'قلاب' },
  { code: 'A420', type: 'قلاب' },
  { code: 'A377', type: 'بوكلين' },
]

/** The unit of a linked code, or null for a code the list does not know. */
export function unitOf(code: string): { code: string; type: string } | null {
  return MOCK_UNITS.find((unit) => unit.code === code) ?? null
}

const DAY_MS = 86_400_000

/** A day key moved by whole days. */
export function shiftDays(dateKey: string, days: number): string {
  const time = Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS
  return new Date(time).toISOString().slice(0, 10)
}

const contractNumber = (seq: number) =>
  `INS-${String(seq).padStart(Math.max(4, String(seq).length), '0')}`

export function rowsOfTerms(terms: InstallmentTerms): MockRow[] {
  return buildSchedule(terms).map((row) => ({ ...row, paidAmount: 0 }))
}

export function remainingOf(contract: MockContract): number {
  return fromHalalas(
    contract.rows.reduce(
      (sum, row) => sum + toHalalas(row.amount) - toHalalas(row.paidAmount),
      0,
    ),
  )
}

export function paidOf(contract: MockContract): number {
  return fromHalalas(
    contract.rows.reduce((sum, row) => sum + toHalalas(row.paidAmount), 0),
  )
}

export const isRowPaid = (row: MockRow) =>
  toHalalas(row.paidAmount) >= toHalalas(row.amount)

/** What a row still asks for, in halalas so no float dust shows. */
export const rowRemaining = (row: MockRow) =>
  fromHalalas(toHalalas(row.amount) - toHalalas(row.paidAmount))

/** The next unpaid row of a contract (the oldest), or null. */
export function nextRowOf(contract: MockContract): MockRow | null {
  return contract.rows.find((row) => !isRowPaid(row)) ?? null
}

export function hasPostedPayment(store: MockStore, contractId: string) {
  return store.payments.some(
    (payment) =>
      payment.contractId === contractId && payment.status === 'posted',
  )
}

// --- The actions (each mirrors a 0203 function) ------------------------------------

export interface ContractDraft {
  description: string
  financierId: string
  terms: InstallmentTerms
  notes: string
  equipment: string[]
}

function termsChanged(a: InstallmentTerms, b: InstallmentTerms): boolean {
  return (
    toHalalas(a.totalAmount) !== toHalalas(b.totalAmount) ||
    toHalalas(a.downPayment) !== toHalalas(b.downPayment) ||
    toHalalas(a.balloonAmount) !== toHalalas(b.balloonAmount) ||
    a.installmentCount !== b.installmentCount ||
    a.frequencyMonths !== b.frequencyMonths ||
    a.firstDueDate !== b.firstDueDate
  )
}

/** `save_installment_contract`: `id` null = a new contract. */
export function saveContract(
  store: MockStore,
  id: string | null,
  draft: ContractDraft,
  today: string,
): MockResult {
  const current = id
    ? store.contracts.find((contract) => contract.id === id)
    : null
  if (id && !current) return { ok: false, token: 'invalid_contract' }
  if (current?.status === 'cancelled')
    return { ok: false, token: 'contract_not_active' }
  const description = draft.description.trim()
  if (!description || description.length > 200)
    return { ok: false, token: 'invalid_description' }
  if (!store.financiers.some((item) => item.id === draft.financierId))
    return { ok: false, token: 'invalid_financier' }
  if (draft.notes.trim().length > 1000)
    return { ok: false, token: 'invalid_notes' }
  const termsError = checkInstallmentTerms(draft.terms)
  if (termsError) return { ok: false, token: termsError }

  const clock = store.clock + 1
  if (!current) {
    const lastSeq = store.lastSeq + 1
    const contract: MockContract = {
      id: `c${clock}`,
      number: contractNumber(lastSeq),
      description,
      financierId: draft.financierId,
      terms: draft.terms,
      notes: draft.notes.trim(),
      equipment: [...new Set(draft.equipment)],
      status: 'active',
      cancelReason: null,
      createdBy: MOCK_USER,
      createdOn: today,
      touched: clock,
      createdSeq: clock,
      closedOn: null,
      closedSeq: null,
      cancelledBy: null,
      rows: rowsOfTerms(draft.terms),
    }
    return {
      ok: true,
      id: contract.id,
      store: {
        ...store,
        clock,
        lastSeq,
        contracts: [...store.contracts, contract],
      },
    }
  }
  const changed = termsChanged(current.terms, draft.terms)
  if (changed && hasPostedPayment(store, current.id))
    return { ok: false, token: 'contract_has_payments' }
  const next: MockContract = {
    ...current,
    description,
    financierId: draft.financierId,
    terms: draft.terms,
    notes: draft.notes.trim(),
    equipment: [...new Set(draft.equipment)],
    touched: clock,
    rows: changed ? rowsOfTerms(draft.terms) : current.rows,
  }
  return {
    ok: true,
    id: current.id,
    store: {
      ...store,
      clock,
      contracts: store.contracts.map((contract) =>
        contract.id === current.id ? next : contract,
      ),
    },
  }
}

/** `cancel_installment_contract`. */
export function cancelContract(
  store: MockStore,
  id: string,
  reason: string,
  today: string | null = null,
  by: string = MOCK_USER,
): MockResult {
  const contract = store.contracts.find((item) => item.id === id)
  if (!reason.trim() || reason.trim().length > 500)
    return { ok: false, token: 'reason_required' }
  if (!contract) return { ok: false, token: 'invalid_contract' }
  if (contract.status !== 'active')
    return { ok: false, token: 'contract_not_active' }
  if (hasPostedPayment(store, id))
    return { ok: false, token: 'contract_has_payments' }
  const clock = store.clock + 1
  return {
    ok: true,
    id,
    store: {
      ...store,
      clock,
      contracts: store.contracts.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'cancelled',
              cancelReason: reason.trim(),
              touched: clock,
              closedOn: today,
              closedSeq: clock,
              cancelledBy: by,
            }
          : item,
      ),
    },
  }
}

export interface PaymentDraft {
  paidOn: string
  amount: number
  method: InstallmentPaymentMethod
  reference: string
  note: string
}

/** `record_installment_payment`. */
export function recordPayment(
  store: MockStore,
  contractId: string,
  draft: PaymentDraft,
  today: string,
  by: string = MOCK_USER,
  recordedOn: string = today,
): MockResult {
  const contract = store.contracts.find((item) => item.id === contractId)
  if (!contract) return { ok: false, token: 'invalid_contract' }
  if (contract.status !== 'active')
    return { ok: false, token: 'contract_not_active' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn) || draft.paidOn > today)
    return { ok: false, token: 'invalid_paid_on' }
  if (draft.reference.trim().length > 80)
    return { ok: false, token: 'invalid_reference' }
  if (draft.note.trim().length > 500)
    return { ok: false, token: 'invalid_note' }
  if (!Number.isFinite(draft.amount) || toHalalas(draft.amount) <= 0)
    return { ok: false, token: 'invalid_payment_amount' }
  const allocations = allocatePayment(
    contract.rows.map((row) => ({ id: String(row.seq), ...row })),
    draft.amount,
  )
  if (!allocations) return { ok: false, token: 'payment_exceeds_balance' }
  const taken = new Map(
    allocations.map((item) => [Number(item.id), item.amount]),
  )
  const rows = contract.rows.map((row) =>
    taken.has(row.seq)
      ? {
          ...row,
          paidAmount: fromHalalas(
            toHalalas(row.paidAmount) + toHalalas(taken.get(row.seq) ?? 0),
          ),
        }
      : row,
  )
  const clock = store.clock + 1
  const payment: MockPayment = {
    id: `p${clock}`,
    contractId,
    paidOn: draft.paidOn,
    amount: fromHalalas(toHalalas(draft.amount)),
    method: draft.method,
    reference: draft.reference.trim(),
    note: draft.note.trim(),
    status: 'posted',
    voidReason: null,
    by,
    recordedOn,
    recordedSeq: clock,
    voidedBy: null,
    voidedOn: null,
    voidedSeq: null,
    allocations: allocations.map((item) => ({
      seq: Number(item.id),
      amount: item.amount,
    })),
  }
  const paidOff = rows.every(isRowPaid)
  return {
    ok: true,
    id: payment.id,
    store: {
      ...store,
      clock,
      payments: [...store.payments, payment],
      contracts: store.contracts.map((item) =>
        item.id === contractId
          ? {
              ...item,
              rows,
              status: paidOff ? 'paid_off' : 'active',
              touched: clock,
              closedOn: paidOff ? draft.paidOn : null,
              closedSeq: paidOff ? clock : null,
            }
          : item,
      ),
    },
  }
}

/** `void_installment_payment`. */
export function voidPayment(
  store: MockStore,
  paymentId: string,
  reason: string,
  today: string | null = null,
  by: string = MOCK_USER,
): MockResult {
  if (!reason.trim() || reason.trim().length > 500)
    return { ok: false, token: 'reason_required' }
  const payment = store.payments.find((item) => item.id === paymentId)
  if (!payment) return { ok: false, token: 'invalid_payment' }
  if (payment.status === 'voided')
    return { ok: false, token: 'payment_already_voided' }
  const contract = store.contracts.find(
    (item) => item.id === payment.contractId,
  )
  if (!contract || contract.status === 'cancelled')
    return { ok: false, token: 'contract_not_active' }
  const back = new Map(payment.allocations.map((item) => [item.seq, item]))
  // A term change after an earlier void rebuilt the rows: only what still
  // carries the amount is taken back.
  const rows = contract.rows.map((row) => {
    const allocation = back.get(row.seq)
    if (!allocation) return row
    return {
      ...row,
      paidAmount: fromHalalas(
        Math.max(0, toHalalas(row.paidAmount) - toHalalas(allocation.amount)),
      ),
    }
  })
  const clock = store.clock + 1
  return {
    ok: true,
    id: paymentId,
    store: {
      ...store,
      clock,
      payments: store.payments.map((item) =>
        item.id === paymentId
          ? {
              ...item,
              status: 'voided',
              voidReason: reason.trim(),
              voidedBy: by,
              voidedOn: today ?? item.recordedOn,
              voidedSeq: clock,
            }
          : item,
      ),
      contracts: store.contracts.map((item) =>
        item.id === contract.id
          ? {
              ...item,
              rows,
              status: 'active',
              touched: clock,
              closedOn: null,
              closedSeq: null,
            }
          : item,
      ),
    },
  }
}

/** The direct writes of `installment_financiers`. */
export function saveFinancier(
  store: MockStore,
  id: string | null,
  name: string,
): MockResult {
  const clean = name.trim()
  if (!clean || clean.length > 120)
    return { ok: false, token: 'installment_financiers_name_check' }
  if (
    store.financiers.some(
      (item) =>
        item.id !== id && item.name.toLowerCase() === clean.toLowerCase(),
    )
  )
    return { ok: false, token: 'installment_financiers_name_unique' }
  const clock = store.clock + 1
  if (!id) {
    const financier = { id: `f${clock}`, name: clean }
    return {
      ok: true,
      id: financier.id,
      store: { ...store, clock, financiers: [...store.financiers, financier] },
    }
  }
  return {
    ok: true,
    id,
    store: {
      ...store,
      clock,
      financiers: store.financiers.map((item) =>
        item.id === id ? { ...item, name: clean } : item,
      ),
    },
  }
}

export function deleteFinancier(store: MockStore, id: string): MockResult {
  if (store.contracts.some((contract) => contract.financierId === id))
    return { ok: false, token: 'installment_contracts_financier_id_fkey' }
  return {
    ok: true,
    id,
    store: {
      ...store,
      financiers: store.financiers.filter((item) => item.id !== id),
    },
  }
}

// --- What the screens read (the views of 0203) -------------------------------------

export interface DueItem {
  key: string
  contract: MockContract
  financierName: string
  row: MockRow
  remaining: number
  isPartial: boolean
  state: InstallmentState
  /** Negative = days overdue. */
  days: number
}

const dayNumber = (dateKey: string) =>
  Math.round(Date.parse(`${dateKey}T00:00:00Z`) / DAY_MS)

/** `installment_dues` for the unpaid rows of the ACTIVE contracts, the
 *  nearest first. */
export function openDues(store: MockStore, today: string): DueItem[] {
  const names = new Map(store.financiers.map((item) => [item.id, item.name]))
  const items: DueItem[] = []
  for (const contract of store.contracts) {
    if (contract.status !== 'active') continue
    for (const row of contract.rows) {
      if (isRowPaid(row)) continue
      items.push({
        key: `${contract.id}:${row.seq}`,
        contract,
        financierName: names.get(contract.financierId) ?? '',
        row,
        remaining: rowRemaining(row),
        isPartial: row.paidAmount > 0,
        state: installmentState(row.dueDate, row.amount, row.paidAmount, today),
        days: dayNumber(row.dueDate) - dayNumber(today),
      })
    }
  }
  return items.sort((a, b) =>
    a.row.dueDate === b.row.dueDate
      ? a.contract.number.localeCompare(b.contract.number)
      : a.row.dueDate < b.row.dueDate
        ? -1
        : 1,
  )
}

export interface Overview {
  overdueCount: number
  overdueAmount: number
  due7Count: number
  due7Amount: number
  due30Count: number
  due30Amount: number
  remainingTotal: number
  activeContracts: number
}

/** `installment_overview`: the 30 days contain the 7, both from today. */
export function overviewOf(dues: readonly DueItem[]): Overview {
  const sum = (items: readonly DueItem[]) =>
    fromHalalas(
      items.reduce((total, item) => total + toHalalas(item.remaining), 0),
    )
  const overdue = dues.filter((item) => item.days < 0)
  const within = (days: number) =>
    dues.filter((item) => item.days >= 0 && item.days <= days)
  return {
    overdueCount: overdue.length,
    overdueAmount: sum(overdue),
    due7Count: within(7).length,
    due7Amount: sum(within(7)),
    due30Count: within(30).length,
    due30Amount: sum(within(30)),
    remainingTotal: sum(dues),
    activeContracts: new Set(dues.map((item) => item.contract.id)).size,
  }
}

const sumRemaining = (items: readonly DueItem[]) =>
  fromHalalas(
    items.reduce((total, item) => total + toHalalas(item.remaining), 0),
  )

/** What a list of dues still asks for. */
export function sumDues(items: readonly DueItem[]): number {
  return sumRemaining(items)
}

/** yyyy-mm of a day key. */
export const monthKeyOf = (dateKey: string) => dateKey.slice(0, 7)

export type DuesView = 'overdue' | 'month' | 'next30' | 'all'

/** The sub-tabs of «الاستحقاقات»: overdue, due in today's month (its overdue
 *  rows included), due today or within 30 days, every unpaid row. */
export function duesInView(
  dues: readonly DueItem[],
  view: DuesView,
  today: string,
): DueItem[] {
  switch (view) {
    case 'overdue':
      return dues.filter((item) => item.days < 0)
    case 'month':
      return dues.filter(
        (item) => monthKeyOf(item.row.dueDate) === monthKeyOf(today),
      )
    case 'next30':
      return dues.filter((item) => item.days >= 0 && item.days <= 30)
    default:
      return [...dues]
  }
}

export interface MonthBucket {
  /** yyyy-mm */
  key: string
  total: number
  count: number
}

/** What is still to pay in each of the coming months, this month first.
 *  Overdue rows are left out: the chart shows what is coming, not what is
 *  late. */
export function monthlyDues(
  dues: readonly DueItem[],
  today: string,
  months = 12,
): MonthBucket[] {
  const first = `${monthKeyOf(today)}-01`
  return Array.from({ length: months }, (_, index) => {
    const key = monthKeyOf(addMonths(first, index))
    const rows = dues.filter(
      (item) => item.days >= 0 && monthKeyOf(item.row.dueDate) === key,
    )
    return { key, total: sumRemaining(rows), count: rows.length }
  })
}

export interface ContractSummary {
  financed: number
  paid: number
  remaining: number
  /** Paid out of financed, 0–100. */
  percent: number
  paidCount: number
  rowCount: number
  /** Overdue rows of an ACTIVE contract; 0 for a closed one. */
  overdueCount: number
  overdueAmount: number
  /** The oldest unpaid row, whatever the status. */
  next: MockRow | null
  firstDue: string | null
  lastDue: string | null
}

/** `installment_contract_summary` for one contract. */
export function summaryOf(
  contract: MockContract,
  today: string,
): ContractSummary {
  const financed = financedAmount(contract.terms)
  const paid = paidOf(contract)
  const overdue =
    contract.status === 'active'
      ? contract.rows.filter((row) => !isRowPaid(row) && row.dueDate < today)
      : []
  return {
    financed,
    paid,
    remaining: remainingOf(contract),
    percent:
      financed > 0 ? Math.min(100, Math.round((paid / financed) * 100)) : 0,
    paidCount: contract.rows.filter(isRowPaid).length,
    rowCount: contract.rows.length,
    overdueCount: overdue.length,
    overdueAmount: fromHalalas(
      overdue.reduce(
        (sum, row) => sum + toHalalas(row.amount) - toHalalas(row.paidAmount),
        0,
      ),
    ),
    next: nextRowOf(contract),
    firstDue: contract.rows[0]?.dueDate ?? null,
    lastDue: contract.rows[contract.rows.length - 1]?.dueDate ?? null,
  }
}

/** A financier's contracts: all of them (what blocks its deletion), the
 *  active ones and what those still owe. */
export function financierStats(
  store: MockStore,
  financierId: string,
): { contracts: number; activeContracts: number; remaining: number } {
  const mine = store.contracts.filter(
    (contract) => contract.financierId === financierId,
  )
  const active = mine.filter((contract) => contract.status === 'active')
  return {
    contracts: mine.length,
    activeContracts: active.length,
    remaining: fromHalalas(
      active.reduce(
        (sum, contract) => sum + toHalalas(remainingOf(contract)),
        0,
      ),
    ),
  }
}

export type HistoryKind =
  'created' | 'payment_recorded' | 'payment_voided' | 'paid_off' | 'cancelled'

export interface HistoryEvent {
  key: string
  kind: HistoryKind
  /** yyyy-mm-dd, or null when the store does not know the day. */
  on: string | null
  by: string
  /** The payment's amount, for the two payment events. */
  amount: number | null
  /** The void or cancel reason. */
  detail: string | null
  /** The store clock of the event: the greater, the later. */
  order: number
}

/**
 * The contract's history, the newest first, DERIVED from what the store
 * keeps: the creation, every payment, every void with its reason, the full
 * payment that closed the contract (only while it is still paid off) and the
 * cancellation. Migration 0203 has no event table.
 */
export function historyOf(
  store: MockStore,
  contractId: string,
): HistoryEvent[] {
  const contract = store.contracts.find((item) => item.id === contractId)
  if (!contract) return []
  const events: HistoryEvent[] = [
    {
      key: 'created',
      kind: 'created',
      on: contract.createdOn,
      by: contract.createdBy,
      amount: null,
      detail: null,
      order: contract.createdSeq,
    },
  ]
  for (const payment of store.payments) {
    if (payment.contractId !== contractId) continue
    events.push({
      key: `${payment.id}:recorded`,
      kind: 'payment_recorded',
      on: payment.recordedOn,
      by: payment.by,
      amount: payment.amount,
      detail: null,
      order: payment.recordedSeq,
    })
    if (payment.status === 'voided' && payment.voidedSeq !== null)
      events.push({
        key: `${payment.id}:voided`,
        kind: 'payment_voided',
        on: payment.voidedOn,
        by: payment.voidedBy ?? '',
        amount: payment.amount,
        detail: payment.voidReason,
        order: payment.voidedSeq,
      })
    if (
      contract.status === 'paid_off' &&
      contract.closedSeq === payment.recordedSeq
    )
      events.push({
        key: 'paid_off',
        kind: 'paid_off',
        on: contract.closedOn,
        by: payment.by,
        amount: null,
        detail: null,
        // Right after the payment that closed it.
        order: payment.recordedSeq + 0.5,
      })
  }
  if (contract.status === 'cancelled' && contract.closedSeq !== null)
    events.push({
      key: 'cancelled',
      kind: 'cancelled',
      on: contract.closedOn,
      by: contract.cancelledBy ?? '',
      amount: null,
      detail: contract.cancelReason,
      order: contract.closedSeq,
    })
  return events.sort((a, b) => b.order - a.order)
}

// --- The sample data ----------------------------------------------------------------

interface Seed {
  description: string
  financier: string
  totalAmount: number
  downPayment?: number
  balloonAmount?: number
  installmentCount: number
  frequencyMonths: number
  /** The next unpaid row is due this many days from today … */
  nextInDays: number
  /** … after this many rows were paid in full. */
  paidRows: number
  /** A part payment on the next row. */
  partial?: number
  equipment?: string[]
  notes?: string
  /** Cancelled with this reason, three days after it was entered. */
  cancelled?: string
}

const SEEDS: readonly Seed[] = [
  {
    description: 'رافعة تادانو 50 طن',
    financier: 'بنك الراجحي',
    totalAmount: 1_440_000,
    downPayment: 150_000,
    installmentCount: 60,
    frequencyMonths: 1,
    nextInDays: 13,
    paidRows: 21,
    equipment: ['A112'],
  },
  {
    description: 'قلابات مرسيدس (3)',
    financier: 'بنك الرياض',
    totalAmount: 876_000,
    installmentCount: 48,
    frequencyMonths: 1,
    nextInDays: 0,
    paidRows: 13,
    partial: 10_000,
    equipment: ['A418', 'A419', 'A420'],
  },
  {
    description: 'حفار كاتربيلر 320',
    financier: 'بنك الراجحي',
    totalAmount: 1_200_000,
    downPayment: 120_000,
    installmentCount: 36,
    frequencyMonths: 1,
    nextInDays: 7,
    paidRows: 9,
    equipment: ['A291'],
    notes: 'عقد مرابحة، الخصم من حساب الشركة يوم الاستحقاق.',
  },
  {
    description: 'شيول كوماتسو WA470',
    financier: 'عبداللطيف جميل',
    totalAmount: 300_000,
    installmentCount: 24,
    frequencyMonths: 1,
    nextInDays: -3,
    paidRows: 4,
    equipment: ['A305'],
  },
  {
    description: 'ارض المستودع (السلي)',
    financier: 'بنك الرياض',
    totalAmount: 100_000,
    balloonAmount: 40_000,
    installmentCount: 5,
    frequencyMonths: 3,
    nextInDays: 74,
    paidRows: 4,
  },
  {
    description: 'بوكلين هيونداي',
    financier: 'الجبر التجارية',
    totalAmount: 261_333.24,
    installmentCount: 12,
    frequencyMonths: 1,
    nextInDays: -12,
    paidRows: 1,
    equipment: ['A377'],
  },
  {
    description: 'سيارات نقل (4)',
    financier: 'عبداللطيف جميل',
    totalAmount: 320_000,
    installmentCount: 24,
    frequencyMonths: 1,
    nextInDays: -200,
    paidRows: 24,
  },
  {
    description: 'مولد كهرباء 500 ك.ف',
    financier: 'الجبر التجارية',
    totalAmount: 180_000,
    downPayment: 30_000,
    installmentCount: 12,
    frequencyMonths: 1,
    nextInDays: 40,
    paidRows: 0,
    cancelled: 'ادخل العقد مرتين بالخطا',
  },
]

/** The store the mockup opens with; every date is relative to `today`. */
export function seedStore(today: string): MockStore {
  let store: MockStore = {
    financiers: [],
    contracts: [],
    payments: [],
    lastSeq: 0,
    clock: 0,
  }
  for (const name of [
    'بنك الراجحي',
    'بنك الرياض',
    'عبداللطيف جميل',
    'الجبر التجارية',
    'بنك البلاد',
  ]) {
    const saved = saveFinancier(store, null, name)
    if (saved.ok) store = saved.store
  }
  for (const seed of SEEDS) {
    const financier = store.financiers.find(
      (item) => item.name === seed.financier,
    )
    if (!financier) continue
    const terms: InstallmentTerms = {
      totalAmount: seed.totalAmount,
      downPayment: seed.downPayment ?? 0,
      balloonAmount: seed.balloonAmount ?? 0,
      installmentCount: seed.installmentCount,
      frequencyMonths: seed.frequencyMonths,
      firstDueDate: addMonths(
        shiftDays(today, seed.nextInDays),
        -seed.paidRows * seed.frequencyMonths,
      ),
    }
    const createdOn =
      terms.firstDueDate < today
        ? shiftDays(terms.firstDueDate, -12)
        : shiftDays(today, -9)
    const saved = saveContract(
      store,
      null,
      {
        description: seed.description,
        financierId: financier.id,
        terms,
        notes: seed.notes ?? '',
        equipment: seed.equipment ?? [],
      },
      createdOn,
    )
    if (!saved.ok) continue
    store = saved.store
    const contractId = saved.id
    if (seed.cancelled) {
      const cancelled = cancelContract(
        store,
        contractId,
        seed.cancelled,
        shiftDays(createdOn, 3),
      )
      if (cancelled.ok) store = cancelled.store
      continue
    }
    const rows =
      store.contracts.find((item) => item.id === contractId)?.rows ?? []
    rows.slice(0, seed.paidRows).forEach((row, index) => {
      const paidOn = row.dueDate > today ? today : row.dueDate
      const paid = recordPayment(
        store,
        contractId,
        {
          paidOn,
          amount: row.amount,
          method: index % 3 === 1 ? 'transfer' : 'auto_debit',
          reference: index % 3 === 1 ? `TRF-${88_000 + index * 71}` : '',
          note: '',
        },
        today,
        MOCK_USER,
        paidOn,
      )
      if (paid.ok) store = paid.store
    })
    if (seed.partial) {
      const paid = recordPayment(
        store,
        contractId,
        {
          paidOn: today,
          amount: seed.partial,
          method: 'cheque',
          reference: 'CHQ-10452',
          note: '',
        },
        today,
      )
      if (paid.ok) store = paid.store
    }
  }
  // One payment recorded by mistake and voided, to show how it stays.
  const excavator = store.contracts.find((item) => item.number === 'INS-0003')
  if (excavator) {
    const wrong = recordPayment(
      store,
      excavator.id,
      {
        paidOn: shiftDays(today, -20),
        amount: 3000,
        method: 'transfer',
        reference: '',
        note: '',
      },
      today,
      'سالم',
      shiftDays(today, -20),
    )
    if (wrong.ok) {
      const voided = voidPayment(
        wrong.store,
        wrong.id,
        'المبلغ ادخل بالخطا',
        shiftDays(today, -19),
      )
      if (voided.ok) store = voided.store
    }
  }
  return store
}

export { financedAmount }
