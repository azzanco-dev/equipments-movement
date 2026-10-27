import type { ElementType, ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps {
  children: ReactNode
  /** Element to render; `section` by default so cards are landmarks. */
  as?: ElementType
  /** Removes the default padding when the card hosts a full-bleed table. */
  padded?: boolean
  className?: string
}

/**
 * Surface container built on the approved `.card` style (token border, token
 * background, 12 px radius). `padded={false}` lets a table or list reach the
 * card edges; section padding is then added by the children.
 */
export function Card({
  children,
  as: Tag = 'section',
  padded = true,
  className,
}: CardProps) {
  return (
    <Tag className={cn('card min-w-0 max-w-full', !padded && 'p-0', className)}>
      {children}
    </Tag>
  )
}

export interface SectionHeaderProps {
  title: ReactNode
  /** Short supporting line under the title. */
  description?: ReactNode
  /** Trailing slot for a link or button (end side in RTL and LTR). */
  action?: ReactNode
  /** Heading level, so pages keep a correct heading outline. */
  as?: 'h2' | 'h3' | 'h4'
  /** Keeps the action on the text's row however long the description is,
   *  instead of wrapping it onto a row of its own. */
  actionBesideText?: boolean
  className?: string
}

/** Title + optional description with a trailing action slot. */
export function SectionHeader({
  title,
  description,
  action,
  as: Heading = 'h3',
  actionBesideText = false,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-x-3 gap-y-2',
        !actionBesideText && 'flex-wrap',
        className,
      )}
    >
      <div className={cn('min-w-0', actionBesideText && 'flex-1')}>
        <Heading className="text-sm font-semibold text-fg">{title}</Heading>
        {description && (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
