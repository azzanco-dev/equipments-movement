import { useMemo } from 'react'
import { cn } from '@/components/ui/cn'
import {
  CHART_AXIS_COLOR,
  CHART_LABEL_COLOR,
  ChartLegend,
  ChartShell,
  ChartSrTable,
  niceMax,
  seriesColor,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface BarChartSeries {
  id: string
  label: string
  /** CSS color; pass a token such as `var(--entry)`. Defaults to the palette. */
  color?: string
  /** One value per label, same order as `labels`. */
  values: number[]
}

export interface BarChartProps extends ChartBaseProps {
  /** Category labels along the value axis, one per bar group. */
  labels: string[]
  /** One or two series, drawn as grouped bars. */
  series: BarChartSeries[]
  /** Height of the drawing area in viewBox units. */
  height?: number
  /** Shows the swatch legend under the chart. */
  legend?: boolean
  /** Shows at most this many category labels, thinning the rest. */
  maxAxisLabels?: number
}

const WIDTH = 720
const PAD_TOP = 10
const PAD_BOTTOM = 26
const PAD_AXIS = 34
const PAD_EDGE = 8

/**
 * Grouped bar chart for two comparable series (entries vs exits per day).
 * Dependency-free SVG: responsive through `viewBox`, colored from tokens,
 * mirrored for RTL, and backed by a visually hidden data table.
 */
export function BarChart({
  labels,
  series,
  ariaLabel,
  dir,
  lang,
  height = 190,
  legend = true,
  maxAxisLabels = 12,
  loading,
  error,
  className,
}: BarChartProps) {
  const direction = useChartDirection(dir)
  const t = useChartText(lang)
  const rtl = direction === 'rtl'

  const max = useMemo(
    () => niceMax(Math.max(0, ...series.flatMap((item) => item.values))),
    [series],
  )

  const isEmpty = labels.length === 0 || series.length === 0

  const plotWidth = WIDTH - PAD_AXIS - PAD_EDGE
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const baseline = height - PAD_BOTTOM
  const groupWidth = plotWidth / Math.max(1, labels.length)
  const innerGap = Math.min(2, groupWidth * 0.08)
  const barWidth = Math.max(
    1.5,
    (groupWidth * 0.72 - innerGap * (series.length - 1)) /
      Math.max(1, series.length),
  )
  const axisX = rtl ? WIDTH - PAD_AXIS : PAD_AXIS
  const labelStep = Math.ceil(labels.length / Math.max(1, maxAxisLabels))

  const groupStart = (index: number) =>
    rtl
      ? WIDTH - PAD_AXIS - (index + 1) * groupWidth
      : PAD_AXIS + index * groupWidth

  const ticks = [0, max / 2, max]

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={isEmpty}
      minHeight={height}
      className={cn('space-y-2', className)}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="h-auto w-full"
        style={{ maxHeight: height * 1.4 }}
      >
        {ticks.map((tick) => {
          const y = baseline - (tick / max) * plotHeight
          return (
            <g key={tick}>
              <line
                x1={rtl ? PAD_EDGE : PAD_AXIS}
                x2={rtl ? WIDTH - PAD_AXIS : WIDTH - PAD_EDGE}
                y1={y}
                y2={y}
                stroke={CHART_AXIS_COLOR}
                strokeWidth={1}
              />
              <text
                x={rtl ? axisX + 6 : axisX - 6}
                y={y + 3.5}
                textAnchor={rtl ? 'start' : 'end'}
                fontSize={10}
                fill={CHART_LABEL_COLOR}
              >
                {Math.round(tick)}
              </text>
            </g>
          )
        })}

        {labels.map((label, index) => {
          const start = groupStart(index)
          const used = series.length * barWidth + (series.length - 1) * innerGap
          const offset = (groupWidth - used) / 2
          return (
            <g key={label + index}>
              {series.map((item, seriesIndex) => {
                const value = item.values[index] ?? 0
                const barHeight = max > 0 ? (value / max) * plotHeight : 0
                const order = rtl
                  ? series.length - 1 - seriesIndex
                  : seriesIndex
                const x = start + offset + order * (barWidth + innerGap)
                return (
                  <rect
                    key={item.id}
                    x={x}
                    y={baseline - barHeight}
                    width={barWidth}
                    height={Math.max(barHeight, value > 0 ? 1 : 0)}
                    rx={1}
                    fill={seriesColor(seriesIndex, item.color)}
                  >
                    <title>{`${label} · ${item.label}: ${value}`}</title>
                  </rect>
                )
              })}
              {index % labelStep === 0 && (
                <text
                  x={start + groupWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill={CHART_LABEL_COLOR}
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}

        <line
          x1={rtl ? PAD_EDGE : PAD_AXIS}
          x2={rtl ? WIDTH - PAD_AXIS : WIDTH - PAD_EDGE}
          y1={baseline}
          y2={baseline}
          stroke={CHART_AXIS_COLOR}
          strokeWidth={1}
        />
      </svg>

      {legend && (
        <ChartLegend
          items={series.map((item, index) => ({
            id: item.id,
            label: item.label,
            color: seriesColor(index, item.color),
          }))}
        />
      )}

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), ...series.map((item) => item.label)]}
        rows={labels.map((label, index) => [
          label,
          ...series.map((item) => item.values[index] ?? 0),
        ])}
      />
    </ChartShell>
  )
}
