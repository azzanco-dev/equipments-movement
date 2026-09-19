import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '@/components/ui/cn'
import {
  ChartLegend,
  ChartShell,
  ChartSrTable,
  percentOf,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface FleetDonutSlice {
  id: string
  label: string
  value: number
  /** CSS color; pass a token such as `var(--entry)`. */
  color: string
}

export interface FleetDonutProps extends ChartBaseProps {
  slices: FleetDonutSlice[]
  /** Big number in the middle; defaults to the sum of the slices. */
  centerValue?: number
  /** Short caption under the number, for example "معدة". */
  centerLabel: string
  /** Enables click-through. The caller owns the drill state, so the donut
   *  stays a presentational component. */
  onSliceSelect?: (slice: FleetDonutSlice) => void
  /** Emphasizes one slice and dims the rest. */
  activeId?: string | null
  /** Line under the legend explaining that slices are clickable. */
  hint?: string
  height?: number
}

/**
 * Where the fleet is right now, as a donut with a legend carrying counts and
 * shares. When `onSliceSelect` is given, both the slices and the legend
 * entries become controls, so the drill-down is reachable with a pointer and
 * with the keyboard.
 */
export function FleetDonut({
  slices,
  centerValue,
  centerLabel,
  onSliceSelect,
  activeId,
  hint,
  ariaLabel,
  dir,
  lang,
  height = 260,
  loading,
  error,
  className,
}: FleetDonutProps) {
  const direction = useChartDirection(dir)
  const t = useChartText(lang)

  const total = useMemo(
    () => slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0),
    [slices],
  )
  const middle = centerValue ?? total

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    // Recharts hands the rows over as a readonly list.
    payload?: readonly { payload?: FleetDonutSlice }[]
  }) => {
    const slice = active ? payload?.[0]?.payload : undefined
    if (!slice) return null
    return (
      <div
        dir={direction}
        className="rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="block h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: slice.color }}
          />
          <span className="text-muted">{slice.label}</span>
          <span className="font-semibold tabular-nums text-fg">
            {slice.value}
          </span>
          <span className="tabular-nums text-muted">
            ({percentOf(slice.value, total)}%)
          </span>
        </span>
      </div>
    )
  }

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={total === 0}
      minHeight={height}
      className={cn('space-y-2', className)}
    >
      <div className="relative" role="img" aria-label={ariaLabel}>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={renderTooltip} />
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={1}
                stroke="var(--bg)"
                strokeWidth={2}
                isAnimationActive={false}
                onClick={
                  onSliceSelect
                    ? (entry: unknown) =>
                        onSliceSelect(entry as FleetDonutSlice)
                    : undefined
                }
              >
                {slices.map((slice) => (
                  <Cell
                    key={slice.id}
                    fill={slice.color}
                    opacity={activeId && activeId !== slice.id ? 0.35 : 1}
                    className={onSliceSelect ? 'cursor-pointer' : undefined}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* The middle of a donut is empty by construction, so the total sits
            there as ordinary text instead of an SVG label that would not
            wrap or scale with the interface font. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-fg">
            {middle}
          </span>
          <span className="text-xs text-muted">{centerLabel}</span>
        </div>
      </div>

      <ChartLegend
        items={slices.map((slice) => ({
          id: slice.id,
          label: slice.label,
          color: slice.color,
          value: slice.value,
          percent: percentOf(slice.value, total),
          onSelect: onSliceSelect ? () => onSliceSelect(slice) : undefined,
          selected: activeId === slice.id,
        }))}
      />
      {hint && onSliceSelect && <p className="text-xs text-muted">{hint}</p>}

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), t('chartValue'), t('chartShare')]}
        rows={slices.map((slice) => [
          slice.label,
          slice.value,
          `${percentOf(slice.value, total)}%`,
        ])}
      />
    </ChartShell>
  )
}
