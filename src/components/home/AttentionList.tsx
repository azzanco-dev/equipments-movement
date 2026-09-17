import type { ReactNode } from 'react'
import { AlertCircle, ChevronLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Badge } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { cn } from '@/components/ui/cn'

export interface AttentionItem {
  id: string
  /** What needs following up, for example open visits over 30 days. */
  label: ReactNode
  /** How many records match; `0` rows stay visible so the zero is readable. */
  count: number
  /** Optional second line with the rule behind the number. */
  hint?: ReactNode
  /** Colors the count badge only. */
  tone?: BadgeTone
  /** Makes the row a button, for example to open the filtered list. */
  onClick?: () => void
}

export interface AttentionListProps {
  items: AttentionItem[]
  loading?: boolean
  /** Truthy renders the error state; `true` uses the default message. */
  error?: ReactNode
  /** Shown when there is nothing to follow up and no error. */
  empty?: ReactNode
  loadingRows?: number
  className?: string
}

/**
 * Compact follow-up list for a dashboard section. It keeps the empty state and
 * the load-failure state visually distinct, so a failed fetch is never shown
 * as "nothing needs attention".
 */
export function AttentionList({
  items,
  loading = false,
  error,
  empty,
  loadingRows = 3,
  className,
}: AttentionListProps) {
  const { t } = useI18n()
  const hasError = error !== undefined && error !== null && error !== false

  if (hasError)
    return (
      <div
        role="alert"
        className={cn(
          'flex items-start gap-2.5 rounded-lg border-s-4 border-danger bg-danger-soft px-3 py-4 text-sm font-medium text-danger',
          className,
        )}
      >
        <AlertCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{error === true ? t('dataLoadError') : error}</span>
      </div>
    )

  if (loading)
    return (
      <ul
        aria-busy="true"
        className={cn('divide-y rounded-lg border', className)}
      >
        <li className="sr-only">{t('loading')}</li>
        {Array.from({ length: Math.max(1, loadingRows) }).map((_, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <span className="block h-3.5 w-40 max-w-full animate-pulse rounded bg-surface-hover" />
            <span className="block h-5 w-8 shrink-0 animate-pulse rounded-full bg-surface-hover" />
          </li>
        ))}
      </ul>
    )

  if (items.length === 0)
    return (
      <p
        className={cn(
          'rounded-lg border px-3 py-6 text-center text-sm text-muted',
          className,
        )}
      >
        {empty ?? t('noAttentionItems')}
      </p>
    )

  return (
    <ul className={cn('divide-y rounded-lg border', className)}>
      {items.map((item) => {
        const content = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg">{item.label}</span>
              {item.hint && (
                <span className="mt-0.5 block text-xs text-muted">
                  {item.hint}
                </span>
              )}
            </span>
            <Badge tone={item.tone ?? 'neutral'} className="tabular-nums">
              {item.count}
            </Badge>
            {item.onClick && (
              <ChevronLeft
                size={15}
                aria-hidden="true"
                className="shrink-0 text-muted ltr:rotate-180"
              />
            )}
          </>
        )
        return (
          <li key={item.id}>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-surface-hover"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5">
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
