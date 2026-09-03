import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { InlineSpinner } from '@/components/Spinner'
import { LogIn, LogOut, Filter, Search } from 'lucide-react'
import { DatePicker } from '@/components/DatePicker'
import type { EntryExitLog, MovementType } from '@/lib/types'
import { Select } from '@/components/Select'
import { PageHeader } from '@/components/PageHeader'
import { formatDate } from '@/lib/dateFormat'
import { Alert } from '@/components/Alert'
import { RelativeTime } from '@/components/RelativeTime'
import { sanitizeSearchTerm } from '@/lib/search'

async function loadLatestDriverNames(entryIds: string[]) {
  if (!entryIds.length) return new Map<string, string>()
  const { data } = await supabase
    .from('movement_driver_changes')
    .select('entry_log_id,new_driver_name,changed_at,id')
    .in('entry_log_id', entryIds)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
  const latest = new Map<string, string>()
  for (const change of data ?? []) {
    if (!latest.has(change.entry_log_id))
      latest.set(change.entry_log_id, change.new_driver_name)
  }
  return latest
}

export function SupervisorDashboard({
  onSelectMovement,
  onCreateMovement,
}: {
  onSelectMovement: (id: string) => void
  onCreateMovement: (type: MovementType) => void
}) {
  const { t } = useI18n()
  const { user, profile } = useAuth()
  const [logs, setLogs] = useState<EntryExitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'all' | MovementType>('all')
  const [filterDate, setFilterDate] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [classificationBusy, setClassificationBusy] = useState<string | null>(
    null,
  )
  const [classificationError, setClassificationError] = useState<string | null>(
    null,
  )
  const workshopManagerMode =
    profile?.role === 'workshop_manager' ||
    profile?.role === 'assistant_workshop_manager'
  const workshopMode = profile?.role === 'workshop' || workshopManagerMode

  const fetchLogs = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const term = sanitizeSearchTerm(search)
    let equipmentIds: string[] = []
    let companyIds: string[] = []
    let projectIds: string[] = []
    if (term) {
      const [equipmentResult, companyResult, projectResult] = await Promise.all(
        [
          supabase
            .from('equipment')
            .select('id')
            .or(`code.ilike.%${term}%,plate_number.ilike.%${term}%`)
            .limit(100),
          supabase
            .from('companies')
            .select('id')
            .or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
            .limit(100),
          supabase
            .from('projects')
            .select('id')
            .or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
            .limit(100),
        ],
      )
      equipmentIds = (equipmentResult.data ?? []).map((item) => item.id)
      companyIds = (companyResult.data ?? []).map((item) => item.id)
      projectIds = (projectResult.data ?? []).map((item) => item.id)
    }

    let query = supabase
      .from('entry_exit_logs')
      .select(
        '*, equipment(*), supervisor:profiles(id,full_name,role,created_at)',
      )
      .eq('movement_context', workshopMode ? 'workshop' : 'site')
      .order('created_at', { ascending: false })
      .limit(100)

    if (term) {
      const filters = [`contractor_equipment_code.ilike.%${term}%`]
      if (equipmentIds.length)
        filters.push(`equipment_id.in.(${equipmentIds.join(',')})`)
      if (companyIds.length)
        filters.push(`company_id.in.(${companyIds.join(',')})`)
      if (projectIds.length)
        filters.push(`project_id.in.(${projectIds.join(',')})`)
      query = query.or(filters.join(','))
    }

    if (!workshopMode) query = query.eq('supervisor_id', user.id)

    if (filterType !== 'all') {
      query = query.eq('movement_type', filterType)
    }
    if (filterDate) {
      const start = new Date(filterDate)
      start.setHours(0, 0, 0, 0)
      const end = new Date(filterDate)
      end.setHours(23, 59, 59, 999)
      query = query
        .gte('recorded_at', start.toISOString())
        .lte('recorded_at', end.toISOString())
    }

    const { data, error } = await query
    if (error) console.error(error)
    const rows = (data as EntryExitLog[]) ?? []
    const latestDrivers = await loadLatestDriverNames(
      rows.filter((row) => row.movement_type === 'entry').map((row) => row.id),
    )
    setLogs(
      rows.map((row) => ({
        ...row,
        current_driver_name:
          row.movement_type === 'entry'
            ? (latestDrivers.get(row.id) ?? row.driver_name)
            : row.driver_name,
      })),
    )
    setLoading(false)
  }, [user, workshopMode, filterType, filterDate, search])

  const classifyEntry = async (logId: string, purpose: string) => {
    setClassificationBusy(logId)
    setClassificationError(null)
    const { error } = await supabase.rpc('classify_workshop_entry', {
      p_entry_log_id: logId,
      p_purpose: purpose,
    })
    setClassificationBusy(null)
    if (error) {
      setClassificationError(t('workshopClassificationFailed'))
      return
    }
    await fetchLogs()
  }

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('dashboard')}
        description={
          workshopManagerMode
            ? t('workshopManagerDashboardDesc')
            : t('supervisorDashboardDesc')
        }
      />

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          onClick={() => onCreateMovement('entry')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="status-entry flex h-12 w-12 items-center justify-center rounded-full border">
            <LogIn size={24} />
          </div>
          <span className="font-bold text-lg">{t('registerEntry')}</span>
        </button>

        <button
          onClick={() => onCreateMovement('exit')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="status-exit flex h-12 w-12 items-center justify-center rounded-full border">
            <LogOut size={24} />
          </div>
          <span className="font-bold text-lg">{t('registerExit')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[360px]">
          <Search
            size={15}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            className="input ps-9"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('searchMovementRecords')}
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Filter size={16} />
        </div>
        <Select
          className="w-auto min-w-[100px]"
          value={filterType}
          onChange={(v) => setFilterType(v as 'all' | MovementType)}
          options={[
            { value: 'all', label: t('allTypes') },
            { value: 'entry', label: t('entry') },
            { value: 'exit', label: t('exit') },
          ]}
        />
        <DatePicker
          className="w-auto"
          value={filterDate}
          onChange={setFilterDate}
          placeholder={t('date')}
        />
        {(filterType !== 'all' || filterDate) && (
          <button
            onClick={() => {
              setFilterType('all')
              setFilterDate('')
            }}
            className="text-xs text-muted hover:text-fg"
          >
            {t('close')}
          </button>
        )}
      </div>

      {/* Recent logs */}
      <div>
        <h2 className="text-lg font-bold mb-3">
          {workshopManagerMode ? t('recentWorkshopLogs') : t('recentLogs')}
        </h2>
        {classificationError && (
          <div className="mb-3">
            <Alert type="error">{classificationError}</Alert>
          </div>
        )}

        {loading ? (
          <InlineSpinner label={t('loading')} />
        ) : logs.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-muted">{t('noLogs')}</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="compact-table w-full text-sm">
                <thead>
                  <tr
                    className="border-b"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <th className="table-header text-start px-4 py-3">
                      {workshopMode
                        ? t('equipmentCodeLabel')
                        : t('contractorEquipmentCode')}
                    </th>
                    <th className="table-header text-start px-4 py-3">
                      {t('equipmentNameLabel')}
                    </th>
                    <th className="table-header text-start px-4 py-3">
                      {t('movementType')}
                    </th>
                    {workshopMode && (
                      <th className="table-header text-start px-4 py-3">
                        {t('supervisorName')}
                      </th>
                    )}
                    {workshopMode && (
                      <th className="table-header text-start px-4 py-3">
                        {t('workshopPurpose')}
                      </th>
                    )}
                    {!workshopMode && (
                      <th className="table-header text-start px-4 py-3">
                        {t('driverName')}
                      </th>
                    )}
                    <th className="table-header text-start px-4 py-3">
                      {t('recordedAt')}
                    </th>
                    <th
                      className="table-header px-4 py-3"
                      aria-label={t('createdAt')}
                    />
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={() => onSelectMovement(log.id)}
                    >
                      <td className="px-4 py-3 font-semibold">
                        {workshopMode
                          ? (log.equipment?.code ?? '—')
                          : (log.contractor_equipment_code ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {workshopMode
                          ? (log.equipment?.type ?? '—')
                          : (log.equipment?.code ?? '—')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge border ${log.movement_type === 'entry' ? 'status-entry' : 'status-exit'}`}
                        >
                          {log.movement_type === 'entry'
                            ? t('entry')
                            : t('exit')}
                        </span>
                      </td>
                      {workshopMode && (
                        <td className="px-4 py-3">
                          {log.supervisor?.full_name ?? '—'}
                        </td>
                      )}
                      {workshopMode && (
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {log.movement_type === 'entry' ? (
                            workshopManagerMode ? (
                              <Select
                                compact
                                className={`min-w-[130px] ${classificationBusy === log.id ? 'pointer-events-none opacity-60' : ''}`}
                                value={log.workshop_purpose ?? ''}
                                onChange={(value) =>
                                  classifyEntry(log.id, value)
                                }
                                options={[
                                  ...(log.workshop_purpose
                                    ? []
                                    : [
                                        {
                                          value: '',
                                          label: t('pendingClassification'),
                                        },
                                      ]),
                                  {
                                    value: 'maintenance',
                                    label: t('maintenancePurpose'),
                                  },
                                  {
                                    value: 'parking',
                                    label: t('parkingPurpose'),
                                  },
                                ]}
                              />
                            ) : log.workshop_purpose === 'maintenance' ? (
                              t('maintenancePurpose')
                            ) : log.workshop_purpose === 'parking' ? (
                              t('parkingPurpose')
                            ) : (
                              t('pendingClassification')
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {!workshopMode && (
                        <td className="px-4 py-3">
                          {log.current_driver_name ?? log.driver_name ?? '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted whitespace-nowrap">
                        {formatDate(log.recorded_at)}
                      </td>
                      <td className="px-4 py-3">
                        <RelativeTime value={log.created_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
