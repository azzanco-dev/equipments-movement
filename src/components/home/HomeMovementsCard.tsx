import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import {
  DataTable,
  MovementBadge,
  SearchInput,
  Select,
  WorkshopPurposeBadge,
  Badge,
  Button,
  DatePicker,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@/components/ui'
import { Card, SectionHeader } from '@/components/ui/Card'
import { HomeVisitsTable } from '@/components/home/HomeVisitsCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { formatDate } from '@/lib/dateFormat'
import { isDateKey, saudiDayEnd, saudiDayStart } from '@/lib/saudiTime'
import { RelativeTime } from '@/components/RelativeTime'
import type { EntryExitLog } from '@/lib/types'
import {
  MOVEMENT_LOG_SEARCH_VIEW,
  MOVEMENT_LOG_SUPERVISOR_SELECT,
  buildMovementSearchFilter,
  mapMovementLogRows,
  type MovementLogSearchRow,
} from '@/lib/movementLogSearch'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useDataListState } from '@/components/data-list/useDataListState'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { PAGE_SIZE_OPTIONS } from '@/components/data-list/types'
import { movementsListConfig } from '@/lib/listConfigs'

/** Latest driver per open site entry, after any auditable driver changes. */
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

export interface HomeMovementsCardProps {
  /** Workshop roles list the workshop context; a foreman lists their own site rows. */
  workshopMode: boolean
  /** Only the workshop managers may set a classification. */
  canClassify: boolean
  onSelectMovement: (id: string) => void
  onClassify: (logId: string, purpose: string) => void
  classifyingId: string | null
  /** Bumped by the screen after a classification so the page refetches. */
  refreshToken: number
}

/**
 * The movement log tab. Search, movement type, date, ordering, and pagination
 * all run in PostgreSQL through `movement_log_search`, and the whole list
 * state lives in the URL so Back restores it.
 *
 * Rendered only while its tab is active (Radix unmounts inactive content), so
 * opening the visits tab costs no movement request.
 */
function MovementLogTab({
  workshopMode,
  canClassify,
  onSelectMovement,
  onClassify,
  classifyingId,
  refreshToken,
}: HomeMovementsCardProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const list = useDataListState(movementsListConfig)
  const { search, searchInput, setSearchInput } = list
  const params = useSearchParams()
  const requestedType = params.get('movement_type')
  const filterType =
    requestedType === 'entry' || requestedType === 'exit'
      ? requestedType
      : 'all'
  const requestedDate = params.get('movement_date') ?? ''
  const filterDate = isDateKey(requestedDate) ? requestedDate : ''
  const [logs, setLogs] = useState<EntryExitLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const changeFilters = (values: Record<string, string>) => {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(values)) {
      if (value && value !== 'all') url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    url.searchParams.delete('page')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const startListRequest = useListRequest()
  const fetchLogs = useCallback(async () => {
    if (!user) return
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)

    let query = supabase
      .from(MOVEMENT_LOG_SEARCH_VIEW)
      .select(MOVEMENT_LOG_SUPERVISOR_SELECT, { count: 'exact' })
      .eq('movement_context', workshopMode ? 'workshop' : 'site')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)

    const searchFilter = buildMovementSearchFilter(search, {
      includeCompanyProject: true,
    })
    if (searchFilter) query = query.or(searchFilter)

    if (!workshopMode) query = query.eq('supervisor_id', user.id)

    if (filterType !== 'all') query = query.eq('movement_type', filterType)
    if (filterDate) {
      query = query
        .gte('recorded_at', saudiDayStart(filterDate))
        .lte('recorded_at', saudiDayEnd(filterDate))
    }

    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setLoading(false)
      return
    }
    const rows = mapMovementLogRows(data as unknown as MovementLogSearchRow[])
    // Workshop rows carry no driver, so the extra lookup is skipped there.
    const latestDrivers = workshopMode
      ? new Map<string, string>()
      : await loadLatestDriverNames(
          rows
            .filter((row) => row.movement_type === 'entry')
            .map((row) => row.id),
          signal,
        )
    if (signal.aborted) return
    setTotal(count ?? 0)
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
  }, [
    user,
    workshopMode,
    filterType,
    filterDate,
    search,
    startListRequest,
    list.page,
    list.pageSize,
  ])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs, refreshToken])

  const columns = useMemo<DataTableColumn<EntryExitLog>[]>(() => {
    const purposeCell = (log: EntryExitLog) => {
      if (log.movement_type !== 'entry') return '—'
      if (!canClassify)
        return log.workshop_purpose ? (
          <WorkshopPurposeBadge purpose={log.workshop_purpose} />
        ) : (
          <Badge tone="warning">{t('awaitingClassification')}</Badge>
        )
      return (
        <Select
          value={log.workshop_purpose ?? ''}
          onValueChange={(value) => onClassify(log.id, value)}
          disabled={classifyingId === log.id}
          placeholder={t('selectClassification')}
          aria-label={t('workshopPurpose')}
          className="w-36"
          options={[
            { value: 'maintenance', label: t('maintenancePurpose') },
            { value: 'parking', label: t('parkingPurpose') },
          ]}
        />
      )
    }
    const status: DataTableColumn<EntryExitLog> = {
      key: 'movement_type',
      header: t('movementType'),
      width: '6rem',
      cell: (log) => <MovementBadge type={log.movement_type} />,
    }
    const recorded: DataTableColumn<EntryExitLog> = {
      key: 'recorded_at',
      header: t('recordedAt'),
      cell: (log) => (
        <span className="text-muted">{formatDate(log.recorded_at)}</span>
      ),
    }
    const created: DataTableColumn<EntryExitLog> = {
      key: 'created_at',
      header: t('createdAt'),
      align: 'end',
      hideBelow: 'sm',
      cell: (log) => (
        <span className="text-muted">
          <RelativeTime value={log.created_at} />
        </span>
      ),
    }
    if (workshopMode)
      return [
        {
          key: 'equipment_code',
          header: t('equipmentCodeLabel'),
          width: '7rem',
          cell: (log) => (
            <span className="font-semibold">{log.equipment?.code ?? '—'}</span>
          ),
        },
        {
          key: 'equipment_type',
          header: t('equipmentNameLabel'),
          hideBelow: 'lg',
          cell: (log) => log.equipment?.type ?? '—',
        },
        status,
        {
          key: 'supervisor_name',
          header: t('supervisorName'),
          hideBelow: 'md',
          cell: (log) => log.supervisor?.full_name ?? '—',
        },
        {
          key: 'workshop_purpose',
          header: t('workshopPurpose'),
          cell: purposeCell,
        },
        recorded,
        created,
      ]
    return [
      {
        key: 'contractor_equipment_code',
        header: t('contractorEquipmentCode'),
        width: '7rem',
        cell: (log) => (
          <span className="font-semibold">
            {log.contractor_equipment_code ?? '—'}
          </span>
        ),
      },
      {
        key: 'equipment_code',
        header: t('equipmentCodeLabel'),
        cell: (log) => log.equipment?.code ?? '—',
      },
      status,
      {
        key: 'driver_name',
        header: t('driverName'),
        hideBelow: 'md',
        cell: (log) => log.current_driver_name ?? log.driver_name ?? '—',
      },
      recorded,
      created,
    ]
  }, [workshopMode, canClassify, classifyingId, t, onClassify])

  const title = workshopMode ? t('recentWorkshopLogs') : t('myMovements')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder={t('searchMovementRecords')}
          className="w-full sm:w-[340px]"
        />
        <Select
          className="w-32"
          value={filterType}
          onValueChange={(value) => changeFilters({ movement_type: value })}
          aria-label={t('movementType')}
          options={[
            { value: 'all', label: t('allTypes') },
            { value: 'entry', label: t('entry') },
            { value: 'exit', label: t('exit') },
          ]}
        />
        <DatePicker
          className="w-40"
          value={filterDate}
          onChange={(value) => changeFilters({ movement_date: value })}
          placeholder={t('date')}
          aria-label={t('date')}
        />
        {(filterType !== 'all' || filterDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              changeFilters({ movement_type: '', movement_date: '' })
            }
          >
            {t('clear')}
          </Button>
        )}
      </div>

      {loadError ? (
        <ErrorState
          title={t('movementLoadError')}
          onRetry={() => void fetchLogs()}
        />
      ) : (
        <>
          <DataTable
            size="md"
            columns={columns}
            rows={logs}
            rowKey={(log) => log.id}
            onRowClick={(log) => onSelectMovement(log.id)}
            loading={loading}
            loadingRows={5}
            empty={t('noLogs')}
            caption={title}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <span>{t('rowsPerPage')}</span>
              <Select
                className="w-24"
                value={String(list.pageSize)}
                onValueChange={(value) => list.setPageSize(Number(value))}
                aria-label={t('rowsPerPage')}
                options={PAGE_SIZE_OPTIONS.map((value) => ({
                  value: String(value),
                  label: String(value),
                }))}
              />
            </div>
            <DataListPagination
              page={list.page}
              pageSize={list.pageSize}
              total={total}
              onPage={list.setPage}
              onPageSize={list.setPageSize}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The movements card on both homes: the recorded movements (`السجل`) and the
 * same data paired into visits (`الزيارات`).
 *
 * The log stays the default tab so nothing changes for anyone who does not
 * open the new one. The active tab is persisted in the URL as `?view=visits`
 * (the default is left out of the query string), exactly like the rest of the
 * list state, so Back restores the tab as well. Each tab keeps its own search
 * and paging: the visits tab prefixes its parameters with `v`.
 */
export function HomeMovementsCard(props: HomeMovementsCardProps) {
  const { t } = useI18n()
  const params = useSearchParams()
  const view = params.get('view') === 'visits' ? 'visits' : 'log'
  const title = props.workshopMode ? t('recentWorkshopLogs') : t('myMovements')

  // Next patches history.replaceState, so `useSearchParams` re-renders with the
  // new value; this is the same mechanism the filters above already use.
  const changeView = (value: string) => {
    const url = new URL(window.location.href)
    if (value === 'visits') url.searchParams.set('view', 'visits')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  return (
    <Card className="space-y-3">
      <SectionHeader as="h2" title={title} />
      <Tabs value={view} onValueChange={changeView}>
        <TabsList>
          <TabsTrigger value="log">{t('movementsLogTab')}</TabsTrigger>
          <TabsTrigger value="visits">{t('visitsTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <MovementLogTab {...props} />
        </TabsContent>
        <TabsContent value="visits">
          <HomeVisitsTable
            workshopMode={props.workshopMode}
            onSelectMovement={props.onSelectMovement}
            refreshToken={props.refreshToken}
          />
        </TabsContent>
      </Tabs>
    </Card>
  )
}
