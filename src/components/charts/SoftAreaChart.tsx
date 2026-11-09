import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/components/ui/cn'
import {
  CHART_AXIS_COLOR,
  CHART_LABEL_COLOR,
  ChartLegend,
  ChartShell,
  ChartSrTable,
  TOOLTIP_WRAPPER_STYLE,
  deepTint,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
  useChartAnimation,
} from './chartShared'
import type { EntriesLinePoint } from './EntriesLineChart'

export interface SoftAreaChartProps extends ChartBaseProps {
  points: EntriesLinePoint[]
  entriesLabel: string
  exitsLabel?: string
  /** Draws the second (exits) area; the caller owns the toggle. */
  showExits?: boolean
  /** Plot height in pixels. */
  height?: number
}

const ENTRY_STROKE = 'var(--chart-stroke-1)'
const ENTRY_TINT = deepTint('var(--chart-1)', ENTRY_STROKE)
const EXIT_STROKE = 'var(--chart-stroke-2)'
const EXIT_TINT = deepTint('var(--chart-2)', EXIT_STROKE)

/** What Recharts hands a custom `label` renderer, narrowed to what is used. */
type PointLabelProps = {
  x?: string | number
  y?: string | number
  value?: unknown
  index?: number
}

const NO_LABEL = <g />

function asNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * The entries trend in the «soft» look of the owner's dashboard board
 * (2026-11-01, «اعادة تنسيق recharts»): a smooth line over a flat pale fill,
 * no dots, a faint horizontal grid, small muted axes. The look is the
 * difference from `EntriesLineChart`; the data shape is the same.
 *
 * The owner's 2026-09-19 rule (numbers readable without hovering) is kept in
 * its smallest form: only the highest point and the last one print their
 * value; everything else stays in the tooltip and the legend totals.
 */
export function SoftAreaChart({
  points,
  entriesLabel,
  exitsLabel,
  showExits = false,
  ariaLabel,
  dir,
  lang,
  height = 220,
  loading,
  error,
  className,
}: SoftAreaChartProps) {
  const direction = useChartDirection(dir)
  const animation = useChartAnimation()
  const t = useChartText(lang)
  const rtl = direction === 'rtl'
  const withExits = showExits && exitsLabel !== undefined

  const data = useMemo(
    () =>
      points.map((point) => ({
        key: point.key,
        label: point.label,
        title: point.title ?? point.label,
        entries: point.entries,
        exits: point.exits ?? 0,
      })),
    [points],
  )

  const totals = useMemo(() => {
    let entries = 0
    let exits = 0
    for (const point of points) {
      entries += point.entries
      exits += point.exits ?? 0
    }
    return { entries, exits }
  }, [points])

  // The peak and the last point of the entries series print their value.
  const printed = useMemo(() => {
    const marked = new Set<number>()
    if (points.length === 0) return marked
    let highest = 0
    points.forEach((point, index) => {
      if (point.entries > points[highest].entries) highest = index
    })
    marked.add(highest)
    marked.add(points.length - 1)
    return marked
  }, [points])

  const pointLabel = ({ x, y, value, index }: PointLabelProps) => {
    const cx = asNumber(x)
    const cy = asNumber(y)
    const shown = asNumber(value)
    if (cx === undefined || cy === undefined || shown === undefined)
      return NO_LABEL
    if (!printed.has(index ?? -1)) return NO_LABEL
    return (
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill={ENTRY_STROKE}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {shown}
      </text>
    )
  }

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: readonly {
      name?: string | number
      value?: unknown
      color?: string
      payload?: { title?: string }
    }[]
  }) => {
    if (!active || !payload?.length) return null
    const title = payload[0]?.payload?.title
    return (
      <div
        dir={direction}
        className="animate-fade-in-opacity rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg motion-reduce:animate-none"
      >
        {title && (
          <p className="mb-1 font-medium text-fg">
            <span dir="ltr" className="tabular-nums">
              {title}
            </span>
          </p>
        )}
        <ul className="space-y-0.5">
          {payload.map((row) => (
            <li
              key={String(row.name ?? '')}
              className="flex items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className="block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color ?? 'var(--fg)' }}
              />
              <span className="text-muted">{String(row.name ?? '')}</span>
              <span className="font-semibold tabular-nums text-fg">
                {Number(row.value ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={points.length === 0}
      minHeight={height}
      className={cn('space-y-2', className)}
    >
      <div role="img" aria-label={ariaLabel} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke={CHART_AXIS_COLOR}
              strokeOpacity={0.7}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              reversed={rtl}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHART_LABEL_COLOR, fontSize: 10 }}
              tickMargin={6}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              orientation={rtl ? 'right' : 'left'}
              width={28}
              tickCount={4}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHART_LABEL_COLOR, fontSize: 10 }}
            />
            {/* No slide of the tooltip from the previous point to the next
                (owner 2026-11-01, «الانيميشن حق ظهور الرقم عند الـ hover
                غريب»): it fades in where the pointer is («خليه fade خفيف»). */}
            <Tooltip
              isAnimationActive={false}
              wrapperStyle={TOOLTIP_WRAPPER_STYLE}
              content={renderTooltip}
              cursor={{ stroke: CHART_AXIS_COLOR, strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="entries"
              name={entriesLabel}
              stroke={ENTRY_STROKE}
              strokeWidth={2}
              fill={ENTRY_TINT}
              fillOpacity={0.9}
              dot={false}
              activeDot={{ r: 4, fill: ENTRY_STROKE, stroke: 'var(--bg)' }}
              label={pointLabel}
              {...animation}
            />
            {withExits && (
              <Area
                type="monotone"
                dataKey="exits"
                name={exitsLabel}
                stroke={EXIT_STROKE}
                strokeWidth={1.5}
                fill={EXIT_TINT}
                fillOpacity={0.8}
                dot={false}
                activeDot={{ r: 4, fill: EXIT_STROKE, stroke: 'var(--bg)' }}
                {...animation}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <ChartLegend
        items={[
          {
            id: 'entries',
            label: entriesLabel,
            color: ENTRY_TINT,
            strokeColor: ENTRY_STROKE,
            value: totals.entries,
          },
          ...(withExits
            ? [
                {
                  id: 'exits',
                  label: exitsLabel as string,
                  color: EXIT_TINT,
                  strokeColor: EXIT_STROKE,
                  value: totals.exits,
                },
              ]
            : []),
        ]}
      />

      <ChartSrTable
        caption={ariaLabel}
        columns={
          withExits
            ? [t('chartCategory'), entriesLabel, exitsLabel as string]
            : [t('chartCategory'), entriesLabel]
        }
        rows={points.map((point) =>
          withExits
            ? [point.title ?? point.label, point.entries, point.exits ?? 0]
            : [point.title ?? point.label, point.entries],
        )}
      />
    </ChartShell>
  )
}
