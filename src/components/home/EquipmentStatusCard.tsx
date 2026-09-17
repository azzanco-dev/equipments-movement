import type { ReactNode } from 'react'
import { AlertCircle, ArrowLeft, MapPin, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Badge, MovementBadge, WorkshopPurposeBadge } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { Card } from '@/components/ui/Card'

export type MovementContext = 'site' | 'workshop'

export interface EquipmentSummary {
  id: string
  code: string
  type: string
  plate: string
  owner: string
}

/** Where the equipment is right now, derived from its latest valid movements. */
export type EquipmentState =
  | { kind: 'inside_site'; location: string; days: number }
  | {
      kind: 'inside_workshop'
      purpose: 'maintenance' | 'parking' | null
      days: number
    }
  | { kind: 'outside' }

export interface EquipmentTimelineItem {
  id: string
  context: MovementContext
  movement: 'entry' | 'exit'
  /** Company · project for site rows, workshop purpose for workshop rows. */
  location: string
  /** Preformatted by the caller so day boundaries stay on Saudi time. */
  date: string
}

export interface EquipmentStatusCardProps {
  /** `null` renders the not-found state (searched code matched nothing). */
  equipment?: EquipmentSummary | null
  state?: EquipmentState
  /**
   * Latest movements across both contexts. The caller filters it: a foreman
   * sees the workshop state but no workshop rows (owner decision 2026-09-17).
   */
  timeline?: EquipmentTimelineItem[]
  /** Link to the full equipment page; omitted hides the link. */
  href?: string
  loading?: boolean
  /** Truthy renders the error state; `true` uses the default message. */
  error?: ReactNode
  className?: string
}

/** Context chip that tells site rows and workshop rows apart. */
export function MovementContextBadge({
  context,
}: {
  context: MovementContext
}) {
  const { t } = useI18n()
  const site = context === 'site'
  const Icon = site ? MapPin : Wrench
  return (
    <Badge tone="neutral" icon={<Icon size={12} aria-hidden="true" />}>
      {t(site ? 'siteContext' : 'workshopContext')}
    </Badge>
  )
}

function StatePill({ state }: { state: EquipmentState }) {
  const { t } = useI18n()
  if (state.kind === 'outside')
    return <Badge tone="neutral">{t('outsideSite')}</Badge>
  const days = t('sinceDays').replace('{count}', String(state.days))
  if (state.kind === 'inside_site')
    return (
      <>
        <Badge tone="entry">{t('insideSite')}</Badge>
        <span className="truncate-safe text-sm text-fg">{state.location}</span>
        <span className="text-xs text-muted">{days}</span>
      </>
    )
  return (
    <>
      <Badge tone="info">{t('insideWorkshop')}</Badge>
      {state.purpose ? (
        <WorkshopPurposeBadge purpose={state.purpose} />
      ) : (
        <Badge tone="warning">{t('pendingClassification')}</Badge>
      )}
      <span className="text-xs text-muted">{days}</span>
    </>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted">{label}</span>
      <span className="truncate-safe block text-sm text-fg">{value}</span>
    </div>
  )
}

/**
 * One equipment, its current state and a short unified timeline across the
 * site and workshop contexts. Presentational only: the caller loads the data
 * and owns the loading, error and not-found states.
 */
export function EquipmentStatusCard({
  equipment,
  state,
  timeline = [],
  href,
  loading = false,
  error,
  className,
}: EquipmentStatusCardProps) {
  const { t } = useI18n()
  const hasError = error !== undefined && error !== null && error !== false

  if (hasError)
    return (
      <Card className={cn('p-0', className)} padded={false}>
        <div
          role="alert"
          className="flex items-start gap-2.5 border-s-4 border-danger bg-danger-soft px-4 py-5 text-sm font-medium text-danger"
        >
          <AlertCircle
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span>{error === true ? t('dataLoadError') : error}</span>
        </div>
      </Card>
    )

  if (loading)
    return (
      <Card className={cn('space-y-3', className)}>
        <span className="sr-only">{t('loading')}</span>
        <span className="block h-5 w-32 animate-pulse rounded bg-surface-hover" />
        <span className="block h-6 w-48 animate-pulse rounded-full bg-surface-hover" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className="block h-8 animate-pulse rounded bg-surface-hover"
            />
          ))}
        </div>
      </Card>
    )

  if (!equipment)
    return (
      <Card className={cn('py-8 text-center', className)}>
        <p className="text-sm text-muted">{t('noEquipmentFound')}</p>
      </Card>
    )

  return (
    <Card className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-fg">{equipment.code}</h3>
        <span className="truncate-safe text-sm text-muted">
          {equipment.type}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Detail label={t('equipmentCode')} value={equipment.code} />
        <Detail label={t('equipmentType')} value={equipment.type} />
        <Detail
          label={t('plateNumber')}
          value={<span dir="ltr">{equipment.plate}</span>}
        />
        <Detail label={t('ownershipStatus')} value={equipment.owner} />
      </div>

      {state && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface px-3 py-2">
          <span className="text-xs text-muted">{t('currentStatus')}</span>
          <StatePill state={state} />
        </div>
      )}

      {timeline.length > 0 && (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted">
            {t('latestMovements')}
          </span>
          <ul className="divide-y rounded-lg border">
            {timeline.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
              >
                <MovementContextBadge context={item.context} />
                <MovementBadge type={item.movement} />
                <span className="truncate-safe min-w-0 flex-1 text-sm text-fg">
                  {item.location}
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {item.date}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {href && (
        <a
          href={href}
          className="inline-flex items-center gap-1.5 text-sm text-fg underline underline-offset-4 hover:text-muted"
        >
          {t('equipmentPageLink')}
          <ArrowLeft size={14} aria-hidden="true" className="ltr:rotate-180" />
        </a>
      )}
    </Card>
  )
}
