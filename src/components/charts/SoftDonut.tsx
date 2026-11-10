import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { AppLink } from '@/components/ui/AppLink'
import { cn } from '@/components/ui/cn'
import {
  ChartShell,
  ChartSrTable,
  TOOLTIP_WRAPPER_STYLE,
  deepTint,
  percentOf,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
  useChartAnimation,
} from './chartShared'
import type { FleetDonutSlice } from './FleetDonut'

export interface SoftDonutProps extends ChartBaseProps {
  slices: FleetDonutSlice[]
  /** Big number in the middle; defaults to the sum of the slices. */
  centerValue?: number
  /** Short caption under the number, for example «معدة». */
  centerLabel: string
  height?: number
  /** `under` lists the slices below the ring; `side` puts them beside it. */
  legend?: 'under' | 'side'
  /** Opt-in (owner 2026-11-10, «فيه مساحة فاضية تحت الدونات»): the chart
   *  grows to the height its flex-column parent gives it, `height` being
   *  the minimum, so a card stretched by its row has no empty foot. */
  fill?: boolean
}

/**
 * The donut in the «soft» look of the owner's dashboard board (2026-11-01,
 * «اعادة تنسيق recharts»): a wide ring of pale tints with rounded, slightly
 * separated segments, nothing written on the slices, the total in the middle
 * and a compact list of the slices with their counts and shares. The data
 * shape is `FleetDonut`'s; only the look differs.
 */
export function SoftDonut({
  slices,
  centerValue,
  centerLabel,
  ariaLabel,
  dir,
  lang,
  height = 200,
  legend = 'under',
  fill = false,
  loading,
  error,
  className,
}: SoftDonutProps) {
  const direction = useChartDirection(dir)
  const animation = useChartAnimation()
  const t = useChartText(lang)

  const total = useMemo(
    () => slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0),
    [slices],
  )
  const middle = centerValue ?? total
  const fillOf = (slice: FleetDonutSlice) =>
    deepTint(slice.color, slice.strokeColor ?? slice.color)

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: readonly { payload?: FleetDonutSlice }[]
  }) => {
    const slice = active ? payload?.[0]?.payload : undefined
    if (!slice) return null
    return (
      <div
        dir={direction}
        className="animate-fade-in-opacity rounded-lg border bg-bg px-2.5 py-2 text-xs shadow-lg motion-reduce:animate-none"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="block h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: slice.strokeColor ?? slice.color }}
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

  const list = (
    <ul
      className={cn(
        'text-xs',
        // Under the ring the rows pair up, so five owners take three rows
        // and the card stays as short as the chart beside it.
        legend === 'under'
          ? 'grid grid-cols-2 gap-x-3'
          : 'shrink-0 self-center',
      )}
    >
      {slices.map((slice) => (
        <li key={slice.id} className="flex items-center gap-2 py-1">
          <span
            aria-hidden="true"
            className="block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: fillOf(slice),
            }}
          />
          {slice.href ? (
            <AppLink
              href={slice.href}
              className="truncate-safe min-w-0 flex-1 rounded text-fg underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {slice.label}
            </AppLink>
          ) : (
            <span className="truncate-safe min-w-0 flex-1 text-fg">
              {slice.label}
            </span>
          )}
          <span className="font-semibold tabular-nums text-fg">
            {slice.value}
          </span>
          <span className="w-9 text-end tabular-nums text-muted">
            {percentOf(slice.value, total)}%
          </span>
        </li>
      ))}
    </ul>
  )

  const ring = (
    <div
      className={cn('relative', legend === 'side' && 'min-w-0 flex-1')}
      role="img"
      aria-label={ariaLabel}
    >
      <div
        className={fill ? 'h-full' : undefined}
        style={fill ? { minHeight: height } : { height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* No slide of the tooltip from the previous point to the next
                (owner 2026-11-01, «الانيميشن حق ظهور الرقم عند الـ hover
                غريب»): it fades in where the pointer is («خليه fade خفيف»). */}
            <Tooltip
              isAnimationActive={false}
              wrapperStyle={TOOLTIP_WRAPPER_STYLE}
              content={renderTooltip}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="66%"
              outerRadius="96%"
              paddingAngle={2.5}
              // Owner 2026-11-01, «خفف الradius»: 3 instead of 6.
              cornerRadius={3}
              stroke="none"
              {...animation}
            >
              {slices.map((slice) => (
                <Cell key={slice.id} fill={fillOf(slice)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none tabular-nums text-fg">
          {middle}
        </span>
        <span className="mt-1 text-[11px] text-muted">{centerLabel}</span>
      </div>
    </div>
  )

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={total === 0}
      minHeight={height}
      className={cn(
        legend === 'side' ? 'flex items-stretch gap-3' : 'space-y-2',
        fill && 'min-h-0 flex-1',
        className,
      )}
    >
      {ring}
      {list}
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
