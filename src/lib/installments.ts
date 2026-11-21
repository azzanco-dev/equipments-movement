import type { TranslationKey } from '@/i18n/translations'

/**
 * installments — the pure part of «الاقساط» (migration 0203: financiers,
 * contracts, the generated schedule and payments). The terms check, the
 * schedule, the row state and the allocation MIRROR the SQL definitions
 * (`assert_installment_terms`, `generate_installment_schedule`,
 * `installment_state`, `record_installment_payment`) so the contract form
 * can preview what the database will create; the database stays the source
 * of truth. Nothing here calls the database, and the only import is a type,
 * so the node tests load this file directly.
 *
 * Money is handled in halalas (integers) so the preview matches the SQL
 * numeric(14, 2) arithmetic exactly.
 */

// --- Money -----------------------------------------------------------------------

export function toHalalas(amount: number): number {
  return Math.round(amount * 100)
}

export function fromHalalas(halalas: number): number {
  return halalas / 100
}

/** An amount as the screens show it: two decimals, thousands separators,
 *  Latin digits; a dash when there is no amount. */
export function formatInstallmentAmount(
  value: number | string | null | undefined,
): string {
  const amount = typeof value === 'string' ? Number(value) : value
  if (amount === null || amount === undefined || Number.isNaN(amount))
    return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// --- Contract terms ----------------------------------------------------------------

export type InstallmentFrequency = 1 | 2 | 3 | 6 | 12

export const INSTALLMENT_FREQUENCIES: readonly InstallmentFrequency[] = [
  1, 2, 3, 6, 12,
]

export const INSTALLMENT_FREQUENCY_LABEL_KEYS: Readonly<
  Record<InstallmentFrequency, TranslationKey>
> = {
  1: 'instFrequencyMonthly',
  2: 'instFrequencyBimonthly',
  3: 'instFrequencyQuarterly',
  6: 'instFrequencySemiannual',
  12: 'instFrequencyAnnual',
}

/** The limits of the 0203 CHECKs. */
export const INSTALLMENT_COUNT_MAX = 360
export const INSTALLMENT_AMOUNT_MAX = 999_999_999_999.99
export const INSTALLMENT_DESCRIPTION_MAX = 200
export const INSTALLMENT_NOTES_MAX = 1000
export const INSTALLMENT_REASON_MAX = 500
export const INSTALLMENT_PAYMENT_REFERENCE_MAX = 80
export const INSTALLMENT_PAYMENT_NOTE_MAX = 500
export const INSTALLMENT_FINANCIER_NAME_MAX = 120

/** The contract number as the database issues it (`INS-0001`). */
export const INSTALLMENT_CONTRACT_NUMBER_PATTERN = /^INS-[0-9]{4,}$/

export interface InstallmentTerms {
  totalAmount: number
  /** Paid at the contract, outside the schedule. 0 = none. */
  downPayment: number
  /** The final larger payment, 0 = none. It is the LAST of `installmentCount`. */
  balloonAmount: number
  installmentCount: number
  frequencyMonths: number
  /** yyyy-mm-dd */
  firstDueDate: string
}

/** `installment_contracts.financed_amount`: what the schedule adds up to. */
export function financedAmount(
  terms: Pick<InstallmentTerms, 'totalAmount' | 'downPayment'>,
): number {
  return fromHalalas(
    toHalalas(terms.totalAmount) - toHalalas(terms.downPayment),
  )
}

/** The token `assert_installment_terms` would raise, or null. Same order as
 *  the SQL so the form shows the error the database would. */
export type InstallmentTermsError =
  | 'invalid_amount'
  | 'invalid_down_payment'
  | 'invalid_installment_count'
  | 'invalid_frequency'
  | 'invalid_first_due_date'
  | 'invalid_balloon'

function isDateKey(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
}

export function checkInstallmentTerms(
  terms: InstallmentTerms,
): InstallmentTermsError | null {
  const total = toHalalas(terms.totalAmount)
  const down = toHalalas(terms.downPayment)
  const balloon = toHalalas(terms.balloonAmount)
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    total > toHalalas(INSTALLMENT_AMOUNT_MAX)
  )
    return 'invalid_amount'
  if (!Number.isFinite(down) || down < 0 || down >= total)
    return 'invalid_down_payment'
  if (
    !Number.isInteger(terms.installmentCount) ||
    terms.installmentCount < 1 ||
    terms.installmentCount > INSTALLMENT_COUNT_MAX
  )
    return 'invalid_installment_count'
  if (
    !INSTALLMENT_FREQUENCIES.includes(
      terms.frequencyMonths as InstallmentFrequency,
    )
  )
    return 'invalid_frequency'
  if (!isDateKey(terms.firstDueDate)) return 'invalid_first_due_date'
  const financed = total - down
  if (
    !Number.isFinite(balloon) ||
    balloon < 0 ||
    (balloon > 0 && (terms.installmentCount < 2 || balloon >= financed))
  )
    return 'invalid_balloon'
  const regularCount = terms.installmentCount - (balloon > 0 ? 1 : 0)
  // Each regular payment is at least one halala.
  if (Math.floor((financed - balloon) / regularCount) <= 0)
    return 'invalid_amount'
  return null
}

// --- The schedule ------------------------------------------------------------------

export interface InstallmentScheduleRow {
  seq: number
  /** yyyy-mm-dd */
  dueDate: string
  amount: number
  isBalloon: boolean
}

/**
 * `date + make_interval(months => n)` in PostgreSQL: the same day n months
 * later, clamped to the month's last day (2026-01-31 + 1 = 2026-02-28).
 * Always added to the FIRST due date, never chained.
 */
export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = index - targetYear * 12
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate()
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(targetYear, 4)}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`
}

/**
 * Mirrors `generate_installment_schedule`: equal regular payments truncated
 * to the halala, the remainder on the last regular one, the balloon (if any)
 * as the last row. Returns [] for terms the database would refuse.
 */
export function buildSchedule(
  terms: InstallmentTerms,
): InstallmentScheduleRow[] {
  if (checkInstallmentTerms(terms)) return []
  const balloon = toHalalas(terms.balloonAmount)
  const regularCount = terms.installmentCount - (balloon > 0 ? 1 : 0)
  const regularTotal = toHalalas(financedAmount(terms)) - balloon
  const each = Math.floor(regularTotal / regularCount)
  const rows: InstallmentScheduleRow[] = []
  for (let seq = 1; seq <= regularCount; seq += 1) {
    const amount =
      seq === regularCount ? regularTotal - each * (regularCount - 1) : each
    rows.push({
      seq,
      dueDate: addMonths(terms.firstDueDate, (seq - 1) * terms.frequencyMonths),
      amount: fromHalalas(amount),
      isBalloon: false,
    })
  }
  if (balloon > 0) {
    rows.push({
      seq: terms.installmentCount,
      dueDate: addMonths(
        terms.firstDueDate,
        (terms.installmentCount - 1) * terms.frequencyMonths,
      ),
      amount: fromHalalas(balloon),
      isBalloon: true,
    })
  }
  return rows
}

// --- Row state ---------------------------------------------------------------------

export type InstallmentState =
  'paid' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming'

/** Days ahead that count as «قريب». Mirrors the 30 of `installment_state`. */
export const DUE_SOON_DAYS = 30

function dayNumber(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000)
}

/** `due_date - saudi_today()` of `installment_dues`: negative = days overdue. */
export function daysUntilDue(dueDate: string, today: string): number {
  return dayNumber(dueDate) - dayNumber(today)
}

/** Mirrors `installment_state(due_date, amount, paid_amount, today)`;
 *  `today` is a Saudi day key. */
export function installmentState(
  dueDate: string,
  amount: number,
  paidAmount: number,
  today: string,
): InstallmentState {
  if (toHalalas(paidAmount) >= toHalalas(amount)) return 'paid'
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'due_today'
  if (daysUntilDue(dueDate, today) <= DUE_SOON_DAYS) return 'due_soon'
  return 'upcoming'
}

type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

/** Red only for overdue (what the company must act on), amber for what is
 *  due today or soon. */
export const INSTALLMENT_STATE_BADGE: Readonly<
  Record<InstallmentState, { key: TranslationKey; tone: BadgeTone }>
> = {
  paid: { key: 'instStatePaid', tone: 'success' },
  overdue: { key: 'instStateOverdue', tone: 'danger' },
  due_today: { key: 'instStateDueToday', tone: 'warning' },
  due_soon: { key: 'instStateDueSoon', tone: 'warning' },
  upcoming: { key: 'instStateUpcoming', tone: 'neutral' },
}

// --- Payments ----------------------------------------------------------------------

export interface InstallmentOpenRow {
  id: string
  seq: number
  dueDate: string
  amount: number
  paidAmount: number
}

export interface InstallmentAllocation {
  id: string
  amount: number
}

/**
 * Mirrors the allocation loop of `record_installment_payment`: the oldest
 * unpaid row first (due date, then seq). Returns null when the payment
 * exceeds what remains (`payment_exceeds_balance`) or is not positive.
 */
export function allocatePayment(
  rows: readonly InstallmentOpenRow[],
  amount: number,
): InstallmentAllocation[] | null {
  let left = toHalalas(amount)
  if (!Number.isFinite(left) || left <= 0) return null
  const open = rows
    .filter((row) => toHalalas(row.paidAmount) < toHalalas(row.amount))
    .sort((a, b) =>
      a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1,
    )
  const remaining = open.reduce(
    (sum, row) => sum + toHalalas(row.amount) - toHalalas(row.paidAmount),
    0,
  )
  if (left > remaining) return null
  const allocations: InstallmentAllocation[] = []
  for (const row of open) {
    if (left <= 0) break
    const take = Math.min(
      left,
      toHalalas(row.amount) - toHalalas(row.paidAmount),
    )
    allocations.push({ id: row.id, amount: fromHalalas(take) })
    left -= take
  }
  return allocations
}

// --- Labels ------------------------------------------------------------------------

export type InstallmentContractStatus = 'active' | 'paid_off' | 'cancelled'

export const INSTALLMENT_CONTRACT_STATUS_BADGE: Readonly<
  Record<InstallmentContractStatus, { key: TranslationKey; tone: BadgeTone }>
> = {
  active: { key: 'instContractActive', tone: 'info' },
  paid_off: { key: 'instContractPaidOff', tone: 'success' },
  cancelled: { key: 'instContractCancelled', tone: 'neutral' },
}

export type InstallmentPaymentMethod =
  'transfer' | 'cheque' | 'auto_debit' | 'cash'

export const INSTALLMENT_PAYMENT_METHODS: readonly InstallmentPaymentMethod[] =
  ['transfer', 'cheque', 'auto_debit', 'cash']

export const INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS: Readonly<
  Record<InstallmentPaymentMethod, TranslationKey>
> = {
  transfer: 'instMethodTransfer',
  cheque: 'instMethodCheque',
  auto_debit: 'instMethodAutoDebit',
  cash: 'instMethodCash',
}

// --- Database error tokens -----------------------------------------------------------

/** Every stable token the 0203 functions raise → its safe message. Raw
 *  database errors are never shown. */
export const INSTALLMENT_ERROR_KEYS: Readonly<Record<string, TranslationKey>> =
  {
    installments_manage_required: 'instErrManageRequired',
    invalid_contract: 'instErrContract',
    invalid_description: 'instErrDescription',
    invalid_financier: 'instErrFinancier',
    invalid_amount: 'instErrAmount',
    invalid_down_payment: 'instErrDownPayment',
    invalid_balloon: 'instErrBalloon',
    invalid_installment_count: 'instErrInstallmentCount',
    invalid_frequency: 'instErrFrequency',
    invalid_first_due_date: 'instErrFirstDueDate',
    invalid_notes: 'instErrNotes',
    invalid_equipment: 'instErrEquipment',
    invalid_payment: 'instErrPayment',
    invalid_payment_amount: 'instErrPaymentAmount',
    invalid_paid_on: 'instErrPaidOn',
    invalid_method: 'instErrMethod',
    invalid_reference: 'instErrReference',
    invalid_note: 'instErrNote',
    reason_required: 'instErrReasonRequired',
    payment_exceeds_balance: 'instErrPaymentExceedsBalance',
    contract_not_active: 'instErrContractNotActive',
    contract_has_payments: 'instErrContractHasPayments',
    payment_already_voided: 'instErrPaymentAlreadyVoided',
    contract_not_cancelled: 'instErrContractNotCancelled',
    invalid_account: 'instErrAccount',
    invalid_bank: 'instErrBank',
    invalid_iban: 'instErrIban',
  }

/** Every stable token of the installments functions, for the tests. */
export const INSTALLMENT_ERROR_TOKENS: readonly string[] = Object.keys(
  INSTALLMENT_ERROR_KEYS,
)

/** The tokens, the longest first, so `invalid_note` never answers for
 *  `invalid_notes` nor `invalid_payment` for `invalid_payment_amount`. */
const TOKENS_LONGEST_FIRST = Object.entries(INSTALLMENT_ERROR_KEYS).sort(
  ([a], [b]) => b.length - a.length,
)

export interface InstallmentDatabaseError {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
}

/**
 * The safe message of a rejected installments write: the token's message,
 * a clear one for the two constraints a direct financier write can hit,
 * else the generic «تعذر الحفظ». The raw database text is never shown.
 */
export function installmentErrorMessage(
  error: InstallmentDatabaseError | null | undefined,
): TranslationKey {
  if (!error) return 'instSaveFailed'
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (text.includes('installment_financiers_name_unique'))
    return 'instErrFinancierDuplicate'
  if (text.includes('installment_contracts_financier_id_fkey'))
    return 'instErrFinancierInUse'
  // 0208: a direct financier write the account constraints refused.
  if (text.includes('installment_financiers_iban_check')) return 'instErrIban'
  if (text.includes('installment_financiers_bank_name_fkey'))
    return 'instErrBank'
  for (const [token, key] of TOKENS_LONGEST_FIRST)
    if (text.includes(token)) return key
  return 'instSaveFailed'
}
