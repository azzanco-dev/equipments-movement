import { RiyalSign } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  formatSupplierPoPrice,
  isValidSupplierPoPrice,
  SUPPLIER_PO_PER_UNIT_KEYS,
  type SupplierPoRateUnit,
} from '@/lib/purchasing'

/**
 * An amount excluding VAT with the official riyal symbol after it (owner
 * 2026-10-19). The digits stay an LTR run with tabular figures; the currency
 * is named for screen readers.
 */
export function Price({
  value,
  unit,
  className,
}: {
  value: number | string | null | undefined
  /** 0157: the price unit, shown after the currency («/ شهر», «/ يوم»). */
  unit?: SupplierPoRateUnit
  className?: string
}) {
  const { t } = useI18n()
  // The amount and the riyal never break apart; the unit drops under them
  // when a narrow box (a stat card on a phone) has no room for it.
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
          {t(SUPPLIER_PO_PER_UNIT_KEYS[unit])}
        </span>
      )}
    </span>
  )
}

/**
 * Amounts per unit stacked (owner 2026-10-28: a monthly and a daily total
 * are never added together), each with its unit; `amount` turns a part's
 * total into the figure shown (the VAT, the total with VAT).
 */
export function PricesByUnit({
  parts,
  amount = (total) => total,
  alignEnd = false,
  className,
}: {
  parts: readonly { unit: SupplierPoRateUnit; total: number }[]
  amount?: (total: number) => number
  /** Lines the stacked amounts up at the end side (a receipt's column). */
  alignEnd?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex flex-col gap-0.5 ${alignEnd ? 'items-end' : 'items-start'}`}
    >
      {parts.map((part) => (
        <Price
          key={part.unit}
          value={amount(part.total)}
          unit={part.unit}
          className={className}
        />
      ))}
    </span>
  )
}

/**
 * The hint under a price field while typing (owner 2026-10-19): the amount
 * as it will be shown, with thousands separators and the currency, so a long
 * number stays readable; nothing while the value is not a price yet (the
 * validation message covers that on submit).
 */
export function PricePreview({ value }: { value: string }) {
  if (!isValidSupplierPoPrice(value)) return null
  // Bold (owner 2026-10-20), so the formatted amount stands out from the hint.
  return <Price value={Number(value.trim())} className="font-semibold text-fg" />
}
