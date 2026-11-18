import { useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { formatInstallmentAmount } from '@/lib/installments'
import {
  installmentMonthLabel,
  installmentsWords,
  type InstallmentMonthBucket,
} from '@/lib/installmentsView'
import { Money } from './cells'

/**
 * What is still to pay per month, one series in the first chart tint with its
 * outline (owner rule 2026-09-19: pale fills, never saturated). Bars are
 * anchored to the baseline with 4 px rounded tops, a 2 px gap between them,
 * recessive gridlines, the value on hover / focus and on the largest bar.
 */
export function CashflowBars({ months }: { months: InstallmentMonthBucket[] }) {
  const { t, lang } = useI18n()
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(...months.map((month) => month.total), 1)
  const peak = months.reduce(
    (best, month) => (month.total > best.total ? month : best),
    months[0],
  )
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  // The largest bar carries its own value, so the top line has none.
  const ticks = [0.25, 0.5, 0.75]
  const active = months.find((month) => month.key === hover) ?? null

  return (
    <div className="space-y-2">
      {/* The plot sits 24 px under the top so the largest bar's value
          never touches the card header. */}
      <div className="relative h-60">
        <div className="absolute inset-x-0 bottom-0 top-6">
          {/* Gridlines with their compact values. */}
          {ticks.map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${tick * 100}%`, borderColor: 'var(--border)' }}
            >
              <span className="absolute -top-2.5 end-0 bg-bg px-1 text-[10px] text-muted">
                <bdi dir="ltr">{compact.format(max * tick)}</bdi>
              </span>
            </div>
          ))}
          <div
            className="absolute inset-0 flex items-end gap-[2px] border-b pe-10"
            role="list"
            aria-label={t('instCashflowTitle')}
          >
            {months.map((month) => {
              const height = (month.total / max) * 100
              const showValue = month.key === peak.key || month.key === hover
              return (
                <button
                  key={month.key}
                  type="button"
                  role="listitem"
                  className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
                  onMouseEnter={() => setHover(month.key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(month.key)}
                  onBlur={() => setHover(null)}
                  aria-label={`${installmentMonthLabel(month.key, lang)}: ${formatInstallmentAmount(month.total)}`}
                >
                  {showValue && month.total > 0 && (
                    <span
                      className="absolute z-10 whitespace-nowrap text-[11px] font-medium"
                      style={{ bottom: `calc(${height}% + 4px)` }}
                    >
                      <bdi dir="ltr">{compact.format(month.total)}</bdi>
                    </span>
                  )}
                  <span
                    className="w-full max-w-10 rounded-t-[4px] border transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)]"
                    style={{
                      height: `${Math.max(height, month.total > 0 ? 1.5 : 0)}%`,
                      backgroundColor: 'var(--chart-1)',
                      borderColor: 'var(--chart-stroke-1)',
                      opacity: hover && hover !== month.key ? 0.55 : 1,
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-[2px] pe-10">
        {months.map((month) => (
          <span
            key={month.key}
            className="flex-1 truncate text-center text-[11px] text-muted"
          >
            {/* A phone has no room for twelve names: the month's number. */}
            <bdi dir="ltr" className="tabular-nums sm:hidden">
              {Number(month.key.slice(5, 7))}
            </bdi>
            <span className="hidden sm:inline">
              {installmentMonthLabel(month.key, lang, true)}
            </span>
          </span>
        ))}
      </div>
      {/* The tooltip as a line: readable on touch too. */}
      <p className="min-h-5 text-xs text-muted" aria-live="polite">
        {active ? (
          <>
            <span className="font-medium text-fg">
              {installmentMonthLabel(active.key, lang)}
            </span>
            {' · '}
            <Money value={active.total} className="text-fg" />
            {' · '}
            {installmentsWords(active.count, lang)}
          </>
        ) : (
          t('instCashflowHoverHint')
        )}
      </p>
    </div>
  )
}
