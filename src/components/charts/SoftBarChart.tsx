import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/components/ui/cn'
import {
  CHART_AXIS_COLOR,
  CHART_LABEL_COLOR,
  ChartShell,
  ChartSrTable,
  seriesColor,
  seriesStroke,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'
import type { HorizontalBarItem } from './HorizontalBarList'

export interface SoftBarChartProps extends ChartBaseProps {
  items: HorizontalBarItem[]
  /** Plot height in pixels, labels included. */
  height?: number
  /** One tint for every bar instead of cycling the palette. */
  singleColor?: string
  /** Outline that goes with `singleColor`. */
  singleStroke?: string
  /** The category labels' direction (Latin equipment types are `ltr`). */
  labelDir?: 'ltr' | 'rtl'
}

/** What Recharts hands a custom axis tick, narrowed to what is used. */
type TickProps = {
  x?: string | number
  y?: string | number
  payload?: { value?: unknown }
}

/**
 * Vertical bars in the «soft» look of the owner's dashboard board
 * (2026-11-01, «اعادة تنسيق recharts»): pale tints with a matching outline,
 * rounded tops, the value printed over every bar, small muted category labels
 * that wrap on their spaces, and no grid.
 */
export function SoftBarChart({
  items,
  ariaLabel,
  dir,
  lang,
  height = 150,
  singleColor,
  singleStroke,
  labelDir,
  loading,
  error,
  className,
}: SoftBarChartProps) {
  const direction = useChartDirection(dir)
  const t = useChartText(lang)
  const rtl = direction === 'rtl'

  // Two lines at most: «WHEEL LOADER» becomes «WHEEL» over «LOADER».
  const renderTick = ({ x, y, payload }: TickProps) => {
    const cx = Number(x)
    const cy = Number(y)
    const words = String(payload?.value ?? '').split(' ')
    const lines =
      words.length <= 1 ? words : [words[0], words.slice(1).join(' ')]
    return (
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fontSize={10}
        fill={CHART_LABEL_COLOR}
        direction={labelDir}
      >
        {lines.map((line, index) => (
          <tspan key={index} x={cx} dy={index === 0 ? 0 : 11}>
            {line}
          </tspan>
        ))}
      </text>
    )
  }

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: readonly { payload?: HorizontalBarItem }[]
  }) => {
    const item = active ? payload?.[0]?.payload : undefined
    if (!item) return null
    return (
      <div
        dir={direction}
        className="rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg"
      >
        <span dir={labelDir} className="text-muted">
          {item.label}
        </span>{' '}
        <span className="font-semibold tabular-nums text-fg">
          {item.valueLabel ?? item.value}
        </span>
      </div>
    )
  }

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      minHeight={height}
      className={cn('space-y-1', className)}
    >
      <div role="img" aria-label={ariaLabel} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={items}
            margin={{ top: 16, right: 4, bottom: 0, left: 4 }}
            barCategoryGap="28%"
          >
            <XAxis
              dataKey="label"
              reversed={rtl}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS_COLOR }}
              tick={renderTick}
              height={32}
            />
            <YAxis hide allowDecimals={false} />
            <Tooltip
              content={renderTooltip}
              cursor={{ fill: 'var(--surface-hover)' }}
            />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              strokeWidth={1}
              isAnimationActive={false}
            >
              {items.map((item, index) => (
                <Cell
                  key={item.id}
                  fill={singleColor ?? seriesColor(index, item.color)}
                  stroke={singleStroke ?? seriesStroke(index, item.strokeColor)}
                />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                offset={4}
                fontSize={11}
                fontWeight={600}
                fill="var(--fg)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), t('chartValue')]}
        rows={items.map((item) => [item.label, item.valueLabel ?? item.value])}
      />
    </ChartShell>
  )
}
