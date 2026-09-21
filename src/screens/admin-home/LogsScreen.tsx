import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Badge,
  DataTable,
  MovementBadge,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import type { DataListConfig } from '@/components/data-list/types'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { logsListConfig } from '@/lib/listConfigs'
import {
  MOVEMENT_LOG_ADMIN_SELECT,
  MOVEMENT_LOG_SEARCH_VIEW,
  buildMovementSearchFilter,
  type MovementLogSearchRow,
} from '@/lib/movementLogSearch'
import { supabase } from '@/lib/supabase'

/** Which movements the tab shows; `all` applies no context predicate. */
type LogsTab = 'site' | 'workshop' | 'all'

const TABS: LogsTab[] = ['site', 'workshop', 'all']

function isLogsTab(value: string | null): value is LogsTab {
  return value === 'site' || value === 'workshop' || value === 'all'
}

const LIST_SELECT = `${MOVEMENT_LOG_ADMIN_SELECT},workshop_purpose,equipment_ownership_status`

type LogRow = MovementLogSearchRow

export interface LogsScreenProps {
  onSelectMovement?: (id: string) => void
}

/**
 * The full movement log.
 *
 * Search, filtering, sorting, counting and pagination all run in PostgreSQL
 * against the `movement_log_search` view (migration 0086, one column added in
 * 0094), so no page ever loads more than `pageSize` rows and the result count
 * is the real one. Filter keys are allowlisted against `logsListConfig` before
 * they reach PostgREST.
 *
 * Tab, search, filters, sort, page and page size all live in the URL, so Back
 * restores the list the user was looking at and a filtered log can be linked
 * to.
 */
export function LogsScreen({ onSelectMovement }: LogsScreenProps) {
  const { t, lang } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const requestedTab = params.get('context')
  const tab: LogsTab = isLogsTab(requestedTab) ? requestedTab : 'site'

  const list = useDataListState(logsListConfig)
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [foremen, setForemen] = useState<{ value: string; label: string }[]>([])
  const listTopRef = useRef<HTMLDivElement>(null)

  // The foreman filter needs its options; `profiles` is a small master table
  // and the admin movement log already lists its users elsewhere.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name')
        .eq('role', 'supervisor')
        .order('full_name')
        .limit(200)
        .abortSignal(controller.signal)
      if (controller.signal.aborted || error) return
      setForemen(
        (data ?? []).map((row) => ({
          value: row.id as string,
          label: (row.full_name as string) ?? '',
        })),
      )
    })()
    return () => controller.abort()
  }, [])

  const config: DataListConfig = useMemo(
    () => ({
      ...logsListConfig,
      filterFields: logsListConfig.filterFields.map((field) =>
        field.key === 'supervisor_id' ? { ...field, options: foremen } : field,
      ),
    }),
    [foremen],
  )

  const setTab = (next: LogsTab) => {
    const query = new URLSearchParams(params.toString())
    if (next === 'site') query.delete('context')
    else query.set('context', next)
    query.delete('page')
    const search = query.toString()
    window.history.replaceState(
      null,
      '',
      search ? `${pathname}?${search}` : pathname,
    )
  }

  const startRequest = useListRequest()
  const fetchLogs = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from(MOVEMENT_LOG_SEARCH_VIEW)
      .select(LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      // Deterministic paging: identical timestamps still resolve to one order.
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    if (tab !== 'all') query = query.eq('movement_context', tab)
    const searchFilter = buildMovementSearchFilter(list.search, {
      includeCompanyProject: true,
    })
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(logsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      // The raw PostgREST message never reaches the user.
      console.error('logs list failed', error)
      setLoadError(true)
      setLoading(false)
      return
    }
    setRows((data as unknown as LogRow[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    startRequest,
    tab,
  ])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  const changePage = (nextPage: number) => {
    list.setPage(nextPage)
    window.requestAnimationFrame(() =>
      listTopRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    )
  }

  const columns: DataTableColumn<LogRow>[] = [
    {
      key: 'equipment_code',
      header: t('equipmentCodeLabel'),
      sortable: true,
      width: '8rem',
      cell: (row) => (
        <span className="font-semibold">{row.equipment_code || '—'}</span>
      ),
    },
    {
      key: 'equipment_type',
      header: t('equipmentType'),
      hideBelow: 'md',
      cell: (row) => row.equipment_type || '—',
    },
    {
      key: 'movement_type',
      header: t('movementType'),
      sortable: true,
      width: '7rem',
      cell: (row) => <MovementBadge type={row.movement_type} />,
    },
    {
      key: 'movement_context',
      header: t('logsColContext'),
      hideBelow: 'sm',
      width: '7rem',
      cell: (row) =>
        row.movement_context === 'workshop' ? (
          row.workshop_purpose ? (
            <WorkshopPurposeBadge purpose={row.workshop_purpose} />
          ) : (
            <Badge tone="warning">{t('logsWorkshop')}</Badge>
          )
        ) : (
          <Badge>{t('logsSites')}</Badge>
        ),
    },
    {
      key: 'company',
      header: t('logsColWhere'),
      hideBelow: 'md',
      cell: (row) => {
        if (!row.company_id && !row.project_id) return '—'
        const company = row.company_id
          ? localizedName(lang, row.company_name_ar, row.company_name_en)
          : ''
        const project = row.project_id
          ? localizedName(lang, row.project_name_ar, row.project_name_en)
          : ''
        return [company, project].filter(Boolean).join(' · ')
      },
    },
    {
      key: 'driver_name',
      header: t('driverName'),
      hideBelow: 'lg',
      cell: (row) => row.driver_name || '—',
    },
    {
      key: 'supervisor_name',
      header: t('logsColForeman'),
      hideBelow: 'lg',
      cell: (row) => row.supervisor_name || '—',
    },
    {
      key: 'recorded_at',
      header: t('recordedAt'),
      sortable: true,
      width: '11rem',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted">
          {formatDateTime(row.recorded_at)}
        </span>
      ),
    },
  ]

  return (
    <div ref={listTopRef} className="scroll-mt-20 space-y-4">
      <PageHeader title={t('logs')} description={t('logsDesc')} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as LogsTab)}>
        <TabsList variant="segmented" aria-label={t('logsContextFilter')}>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'site'
                ? t('logsSites')
                : value === 'workshop'
                  ? t('logsWorkshop')
                  : t('logsAll')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataListToolbar
        config={config}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filters={list.filters}
        onFilters={list.setFilters}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={8}
        // A failed load is shown as a failure, never as "no movements".
        error={loadError ? t('logsLoadError') : undefined}
        empty={t('noMovements')}
        sort={{ key: list.sort, direction: list.direction }}
        onSortChange={list.setSort}
        onRowClick={
          onSelectMovement ? (row) => onSelectMovement(row.id) : undefined
        }
        caption={t('logs')}
      />

      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={changePage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  )
}
