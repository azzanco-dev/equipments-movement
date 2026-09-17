import type { CSSProperties, ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'
import type { BadgeTone } from './Badge'

export type StatCardTone = BadgeTone

export interface StatCardProps {
  /** Short label above the number. */
  label: ReactNode
  /** The number itself; callers format it. */
  value: ReactNode
  /** Optional supporting line under the value. */
  hint?: ReactNode
  /** Decorative icon on the end side. */
  icon?: ReactNode
  /** Colors the value only; `neutral` keeps it on the text token. */
  tone?: StatCardTone
  /** Makes the whole card a button, for example to open a filtered list. */
  onClick?: () => void
  /** Replaces the value with a skeleton and announces a busy state. */
  loading?: boolean
  className?: string
}

function valueStyle(tone: StatCardTone): CSSProperties | undefined {
  if (tone === 'neutral') return undefined
  return { color: `var(--${tone})` }
}

/**
 * One number on a dashboard. It never fetches: the caller owns the value and
 * the loading state, so the same card works for live data and for review.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  onClick,
  loading = false,
  className,
}: StatCardProps) {
  const { t } = useI18n()
  const classes = cn(
    'flex w-full items-start justify-between gap-2 rounded-xl border bg-bg p-3 text-start transition-colors',
    onClick && 'hover:border-fg hover:bg-surface-hover',
    className,
  )
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="truncate-safe block text-xs text-muted">{label}</span>
        {loading ? (
          <>
            <span className="mt-1.5 block h-6 w-12 animate-pulse rounded bg-surface-hover" />
            <span className="sr-only">{t('loading')}</span>
          </>
        ) : (
          <span
            className="mt-0.5 block text-2xl font-semibold leading-tight tabular-nums"
            style={valueStyle(tone)}
          >
            {value}
          </span>
        )}
        {hint && !loading && (
          <span className="truncate-safe mt-0.5 block text-xs text-muted">
            {hint}
          </span>
        )}
      </span>
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-muted">
          {icon}
        </span>
      )}
    </>
  )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    )
  return (
    <div aria-busy={loading || undefined} className={classes}>
      {body}
    </div>
  )
}
