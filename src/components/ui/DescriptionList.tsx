import type { ReactNode } from 'react'
import { cn } from './cn'

export interface DescriptionListItem {
  key?: string
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  /** Forces left-to-right for phone numbers, codes, plate numbers, etc. */
  dir?: 'ltr'
}

export interface DescriptionListProps {
  items: DescriptionListItem[]
  /** Two columns from the `sm` breakpoint up; one column stacks on mobile. */
  columns?: 1 | 2
  className?: string
}

/** A block of labelled values (a movement or equipment summary, for
 * example). Missing values show "—"; long values wrap instead of clipping. */
export function DescriptionList({
  items,
  columns = 1,
  className,
}: DescriptionListProps) {
  return (
    <dl
      className={cn(
        'grid gap-x-6',
        columns === 2 && 'sm:grid-cols-2',
        className,
      )}
    >
      {items.map((item, index) => {
        const isEmpty =
          item.value === null || item.value === undefined || item.value === ''
        return (
          <div key={item.key ?? index} className="flex items-start gap-3 py-2">
            {item.icon && (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
                {item.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd
                dir={item.dir}
                className={cn(
                  'm-0 break-words leading-relaxed',
                  isEmpty ? 'text-muted' : 'font-medium',
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
