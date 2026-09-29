import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
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
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import type { FilterBarAsyncField } from '@/components/data-list/FilterBar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import {
  EQUIPMENT_VISITS_SELECT,
  EQUIPMENT_VISITS_VIEW,
  adminVisitsListConfig,
  buildVisitSearchFilter,
  formatVisitDuration,
  visitContextFilter,
  visitExportColumns,
  visitExportFileName,
  visitSortField,
  visitStateView,
  visitsListConfig,
  type EquipmentVisitRow,
  type VisitsContext,
} from '@/lib/visitsList'

/** Allowlisted filter keys of the admin log's visits view. */
const ADMIN_FILTER_KEYS = new Set(
  adminVisitsListConfig.filterFields.map((field) => field.key),
)

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
   * `home` is the compact home tab: search only. `log` is the admin log's
   * visits view: the shared toolbar with its filter dialog, the foreman and
   * context columns, and an Excel export of every page of the current set.
   */
  variant?: 'home' | 'log'
  /** Relational filters for the `log` variant (the foreman search). */
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
  const config = isLog ? adminVisitsListConfig : visitsListConfig
  const list = useDataListState(config, urlPrefix)
  const { search, searchInput, setSearchInput, filters } = list
  const [visits, setVisits] = useState<EquipmentVisitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<
    { tone: 'warning' | 'danger'; text: string } | undefined
  >(undefined)
  const listTopRef = useRef<HTMLDivElement>(null)

  const sortKey = visitSortField(list.sort)
  const ascending = list.direction === 'asc'

  /**
   * Context + scope + search + filters + sort as one query, shared by the
   * table and the export so the file can never disagree with the screen.
   */
  const buildQuery = useCallback(() => {
    let query = supabase
      .from(EQUIPMENT_VISITS_VIEW)
      .select(EQUIPMENT_VISITS_SELECT, { count: 'exact' })
      .order(sortKey, { ascending, nullsFirst: false })
      .order('entry_id', { ascending: false })
    const movementContext = visitContextFilter(context)
    if (movementContext) query = query.eq('movement_context', movementContext)
    if (supervisorId) query = query.eq('entry_supervisor_id', supervisorId)
    const searchFilter = buildVisitSearchFilter(search)
    if (searchFilter) query = query.or(searchFilter)
    // Only the admin variant has filters; keys are allowlisted either way.
    return isLog ? applyListFilters(query, filters, ADMIN_FILTER_KEYS) : query
  }, [ascending, context, filters, isLog, search, sortKey, supervisorId])

  const startListRequest = useListRequest()
  const fetchVisits = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    const { data, error, count } = await buildQuery()
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
    setTotal(count ?? 0)
    setVisits((data ?? []) as unknown as EquipmentVisitRow[])
    setLoading(false)
  }, [buildQuery, list.page, list.pageSize, startListRequest])

  useEffect(() => {
    void fetchVisits()
  }, [fetchVisits, refreshToken])

  /**
   * Exports every page of the current set, walked server-side in bounded
   * pages exactly like the movement log export; a capped file is announced
   * and a failure is reported as a failure, never as an empty file.
   */
  const exportVisits = async () => {
    setExporting(true)
    setExportNote(undefined)
    try {
      const { collectAllPages, OUTSIDE_EXPORT_PAGE_SIZE } =
        await import('@/lib/adminHomeExport')
      const collected = await collectAllPages<EquipmentVisitRow>(
        async (page, pageSize) => {
          const { data, error, count } = await buildQuery().range(
            (page - 1) * pageSize,
            page * pageSize - 1,
          )
          if (error) throw error
          return {
            rows: (data ?? []) as unknown as EquipmentVisitRow[],
            total: count ?? 0,
          }
        },
        { pageSize: OUTSIDE_EXPORT_PAGE_SIZE },
      )
      const { exportRowsToExcel } = await import('@/lib/excel')
      exportRowsToExcel(
        t('exportSheetVisits'),
        visitExportColumns(t, lang),
        collected.rows,
        { fileName: visitExportFileName(context), rtl: lang === 'ar' },
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
      console.error('visits export failed', error)
      setExportNote({ tone: 'danger', text: t('logsExportFailed') })
    } finally {
      setExporting(false)
    }
  }

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
    const formatInstant = isLog ? formatDateTime : formatDate
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
      width: '6rem',
      cell: (visit) => {
        const view = visitStateView(visit)
        return <Badge tone={view.tone}>{t(view.labelKey)}</Badge>
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
    const company: DataTableColumn<EquipmentVisitRow> = {
      key: 'company_name',
      header: t('company'),
      hideBelow: 'md',
      cell: (visit) =>
        visit.company_id
          ? localizedName(lang, visit.company_name_ar, visit.company_name_en)
          : '—',
    }
    const project: DataTableColumn<EquipmentVisitRow> = {
      key: 'project_name',
      header: t('project'),
      hideBelow: 'lg',
      cell: (visit) =>
        visit.project_id
          ? localizedName(lang, visit.project_name_ar, visit.project_name_en)
          : '—',
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
    const entryAt: DataTableColumn<EquipmentVisitRow> = {
      key: 'entry_at',
      header: t('visitEntryAt'),
      sortable: true,
      cell: (visit) => (
        <span className="whitespace-nowrap text-muted">
          {formatInstant(visit.entry_at)}
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
              {formatInstant(visit.exit_at)}
            </button>
          ) : (
            <span className="whitespace-nowrap text-muted">
              {formatInstant(visit.exit_at)}
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
      cell: (visit) => (
        <span className="text-muted">
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
            company,
            project,
            driver,
            foreman,
            entryAt,
            exitAt,
            duration,
          ]
        : [equipment, state, company, project, entryAt, exitAt, duration]
    return [
      equipment,
      state,
      contextColumn,
      company,
      project,
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
            onClick={() => void exportVisits()}
            loading={exporting}
            disabled={exporting || loadError}
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            {t('exportExcel')}
          </Button>
        </div>
      ) : (
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder={t('searchVisitsWithContractorCode')}
          className="w-full sm:w-[340px]"
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

      {loadError ? (
        // A failed load is shown as a failure, never as "no visits".
        <ErrorState
          title={t('visitsLoadError')}
          onRetry={() => void fetchVisits()}
        />
      ) : (
        <>
          <DataTable
            size="md"
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
