import type { ReactNode } from 'react'
import { SectionHeader } from './Card'
import { cn } from './cn'
import { Skeleton } from './Skeleton'

export interface InfoGridItem {
  key: string
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  /** Right-shifts nothing on its own, but gives numeric values tabular
   *  figures so digits line up down the column. */
  numeric?: boolean
  /** Forces left-to-right: codes, plate numbers, phone numbers, ids. The
   *  value is isolated in its own LTR run (see `LtrValue`) instead of
   *  having `dir="ltr"` set on the block-level value itself, which would
   *  change that block's own start edge to the left and pull the value
   *  away from its label in an RTL layout. */
  dir?: 'ltr'
  /** Classes for the value (`<dd>`) only. */
  className?: string
  /** Classes for the grid cell itself (the label + value wrapper), for
   *  example a `col-span` that lets a long value use the whole row. */
  cellClassName?: string
}

export interface InfoGridProps {
  items: InfoGridItem[]
  /** 2 columns from `sm` up; pass 3 (the default) to also widen to 3 from
   *  `lg`. One column stacks on mobile either way. */
  columns?: 2 | 3
  className?: string
}

/**
 * Isolates an LTR value (a code, a plate number, a phone number, an id) so
 * its glyphs render left-to-right while the run itself still hugs the
 * start edge of its RTL container, instead of the whole value jumping to
 * the opposite side. `<bdi>` (unicode-bidi: isolate) does this without
 * being a block: `inline-block` makes it hug only its own content width,
 * and `dir="ltr"` on the block ancestor would otherwise flip that
 * ancestor's own `text-align: start` from right to left.
 */
export function LtrValue({
  children,
  truncate,
  className,
}: {
  children: ReactNode
  /** Truncates with `.truncate-safe` (keeps Arabic descenders elsewhere on
   *  the page from being clipped; here it only affects this LTR run). */
  truncate?: boolean
  className?: string
}) {
  return (
    <bdi
      dir="ltr"
      className={cn(
        'inline-block max-w-full align-top',
        truncate && 'truncate-safe',
        className,
      )}
    >
      {children}
    </bdi>
  )
}

/**
 * Responsive grid of label/value pairs for a detail page or dialog section.
 * Missing values show "—". A plain-string value that is too long to fit
 * truncates with an ellipsis and carries the full text in `title`; a
 * `ReactNode` value (a `Badge`, for example) is never truncated since there
 * is no single string to shorten.
 */
export function InfoGrid({ items, columns = 3, className }: InfoGridProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => {
        const isEmpty =
          item.value === null || item.value === undefined || item.value === ''
        const isString = typeof item.value === 'string'
        const isLtr = item.dir === 'ltr' && !isEmpty
        return (
          <div
            key={item.key}
            className={cn(
              'flex min-w-0 items-start gap-2.5',
              item.cellClassName,
            )}
          >
            {item.icon && (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
                {item.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd
                title={
                  isString && !isEmpty ? (item.value as string) : undefined
                }
                className={cn(
                  'm-0 block min-w-0 text-start leading-relaxed',
                  isEmpty ? 'text-muted' : 'font-medium text-fg',
                  item.numeric && 'tabular-nums',
                  !isLtr && isString && 'truncate-safe',
                  item.className,
                )}
              >
                {isEmpty ? (
                  '—'
                ) : isLtr ? (
                  <LtrValue truncate={isString}>{item.value}</LtrValue>
                ) : (
                  item.value
                )}
              </dd>
            </div>
          </div>
        )
      })}
    </dl>
  )
}

export interface InfoGridSkeletonProps {
  /** Number of label/value cells to draw. */
  count: number
  columns?: 2 | 3
  /** Draws the leading icon placeholder, for grids whose items have icons. */
  withIcon?: boolean
  className?: string
}

const SKELETON_VALUE_WIDTHS = ['w-2/3', 'w-1/2', 'w-3/4', 'w-3/5', 'w-2/5']

/**
 * Loading placeholder with the exact grid and cell box of `InfoGrid` (a 16px
 * label line over a 24px value line), so a page skeleton built from it does
 * not shift when the real grid replaces it. Purely decorative: the caller
 * owns the `aria-busy` wrapper and the "loading" announcement.
 */
export function InfoGridSkeleton({
  count,
  columns = 3,
  withIcon = false,
  className,
}: InfoGridSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-w-0 items-start gap-2.5">
          {withIcon && (
            <Skeleton variant="circle" className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex h-4 items-center">
              <Skeleton variant="text" className="w-1/3" />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton
                variant="text"
                className={cn(
                  'h-4',
                  SKELETON_VALUE_WIDTHS[index % SKELETON_VALUE_WIDTHS.length],
                )}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export interface InfoGridSectionProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  items: InfoGridItem[]
  columns?: 2 | 3
  className?: string
}

/** `SectionHeader` + `InfoGrid` together, for a named detail-page section
 *  such as "Identity" or "Ownership". */
export function InfoGridSection({
  title,
  description,
  action,
  items,
  columns,
  className,
}: InfoGridSectionProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <SectionHeader title={title} description={description} action={action} />
      <InfoGrid items={items} columns={columns} />
    </div>
  )
}
