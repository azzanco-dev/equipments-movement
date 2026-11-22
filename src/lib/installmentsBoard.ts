import {
  addMonths,
  fromHalalas,
  toHalalas,
  type InstallmentContractStatus,
} from '@/lib/installments'
import {
  amountOf,
  monthKeyOf,
  paidPercent,
  type InstallmentContractRow,
  type InstallmentDueRow,
} from '@/lib/installmentsView'

/**
 * The pure rules of the unified installments page (owner 2026-11-21: the
 * Figma frames «الاقساط / الصفحة الموحدة»: اللوحة, التقويم, الاستحقاقات,
 * العقود). Saudi day keys (yyyy-mm-dd) in, plain values out; no network.
 */

/** «القادم خلال 7 ايام» on the dashboard. */
export const UPCOMING_DAYS = 7
/** «تخلص قريب»: an active contract whose last installment falls within
 *  this many days (my choice, told to the owner). */
export const ENDING_SOON_DAYS = 90
/** The dashboard shows this many upcoming cards (three a row). */
export const UPCOMING_CARDS = 6
/** The contracts tab shows this many cards, «عرض المزيد» adds as many. */
export const CONTRACT_CARDS_PAGE = 12
/** The dues tab shows this many rows, «عرض المزيد» adds as many. */
export const DUES_FEED_PAGE = 60

const DAY_MS = 86_400_000
const toUtc = (dateKey: string) =>
  Date.UTC(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10)),
  )
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The day key `days` after (or before) a day key. */
export function addDays(dateKey: string, days: number): string {
  return fromUtc(toUtc(dateKey) + days * DAY_MS)
}

/** 0 = Sunday … 6 = Saturday (the Saudi week starts on Sunday). */
export function weekdayOf(dateKey: string): number {
  return new Date(toUtc(dateKey)).getUTCDay()
}

/** The Saturday that ends the week of a day. */
export function weekEndOf(dateKey: string): string {
  return addDays(dateKey, 6 - weekdayOf(dateKey))
}

// --- Financier colours ------------------------------------------------------------------

/** A financier's tone 1…6 (the chart shades `--chart-N` / `--chart-stroke-N`),
 *  by its place in the financiers list, so it keeps its colour everywhere. */
export function financierTone(
  financiers: readonly { id: string }[],
  financierId: string,
): number {
  const index = financiers.findIndex((row) => row.id === financierId)
  return index < 0 ? 4 : (index % 6) + 1
}

// --- Contracts --------------------------------------------------------------------------

export type ContractCardState =
  'overdue' | 'awaiting' | 'active' | 'paid_off' | 'cancelled'

/** The badge of a contract card: «فيه متاخر» wins over «بانتظار التاريخ»
 *  (0209), which wins over «نشط». */
export function contractCardState(
  contract: Pick<InstallmentContractRow, 'status' | 'overdue_count'> &
    Partial<Pick<InstallmentContractRow, 'first_due_date'>>,
): ContractCardState {
  if (contract.status === 'active' && contract.overdue_count > 0)
    return 'overdue'
  if (contract.status === 'active' && contract.first_due_date === null)
    return 'awaiting'
  return contract.status
}

/** The installment the contract is on: «القسط 9 من 36». */
export function currentSeq(
  contract: Pick<InstallmentContractRow, 'paid_count' | 'installment_count'>,
): number {
  return Math.min(contract.paid_count + 1, contract.installment_count)
}

/** The share of the WHOLE contract already paid, 0–100 (0209: with what
 *  was paid before it was entered, out of the total with its VAT). */
export function contractPaidPercent(
  contract: Pick<InstallmentContractRow, 'paid_overall' | 'payable_total'>,
): number {
  return paidPercent(
    amountOf(contract.paid_overall),
    amountOf(contract.payable_total),
  )
}

/** The figures of every contract, one bounded read (`fetchContractFigures`). */
export interface ContractFigureRow {
  id: string
  financier_id: string
  status: InstallmentContractStatus
  first_due_date: string | null
  payable_total: number | string
  paid_overall: number | string
  remaining_total: number | string
  overdue_count: number
  last_due_date: string | null
}

export interface ContractsSummary {
  activeCount: number
  /** Financiers with at least one active contract. */
  activeFinanciers: number
  /** Over the contracts that are not cancelled: paid (with what was paid
   *  before entry) and payable. */
  paid: number
  payable: number
  paidPercent: number
  /** What the active contracts still owe. */
  remaining: number
  /** The year of the last installment of the active contracts, or null. */
  lastYear: number | null
  /** Active contracts whose last installment falls in this calendar year. */
  endingThisYear: number
}

export function summarizeContracts(
  rows: readonly ContractFigureRow[],
  today: string,
): ContractsSummary {
  let paid = 0
  let payable = 0
  let remaining = 0
  let activeCount = 0
  let endingThisYear = 0
  let last: string | null = null
  const financiers = new Set<string>()
  const yearEnd = `${today.slice(0, 4)}-12-31`
  for (const row of rows) {
    if (row.status === 'cancelled') continue
    paid += toHalalas(amountOf(row.paid_overall))
    payable += toHalalas(amountOf(row.payable_total))
    if (row.status !== 'active') continue
    activeCount += 1
    financiers.add(row.financier_id)
    remaining += toHalalas(amountOf(row.remaining_total))
    if (row.last_due_date) {
      if (!last || row.last_due_date > last) last = row.last_due_date
      if (row.last_due_date <= yearEnd) endingThisYear += 1
    }
  }
  return {
    activeCount,
    activeFinanciers: financiers.size,
    paid: fromHalalas(paid),
    payable: fromHalalas(payable),
    paidPercent: paidPercent(fromHalalas(paid), fromHalalas(payable)),
    remaining: fromHalalas(remaining),
    lastYear: last ? Number(last.slice(0, 4)) : null,
    endingThisYear,
  }
}

/** What each financier's ACTIVE contracts still owe, the largest first, with
 *  its share of the total (whole percent). */
export function financierShares(
  rows: readonly ContractFigureRow[],
): { financierId: string; remaining: number; share: number }[] {
  const totals = new Map<string, number>()
  let all = 0
  for (const row of rows) {
    if (row.status !== 'active') continue
    const halalas = toHalalas(amountOf(row.remaining_total))
    totals.set(row.financier_id, (totals.get(row.financier_id) ?? 0) + halalas)
    all += halalas
  }
  return [...totals]
    .map(([financierId, halalas]) => ({
      financierId,
      remaining: fromHalalas(halalas),
      share: all > 0 ? Math.round((halalas / all) * 100) : 0,
    }))
    .filter((row) => row.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
}

/** The contract filters of «العقود» (chips of the design «نموذج 5»). */
export type ContractChip =
  'all' | 'overdue' | 'awaiting' | 'ending' | 'paid_off' | 'cancelled'

export const CONTRACT_CHIPS: readonly ContractChip[] = [
  'all',
  'overdue',
  'awaiting',
  'ending',
  'paid_off',
  'cancelled',
]

export function readContractChip(value: string | null): ContractChip {
  return value && (CONTRACT_CHIPS as readonly string[]).includes(value)
    ? (value as ContractChip)
    : 'all'
}

/** How many contracts each chip holds, from the bounded figures read. */
export function contractChipCounts(
  rows: readonly ContractFigureRow[],
  today: string,
): Record<ContractChip, number> {
  const endBy = addDays(today, ENDING_SOON_DAYS)
  const counts: Record<ContractChip, number> = {
    all: rows.length,
    overdue: 0,
    awaiting: 0,
    ending: 0,
    paid_off: 0,
    cancelled: 0,
  }
  for (const row of rows) {
    if (row.status === 'paid_off') counts.paid_off += 1
    else if (row.status === 'cancelled') counts.cancelled += 1
    else {
      if (row.overdue_count > 0) counts.overdue += 1
      if (!row.first_due_date) counts.awaiting += 1
      if (row.last_due_date && row.last_due_date <= endBy) counts.ending += 1
    }
  }
  return counts
}

export type ContractSort = 'next_due' | 'updated' | 'remaining' | 'number'

export const CONTRACT_SORTS: readonly ContractSort[] = [
  'next_due',
  'updated',
  'remaining',
  'number',
]

export function readContractSort(value: string | null): ContractSort {
  return value && (CONTRACT_SORTS as readonly string[]).includes(value)
    ? (value as ContractSort)
    : 'next_due'
}

// --- Dues -------------------------------------------------------------------------------

export type DueTone = 'success' | 'danger' | 'warning' | 'info'

/** A due row's colour: paid green, late red, within 7 days amber, later
 *  blue (the calendar's legend). */
export function dueTone(
  row: Pick<InstallmentDueRow, 'state' | 'days_until_due'> & {
    is_paid?: boolean
  },
): DueTone {
  if (row.state === 'paid' || row.is_paid) return 'success'
  if (row.days_until_due < 0) return 'danger'
  if (row.days_until_due <= UPCOMING_DAYS) return 'warning'
  return 'info'
}

/** The amount a due row shows: what remains, or the amount once paid. */
export function dueShownAmount(
  row: Pick<InstallmentDueRow, 'state' | 'amount' | 'remaining_amount'>,
): number {
  return row.state === 'paid'
    ? amountOf(row.amount)
    : amountOf(row.remaining_amount)
}

/** The total of one calendar day: its installments' own amounts, paid or
 *  not (owner 2026-11-22, «تحسب الاجمالي حق اليوم»). */
export function dayDueTotal(
  rows: readonly Pick<InstallmentDueRow, 'amount'>[],
): number {
  return fromHalalas(
    rows.reduce((sum, row) => sum + toHalalas(amountOf(row.amount)), 0),
  )
}

/** The short number on a calendar chip: «INS-0016» → «0016». */
export const shortContractNumber = (number: string) =>
  number.replace(/^INS-/, '')

export type DuesFeedView = 'open' | 'paid' | 'all'

export const DUES_FEED_VIEWS: readonly DuesFeedView[] = ['open', 'paid', 'all']

export function readDuesFeedView(value: string | null): DuesFeedView {
  return value && (DUES_FEED_VIEWS as readonly string[]).includes(value)
    ? (value as DuesFeedView)
    : 'open'
}

export type DuesGroupKind =
  'overdue' | 'this_week' | 'next_week' | 'month' | 'paid_month'

export interface DuesGroup {
  key: string
  kind: DuesGroupKind
  /** yyyy-mm for a month group. */
  month: string | null
  tone: DueTone | 'neutral'
  rows: InstallmentDueRow[]
  total: number
}

/**
 * The rows of the dues tab in groups (design 3): unpaid ones as «متاخر»,
 * «هذا الاسبوع» (to Saturday), «الاسبوع الجاي», then one group per month;
 * paid ones by the month they were paid; «الكل» by the month due. The rows
 * keep the order they came in.
 */
export function groupDues(
  rows: readonly InstallmentDueRow[],
  view: DuesFeedView,
  today: string,
): DuesGroup[] {
  const thisWeekEnd = weekEndOf(today)
  const nextWeekEnd = addDays(thisWeekEnd, 7)
  const groups = new Map<string, DuesGroup>()
  const add = (
    key: string,
    kind: DuesGroupKind,
    month: string | null,
    tone: DuesGroup['tone'],
    row: InstallmentDueRow,
  ) => {
    const group = groups.get(key) ?? {
      key,
      kind,
      month,
      tone,
      rows: [],
      total: 0,
    }
    group.rows.push(row)
    group.total = fromHalalas(
      toHalalas(group.total) + toHalalas(dueShownAmount(row)),
    )
    groups.set(key, group)
  }
  for (const row of rows) {
    if (view === 'paid') {
      const month = monthKeyOf(row.last_paid_on ?? row.due_date)
      add(`paid:${month}`, 'paid_month', month, 'success', row)
    } else if (view === 'all') {
      const month = monthKeyOf(row.due_date)
      add(`month:${month}`, 'month', month, 'neutral', row)
    } else if (row.days_until_due < 0)
      add('overdue', 'overdue', null, 'danger', row)
    else if (row.due_date <= thisWeekEnd)
      add('this_week', 'this_week', null, 'warning', row)
    else if (row.due_date <= nextWeekEnd)
      add('next_week', 'next_week', null, 'info', row)
    else {
      const month = monthKeyOf(row.due_date)
      add(`month:${month}`, 'month', month, 'neutral', row)
    }
  }
  return [...groups.values()]
}

// --- Calendar ---------------------------------------------------------------------------

/** The weeks of a month (Sunday first), each seven day keys or null. */
export function monthGrid(monthKey: string): (string | null)[][] {
  const first = `${monthKey}-01`
  const next = addMonths(first, 1)
  const cells: (string | null)[] = Array.from(
    { length: weekdayOf(first) },
    () => null,
  )
  for (let day = first; day < next; day = addDays(day, 1)) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let index = 0; index < cells.length; index += 7)
    weeks.push(cells.slice(index, index + 7))
  return weeks
}

/** The month key `months` after (or before) a month key. */
export const shiftMonth = (monthKey: string, months: number) =>
  monthKeyOf(addMonths(`${monthKey}-01`, months))

/** The due rows of each day. */
export function duesByDay(
  rows: readonly InstallmentDueRow[],
): Map<string, InstallmentDueRow[]> {
  const map = new Map<string, InstallmentDueRow[]>()
  for (const row of rows) {
    const list = map.get(row.due_date) ?? []
    list.push(row)
    map.set(row.due_date, list)
  }
  return map
}

/** A month's ring: what fell due in it, what of that is paid, what remains. */
export function monthDueSummary(rows: readonly InstallmentDueRow[]): {
  due: number
  paid: number
  remaining: number
  percent: number
} {
  let due = 0
  let remaining = 0
  for (const row of rows) {
    due += toHalalas(amountOf(row.amount))
    remaining += toHalalas(amountOf(row.remaining_amount))
  }
  const paid = due - remaining
  return {
    due: fromHalalas(due),
    paid: fromHalalas(paid),
    remaining: fromHalalas(remaining),
    percent: due > 0 ? Math.round((paid / due) * 100) : 0,
  }
}

/** The weekday names, Sunday first. */
export const WEEKDAYS_AR = [
  'الاحد',
  'الاثنين',
  'الثلاثاء',
  'الاربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const
export const WEEKDAYS_EN = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const

/** The chart's amber months: this month and the next one (the Figma design). */
export const NEAR_MONTHS = 2

const MONTHS_SHORT_AR = [
  'ينا',
  'فبر',
  'مار',
  'ابر',
  'ماي',
  'يون',
  'يول',
  'اغس',
  'سبت',
  'اكت',
  'نوف',
  'ديس',
] as const
const MONTHS_SHORT_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** The month's short name under a bar of the chart: «نوف» / "Nov". */
export function installmentMonthShort(
  monthKey: string,
  lang: 'ar' | 'en',
): string {
  const index = Number(monthKey.slice(5, 7)) - 1
  return (lang === 'ar' ? MONTHS_SHORT_AR : MONTHS_SHORT_EN)[index] ?? monthKey
}

// --- Financiers (the cards of «الجهات التمويلية», owner 2026-11-22) -----------------------

/** The four figures over the financiers' cards. */
export interface FinanciersOverview {
  financiers: number
  /** Financiers with at least one ACTIVE contract. */
  withActive: number
  activeContracts: number
  remaining: number
  /** The financier owed the most, with its whole-percent share. */
  top: { financierId: string; share: number } | null
  /** Financiers without an IBAN (the «بدون حساب بنكي» card). */
  withoutIban: number
}

export function financiersOverview(
  financiers: readonly { id: string; iban?: string | null }[],
  figures: ReadonlyMap<
    string,
    { activeContracts: number; remaining: number }
  >,
): FinanciersOverview {
  let withActive = 0
  let activeContracts = 0
  let all = 0
  let top: { financierId: string; halalas: number } | null = null
  for (const financier of financiers) {
    const row = figures.get(financier.id)
    if (!row) continue
    if (row.activeContracts > 0) withActive += 1
    activeContracts += row.activeContracts
    const halalas = toHalalas(row.remaining)
    all += halalas
    if (halalas > 0 && (!top || halalas > top.halalas))
      top = { financierId: financier.id, halalas }
  }
  return {
    financiers: financiers.length,
    withActive,
    activeContracts,
    remaining: fromHalalas(all),
    top: top
      ? {
          financierId: top.financierId,
          share: Math.round((top.halalas / all) * 100),
        }
      : null,
    withoutIban: financiers.filter((row) => !row.iban).length,
  }
}

/** A financier's whole-percent share of what every financier is owed. */
export function remainingShare(remaining: number, total: number): number {
  const all = toHalalas(total)
  return all > 0 ? Math.round((toHalalas(remaining) / all) * 100) : 0
}
