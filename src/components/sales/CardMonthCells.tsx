import { SalePrice } from '@/components/sales/SalePrice'
import { Badge } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  CARD_MONTH_STATE_BADGE,
  SALE_RATE_UNIT_LABEL_KEYS,
  formatHours,
  type CardMonthDue,
  type CardMonthState,
  type SaleRateUnit,
} from '@/lib/sales'

/** Which side of a month a due cell shows. */
export type CardMonthDueSide = 'client' | 'supplier' | 'margin'

/**
 * A month's amount of one side, or why there is none (the approved mockup):
 * «تحتاج سعر» for an unpriced line, «—» with its hint for a daily line (no
 * rule yet; the margin's dash is explained by the side beside it), the side's
 * «بدون PO …» without a line, a muted dash otherwise (no hours, the supplier
 * side of an owned unit).
 */
export function CardMonthDueCell({
  due,
  side,
  alignEnd = true,
}: {
  due: CardMonthDue
  side: CardMonthDueSide
  alignEnd?: boolean
}) {
  const { t } = useI18n()
  if (due.value !== null) return <SalePrice value={due.value} />
  const dash = <span className="text-muted">—</span>
  switch (due.blocker) {
    case 'unpriced':
      return (
        <span className="text-xs font-medium text-warning">
          {t('cardMonthNeedsPrice')}
        </span>
      )
    case 'no_line':
      if (side === 'margin') return dash
      return (
        <span className="text-xs text-muted">
          {t(
            side === 'client'
              ? 'equipmentCardNoClientPo'
              : 'equipmentCardNoSupplierPo',
          )}
        </span>
      )
    case 'daily':
      if (side === 'margin') return dash
      return (
        <span
          className={`inline-flex flex-col ${alignEnd ? 'items-end text-end' : 'items-start text-start'}`}
        >
          {dash}
          <span className="text-[11px] leading-4 text-muted">
            {t('cardMonthDailyHint')}
          </span>
        </span>
      )
    case 'owned':
      return (
        <span className="text-xs text-muted">{t('equipmentCardOwned')}</span>
      )
    default:
      return dash
  }
}

/** «مسجل» (green) / «بانتظار» (amber) / «جاري» (blue). */
export function CardMonthStateBadge({
  state,
  size = 'sm',
}: {
  state: CardMonthState
  size?: 'sm' | 'md'
}) {
  const { t } = useI18n()
  const badge = CARD_MONTH_STATE_BADGE[state]
  return (
    <Badge tone={badge.tone} size={size}>
      {t(badge.key)}
    </Badge>
  )
}

/** A total per price unit in the batch screen's bottom bar: the unit's name
 *  before the amount only when the rows mix units (a month and an hour are
 *  never added); a dash while nothing is filled. */
export function CardMonthDueTotal({
  label,
  parts,
  className,
}: {
  label: string
  parts: readonly { unit: SaleRateUnit; total: number }[]
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <span className="text-[11px] leading-4 text-muted">{label}</span>
      <span className="flex flex-col text-sm font-semibold">
        {parts.length === 0 && <span className="text-muted">—</span>}
        {parts.map((part) => (
          <span key={part.unit} className="inline-flex items-baseline gap-1.5">
            {parts.length > 1 && (
              <span className="text-[11px] font-normal text-muted">
                {t(SALE_RATE_UNIT_LABEL_KEYS[part.unit])}
              </span>
            )}
            <SalePrice value={part.total} />
          </span>
        ))}
      </span>
    </div>
  )
}

/** «1,560 ساعة» as a figure, or a dash when there is no total (a daily line,
 *  whose rule comes later, or no quantity). */
export function HoursFigure({
  hours,
  strong = true,
}: {
  hours: number | null
  strong?: boolean
}) {
  const { t } = useI18n()
  if (hours === null) return <span className="text-muted">—</span>
  return (
    <>
      <bdi
        dir="ltr"
        className={`tabular-nums ${strong ? 'font-medium text-fg' : ''}`}
      >
        {formatHours(hours)}
      </bdi>{' '}
      {t('cardMonthHoursUnit')}
    </>
  )
}
