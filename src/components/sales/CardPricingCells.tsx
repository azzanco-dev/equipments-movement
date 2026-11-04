import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'
import { SalePrice } from '@/components/sales/SalePrice'
import { useI18n } from '@/i18n/I18nContext'
import { formatDateTime } from '@/lib/dateFormat'
import { formatSupplierPoPrice } from '@/lib/purchasing'
import {
  CARD_PRICING_STATUS_BADGE,
  cardMarginBlocker,
  formatMarginPct,
  type CardPricingStatus,
} from '@/lib/sales'

/**
 * The pricing status of a «كرت المعدة» (migration 0174): «مسودة» neutral,
 * «معتمد» success; with `approvedBy` / `approvedAt` the approver and the
 * day under it (the list) or as the badge's title (compact).
 */
export function CardPricingStatusBadge({
  status,
  approvedBy,
  approvedAt,
  size = 'sm',
  compact = false,
}: {
  status: CardPricingStatus
  approvedBy?: string | null
  approvedAt?: string | null
  size?: BadgeSize
  compact?: boolean
}) {
  const { t } = useI18n()
  const badge = CARD_PRICING_STATUS_BADGE[status]
  const when = approvedAt ? formatDateTime(approvedAt, false) : null
  const meta =
    status === 'approved' && (approvedBy || when)
      ? [approvedBy, when].filter(Boolean).join(' · ')
      : null
  if (compact || !meta)
    return (
      <Tooltip content={meta} disabled={!meta}>
        <span className="inline-flex">
          <Badge tone={badge.tone} size={size}>
            {t(badge.key)}
          </Badge>
        </span>
      </Tooltip>
    )
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge tone={badge.tone} size={size}>
        {t(badge.key)}
      </Badge>
      <span className="text-xs text-muted">
        <bdi dir="auto">{meta}</bdi>
      </span>
    </span>
  )
}

/**
 * The margin of a card: the amount with «/ شهر» and the percentage under
 * it, or «—» with the reason it has no value (a missing price, or a daily
 * supplier line, which has no rule yet). The figures are the view's or the
 * live mirror of them (`cardMargin` / `cardMarginPct`).
 */
export function CardMarginCell({
  margin,
  pct,
  clientPrice,
  supplierPrice,
  supplierRateUnit,
  alignEnd = true,
}: {
  margin: number | string | null | undefined
  pct: number | string | null | undefined
  clientPrice: number | string | null | undefined
  supplierPrice: number | string | null | undefined
  supplierRateUnit: string | null | undefined
  alignEnd?: boolean
}) {
  const { t } = useI18n()
  const align = alignEnd ? 'items-end text-end' : 'items-start text-start'
  if (margin === null || margin === undefined) {
    const blocker = cardMarginBlocker({
      clientPrice,
      supplierPrice,
      supplierRateUnit,
    })
    return (
      <span className={`flex flex-col ${align}`}>
        <span className="text-muted">—</span>
        {blocker === 'daily' && (
          <span className="text-xs text-muted">
            {t('cardPriceMarginDailyHint')}
          </span>
        )}
        {blocker === 'no_supplier_price' && (
          <span className="text-xs text-muted">{t('cardMonthNeedsPrice')}</span>
        )}
      </span>
    )
  }
  const negative = Number(margin) < 0
  return (
    <span className={`flex flex-col ${align}`}>
      <SalePrice
        value={margin}
        unit="month"
        className={negative ? 'text-danger' : undefined}
      />
      <span className="text-xs text-muted">
        <bdi dir="ltr" className="tabular-nums">
          {formatMarginPct(pct)}
        </bdi>
      </span>
    </span>
  )
}

/** The margin percentage alone («36.4%»), or a dash. */
export function CardMarginPctCell({
  pct,
}: {
  pct: number | string | null | undefined
}) {
  if (pct === null || pct === undefined)
    return <span className="text-muted">—</span>
  return (
    <bdi
      dir="ltr"
      className={`tabular-nums ${Number(pct) < 0 ? 'text-danger' : ''}`}
    >
      {formatMarginPct(pct)}
    </bdi>
  )
}

/** The supplier price of a card with its unit, «تحتاج سعر» while NULL. */
export function CardSupplierPriceCell({
  price,
  rateUnit,
}: {
  price: number | string | null | undefined
  rateUnit: string | null | undefined
}) {
  const { t } = useI18n()
  if (price === null || price === undefined)
    return (
      <Badge tone="warning" size="sm">
        {t('cardMonthNeedsPrice')}
      </Badge>
    )
  return (
    <SalePrice
      value={formatSupplierPoPrice(price) === '—' ? null : price}
      unit={rateUnit === 'day' ? 'day' : 'month'}
    />
  )
}
