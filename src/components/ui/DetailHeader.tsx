import type { ReactNode } from 'react'
import { cn } from './cn'
import { LtrValue } from './InfoGrid'

export interface DetailHeaderProps {
  /** The big identifying value: an equipment code, a driver's name, a
   *  movement's type. */
  identifier: ReactNode
  /** Set when `identifier` is a Latin/LTR value (a code, a VIN) so it is
   *  isolated through `LtrValue` and still hugs the start edge in RTL,
   *  instead of `dir="ltr"` on the heading pulling it to the left. */
  identifierLtr?: boolean
  /** One-line supporting text under the identifier: a type, a role, a
   *  short description. */
  subtitle?: ReactNode
  /** Same as `identifierLtr`, for `subtitle`. */
  subtitleLtr?: boolean
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
  identifierLtr,
  subtitle,
  subtitleLtr,
  badges,
  actions,
  as: Heading = 'h2',
  className,
}: DetailHeaderProps) {
  const isIdentifierString = typeof identifier === 'string'
  const isSubtitleString = typeof subtitle === 'string'
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading
            title={isIdentifierString ? identifier : undefined}
            className="min-w-0 truncate-safe text-start text-lg font-bold text-fg sm:text-xl"
          >
            {identifierLtr ? (
              <LtrValue truncate={isIdentifierString}>{identifier}</LtrValue>
            ) : (
              identifier
            )}
          </Heading>
          {badges && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {badges}
            </div>
          )}
        </div>
        {subtitle && (
          <p
            title={isSubtitleString ? subtitle : undefined}
            className="mt-0.5 min-w-0 truncate-safe text-start text-sm text-muted"
          >
            {subtitleLtr ? (
              <LtrValue truncate={isSubtitleString}>{subtitle}</LtrValue>
            ) : (
              subtitle
            )}
          </p>
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
