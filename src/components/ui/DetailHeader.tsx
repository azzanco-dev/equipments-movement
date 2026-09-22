import type { ReactNode } from 'react'
import { cn } from './cn'

export interface DetailHeaderProps {
  /** The big identifying value: an equipment code, a driver's name, a
   *  movement's type. */
  identifier: ReactNode
  /** One-line supporting text under the identifier: a type, a role, a
   *  short description. */
  subtitle?: ReactNode
  /** Status badges shown next to the identifier (ENTRY/EXIT, ownership,
   *  operational status, and so on). */
  badges?: ReactNode
  /** Trailing actions (edit, toggle). Full width and wraps below the
   *  identifier on mobile; end-aligned beside it from `sm` up. */
  actions?: ReactNode
  /** Heading level, so pages keep a correct heading outline. */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/**
 * Header for a detail page or dialog: a big identifier with optional status
 * badges, a one-line subtitle, and an actions slot. Meant to replace the
 * ad hoc `PageHeader` + banner combinations on movement/equipment/driver
 * detail pages once those screens are migrated (not part of this change).
 */
export function DetailHeader({
  identifier,
  subtitle,
  badges,
  actions,
  as: Heading = 'h2',
  className,
}: DetailHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="truncate text-lg font-bold text-fg sm:text-xl">
            {identifier}
          </Heading>
          {badges && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {badges}
            </div>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {actions}
        </div>
      )}
    </div>
  )
}
