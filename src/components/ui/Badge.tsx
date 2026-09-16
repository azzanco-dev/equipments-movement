import type { CSSProperties, ReactNode } from 'react'
import { LogIn, LogOut, ParkingCircle, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type BadgeTone =
  'neutral' | 'entry' | 'exit' | 'success' | 'warning' | 'danger' | 'info'

function toneStyle(tone: BadgeTone): CSSProperties | undefined {
  if (tone === 'neutral') return undefined
  return {
    color: `var(--${tone})`,
    backgroundColor: `var(--${tone}-soft)`,
    borderColor: `color-mix(in srgb, var(--${tone}) 30%, transparent)`,
  }
}

export interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
        tone === 'neutral' && 'bg-surface text-fg',
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

/** Workshop entry purpose: maintenance (warning) or parking/standby (info). */
export function WorkshopPurposeBadge({
  purpose,
  className,
}: {
  purpose: 'maintenance' | 'parking'
  className?: string
}) {
  const { t } = useI18n()
  const maintenance = purpose === 'maintenance'
  const Icon = maintenance ? Wrench : ParkingCircle
  return (
    <Badge
      tone={maintenance ? 'warning' : 'info'}
      className={className}
      icon={<Icon size={12} aria-hidden="true" />}
    >
      {t(maintenance ? 'maintenancePurpose' : 'parkingPurpose')}
    </Badge>
  )
}
