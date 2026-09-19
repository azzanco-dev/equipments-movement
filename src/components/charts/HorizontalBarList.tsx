import { useMemo } from 'react'
import { cn } from '@/components/ui/cn'
import {
  CHART_LABEL_COLOR,
  ChartShell,
  ChartSrTable,
  niceMax,
  seriesColor,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface HorizontalBarItem {
  id: string
  label: string
  value: number
  /** CSS color; pass a token such as `var(--info)`. Defaults to the palette. */
  color?: string
  /** Replaces the printed number, for example "٪12" or "12 يوم". */
  valueLabel?: string
}

export interface HorizontalBarListProps extends ChartBaseProps {
  items: HorizontalBarItem[]
  /** Fixes the scale; defaults to the largest value, rounded up. */
  max?: number
  /** Row height in viewBox units. */
  rowHeight?: number
  /** Width reserved for the labels, in viewBox units of 720. */
  labelWidth?: number
  /** Uses one color for every bar instead of cycling the palette. */
  singleColor?: string
}

const WIDTH = 720
const VALUE_WIDTH = 52

/**
 * Ranked list drawn as horizontal bars (top equipment types, owners, ...).
 * Dependency-free SVG: labels sit on the start side and bars grow toward the
 * end side, so the whole list mirrors correctly in RTL.
 */
export function HorizontalBarList({
  items,
  ariaLabel,
  dir,
  lang,
  max,
  rowHeight = 26,
  labelWidth = 170,
  singleColor,
  loading,
  error,
  className,
}: HorizontalBarListProps) {
  const direction = useChartDirection(dir)
  const t = useChartText(lang)
  const rtl = direction === 'rtl'

  const scaleMax = useMemo(
    () => max ?? niceMax(Math.max(0, ...items.map((item) => item.value))),
    [items, max],
  )

  const height = Math.max(rowHeight, items.length * rowHeight)
  const trackLength = WIDTH - labelWidth - VALUE_WIDTH
  const trackStart = rtl ? WIDTH - labelWidth : labelWidth
  const barHeight = Math.min(12, rowHeight - 12)

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      minHeight={Math.min(height, 200)}
      className={cn('space-y-2', className)}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
      >
        {items.map((item, index) => {
          const y = index * rowHeight
          const barY = y + (rowHeight - barHeight) / 2
          const length =
            scaleMax > 0
              ? Math.max(
                  (Math.max(0, item.value) / scaleMax) * trackLength,
                  item.value > 0 ? 2 : 0,
                )
              : 0
          return (
            <g key={item.id}>
              <text
                x={rtl ? WIDTH : 0}
                y={y + rowHeight / 2 + 4}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={12}
                fill="var(--fg)"
              >
                {item.label}
              </text>
              <rect
                x={rtl ? trackStart - trackLength : trackStart}
                y={barY}
                width={trackLength}
                height={barHeight}
                rx={3}
                fill="var(--surface-hover)"
              />
              <rect
                x={rtl ? trackStart - length : trackStart}
                y={barY}
                width={length}
                height={barHeight}
                rx={3}
                fill={singleColor ?? seriesColor(index, item.color)}
              >
                <title>{`${item.label}: ${item.valueLabel ?? item.value}`}</title>
              </rect>
              <text
                x={rtl ? 0 : WIDTH}
                y={y + rowHeight / 2 + 4}
                textAnchor={rtl ? 'start' : 'end'}
                fontSize={12}
                fill={CHART_LABEL_COLOR}
              >
                {item.valueLabel ?? item.value}
              </text>
            </g>
          )
        })}
      </svg>

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), t('chartValue')]}
        rows={items.map((item) => [item.label, item.valueLabel ?? item.value])}
      />
    </ChartShell>
  )
}
