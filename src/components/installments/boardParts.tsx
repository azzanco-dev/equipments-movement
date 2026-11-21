import type { ReactNode } from 'react'
import { Building2, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { AppLink, Badge, Button, cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  contractCardState,
  contractPaidPercent,
  currentSeq,
  type ContractCardState,
} from '@/lib/installmentsBoard'
import type { InstallmentContractRow } from '@/lib/installmentsView'
import { Money, WhenBadge } from './cells'

/**
 * The visual pieces of the unified installments page (owner 2026-11-21, the
 * Figma frames «الاقساط / الصفحة الموحدة»): the tinted figure cards of
 * design 1, the contract card with its ring of design 4 and the coloured
 * financier tile. Colours come from the tokens only.
 */

export type BoardTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral'

const TONE_CLASS: Record<BoardTone, { box: string; ink: string }> = {
  danger: { box: 'bg-danger-soft', ink: 'text-danger' },
  warning: { box: 'bg-warning-soft', ink: 'text-warning' },
  info: { box: 'bg-info-soft', ink: 'text-info' },
  success: { box: 'bg-success-soft', ink: 'text-success' },
  neutral: { box: 'border bg-surface', ink: 'text-fg' },
}

export const toneInk = (tone: BoardTone) => TONE_CLASS[tone].ink
export const toneBox = (tone: BoardTone) => TONE_CLASS[tone].box

/** A tinted figure card (design 1): the icon in a white tile, the title and
 *  its count in the tone, the amount large, a muted line under it. */
export function FigureCard({
  tone,
  icon,
  title,
  sub,
  value,
  foot,
}: {
  tone: BoardTone
  icon: ReactNode
  title: ReactNode
  sub?: ReactNode
  value: ReactNode
  foot?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl p-4',
        toneBox(tone),
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg',
            toneInk(tone),
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', toneInk(tone))}>{title}</p>
          {sub && <p className={cn('text-xs', toneInk(tone))}>{sub}</p>}
        </div>
      </div>
      {/* Smaller while four cards share a row (xl), so «33,941,332.19» fits. */}
      <div className="whitespace-nowrap text-xl font-bold tabular-nums xl:text-lg 2xl:text-xl">
        {value}
      </div>
      {foot && <p className="text-xs text-muted">{foot}</p>}
    </div>
  )
}

/** A financier's coloured tile with the building icon (`tone` 1…6). */
export function FinancierTile({
  tone,
  size = 32,
}: {
  tone: number
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{
        width: size,
        height: size,
        backgroundColor: `var(--chart-${tone})`,
        color: `var(--chart-stroke-${tone})`,
      }}
    >
      <Building2 size={Math.round(size / 2)} />
    </span>
  )
}

/** A ring of the share paid, the percent in the middle. */
export function ProgressRing({
  percent,
  tone = 'success',
  size = 52,
  stroke = 5,
  label,
}: {
  percent: number
  tone?: 'success' | 'danger' | 'warning'
  size?: number
  stroke?: number
  label?: ReactNode
}) {
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  const shown = Math.max(0, Math.min(100, percent))
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${shown}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: 'var(--surface-hover)' }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - shown / 100)}
          style={{ stroke: `var(--${tone})` }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label ?? (
          <bdi dir="ltr" className="text-xs font-bold tabular-nums">
            {shown}%
          </bdi>
        )}
      </span>
    </span>
  )
}

const STATE_BADGE: Record<
  ContractCardState,
  {
    key:
      | 'instCardActive'
      | 'instCardOverdue'
      | 'instCardPaidOff'
      | 'instCardCancelled'
    tone: 'success' | 'danger' | 'info' | 'neutral'
  }
> = {
  active: { key: 'instCardActive', tone: 'success' },
  overdue: { key: 'instCardOverdue', tone: 'danger' },
  paid_off: { key: 'instCardPaidOff', tone: 'info' },
  cancelled: { key: 'instCardCancelled', tone: 'neutral' },
}

/** The installment a card points at: its day, amount and days left. */
export interface CardDue {
  date: string
  amount: number
  /** Negative = days late. */
  days: number
}

/**
 * The contract card of design 4: the financier with its tile and the state
 * badge, the title and the number beside the ring of the share paid, «المتبقي»
 * with «القسط N من M» and a bar, the box of the installment it points at
 * (red when late), then «فتح العقد» and «تسديد». The dashboard points it at
 * the installment due within 7 days; the contracts tab at the next one.
 */
export function ContractCard({
  contract,
  due,
  tone,
  canPay,
  onPay,
}: {
  contract: InstallmentContractRow
  due: CardDue | null
  /** The financier's colour, 1…6. */
  tone: number
  canPay: boolean
  onPay: () => void
}) {
  const { t, dir } = useI18n()
  const state = contractCardState(contract)
  const late = state === 'overdue'
  const percent = contractPaidPercent(contract)
  const badge = STATE_BADGE[state]
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border bg-bg p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <FinancierTile tone={tone} size={28} />
          <span className="truncate">{contract.financier_name}</span>
        </span>
        <Badge size="sm" tone={badge.tone}>
          {t(badge.key)}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <AppLink
            href={`/installments/${contract.id}`}
            className="block truncate-safe text-sm font-bold hover:underline"
            title={contract.description}
          >
            {contract.description}
          </AppLink>
          <bdi dir="ltr" className="text-xs text-muted">
            {contract.contract_number}
          </bdi>
        </div>
        <ProgressRing percent={percent} tone={late ? 'danger' : 'success'} />
      </div>
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-muted">{t('instRemaining')}</p>
            <Money
              value={contract.remaining_total}
              className="text-lg font-bold"
            />
          </div>
          <p className="text-xs text-muted">
            {t('instCardSeqOf')
              .replace('{seq}', String(currentSeq(contract)))
              .replace('{count}', String(contract.installment_count))}
          </p>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${percent}%`,
              backgroundColor: late ? 'var(--danger)' : 'var(--success)',
            }}
          />
        </div>
      </div>
      {due && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded-lg p-2.5',
            late ? 'bg-danger-soft' : 'bg-surface',
          )}
        >
          <div className="min-w-0">
            <p className="text-xs text-muted">{t('instCardNextDue')}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <bdi dir="ltr">{formatDate(due.date)}</bdi>
              <WhenBadge days={due.days} />
            </p>
          </div>
          <Money
            value={due.amount}
            className={cn('text-sm font-bold', late && 'text-danger')}
          />
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <AppLink
          href={`/installments/${contract.id}`}
          className="inline-flex items-center gap-1 text-sm hover:underline"
        >
          {t('instCardOpen')}
          <Chevron size={14} aria-hidden="true" />
        </AppLink>
        {canPay && contract.status === 'active' && (
          <Button
            size="sm"
            variant={late ? 'primary' : 'outline'}
            icon={<Check size={14} aria-hidden="true" />}
            onClick={onPay}
          >
            {t('instPayRow')}
          </Button>
        )}
      </div>
    </article>
  )
}
