import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Button } from './Button'
import { cn } from './cn'

export interface BackButtonProps {
  onClick: () => void
  /** Defaults to the shared "back" string. */
  label?: string
  className?: string
}

/** A ghost button with a direction-aware chevron (mirrored in RTL via the
 * shared `.rtl-flip` utility, same as the rest of the app). */
export function BackButton({ onClick, label, className }: BackButtonProps) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn('-ms-2', className)}
      icon={<ArrowLeft size={16} aria-hidden="true" className="rtl-flip" />}
    >
      {label ?? t('back')}
    </Button>
  )
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Action buttons, rendered at the end side and wrapping on mobile. */
  actions?: ReactNode
  /** Renders a `BackButton` above the title when provided. */
  onBack?: () => void
  backLabel?: string
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  onBack,
  backLabel,
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
          <BackButton onClick={onBack} label={backLabel} className="mb-1" />
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
