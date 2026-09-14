import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import type { EntryExitLog } from '@/lib/types'
import { MapPin } from 'lucide-react'

function MovementLogField({
  label,
  value,
  className = '',
}: {
  label: string
  value: string | null | undefined
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[10px] leading-3 text-muted">{label}</p>
      <p className="truncate text-xs leading-4" title={value ?? undefined}>
        {value || '—'}
      </p>
    </div>
  )
}

export function MovementLogCard({
  log,
  onSelect,
  showTodayBadge = false,
  showWorkshopPurpose = false,
}: {
  log: EntryExitLog
  onSelect?: () => void
  showTodayBadge?: boolean
  showWorkshopPurpose?: boolean
}) {
  const { t, lang } = useI18n()
  const isEntry = log.movement_type === 'entry'
  const projectName = log.project
    ? localizedName(lang, log.project.name_ar, log.project.name_en)
    : null
  const companyName = log.company
    ? localizedName(lang, log.company.name_ar, log.company.name_en)
    : null
  const location =
    log.movement_context === 'workshop'
      ? t('workshopLocation')
      : [companyName, projectName].filter(Boolean).join(' · ') || null
  const equipmentIdentifier =
    log.equipment?.plate_number || log.equipment?.chassis_number || null

  return (
    <button
      type="button"
      className={`card w-full border-s-4 p-3 text-start transition-colors ${
        isEntry
          ? 'border-emerald-600 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20'
          : 'border-amber-500 hover:bg-amber-50/60 dark:hover:bg-amber-950/20'
      } ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={onSelect}
      disabled={!onSelect}
      aria-label={onSelect ? t('viewDetails') : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-5">
            {log.equipment?.code ?? '—'}
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted">
            <span className="truncate">{log.equipment?.type ?? '—'}</span>
            {equipmentIdentifier && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate" dir="ltr">
                  {equipmentIdentifier}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showTodayBadge &&
            new Date(log.recorded_at).toDateString() ===
              new Date().toDateString() && (
              <span className="badge border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                {t('todayBadge')}
              </span>
            )}
          <span
            className={`badge border ${
              isEntry ? 'status-entry' : 'status-exit'
            }`}
          >
            {isEntry ? t('entry') : t('exit')}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex min-w-0 items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-2 text-xs dark:bg-gray-800/70">
        <MapPin size={14} className="shrink-0 text-muted" />
        <span className="text-[10px] text-muted">{t('location')}</span>
        <span className="truncate font-medium" title={location ?? undefined}>
          {location || '—'}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-x-3">
        <MovementLogField
          label={t('supervisor')}
          value={log.supervisor?.full_name}
        />
        <MovementLogField
          label={t('driverName')}
          value={log.current_driver_name ?? log.driver_name}
        />
        <MovementLogField
          label={t('movementDate')}
          value={formatDate(log.recorded_at)}
        />
      </div>
      {showWorkshopPurpose &&
        log.movement_context === 'workshop' &&
        log.workshop_purpose && (
          <p className="mt-2 text-[10px] text-muted">
            {t('workshopPurpose')}:{' '}
            {log.workshop_purpose === 'maintenance'
              ? t('maintenancePurpose')
              : t('parkingPurpose')}
          </p>
        )}
    </button>
  )
}
