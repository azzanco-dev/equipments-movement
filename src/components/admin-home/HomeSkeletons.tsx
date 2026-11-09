import { Skeleton, cn } from '@/components/ui'

/**
 * Loading placeholders shaped like the admin home blocks (owner 2026-11-09,
 * «واضف skeleton»): each block shows the outline of what is coming — the KPI
 * tiles, a ring with its legend, bars, rows, the Afaqy figures, the area of
 * the entries chart — at the height the content takes, so the page does not
 * jump when the data arrives. Built on the shared `Skeleton` (its pulse stops
 * under reduced motion through the global rule in index.css). Decorative
 * only: `HomeBlock` announces «جاري التحميل» once beside it.
 */

/** Fixed lengths, so the shapes never change between renders. */
const LINE_WIDTHS = ['w-24', 'w-16', 'w-20', 'w-28', 'w-14', 'w-24', 'w-20']

function widthAt(index: number): string {
  return LINE_WIDTHS[index % LINE_WIDTHS.length]
}

/** The segmented tabs some blocks carry above their body. */
function TabsSkeleton() {
  return <Skeleton className="mb-2 h-7 w-40" />
}

/** The eight KPI tiles: a label, the wide figure, a thin bar under it. */
export function KpiStripSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="flex h-[104px] min-w-0 flex-col justify-between rounded-2xl border bg-bg p-4"
        >
          <span className="flex items-center gap-2">
            <Skeleton variant="circle" className="h-7 w-7 shrink-0" />
            <Skeleton className={cn('h-3', widthAt(index))} />
          </span>
          <span className="flex items-end justify-between gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-2 w-16 rounded-full" />
          </span>
          <Skeleton className="h-3 w-10 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * A donut card: a hollow ring (a thick border in the surface token) beside
 * its legend lines, optionally under the block's tabs and over a few lines.
 */
export function DonutSkeleton({
  tabs = false,
  legendRows = 4,
  footerRows = 0,
  footerButton = false,
}: {
  tabs?: boolean
  legendRows?: number
  footerRows?: number
  footerButton?: boolean
}) {
  return (
    <div aria-hidden="true">
      {tabs && <TabsSkeleton />}
      <div className="flex h-[190px] items-center gap-4">
        <span className="flex min-w-0 flex-1 items-center justify-center">
          <span className="block h-[150px] w-[150px] shrink-0 animate-pulse rounded-full border-[22px] border-surface" />
        </span>
        <ul className="shrink-0 space-y-2.5">
          {Array.from({ length: legendRows }, (_, index) => (
            <li key={index} className="flex items-center gap-2">
              <Skeleton variant="circle" className="h-2.5 w-2.5 shrink-0" />
              <Skeleton className={cn('h-3', widthAt(index))} />
              <Skeleton className="h-3 w-6" />
            </li>
          ))}
        </ul>
      </div>
      {footerRows > 0 && (
        <ul className="mt-2 space-y-2.5 border-t pt-2.5">
          {Array.from({ length: footerRows }, (_, index) => (
            <li key={index} className="flex items-center gap-2">
              <Skeleton variant="circle" className="h-3.5 w-3.5 shrink-0" />
              <Skeleton className={cn('h-3', widthAt(index + 3))} />
              <Skeleton className="h-3 w-6" />
            </li>
          ))}
        </ul>
      )}
      {footerButton && <Skeleton className="mt-3 h-7 w-28" />}
    </div>
  )
}

/** Varying bar lengths, as percentages of the block. */
const BAR_SIZES = [86, 64, 52, 40, 30, 22]

/** A vertical bar chart: five bars of falling heights over an axis. */
export function VerticalBarsSkeleton({ height = 210 }: { height?: number }) {
  return (
    <div aria-hidden="true" style={{ height }} className="flex flex-col">
      <div className="flex min-h-0 flex-1 items-end justify-around gap-3 border-b px-2">
        {BAR_SIZES.slice(0, 5).map((size, index) => (
          <Skeleton
            key={index}

            className="w-full max-w-[40px]"
            style={{ height: `${size}%` }}
          />
        ))}
      </div>
      <div className="flex justify-around gap-3 px-2 pt-2">
        {BAR_SIZES.slice(0, 5).map((_, index) => (
          <Skeleton key={index} className="h-2.5 w-10" />
        ))}
      </div>
    </div>
  )
}

/** Horizontal bar rows: a label, a bar of varying length, two figures. */
export function BarRowsSkeleton({
  rows = 6,
  legend = true,
}: {
  rows?: number
  legend?: boolean
}) {
  return (
    <div aria-hidden="true">
      <ul className="space-y-2.5">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex h-5 items-center gap-2">
            <Skeleton className={cn('h-3 shrink-0 sm:w-28', widthAt(index))} />
            <span className="flex h-2.5 min-w-0 flex-1">
              <Skeleton
                className="h-2.5 rounded-full"
                style={{ width: `${BAR_SIZES[index % BAR_SIZES.length]}%` }}
              />
            </span>
            <Skeleton className="h-3 w-7 shrink-0" />
            <Skeleton className="h-3 w-7 shrink-0" />
          </li>
        ))}
      </ul>
      {legend && (
        <div className="mt-2.5 flex gap-3 border-t pt-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-2.5 w-14" />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Rows of a list or a small table: two lines each (a title and its muted
 * line), with an optional icon tile at the start and a figure at the end.
 */
export function ListRowsSkeleton({
  rows = 6,
  icon = false,
  tabs = false,
}: {
  rows?: number
  icon?: boolean
  tabs?: boolean
}) {
  return (
    <div aria-hidden="true">
      {tabs && <TabsSkeleton />}
      <ul className="divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-center gap-2.5 py-2.5">
            {icon && <Skeleton className="h-7 w-7 shrink-0" />}
            <span className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={cn('h-3', widthAt(index))} />
              <Skeleton className={cn('h-2.5', widthAt(index + 2))} />
            </span>
            <Skeleton className="h-4 w-10 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The Afaqy block: four small figures, the state bar and three units. */
export function AfaqySkeleton() {
  return (
    <div aria-hidden="true">
      <ul className="grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <li
            key={index}
            className="flex items-center gap-2 rounded-lg border px-2 py-2.5"
          >
            <Skeleton variant="circle" className="h-6 w-6 shrink-0" />
            <span className="space-y-1.5">
              <Skeleton className="h-4 w-8" />
              <Skeleton className={cn('h-2.5', widthAt(index))} />
            </span>
          </li>
        ))}
      </ul>
      <Skeleton className="mt-2.5 h-2 w-full rounded-full" />
      <Skeleton className="mt-1.5 h-2.5 w-32" />
      <ul className="mt-2 divide-y border-t">
        {[0, 1, 2].map((index) => (
          <li key={index} className="flex justify-between gap-2 py-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className={cn('h-3', widthAt(index + 1))} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The entries chart: its two totals over the silhouette of an area. */
export function AreaSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div aria-hidden="true">
      <div className="mb-1 flex h-5 items-center gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div style={{ height }} className="flex flex-col">
        <svg
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
          className="block min-h-0 w-full flex-1 animate-pulse border-b"
        >
          <path
            d="M0 70 C 30 55, 50 62, 75 48 S 120 30, 150 44 S 200 66, 225 40 S 270 22, 300 34 L 300 100 L 0 100 Z"
            fill="var(--surface)"
          />
        </svg>
        <div className="flex justify-between pt-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-2.5 w-8" />
          ))}
        </div>
      </div>
    </div>
  )
}
