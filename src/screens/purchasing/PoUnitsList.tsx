import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { Truck } from 'lucide-react'
import { RelativeTime } from '@/components/RelativeTime'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { Price } from '@/components/purchasing/Price'
import {
  SupplierPoApprovalBadge,
  SupplierPoStatusBadge,
} from '@/components/purchasing/SupplierPoStatusBadge'
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
import { lessorFilterOptions } from '@/lib/equipmentSupplier'
import { poUnitsListConfig } from '@/lib/listConfigs'
import { splitPlateForDisplay } from '@/lib/plate'
import {
  supplierPoPartyOrFilter,
  supplierPoSupplierLabel,
} from '@/lib/purchasing'
import { PO_UNITS_SELECT, type PoUnitRow } from '@/lib/purchasingData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/** The URL prefix of this view's list state (like the visits' `v` on
 *  /logs): «حسب المعدات» is the default view, while «حسب الاوامر» keeps the
 *  unprefixed parameters the home's deep links carry. */
export const PO_UNITS_URL_PREFIX = 'u'

/** The green SPO pill of «المعدات في المشاريع». */
const SPO_PILL_STYLE: CSSProperties = {
  color: 'var(--success)',
  backgroundColor: 'var(--success-soft)',
}

/** The plate's digits, then its letters spaced by letter-spacing (as on the
 *  «المعدات في المشاريع» tickets); a plate not in the stored form, or the
 *  chassis, shows as it is; nothing without either. */
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

export interface PoUnitsListProps {
  onSelectPo: (poId: string) => void
}

/**
 * «حسب المعدات» of «اوامر الشراء» (owner 2026-10-31, migration 0167): one
 * row per unit on a supplier PO with its PO number, server-side searched,
 * filtered (the open POs by default), sorted and paged over
 * `purchasing_po_units`; a row opens its PO. Mounted only while the view is
 * active, so it fetches only then.
 */
export function PoUnitsList({ onSelectPo }: PoUnitsListProps) {
  const { t } = useI18n()
  const list = useDataListState(poUnitsListConfig, PO_UNITS_URL_PREFIX)
  const [rows, setRows] = useState<PoUnitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({
      lessor_id: lessorFilterOptions(supabase),
      ...companyProjectFilters,
    }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    const ascending = list.direction === 'asc'
    let query = supabase
      .from('purchasing_po_units')
      .select(PO_UNITS_SELECT, { count: 'exact' })
      .order(list.sort, { ascending })
      // A stable order for paging when the sort key repeats.
      .order('line_id', { ascending })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      poUnitsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    // The owner OR the supplier, like the orders list.
    const partyOr = supplierPoPartyOrFilter(list.filters)
    if (partyOr) query = query.or(partyOr.clause)
    query = applyListFilters(
      query,
      partyOr ? partyOr.rest : list.filters,
      new Set(poUnitsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setRows([])
      setTotal(0)
    } else {
      setRows((data as unknown as PoUnitRow[] | null) ?? [])
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

  const columns: DataTableColumn<PoUnitRow>[] = [
    // The identity cell (the equipment list's look): the bold code with the
    // plate or the chassis beside it (owner 2026-10-31, «اللوحة او الشاصي مع
    // عمود المعدة», as on the PO PDF), the type under them.
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
    // The row's link cell (rowLinkColumn): the green SPO pill.
    {
      key: 'po_number',
      header: t('siteUnitsPoNumber'),
      sortable: true,
      cell: (row) => (
        <span
          className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold"
          style={SPO_PILL_STYLE}
        >
          <bdi dir="ltr">{row.po_number}</bdi>
        </span>
      ),
    },
    {
      key: 'party',
      header: t('supplierPoParty'),
      hideBelow: 'sm',
      className: 'font-medium',
      cell: (row) =>
        supplierPoSupplierLabel(
          {
            is_internal: false,
            owner_class: row.owner_class,
            lessor: { name: row.lessor_name },
          },
          t,
        ),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'start_date',
      header: t('supplierPoStartDate'),
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) => formatDate(row.start_date),
    },
    {
      key: 'price',
      header: t('supplierPoPrice'),
      sortable: true,
      cell: (row) =>
        row.price === null ? (
          <Badge tone="warning" size="sm">
            {t('poUnitsNeedsPrice')}
          </Badge>
        ) : (
          <Price value={row.price} unit={row.rate_unit} />
        ),
    },
    {
      key: 'approval_status',
      header: t('supplierPoApproval'),
      hideBelow: 'sm',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <SupplierPoApprovalBadge
            po={{ status: row.po_status, approval_status: row.approval_status }}
            list
            size="sm"
          />
          {/* Only once the open-PO default filter is removed. */}
          {row.po_status === 'closed' && (
            <SupplierPoStatusBadge status={row.po_status} size="sm" />
          )}
        </span>
      ),
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
        config={poUnitsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={poUnitsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState description={t('poUnitsLoadError')} onRetry={fetchRows} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Truck size={28} aria-hidden="true" />}
          title={filtered ? t('poUnitsEmptyFiltered') : t('poUnitsEmpty')}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.line_id}
          loading={loading}
          loadingRows={6}
          caption={t('poUnitsCaption')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectPo(row.supplier_po_id)}
          rowHref={(row) => `/purchasing/${row.supplier_po_id}`}
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
