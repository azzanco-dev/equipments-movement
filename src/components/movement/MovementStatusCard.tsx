import { CheckCircle, Clock, MapPin } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Skeleton, cn } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import type { EquipmentPresence } from '@/lib/equipmentPresence'
import { workshopPurposeLabelKey } from '@/lib/equipmentState'

export interface MovementStatusCardProps {
  loading: boolean
  presence: EquipmentPresence | null
  isEntry: boolean
  /** True while a validation error blocks the movement. */
  blocked: boolean
}

/**
 * "Current status" summary above the movement form: where the equipment is
 * now (inside the workshop, with its open project visit under it when there
 * is one; inside a project; outside), its last movement, and whether the
 * requested movement is allowed. The rule itself stays in the database; this
 * only mirrors `get_equipment_presence`.
 */
export function MovementStatusCard({
  loading,
  presence,
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

  const currentStatus: 'workshop' | 'site' | 'outside' | 'none' = !presence
    ? 'none'
    : presence.workshopOpen
      ? 'workshop'
      : presence.siteOpen
        ? 'site'
        : presence.lastMovementId
          ? 'outside'
          : 'none'
  const hasProjectName = Boolean(
    presence?.siteProjectNameAr || presence?.siteProjectNameEn,
  )
  const projectName = presence
    ? localizedName(lang, presence.siteProjectNameAr, presence.siteProjectNameEn)
    : ''

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border bg-surface p-4',
        blocked && 'border-fg',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {currentStatus === 'workshop' || currentStatus === 'site' ? (
          <>
            <CheckCircle size={16} className="text-success" />
            <span>
              {t('currentStatus')}:{' '}
              {t(currentStatus === 'workshop' ? 'insideWorkshop' : 'insideSite')}
              {currentStatus === 'workshop' && (
                <>
                  {' '}
                  —{' '}
                  {t(
                    workshopPurposeLabelKey(presence?.workshopPurpose) ??
                      'pendingClassification',
                  )}
                </>
              )}
              {currentStatus === 'site' && (
                <>
                  {hasProjectName && <> — {projectName}</>}
                  {presence?.siteSupervisorName && (
                    <> — {presence.siteSupervisorName}</>
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
                presence?.lastMovementContext === 'workshop'
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

      {currentStatus === 'workshop' && presence?.siteOpen && (
        <p className="text-xs text-muted">
          {hasProjectName
            ? t('movementTiedToProject').replace('{project}', projectName)
            : t('movementTiedToProjectUnnamed')}
          {presence.siteSupervisorName && <> — {presence.siteSupervisorName}</>}
        </p>
      )}

      {presence?.lastMovementAt && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Clock size={14} />
          <span>
            {t('lastMovement')}:{' '}
            {presence.lastMovementType === 'entry' ? t('entry') : t('exit')} —{' '}
            {formatDate(presence.lastMovementAt)}
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
