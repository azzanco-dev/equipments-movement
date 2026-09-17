import type { ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Button } from './Button'
import { cn } from './cn'

export interface ErrorStateProps {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * A failed load — visually distinct (danger-soft) from `EmptyState` so a
 * broken request never reads as "no data". Always prefer this over an empty
 * list or table when a fetch fails.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-danger bg-danger-soft p-8 text-center',
        className,
      )}
    >
      <AlertCircle size={28} aria-hidden="true" className="text-danger" />
      <div className="space-y-1">
        <p className="font-medium text-danger">{title ?? t('dataLoadError')}</p>
        {description && <p className="text-sm text-danger">{description}</p>}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          onClick={onRetry}
          className="mt-1"
        >
          {retryLabel ?? t('retry')}
        </Button>
      )}
    </div>
  )
}
