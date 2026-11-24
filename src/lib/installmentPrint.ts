import type { TranslationKey } from '@/i18n/translations'
import { daysUntilDue } from '@/lib/installments'
import {
  amountOf,
  isSchedulePaid,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'

/**
 * The installment PDF «سداد قسط» (owner 2026-11-24, model 1 approved in
 * Figma, «نموذج 1، اعتمد وابني»): pure rules of the sheet, kept apart from
 * the component so they can be tested.
 */

/** The row the sheet asks to pay: the contract's next due row (the first
 *  unpaid one by the summary view), else none. */
export function installmentToPay(
  contract: Pick<InstallmentContractRow, 'status' | 'next_due_id'>,
  schedule: readonly InstallmentScheduleItem[],
): InstallmentScheduleItem | null {
  if (contract.status !== 'active' || !contract.next_due_id) return null
  return schedule.find((row) => row.id === contract.next_due_id) ?? null
}

export type InstallmentPrintState =
  | 'paid'
  | 'asked'
  | 'late'
  | 'partial'
  | 'waits'
  | 'upcoming'

/** One row's state on the sheet: the asked row first, then paid, late,
 *  partly paid, undated, upcoming. */
export function installmentPrintState(
  row: InstallmentScheduleItem,
  askedId: string | null,
  today: string,
): InstallmentPrintState {
  if (row.id === askedId) return 'asked'
  if (isSchedulePaid(row)) return 'paid'
  if (row.due_date && daysUntilDue(row.due_date, today) < 0) return 'late'
  if (amountOf(row.paid_amount) > 0) return 'partial'
  if (!row.due_date) return 'waits'
  return 'upcoming'
}

export const INSTALLMENT_PRINT_STATE_KEYS: Readonly<
  Record<InstallmentPrintState, TranslationKey>
> = {
  paid: 'instStatePaid',
  asked: 'instPrintStateAsked',
  late: 'instStateOverdue',
  partial: 'instPartlyPaid',
  waits: 'instFpWaitsDate',
  upcoming: 'instStateUpcoming',
}

export interface InstallmentPrintGroup {
  key: 'first' | 'installments' | 'vat'
  title: TranslationKey
  rows: InstallmentScheduleItem[]
}

/** The sheet's groups in their order: the first payments, the installments,
 *  the VAT when it is paid by itself. The installments group stays when the
 *  contract still waits for its first due date (the sheet says so). */
export function installmentPrintGroups(
  contract: Pick<InstallmentContractRow, 'vat_mode'>,
  schedule: readonly InstallmentScheduleItem[],
): InstallmentPrintGroup[] {
  const bySeq = (a: InstallmentScheduleItem, b: InstallmentScheduleItem) =>
    a.seq - b.seq
  const of = (kind: InstallmentScheduleItem['kind']) =>
    schedule.filter((row) => row.kind === kind).sort(bySeq)
  const groups: InstallmentPrintGroup[] = []
  const first = of('first_payment')
  if (first.length)
    groups.push({ key: 'first', title: 'instFirstPayments', rows: first })
  groups.push({
    key: 'installments',
    title: 'instInstallments',
    rows: of('installment'),
  })
  const vat = contract.vat_mode === 'separate' ? of('vat') : []
  if (vat.length) groups.push({ key: 'vat', title: 'instGroupVat', rows: vat })
  return groups
}

/** The suggested PDF file name: «سداد قسط - <contract title>». */
export function installmentPrintFileName(title: string, description: string) {
  return `${title} - ${description}`.replace(/[\\/:*?"<>|]+/g, ' ').trim()
}
