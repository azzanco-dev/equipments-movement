import { RiyalSign } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatSupplierPoPrice, isValidSupplierPoPrice } from '@/lib/purchasing'

/**
 * An amount excluding VAT with the official riyal symbol after it (owner
 * 2026-10-19). The digits stay an LTR run with tabular figures; the currency
 * is named for screen readers.
 */
export function Price({
  value,
  className,
}: {
  value: number | string | null | undefined
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex items-baseline gap-1 whitespace-nowrap ${className ?? ''}`}
    >
      <bdi dir="ltr" className="tabular-nums">
        {formatSupplierPoPrice(value)}
      </bdi>
      <RiyalSign className="text-muted" size="0.8em" />
      <span className="sr-only">{t('currencySar')}</span>
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
