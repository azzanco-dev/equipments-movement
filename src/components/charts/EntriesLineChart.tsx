import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface EntriesLinePoint {
  /** Stable identity, normally the chart bucket key. */
  key: string
  /** Short axis label, for example "07/09" or "يناير". */
  label: string
  /** Full range shown as the tooltip title; falls back to `label`. */
  title?: string
  entries: number
  /** Only read when `showExits` is on. */
  exits?: number
}

export interface EntriesLineChartProps extends ChartBaseProps {
  points: EntriesLinePoint[]
  /** Series name for the entries line. */
  entriesLabel: string
  /** Series name for the optional exits line. */
  exitsLabel?: string
  /** Draws the second line; the caller owns the toggle. */
  showExits?: boolean
  /** Plot height in pixels. */
  height?: number
}

type TooltipRow = { name: string; value: number; color: string }

/**
 * Entries over time, with an optional exits line. The X axis follows the
 * bucketing the caller chose (days, weeks or months), so the same component
 * draws a month day by day and a year month by month.
 *
 * Every color is a design token, and the axis is reversed in RTL so time still
 * reads from the start side of the page toward the end side.
 */
export function EntriesLineChart({
  points,
  entriesLabel,
  exitsLabel,
  showExits = false,
  ariaLabel,
  dir,
  lang,
  height = 260,
  loading,
  error,
  className,
}: EntriesLineChartProps) {
  const direction = useChartDirection(dir)
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

  // Recharts positions the tooltip itself; the content only has to render the
  // rows it is handed, in the interface language.
  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    // Recharts hands the rows over as a readonly list whose values are widened
    // to `ValueType`, so they are narrowed here rather than in the signature.
    payload?: readonly {
      name?: string | number
      value?: unknown
      color?: string
      payload?: { title?: string }
    }[]
  }) => {
    if (!active || !payload?.length) return null
    const title = payload[0]?.payload?.title
    const rows: TooltipRow[] = payload.map((item) => ({
      name: String(item.name ?? ''),
      value: Number(item.value ?? 0),
      color: item.color ?? 'var(--fg)',
    }))
    return (
      <div
        dir={direction}
        className="rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg"
      >
        {title && (
          <p className="mb-1 font-medium text-fg">
            <span dir="ltr" className="tabular-nums">
              {title}
            </span>
          </p>
        )}
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color }}
              />
              <span className="text-muted">{row.name}</span>
              <span className="font-semibold tabular-nums text-fg">
                {row.value}
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
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
          >
            <CartesianGrid
              stroke={CHART_AXIS_COLOR}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              reversed={rtl}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS_COLOR }}
              tick={{ fill: CHART_LABEL_COLOR, fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              orientation={rtl ? 'right' : 'left'}
              width={40}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHART_LABEL_COLOR, fontSize: 11 }}
            />
            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: CHART_AXIS_COLOR, strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="entries"
              name={entriesLabel}
              stroke="var(--entry)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            {withExits && (
              <Line
                type="monotone"
                dataKey="exits"
                name={exitsLabel}
                stroke="var(--exit)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ChartLegend
        items={[
          {
            id: 'entries',
            label: entriesLabel,
            color: 'var(--entry)',
            value: totals.entries,
          },
          ...(withExits
            ? [
                {
                  id: 'exits',
                  label: exitsLabel as string,
                  color: 'var(--exit)',
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
