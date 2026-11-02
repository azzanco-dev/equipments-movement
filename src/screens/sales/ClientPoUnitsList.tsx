import { useCallback, useEffect, useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { RelativeTime } from '@/components/RelativeTime'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { ClientPoStatusBadge } from '@/components/sales/ClientPoStatusBadge'
import { PoPill } from '@/components/sales/PoPill'
import { QuantityCell } from '@/components/sales/QuantityCell'
import { SalePrice } from '@/components/sales/SalePrice'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { clientPoUnitsListConfig } from '@/lib/listConfigs'
import { splitPlateForDisplay } from '@/lib/plate'
import { SALES_PO_UNITS_SELECT, type SalesPoUnitRow } from '@/lib/salesData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/** The URL prefix of this view's list state (the purchasing rule): «حسب
 *  المعدات» is the default view, while «حسب الاوامر» keeps the unprefixed
 *  parameters. */
export const CLIENT_PO_UNITS_URL_PREFIX = 'u'

/** The plate's digits, then its letters spaced by letter-spacing (as on
 *  the purchasing lists); the chassis as it is; nothing without either. */
function PlateOrChassis({
  plate,
  chassis,
}: {
  plate: string | null
  chassis: string | null
}) {
  const parts = plate ? splitPlateForDisplay(plate) : null
  const text = plate?.trim() || chassis?.trim()
  if (!parts)
    return text ? (
      <span dir="ltr" className="text-xs text-muted">
        {text}
      </span>
    ) : null
  return (
    <span dir="ltr" className="text-xs text-muted">
      {parts.digits}{' '}
      <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
    </span>
  )
}

export interface ClientPoUnitsListProps {
  onSelectPo: (poId: string) => void
}

/**
 * «حسب المعدات» of «PO العملاء» (migration 0169): one row per unit on a
 * client PO with its PO number, server-side searched, filtered (the open
 * POs by default), sorted and paged over `sales_po_units`; the supplier
 * side's PO shows as a muted pill when the same card carries one (and the
 * reader holds `purchasing.view`). A row opens its client PO. Mounted only
 * while the view is active, so it fetches only then.
 */
export function ClientPoUnitsList({ onSelectPo }: ClientPoUnitsListProps) {
  const { t } = useI18n()
  const list = useDataListState(
    clientPoUnitsListConfig,
    CLIENT_PO_UNITS_URL_PREFIX,
  )
  const [rows, setRows] = useState<SalesPoUnitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ ...companyProjectFilters }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    const ascending = list.direction === 'asc'
    let query = supabase
      .from('sales_po_units')
      .select(SALES_PO_UNITS_SELECT, { count: 'exact' })
      .order(list.sort, { ascending })
      // A stable order for paging when the sort key repeats.
      .order('line_id', { ascending })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      clientPoUnitsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(clientPoUnitsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setRows([])
      setTotal(0)
    } else {
      setRows((data as unknown as SalesPoUnitRow[] | null) ?? [])
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

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const columns: DataTableColumn<SalesPoUnitRow>[] = [
    // The identity cell: the bold code with the plate or the chassis beside
    // it, the type under them (the purchasing lists' look).
    {
      key: 'equipment_code',
      header: t('supplierPoEquipmentField'),
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span dir="ltr" className="font-semibold">
              {row.equipment_code ?? '—'}
            </span>
            <PlateOrChassis
              plate={row.equipment_plate_number}
              chassis={row.equipment_chassis_number}
            />
          </span>
          {row.equipment_type && (
            <span className="truncate-safe max-w-[12rem] text-xs text-muted">
              {row.equipment_type}
            </span>
          )}
        </span>
      ),
    },
    // The row's link cell (rowLinkColumn): the green client PO pill, with
    // the supplier side's PO muted under it when present.
    {
      key: 'po_number',
      header: t('clientPo'),
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <PoPill number={row.po_number} />
          {row.supplier_po_number && (
            <PoPill number={row.supplier_po_number} muted />
          )}
        </span>
      ),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'card_period_from',
      header: t('supplierPoStartDate'),
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) => formatDate(row.card_period_from),
    },
    {
      key: 'price',
      header: t('salePrice'),
      sortable: true,
      cell: (row) =>
        row.price === null ? (
          <Badge tone="warning" size="sm">
            {t('poUnitsNeedsPrice')}
          </Badge>
        ) : (
          <SalePrice value={row.price} unit={row.rate_unit} />
        ),
    },
    {
      key: 'quantity',
      header: t('clientPoQuantity'),
      hideBelow: 'sm',
      cell: (row) => (
        <QuantityCell quantity={row.quantity} unit={row.rate_unit} compact />
      ),
    },
    {
      key: 'po_status',
      header: t('status'),
      hideBelow: 'sm',
      cell: (row) => <ClientPoStatusBadge status={row.po_status} size="sm" />,
    },
    // The same «اخر تعديل» column as the other lists, last: the line's.
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  return (
    <>
      <DataListToolbar
        config={clientPoUnitsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={clientPoUnitsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState
          description={t('clientPoUnitsLoadError')}
          onRetry={fetchRows}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Truck size={28} aria-hidden="true" />}
          title={filtered ? t('poUnitsEmptyFiltered') : t('clientPoUnitsEmpty')}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.line_id}
          loading={loading}
          loadingRows={6}
          caption={t('clientPoUnitsCaption')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectPo(row.client_po_id)}
          rowHref={(row) => `/sales/${row.client_po_id}`}
          rowLinkColumn="po_number"
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
    </>
  )
}
