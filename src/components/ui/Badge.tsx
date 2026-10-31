import type { CSSProperties, ReactNode } from 'react'
import { Ban, LogIn, LogOut, ParkingCircle, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  WORKSHOP_PURPOSE_LABEL_KEYS,
  workshopPurposeTone,
  type WorkshopPurpose,
} from '@/lib/equipmentState'
import { cn } from './cn'

export type BadgeTone =
  'neutral' | 'entry' | 'exit' | 'success' | 'warning' | 'danger' | 'info'

// «ناعم مربع» (owner pick 2026-10-24 on /ui-kit): a soft fill, no border,
// slightly rounded corners instead of the pill.
function toneStyle(tone: BadgeTone): CSSProperties | undefined {
  if (tone === 'neutral') return undefined
  return {
    color: `var(--${tone})`,
    backgroundColor: `var(--${tone}-soft)`,
  }
}

export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  tone?: BadgeTone
  /** `sm` is for dense places such as dropdown options and table cells
   *  (12 px since 2026-10-31, owner rule: 11 px is kept for durations, last
   *  modified and creation times only); `md` is 11.5 px. */
  size?: BadgeSize
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export function Badge({
  tone = 'neutral',
  size = 'md',
  icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium',
        size === 'md' && 'rounded-md px-2 py-0.5 text-[11.5px] leading-[18px]',
        size === 'sm' && 'rounded px-1.5 py-0 text-xs leading-4',
        // No border any more: a shade darker than the surface so a neutral
        // badge still shows on a surface card.
        tone === 'neutral' && 'bg-surface-hover text-fg',
        className,
      )}
      style={toneStyle(tone)}
    >
      {icon}
      {children}
    </span>
  )
}

/** The single way to show ENTRY/EXIT: green entry, amber exit. */
export function MovementBadge({
  type,
  withIcon = false,
  className,
}: {
  type: 'entry' | 'exit'
  withIcon?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const Icon = type === 'entry' ? LogIn : LogOut
  return (
    <Badge
      tone={type}
      className={className}
      icon={withIcon ? <Icon size={12} aria-hidden="true" /> : undefined}
    >
      {t(type)}
    </Badge>
  )
}

/** Workshop entry purpose: maintenance (warning), parking/standby (info) or
 *  out of service (danger: light red with dark readable text, wave 20). */
export function WorkshopPurposeBadge({
  purpose,
  className,
}: {
  purpose: WorkshopPurpose
  className?: string
}) {
  const { t } = useI18n()
  const Icon =
    purpose === 'maintenance'
      ? Wrench
      : purpose === 'parking'
        ? ParkingCircle
        : Ban
  return (
    <Badge
      tone={workshopPurposeTone(purpose)}
      className={className}
      icon={<Icon size={12} aria-hidden="true" />}
    >
      {t(WORKSHOP_PURPOSE_LABEL_KEYS[purpose])}
    </Badge>
  )
}
