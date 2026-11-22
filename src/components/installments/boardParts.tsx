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
import {
  payableRowLabel,
  installmentsWords,
  type InstallmentContractRow,
  type InstallmentRowKind,
} from '@/lib/installmentsView'
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
        'flex min-w-0 flex-col gap-1.5 rounded-xl p-3',
        toneBox(tone),
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md bg-bg [&>svg]:size-4',
            toneInk(tone),
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold', toneInk(tone))}>{title}</p>
          {sub && <p className={cn('text-[11px]', toneInk(tone))}>{sub}</p>}
        </div>
      </div>
      <div className="whitespace-nowrap text-base font-bold tabular-nums">
        {value}
      </div>
      {foot && <p className="text-[11px] text-muted">{foot}</p>}
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
      | 'instAwaitingShort'
    tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  }
> = {
  active: { key: 'instCardActive', tone: 'success' },
  overdue: { key: 'instCardOverdue', tone: 'danger' },
  awaiting: { key: 'instAwaitingShort', tone: 'warning' },
  paid_off: { key: 'instCardPaidOff', tone: 'info' },
  cancelled: { key: 'instCardCancelled', tone: 'neutral' },
}

/** The payable row a card points at: what it is, its day, amount, days. */
export interface CardDue {
  date: string
  amount: number
  /** Negative = days late. */
  days: number
  /** 0209: what the row is; a first payment has its name. */
  kind: InstallmentRowKind
  title: string | null
  seq: number
}

/**
 * The contract card of design 4: the financier with its tile and the state
 * badge, the title and the number beside the ring of the share paid with
 * «القسط N من M» under it (owner 2026-11-22: the ring alone, no bar), the
 * box of the installment it points at (red when late), «فتح العقد» and
 * «تسديد», and «المتبقي» last, at the foot. The dashboard points it at
 * the installment due within 7 days; the contracts tab at the next one.
 * Since 0209 the row may be a first payment or the VAT, and a contract
 * waiting for its first due date says so and offers «تحديد التاريخ».
 */
export function ContractCard({
  contract,
  due,
  tone,
  canPay,
  onPay,
  onSetFirstDue,
}: {
  contract: InstallmentContractRow
  due: CardDue | null
  /** The financier's colour, 1…6. */
  tone: number
  canPay: boolean
  onPay: () => void
  /** The card of a waiting contract without a dated row. */
  onSetFirstDue?: () => void
}) {
  const { t, dir, lang } = useI18n()
  const state = contractCardState(contract)
  const late = state === 'overdue'
  const percent = contractPaidPercent(contract)
  const badge = STATE_BADGE[state]
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight
  const waiting = contract.status === 'active' && !contract.first_due_date
  const payments = contract.first_payments_count
  const paidPayments = contract.first_payments_paid_count
  const place =
    due?.kind === 'first_payment'
      ? t('instFpSeqOf')
          .replace('{seq}', String(due.seq))
          .replace('{count}', String(payments))
      : due?.kind === 'vat'
        ? t('instVatPayment')
        : waiting
          ? paidPayments === 0
            ? t('instNotDivided').replace(
                '{installments}',
                installmentsWords(contract.installment_count, lang),
              )
            : payments === 1
              ? t('instFpOneSettled')
              : t('instFpPaidOf')
                  .replace('{paid}', String(paidPayments))
                  .replace('{count}', String(payments))
          : t('instCardSeqOf')
              .replace('{seq}', String(currentSeq(contract)))
              .replace('{count}', String(contract.installment_count))
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border bg-bg p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
          <FinancierTile tone={tone} size={24} />
          <span className="truncate">{contract.financier_name}</span>
        </span>
        <Badge size="sm" tone={badge.tone}>
          {t(badge.key)}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <AppLink
            href={`/installments/${contract.id}`}
            className="block truncate-safe text-[13px] font-bold hover:underline"
            title={contract.description}
          >
            {contract.description}
          </AppLink>
          <bdi dir="ltr" className="text-[11px] text-muted">
            {contract.contract_number}
          </bdi>
        </div>
        <div className="flex max-w-32 shrink-0 flex-col items-center gap-1">
          <ProgressRing
            percent={percent}
            tone={late ? 'danger' : 'success'}
            size={48}
          />
          <p
            className={cn(
              'text-center text-[11px] leading-tight [text-wrap:balance]',
              waiting && !due && paidPayments > 0
                ? 'text-success'
                : 'text-muted',
            )}
          >
            {place}
          </p>
        </div>
      </div>
      {due && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded-lg px-2.5 py-2',
            late ? 'bg-danger-soft' : 'bg-surface',
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted">
              {due.kind === 'installment'
                ? t('instCardNextDue')
                : payableRowLabel(due, t)}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
              <bdi dir="ltr">{formatDate(due.date)}</bdi>
              <WhenBadge days={due.days} />
            </p>
          </div>
          <Money
            value={due.amount}
            className={cn('text-[13px] font-bold', late && 'text-danger')}
          />
        </div>
      )}
      {!due && waiting && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-warning-soft px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">{t('instFirstDueDate')}</p>
            <p className="text-xs font-medium text-warning">
              {t('instFpNoDate')}
            </p>
          </div>
          <Money
            value={contract.installments_amount}
            className="text-[13px] font-bold"
          />
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <AppLink
          href={`/installments/${contract.id}`}
          className="inline-flex items-center gap-1 text-xs hover:underline"
        >
          {t('instCardOpen')}
          <Chevron size={14} aria-hidden="true" />
        </AppLink>
        {canPay && waiting && !due && onSetFirstDue ? (
          <Button size="sm" variant="outline" onClick={onSetFirstDue}>
            {t('instSetDate')}
          </Button>
        ) : canPay && contract.status === 'active' ? (
          <Button
            size="sm"
            variant={late ? 'primary' : 'outline'}
            icon={<Check size={14} aria-hidden="true" />}
            onClick={onPay}
          >
            {t('instPayRow')}
          </Button>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-2 border-t pt-2">
        <span className="text-[11px] text-muted">{t('instRemaining')}</span>
        <Money
          value={contract.remaining_total}
          className="text-[15px] font-bold"
        />
      </div>
    </article>
  )
}
