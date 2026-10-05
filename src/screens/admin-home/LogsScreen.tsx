import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { FileSpreadsheet } from 'lucide-react'
import {
  Badge,
  Button,
  DataTable,
  MovementBadge,
  Notice,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import type { FilterBarAsyncField } from '@/components/data-list/FilterBar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { ExitPurposeBadge } from '@/components/movement/ExitPurposeBadge'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDateTime } from '@/lib/dateFormat'
import { logsListConfig } from '@/lib/listConfigs'
import {
  MOVEMENT_LOG_ADMIN_SELECT,
  MOVEMENT_LOG_SEARCH_VIEW,
  buildMovementSearchFilter,
  type MovementLogSearchRow,
} from '@/lib/movementLogSearch'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { VisitsTable } from '@/components/visits/VisitsTable'

/** Which movements the tab shows; `all` applies no context predicate. */
type LogsTab = 'site' | 'workshop' | 'all'

const TABS: LogsTab[] = ['site', 'workshop', 'all']

function isLogsTab(value: string | null): value is LogsTab {
  return value === 'site' || value === 'workshop' || value === 'all'
}

/**
 * The second level (owner request EM-197): the recorded movements, or the
 * same movements paired into visits. Visits are the first and default view
 * (owner request 2026-09-30, like the home movements card), left out of the
 * query string; the log is `?view=log`.
 */
type LogsView = 'log' | 'visits'

const VIEWS: LogsView[] = ['visits', 'log']

/**
 * Unprefixed list state that only the movement log reads. Links into `/logs`
 * from the foreman activity, the driver detail and the equipment detail carry
 * `filters` / `q` for the log without a `view`, so a URL holding any of these
 * still opens the log rather than dropping the filter on the visits view.
 */
const LOG_STATE_KEYS = ['q', 'filters', 'sort', 'dir', 'page', 'size']

type QueryReader = Pick<URLSearchParams, 'get' | 'has'>

function hasLogState(params: QueryReader): boolean {
  return LOG_STATE_KEYS.some((key) => params.has(key))
}

function resolveLogsView(params: QueryReader): LogsView {
  const requested = params.get('view')
  if (requested === 'log' || requested === 'visits') return requested
  return hasLogState(params) ? 'log' : 'visits'
}

// `exit_purpose` (a site exit's purpose) is appended to the view by migration
// 0118; the table shows it on exit rows and the export writes it.
const LIST_SELECT = `${MOVEMENT_LOG_ADMIN_SELECT},workshop_purpose,equipment_ownership_status,exit_purpose`

/** Relational selectors show the first/best 20 matches, never more. */
const FOREMAN_OPTION_LIMIT = 20

/**
 * The foreman filter searches names server-side instead of preloading every
 * foreman into the config. `profile_names` (migration 0099) exposes only
 * id/full_name/role to signed-in users, which is all a name lookup needs.
 */
const foremanFilter: FilterBarAsyncField = {
  loadOptions: async (query) => {
    let request = supabase
      .from('profile_names')
      .select('id,full_name')
      .eq('role', 'supervisor')
      .order('full_name')
      .order('id')
      .limit(FOREMAN_OPTION_LIMIT)
    const term = sanitizeSearchTerm(query)
    if (term) request = request.ilike('full_name', `%${term}%`)
    const { data, error } = await request
    // AsyncSearchSelect shows its own load-error state; the raw PostgREST
    // message never reaches the user.
    if (error) throw error
    return (data ?? []).map((row) => ({
      value: row.id as string,
      label: (row.full_name as string | null) ?? '',
    }))
  },
  resolveOption: async (value) => {
    const { data, error } = await supabase
      .from('profile_names')
      .select('id,full_name')
      .eq('id', value)
      .maybeSingle()
    if (error || !data) return null
    return {
      value: data.id as string,
      label: (data.full_name as string | null) ?? '',
    }
  },
}

/** Stable across renders, so the bar's controls do not reload on each one. */
const LOGS_ASYNC_FILTERS = { supervisor_id: foremanFilter }

/** The visits view filters the ENTRY's recorder with the same search. */
const VISITS_ASYNC_FILTERS = { entry_supervisor_id: foremanFilter }

/** The visits view keeps its list state under its own URL prefix. */
const VISITS_URL_PREFIX = 'v'

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
 *
 * A second level (EM-197) shows the same context as visits through the
 * shared `VisitsTable` (`movement_visits`), with its own search, filters,
 * paging and Excel export under the `v` URL prefix. Visits are the default
 * view; the movement log is `?view=log`.
 */
export function LogsScreen({ onSelectMovement }: LogsScreenProps) {
  // Company and project are multi-selects searched server-side over every
  // company and project (admin and monitor), in both views; the foreman
  // filter is module-level because it never changes.
  const relationFilters = useCompanyProjectFilters()
  const logsAsyncFilters = useMemo(
    () => ({ ...LOGS_ASYNC_FILTERS, ...relationFilters }),
    [relationFilters],
  )
  const visitsAsyncFilters = useMemo(
    () => ({ ...VISITS_ASYNC_FILTERS, ...relationFilters }),
    [relationFilters],
  )
  const { t, lang } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const requestedTab = params.get('context')
  const tab: LogsTab = isLogsTab(requestedTab) ? requestedTab : 'site'
  const view = resolveLogsView(params)

  const list = useDataListState(logsListConfig)
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<
    { tone: 'warning' | 'danger'; text: string } | undefined
  >(undefined)
  const listTopRef = useRef<HTMLDivElement>(null)

  const replaceQuery = (query: URLSearchParams) => {
    const search = query.toString()
    window.history.replaceState(
      null,
      '',
      search ? `${pathname}?${search}` : pathname,
    )
  }

  const setTab = (next: LogsTab) => {
    const query = new URLSearchParams(params.toString())
    if (next === 'site') query.delete('context')
    else query.set('context', next)
    // A new context is a new list for both views.
    query.delete('page')
    query.delete(`${VISITS_URL_PREFIX}page`)
    replaceQuery(query)
  }

  const setView = (next: LogsView) => {
    const query = new URLSearchParams(params.toString())
    // Visits is the default and is left out, unless the URL still carries log
    // state that would otherwise select the log (see `resolveLogsView`).
    if (next === 'visits' && !hasLogState(query)) query.delete('view')
    else query.set('view', next)
    replaceQuery(query)
  }

  /**
   * The tab + search + filters + sort the user is looking at, as one query.
   *
   * Shared by the table and the Excel export so the exported file can never
   * disagree with the list on screen; only the page range differs.
   */
  const buildLogsQuery = useCallback(() => {
    let query = supabase
      .from(MOVEMENT_LOG_SEARCH_VIEW)
      .select(LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      // Deterministic paging: identical timestamps still resolve to one order.
      .order('id', { ascending: list.direction === 'asc' })
    if (tab !== 'all') query = query.eq('movement_context', tab)
    const searchFilter = buildMovementSearchFilter(list.search, {
      includeCompanyProject: true,
    })
    if (searchFilter) query = query.or(searchFilter)
    return applyListFilters(
      query,
      list.filters,
      new Set(logsListConfig.filterFields.map((field) => field.key)),
    )
  }, [list.direction, list.filters, list.search, list.sort, tab])

  const startRequest = useListRequest()
  const fetchLogs = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    const query = buildLogsQuery().range(
      (list.page - 1) * list.pageSize,
      list.page * list.pageSize - 1,
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
  }, [buildLogsQuery, list.page, list.pageSize, startRequest])

  useEffect(() => {
    // The visits view runs its own query; the movement log waits until shown.
    if (view !== 'log') return
    void fetchLogs()
  }, [fetchLogs, view])

  /**
   * Exports the current tab, search and filters — every page of them, not just
   * the page on screen.
   *
   * The set is walked server-side in pages of `OUTSIDE_EXPORT_PAGE_SIZE` up to
   * `OUTSIDE_EXPORT_MAX_ROWS`, exactly as the admin home's "outside" export
   * does, so one press can never pull an unbounded table into the browser. If
   * the cap truncates the file the user is told, rather than handed a silently
   * short export; a failure is reported as a failure, never as an empty file.
   * `xlsx` is imported dynamically so the log page does not carry the
   * spreadsheet library until somebody presses the button.
   */
  const exportLogs = async () => {
    setExporting(true)
    setExportNote(undefined)
    try {
      const { collectAllPages, OUTSIDE_EXPORT_PAGE_SIZE } =
        await import('@/lib/adminHomeExport')
      const collected = await collectAllPages<LogRow>(
        async (page, pageSize) => {
          const { data, error, count } = await buildLogsQuery().range(
            (page - 1) * pageSize,
            page * pageSize - 1,
          )
          if (error) throw error
          return {
            rows: (data as unknown as LogRow[]) ?? [],
            total: count ?? 0,
          }
        },
        { pageSize: OUTSIDE_EXPORT_PAGE_SIZE },
      )
      const [{ exportRowsToExcel }, movementExcel] = await Promise.all([
        import('@/lib/excel'),
        import('@/lib/movementExcel'),
      ])
      exportRowsToExcel(
        t('logs'),
        movementExcel.movementExportColumns(t, lang),
        collected.rows,
        {
          fileName: movementExcel.movementExportFileName(tab),
          rtl: lang === 'ar',
        },
      )
      if (collected.capped)
        setExportNote({
          tone: 'warning',
          text: t('logsExportCapped')
            .replace('{count}', String(collected.rows.length))
            .replace('{total}', String(collected.total)),
        })
    } catch (error) {
      // The raw PostgREST message never reaches the user.
      console.error('logs export failed', error)
      setExportNote({ tone: 'danger', text: t('logsExportFailed') })
    } finally {
      setExporting(false)
    }
  }

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
      // wave-12: a site exit also shows its purpose; nothing for an entry, a
      // workshop row or an exit recorded before migration 0111.
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <MovementBadge type={row.movement_type} />
          {row.movement_type === 'exit' && (
            <ExitPurposeBadge purpose={row.exit_purpose} />
          )}
        </span>
      ),
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
      // Company on top, project under it; shared with the visits table.
      cell: (row) => <CompanyProjectCell row={row} />,
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

      <div className="flex flex-wrap items-center gap-2">
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
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as LogsView)}
          className="sm:ms-auto"
        >
          <TabsList variant="segmented" aria-label={t('logsViewFilter')}>
            {VIEWS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value === 'log' ? t('movementsLogsTab') : t('visitsTab')}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {view === 'visits' ? (
        <VisitsTable
          variant="log"
          context={tab}
          asyncFields={visitsAsyncFilters}
          onSelectMovement={onSelectMovement}
          urlPrefix={VISITS_URL_PREFIX}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <DataListToolbar
                config={logsListConfig}
                search={list.searchInput}
                onSearch={list.setSearchInput}
                sort={list.sort}
                direction={list.direction}
                onSort={list.setSort}
                filterFields={logsListConfig.filterFields}
                filters={list.filters}
                onFilters={list.setFilters}
                asyncFields={logsAsyncFilters}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportLogs()}
              loading={exporting}
              disabled={exporting || loadError}
            >
              <FileSpreadsheet size={14} aria-hidden="true" />
              {t('exportExcel')}
            </Button>
          </div>

          {exportNote && (
            <Notice
              tone={exportNote.tone}
              size="compact"
              onDismiss={() => setExportNote(undefined)}
            >
              {exportNote.text}
            </Notice>
          )}

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
        </>
      )}
    </div>
  )
}
