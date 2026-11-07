import type { ReactNode } from 'react'
import { cn } from './cn'
import { PageTrailBar } from './PageTrail'

export { BackButton } from './BackButton'
export type { BackButtonProps } from './BackButton'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Action buttons, rendered at the end side and wrapping on mobile. */
  actions?: ReactNode
  /** Renders the page trail and its back button above the title when
   *  provided (src/components/ui/PageTrail.tsx); outside a trail, a plain
   *  `BackButton` labelled `backLabel`. */
  onBack?: () => void
  backLabel?: string
  /** Asked before a crumb of the trail navigates (unsaved changes). */
  confirmLeave?: () => Promise<boolean>
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  onBack,
  backLabel,
  confirmLeave,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {onBack && (
          <PageTrailBar
            onBack={onBack}
            fallbackLabel={backLabel}
            confirmLeave={confirmLeave}
            className="mb-1"
          />
        )}
        {/* No letter-spacing: it breaks Arabic glyph joining. */}
        <h1 className="text-2xl font-bold sm:text-[28px]">{title}</h1>
        {description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
