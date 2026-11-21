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
  TOOLTIP_WRAPPER_STYLE,
  deepTint,
  seriesColor,
  seriesStroke,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
  useChartAnimation,
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
  /**
   * Opt-in «flat» look (the installments chart, owner 2026-11-21, «خلي الوان
   * وشكل الرسم البياني نفس فيقما»): each bar filled with its item's own
   * `color` (or `singleColor`) as is, no outline, 6 px rounded tops, muted
   * regular value labels, 12 px category labels and no axis line. The default
   * soft look is unchanged.
   */
  flat?: boolean
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
  flat = false,
  loading,
  error,
  className,
}: SoftBarChartProps) {
  const direction = useChartDirection(dir)
  const animation = useChartAnimation()
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
        fontSize={flat ? 12 : 10}
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
        className="animate-fade-in-opacity rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg motion-reduce:animate-none"
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
            // Recharts puts the gap on both sides of a bar: 16% leaves the
            // flat bar two thirds of its month, as the Figma design (46 of 68).
            barCategoryGap={flat ? '16%' : '28%'}
          >
            <XAxis
              dataKey="label"
              reversed={rtl}
              interval={0}
              tickLine={false}
              axisLine={flat ? false : { stroke: CHART_AXIS_COLOR }}
              tick={renderTick}
              height={32}
            />
            <YAxis hide allowDecimals={false} />
            {/* No slide of the tooltip from the previous point to the next
                (owner 2026-11-01, «الانيميشن حق ظهور الرقم عند الـ hover
                غريب»): it fades in where the pointer is («خليه fade خفيف»). */}
            <Tooltip
              isAnimationActive={false}
              wrapperStyle={TOOLTIP_WRAPPER_STYLE}
              content={renderTooltip}
              cursor={{ fill: 'var(--surface-hover)' }}
            />
            <Bar
              dataKey="value"
              radius={flat ? [6, 6, 0, 0] : [3, 3, 0, 0]}
              strokeWidth={1}
              {...animation}
            >
              {items.map((item, index) => (
                <Cell
                  key={item.id}
                  fill={
                    flat
                      ? (item.color ?? singleColor ?? seriesColor(index))
                      : deepTint(
                          singleColor ?? seriesColor(index, item.color),
                          singleStroke ?? seriesStroke(index, item.strokeColor),
                        )
                  }
                  stroke={
                    flat
                      ? 'none'
                      : (singleStroke ?? seriesStroke(index, item.strokeColor))
                  }
                />
              ))}
              <LabelList
                // An item's short label («2.3M») when it has one: the raw
                // value of an amount with halalas overlaps its neighbours.
                // (Recharts reads `valueAccessor` only without `dataKey`.)
                valueAccessor={(entry: {
                  payload?: HorizontalBarItem
                  value?: unknown
                }) => entry.payload?.valueLabel ?? (entry.value as number)}
                position="top"
                offset={4}
                fontSize={11}
                fontWeight={flat ? 400 : 600}
                fill={flat ? 'var(--muted)' : 'var(--fg)'}
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
