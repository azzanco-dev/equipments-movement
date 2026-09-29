import type { CSSProperties, ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'
import type { BadgeTone } from './Badge'

export type StatCardTone = BadgeTone

/**
 * The accent colour of a card in the accented look. The functional tones use
 * their own token pair (`--success` / `--success-soft`, ...), `primary` is the
 * monochrome foreground, and `chart-N` borrows the light chart pair
 * (`--chart-stroke-N` / `--chart-N`) for a hue that carries no status meaning.
 */
export type StatCardAccent =
  | StatCardTone
  | 'primary'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'

export interface StatCardProps {
  /** Short label above the number. */
  label: ReactNode
  /** The number itself; callers format it. */
  value: ReactNode
  /** Optional supporting line under the value. */
  hint?: ReactNode
  /** Decorative icon: on the end side, or before the label when `accent` is set. */
  icon?: ReactNode
  /** Colors the value only; `neutral` keeps it on the text token. */
  tone?: StatCardTone
  /**
   * Opts into the accented look (admin home, owner request 2026-09-30): the
   * icon sits in a small soft tinted circle before the label and the number is
   * bold. The card border stays the normal token border. Without it the card
   * is exactly the plain card every other screen already uses.
   */
  accent?: StatCardAccent
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

/** The strong (icon) and soft (circle fill) token of an accent. */
function accentColors(accent: StatCardAccent): {
  strong: string
  soft: string
} {
  if (accent === 'neutral')
    return { strong: 'var(--muted)', soft: 'var(--surface-hover)' }
  if (accent === 'primary')
    return { strong: 'var(--primary)', soft: 'var(--surface-hover)' }
  if (accent.startsWith('chart-')) {
    const index = accent.slice('chart-'.length)
    return {
      strong: `var(--chart-stroke-${index})`,
      soft: `var(--chart-${index})`,
    }
  }
  return { strong: `var(--${accent})`, soft: `var(--${accent}-soft)` }
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
  accent,
  onClick,
  loading = false,
  className,
}: StatCardProps) {
  const { t } = useI18n()
  const colors = accent ? accentColors(accent) : null
  const classes = cn(
    'flex w-full items-start justify-between gap-2 rounded-xl border bg-bg p-3 text-start transition-colors',
    onClick &&
      'cursor-pointer hover:border-fg hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    className,
  )
  const body = (
    <>
      <span className="min-w-0 flex-1">
        {colors ? (
          <span className="flex items-center gap-2">
            {icon && (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ color: colors.strong, backgroundColor: colors.soft }}
              >
                {icon}
              </span>
            )}
            <span className="truncate-safe block min-w-0 flex-1 text-xs text-muted">
              {label}
            </span>
          </span>
        ) : (
          <span className="truncate-safe block text-xs text-muted">
            {label}
          </span>
        )}
        {loading ? (
          <>
            <span className="mt-1.5 block h-6 w-12 animate-pulse rounded bg-surface-hover" />
            <span className="sr-only">{t('loading')}</span>
          </>
        ) : (
          <span
            className={cn(
              'block text-2xl leading-tight tabular-nums',
              colors ? 'mt-1 font-bold' : 'mt-0.5 font-semibold',
            )}
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
      {icon && !colors && (
        <span aria-hidden="true" className="shrink-0 text-muted">
          {icon}
        </span>
      )}
    </>
  )
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-busy={loading || undefined}
        className={classes}
      >
        {body}
      </button>
    )
  return (
    <div aria-busy={loading || undefined} className={classes}>
      {body}
    </div>
  )
}
