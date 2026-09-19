import { CheckCircle, Clock, MapPin } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Skeleton, cn } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import type { LastMovement } from '@/lib/types'

export interface MovementStatusCardProps {
  loading: boolean
  lastMovement: LastMovement | null
  isEntry: boolean
  /** True while a validation error blocks the movement. */
  blocked: boolean
}

/**
 * "Current status" summary above the movement form: where the equipment is
 * now, its last movement, and whether the requested movement is allowed. The
 * rule itself stays in the database; this only mirrors `get_last_movement`.
 */
export function MovementStatusCard({
  loading,
  lastMovement,
  isEntry,
  blocked,
}: MovementStatusCardProps) {
  const { t, lang } = useI18n()

  if (loading)
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    )

  const currentStatus: 'inside' | 'outside' | 'none' = !lastMovement
    ? 'none'
    : lastMovement.movement_type === 'entry'
      ? 'inside'
      : 'outside'

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border bg-surface p-4',
        blocked && 'border-fg',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {currentStatus === 'inside' ? (
          <>
            <CheckCircle size={16} className="text-success" />
            <span>
              {t('currentStatus')}:{' '}
              {t(
                lastMovement?.movement_context === 'workshop'
                  ? 'insideWorkshop'
                  : 'insideSite',
              )}
              {lastMovement?.movement_context === 'workshop' && (
                <>
                  {' '}
                  —{' '}
                  {lastMovement.workshop_purpose === 'maintenance'
                    ? t('maintenancePurpose')
                    : lastMovement.workshop_purpose === 'parking'
                      ? t('parkingPurpose')
                      : t('pendingClassification')}
                </>
              )}
              {lastMovement?.movement_context === 'site' && (
                <>
                  {(lastMovement.project_name_ar ||
                    lastMovement.project_name_en) && (
                    <>
                      {' '}
                      —{' '}
                      {localizedName(
                        lang,
                        lastMovement.project_name_ar,
                        lastMovement.project_name_en,
                      )}
                    </>
                  )}
                  {lastMovement.supervisor_name && (
                    <> — {lastMovement.supervisor_name}</>
                  )}
                </>
              )}
            </span>
          </>
        ) : currentStatus === 'outside' ? (
          <>
            <MapPin size={16} className="text-warning" />
            <span>
              {t('currentStatus')}:{' '}
              {t(
                lastMovement?.movement_context === 'workshop'
                  ? 'outsideWorkshop'
                  : 'outsideSite',
              )}
            </span>
          </>
        ) : (
          <>
            <Clock size={16} className="text-muted" />
            <span>{t('noPreviousMovement')}</span>
          </>
        )}
      </div>

      {lastMovement && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Clock size={14} />
          <span>
            {t('lastMovement')}:{' '}
            {lastMovement.movement_type === 'entry' ? t('entry') : t('exit')} —{' '}
            {formatDate(lastMovement.recorded_at)}
          </span>
        </div>
      )}

      {!blocked && (
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle size={14} className="text-success" />
          <span className="text-success">
            {isEntry ? t('entryAllowed') : t('exitAllowed')}
          </span>
        </div>
      )}
    </div>
  )
}
