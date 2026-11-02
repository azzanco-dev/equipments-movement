import { RiyalSign } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatSupplierPoPrice } from '@/lib/purchasing'
import {
  isValidSalePrice,
  SALE_PER_UNIT_KEYS,
  type SaleRateUnit,
} from '@/lib/sales'

/**
 * A sale amount excluding VAT with the official riyal symbol after it and
 * the price unit after that («/ شهر», «/ يوم», «/ ساعة»): the purchasing
 * `Price` with the client side's third unit. The digits stay an LTR run
 * with tabular figures; the currency is named for screen readers.
 */
export function SalePrice({
  value,
  unit,
  className,
}: {
  value: number | string | null | undefined
  unit?: SaleRateUnit | null
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-1 ${className ?? ''}`}
    >
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <bdi dir="ltr" className="tabular-nums">
          {formatSupplierPoPrice(value)}
        </bdi>
        <RiyalSign className="text-muted" size="0.8em" />
        <span className="sr-only">{t('currencySar')}</span>
      </span>
      {unit && (
        <span className="whitespace-nowrap text-[0.75em] font-normal text-muted">
          {t(SALE_PER_UNIT_KEYS[unit])}
        </span>
      )}
    </span>
  )
}

/**
 * Amounts per unit stacked (a monthly, a daily and an hourly total are never
 * added together), each with its unit; `amount` turns a part's total into
 * the figure shown (the VAT, the total with VAT).
 */
export function SalePricesByUnit({
  parts,
  amount = (total) => total,
  alignEnd = false,
  className,
}: {
  parts: readonly { unit: SaleRateUnit; total: number }[]
  amount?: (total: number) => number
  alignEnd?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex flex-col gap-0.5 ${alignEnd ? 'items-end' : 'items-start'}`}
    >
      {parts.map((part) => (
        <SalePrice
          key={part.unit}
          value={amount(part.total)}
          unit={part.unit}
          className={className}
        />
      ))}
    </span>
  )
}

/** The hint under a price field while typing: the formatted amount, or
 *  nothing while the value is not a price yet. */
export function SalePricePreview({ value }: { value: string }) {
  if (!isValidSalePrice(value)) return null
  return (
    <SalePrice value={Number(value.trim())} className="font-semibold text-fg" />
  )
}

/** An amount, or a muted dash without one. */
export function SaleAmountOrDash({
  value,
  unit,
}: {
  value: number | string | null | undefined
  unit?: SaleRateUnit | null
}) {
  if (value === null || value === undefined)
    return <span className="text-muted">—</span>
  return <SalePrice value={value} unit={unit} />
}
