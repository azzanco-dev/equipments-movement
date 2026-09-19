import { useMemo } from 'react'
import { cn } from '@/components/ui/cn'
import {
  ChartLegend,
  ChartShell,
  ChartSrTable,
  percentOf,
  seriesColor,
  useChartDirection,
  useChartText,
  type ChartBaseProps,
} from './chartShared'

export interface StackedBarSegment {
  id: string
  label: string
  value: number
  /** CSS color; pass a token such as `var(--info)`. Defaults to the palette. */
  color?: string
}

export interface StackedBarProps extends ChartBaseProps {
  segments: StackedBarSegment[]
  /** Bar thickness in viewBox units. */
  height?: number
  legend?: boolean
}

const WIDTH = 720

/**
 * One horizontal bar split by share of a total (fleet by owner). Segments are
 * laid out from the start side, so the bar reads right to left in Arabic.
 */
export function StackedBar({
  segments,
  ariaLabel,
  dir,
  lang,
  height = 22,
  legend = true,
  loading,
  error,
  className,
}: StackedBarProps) {
  const direction = useChartDirection(dir)
  const t = useChartText(lang)
  const rtl = direction === 'rtl'

  const total = useMemo(
    () => segments.reduce((sum, item) => sum + Math.max(0, item.value), 0),
    [segments],
  )

  const laid = useMemo(() => {
    let cursor = 0
    return segments.map((segment, index) => {
      const width = total > 0 ? (Math.max(0, segment.value) / total) * WIDTH : 0
      const offset = cursor
      cursor += width
      return {
        segment,
        color: seriesColor(index, segment.color),
        x: rtl ? WIDTH - offset - width : offset,
        width,
        percent: percentOf(segment.value, total),
      }
    })
  }, [rtl, segments, total])

  return (
    <ChartShell
      loading={loading}
      error={error}
      isEmpty={total <= 0}
      minHeight={height + 40}
      className={cn('space-y-2', className)}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {laid.map((item) => (
          <rect
            key={item.segment.id}
            x={item.x}
            y={0}
            width={Math.max(0, item.width)}
            height={height}
            fill={item.color}
          >
            <title>{`${item.segment.label}: ${item.segment.value} (${item.percent}%)`}</title>
          </rect>
        ))}
      </svg>

      {legend && (
        <ChartLegend
          items={laid.map((item) => ({
            id: item.segment.id,
            label: item.segment.label,
            color: item.color,
            value: item.segment.value,
            percent: item.percent,
          }))}
        />
      )}

      <ChartSrTable
        caption={ariaLabel}
        columns={[t('chartCategory'), t('chartValue'), t('chartShare')]}
        rows={laid.map((item) => [
          item.segment.label,
          item.segment.value,
          `${item.percent}%`,
        ])}
      />
    </ChartShell>
  )
}
