import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '@/components/ui/cn'
import {
  CHART_AXIS_COLOR,
  CHART_TEXT_COLOR,
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
  /** CSS color; pass a pale tint token such as `var(--chart-1)`. */
  color: string
  /** Outline for the slice; pass the matching `var(--chart-stroke-N)`. */
  strokeColor?: string
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
  /** Ring geometry as a share of the plot; defaults fill a half-width card. */
  innerRadius?: string
  outerRadius?: string
}

const DEG = Math.PI / 180
/**
 * Under this share a slice gets no label at all (owner request, 2026-09-22).
 * Several 1-2% slices sit next to each other on the ring, and their outside
 * labels were overlapping into an unreadable stack. The legend still lists
 * every slice with its count and its share, and the tooltip still names it, so
 * nothing is lost — only the labels that could not be read anyway.
 */
const LABEL_MIN_SHARE = 0.03
/** Under this share a slice is too narrow to hold text, so it labels outside. */
const INSIDE_MIN_SHARE = 0.08
/** From this share up the slice is wide enough to carry the count too. */
const COUNT_MIN_SHARE = 0.14

/** What Recharts hands a custom `label` renderer, narrowed to what is used. */
type SliceLabelProps = {
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
  percent?: number
  value?: number
  index?: number
}

/**
 * Where the fleet is right now, as a donut with a legend carrying counts and
 * shares. When `onSliceSelect` is given, both the slices and the legend
 * entries become controls, so the drill-down is reachable with a pointer and
 * with the keyboard.
 *
 * Owner rule (2026-09-19): the numbers are readable without hovering. Every
 * slice carries its share, a wide slice carries the count as well, and a slice
 * too narrow for text gets an outside label on a leader line. Touch devices
 * have no hover, so the tooltip is extra detail and never the only copy of a
 * number.
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
  // Owner request (2026-09-22): two donuts side by side, each filling its half
  // of the row, so the ring is noticeably larger than the single donut was.
  height = 300,
  innerRadius = '50%',
  outerRadius = '78%',
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
            className="block h-2 w-2 shrink-0 rounded-sm border"
            style={{
              backgroundColor: slice.color,
              borderColor: slice.strokeColor ?? 'var(--border)',
            }}
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

  const renderSliceLabel = ({
    cx = 0,
    cy = 0,
    midAngle = 0,
    innerRadius = 0,
    outerRadius = 0,
    percent = 0,
    value = 0,
  }: SliceLabelProps) => {
    if (value <= 0 || percent < LABEL_MIN_SHARE) return null
    const share = Math.round(percent * 100)
    // Recharts measures angles counter-clockwise from the positive X axis, so
    // the Y component is negated to land back in SVG coordinates.
    const cos = Math.cos(-midAngle * DEG)
    const sin = Math.sin(-midAngle * DEG)

    if (percent >= INSIDE_MIN_SHARE) {
      const radius = innerRadius + (outerRadius - innerRadius) / 2
      const x = cx + radius * cos
      const y = cy + radius * sin
      const withCount = percent >= COUNT_MIN_SHARE
      return (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={11}
          fill={CHART_TEXT_COLOR}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {withCount ? (
            <>
              <tspan x={x} dy="-0.45em" fontWeight={600}>
                {value}
              </tspan>
              <tspan x={x} dy="1.1em">
                {share}%
              </tspan>
            </>
          ) : (
            <tspan fontWeight={600}>{share}%</tspan>
          )}
        </text>
      )
    }

    // Too narrow for text: elbow the label out of the ring instead of hiding
    // the number behind a hover that a touch screen cannot produce.
    const startX = cx + (outerRadius + 2) * cos
    const startY = cy + (outerRadius + 2) * sin
    const elbowX = cx + (outerRadius + 13) * cos
    const elbowY = cy + (outerRadius + 13) * sin
    const towardEnd = cos >= 0
    const endX = elbowX + (towardEnd ? 10 : -10)
    return (
      <g>
        <path
          d={`M${startX},${startY}L${elbowX},${elbowY}L${endX},${elbowY}`}
          stroke={CHART_AXIS_COLOR}
          strokeWidth={1}
          fill="none"
        />
        <text
          x={endX + (towardEnd ? 3 : -3)}
          y={elbowY}
          textAnchor={towardEnd ? 'start' : 'end'}
          dominantBaseline="central"
          fontSize={11}
          fontWeight={600}
          fill="var(--fg)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {`${value} · ${share}%`}
        </text>
      </g>
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
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={1}
                strokeWidth={1}
                isAnimationActive={false}
                label={renderSliceLabel}
                labelLine={false}
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
                    // Owner request (2026-09-21): the slice outline is the
                    // slice fill, so the ring reads as one flat shape instead
                    // of a set of outlined wedges. `strokeColor` is still used
                    // for the legend swatch, where a border is what separates
                    // a pale tint from the card behind it.
                    stroke={slice.color}
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
          strokeColor: slice.strokeColor,
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
