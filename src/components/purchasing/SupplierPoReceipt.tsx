import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { vatOf, withVat } from '@/lib/purchasing'
import { Price } from './Price'

/** One row: the label, a dotted leader filling the gap, the amount. */
function ReceiptLine({
  label,
  hint,
  value,
  className,
}: {
  label: ReactNode
  hint?: string
  value: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-baseline gap-2 ${className ?? ''}`}>
      <dt className="shrink-0">
        {label}
        {hint && <span className="ms-1 font-normal text-muted">({hint})</span>}
      </dt>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 -translate-y-0.5 border-b border-dotted border-border"
      />
      <dd className="m-0 shrink-0">{value}</dd>
    </div>
  )
}

/**
 * «خلاصة الامر» (owner 2026-10-24, taken from the «هوية+» mockup of
 * app/po-test and rebuilt in the project tokens): the lines' subtotal
 * excluding VAT, the VAT, and the total with VAT under a strong rule, joined
 * to their amounts by dotted leaders. Closes the PO's line list.
 */
export function SupplierPoReceipt({
  count,
  unpriced,
  total,
}: {
  count: number
  unpriced: number
  /** The lines' sum excluding VAT (unpriced lines count as nothing). */
  total: number
}) {
  const { t } = useI18n()
  return (
    <section
      aria-label={t('supplierPoReceipt')}
      className="w-full rounded-xl border bg-surface p-3 sm:w-72"
    >
      <h3 className="mb-2.5 text-[11px] text-muted">{t('supplierPoReceipt')}</h3>
      <dl className="m-0 space-y-2.5 text-xs text-muted">
        <ReceiptLine
          label={`${t('supplierPoReceiptLines')} (${count})`}
          hint={unpriced > 0 ? `${unpriced} ${t('supplierPoUnpricedTotalNote')}` : undefined}
          value={<Price value={total} className="text-fg" />}
        />
        <ReceiptLine
          label={t('supplierPoSummaryVat')}
          value={<Price value={vatOf(total)} className="text-fg" />}
        />
        <ReceiptLine
          className="mt-3 border-t-2 border-fg pt-2.5 text-sm font-semibold text-fg"
          label={t('supplierPoSummaryTotalWithVat')}
          value={<Price value={withVat(total)} className="text-base" />}
        />
      </dl>
    </section>
  )
}
