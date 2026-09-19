import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  translations,
  type Language,
  type TranslationKey,
} from '@/i18n/translations'
import { cn } from '@/components/ui/cn'

/**
 * Shared pieces for the dependency-free SVG charts. Every color here is a
 * design token, so light and dark themes switch with the rest of the interface
 * and no chart hardcodes a palette value.
 */

/**
 * Categorical fills, in order. Owner rule (2026-09-19): a chart fills with a
 * pale tint, never with a saturated color, so six tints carry the series and
 * the matching `CHART_STROKE_COLORS` entry draws the outline, the line and the
 * dot. The values live in `src/index.css` as `--chart-N` / `--chart-stroke-N`,
 * so light and dark switch with the rest of the interface.
 */
export const CHART_SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

/** Outline / line / dot color matching `CHART_SERIES_COLORS` index for index. */
export const CHART_STROKE_COLORS = [
  'var(--chart-stroke-1)',
  'var(--chart-stroke-2)',
  'var(--chart-stroke-3)',
  'var(--chart-stroke-4)',
  'var(--chart-stroke-5)',
  'var(--chart-stroke-6)',
] as const

export const CHART_AXIS_COLOR = 'var(--border)'
export const CHART_LABEL_COLOR = 'var(--muted)'
/** Value text written on top of a tint; readable on every tint, both themes. */
export const CHART_TEXT_COLOR = 'var(--chart-text)'

export function seriesColor(index: number, explicit?: string): string {
  return explicit ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
}

export function seriesStroke(index: number, explicit?: string): string {
  return explicit ?? CHART_STROKE_COLORS[index % CHART_STROKE_COLORS.length]
}

export type ChartDirection = 'rtl' | 'ltr'

export interface ChartBaseProps {
  /** Accessible name announced for the whole chart. */
  ariaLabel: string
  /** Overrides the ambient direction, for side-by-side locale previews. */
  dir?: ChartDirection
  /** Overrides the ambient interface language for built-in labels. */
  lang?: Language
  /** Replaces the chart with a skeleton. */
  loading?: boolean
  /** Truthy renders the error state; `true` uses the default message. */
  error?: ReactNode
  className?: string
}

/**
 * Resolves built-in chart labels from an explicit language when one is given,
 * so a preview can switch locale without touching the ambient provider.
 */
export function useChartText(langOverride?: Language) {
  const { lang: ambientLang } = useI18n()
  const lang = langOverride ?? ambientLang
  return (key: TranslationKey) =>
    translations[lang][key] ?? translations.ar[key] ?? key
}

export function useChartDirection(
  dirOverride?: ChartDirection,
): ChartDirection {
  const { dir } = useI18n()
  return dirOverride ?? dir
}

/** Rounds an axis maximum up to a readable step. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 2, 2.5, 5, 10]
  for (const step of steps) {
    const candidate = step * magnitude
    if (candidate >= value) return candidate
  }
  return 10 * magnitude
}

export function percentOf(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

/**
 * Loading, error and empty states around a chart body, matching the states
 * DataTable and AttentionList already use, so a failed load is never shown as
 * an empty chart.
 */
export function ChartShell({
  loading = false,
  error,
  isEmpty = false,
  emptyLabel,
  minHeight = 160,
  className,
  children,
}: {
  loading?: boolean
  error?: ReactNode
  isEmpty?: boolean
  emptyLabel?: ReactNode
  minHeight?: number
  className?: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const hasError = error !== undefined && error !== null && error !== false

  if (hasError)
    return (
      <div
        role="alert"
        className={cn(
          'flex items-start gap-2.5 rounded-lg border-s-4 border-danger bg-danger-soft px-3 py-4 text-sm font-medium text-danger',
          className,
        )}
      >
        <AlertCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{error === true ? t('dataLoadError') : error}</span>
      </div>
    )

  if (loading)
    return (
      <div
        aria-busy="true"
        className={cn('rounded-lg border p-3', className)}
        style={{ minHeight }}
      >
        <span className="sr-only">{t('loading')}</span>
        <span
          className="block w-full animate-pulse rounded bg-surface-hover"
          style={{ height: minHeight - 24 }}
        />
      </div>
    )

  if (isEmpty)
    return (
      <p
        className={cn(
          'rounded-lg border px-3 py-8 text-center text-sm text-muted',
          className,
        )}
      >
        {emptyLabel ?? t('chartNoData')}
      </p>
    )

  return <div className={className}>{children}</div>
}

/**
 * The same numbers as a real table, for screen readers and for anyone who
 * cannot read the shapes. Visually hidden, never focusable.
 */
export function ChartSrTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) =>
              cellIndex === 0 ? (
                <th key={cellIndex} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={cellIndex}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface ChartLegendItem {
  id: string
  label: string
  color: string
  /** Outline for the swatch; a pale tint alone disappears on a white card. */
  strokeColor?: string
  value?: ReactNode
  percent?: number
  /** Makes this entry a button. A chart slice is not reachable with the
   *  keyboard, so a clickable chart exposes the same action here. */
  onSelect?: () => void
  /** Marks the entry as the currently drilled-into one. */
  selected?: boolean
}

/** Swatch + label list under a chart. Uses logical spacing for RTL and LTR. */
export function ChartLegend({
  items,
  className,
}: {
  items: ChartLegendItem[]
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => {
        const body = (
          <>
            <span
              aria-hidden="true"
              className="block h-2.5 w-2.5 shrink-0 rounded-sm border"
              style={{
                backgroundColor: item.color,
                borderColor: item.strokeColor ?? 'var(--border)',
              }}
            />
            <span className="text-muted">{item.label}</span>
            {item.value !== undefined && (
              <span className="font-medium tabular-nums text-fg">
                {item.value}
              </span>
            )}
            {item.percent !== undefined && (
              <span className="tabular-nums text-muted">({item.percent}%)</span>
            )}
          </>
        )
        return (
          <li key={item.id} className="text-xs">
            {item.onSelect ? (
              <button
                type="button"
                onClick={item.onSelect}
                aria-pressed={item.selected ?? false}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  item.selected && 'bg-surface-hover',
                )}
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
