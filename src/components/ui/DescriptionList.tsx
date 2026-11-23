import type { ReactNode } from 'react'
import { cn } from './cn'
import { LtrValue } from './InfoGrid'

export interface DescriptionListItem {
  key?: string
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  /** Forces left-to-right for phone numbers, codes, plate numbers, etc. The
   *  value is isolated in an inline LTR run (`LtrValue`) and stays under its
   *  label at the start edge; `dir` is never set on the block itself. */
  dir?: 'ltr'
}

export interface DescriptionListProps {
  items: DescriptionListItem[]
  /** Two columns from the `sm` breakpoint up; one column stacks on mobile. */
  columns?: 1 | 2
  /** Tighter rows and smaller text (the installments contract page, owner
   *  2026-11-23). Every other screen keeps the default. */
  dense?: boolean
  className?: string
}

/** A block of labelled values (a movement or equipment summary, for
 * example). Missing values show "—"; long values wrap instead of clipping. */
export function DescriptionList({
  items,
  columns = 1,
  dense = false,
  className,
}: DescriptionListProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6',
        columns === 2 && 'sm:grid-cols-2',
        className,
      )}
    >
      {items.map((item, index) => {
        const isEmpty =
          item.value === null || item.value === undefined || item.value === ''
        return (
          <div
            key={item.key ?? index}
            className={cn(
              'flex items-start',
              dense ? 'gap-2.5 py-1.5' : 'gap-3 py-2',
            )}
          >
            {item.icon && (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
                {item.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <dt
                className={cn('text-muted', dense ? 'text-[11px]' : 'text-xs')}
              >
                {item.label}
              </dt>
              <dd
                className={cn(
                  'm-0 break-words text-start leading-relaxed',
                  dense && 'text-[13px]',
                  isEmpty ? 'text-muted' : 'font-medium',
                )}
              >
                {isEmpty ? (
                  '—'
                ) : item.dir === 'ltr' ? (
                  <LtrValue>{item.value}</LtrValue>
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
