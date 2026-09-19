import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type NoticeSize = 'compact' | 'comfortable'

const toneClasses: Record<NoticeTone, string> = {
  neutral: 'border-border bg-surface text-fg',
  info: 'border-info bg-info-soft text-info',
  success: 'border-success bg-success-soft text-success',
  warning: 'border-warning bg-warning-soft text-warning',
  danger: 'border-danger bg-danger-soft text-danger',
}

const defaultIcon: Record<NoticeTone, ReactNode> = {
  neutral: <Info size={18} aria-hidden="true" />,
  info: <Info size={18} aria-hidden="true" />,
  success: <CheckCircle size={18} aria-hidden="true" />,
  warning: <AlertTriangle size={18} aria-hidden="true" />,
  danger: <AlertCircle size={18} aria-hidden="true" />,
}

export interface NoticeProps {
  tone?: NoticeTone
  title?: ReactNode
  children: ReactNode
  /** Overrides the tone's default icon; pass `null` to hide the icon. */
  icon?: ReactNode | null
  /** End-side content, e.g. a retry button. */
  action?: ReactNode
  /** Renders a dismiss button that calls this when clicked. */
  onDismiss?: () => void
  /** `compact` suits dense inline spots (a filter bar, a table toolbar);
   * `comfortable` (default) matches the previous full-width `Alert` banner. */
  size?: NoticeSize
  className?: string
}

/**
 * Inline banner for page/form-level messages, built on the approved tokens
 * (soft tone background + readable tone text — AGENTS.md: no ad hoc palette
 * colors). Replaces the legacy `Alert` on migrated screens.
 *
 * Non-`danger` tones announce as `status` (polite); `danger` announces as
 * `alert` (assertive) so assistive tech treats a failure as urgent.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
  icon,
  action,
  onDismiss,
  size = 'comfortable',
  className,
}: NoticeProps) {
  const { t } = useI18n()
  const resolvedIcon = icon === undefined ? defaultIcon[tone] : icon
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start rounded-lg border font-medium animate-fade-in',
        size === 'compact' ? 'gap-2 p-2.5 text-xs' : 'gap-2.5 p-3.5 text-sm',
        toneClasses[tone],
        className,
      )}
    >
      {resolvedIcon && (
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {resolvedIcon}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="font-normal">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('close')}
          title={t('close')}
          className="-m-1 shrink-0 rounded p-1 opacity-80 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
