import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  CardMonthDueCell,
  CardMonthStateBadge,
} from '@/components/sales/CardMonthCells'
import { UnitIdentityCell } from '@/components/sales/UnitIdentityCell'
import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import {
  CARD_MONTHS_DEFAULT_FILTER,
  CARD_MONTHS_MONTH_FILTER_KEY,
  hasMonthOrCompanyFilter,
} from '@/lib/cardMonthsList'
import { cardMonthsListConfig } from '@/lib/listConfigs'
import {
  cardMonthState,
  currentSaudiMonthKey,
  monthKeyOf,
  monthKeysBetween,
  monthLabel,
  monthStartOf,
  shiftMonth,
  storedCardMonthFigures,
} from '@/lib/sales'
import {
  CARD_MONTH_SLOTS_SELECT,
  fetchEarliestCardDay,
  type CardMonthSlotRow,
} from '@/lib/salesData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export interface CardMonthsListScreenProps {
  onSelectCard: (cardId: string) => void
}

/** The month options the filter offers while the earliest card is unknown. */
const FALLBACK_MONTHS_BACK = 5

/**
 * «الشهور» (/sales/months, migration 0172, the /ui-kit mockup the owner
 * approved on 2026-11-04): every month of every card over
 * `sales_card_month_slots` — the recorded hours with their amounts, or the
 * month still awaiting the timesheet — in the main-list look; search by
 * unit, the month (the previous month by default, a visible removable
 * filter), company, project and recorded / awaiting server-side, the
 * awaited months first; a row opens the card page.
 */
export function CardMonthsListScreen({
  onSelectCard,
}: CardMonthsListScreenProps) {
  const { t, lang } = useI18n()
  const list = useDataListState(cardMonthsListConfig)
  const [rows, setRows] = useState<CardMonthSlotRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [earliestMonth, setEarliestMonth] = useState<string | null>(null)
  const currentMonth = currentSaudiMonthKey()

  // The month options: this month back to the earliest card month.
  useEffect(() => {
    let cancelled = false
    fetchEarliestCardDay()
      .then((day) => {
        if (!cancelled && day) setEarliestMonth(monthKeyOf(day))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const filterFields = useMemo(() => {
    const from =
      earliestMonth ?? shiftMonth(currentMonth, -FALLBACK_MONTHS_BACK)
    const options = monthKeysBetween(from, currentMonth)
      .reverse()
      .map((key) => ({
        value: monthStartOf(key),
        label: monthLabel(key, lang),
      }))
    return cardMonthsListConfig.filterFields.map((field) =>
      field.key === CARD_MONTHS_MONTH_FILTER_KEY
        ? { ...field, options }
        : field,
    )
  }, [earliestMonth, currentMonth, lang])

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ ...companyProjectFilters }),
    [companyProjectFilters],
  )

  // Neither a month nor a company left: the default month comes back.
  const { filters, setFilters } = list
  useEffect(() => {
    if (!hasMonthOrCompanyFilter(filters))
      setFilters([...filters, CARD_MONTHS_DEFAULT_FILTER])
    // `setFilters` is rebuilt on every render; the filters are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    const ascending = list.direction === 'asc'
    let query = supabase
      .from('sales_card_month_slots')
      .select(CARD_MONTH_SLOTS_SELECT, { count: 'exact' })
      // Unrecorded months carry NULL hours and amounts: always last.
      .order(list.sort, { ascending, nullsFirst: false })
      .order('equipment_code', { ascending: true })
      .order('slot_id', { ascending: true })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      cardMonthsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    // Never the whole view: the default month stands in until the effect
    // above has re-added it to the URL.
    const effective = hasMonthOrCompanyFilter(list.filters)
      ? list.filters
      : [...list.filters, CARD_MONTHS_DEFAULT_FILTER]
    query = applyListFilters(
      query,
      effective,
      new Set(cardMonthsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setRows([])
      setTotal(0)
    } else {
      setRows((data as unknown as CardMonthSlotRow[] | null) ?? [])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    startListRequest,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const columns: DataTableColumn<CardMonthSlotRow>[] = [
    {
      key: 'month',
      header: t('cardMonthsMonth'),
      sortable: true,
      className: 'whitespace-nowrap font-medium',
      cell: (row) => monthLabel(monthKeyOf(row.month), lang),
    },
    {
      key: 'equipment_code',
      header: t('supplierPoEquipmentField'),
      sortable: true,
      cell: (row) => (
        <UnitIdentityCell
          code={row.equipment_code}
          type={row.equipment_type}
          plate={row.equipment_plate_number}
          chassis={row.equipment_chassis_number}
        />
      ),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'hours',
      header: t('cardMonthHours'),
      sortable: true,
      align: 'center',
      className: 'tabular-nums',
      cell: (row) =>
        row.recorded && row.hours !== null ? (
          <bdi dir="ltr">{row.hours}</bdi>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'client_due',
      header: t('cardMonthClientDue'),
      sortable: true,
      align: 'end',
      cell: (row) => (
        <CardMonthDueCell
          due={storedCardMonthFigures(row).client}
          side="client"
        />
      ),
    },
    {
      key: 'supplier_due',
      header: t('cardMonthSupplierDue'),
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell
          due={storedCardMonthFigures(row).supplier}
          side="supplier"
        />
      ),
    },
    {
      key: 'margin',
      header: t('equipmentCardMargin'),
      sortable: true,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell
          due={storedCardMonthFigures(row).margin}
          side="margin"
        />
      ),
    },
    {
      key: 'recorded',
      header: t('status'),
      sortable: true,
      cell: (row) => (
        <CardMonthStateBadge state={cardMonthState(row, currentMonth)} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={t('cardMonths')} description={t('cardMonthsDesc')} />
      <DataListToolbar
        config={cardMonthsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState
          description={t('cardMonthsLoadError')}
          onRetry={fetchRows}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={28} aria-hidden="true" />}
          title={t('cardMonthsEmpty')}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.slot_id}
          loading={loading}
          loadingRows={6}
          caption={t('cardMonthsCaption')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectCard(row.card_id)}
          rowHref={(row) => `/sales/cards/${row.card_id}`}
          rowLinkColumn="equipment_code"
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
        />
      )}
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  )
}
