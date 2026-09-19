import { useMemo } from 'react'
import { cn } from '@/components/ui/cn'
import {
  ChartShell,
  ChartSrTable,
  niceMax,
  seriesColor,
  seriesStroke,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface HorizontalBarItem {
  id: string
  label: string
  value: number
  /** Pale tint token such as `var(--chart-3)`. Defaults to the palette. */
  color?: string
  /** Outline token such as `var(--chart-stroke-3)`. Defaults to the palette. */
  strokeColor?: string
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
  /** Uses one tint for every bar instead of cycling the palette. */
  singleColor?: string
  /** Outline that goes with `singleColor`. */
  singleStroke?: string
}

const WIDTH = 720
const VALUE_WIDTH = 52

/**
 * Ranked list drawn as horizontal bars (top equipment types, owners, ...).
 * Dependency-free SVG: labels sit on the start side and bars grow toward the
 * end side, so the whole list mirrors correctly in RTL.
 *
 * Owner rule (2026-09-19): bars are pale tints with a matching outline, and
 * every bar's value is printed at its end, so nothing depends on a hover.
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
  singleStroke,
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
                stroke={singleStroke ?? seriesStroke(index, item.strokeColor)}
                strokeWidth={1}
              >
                <title>{`${item.label}: ${item.valueLabel ?? item.value}`}</title>
              </rect>
              <text
                x={rtl ? 0 : WIDTH}
                y={y + rowHeight / 2 + 4}
                textAnchor={rtl ? 'start' : 'end'}
                fontSize={12}
                fontWeight={600}
                fill="var(--fg)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
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
