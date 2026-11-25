import type { Language, TranslationKey } from '@/i18n/translations'
import type { FilterField } from '@/components/data-list/types'
import {
  addMonths,
  fromHalalas,
  toHalalas,
  daysUntilDue,
  INSTALLMENT_ERROR_KEYS,
  INSTALLMENT_ERROR_TOKENS,
  type InstallmentContractStatus,
  type InstallmentDatabaseError,
  type InstallmentPaymentMethod,
  type InstallmentState,
} from '@/lib/installments'

/**
 * installments-screens — the pure part the real screens of «الاقساط» share
 * (`/installments`, `/installments/:id`, migration 0203): the shapes of the
 * rows the views return, the count words, the monthly buckets of the chart,
 * the contract's derived history, the financier figures, the state the list
 * page keeps in its URL and the mapping of a refused write to its field.
 * Nothing here calls the database; the only runtime import is the pure
 * `src/lib/installments.ts`, so the node tests load this file directly.
 */

// --- The rows the screens read ------------------------------------------------------

/** 0209: what a payable row is. `seq` counts inside a kind. */
export type InstallmentRowKind = 'first_payment' | 'installment' | 'vat'

/** `installment_overview`: ONE row over the unpaid rows of active contracts. */
export interface InstallmentOverviewRow {
  overdue_count: number
  overdue_amount: number
  due_7_count: number
  due_7_amount: number
  due_30_count: number
  due_30_amount: number
  open_count: number
  remaining_total: number
  open_contract_count: number
  next_due_date: string | null
}

/** The overview of an empty program (the view always returns one row). */
export const EMPTY_INSTALLMENT_OVERVIEW: InstallmentOverviewRow = {
  overdue_count: 0,
  overdue_amount: 0,
  due_7_count: 0,
  due_7_amount: 0,
  due_30_count: 0,
  due_30_amount: 0,
  open_count: 0,
  remaining_total: 0,
  open_contract_count: 0,
  next_due_date: null,
}

/** `installment_dues`: a schedule row with its contract and its state. */
export interface InstallmentDueRow {
  id: string
  contract_id: string
  contract_number: string
  description: string
  financier_id: string
  financier_name: string
  seq: number
  installment_count: number
  /** 0209: a row paid without a date shows on the day it was paid. */
  due_date: string
  kind: InstallmentRowKind
  /** A first payment's name. */
  title: string | null
  /** 0210: an installment's name (a first payment's or the VAT's note). */
  note: string | null
  amount: number
  paid_amount: number
  remaining_amount: number
  is_balloon: boolean
  is_partial: boolean
  state: InstallmentState
  /** Negative = days overdue. */
  days_until_due: number
  /** 0207: the latest date of the posted payments that paid it; null while
   *  none (selected by the dues lists only). */
  last_paid_on?: string | null
}

/** `installment_contract_summary`: a contract with its totals. */
export interface InstallmentContractRow {
  id: string
  contract_number: string
  description: string
  financier_id: string
  financier_name: string
  total_amount: number
  down_payment: number
  balloon_amount: number
  financed_amount: number
  installment_count: number
  frequency_months: number
  /** 0209: null = waiting for its first due date. */
  first_due_date: string | null
  notes: string | null
  status: InstallmentContractStatus
  closed_at: string | null
  cancel_reason: string | null
  created_by_name: string | null
  created_at: string
  /** The contract's last change (0203 trigger; a payment touches it). */
  updated_at: string
  paid_total: number
  remaining_total: number
  paid_count: number
  overdue_count: number
  overdue_amount: number
  next_due_date: string | null
  next_due_amount: number | null
  last_due_date: string | null
  equipment_count: number
  /** 0208: the financier's account and the contract's own account (null =
   *  the financier's is used). */
  financier_bank_name?: string | null
  financier_iban?: string | null
  contract_bank_name?: string | null
  contract_iban?: string | null
  /** 0209. `down_payment` above is «مدفوع قبل التسجيل». */
  vat_mode: 'unspecified' | 'none' | 'inside' | 'separate'
  vat_due: 'undecided' | 'date' | 'last' | null
  /** The VAT INSIDE the total. */
  vat_amount: number
  vat_due_date: string | null
  /** A separate VAT that is fully paid: it is due no more. */
  vat_settled: boolean
  /** What the installments add up to, divided or not. */
  installments_amount: number
  /** The typed total: the VAT is inside it. */
  payable_total: number
  /** Paid, with what was paid before the contract was entered. */
  paid_overall: number
  first_payments_count: number
  first_payments_paid_count: number
  first_payments_total: number
  /** An installment has money on it: the terms are fixed. */
  installments_locked: boolean
  next_due_id: string | null
  next_due_kind: InstallmentRowKind | null
  next_due_title: string | null
  next_due_seq: number | null
  first_due_set_at: string | null
  first_due_set_by_name: string | null
}

/** The account a contract is paid to (0208): the contract's own when it
 *  carries one, else the financier's; null when neither is recorded. */
export interface InstallmentAccount {
  bankName: string | null
  iban: string | null
  /** True = the contract's own account, not the financier's. */
  own: boolean
}

export function installmentAccountOf(
  contract: Pick<
    InstallmentContractRow,
    | 'financier_bank_name'
    | 'financier_iban'
    | 'contract_bank_name'
    | 'contract_iban'
  >,
): InstallmentAccount | null {
  if (contract.contract_bank_name || contract.contract_iban)
    return {
      bankName: contract.contract_bank_name ?? null,
      iban: contract.contract_iban ?? null,
      own: true,
    }
  if (contract.financier_bank_name || contract.financier_iban)
    return {
      bankName: contract.financier_bank_name ?? null,
      iban: contract.financier_iban ?? null,
      own: false,
    }
  return null
}

/** `installment_schedule`: one generated payment of a contract. */
export interface InstallmentScheduleItem {
  id: string
  contract_id: string
  seq: number
  /** Null only for a first payment or a VAT row whose day is not known. */
  due_date: string | null
  amount: number
  is_balloon: boolean
  paid_amount: number
  kind: InstallmentRowKind
  title: string | null
  note: string | null
  rate: number | null
}

/** `installment_payment_list`: a payment with the two names. */
export interface InstallmentPaymentRow {
  id: string
  contract_id: string
  paid_on: string
  amount: number
  method: InstallmentPaymentMethod
  reference: string | null
  note: string | null
  status: 'posted' | 'voided'
  voided_at: string | null
  voided_by_name: string | null
  void_reason: string | null
  created_by_name: string | null
  created_at: string
  /** The transfer receipt (0206); null when none is attached. */
  receipt_id: string | null
  receipt_path: string | null
  receipt_file_name: string | null
  receipt_mime_type: string | null
  receipt_size_bytes: number | null
}

/** `installment_payment_allocations` with the `seq` of its schedule row. */
/** 0210: what a contract covers («البنود»), in its order. */
export interface InstallmentContractItem {
  id: string
  position: number
  name: string
  quantity: number
}

export interface InstallmentAllocationRow {
  payment_id: string
  amount: number
  seq: number
  kind?: InstallmentRowKind
  title?: string | null
}

export interface InstallmentFinancierRow {
  id: string
  name: string
  /** 0208: the financier's account, both optional. */
  bank_name?: string | null
  iban?: string | null
}

/** A unit linked to a contract; `code` is null when the reader's access
 *  hides the unit (he then sees the count only). */
export interface InstallmentUnit {
  contract_id: string
  equipment_id: string
  code: string | null
  type: string | null
}

/** The units of some contracts (one page of a list), by contract. */
export function unitsByContract(
  units: readonly InstallmentUnit[],
): Map<string, InstallmentUnit[]> {
  const map = new Map<string, InstallmentUnit[]>()
  for (const unit of units) {
    const list = map.get(unit.contract_id) ?? []
    list.push(unit)
    map.set(unit.contract_id, list)
  }
  return map
}

// --- Money ---------------------------------------------------------------------------

/** A database numeric as a number (PostgREST may send a string). */
export function amountOf(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const amount = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(amount) ? amount : 0
}

/** A sum in halalas, so no float dust shows. */
export function sumAmounts(
  values: readonly (number | string | null | undefined)[],
): number {
  return fromHalalas(
    values.reduce<number>((sum, value) => sum + toHalalas(amountOf(value)), 0),
  )
}

/** What a schedule row still asks for. */
export function scheduleRemaining(
  row: Pick<InstallmentScheduleItem, 'amount' | 'paid_amount'>,
): number {
  return fromHalalas(
    toHalalas(amountOf(row.amount)) - toHalalas(amountOf(row.paid_amount)),
  )
}

export function isSchedulePaid(
  row: Pick<InstallmentScheduleItem, 'amount' | 'paid_amount'>,
): boolean {
  return toHalalas(amountOf(row.paid_amount)) >= toHalalas(amountOf(row.amount))
}

/** Paid out of financed, 0–100 (the thin progress bar). */
export function paidPercent(paid: number, financed: number): number {
  if (!(financed > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((paid / financed) * 100)))
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g

/** Arabic-Indic digits as Latin ones (the amount fields accept both). */
export function latinDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

/**
 * A typed amount: digits with an optional dot and at most two decimals
 * (thousands commas and Arabic-Indic digits accepted); null for anything
 * else, an empty field included.
 */
export function parseInstallmentAmount(value: string): number | null {
  const text = latinDigits(value).replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Number(text)
}

/** A stored amount as the text of its field («30000», «12500.5»). */
export function amountInputText(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  return String(amountOf(value))
}

// --- Words -----------------------------------------------------------------------------

/** «يوم», «يومين», «3 ايام», «11 يوم» / "1 day", "3 days". */
export function daysWords(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'day' : 'days'}`
  if (count === 1) return 'يوم'
  if (count === 2) return 'يومين'
  if (count <= 10) return `${count} ايام`
  return `${count} يوم`
}

/** «قسط واحد», «قسطين», «5 اقساط», «27 قسط» / "1 installment". */
export function installmentsWords(count: number, lang: Language): string {
  if (lang === 'en') {
    if (count === 0) return 'No installments'
    return `${count} ${count === 1 ? 'installment' : 'installments'}`
  }
  if (count === 0) return 'لا توجد اقساط'
  if (count === 1) return 'قسط واحد'
  if (count === 2) return 'قسطين'
  if (count <= 10) return `${count} اقساط`
  return `${count} قسط`
}

/** Rows of any kind (0209: installments, first payments, the VAT row):
 *  «استحقاق واحد», «استحقاقين», «5 استحقاقات» / "1 due". */
export function duesWords(count: number, lang: Language): string {
  if (lang === 'en') {
    if (count === 0) return 'Nothing due'
    return `${count} ${count === 1 ? 'due' : 'dues'}`
  }
  if (count === 0) return 'لا توجد استحقاقات'
  if (count === 1) return 'استحقاق واحد'
  if (count === 2) return 'استحقاقين'
  if (count <= 10) return `${count} استحقاقات`
  return `${count} استحقاق`
}

/** «دفعة واحدة», «دفعتين», «3 دفعات», «11 دفعة» / "1 payment". */
export function firstPaymentsWords(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'payment' : 'payments'}`
  if (count === 1) return 'دفعة واحدة'
  if (count === 2) return 'دفعتين'
  if (count <= 10) return `${count} دفعات`
  return `${count} دفعة`
}

/** What a payable row is called: its title for a first payment, «دفعة
 *  الضريبة», else «القسط 3 من 24» (or «القسط 3» without a count), followed
 *  by the installment's name when it has one (0210: «القسط 1 - رقم سند
 *  الامر 545456564»). */
export function payableRowLabel(
  row: {
    kind?: InstallmentRowKind | null
    title?: string | null
    /** 0210: an installment's name; a first payment's note is not shown. */
    note?: string | null
    seq: number
  },
  t: (key: TranslationKey) => string,
  count?: number,
): string {
  if (row.kind === 'first_payment') return row.title || t('instFirstPayment')
  if (row.kind === 'vat') return row.title || t('instVatPayment')
  const key = count ? 'instCardSeqOf' : 'instInstallmentN'
  const label = t(key)
    .replace('{seq}', String(row.seq))
    .replace('{count}', String(count ?? ''))
  const name = row.note?.trim()
  return name ? `${label} - ${name}` : label
}

/** An active contract whose installments wait for their first date. */
export function isAwaitingFirstDue(
  contract: Pick<InstallmentContractRow, 'status' | 'first_due_date'>,
): boolean {
  return contract.status === 'active' && !contract.first_due_date
}

/** «عقد واحد», «عقدين», «6 عقود», «12 عقد» / "1 contract". */
export function contractsWords(count: number, lang: Language): string {
  if (lang === 'en') {
    if (count === 0) return 'No contracts'
    return `${count} ${count === 1 ? 'contract' : 'contracts'}`
  }
  if (count === 0) return 'لا توجد عقود'
  if (count === 1) return 'عقد واحد'
  if (count === 2) return 'عقدين'
  if (count <= 10) return `${count} عقود`
  return `${count} عقد`
}

/** «على 6 عقود سارية» / "On 6 active contracts" (the remaining figure). */
export function activeContractsWords(count: number, lang: Language): string {
  if (lang === 'en') {
    if (count === 0) return 'No active contracts'
    return `On ${count} active ${count === 1 ? 'contract' : 'contracts'}`
  }
  if (count === 0) return 'لا توجد عقود سارية'
  if (count === 1) return 'على عقد واحد ساري'
  if (count === 2) return 'على عقدين ساريين'
  if (count <= 10) return `على ${count} عقود سارية`
  return `على ${count} عقد ساري`
}

/** «عقد نشط واحد», «عقدين نشطين», «5 عقود نشطة», «12 عقد نشط» / "1 active
 *  contract" (a financier's card, 2026-11-22). */
export function activeCountWords(count: number, lang: Language): string {
  if (lang === 'en') {
    if (count === 0) return 'No active contracts'
    return `${count} active ${count === 1 ? 'contract' : 'contracts'}`
  }
  if (count === 0) return 'لا توجد عقود نشطة'
  if (count === 1) return 'عقد نشط واحد'
  if (count === 2) return 'عقدين نشطين'
  if (count <= 10) return `${count} عقود نشطة`
  return `${count} عقد نشط`
}

/** «معدة واحدة», «معدتين», «3 معدات», «11 معدة» / "1 unit". */
export function unitsWords(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'unit' : 'units'}`
  if (count === 1) return 'معدة واحدة'
  if (count === 2) return 'معدتين'
  if (count <= 10) return `${count} معدات`
  return `${count} معدة`
}

/** «اليوم», «متاخر 3 ايام», «باقي 7 ايام» / "Today", "3 days overdue". */
export function whenWords(days: number, lang: Language): string {
  if (lang === 'en') {
    if (days === 0) return 'Today'
    return days < 0
      ? `${daysWords(-days, lang)} overdue`
      : `In ${daysWords(days, lang)}`
  }
  if (days === 0) return 'اليوم'
  return days < 0
    ? `متاخر ${daysWords(-days, lang)}`
    : `باقي ${daysWords(days, lang)}`
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'ابريل',
  'مايو',
  'يونيو',
  'يوليو',
  'اغسطس',
  'سبتمبر',
  'اكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** yyyy-mm of a day key. */
export const monthKeyOf = (dateKey: string) => dateKey.slice(0, 7)

/** «نوفمبر 2026» / "November 2026"; the name alone (three letters in
 *  English) under a bar of the chart with `short`. */
export function installmentMonthLabel(
  monthKey: string,
  lang: Language,
  short = false,
): string {
  const index = Number(monthKey.slice(5, 7)) - 1
  const name =
    (lang === 'ar' ? MONTHS_AR : MONTHS_EN)[index] ?? monthKey.slice(5, 7)
  if (short) return lang === 'ar' ? name : name.slice(0, 3)
  return `${name} ${monthKey.slice(0, 4)}`
}

/** The installments a payment covered: «5», «5، 6», «5–9». */
export function coveredSeqsLabel(
  seqs: readonly number[],
  lang: Language,
): string {
  const sorted = [...seqs].sort((a, b) => a - b)
  if (sorted.length > 3) return `${sorted[0]}–${sorted[sorted.length - 1]}`
  return sorted.join(lang === 'ar' ? '، ' : ', ')
}

// --- The dashboard chart ---------------------------------------------------------------

/** The months the chart shows, this month first. */
export const CASHFLOW_MONTHS = 12

export interface InstallmentMonthBucket {
  /** yyyy-mm */
  key: string
  total: number
  count: number
}

/** The first day AFTER the chart's window: the bounded read asks for the
 *  rows due before it. */
export function cashflowWindowEnd(
  today: string,
  months = CASHFLOW_MONTHS,
): string {
  return addMonths(`${monthKeyOf(today)}-01`, months)
}

/**
 * What is still to pay in each of the coming months, this month first.
 * Overdue rows are left out: the chart shows what is coming, not what is
 * late.
 */
export function monthlyDueBuckets(
  rows: readonly {
    due_date: string
    remaining_amount: number | string | null
  }[],
  today: string,
  months = CASHFLOW_MONTHS,
): InstallmentMonthBucket[] {
  const first = `${monthKeyOf(today)}-01`
  const totals = new Map<string, { halalas: number; count: number }>()
  for (const row of rows) {
    if (row.due_date < today) continue
    const key = monthKeyOf(row.due_date)
    const bucket = totals.get(key) ?? { halalas: 0, count: 0 }
    bucket.halalas += toHalalas(amountOf(row.remaining_amount))
    bucket.count += 1
    totals.set(key, bucket)
  }
  return Array.from({ length: months }, (_, index) => {
    const key = monthKeyOf(addMonths(first, index))
    const bucket = totals.get(key)
    return {
      key,
      total: bucket ? fromHalalas(bucket.halalas) : 0,
      count: bucket?.count ?? 0,
    }
  })
}

/** The first day of today's month and of the next one: «هذا الشهر» is the
 *  rows due from the first (included) to the second (excluded). */
export function currentMonthRange(today: string): { from: string; to: string } {
  const from = `${monthKeyOf(today)}-01`
  return { from, to: addMonths(from, 1) }
}

// --- The financiers ----------------------------------------------------------------------

export interface FinancierFigures {
  /** Every contract of the financier (what blocks its deletion). */
  contracts: number
  activeContracts: number
  /** What its ACTIVE contracts still owe. */
  remaining: number
  /** The nearest unpaid due date of its ACTIVE contracts (the card's
   *  «القسط الجاي», 2026-11-22), null without one. */
  nextDue: string | null
}

const NO_FIGURES: FinancierFigures = {
  contracts: 0,
  activeContracts: 0,
  remaining: 0,
  nextDue: null,
}

/** The contracts of each financier, grouped from the summary rows. */
export function financierFigures(
  rows: readonly {
    financier_id: string
    status: InstallmentContractStatus
    remaining_total: number | string | null
    next_due_date?: string | null
  }[],
): Map<string, FinancierFigures> {
  const halalas = new Map<string, FinancierFigures>()
  for (const row of rows) {
    const figures = halalas.get(row.financier_id) ?? { ...NO_FIGURES }
    figures.contracts += 1
    if (row.status === 'active') {
      figures.activeContracts += 1
      figures.remaining += toHalalas(amountOf(row.remaining_total))
      const due = row.next_due_date ?? null
      if (due && (!figures.nextDue || due < figures.nextDue))
        figures.nextDue = due
    }
    halalas.set(row.financier_id, figures)
  }
  return new Map(
    [...halalas].map(([id, figures]) => [
      id,
      { ...figures, remaining: fromHalalas(figures.remaining) },
    ]),
  )
}

export function figuresOf(
  figures: ReadonlyMap<string, FinancierFigures>,
  financierId: string,
): FinancierFigures {
  return figures.get(financierId) ?? NO_FIGURES
}

// --- The contract page -------------------------------------------------------------------

/** The installments each payment covered (their `seq`, ascending). */
export function allocationSeqsByPayment(
  rows: readonly InstallmentAllocationRow[],
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const row of rows) {
    if (row.kind && row.kind !== 'installment') continue
    const seqs = map.get(row.payment_id) ?? []
    seqs.push(row.seq)
    map.set(row.payment_id, seqs)
  }
  for (const seqs of map.values()) seqs.sort((a, b) => a - b)
  return map
}

/** The first payments and the VAT row each payment covered. */
export function allocationOthersByPayment(
  rows: readonly InstallmentAllocationRow[],
): Map<string, InstallmentAllocationRow[]> {
  const map = new Map<string, InstallmentAllocationRow[]>()
  for (const row of rows) {
    if (!row.kind || row.kind === 'installment') continue
    const list = map.get(row.payment_id) ?? []
    list.push(row)
    map.set(row.payment_id, list)
  }
  for (const list of map.values())
    list.sort((a, b) =>
      a.kind === b.kind ? a.seq - b.seq : a.kind! < b.kind! ? -1 : 1,
    )
  return map
}

export type InstallmentHistoryKind =
  | 'created'
  | 'file_added'
  | 'first_due_set'
  | 'payment_recorded'
  | 'payment_voided'
  | 'paid_off'
  | 'cancelled'

export const INSTALLMENT_HISTORY_LABEL_KEYS: Readonly<
  Record<InstallmentHistoryKind, TranslationKey>
> = {
  created: 'instHistoryCreated',
  file_added: 'instHistoryFileAdded',
  first_due_set: 'instHistoryFirstDueSet',
  payment_recorded: 'instHistoryPaymentRecorded',
  payment_voided: 'instHistoryPaymentVoided',
  paid_off: 'instHistoryPaidOff',
  cancelled: 'instHistoryCancelled',
}

export interface InstallmentHistoryEvent {
  key: string
  kind: InstallmentHistoryKind
  /** When it happened (a timestamp), or null when the row does not say. */
  at: string | null
  /** Who did it; null when the database keeps no name for it. */
  by: string | null
  /** The payment's amount, for the two payment events. */
  amount: number | null
  /** The void or cancel reason. */
  detail: string | null
}

/** The order of two events of the same instant, the later first: the full
 *  payment closes the contract right after it is recorded. */
const HISTORY_RANK: Readonly<Record<InstallmentHistoryKind, number>> = {
  created: 0,
  file_added: 1,
  first_due_set: 2,
  payment_recorded: 3,
  paid_off: 4,
  payment_voided: 5,
  cancelled: 6,
}

const instantOf = (value: string | null) => {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? 0 : time
}

/**
 * The contract's history, the newest first, DERIVED from the contract and
 * its payments (migration 0203 keeps no event table): the creation, every
 * payment, every void with its reason, the full payment that closed the
 * contract (only while it is still paid off) and the cancellation. Since
 * 0209 also the files still on the contract and the latest setting of the
 * first due date.
 */
export function contractHistory(
  contract: Pick<
    InstallmentContractRow,
    'status' | 'closed_at' | 'cancel_reason' | 'created_at' | 'created_by_name'
  > &
    Partial<
      Pick<InstallmentContractRow, 'first_due_set_at' | 'first_due_set_by_name'>
    >,
  payments: readonly InstallmentPaymentRow[],
  files: readonly {
    id: string
    file_name: string
    title: string | null
    created_at: string
    uploaded_by_name: string | null
  }[] = [],
): InstallmentHistoryEvent[] {
  const events: InstallmentHistoryEvent[] = [
    {
      key: 'created',
      kind: 'created',
      at: contract.created_at,
      by: contract.created_by_name,
      amount: null,
      detail: null,
    },
  ]
  for (const file of files)
    events.push({
      key: `${file.id}:file`,
      kind: 'file_added',
      at: file.created_at,
      by: file.uploaded_by_name,
      amount: null,
      detail: file.title ?? file.file_name,
    })
  if (contract.first_due_set_at)
    events.push({
      key: 'first_due_set',
      kind: 'first_due_set',
      at: contract.first_due_set_at,
      by: contract.first_due_set_by_name ?? null,
      amount: null,
      detail: null,
    })
  for (const payment of payments) {
    events.push({
      key: `${payment.id}:recorded`,
      kind: 'payment_recorded',
      at: payment.created_at,
      by: payment.created_by_name,
      amount: amountOf(payment.amount),
      detail: null,
    })
    if (payment.status === 'voided')
      events.push({
        key: `${payment.id}:voided`,
        kind: 'payment_voided',
        at: payment.voided_at,
        by: payment.voided_by_name,
        amount: amountOf(payment.amount),
        detail: payment.void_reason,
      })
  }
  if (contract.status === 'paid_off') {
    // The payment that paid the rest: the latest posted one.
    const closing = payments
      .filter((payment) => payment.status === 'posted')
      .reduce<InstallmentPaymentRow | null>(
        (latest, payment) =>
          !latest ||
          instantOf(payment.created_at) > instantOf(latest.created_at)
            ? payment
            : latest,
        null,
      )
    events.push({
      key: 'paid_off',
      kind: 'paid_off',
      at: contract.closed_at ?? closing?.created_at ?? null,
      by: closing?.created_by_name ?? null,
      amount: null,
      detail: null,
    })
  }
  if (contract.status === 'cancelled')
    events.push({
      key: 'cancelled',
      kind: 'cancelled',
      at: contract.closed_at,
      by: null,
      amount: null,
      detail: contract.cancel_reason,
    })
  return events.sort(
    (a, b) =>
      instantOf(b.at) - instantOf(a.at) ||
      HISTORY_RANK[b.kind] - HISTORY_RANK[a.kind],
  )
}

// --- The list page's URL state -------------------------------------------------------------

export type InstallmentsTab =
  'dashboard' | 'calendar' | 'dues' | 'contracts' | 'financiers'

/** The tabs in their order (owner 2026-11-21: «اللوحة, التقويم,
 *  الاستحقاقات, العقود, الجهات التمويلية»). */
export const INSTALLMENTS_TABS: readonly InstallmentsTab[] = [
  'dashboard',
  'calendar',
  'dues',
  'contracts',
  'financiers',
]

export type InstallmentDuesView =
  'overdue' | 'month' | 'next30' | 'all' | 'paid'

/** The sub-tabs of «الاستحقاقات»; «المسددة» (owner 2026-11-21, «ابغى يكون
 *  لي وصول سريع للي سددتهم») lists the fully paid rows, the latest paid
 *  first. */
export const INSTALLMENT_DUES_VIEWS: readonly InstallmentDuesView[] = [
  'overdue',
  'month',
  'next30',
  'all',
  'paid',
]

export const INSTALLMENT_DUES_VIEW_LABEL_KEYS: Readonly<
  Record<InstallmentDuesView, TranslationKey>
> = {
  overdue: 'instDuesViewOverdue',
  month: 'instDuesViewMonth',
  next30: 'instDuesViewNext30',
  all: 'instDuesViewAll',
  paid: 'instDuesViewPaid',
}

/** The urgency tone of each dues view (design «نموذج 5», owner
 *  2026-11-21): late red, this month amber, 30 days blue, all unpaid
 *  neutral, paid green. */
export type InstallmentDuesViewTone =
  'danger' | 'warning' | 'info' | 'neutral' | 'success'

export const INSTALLMENT_DUES_VIEW_TONES: Readonly<
  Record<InstallmentDuesView, InstallmentDuesViewTone>
> = {
  overdue: 'danger',
  month: 'warning',
  next30: 'info',
  all: 'neutral',
  paid: 'success',
}

/** The dues always open on «هذا الشهر» (owner 2026-11-21, «في الاستحقاقات
 *  خل الافتراضي على تاب هذا الشهر»; it opened on what was late before). */
export const DEFAULT_DUES_VIEW: InstallmentDuesView = 'month'

export const INSTALLMENT_CONTRACT_STATUSES: readonly InstallmentContractStatus[] =
  ['active', 'paid_off', 'cancelled']

/** Rows a page of the contracts and of the dues. */
export const INSTALLMENTS_PAGE_SIZE = 20

/**
 * The names of the list page's own query parameters: the tab and the dues
 * sub-tab. The contracts and the dues lists keep their search, filters,
 * sort, page and size through `useDataListState` under the prefixes
 * `c` and `d` (`INSTALLMENT_CONTRACTS_URL_PREFIX`, `INSTALLMENT_DUES_URL_PREFIX`).
 */
export const INSTALLMENTS_URL_KEYS = {
  tab: 'tab',
  duesView: 'view',
  /** The dues tab of the unified page: its financier. */
  feedFinancier: 'fin',
  /** The contracts tab: its chip, its sort and its search. */
  contractChip: 'chip',
  contractSort: 'csort',
  contractSearch: 'cq',
} as const

export const INSTALLMENT_CONTRACTS_URL_PREFIX = 'c'
export const INSTALLMENT_DUES_URL_PREFIX = 'd'

export interface InstallmentsUrlState {
  tab: InstallmentsTab
  /** null = not chosen yet: `DEFAULT_DUES_VIEW`. */
  duesView: InstallmentDuesView | null
  /** The unified page (2026-11-21) reads these raw values through the
   *  readers of `installmentsBoard.ts`: the dues view («open» / «paid» /
   *  «all» under the key `view`), its financier, the contracts chip, sort
   *  and search. */
  feedView: string | null
  feedFinancier: string | null
  contractChip: string | null
  contractSort: string | null
  contractSearch: string
}

/** The list page's state from its query string; anything unknown falls
 *  back to the default (a pasted URL never breaks the page). */
export function readInstallmentsUrlState(
  get: (name: string) => string | null,
): InstallmentsUrlState {
  const keys = INSTALLMENTS_URL_KEYS
  const tab = get(keys.tab) as InstallmentsTab | null
  const view = get(keys.duesView) as InstallmentDuesView | null
  return {
    tab: tab && INSTALLMENTS_TABS.includes(tab) ? tab : 'dashboard',
    duesView: view && INSTALLMENT_DUES_VIEWS.includes(view) ? view : null,
    feedView: get(keys.duesView),
    feedFinancier: get(keys.feedFinancier),
    contractChip: get(keys.contractChip),
    contractSort: get(keys.contractSort),
    contractSearch: get(keys.contractSearch) ?? '',
  }
}

/** The list page opened on one tab (the «كل الاستحقاقات» links). */
export function installmentsListHref(
  tab: InstallmentsTab,
  duesView?: InstallmentDuesView,
): string {
  const params = new URLSearchParams()
  if (tab !== 'dashboard') params.set(INSTALLMENTS_URL_KEYS.tab, tab)
  if (duesView) params.set(INSTALLMENTS_URL_KEYS.duesView, duesView)
  const query = params.toString()
  return query ? `/installments?${query}` : '/installments'
}

// --- The forms -----------------------------------------------------------------------------

/** The payment form. */
export interface InstallmentPaymentFormValues {
  contract_id: string
  amount: string
  paid_on: string
  method: string
  reference: string
  note: string
}

export const INSTALLMENT_PAYMENT_FIELD_ORDER: readonly (keyof InstallmentPaymentFormValues)[] =
  ['contract_id', 'amount', 'paid_on', 'method', 'reference', 'note']

/** The form field a token of `record_installment_payment` belongs to. */
export const INSTALLMENT_PAYMENT_TOKEN_FIELDS: Readonly<
  Record<string, keyof InstallmentPaymentFormValues>
> = {
  invalid_payment_amount: 'amount',
  payment_exceeds_balance: 'amount',
  invalid_paid_on: 'paid_on',
  invalid_method: 'method',
  invalid_reference: 'reference',
  invalid_note: 'note',
  installments_not_scheduled: 'amount',
}

/** The void-payment and cancel-contract dialogs. */
export interface InstallmentReasonFormValues {
  reason: string
}

export interface InstallmentFinancierFormValues {
  name: string
  bank_name: string
  iban: string
}

const TOKENS_LONGEST_FIRST = [...INSTALLMENT_ERROR_TOKENS].sort(
  (a, b) => b.length - a.length,
)

/** The stable token a refused installments write carries, or null. The
 *  longest first, so `invalid_note` never answers for `invalid_notes`. */
export function installmentErrorToken(
  error: InstallmentDatabaseError | null | undefined,
): string | null {
  if (!error) return null
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return TOKENS_LONGEST_FIRST.find((token) => text.includes(token)) ?? null
}

/**
 * The field of a form a refused write belongs to, with its safe message;
 * null when the refusal is not about one field (the form then shows
 * `installmentErrorMessage` at its top). The raw text is never shown.
 */
export function installmentFieldError<Field extends string>(
  error: InstallmentDatabaseError | null | undefined,
  fields: Readonly<Record<string, Field>>,
): { field: Field; key: TranslationKey } | null {
  const token = installmentErrorToken(error)
  if (!token || !Object.prototype.hasOwnProperty.call(fields, token))
    return null
  return { field: fields[token], key: INSTALLMENT_ERROR_KEYS[token] }
}

/** The refusals that mean the record changed meanwhile: the page refetches
 *  and shows the message itself. */
export const INSTALLMENT_STALE_TOKENS: ReadonlySet<string> = new Set([
  'invalid_contract',
  'invalid_payment',
  'contract_not_active',
  'contract_has_payments',
  'payment_already_voided',
  'invalid_schedule_row',
  'first_payment_locked',
  'installments_not_scheduled',
  'contract_file_not_found',
  'contract_changed',
])

/**
 * The filter fields of a list config with the «الجهة» options filled from
 * the financiers the page already read (a short master list, cap 1000).
 */
export function withFinancierOptions(
  config: { filterFields: readonly FilterField[] },
  financiers: readonly InstallmentFinancierRow[],
): FilterField[] {
  return config.filterFields.map((field) =>
    field.key === 'financier_id'
      ? {
          ...field,
          options: financiers.map((financier) => ({
            value: financier.id,
            label: financier.name,
          })),
        }
      : field,
  )
}

// «جدول السداد» of the contract page (owner 2026-11-23, model C).

/** The installments the table shows until «عرض كل الاقساط»: the ones near
 *  the first unpaid one. */
export const NEAR_INSTALLMENTS = 6

/** The near installments of a list in seq order: from one before the first
 *  unpaid row, or the last ones when every row is paid. */
export function nearInstallments<T extends { paid: boolean }>(
  rows: readonly T[],
  size = NEAR_INSTALLMENTS,
): T[] {
  if (rows.length <= size) return [...rows]
  const firstOpen = rows.findIndex((row) => !row.paid)
  const anchor = firstOpen < 0 ? rows.length : firstOpen
  const start = Math.max(0, Math.min(anchor - 1, rows.length - size))
  return rows.slice(start, start + size)
}

/**
 * When a row was paid against its due day (owner 2026-11-25): the day of
 * the transfer (the latest posted payment on the row) minus the due day.
 * Null without both days.
 */
export function paymentTiming(
  dueDate: string | null | undefined,
  paidOn: string | null | undefined,
): { kind: 'late' | 'early' | 'on_time'; days: number } | null {
  if (!dueDate || !paidOn) return null
  const days = -daysUntilDue(dueDate, paidOn)
  if (days > 0) return { kind: 'late', days }
  if (days < 0) return { kind: 'early', days: -days }
  return { kind: 'on_time', days: 0 }
}
