import type { ReactNode } from 'react'
import { Calendar } from 'lucide-react'
import { Badge, Button, Card, SectionHeader, cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  daysUntilDue,
  formatInstallmentAmount,
  fromHalalas,
  toHalalas,
} from '@/lib/installments'
import { vatInsideHalalas } from '@/lib/installmentPlan'
import {
  amountOf,
  isSchedulePaid,
  payableRowLabel,
  scheduleRemaining,
  sumAmounts,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { Money, WhenBadge } from './cells'

/**
 * The wide card of one payable row of the contract page (0209): the name
 * and what it is made of, the day with its state, the amount in the
 * fixed-width end block with its actions.
 */
export function PayableRowCard({
  title,
  sub,
  date,
  badges,
  amountLabel,
  amount,
  remaining,
  late,
  actions,
}: {
  title: ReactNode
  sub?: ReactNode
  date: string | null
  badges?: ReactNode
  amountLabel: ReactNode
  amount: number
  /** What is left of a partly paid row. */
  remaining?: number
  late?: boolean
  actions?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <li
      className={cn(
        'rounded-xl border bg-bg p-3 sm:p-4',
        late && 'border-[var(--danger)]',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:flex-nowrap">
        <div className="min-w-0 flex-1 sm:basis-3/5">
          <div className="break-words font-semibold">{title}</div>
          {sub && (
            <div className="mt-0.5 break-words text-xs text-muted">{sub}</div>
          )}
        </div>
        <div className="min-w-0 space-y-1 sm:flex-1 sm:basis-2/5">
          <p className="flex items-center gap-1.5 text-sm">
            <Calendar
              size={14}
              aria-hidden="true"
              className="shrink-0 text-muted"
            />
            {date ? <bdi dir="ltr">{formatDate(date)}</bdi> : '—'}
          </p>
          {badges && (
            <div className="flex flex-wrap items-center gap-1">{badges}</div>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t pt-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:gap-2 sm:border-t-0 sm:pt-0">
          <div className="text-start sm:text-end">
            <p className="text-xs text-muted">{amountLabel}</p>
            <p className="text-lg font-semibold">
              <Money value={amount} />
            </p>
            {remaining !== undefined && (
              <p className="text-xs text-muted">
                {t('instRemaining')} <Money value={remaining} />
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
        </div>
      </div>
    </li>
  )
}

const partlyPaid = (row: InstallmentScheduleItem) =>
  amountOf(row.paid_amount) > 0 && !isSchedulePaid(row)

/** «الدفعات الاولى»: payable even without a date or a first due date. */
export function FirstPaymentsCard({
  contract,
  rows,
  today,
  paidOn,
  canAct,
  onPay,
  onSetDate,
}: {
  contract: InstallmentContractRow
  rows: readonly InstallmentScheduleItem[]
  today: string
  /** The day a row was paid, for one paid without a day. */
  paidOn: (row: InstallmentScheduleItem) => string | null
  /** installments.manage and an active contract. */
  canAct: boolean
  onPay: (row: InstallmentScheduleItem) => void
  onSetDate: (row: InstallmentScheduleItem) => void
}) {
  const { t } = useI18n()
  const money = formatInstallmentAmount
  const running = contract.status !== 'cancelled'
  return (
    <Card className="space-y-3 p-4">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            {t('instFirstPayments')}
            <Badge size="sm">{rows.length}</Badge>
          </span>
        }
      />
      <ul className="space-y-2">
        {rows.map((row) => {
          const paid = isSchedulePaid(row)
          const partial = partlyPaid(row)
          const days = row.due_date ? daysUntilDue(row.due_date, today) : null
          const rated = row.rate !== null && row.rate !== undefined
          const inside = vatInsideHalalas(toHalalas(amountOf(row.amount)))
          const parts = [
            rated
              ? contract.vat_mode === 'separate'
                ? t('instRateOfBase')
                    .replace('{rate}', String(amountOf(row.rate)))
                    .replace(
                      '{amount}',
                      money(
                        sumAmounts([
                          contract.total_amount,
                          -amountOf(contract.vat_amount),
                        ]),
                      ),
                    )
                : t('instFpRateOfContract').replace(
                    '{rate}',
                    String(amountOf(row.rate)),
                  )
              : t('instFpKindAmount'),
            ...(contract.vat_mode === 'inside'
              ? [
                  t('instBeforeVat').replace(
                    '{amount}',
                    money(
                      fromHalalas(toHalalas(amountOf(row.amount)) - inside),
                    ),
                  ),
                  t('instVatPart').replace(
                    '{amount}',
                    money(fromHalalas(inside)),
                  ),
                ]
              : []),
          ]
          return (
            <PayableRowCard
              key={row.id}
              title={row.title ?? t('instFirstPayment')}
              sub={
                <>
                  {parts.join(' · ')}
                  {row.note && <span className="block">{row.note}</span>}
                </>
              }
              date={row.due_date ?? (paid ? paidOn(row) : null)}
              late={running && !paid && days !== null && days < 0}
              amountLabel={t('instFpDue')}
              amount={amountOf(row.amount)}
              remaining={partial ? scheduleRemaining(row) : undefined}
              badges={
                running ? (
                  <>
                    {paid ? (
                      <Badge size="sm" tone="success">
                        {t('instFpPaid')}
                      </Badge>
                    ) : days === null ? (
                      <Badge size="sm" tone="warning">
                        {t('instFpWaitsDate')}
                      </Badge>
                    ) : (
                      <WhenBadge days={days} />
                    )}
                    {partial && (
                      <Badge size="sm" tone="info">
                        {t('instPartlyPaid')}
                      </Badge>
                    )}
                  </>
                ) : undefined
              }
              actions={
                canAct && !paid ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onPay(row)}
                    >
                      {t('instPayRow')}
                    </Button>
                    {!row.due_date && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onSetDate(row)}
                      >
                        {t('instSetDate')}
                      </Button>
                    )}
                  </>
                ) : undefined
              }
            />
          )
        })}
      </ul>
    </Card>
  )
}

/** «دفعة الضريبة» of a contract whose VAT is paid by itself: payable and
 *  datable like a first payment, before the first due date too. */
export function VatPaymentCard({
  contract,
  row,
  today,
  paidOn,
  canAct,
  onPay,
  onSetDate,
}: {
  contract: InstallmentContractRow
  row: InstallmentScheduleItem
  today: string
  /** The day it was paid, for a row paid without a day. */
  paidOn: string | null
  canAct: boolean
  onPay: (row: InstallmentScheduleItem) => void
  onSetDate: (row: InstallmentScheduleItem) => void
}) {
  const { t } = useI18n()
  const running = contract.status !== 'cancelled'
  const paid = isSchedulePaid(row)
  const partial = partlyPaid(row)
  const date = row.due_date
  const days = date ? daysUntilDue(date, today) : null
  const total = toHalalas(amountOf(contract.total_amount))
  const vat = toHalalas(amountOf(contract.vat_amount))
  const automatic = vat === vatInsideHalalas(total)
  const withLast = contract.vat_due === 'last'
  return (
    <Card className="space-y-3 p-4">
      <SectionHeader title={t('instVatPayment')} />
      <ul>
        <PayableRowCard
          title={row.title ? payableRowLabel(row, t) : t('instVatOfContract')}
          sub={
            <>
              {t(automatic ? 'instVatRateOf' : 'instVatTypedOf').replace(
                '{amount}',
                formatInstallmentAmount(fromHalalas(total - vat)),
              )}
              {row.note && <span className="block">{row.note}</span>}
            </>
          }
          // Paid: the day it was paid, its planned day is past use.
          date={paid ? (paidOn ?? date) : date}
          late={running && !paid && days !== null && days < 0}
          amountLabel={t('instFpDue')}
          amount={amountOf(row.amount)}
          remaining={partial ? scheduleRemaining(row) : undefined}
          badges={
            running ? (
              <>
                {paid ? (
                  <Badge size="sm" tone="success">
                    {t('instFpPaid')}
                  </Badge>
                ) : withLast && (days === null || days >= 0) ? (
                  <Badge size="sm" tone="info">
                    {t('instWithLast')}
                  </Badge>
                ) : days === null ? (
                  <Badge size="sm" tone="warning">
                    {t('instFpWaitsDate')}
                  </Badge>
                ) : (
                  <WhenBadge days={days} />
                )}
                {partial && (
                  <Badge size="sm" tone="info">
                    {t('instPartlyPaid')}
                  </Badge>
                )}
              </>
            ) : undefined
          }
          actions={
            canAct && !paid ? (
              <>
                <Button size="sm" variant="outline" onClick={() => onPay(row)}>
                  {t('instPayRow')}
                </Button>
                {!date && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSetDate(row)}
                  >
                    {t('instSetDate')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </ul>
    </Card>
  )
}
