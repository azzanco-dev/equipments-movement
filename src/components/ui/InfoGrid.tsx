import type { ReactNode } from 'react'
import { SectionHeader } from './Card'
import { cn } from './cn'

export interface InfoGridItem {
  key: string
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  /** Right-shifts nothing on its own, but gives numeric values tabular
   *  figures so digits line up down the column. */
  numeric?: boolean
  /** Forces left-to-right: codes, plate numbers, phone numbers, ids. */
  dir?: 'ltr'
  className?: string
}

export interface InfoGridProps {
  items: InfoGridItem[]
  /** 2 columns from `sm` up; pass 3 (the default) to also widen to 3 from
   *  `lg`. One column stacks on mobile either way. */
  columns?: 2 | 3
  className?: string
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
        return (
          <div key={item.key} className="flex min-w-0 items-start gap-2.5">
            {item.icon && (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
                {item.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd
                dir={item.dir}
                title={
                  isString && !isEmpty ? (item.value as string) : undefined
                }
                className={cn(
                  'm-0 leading-relaxed',
                  isString && 'truncate',
                  isEmpty ? 'text-muted' : 'font-medium text-fg',
                  item.numeric && 'tabular-nums',
                  item.className,
                )}
              >
                {isEmpty ? '—' : item.value}
              </dd>
            </div>
          </div>
        )
      })}
    </dl>
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
