import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, RiyalSign, cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  formatInstallmentAmount,
  INSTALLMENT_CONTRACT_STATUS_BADGE,
  INSTALLMENT_STATE_BADGE,
  type InstallmentContractStatus,
  type InstallmentState,
} from '@/lib/installments'
import {
  parseInstallmentAmount,
  unitsWords,
  whenWords,
  type InstallmentUnit,
} from '@/lib/installmentsView'

/**
 * The small shared pieces of the «الاقساط» screens, as the owner approved
 * them on /ui-kit (2026-11-18): the amount with the riyal sign, the state
 * and status badges, the unit tags, the paid progress bar, the contract and
 * due-date cells of the tables.
 */

/** An amount with the official riyal symbol after it. */
export function Money({
  value,
  className,
}: {
  value: number | string | null | undefined
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        // `relative` keeps the absolutely placed sr-only text inside a scrolling
        // table; without it the text escapes the scroll box and widens the page.
        'relative inline-flex items-baseline gap-1 whitespace-nowrap',
        className,
      )}
    >
      <bdi dir="ltr" className="tabular-nums">
        {formatInstallmentAmount(value)}
      </bdi>
      <RiyalSign className="text-muted" size="0.8em" />
      <span className="sr-only">{t('instRiyal')}</span>
    </span>
  )
}

/** The badge size: `sm` in the list tables (the main list look), `md` on
 *  the contract page. */
type CellBadgeSize = 'sm' | 'md'

export function InstallmentStateBadge({
  state,
  partial,
  size = 'md',
}: {
  state: InstallmentState
  partial?: boolean
  size?: CellBadgeSize
}) {
  const { t } = useI18n()
  const badge = INSTALLMENT_STATE_BADGE[state]
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge size={size} tone={badge.tone}>
        {t(badge.key)}
      </Badge>
      {partial && state !== 'paid' && (
        <Badge size={size} tone="info">
          {t('instPartlyPaid')}
        </Badge>
      )}
    </span>
  )
}

export function InstallmentContractStatusBadge({
  status,
  size = 'md',
}: {
  status: InstallmentContractStatus
  size?: CellBadgeSize
}) {
  const { t } = useI18n()
  const badge = INSTALLMENT_CONTRACT_STATUS_BADGE[status]
  return (
    <Badge size={size} tone={badge.tone}>
      {t(badge.key)}
    </Badge>
  )
}

/** «2 متاخر»: only an ACTIVE contract is late (the view counts the old
 *  rows of a closed one too, so the caller passes 0 for it). */
export function OverdueBadge({
  count,
  size = 'md',
}: {
  count: number
  size?: CellBadgeSize
}) {
  const { t } = useI18n()
  if (count <= 0) return null
  return (
    <Badge size={size} tone="danger" icon={<AlertTriangle size={12} />}>
      {t('instOverdueCount').replace('{count}', String(count))}
    </Badge>
  )
}

function UnitTag({ unit }: { unit: InstallmentUnit }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-xs">
      <bdi dir="ltr" className="font-semibold">
        {unit.code}
      </bdi>
      {unit.type && <span className="text-muted">{unit.type}</span>}
    </span>
  )
}

/**
 * The linked units as tags; «بدون» for a contract tied to no unit. `count`
 * is the contract's own unit count: the units this reader may not see (or
 * that the bounded read did not reach) show as «+N», and with none readable
 * the count alone.
 */
export function UnitTags({
  units,
  count,
  max = 2,
}: {
  units: readonly InstallmentUnit[]
  count: number
  max?: number
}) {
  const { t, lang } = useI18n()
  const readable = units.filter((unit) => unit.code)
  const total = Math.max(count, units.length)
  if (total === 0) return <span className="text-muted">{t('instNone')}</span>
  if (readable.length === 0)
    return <span className="text-muted">{unitsWords(total, lang)}</span>
  const shown = readable.slice(0, max)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((unit) => (
        <UnitTag key={unit.equipment_id} unit={unit} />
      ))}
      {total > shown.length && (
        <span className="text-xs text-muted">+{total - shown.length}</span>
      )}
    </span>
  )
}

/** Paid out of financed, as a thin bar with its numbers. */
export function PaidProgress({
  percent,
  paidCount,
  rowCount,
}: {
  percent: number
  paidCount: number
  rowCount: number
}) {
  const { t } = useI18n()
  return (
    <div className="min-w-[120px] space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('instPaid')}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${percent}%`,
            backgroundColor: 'var(--success)',
          }}
        />
      </div>
      <p className="flex justify-between gap-2 text-xs text-muted">
        <bdi dir="ltr" className="tabular-nums">
          {paidCount}/{rowCount}
        </bdi>
        <bdi dir="ltr" className="tabular-nums">
          {percent}%
        </bdi>
      </p>
    </div>
  )
}

/** First and last due day as «28/11/2026 الى 28/10/2027»: each date an LTR
 *  run, the word between them in the interface direction. */
export function PeriodRange({ from, to }: { from: string; to: string | null }) {
  const { t } = useI18n()
  return (
    <span>
      <bdi dir="ltr">{formatDate(from)}</bdi> {t('instTo')}{' '}
      <bdi dir="ltr">{to ? formatDate(to) : '—'}</bdi>
    </span>
  )
}

/** A contract in a table cell: the title in bold, the number under it. */
export function ContractCell({
  description,
  contractNumber,
  financierName,
}: {
  description: string
  contractNumber: string
  /** Shown after the number when given. */
  financierName?: string
}) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span
        className="block max-w-[16rem] truncate-safe font-semibold"
        title={description}
      >
        {description}
      </span>
      <span className="text-xs text-muted">
        <bdi dir="ltr">{contractNumber}</bdi>
        {financierName && <> · {financierName}</>}
      </span>
    </span>
  )
}

/** The due day with how far it is: late in red, today in amber. */
export function DueDateCell({
  dueDate,
  days,
}: {
  dueDate: string
  /** Negative = days overdue. */
  days: number
}) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <bdi dir="ltr" className={cn('font-medium', days < 0 && 'text-danger')}>
        {formatDate(dueDate)}
      </bdi>
      <WhenBadge days={days} />
    </span>
  )
}

/** «باقي 5 ايام» / «اليوم» / «متاخر 3 ايام» as a small badge: red when late,
 *  amber today, neutral ahead (owner 2026-11-19, «باقي x يوم خليه بادج»). */
export function WhenBadge({ days }: { days: number }) {
  const { lang } = useI18n()
  return (
    <Badge
      size="sm"
      tone={days < 0 ? 'danger' : days === 0 ? 'warning' : 'neutral'}
    >
      {whenWords(days, lang)}
    </Badge>
  )
}

/** A small labelled figure of a dialog (the schedule preview, the payment
 *  summary). */
export function PreviewStat({
  label,
  value,
}: {
  label: ReactNode
  value: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-bg p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

/** The typed amount as it will read, under its field. */
export function AmountHint({ value }: { value: string }) {
  const amount = parseInstallmentAmount(value)
  if (amount === null || amount === 0) return null
  return <Money value={amount} className="font-semibold text-fg" />
}

/** A field label marked «(اختياري)». */
export function OptionalLabel({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <span>
      {text}{' '}
      <span className="text-xs font-normal text-muted">
        ({t('instOptional')})
      </span>
    </span>
  )
}
