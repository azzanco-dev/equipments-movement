import { SoftBarChart } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import {
  installmentMonthLabel,
  type InstallmentMonthBucket,
} from '@/lib/installmentsView'

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * What is still to pay per month, on the program's shared bar chart (the
 * admin home's `SoftBarChart`, loaded lazily: pale tints with their outline,
 * the value over every bar in a compact form such as «125K»). It replaced the
 * bars drawn by hand for the first version of the page.
 */
export function CashflowBars({ months }: { months: InstallmentMonthBucket[] }) {
  const { t, dir, lang } = useI18n()
  return (
    <SoftBarChart
      ariaLabel={t('instCashflowTitle')}
      dir={dir}
      lang={lang}
      height={240}
      singleColor="var(--chart-1)"
      singleStroke="var(--chart-stroke-1)"
      items={months.map((month) => ({
        id: month.key,
        label: installmentMonthLabel(month.key, lang, true),
        value: month.total,
        valueLabel: month.total > 0 ? compact.format(month.total) : '',
      }))}
    />
  )
}
