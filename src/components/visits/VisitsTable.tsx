import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Notice,
  SearchInput,
  WorkshopPurposeBadge,
  type DataTableColumn,
} from '@/components/ui'
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
import { FilterButton } from '@/components/data-list/FilterButton'
import type { DataListConfig } from '@/components/data-list/types'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { exitPurposeLabelKey } from '@/lib/exitPurpose'
import type { ExportScope } from '@/lib/exportOptions'
import {
  previousCodeSearchTerm,
  resolvePreviousCodeIds,
  reusablePreviousCodeIds,
  withPreviousCodeBranch,
  type ResolvedPreviousCodes,
} from '@/lib/previousCodeSearch'
import {
  loadDriverChanges,
  loadDriverMobiles,
  loadEquipmentExportDetails,
  loadProfileNames,
} from '@/lib/exportFields'
import {
  EQUIPMENT_VISITS_SELECT,
  EQUIPMENT_VISITS_VIEW,
  adminVisitsListConfig,
  buildVisitSearchFilter,
  distinctDriverIds,
  distinctEquipmentIds,
  foremanVisitsListConfig,
  formatVisitDuration,
  siteEntryIds,
  visitContextFilter,
  visitExportColumns,
  visitExitPurpose,
  visitExportFileName,
  visitSortField,
  visitStateView,
  visitsListConfig,
  withCurrentDrivers,
  type EquipmentVisitRow,
  type VisitDriverChangeRow,
  type VisitsContext,
} from '@/lib/visitsList'

/**
 * The driver changes of a set of visits (site visits only: a workshop row
 * carries no driver), through the loader the exports share. Throws on a failed
 * query; the caller decides whether that fails the whole request.
 */
function loadVisitDriverChanges(
  visits: readonly EquipmentVisitRow[],
  signal?: AbortSignal,
): Promise<VisitDriverChangeRow[]> {
  return loadDriverChanges(supabase, siteEntryIds(visits), signal)
}

/** A config's allowlisted filter keys; nothing else reaches PostgREST. */
const filterKeys = (config: DataListConfig) =>
  new Set(config.filterFields.map((field) => field.key))

/** Allowlisted filter keys of the admin log's visits view. */
const ADMIN_FILTER_KEYS = filterKeys(adminVisitsListConfig)

/** The foreman home filters by company and project only. */
const FOREMAN_FILTER_KEYS = filterKeys(foremanVisitsListConfig)

/** The workshop home has no filters, so no key is allowed through. */
const NO_FILTER_KEYS = filterKeys(visitsListConfig)

export interface VisitsTableProps {
  /** `site` / `workshop` lists one movement context; `all` lists both. */
  context: VisitsContext
  /**
   * Scopes the list to visits whose ENTRY this user recorded (the foreman
   * home). RLS already limits a foreman to their own movements; the explicit
   * predicate keeps the list scoped exactly like the log tab next to it.
   */
  supervisorId?: string
  /**
   * `home` is the compact home tab: the search box, plus a filter button for
   * the foreman's site visits (company and project only; the workshop home
   * has no filters). `log` is the admin log's visits view: the shared toolbar
   * with its filter dialog, the foreman and context columns, and an Excel
   * export of every page of the current set.
   */
  variant?: 'home' | 'log'
  /**
   * Relational filter searches by field key: the foreman, company and project
   * of the `log` variant; the foreman home's own companies and projects.
   */
  asyncFields?: Record<string, FilterBarAsyncField>
  /** Opens the movement detail of one side of the visit. */
  onSelectMovement?: (id: string) => void
  /** Bumped by the screen after a mutation so the list refetches. */
  refreshToken?: number
  /**
   * URL parameter prefix for this table's list state, so it never collides
   * with a movement log rendered on the same route. Defaults to `v`.
   */
  urlPrefix?: string
}

/**
 * One row per visit: an ENTRY with the EXIT that closed it, or "still inside"
 * when there is none. Shared by the home movements card and the admin log.
 *
 * Search, filtering, ordering, counting and paging all run in PostgreSQL
 * through `movement_visits` (migration 0096, columns appended in 0106), whose
 * `security_invoker` view keeps `entry_exit_logs` RLS authoritative. The list
 * state lives in the URL under `urlPrefix`, so Back restores it. Order is
 * `entry_at` (or `exit_at`) then `entry_id`, the same `(recorded_at, id)`
 * rule the pairing itself uses, so paging never repeats or skips a visit.
 */
export function VisitsTable({
  context,
  supervisorId,
  variant = 'home',
  asyncFields,
  onSelectMovement,
  refreshToken = 0,
  urlPrefix = 'v',
}: VisitsTableProps) {
  const { t, lang } = useI18n()
  const isLog = variant === 'log'
  // The home's site list is the foreman's; the workshop home has no filters.
  const config = isLog
    ? adminVisitsListConfig
    : context === 'site'
      ? foremanVisitsListConfig
      : visitsListConfig
  const allowedFilterKeys = isLog
    ? ADMIN_FILTER_KEYS
    : context === 'site'
      ? FOREMAN_FILTER_KEYS
      : NO_FILTER_KEYS
  const list = useDataListState(config, urlPrefix)
  const { search, searchInput, setSearchInput, filters } = list
  const [visits, setVisits] = useState<EquipmentVisitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportNote, setExportNote] = useState<
    { tone: 'warning' | 'danger'; text: string } | undefined
  >(undefined)
  const listTopRef = useRef<HTMLDivElement>(null)

  const sortKey = visitSortField(list.sort)
  const ascending = list.direction === 'asc'

  /**
   * Context + scope + search + filters + sort as one query, shared by the
   * table, the export count and the export so the file can never disagree
   * with the screen. `scope: 'all'` (export only) keeps the context and the
   * foreman scope and drops the search and filters. `previousIds` are the
   * units whose previous code matched the search (wave-15-export, log
   * variant). `head` asks for the count alone.
   */
  const buildQuery = useCallback(
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
        .from(EQUIPMENT_VISITS_VIEW)
        .select(head ? 'entry_id' : EQUIPMENT_VISITS_SELECT, {
          count: 'exact',
          head,
        })
        .order(sortKey, { ascending, nullsFirst: false })
        .order('entry_id', { ascending: false })
      const movementContext = visitContextFilter(context)
      if (movementContext) query = query.eq('movement_context', movementContext)
      if (supervisorId) query = query.eq('entry_supervisor_id', supervisorId)
      if (scope === 'all') return query
      const searchFilter = withPreviousCodeBranch(
        buildVisitSearchFilter(search),
        previousIds,
      )
      if (searchFilter) query = query.or(searchFilter)
      // Keys are allowlisted per config before they reach PostgREST.
      return applyListFilters(query, filters, allowedFilterKeys)
    },
    [
      allowedFilterKeys,
      ascending,
      context,
      filters,
      search,
      sortKey,
      supervisorId,
    ],
  )

  /** The previous-code ids the list on screen was built with. */
  const resolvedPreviousRef = useRef<ResolvedPreviousCodes | null>(null)

  const startListRequest = useListRequest()
  const fetchVisits = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    // The admin log also finds a unit by a previous code: the matching ids
    // join the search as one more `or` branch. A failed probe is the list's
    // load error, never a silently narrower search. The homes keep their
    // search as it was.
    let previousIds: string[] = []
    if (isLog) {
      try {
        previousIds = await resolvePreviousCodeIds(supabase, search, signal)
      } catch (lookupError) {
        if (signal.aborted) return
        console.error('visits previous-code lookup failed', lookupError)
        setLoadError(true)
        setLoading(false)
        return
      }
      if (signal.aborted) return
    }
    const { data, error, count } = await buildQuery({ previousIds })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
      .abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      // The raw PostgREST message never reaches the user.
      console.error('visits list failed', error)
      setLoadError(true)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as unknown as EquipmentVisitRow[]
    // The driver changes are a secondary lookup: on failure the rows keep
    // their entry driver snapshot instead of failing the whole list.
    let changes: VisitDriverChangeRow[] = []
    try {
      changes = await loadVisitDriverChanges(rows, signal)
    } catch (lookupError) {
      if (signal.aborted) return
      console.error('visit driver changes failed', lookupError)
    }
    if (signal.aborted) return
    resolvedPreviousRef.current = {
      term: previousCodeSearchTerm(search),
      ids: previousIds,
    }
    setTotal(count ?? 0)
    setVisits(withCurrentDrivers(rows, changes))
    setLoading(false)
  }, [buildQuery, isLog, list.page, list.pageSize, search, startListRequest])

  useEffect(() => {
    void fetchVisits()
  }, [fetchVisits, refreshToken])

  // ============ EXPORT (wave-15-export, log variant) ============

  /**
   * The previous-code ids for the export: the ones the list resolved for this
   * very search, so the file matches the screen; probed again only if the
   * list has not resolved the current term yet.
   */
  const exportPreviousIds = useCallback(
    async (scope: ExportScope): Promise<string[]> => {
      if (scope === 'all' || !isLog) return []
      return (
        reusablePreviousCodeIds(resolvedPreviousRef.current, search) ??
        resolvePreviousCodeIds(supabase, search)
      )
    },
    [isLog, search],
  )

  const countVisits = useCallback(
    async (scope: ExportScope, signal: AbortSignal) => {
      const previousIds = await exportPreviousIds(scope)
      const { count, error } = await buildQuery({
        scope,
        previousIds,
        head: true,
      }).abortSignal(signal)
      if (error) throw error
      return count ?? 0
    },
    [buildQuery, exportPreviousIds],
  )

  /** The checklist's column descriptions; lookups are added at export time. */
  const exportColumns = useMemo(() => visitExportColumns(t, lang), [t, lang])

  /**
   * Walks every page of the chosen scope, in bounded pages exactly like the
   * movement log export, up to the file type's cap; a failure throws, so the
   * dialog reports it rather than writing an empty file.
   */
  const collectVisits = useCallback(
    async (
      scope: ExportScope,
      maxRows: number,
    ): Promise<ExportCollected<EquipmentVisitRow>> => {
      const previousIds = await exportPreviousIds(scope)
      const { collectAllPages, OUTSIDE_EXPORT_PAGE_SIZE } =
        await import('@/lib/adminHomeExport')
      const collected = await collectAllPages<EquipmentVisitRow>(
        async (page, pageSize) => {
          const { data, error, count } = await buildQuery({
            scope,
            previousIds,
          }).range((page - 1) * pageSize, page * pageSize - 1)
          if (error) throw error
          return {
            rows: (data ?? []) as unknown as EquipmentVisitRow[],
            total: count ?? 0,
          }
        },
        { pageSize: OUTSIDE_EXPORT_PAGE_SIZE, maxRows },
      )
      // wave-15-export-fields: the values the view does not carry, looked up
      // once for the rows in the file through the loaders both exports share
      // (`@/lib/exportFields`). A failed lookup throws, so the owner sees an
      // export failure instead of a file whose cells are silently empty.
      // First the current driver of each visit (a driver added or changed
      // after the entry lives only in the change records).
      const exportRows = withCurrentDrivers(
        collected.rows,
        await loadVisitDriverChanges(collected.rows),
      )
      // The supplier and the chassis in one equipment request per chunk, the
      // current driver's mobile, and the exit supervisor's name.
      const [
        { supplierByEquipment, chassisByEquipment },
        mobileByDriver,
        nameByProfile,
      ] = await Promise.all([
        loadEquipmentExportDetails(supabase, distinctEquipmentIds(exportRows)),
        loadDriverMobiles(supabase, distinctDriverIds(exportRows)),
        loadProfileNames(
          supabase,
          exportRows.map((row) => row.exit_supervisor_id),
        ),
      ])
      return {
        ...collected,
        rows: exportRows,
        columns: visitExportColumns(t, lang, {
          supplierByEquipment,
          chassisByEquipment,
          mobileByDriver,
          nameByProfile,
        }),
      }
    },
    [buildQuery, exportPreviousIds, lang, t],
  )

  const onExported = (result: ExportResult) => {
    if (result.capped)
      setExportNote({
        tone: 'warning',
        text: t('logsExportCapped')
          .replace('{count}', String(result.count))
          .replace('{total}', String(result.total)),
      })
  }

  const contextLabel =
    context === 'site'
      ? t('logsSites')
      : context === 'workshop'
        ? t('logsWorkshop')
        : t('logsAll')

  const changePage = (nextPage: number) => {
    list.setPage(nextPage)
    if (!isLog) return
    window.requestAnimationFrame(() =>
      listTopRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    )
  }

  const columns = useMemo<DataTableColumn<EquipmentVisitRow>[]>(() => {
    const equipment: DataTableColumn<EquipmentVisitRow> = {
      key: 'equipment_code',
      header: t('equipmentCodeLabel'),
      width: '9rem',
      cell: (visit) => (
        <span className="flex flex-col text-start">
          <span className="font-semibold">{visit.equipment_code ?? '—'}</span>
          {visit.equipment_type && (
            <span className="text-xs text-muted">{visit.equipment_type}</span>
          )}
          {/* The company number is a site-visit fact; workshop has none. */}
          {visit.movement_context === 'site' &&
            visit.contractor_equipment_code && (
              <span className="text-xs text-muted">
                {t('visitContractorCodeLine').replace(
                  '{code}',
                  visit.contractor_equipment_code,
                )}
              </span>
            )}
        </span>
      ),
    }
    const state: DataTableColumn<EquipmentVisitRow> = {
      key: 'is_open',
      header: t('visitState'),
      width: '9rem',
      cell: (visit) => {
        const view = visitStateView(visit)
        // wave-12: a closed site visit also says why it left (migration
        // 0118), inside the same badge (owner decision 2026-10-05); an open,
        // workshop or older visit shows the state alone.
        const purposeKey = exitPurposeLabelKey(visitExitPurpose(visit))
        return (
          <Badge tone={view.tone} className="whitespace-nowrap">
            {t(view.labelKey)}
            {purposeKey && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, {t('exitPurpose')}: </span>
                {t(purposeKey)}
              </>
            )}
          </Badge>
        )
      },
    }
    const contextColumn: DataTableColumn<EquipmentVisitRow> = {
      key: 'movement_context',
      header: t('logsColContext'),
      hideBelow: 'sm',
      width: '7rem',
      cell: (visit) =>
        visit.movement_context === 'workshop' ? (
          visit.workshop_purpose ? (
            <WorkshopPurposeBadge purpose={visit.workshop_purpose} />
          ) : (
            <Badge tone="warning">{t('logsWorkshop')}</Badge>
          )
        ) : (
          <Badge>{t('logsSites')}</Badge>
        ),
    }
    const purpose: DataTableColumn<EquipmentVisitRow> = {
      key: 'workshop_purpose',
      header: t('workshopPurpose'),
      // The EXIT never carries a purpose of its own; the visit row is where
      // the workshop classification of the whole stay is shown.
      cell: (visit) =>
        visit.workshop_purpose ? (
          <WorkshopPurposeBadge purpose={visit.workshop_purpose} />
        ) : (
          <Badge tone="warning">{t('awaitingClassification')}</Badge>
        ),
    }
    // One column for both (owner request 2026-09-30): the company with the
    // project under it. The Excel export keeps them as two columns.
    const companyProject: DataTableColumn<EquipmentVisitRow> = {
      key: 'company_project',
      header: t('logsColWhere'),
      hideBelow: 'md',
      cell: (visit) => <CompanyProjectCell row={visit} />,
    }
    const driver: DataTableColumn<EquipmentVisitRow> = {
      key: 'driver_name',
      header: t('driverName'),
      hideBelow: 'lg',
      cell: (visit) => visit.driver_name || '—',
    }
    const foreman: DataTableColumn<EquipmentVisitRow> = {
      key: 'entry_supervisor_name',
      header: t('logsColForeman'),
      hideBelow: 'lg',
      cell: (visit) => visit.entry_supervisor_name || '—',
    }
    // Entry and exit show the date only (owner request 2026-09-30); the
    // duration column carries the length of the stay.
    const entryAt: DataTableColumn<EquipmentVisitRow> = {
      key: 'entry_at',
      header: t('visitEntryAt'),
      sortable: true,
      cell: (visit) => (
        <span className="whitespace-nowrap text-muted">
          {formatDate(visit.entry_at)}
        </span>
      ),
    }
    const exitAt: DataTableColumn<EquipmentVisitRow> = {
      key: 'exit_at',
      header: t('visitExitAt'),
      sortable: true,
      cell: (visit) =>
        visit.exit_at && visit.exit_id ? (
          onSelectMovement ? (
            // Nested control: the row opens the ENTRY, this opens the EXIT.
            <button
              type="button"
              className="whitespace-nowrap rounded text-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={t('openExitMovement')}
              onClick={(event) => {
                event.stopPropagation()
                onSelectMovement(visit.exit_id as string)
              }}
            >
              {formatDate(visit.exit_at)}
            </button>
          ) : (
            <span className="whitespace-nowrap text-muted">
              {formatDate(visit.exit_at)}
            </span>
          )
        ) : (
          <span className="text-muted">—</span>
        ),
    }
    const duration: DataTableColumn<EquipmentVisitRow> = {
      key: 'duration_minutes',
      header: t('visitDuration'),
      align: 'end',
      // 12 px, one step below the rest of the row (owner request 2026-09-30).
      cell: (visit) => (
        <span className="text-xs text-muted">
          {formatVisitDuration(visit.duration_minutes, lang) ?? '—'}
        </span>
      ),
    }

    if (context === 'workshop')
      return isLog
        ? [equipment, state, purpose, foreman, entryAt, exitAt, duration]
        : [equipment, state, purpose, entryAt, exitAt, duration]
    if (context === 'site')
      return isLog
        ? [
            equipment,
            state,
            companyProject,
            driver,
            foreman,
            entryAt,
            exitAt,
            duration,
          ]
        : [equipment, state, companyProject, entryAt, exitAt, duration]
    return [
      equipment,
      state,
      contextColumn,
      companyProject,
      foreman,
      entryAt,
      exitAt,
      duration,
    ]
  }, [context, isLog, t, lang, onSelectMovement])

  return (
    <div ref={listTopRef} className="scroll-mt-20 space-y-3">
      {isLog ? (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <DataListToolbar
              config={adminVisitsListConfig}
              search={searchInput}
              onSearch={setSearchInput}
              sort={list.sort}
              direction={list.direction}
              onSort={list.setSort}
              filterFields={adminVisitsListConfig.filterFields}
              filters={filters}
              onFilters={list.setFilters}
              asyncFields={asyncFields}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setExportNote(undefined)
              setExportOpen(true)
            }}
            disabled={loadError}
          >
            <Download size={14} aria-hidden="true" />
            {t('exportButton')}
          </Button>
          <ExportDialog<EquipmentVisitRow>
            open={exportOpen}
            onOpenChange={setExportOpen}
            listId={adminVisitsListConfig.id}
            title={t('printTitleVisits')}
            fileName={visitExportFileName(context)}
            columns={exportColumns}
            contextLabel={`${contextLabel} · ${t('visitsTab')}`}
            search={search}
            activeFilters={countActiveFilters(filters)}
            countRows={countVisits}
            collectRows={collectVisits}
            onExported={onExported}
          />
        </div>
      ) : (
        // Search and the filter button share one row on every width; the
        // button is absent when the config has no filter fields (workshop).
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <SearchInput
            value={searchInput}
            onValueChange={setSearchInput}
            placeholder={t('searchVisitsWithContractorCode')}
            className="min-w-0 flex-1 sm:w-[340px] sm:flex-none"
          />
          <FilterButton
            fields={config.filterFields}
            filters={filters}
            onChange={list.setFilters}
            asyncFields={asyncFields}
          />
        </div>
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

      {loadError ? (
        // A failed load is shown as a failure, never as "no visits".
        <ErrorState
          title={t('visitsLoadError')}
          onRetry={() => void fetchVisits()}
        />
      ) : (
        <>
          <DataTable
            // 44 px rows on every width (owner request 2026-09-30). `md` rows
            // are already 44 px below 768 px, so the phone view of the home is
            // no taller; only desktop rows grow from 40 px.
            size="lg"
            columns={columns}
            rows={visits}
            rowKey={(visit) => visit.entry_id}
            onRowClick={
              onSelectMovement
                ? (visit) => onSelectMovement(visit.entry_id)
                : undefined
            }
            sort={{ key: sortKey, direction: ascending ? 'asc' : 'desc' }}
            onSortChange={(key, direction) => list.setSort(key, direction)}
            loading={loading}
            loadingRows={isLog ? 8 : 5}
            empty={
              <EmptyState
                className="border-0 p-0"
                title={t('noVisitsYet')}
                description={t('noVisitsHint')}
              />
            }
            caption={t('visitsTab')}
          />
          <DataListPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            onPage={changePage}
            onPageSize={list.setPageSize}
          />
        </>
      )}
    </div>
  )
}
