import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'
import {
  Badge,
  Button,
  DataTable,
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
import {
  ExportDialog,
  type ExportCollected,
  type ExportResult,
} from '@/components/data-list/ExportDialog'
import {
  countActiveFilters,
  type FilterBarAsyncField,
} from '@/components/data-list/FilterBar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { MovementTypeBadge } from '@/components/movement/ExitPurposeBadge'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDateTime } from '@/lib/dateFormat'
import type { ExportScope } from '@/lib/exportOptions'
import { logsListConfig } from '@/lib/listConfigs'
import type { MovementExportRow } from '@/lib/movementExcel'
import {
  MOVEMENT_LOG_ADMIN_SELECT,
  MOVEMENT_LOG_SEARCH_VIEW,
  buildMovementSearchFilter,
  type MovementLogSearchRow,
} from '@/lib/movementLogSearch'
import {
  previousCodeSearchTerm,
  resolvePreviousCodeIds,
  reusablePreviousCodeIds,
  withPreviousCodeBranch,
  type ResolvedPreviousCodes,
} from '@/lib/previousCodeSearch'
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
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPreparing, setExportPreparing] = useState(false)
  // The export columns' module, loaded on the first press (see openExport).
  const [movementExcel, setMovementExcel] = useState<
    typeof import('@/lib/movementExcel') | null
  >(null)
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
   * Shared by the table, the export count and the export itself, so the
   * exported file can never disagree with the list on screen; only the page
   * range differs. `scope: 'all'` (export only) keeps the tab's context and
   * drops the search and filters. `previousIds` are the units whose previous
   * code matched the search (wave-15-export), resolved once per list request
   * and reused by the export. `head` asks for the count alone.
   */
  const buildLogsQuery = useCallback(
    ({
      scope = 'current',
      previousIds = [],
      head = false,
    }: {
      scope?: ExportScope
      previousIds?: readonly string[]
      head?: boolean
    } = {}) => {
      let query = supabase
        .from(MOVEMENT_LOG_SEARCH_VIEW)
        .select(head ? 'id' : LIST_SELECT, { count: 'exact', head })
        .order(list.sort, { ascending: list.direction === 'asc' })
        // Deterministic paging: identical timestamps still resolve to one order.
        .order('id', { ascending: list.direction === 'asc' })
      if (tab !== 'all') query = query.eq('movement_context', tab)
      if (scope === 'all') return query
      const searchFilter = withPreviousCodeBranch(
        buildMovementSearchFilter(list.search, {
          includeCompanyProject: true,
        }),
        previousIds,
      )
      if (searchFilter) query = query.or(searchFilter)
      return applyListFilters(
        query,
        list.filters,
        new Set(logsListConfig.filterFields.map((field) => field.key)),
      )
    },
    [list.direction, list.filters, list.search, list.sort, tab],
  )

  /** The previous-code ids the list on screen was built with. */
  const resolvedPreviousRef = useRef<ResolvedPreviousCodes | null>(null)

  const startRequest = useListRequest()
  const fetchLogs = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    // A previous code still finds the unit: its ids join the search as one
    // more `or` branch. A failed probe is the list's load error, never a
    // silently narrower search.
    let previousIds: string[]
    try {
      previousIds = await resolvePreviousCodeIds(supabase, list.search, signal)
    } catch (lookupError) {
      if (signal.aborted) return
      console.error('logs previous-code lookup failed', lookupError)
      setLoadError(true)
      setLoading(false)
      return
    }
    if (signal.aborted) return
    const query = buildLogsQuery({ previousIds }).range(
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
    resolvedPreviousRef.current = {
      term: previousCodeSearchTerm(list.search),
      ids: previousIds,
    }
    setRows((data as unknown as LogRow[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [buildLogsQuery, list.page, list.pageSize, list.search, startRequest])

  useEffect(() => {
    // The visits view runs its own query; the movement log waits until shown.
    if (view !== 'log') return
    void fetchLogs()
  }, [fetchLogs, view])

  // ============ EXPORT (wave-15-export) ============

  /**
   * The previous-code ids for the export: the ones the list resolved for this
   * very search, so the file matches the screen; probed again only if the
   * list has not resolved the current term yet.
   */
  const exportPreviousIds = useCallback(
    async (scope: ExportScope): Promise<string[]> => {
      if (scope === 'all') return []
      return (
        reusablePreviousCodeIds(resolvedPreviousRef.current, list.search) ??
        resolvePreviousCodeIds(supabase, list.search)
      )
    },
    [list.search],
  )

  const countLogs = useCallback(
    async (scope: ExportScope, signal: AbortSignal) => {
      const previousIds = await exportPreviousIds(scope)
      const { count, error } = await buildLogsQuery({
        scope,
        previousIds,
        head: true,
      }).abortSignal(signal)
      if (error) throw error
      return count ?? 0
    },
    [buildLogsQuery, exportPreviousIds],
  )

  const exportColumns = useMemo(
    () => movementExcel?.movementExportColumns(t, lang) ?? [],
    [movementExcel, t, lang],
  )

  /**
   * Walks the chosen scope server-side in pages of `OUTSIDE_EXPORT_PAGE_SIZE`
   * up to the file type's cap, exactly as the admin home's export does, so
   * one press can never pull an unbounded table into the browser. A failure
   * throws, so the dialog reports it rather than writing an empty file.
   */
  const collectLogs = useCallback(
    async (
      scope: ExportScope,
      maxRows: number,
    ): Promise<ExportCollected<MovementExportRow>> => {
      const previousIds = await exportPreviousIds(scope)
      const { collectAllPages, OUTSIDE_EXPORT_PAGE_SIZE } =
        await import('@/lib/adminHomeExport')
      const collected = await collectAllPages<LogRow>(
        async (page, pageSize) => {
          const { data, error, count } = await buildLogsQuery({
            scope,
            previousIds,
          }).range((page - 1) * pageSize, page * pageSize - 1)
          if (error) throw error
          return {
            rows: (data as unknown as LogRow[]) ?? [],
            total: count ?? 0,
          }
        },
        { pageSize: OUTSIDE_EXPORT_PAGE_SIZE, maxRows },
      )
      return { ...collected, columns: exportColumns }
    },
    [buildLogsQuery, exportColumns, exportPreviousIds],
  )

  /**
   * Opens the export dialog. The column descriptions live in
   * `@/lib/movementExcel`, which also holds the import parser and its `xlsx`
   * dependency, so it is loaded on the first press rather than with the page.
   */
  const openExport = async () => {
    setExportNote(undefined)
    if (movementExcel) {
      setExportOpen(true)
      return
    }
    setExportPreparing(true)
    try {
      setMovementExcel(await import('@/lib/movementExcel'))
      setExportOpen(true)
    } catch (error) {
      console.error('logs export module failed', error)
      setExportNote({ tone: 'danger', text: t('logsExportFailed') })
    } finally {
      setExportPreparing(false)
    }
  }

  const onExported = (result: ExportResult) => {
    if (result.capped)
      setExportNote({
        tone: 'warning',
        text: t('logsExportCapped')
          .replace('{count}', String(result.count))
          .replace('{total}', String(result.total)),
      })
  }

  const tabLabel =
    tab === 'site'
      ? t('logsSites')
      : tab === 'workshop'
        ? t('logsWorkshop')
        : t('logsAll')

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
      width: '9rem',
      // wave-12: a site exit also shows its purpose, inside the same badge;
      // nothing extra for an entry, a workshop row or an exit before 0111.
      cell: (row) => (
        <MovementTypeBadge
          type={row.movement_type}
          exitPurpose={row.exit_purpose}
        />
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
              onClick={() => void openExport()}
              loading={exportPreparing}
              disabled={exportPreparing || loadError}
            >
              <Download size={14} aria-hidden="true" />
              {t('exportButton')}
            </Button>
          </div>

          {movementExcel && (
            <ExportDialog<MovementExportRow>
              open={exportOpen}
              onOpenChange={setExportOpen}
              listId={logsListConfig.id}
              title={t('printTitleMovements')}
              fileName={movementExcel.movementExportFileName(tab)}
              columns={exportColumns}
              contextLabel={`${tabLabel} · ${t('movementsLogsTab')}`}
              search={list.search}
              activeFilters={countActiveFilters(list.filters)}
              countRows={countLogs}
              collectRows={collectLogs}
              onExported={onExported}
            />
          )}

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
