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
  isSaleRateUnit,
  SALE_RATE_UNIT_LABEL_KEYS,
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
 * The margin of a card: the amount and the percentage under it, or «—» with
 * the reason it has no value (a missing price, or — 0185 — a client price
 * and a supplier price in two different units, «وحدتان مختلفتان»). The
 * figures are the view's or the live mirror of them (`cardMargin` /
 * `cardMarginPct`). No unit beside the amount (owner 2026-11-04, «شيل اي
 * كلمة شهر جنب الارقام»): the margin is in the unit both prices share, and
 * a price in another unit than the month carries its own mark («(يومي)»).
 */
export function CardMarginCell({
  margin,
  pct,
  clientPrice,
  clientRateUnit,
  supplierPrice,
  supplierRateUnit,
  alignEnd = true,
}: {
  margin: number | string | null | undefined
  pct: number | string | null | undefined
  clientPrice: number | string | null | undefined
  clientRateUnit: string | null | undefined
  supplierPrice: number | string | null | undefined
  supplierRateUnit: string | null | undefined
  alignEnd?: boolean
}) {
  const { t } = useI18n()
  const align = alignEnd ? 'items-end text-end' : 'items-start text-start'
  if (margin === null || margin === undefined) {
    const blocker = cardMarginBlocker({
      clientPrice,
      clientRateUnit,
      supplierPrice,
      supplierRateUnit,
    })
    return (
      <span className={`flex flex-col ${align}`}>
        <span className="text-muted">—</span>
        {blocker === 'units_differ' && (
          <span className="text-xs text-muted">
            {t('cardPriceMarginUnitsDiffer')}
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

/**
 * A price of a card (the supplier's, or the client's when read-only),
 * «تحتاج سعر» while NULL. No «/ شهر» beside the amount (owner 2026-11-04): a
 * monthly price is the rule here, and a price in another unit (0185: week,
 * day, hour) is marked «(اسبوعي)» / «(يومي)» / «(بالساعة)» after it.
 */
export function CardSupplierPriceCell({
  price,
  rateUnit,
  className,
}: {
  price: number | string | null | undefined
  rateUnit: string | null | undefined
  className?: string
}) {
  const { t } = useI18n()
  if (price === null || price === undefined)
    return (
      <Badge tone="warning" size="sm">
        {t('cardMonthNeedsPrice')}
      </Badge>
    )
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <SalePrice
        value={formatSupplierPoPrice(price) === '—' ? null : price}
        className={className}
      />
      {isSaleRateUnit(rateUnit) && rateUnit !== 'month' && (
        <span className="text-xs text-muted">
          ({t(SALE_RATE_UNIT_LABEL_KEYS[rateUnit])})
        </span>
      )}
    </span>
  )
}
