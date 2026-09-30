import type { ReactNode } from 'react'
import { cn } from './cn'
import { LtrValue } from './InfoGrid'

export interface InfoRowProps {
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  /** Forces left-to-right for phone numbers, codes, plate numbers, etc. The
   *  value is isolated in an inline LTR run (`LtrValue`) and stays under its
   *  label at the start edge; `dir` is never set on the block itself. */
  dir?: 'ltr'
  className?: string
}

/** A single labelled value, RTL-safe. Missing values show "—" rather than
 * a blank line. For more than one row, prefer `DescriptionList`. */
export function InfoRow({ icon, label, value, dir, className }: InfoRowProps) {
  const isEmpty = value === null || value === undefined || value === ''
  return (
    <div className={cn('flex items-start gap-3 py-2', className)}>
      {icon && (
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p
          className={cn(
            'break-words text-start leading-relaxed',
            isEmpty ? 'text-muted' : 'font-medium',
          )}
        >
          {isEmpty ? '—' : dir === 'ltr' ? <LtrValue>{value}</LtrValue> : value}
        </p>
      </div>
    </div>
  )
}
