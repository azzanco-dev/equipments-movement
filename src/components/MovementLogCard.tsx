import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import type { EntryExitLog } from '@/lib/types'

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
      <p className="text-[11px] leading-4 text-muted">{label}</p>
      <p className="truncate text-[13px] leading-5" title={value ?? undefined}>
        {value || '—'}
      </p>
    </div>
  )
}

export function MovementLogCard({
  log,
  onSelect,
  showTodayBadge = false,
}: {
  log: EntryExitLog
  onSelect?: () => void
  showTodayBadge?: boolean
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
      : projectName

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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {log.equipment?.code ?? '—'}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {log.equipment?.type ?? '—'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
        {showTodayBadge && new Date(log.recorded_at).toDateString() === new Date().toDateString() && <span className="badge border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">{t('todayBadge')}</span>}
        <span
          className={`badge border ${
            isEntry ? 'status-entry' : 'status-exit'
          }`}
        >
          {isEntry ? t('entry') : t('exit')}
        </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <MovementLogField
          label={t('plateNumber')}
          value={log.equipment?.plate_number}
        />
        <MovementLogField
          label={t('contractorEquipmentCode')}
          value={log.contractor_equipment_code}
        />
        <MovementLogField label={t('company')} value={companyName} />
        <MovementLogField
          label={t('project')}
          value={location}
          className={log.movement_context === 'workshop' ? '' : 'sm:col-span-2'}
        />
        {log.movement_context === 'workshop' && log.workshop_purpose && (
          <MovementLogField
            label={t('workshopPurpose')}
            value={
              log.workshop_purpose === 'maintenance'
                ? t('maintenancePurpose')
                : t('parkingPurpose')
            }
          />
        )}
        <MovementLogField
          label={t('supervisor')}
          value={log.supervisor?.full_name}
        />
        <div>
          <MovementLogField
            label={t('driverName')}
            value={log.current_driver_name ?? log.driver_name}
          />
          <div className='text-xs text-muted'>{log.driver?.mobile_number}</div>
        </div>
      </div>

      <div
        className="mt-3 border-t pt-2 text-[12px] text-muted"
        style={{ borderColor: 'var(--border)' }}
      >
        <span>{t('movementDate')}</span>
        <span className="mx-1.5">•</span>
        <time dateTime={log.recorded_at}>{formatDate(log.recorded_at)}</time>
      </div>
    </button>
  )
}
