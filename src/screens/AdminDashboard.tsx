import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { InlineSpinner } from '@/components/Spinner'
import {
  LogIn,
  LogOut,
  Truck,
  AlertCircle,
  Download,
  Wrench,
} from 'lucide-react'
import type { EntryExitLog, Equipment } from '@/lib/types'
import { PageHeader } from '@/components/PageHeader'
import { sanitizeSearchTerm } from '@/lib/search'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { movementsListConfig } from '@/lib/listConfigs'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { MovementLogCard } from '@/components/MovementLogCard'

async function loadLatestDriverNames(entryIds: string[], signal: AbortSignal) {
  if (!entryIds.length) return new Map<string, string>()
  const { data } = await supabase
    .from('movement_driver_changes')
    .select('entry_log_id,new_driver_name,changed_at,id')
    .in('entry_log_id', entryIds)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .abortSignal(signal)
  const latest = new Map<string, string>()
  for (const change of data ?? []) {
    if (!latest.has(change.entry_log_id))
      latest.set(change.entry_log_id, change.new_driver_name)
  }
  return latest
}

function riyadhDayBounds() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const start = new Date(`${date}T00:00:00+03:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

type SummaryKey =
  'today_entries' | 'today_exits' | 'active_equipment' | 'outside_equipment'

interface EquipmentSummaryRow extends Pick<
  Equipment,
  'id' | 'code' | 'type' | 'plate_number' | 'operational_status' | 'is_active'
> {
  movement_type: 'entry' | 'exit' | null
  movement_context: 'site' | 'workshop' | null
  last_movement_at: string | null
  last_movement_id: string | null
}

export function AdminDashboard({
  onSelectMovement,
  onCreateMovement,
}: {
  onSelectMovement?: (id: string) => void
  onCreateMovement?: (type: 'entry' | 'exit') => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') === 'reports' ? 'reports' : 'logs'
  const requestedSummary = searchParams.get('summary')
  const selectedSummary: SummaryKey | null = [
    'today_entries',
    'today_exits',
    'active_equipment',
    'outside_equipment',
  ].includes(requestedSummary ?? '')
    ? (requestedSummary as SummaryKey)
    : null
  const summaryPage = Math.max(1, Number(searchParams.get('summary_page')) || 1)
  const summaryRef = useRef<HTMLDivElement>(null)

  // Stats
  const [stats, setStats] = useState({
    todayEntries: 0,
    todayExits: 0,
    activeEquipment: 0,
    outsideEquipment: 0,
  })
  const [loadingStats, setLoadingStats] = useState(true)
  const [workshopStats, setWorkshopStats] = useState({
    inside: 0,
    entries: 0,
    exits: 0,
  })
  const [workshopLogs, setWorkshopLogs] = useState<EntryExitLog[]>([])
  const [loadingWorkshop, setLoadingWorkshop] = useState(true)
  const [workshopLoadError, setWorkshopLoadError] = useState(false)
  const [summaryLogs, setSummaryLogs] = useState<EntryExitLog[]>([])
  const [summaryEquipment, setSummaryEquipment] = useState<
    EquipmentSummaryRow[]
  >([])
  const [summaryTotal, setSummaryTotal] = useState(0)
  const [loadingSummary, setLoadingSummary] = useState(false)

  // Logs
  const [logs, setLogs] = useState<EntryExitLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [logsTotal, setLogsTotal] = useState(0)
  const [supervisorOptions, setSupervisorOptions] = useState<
    Array<{ value: string; label: string }>
  >([])
  const movementConfig = useMemo(
    () => ({
      ...movementsListConfig,
      filterFields: movementsListConfig.filterFields.map((field) =>
        field.key === 'supervisor_id'
          ? { ...field, options: supervisorOptions }
          : field,
      ),
    }),
    [supervisorOptions],
  )
  const list = useDataListState(movementsListConfig)

  // Movement reports preserve the prior report URL prefix for existing links.
  const [reports, setReports] = useState<EntryExitLog[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [reportsTotal, setReportsTotal] = useState(0)
  const reportList = useDataListState(movementsListConfig, 'visit_')

  const setTab = (nextTab: 'logs' | 'reports') => {
    const next = new URLSearchParams(searchParams.toString())
    if (nextTab === 'reports') next.set('tab', 'reports')
    else next.delete('tab')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const setSummary = (summary: SummaryKey) => {
    const next = new URLSearchParams(searchParams.toString())
    if (selectedSummary === summary) {
      next.delete('summary')
      next.delete('summary_page')
    } else {
      next.set('summary', summary)
      next.delete('summary_page')
    }
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    if (selectedSummary !== summary)
      window.setTimeout(
        () => summaryRef.current?.scrollIntoView({ behavior: 'smooth' }),
        50,
      )
  }

  const setSummaryPage = (page: number) => {
    const next = new URLSearchParams(searchParams.toString())
    if (page <= 1) next.delete('summary_page')
    else next.set('summary_page', String(page))
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const fetchStats = useCallback(async () => {
    setLoadingStats(true)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString()

    const [
      { count: todayEntries },
      { count: todayExits },
      { count: activeCount },
      { count: outsideCount },
    ] = await Promise.all([
      supabase
        .from('entry_exit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('movement_context', 'site')
        .eq('movement_type', 'entry')
        .gte('recorded_at', todayStr),
      supabase
        .from('entry_exit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('movement_context', 'site')
        .eq('movement_type', 'exit')
        .gte('recorded_at', todayStr),
      supabase
        .from('equipment')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('equipment_current_state')
        .select('id', { count: 'exact', head: true })
        .or('movement_type.eq.exit,movement_type.is.null'),
    ])

    // // Today's entries
    // const { count: todayEntries } = await supabase
    //   .from('entry_exit_logs')
    //   .select('id', { count: 'exact', head: true })
    //   .eq('movement_type', 'entry')
    //   .gte('recorded_at', todayStr)

    // // Today's exits
    // const { count: todayExits } = await supabase
    //   .from('entry_exit_logs')
    //   .select('id', { count: 'exact', head: true })
    //   .eq('movement_type', 'exit')
    //   .gte('recorded_at', todayStr)

    // // Active equipment count
    // const { count: activeCount } = await supabase
    //   .from('equipment')
    //   .select('id', { count: 'exact', head: true })
    //   .eq('is_active', true)

    // // Outside means the last movement is EXIT, or no movement exists yet.
    // const { count: outsideCount } = await supabase
    //   .from('equipment_current_state')
    //   .select('id', { count: 'exact', head: true })
    //   .or('movement_type.eq.exit,movement_type.is.null')

    setStats({
      todayEntries: todayEntries ?? 0,
      todayExits: todayExits ?? 0,
      activeEquipment: activeCount ?? 0,
      outsideEquipment: outsideCount ?? 0,
    })
    setLoadingStats(false)
  }, [])

  const fetchWorkshopOverview = useCallback(async (signal: AbortSignal) => {
    setLoadingWorkshop(true)
    setWorkshopLoadError(false)
    const { from, to } = riyadhDayBounds()
    const [inside, entries, exits, latest] = await Promise.all([
      supabase
        .from('equipment_current_state')
        .select('id', { count: 'exact', head: true })
        .eq('movement_context', 'workshop')
        .eq('movement_type', 'entry')
        .abortSignal(signal),
      supabase
        .from('entry_exit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('movement_context', 'workshop')
        .eq('movement_type', 'entry')
        .gte('recorded_at', from)
        .lt('recorded_at', to)
        .abortSignal(signal),
      supabase
        .from('entry_exit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('movement_context', 'workshop')
        .eq('movement_type', 'exit')
        .gte('recorded_at', from)
        .lt('recorded_at', to)
        .abortSignal(signal),
      supabase
        .from('entry_exit_logs')
        .select(
          'id,equipment_id,supervisor_id,movement_type,movement_context,workshop_purpose,driver_id,driver_name,recorded_at,created_at,equipment:equipment(id,code,type,plate_number,chassis_number),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)',
        )
        .eq('movement_context', 'workshop')
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10)
        .abortSignal(signal),
    ])
    if (signal.aborted) return
    if (inside.error || entries.error || exits.error || latest.error) {
      setWorkshopLoadError(true)
      setLoadingWorkshop(false)
      return
    }
    setWorkshopStats({
      inside: inside.count ?? 0,
      entries: entries.count ?? 0,
      exits: exits.count ?? 0,
    })
    setWorkshopLogs((latest.data as unknown as EntryExitLog[]) ?? [])
    setLoadingWorkshop(false)
  }, [])

  useEffect(() => {
    if (!selectedSummary) {
      setSummaryLogs([])
      setSummaryEquipment([])
      setSummaryTotal(0)
      return
    }
    let active = true
    const load = async () => {
      setLoadingSummary(true)
      const from = (summaryPage - 1) * 20
      const to = from + 19
      if (
        selectedSummary === 'today_entries' ||
        selectedSummary === 'today_exits'
      ) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const { data, count, error } = await supabase
          .from('entry_exit_logs')
          .select(
            'id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,contractor_equipment_code,recorded_at,created_at,equipment:equipment(id,code,type,plate_number,chassis_number),company:companies(id,name_ar,name_en),project:projects(id,name_ar,name_en),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)',
            { count: 'exact' },
          )
          .eq('movement_context', 'site')
          .eq(
            'movement_type',
            selectedSummary === 'today_entries' ? 'entry' : 'exit',
          )
          .gte('recorded_at', today.toISOString())
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
        if (error) console.error(error)
        if (!active) return
        setSummaryLogs((data as unknown as EntryExitLog[]) ?? [])
        setSummaryEquipment([])
        setSummaryTotal(count ?? 0)
      } else {
        let query = supabase
          .from('equipment_current_state')
          .select(
            'id,code,type,plate_number,operational_status,is_active,movement_type,movement_context,last_movement_at,last_movement_id',
            { count: 'exact' },
          )
          .order('code')
          .range(from, to)
        query =
          selectedSummary === 'active_equipment'
            ? query.eq('is_active', true)
            : query.or('movement_type.eq.exit,movement_type.is.null')
        const { data, count, error } = await query
        if (error) console.error(error)
        if (!active) return
        setSummaryEquipment((data as EquipmentSummaryRow[] | null) ?? [])
        setSummaryLogs([])
        setSummaryTotal(count ?? 0)
      }
      setLoadingSummary(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [selectedSummary, summaryPage])

  const startLogsRequest = useListRequest()
  const startReportsRequest = useListRequest()
  const fetchLogs = useCallback(async () => {
    const signal = startLogsRequest()
    setLoadingLogs(true)
    const term = sanitizeSearchTerm(list.search)
    let equipmentIds: string[] = []
    if (term) {
      const { data: equipmentMatches } = await supabase
        .from('equipment')
        .select('id')
        .or(
          `code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`,
        )
        .limit(100)
        .abortSignal(signal)
      if (signal.aborted) return
      equipmentIds = (equipmentMatches ?? []).map((item) => item.id)
    }
    let query = supabase
      .from('entry_exit_logs')
      .select(
        'id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,odometer_reading,notes,contractor_equipment_code,recorded_at,created_at,equipment:equipment(id,code,type,plate_number,chassis_number),company:companies(id,name_ar,name_en),project:projects(id,name_ar,name_en),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)',
        { count: 'exact' },
      )
      .eq('movement_context', 'site')
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    if (term)
      query = query.or(
        `driver_name.ilike.%${term}%,contractor_equipment_code.ilike.%${term}%${equipmentIds.length ? `,equipment_id.in.(${equipmentIds.join(',')})` : ''}`,
      )
    query = applyListFilters(
      query,
      list.filters,
      new Set(movementsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) console.error(error)
    const rows = (data as unknown as EntryExitLog[]) ?? []
    const latestDrivers = await loadLatestDriverNames(
      rows.filter((row) => row.movement_type === 'entry').map((row) => row.id),
      signal,
    )
    if (signal.aborted) return
    setLogs(
      rows.map((row) => ({
        ...row,
        current_driver_name:
          row.movement_type === 'entry'
            ? (latestDrivers.get(row.id) ?? row.driver_name)
            : row.driver_name,
      })),
    )
    setLogsTotal(count ?? 0)
    setLoadingLogs(false)
  }, [
    list.direction,
    startLogsRequest,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
  ])

  const fetchReports = useCallback(async () => {
    const signal = startReportsRequest()
    setLoadingReports(true)
    const term = sanitizeSearchTerm(reportList.search)
    let equipmentIds: string[] = []
    if (term) {
      const { data: equipmentMatches } = await supabase
        .from('equipment')
        .select('id')
        .or(
          `code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`,
        )
        .limit(100)
        .abortSignal(signal)
      if (signal.aborted) return
      equipmentIds = (equipmentMatches ?? []).map((item) => item.id)
    }
    let query = supabase
      .from('entry_exit_logs')
      .select(
        'id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,odometer_reading,notes,contractor_equipment_code,recorded_at,created_at,equipment:equipment(id,code,type,plate_number,chassis_number),company:companies(id,name_ar,name_en),project:projects(id,name_ar,name_en),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)',
        { count: 'exact' },
      )
      .eq('movement_context', 'site')
      .order(reportList.sort, { ascending: reportList.direction === 'asc' })
      .order('id', { ascending: reportList.direction === 'asc' })
      .range(
        (reportList.page - 1) * reportList.pageSize,
        reportList.page * reportList.pageSize - 1,
      )
    if (term)
      query = query.or(
        `driver_name.ilike.%${term}%,contractor_equipment_code.ilike.%${term}%${equipmentIds.length ? `,equipment_id.in.(${equipmentIds.join(',')})` : ''}`,
      )
    query = applyListFilters(
      query,
      reportList.filters,
      new Set(movementsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) console.error(error)
    const rows = (data as unknown as EntryExitLog[]) ?? []
    const latestDrivers = await loadLatestDriverNames(
      rows.filter((row) => row.movement_type === 'entry').map((row) => row.id),
      signal,
    )
    if (signal.aborted) return
    setReports(
      rows.map((row) => ({
        ...row,
        current_driver_name:
          row.movement_type === 'entry'
            ? (latestDrivers.get(row.id) ?? row.driver_name)
            : row.driver_name,
      })),
    )
    setReportsTotal(count ?? 0)
    setLoadingReports(false)
  }, [
    reportList.direction,
    startReportsRequest,
    reportList.filters,
    reportList.page,
    reportList.pageSize,
    reportList.search,
    reportList.sort,
  ])

  // Initial load
  useEffect(() => {
    fetchStats()
  }, [fetchStats])
  useEffect(() => {
    const controller = new AbortController()
    void fetchWorkshopOverview(controller.signal)
    return () => controller.abort()
  }, [fetchWorkshopOverview])

  useEffect(() => {
    let active = true
    const loadSupervisors = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name')
        .order('full_name')
      if (!active) return
      if (error) {
        console.error(error)
        return
      }
      setSupervisorOptions(
        (data ?? []).map((profile) => ({
          value: profile.id,
          label: profile.full_name,
        })),
      )
    }
    void loadSupervisors()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (tab === 'logs') fetchLogs()
  }, [fetchLogs, tab])
  useEffect(() => {
    if (tab === 'reports') fetchReports()
  }, [fetchReports, tab])

  const statCards = [
    {
      key: 'today_entries' as const,
      label: t('todayEntries'),
      value: stats.todayEntries,
      icon: <LogIn size={20} />,
    },
    {
      key: 'today_exits' as const,
      label: t('todayExits'),
      value: stats.todayExits,
      icon: <LogOut size={20} />,
    },
    {
      key: 'active_equipment' as const,
      label: t('activeEquipment'),
      value: stats.activeEquipment,
      icon: <Truck size={20} />,
    },
    {
      key: 'outside_equipment' as const,
      label: t('equipmentOutside'),
      value: stats.outsideEquipment,
      icon: <AlertCircle size={20} />,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title={t('dashboard')} description={t('dashboardDesc')} />
      {onCreateMovement && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => onCreateMovement('entry')}
          >
            <LogIn size={17} />
            {t('registerEntry')}
          </button>
          <button
            className="btn-outline"
            onClick={() => onCreateMovement('exit')}
          >
            <LogOut size={17} />
            {t('registerExit')}
          </button>
        </div>
      )}

      {/* Stats */}
      {loadingStats ? (
        <InlineSpinner label={t('loading')} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {statCards.map((stat) => (
            <button
              key={stat.key}
              type="button"
              aria-pressed={selectedSummary === stat.key}
              onClick={() => setSummary(stat.key)}
              className={`card text-start transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                selectedSummary === stat.key
                  ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-400 dark:border-gray-500'
                  : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted font-medium">
                  {stat.label}
                </span>
                <span className="text-muted">{stat.icon}</span>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
            </button>
          ))}
        </div>
      )}

      {selectedSummary && (
        <div ref={summaryRef} className="space-y-3 scroll-mt-20">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {statCards.find((item) => item.key === selectedSummary)?.label}
            </h2>
            <button
              className="btn-ghost"
              onClick={() => setSummary(selectedSummary)}
            >
              {t('close')}
            </button>
          </div>
          {loadingSummary ? (
            <InlineSpinner label={t('loading')} />
          ) : summaryLogs.length === 0 && summaryEquipment.length === 0 ? (
            <div className="card py-10 text-center text-sm text-muted">
              {t('noResults')}
            </div>
          ) : summaryLogs.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {summaryLogs.map((log) => (
                <MovementLogCard
                  key={log.id}
                  log={log}
                  onSelect={
                    onSelectMovement
                      ? () => onSelectMovement(log.id)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="compact-table w-full text-sm">
                  <thead>
                    <tr
                      className="border-b"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <th className="table-header px-4 py-3 text-start">
                        {t('equipmentCodeLabel')}
                      </th>
                      <th className="table-header px-4 py-3 text-start">
                        {t('equipmentNameLabel')}
                      </th>
                      <th className="table-header px-4 py-3 text-start">
                        {t('plateNumber')}
                      </th>
                      <th className="table-header px-4 py-3 text-start">
                        {t('currentStatus')}
                      </th>
                      <th className="table-header px-4 py-3 text-start">
                        {t('recordedAt')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryEquipment.map((equipment) => (
                      <tr
                        key={equipment.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() =>
                          router.push(`/equipment/${equipment.id}`)
                        }
                      >
                        <td className="px-4 py-3 font-medium">
                          {equipment.code}
                        </td>
                        <td className="px-4 py-3">{equipment.type}</td>
                        <td className="px-4 py-3">
                          {equipment.plate_number ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {selectedSummary === 'outside_equipment'
                            ? t('equipmentOutside')
                            : t(equipment.operational_status)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {equipment.last_movement_at
                            ? formatDate(equipment.last_movement_at)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DataListPagination
            page={summaryPage}
            pageSize={20}
            total={summaryTotal}
            onPage={setSummaryPage}
          />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Wrench size={18} />
            {t('workshopMovements')}
          </h2>
          <button
            className="btn-outline"
            onClick={() => router.push('/reports/workshop')}
          >
            {t('viewAll')}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            [
              t('insideWorkshopNow'),
              workshopStats.inside,
              'text-emerald-700 dark:text-emerald-400',
            ],
            [
              t('workshopEntriesToday'),
              workshopStats.entries,
              'text-emerald-700 dark:text-emerald-400',
            ],
            [
              t('workshopExitsToday'),
              workshopStats.exits,
              'text-amber-700 dark:text-amber-400',
            ],
          ].map(([label, value, color]) => (
            <div key={label as string} className="card p-3">
              <p className="text-xs text-muted">{label}</p>
              <p className={`mt-1 text-xl font-bold ${color}`}>
                {loadingWorkshop || workshopLoadError ? '—' : value}
              </p>
            </div>
          ))}
        </div>
        {loadingWorkshop ? (
          <InlineSpinner label={t('loading')} />
        ) : workshopLoadError ? (
          <div className="card py-8 text-center text-sm text-muted">
            {t('workshopReportLoadError')}
          </div>
        ) : workshopLogs.length ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {workshopLogs.map((log) => (
              <MovementLogCard
                key={log.id}
                log={log}
                showWorkshopPurpose
                onSelect={
                  onSelectMovement ? () => onSelectMovement(log.id) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="card py-8 text-center text-sm text-muted">
            {t('noWorkshopMovements')}
          </div>
        )}
      </section>

      {/* Tabs */}
      <div
        className="flex gap-1 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => setTab('logs')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'logs'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('allLogs')}
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'reports'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('movementReports')}
        </button>
      </div>

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="space-y-4">
          <DataListToolbar
            config={movementConfig}
            search={list.searchInput}
            onSearch={list.setSearchInput}
            sort={list.sort}
            direction={list.direction}
            onSort={list.setSort}
            pageSize={list.pageSize}
            onPageSize={list.setPageSize}
            filters={list.filters}
            onFilters={list.setFilters}
            menuActions={
              <button
                onClick={async () => {
                  const { exportLogsToExcel } = await import('@/lib/excel')
                  exportLogsToExcel(
                    logs,
                    `logs-${new Date().toISOString().slice(0, 10)}`,
                    t as (k: string) => string,
                  )
                }}
                className="btn-ghost"
                disabled={logs.length === 0}
              >
                <Download size={16} />
                {t('exportExcel')}
              </button>
            }
          />

          {/* Movement cards */}
          {loadingLogs ? (
            <InlineSpinner label={t('loading')} />
          ) : logs.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-muted">{t('noResults')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {logs.map((log) => (
                <MovementLogCard
                  key={log.id}
                  log={log}
                  onSelect={
                    onSelectMovement
                      ? () => onSelectMovement(log.id)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          <DataListPagination
            page={list.page}
            pageSize={list.pageSize}
            total={logsTotal}
            onPage={list.setPage}
          />
        </div>
      )}

      {/* Movement reports tab */}
      {tab === 'reports' && (
        <div className="space-y-4">
          <DataListToolbar
            config={movementConfig}
            search={reportList.searchInput}
            onSearch={reportList.setSearchInput}
            sort={reportList.sort}
            direction={reportList.direction}
            onSort={reportList.setSort}
            pageSize={reportList.pageSize}
            onPageSize={reportList.setPageSize}
            filters={reportList.filters}
            onFilters={reportList.setFilters}
            menuActions={
              <button
                onClick={async () => {
                  const { exportLogsToExcel } = await import('@/lib/excel')
                  exportLogsToExcel(
                    reports,
                    `movement-reports-${new Date().toISOString().slice(0, 10)}`,
                    t as (k: string) => string,
                  )
                }}
                className="btn-ghost"
                disabled={reports.length === 0}
              >
                <Download size={16} />
                {t('exportExcel')}
              </button>
            }
          />

          {loadingReports ? (
            <InlineSpinner label={t('loading')} />
          ) : reports.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-muted">{t('noResults')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {reports.map((log) => (
                <MovementLogCard
                  key={log.id}
                  log={log}
                  onSelect={
                    onSelectMovement
                      ? () => onSelectMovement(log.id)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          <DataListPagination
            page={reportList.page}
            pageSize={reportList.pageSize}
            total={reportsTotal}
            onPage={reportList.setPage}
          />
        </div>
      )}
    </div>
  )
}
