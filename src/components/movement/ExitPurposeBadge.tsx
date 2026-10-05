import { CircleCheck, Wrench } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { exitPurposeLabelKey } from '@/lib/exitPurpose'
import { cn } from '@/components/ui/cn'

/**
 * The purpose of a site EXIT (migration 0111) as a small badge next to the
 * exit or the closed visit it belongs to (wave 12). The approved `Badge` in
 * the EXIT tone (amber), so it reads as part of the exit and never as an
 * alarm; the icon and the words tell the two purposes apart.
 *
 * Renders nothing for an entry, a workshop row, an exit recorded before 0111
 * or an unknown value, so the lists show no placeholder clutter.
 */
export function ExitPurposeBadge({
  purpose,
  size = 'sm',
  className,
}: {
  purpose: unknown
  size?: BadgeProps['size']
  className?: string
}) {
  const { t } = useI18n()
  const key = exitPurposeLabelKey(purpose)
  if (!key) return null
  const Icon = purpose === 'maintenance' ? Wrench : CircleCheck
  return (
    <Badge
      tone="exit"
      size={size}
      className={className}
      icon={<Icon size={11} aria-hidden="true" />}
    >
      {/* Screen readers hear what the words are, not just «للصيانة». */}
      <span className="sr-only">{t('exitPurpose')}: </span>
      {t(key)}
    </Badge>
  )
}

/**
 * The movement type badge with the purpose of a site EXIT inside it
 * («خروج · للصيانة», owner decision 2026-10-05), so a row carries one badge
 * instead of two. An entry, a workshop row or an older exit reads as the
 * plain movement badge.
 */
export function MovementTypeBadge({
  type,
  exitPurpose,
  className,
}: {
  type: 'entry' | 'exit'
  exitPurpose?: unknown
  className?: string
}) {
  const { t } = useI18n()
  const purposeKey = type === 'exit' ? exitPurposeLabelKey(exitPurpose) : null
  return (
    <Badge tone={type} className={cn('whitespace-nowrap', className)}>
      {t(type)}
      {purposeKey && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, {t('exitPurpose')}: </span>
          {t(purposeKey)}
        </>
      )}
    </Badge>
  )
}
