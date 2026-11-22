import type { TranslationKey } from '@/i18n/translations'
import {
  addMonths,
  fromHalalas,
  toHalalas,
  INSTALLMENT_AMOUNT_MAX,
  INSTALLMENT_COUNT_MAX,
  INSTALLMENT_FREQUENCIES,
  type InstallmentFrequency,
  type InstallmentPaymentMethod,
} from '@/lib/installments'
import {
  amountInputText,
  amountOf,
  isSchedulePaid,
  latinDigits,
  parseInstallmentAmount,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
  type InstallmentUnit,
} from '@/lib/installmentsView'
import { formatIban } from '@/lib/partyFields'

/**
 * The plan of an installment contract (migration 0209, owner 2026-11-22):
 * ONE typed total — everything to pay, the VAT inside it —, the VAT in
 * three options (none, inside the payments and installments, a payment by
 * itself), the first payments (an amount or a percentage) and the division
 * of what is left, which waits while the first due date is not known.
 *
 * Pure. The arithmetic MIRRORS `save_installment_contract` and
 * `generate_installment_schedule` in halalas, so «حسبة العقد» shows what the
 * database will store; the database decides.
 */

// --- The vocabulary ---------------------------------------------------------------------

export type InstallmentVatMode = 'unspecified' | 'none' | 'inside' | 'separate'
/** When a VAT paid by itself falls due. */
export type InstallmentVatDue = 'undecided' | 'date' | 'last'

/** The three a user chooses from; «غير محدد» is only what earlier contracts
 *  are. */
export const INSTALLMENT_VAT_CHOICES: readonly InstallmentVatMode[] = [
  'none',
  'inside',
  'separate',
]

export const INSTALLMENT_VAT_LABEL_KEYS: Readonly<
  Record<InstallmentVatMode, TranslationKey>
> = {
  unspecified: 'instVatUnspecified',
  none: 'instVatNone',
  inside: 'instVatInside',
  separate: 'instVatSeparate',
}

export const INSTALLMENT_VAT_HINT_KEYS: Readonly<
  Record<InstallmentVatMode, TranslationKey>
> = {
  unspecified: 'instVatUnspecifiedHint',
  none: 'instVatNoneHint',
  inside: 'instVatInsideHint',
  separate: 'instVatSeparateHint',
}

export const INSTALLMENT_VAT_DUES: readonly InstallmentVatDue[] = [
  'undecided',
  'date',
  'last',
]

export const INSTALLMENT_VAT_DUE_LABEL_KEYS: Readonly<
  Record<InstallmentVatDue, TranslationKey>
> = {
  undecided: 'instVatDueUndecided',
  date: 'instVatDueDate',
  last: 'instWithLast',
}

export const INSTALLMENT_FIRST_PAYMENT_TITLE_MAX = 80
export const INSTALLMENT_FIRST_PAYMENT_NOTE_MAX = 200
export const INSTALLMENT_FIRST_PAYMENTS_MAX = 100

// --- Arithmetic (halalas) ---------------------------------------------------------------

/** The VAT inside an amount that carries it: `round(amount * 15 / 115, 2)`. */
export function vatInsideHalalas(halalas: number): number {
  return Math.round((halalas * 3) / 23)
}

/** `round(base * rate / 100, 2)`, exact for a rate of four decimals. */
export function rateHalalas(baseHalalas: number, rate: number): number {
  const scaled = BigInt(baseHalalas) * BigInt(Math.round(rate * 10_000))
  return Number((scaled + BigInt(500_000)) / BigInt(1_000_000))
}

/** A typed percentage: above 0, under 100, four decimals at most; else null. */
export function parseInstallmentRate(value: string): number | null {
  const text = latinDigits(value).replace(/%|٪/g, '').replace('٫', '.').trim()
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(text)) return null
  const rate = Number(text)
  return rate > 0 && rate < 100 ? rate : null
}

// --- The plan ---------------------------------------------------------------------------

export interface InstallmentPlanPayment {
  /** One of the two: a percentage, or an amount, final as typed. */
  rate: number | null
  amount: number | null
  /** The payable amount it must keep: there is money on it. */
  lockedAmount?: number | null
}

export interface InstallmentPlanInput {
  /** Everything to pay, the VAT included. */
  totalAmount: number
  /** «مدفوع قبل التسجيل», as paid. */
  prepaid: number
  vatMode: InstallmentVatMode
  /** `separate` only; null = total x 15/115. */
  vatAmount: number | null
  /** `separate` only. */
  vatDue: InstallmentVatDue
  vatDueDate: string | null
  payments: readonly InstallmentPlanPayment[]
  balloonAmount: number
  installmentCount: number
  frequencyMonths: number
  /** null = waiting: the amounts are known, the days are not. */
  firstDueDate: string | null
}

export type InstallmentPlanError =
  | 'invalid_amount'
  | 'invalid_down_payment'
  | 'invalid_vat_amount'
  | 'invalid_first_payment'
  | 'first_payment_locked'
  | 'invalid_first_payments'
  | 'invalid_installment_count'
  | 'invalid_frequency'
  | 'invalid_balloon'

export interface InstallmentPlanRow {
  seq: number
  dueDate: string | null
  amount: number
  isBalloon: boolean
}

export interface InstallmentPlan {
  total: number
  /** The VAT inside the total. */
  vat: number
  beforeVat: number
  prepaid: number
  /** `vat` = the part of the amount that is VAT. */
  payments: { base: number; vat: number; amount: number }[]
  installments: { base: number; vat: number; amount: number }
  /** Every installment, dated or not. */
  rows: InstallmentPlanRow[]
  /** The regular installment, and the last regular one (the halalas). */
  regular: number
  lastRegular: number
  balloon: number
  /** The VAT row's day, when there is such a row and it has one. */
  vatDueDate: string | null
}

export type InstallmentPlanResult =
  | { plan: InstallmentPlan; error: null }
  | { plan: null; error: InstallmentPlanError }

export function buildInstallmentPlan(
  input: InstallmentPlanInput,
): InstallmentPlanResult {
  const fail = (error: InstallmentPlanError) => ({ plan: null, error })
  const max = toHalalas(INSTALLMENT_AMOUNT_MAX)
  const total = toHalalas(input.totalAmount)
  if (!Number.isFinite(total) || total <= 0 || total > max)
    return fail('invalid_amount')
  const prepaid = toHalalas(input.prepaid)
  if (!Number.isFinite(prepaid) || prepaid < 0 || prepaid > max)
    return fail('invalid_down_payment')

  const separate = input.vatMode === 'separate'
  const inside = input.vatMode === 'inside'
  let vat = inside ? vatInsideHalalas(total) : 0
  if (separate) {
    vat =
      input.vatAmount === null
        ? vatInsideHalalas(total)
        : toHalalas(input.vatAmount)
    if (!(vat > 0 && vat < total)) return fail('invalid_vat_amount')
  }
  // What a percentage is of, and what is shared out: without a separate VAT.
  const shared = separate ? total - vat : total

  const payments: InstallmentPlan['payments'] = []
  let paymentsTotal = 0
  for (const payment of input.payments) {
    const amount =
      payment.rate !== null
        ? rateHalalas(shared, payment.rate)
        : toHalalas(payment.amount ?? 0)
    if (!(amount > 0)) return fail('invalid_first_payment')
    if (
      payment.lockedAmount !== null &&
      payment.lockedAmount !== undefined &&
      amount !== toHalalas(payment.lockedAmount)
    )
      return fail('first_payment_locked')
    paymentsTotal += amount
    const part = inside ? vatInsideHalalas(amount) : 0
    payments.push({
      base: fromHalalas(amount - part),
      vat: fromHalalas(part),
      amount: fromHalalas(amount),
    })
  }

  const divided = shared - prepaid - paymentsTotal
  if (divided <= 0)
    return fail(
      paymentsTotal > 0 ? 'invalid_first_payments' : 'invalid_down_payment',
    )

  const count = input.installmentCount
  if (!Number.isInteger(count) || count < 1 || count > INSTALLMENT_COUNT_MAX)
    return fail('invalid_installment_count')
  if (
    !INSTALLMENT_FREQUENCIES.includes(
      input.frequencyMonths as InstallmentFrequency,
    )
  )
    return fail('invalid_frequency')
  const final = toHalalas(input.balloonAmount)
  if (
    !Number.isFinite(final) ||
    final < 0 ||
    (final > 0 && (count < 2 || final >= divided))
  )
    return fail('invalid_balloon')
  const regularCount = count - (final > 0 ? 1 : 0)
  const each = Math.floor((divided - final) / regularCount)
  if (each <= 0) return fail('invalid_amount')
  const lastRegular = divided - final - each * (regularCount - 1)

  const dayOf = (seq: number) =>
    input.firstDueDate
      ? addMonths(input.firstDueDate, (seq - 1) * input.frequencyMonths)
      : null
  const rows = Array.from({ length: count }, (_, index) => {
    const seq = index + 1
    const isBalloon = seq > regularCount
    return {
      seq,
      dueDate: dayOf(seq),
      amount: fromHalalas(
        isBalloon ? final : seq === regularCount ? lastRegular : each,
      ),
      isBalloon,
    }
  })
  const dividedVat = inside ? vatInsideHalalas(divided) : 0

  return {
    error: null,
    plan: {
      total: fromHalalas(total),
      vat: fromHalalas(vat),
      beforeVat: fromHalalas(total - vat),
      prepaid: fromHalalas(prepaid),
      payments,
      installments: {
        base: fromHalalas(divided - dividedVat),
        vat: fromHalalas(dividedVat),
        amount: fromHalalas(divided),
      },
      rows,
      regular: fromHalalas(regularCount === 1 ? lastRegular : each),
      lastRegular: fromHalalas(lastRegular),
      balloon: fromHalalas(final),
      vatDueDate: !separate
        ? null
        : input.vatDue === 'date'
          ? input.vatDueDate
          : input.vatDue === 'last'
            ? dayOf(count)
            : null,
    },
  }
}

// --- A contract's division, from its stored row -----------------------------------------

/**
 * The installments of a stored contract for a date, a count and a frequency
 * («تحديد تاريخ اول قسط»): the amount to divide is the stored one, whatever
 * its first payments are.
 */
export function planDivision(
  contract: Pick<
    InstallmentContractRow,
    | 'installments_amount'
    | 'balloon_amount'
    | 'vat_mode'
    | 'vat_due'
    | 'vat_due_date'
  >,
  firstDueDate: string | null,
  installmentCount: number,
  frequencyMonths: number,
): InstallmentPlanResult {
  const result = buildInstallmentPlan({
    totalAmount: amountOf(contract.installments_amount),
    prepaid: 0,
    // The stored amount is what is divided: nothing to take out of it.
    vatMode: 'none',
    vatAmount: null,
    vatDue: 'undecided',
    vatDueDate: null,
    payments: [],
    balloonAmount: amountOf(contract.balloon_amount),
    installmentCount,
    frequencyMonths,
    firstDueDate,
  })
  if (!result.plan) return result
  const last = result.plan.rows[result.plan.rows.length - 1]
  return {
    error: null,
    plan: {
      ...result.plan,
      vatDueDate:
        contract.vat_mode !== 'separate'
          ? null
          : contract.vat_due === 'date'
            ? contract.vat_due_date
            : contract.vat_due === 'last'
              ? last.dueDate
              : null,
    },
  }
}

// --- The form ---------------------------------------------------------------------------

export type FirstPaymentValueKind = 'amount' | 'rate'

/** One row of «الدفعات الاولى», as its controls hold it. */
export interface FirstPaymentFormRow {
  /** The React key; a stored row's is its id. */
  key: string
  id: string | null
  title: string
  kind: FirstPaymentValueKind
  value: string
  /** The agreed due day. */
  date: string
  /** The day it was paid, while `paid` is on: the agreed day stays. */
  paidOn: string
  note: string
  /** «مدفوعة»: saving records an ordinary payment. */
  paid: boolean
  method: InstallmentPaymentMethod
  /** The stored payable amount, when money is on the row. */
  lockedAmount: number | null
  /** Fully paid: its day is fixed too. */
  settled: boolean
}

export interface InstallmentContractFormValues {
  description: string
  financier_id: string
  total_amount: string
  /** «مدفوع قبل التسجيل». */
  down_payment: string
  /** '' = not chosen yet. */
  vat_mode: InstallmentVatMode | ''
  /** The row of a separate VAT: '' = its usual name. */
  vat_title: string
  vat_note: string
  /** '' = total x 15/115, following the total. */
  vat_amount: string
  vat_due: InstallmentVatDue
  vat_due_date: string
  /** «مدفوعة» on it: the planned day is hidden, not lost. */
  vat_paid: boolean
  vat_paid_on: string
  vat_method: InstallmentPaymentMethod
  payments: FirstPaymentFormRow[]
  balloon_amount: string
  installment_count: string
  frequency_months: string
  /** '' = not known yet. */
  first_due_date: string
  notes: string
  /** The linked units' ids; empty = no link. */
  equipment: string[]
  /** 0208: the contract's own account; both empty = the financier's. */
  bank_name: string
  iban: string
}

export const INSTALLMENT_CONTRACT_FIELD_ORDER: readonly (keyof InstallmentContractFormValues)[] =
  [
    'description',
    'financier_id',
    'total_amount',
    'down_payment',
    'vat_mode',
    'vat_amount',
    'vat_due_date',
    'vat_paid_on',
    'payments',
    'installment_count',
    'frequency_months',
    'first_due_date',
    'balloon_amount',
    'bank_name',
    'iban',
    'equipment',
    'notes',
  ]

/** The form field a token of `save_installment_contract` belongs to. */
export const INSTALLMENT_CONTRACT_TOKEN_FIELDS: Readonly<
  Record<string, keyof InstallmentContractFormValues>
> = {
  invalid_description: 'description',
  invalid_financier: 'financier_id',
  invalid_amount: 'total_amount',
  invalid_down_payment: 'down_payment',
  invalid_vat: 'vat_mode',
  invalid_vat_amount: 'vat_amount',
  invalid_vat_date: 'vat_due_date',
  invalid_first_payment: 'payments',
  invalid_first_payments: 'payments',
  invalid_first_payment_date: 'payments',
  first_payment_locked: 'payments',
  invalid_paid_on: 'payments',
  invalid_method: 'payments',
  invalid_balloon: 'balloon_amount',
  invalid_installment_count: 'installment_count',
  invalid_frequency: 'frequency_months',
  invalid_first_due_date: 'first_due_date',
  invalid_notes: 'notes',
  invalid_equipment: 'equipment',
  invalid_bank: 'bank_name',
  invalid_iban: 'iban',
  invalid_account: 'iban',
}

const ORDINAL_KEYS: readonly TranslationKey[] = [
  'instFpName1',
  'instFpName2',
  'instFpName3',
  'instFpName4',
  'instFpName5',
]

/** «الدفعة الاولى», «الدفعة الثانية», … then «الدفعة 6». */
export function firstPaymentDefaultTitle(
  index: number,
  t: (key: TranslationKey) => string,
): string {
  const key = ORDINAL_KEYS[index]
  return key
    ? t(key)
    : t('instFpNameN').replace('{number}', String(index + 1))
}

export function newFirstPaymentRow(
  key: string,
  title: string,
): FirstPaymentFormRow {
  return {
    key,
    id: null,
    title,
    kind: 'amount',
    value: '',
    date: '',
    paidOn: '',
    note: '',
    paid: false,
    method: 'transfer',
    lockedAmount: null,
    settled: false,
  }
}

/** A new contract's form: the VAT is not chosen, no date, no payment. */
export function emptyContractForm(): InstallmentContractFormValues {
  return {
    description: '',
    financier_id: '',
    total_amount: '',
    down_payment: '0',
    vat_mode: '',
    vat_title: '',
    vat_note: '',
    vat_amount: '',
    // Not assumed to be at the end.
    vat_due: 'undecided',
    vat_due_date: '',
    vat_paid: false,
    vat_paid_on: '',
    vat_method: 'transfer',
    payments: [],
    balloon_amount: '0',
    installment_count: '12',
    frequency_months: '1',
    first_due_date: '',
    notes: '',
    equipment: [],
    bank_name: '',
    iban: '',
  }
}

/** A stored contract as the form holds it. */
export function contractFormValues(
  contract: InstallmentContractRow,
  schedule: readonly InstallmentScheduleItem[],
  units: readonly Pick<InstallmentUnit, 'equipment_id'>[],
): InstallmentContractFormValues {
  const total = toHalalas(amountOf(contract.total_amount))
  const vat = toHalalas(amountOf(contract.vat_amount))
  const vatRow = schedule.find((row) => row.kind === 'vat')
  return {
    description: contract.description,
    financier_id: contract.financier_id,
    total_amount: amountInputText(contract.total_amount),
    down_payment: amountInputText(contract.down_payment),
    vat_mode: contract.vat_mode,
    vat_title: vatRow?.title ?? '',
    vat_note: vatRow?.note ?? '',
    vat_amount:
      contract.vat_mode === 'separate' &&
      (vat !== vatInsideHalalas(total) ||
        // With money on its row it stays, whatever the total becomes.
        amountOf(vatRow?.paid_amount) > 0)
        ? amountInputText(contract.vat_amount)
        : '',
    vat_due: contract.vat_due ?? 'undecided',
    vat_due_date: contract.vat_due_date ?? '',
    vat_paid: false,
    vat_paid_on: '',
    vat_method: 'transfer',
    payments: schedule
      .filter((row) => row.kind === 'first_payment')
      .sort((a, b) => a.seq - b.seq)
      .map((row) => {
        const rated = row.rate !== null && row.rate !== undefined
        return {
          key: row.id,
          id: row.id,
          title: row.title ?? '',
          kind: rated ? 'rate' : 'amount',
          value: amountInputText(rated ? row.rate : row.amount),
          date: row.due_date ?? '',
          paidOn: '',
          note: row.note ?? '',
          paid: false,
          method: 'transfer',
          lockedAmount:
            amountOf(row.paid_amount) > 0 ? amountOf(row.amount) : null,
          settled: isSchedulePaid(row),
        }
      }),
    balloon_amount: amountInputText(contract.balloon_amount),
    installment_count: String(contract.installment_count),
    frequency_months: String(contract.frequency_months),
    first_due_date: contract.first_due_date ?? '',
    notes: contract.notes ?? '',
    equipment: units.map((unit) => unit.equipment_id),
    bank_name: contract.contract_bank_name ?? '',
    iban: contract.contract_iban ? formatIban(contract.contract_iban) : '',
  }
}

/** The value of a row as the plan takes it, or null while it is not one. */
export function firstPaymentValue(
  row: Pick<FirstPaymentFormRow, 'kind' | 'value'>,
): { rate: number | null; amount: number | null } | null {
  if (row.kind === 'rate') {
    const rate = parseInstallmentRate(row.value)
    return rate === null ? null : { rate, amount: null }
  }
  const amount = parseInstallmentAmount(row.value)
  return amount ? { rate: null, amount } : null
}

/**
 * What a percentage is of: the total, less a VAT that is paid by itself (it
 * would be counted twice otherwise). Null while the total is no number.
 */
export function rateBaseOf(
  values: Pick<
    InstallmentContractFormValues,
    'total_amount' | 'vat_mode' | 'vat_amount'
  >,
): number | null {
  const total = parseInstallmentAmount(values.total_amount)
  if (!total) return null
  if (values.vat_mode !== 'separate') return total
  const typed = values.vat_amount.trim()
    ? parseInstallmentAmount(values.vat_amount)
    : null
  const halalas = toHalalas(total)
  const base =
    halalas - (typed === null ? vatInsideHalalas(halalas) : toHalalas(typed))
  return base > 0 ? fromHalalas(base) : null
}

/**
 * A row as the plan and the save take it. A percentage with money on it
 * stays the amount it was paid as when what it is of changes: it goes as
 * that amount, so the total stays editable.
 */
export function firstPaymentPlanValue(
  row: Pick<FirstPaymentFormRow, 'kind' | 'value' | 'lockedAmount'>,
  rateBase: number | null,
): { rate: number | null; amount: number | null } | null {
  const value = firstPaymentValue(row)
  if (!value || value.rate === null) return value
  if (row.lockedAmount === null || rateBase === null) return value
  return rateHalalas(toHalalas(rateBase), value.rate) ===
    toHalalas(row.lockedAmount)
    ? value
    : { rate: null, amount: row.lockedAmount }
}

/** The fields an edit may change whatever is paid. */
const FREE_FIELDS = [
  'description',
  'financier_id',
  'notes',
  'equipment',
  'bank_name',
  'iban',
] as const

/**
 * The form after `contract_changed`: the amounts, payments and dates are
 * what is stored now; of the free fields, the ones the user changed stay.
 */
export function mergeStoredForm(
  current: InstallmentContractFormValues,
  initial: InstallmentContractFormValues,
  stored: InstallmentContractFormValues,
): InstallmentContractFormValues {
  const merged = { ...stored }
  const keep = <K extends (typeof FREE_FIELDS)[number]>(key: K) => {
    if (JSON.stringify(current[key]) !== JSON.stringify(initial[key]))
      merged[key] = current[key]
  }
  FREE_FIELDS.forEach(keep)
  return merged
}

/**
 * The form as a plan, or null while an amount is not a number yet. A row
 * without a value yet is left out, so the breakdown follows the typing;
 * `rowIndexes` says which row each planned payment is.
 */
export function planInputOf(
  values: InstallmentContractFormValues,
): { input: InstallmentPlanInput; rowIndexes: number[] } | null {
  const optional = (value: string) =>
    value.trim() ? parseInstallmentAmount(value) : 0
  const total = parseInstallmentAmount(values.total_amount)
  const prepaid = optional(values.down_payment)
  const balloon = optional(values.balloon_amount)
  const count = latinDigits(values.installment_count).trim()
  if (total === null || prepaid === null || balloon === null) return null
  if (!/^\d+$/.test(count)) return null
  const separate = values.vat_mode === 'separate'
  let vatAmount: number | null = null
  if (separate && values.vat_amount.trim()) {
    vatAmount = parseInstallmentAmount(values.vat_amount)
    if (vatAmount === null) return null
  }
  const rateBase = rateBaseOf(values)
  const payments: InstallmentPlanPayment[] = []
  const rowIndexes: number[] = []
  values.payments.forEach((row, index) => {
    const value = firstPaymentPlanValue(row, rateBase)
    if (!value) return
    payments.push({ ...value, lockedAmount: row.lockedAmount })
    rowIndexes.push(index)
  })
  return {
    rowIndexes,
    input: {
      totalAmount: total,
      prepaid,
      vatMode: values.vat_mode || 'none',
      vatAmount,
      vatDue: values.vat_due,
      vatDueDate: separate ? values.vat_due_date || null : null,
      payments,
      balloonAmount: balloon,
      installmentCount: Number(count),
      frequencyMonths: Number(values.frequency_months),
      firstDueDate: values.first_due_date || null,
    },
  }
}

// --- What the save sends ----------------------------------------------------------------

export interface InstallmentVatPayload {
  mode: InstallmentVatMode
  amount?: number | null
  due?: InstallmentVatDue
  due_date?: string | null
  title?: string | null
  note?: string | null
  paid_on?: string
  method?: InstallmentPaymentMethod
}

export function vatPayload(
  values: Pick<
    InstallmentContractFormValues,
    | 'vat_mode'
    | 'vat_title'
    | 'vat_note'
    | 'vat_amount'
    | 'vat_due'
    | 'vat_due_date'
    | 'vat_paid'
    | 'vat_paid_on'
    | 'vat_method'
  >,
): InstallmentVatPayload {
  const mode = values.vat_mode as InstallmentVatMode
  if (mode !== 'separate') return { mode }
  // A day is needed only while one is asked for.
  const dated = values.vat_due === 'date' && !!values.vat_due_date
  return {
    mode,
    amount: values.vat_amount.trim()
      ? parseInstallmentAmount(values.vat_amount)
      : null,
    due: values.vat_due === 'date' && !dated ? 'undecided' : values.vat_due,
    due_date: dated ? values.vat_due_date : null,
    title: values.vat_title.trim() || null,
    note: values.vat_note.trim() || null,
    ...(values.vat_paid
      ? { paid_on: values.vat_paid_on, method: values.vat_method }
      : {}),
  }
}

export interface InstallmentFirstPaymentPayload {
  id: string | null
  title: string
  rate: number | null
  amount: number | null
  due_date: string | null
  note: string | null
  paid_on?: string
  method?: InstallmentPaymentMethod
}

export function firstPaymentsPayload(
  rows: readonly FirstPaymentFormRow[],
  rateBase: number | null,
): InstallmentFirstPaymentPayload[] {
  return rows.map((row) => {
    const value = firstPaymentPlanValue(row, rateBase)
    return {
      id: row.id,
      title: row.title.trim(),
      rate: value?.rate ?? null,
      amount: value?.amount ?? null,
      due_date: row.date || null,
      note: row.note.trim() || null,
      // Only a row without money can be marked paid here.
      ...(row.paid && row.lockedAmount === null
        ? { paid_on: row.paidOn, method: row.method }
        : {}),
    }
  })
}

// --- The payment's allocation ---------------------------------------------------------

/**
 * Mirrors the loop of `record_installment_payment` (0209): the chosen row,
 * then the oldest due, then the undated first payments. Null when the amount
 * is not positive or passes the rows.
 */
export function allocateToRows(
  rows: readonly InstallmentScheduleItem[],
  amount: number,
  targetId: string | null = null,
): { row: InstallmentScheduleItem; amount: number }[] | null {
  let left = toHalalas(amount)
  if (!Number.isFinite(left) || left <= 0) return null
  const openOf = (row: InstallmentScheduleItem) =>
    toHalalas(amountOf(row.amount)) - toHalalas(amountOf(row.paid_amount))
  const open = rows
    .filter((row) => openOf(row) > 0)
    .sort((a, b) => {
      const target = Number(b.id === targetId) - Number(a.id === targetId)
      if (target) return target
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date < b.due_date ? -1 : 1
      }
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
      return a.seq - b.seq
    })
  if (left > open.reduce((sum, row) => sum + openOf(row), 0)) return null
  const result: { row: InstallmentScheduleItem; amount: number }[] = []
  for (const row of open) {
    if (left <= 0) break
    const take = Math.min(left, openOf(row))
    result.push({ row, amount: fromHalalas(take) })
    left -= take
  }
  return result
}
