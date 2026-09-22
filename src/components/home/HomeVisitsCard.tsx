import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import {
  Badge,
  DataTable,
  EmptyState,
  SearchInput,
  WorkshopPurposeBadge,
  type DataTableColumn,
} from '@/components/ui'
import { ErrorState } from '@/components/ui/ErrorState'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import {
  EQUIPMENT_VISITS_SELECT,
  EQUIPMENT_VISITS_VIEW,
  buildVisitSearchFilter,
  formatVisitDuration,
  visitSortField,
  visitStateView,
  visitsListConfig,
  type EquipmentVisitRow,
} from '@/lib/visitsList'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useDataListState } from '@/components/data-list/useDataListState'
import { DataListPagination } from '@/components/data-list/DataListPagination'

export interface HomeVisitsTableProps {
  /** Workshop roles list workshop visits; a foreman lists their own site ones. */
  workshopMode: boolean
  /** Opens the movement detail of one side of the visit. */
  onSelectMovement: (id: string) => void
  /** Bumped by the screen after a mutation so the tab refetches. */
  refreshToken: number
}

/**
 * The visits tab of the home movements card: one row per ENTRY with the EXIT
 * that closed it, or "still inside" when there is none.
 *
 * Everything — search, ordering, counting and paging — runs in PostgreSQL
 * through `movement_visits` (migration 0096), whose `security_invoker` view
 * keeps `entry_exit_logs` RLS authoritative. The list state lives in the URL
 * under a `v` prefix so it never collides with the log tab's own state and
 * Back restores both.
 */
export function HomeVisitsTable({
  workshopMode,
  onSelectMovement,
  refreshToken,
}: HomeVisitsTableProps) {
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const list = useDataListState(visitsListConfig, 'v')
  const { search, searchInput, setSearchInput } = list
  const [visits, setVisits] = useState<EquipmentVisitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const sortKey = visitSortField(list.sort)
  const ascending = list.direction === 'asc'

  const startListRequest = useListRequest()
  const fetchVisits = useCallback(async () => {
    if (!user) return
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)

    let query = supabase
      .from(EQUIPMENT_VISITS_VIEW)
      .select(EQUIPMENT_VISITS_SELECT, { count: 'exact' })
      .eq('movement_context', workshopMode ? 'workshop' : 'site')
      .order(sortKey, { ascending, nullsFirst: false })
      // Ties break on the entry id, the same `(recorded_at, id)` rule the
      // pairing itself uses, so paging never repeats or skips a visit.
      .order('entry_id', { ascending: false })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)

    // RLS already limits a foreman to their own movements; the explicit filter
    // keeps the tab scoped exactly like the log tab next to it.
    if (!workshopMode) query = query.eq('entry_supervisor_id', user.id)

    const searchFilter = buildVisitSearchFilter(search)
    if (searchFilter) query = query.or(searchFilter)

    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setLoading(false)
      return
    }
    setTotal(count ?? 0)
    setVisits((data ?? []) as unknown as EquipmentVisitRow[])
    setLoading(false)
  }, [
    user,
    workshopMode,
    search,
    sortKey,
    ascending,
    startListRequest,
    list.page,
    list.pageSize,
  ])

  useEffect(() => {
    void fetchVisits()
  }, [fetchVisits, refreshToken])

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
    const entryAt: DataTableColumn<EquipmentVisitRow> = {
      key: 'entry_at',
      header: t('visitEntryAt'),
      sortable: true,
      cell: (visit) => (
        <span className="text-muted">{formatDate(visit.entry_at)}</span>
      ),
    }
    const exitAt: DataTableColumn<EquipmentVisitRow> = {
      key: 'exit_at',
      header: t('visitExitAt'),
      sortable: true,
      cell: (visit) =>
        visit.exit_at && visit.exit_id ? (
          // Nested control: the row opens the ENTRY, this opens the EXIT.
          <button
            type="button"
            className="rounded text-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={t('openExitMovement')}
            onClick={() => onSelectMovement(visit.exit_id as string)}
          >
            {formatDate(visit.exit_at)}
          </button>
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
    if (workshopMode)
      return [
        equipment,
        state,
        {
          key: 'workshop_purpose',
          header: t('workshopPurpose'),
          // The EXIT never carries a purpose of its own; the visit row is
          // where the workshop classification of the whole stay is shown.
          cell: (visit) =>
            visit.workshop_purpose ? (
              <WorkshopPurposeBadge purpose={visit.workshop_purpose} />
            ) : (
              <Badge tone="warning">{t('awaitingClassification')}</Badge>
            ),
        },
        entryAt,
        exitAt,
        duration,
      ]
    return [
      equipment,
      state,
      {
        key: 'company_name',
        header: t('company'),
        hideBelow: 'md',
        cell: (visit) =>
          localizedName(lang, visit.company_name_ar, visit.company_name_en),
      },
      {
        key: 'project_name',
        header: t('project'),
        hideBelow: 'lg',
        cell: (visit) =>
          localizedName(lang, visit.project_name_ar, visit.project_name_en),
      },
      entryAt,
      exitAt,
      duration,
    ]
  }, [workshopMode, t, lang, onSelectMovement])

  return (
    <div className="space-y-3">
      <SearchInput
        value={searchInput}
        onValueChange={setSearchInput}
        placeholder={t('searchVisits')}
        className="w-full sm:w-[340px]"
      />

      {loadError ? (
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
            onRowClick={(visit) => onSelectMovement(visit.entry_id)}
            sort={{ key: sortKey, direction: ascending ? 'asc' : 'desc' }}
            onSortChange={(key, direction) => list.setSort(key, direction)}
            loading={loading}
            loadingRows={5}
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
            onPage={list.setPage}
            onPageSize={list.setPageSize}
          />
        </>
      )}
    </div>
  )
}
