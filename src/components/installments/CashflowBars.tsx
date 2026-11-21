import { SoftBarChart } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import { installmentMonthShort, NEAR_MONTHS } from '@/lib/installmentsBoard'
import type { InstallmentMonthBucket } from '@/lib/installmentsView'

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * What is still to pay per month, drawn as the Figma design of the
 * dashboard (owner 2026-11-21, «خلي الوان وشكل الرسم البياني نفس فيقما»):
 * pale green bars (`--chart-1`) without an outline and with 6 px rounded
 * tops, this month and the next one in the brand amber, a muted compact
 * value over every bar («2.3M») and the short month name under it («نوف»).
 * It uses the shared `SoftBarChart` in its opt-in `flat` look.
 */
export function CashflowBars({ months }: { months: InstallmentMonthBucket[] }) {
  const { t, dir, lang } = useI18n()
  return (
    <SoftBarChart
      flat
      ariaLabel={t('instCashflowTitle')}
      dir={dir}
      lang={lang}
      height={240}
      items={months.map((month, index) => ({
        id: month.key,
        label: installmentMonthShort(month.key, lang),
        value: month.total,
        valueLabel: month.total > 0 ? compact.format(month.total) : '',
        color: index < NEAR_MONTHS ? 'var(--brand-amber)' : 'var(--chart-1)',
      }))}
    />
  )
}

/** The legend of the chart: the amber of the two coming months. */
export function CashflowLegend() {
  const { t } = useI18n()
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: 'var(--brand-amber)' }}
      />
      {t('instCashflowNear')}
    </span>
  )
}
