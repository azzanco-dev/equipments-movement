import { useMemo, type ReactNode } from 'react'
import { cn } from '@/components/ui/cn'
import {
  ChartLegend,
  ChartShell,
  ChartSrTable,
  percentOf,
  seriesColor,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface DonutSlice {
  id: string
  label: string
  value: number
  /** CSS color; pass a token such as `var(--entry)`. Defaults to the palette. */
  color?: string
}

export interface DonutChartProps extends ChartBaseProps {
  slices: DonutSlice[]
  /** Big number in the hole; defaults to the total of all slices. */
  centerValue?: ReactNode
  /** Small caption under the center value. */
  centerLabel?: ReactNode
  /** Ring thickness as a share of the radius (0–1). */
  thickness?: number
  legend?: boolean
}

const SIZE = 180
const RADIUS = 78

function polar(angle: number, radius: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: SIZE / 2 + radius * Math.cos(radians),
    y: SIZE / 2 + radius * Math.sin(radians),
  }
}

function arcPath(start: number, end: number, outer: number, inner: number) {
  const largeArc = end - start > 180 ? 1 : 0
  const outerStart = polar(start, outer)
  const outerEnd = polar(end, outer)
  const innerEnd = polar(end, inner)
  const innerStart = polar(start, inner)
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

/**
 * Share-of-total ring. Dependency-free SVG with a legend that repeats every
 * value and percentage, so the shapes are never the only way to read it.
 */
export function DonutChart({
  slices,
  ariaLabel,
  lang,
  centerValue,
  centerLabel,
  thickness = 0.36,
  legend = true,
  loading,
  error,
  className,
}: DonutChartProps) {
  const t = useChartText(lang)
  const total = useMemo(
    () => slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0),
    [slices],
  )
  const inner = RADIUS * (1 - Math.min(0.9, Math.max(0.1, thickness)))

  const segments = useMemo(() => {
    let cursor = 0
    return slices.map((slice, index) => {
      const share = total > 0 ? Math.max(0, slice.value) / total : 0
      const start = cursor * 360
      cursor += share
      // A full circle cannot be drawn with a single arc; stop just short.
      const end = share >= 1 ? 359.999 : cursor * 360
      return {
        slice,
        color: seriesColor(index, slice.color),
        path: arcPath(start, end, RADIUS, inner),
        percent: percentOf(slice.value, total),
      }
    })
  }, [inner, slices, total])

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={total <= 0}
      minHeight={SIZE}
      className={cn(
        'flex flex-col items-center gap-3 sm:flex-row sm:items-center',
        className,
      )}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-40 w-40 shrink-0"
      >
        {segments.map((segment) => (
          <path key={segment.slice.id} d={segment.path} fill={segment.color}>
            <title>{`${segment.slice.label}: ${segment.slice.value} (${segment.percent}%)`}</title>
          </path>
        ))}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 2}
          textAnchor="middle"
          fontSize={26}
          fontWeight={600}
          fill="var(--fg)"
        >
          {centerValue ?? total}
        </text>
        {centerLabel && (
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--muted)"
          >
            {centerLabel}
          </text>
        )}
      </svg>

      <div className="min-w-0 flex-1">
        {legend && (
          <ChartLegend
            className="flex-col gap-y-2"
            items={segments.map((segment) => ({
              id: segment.slice.id,
              label: segment.slice.label,
              color: segment.color,
              value: segment.slice.value,
              percent: segment.percent,
            }))}
          />
        )}
      </div>

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), t('chartValue'), t('chartShare')]}
        rows={segments.map((segment) => [
          segment.slice.label,
          segment.slice.value,
          `${segment.percent}%`,
        ])}
      />
    </ChartShell>
  )
}
