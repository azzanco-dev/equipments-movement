import { useCallback, useEffect, useMemo, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { RelativeTime } from '@/components/RelativeTime'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { PoPill } from '@/components/sales/PoPill'
import { SaleAmountOrDash } from '@/components/sales/SalePrice'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { equipmentCardsListConfig } from '@/lib/listConfigs'
import { saleRateUnitOf } from '@/lib/sales'
import {
  EQUIPMENT_CARDS_SELECT,
  type SalesEquipmentCardRow,
} from '@/lib/salesData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export interface EquipmentCardsScreenProps {
  onSelectCard: (cardId: string) => void
}

/** An Al-Azani unit never has a supplier side: «مملوكة». */
const isOwned = (row: SalesEquipmentCardRow) =>
  row.equipment_ownership_status === 'alazani'

/**
 * «كروت المعدات» (/sales/cards, migration 0169, the /ui-kit mockup the
 * owner approved on 2026-11-02): every «كرت المعدة» with both sides over
 * `sales_equipment_cards` in the main-list look — the unit, «الشركة ·
 * المشروع», the entry day of its visit, the client PO pill or «بدون», the
 * supplier PO pill, «بدون» or «مملوكة», the sale and purchase prices;
 * search, filters (company, project, without a client PO, without a
 * supplier PO), sort and paging server-side, the newest entry first. A row
 * opens the card page. Since migration 0189 (owner 2026-11-11) a card has
 * no period and is neither open nor ended: the period and status columns,
 * the open / ended filter and the 0185 switch «بانتظار الانهاء» are gone.
 */
export function EquipmentCardsScreen({
  onSelectCard,
}: EquipmentCardsScreenProps) {
  const { t } = useI18n()
  const list = useDataListState(equipmentCardsListConfig)
  const [rows, setRows] = useState<SalesEquipmentCardRow[]>([])
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
      .from('sales_equipment_cards')
      .select(EQUIPMENT_CARDS_SELECT, { count: 'exact' })
      .order(list.sort, { ascending, nullsFirst: false })
      // Within the sort key the newest card first, then the card id:
      // deterministic paging.
      .order('created_at', { ascending: false })
      .order('card_id', { ascending: true })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      equipmentCardsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(equipmentCardsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setRows([])
      setTotal(0)
    } else {
      setRows((data as unknown as SalesEquipmentCardRow[] | null) ?? [])
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

  const without = (
    <Badge tone="warning" size="sm">
      {t('equipmentCardWithout')}
    </Badge>
  )

  const columns: DataTableColumn<SalesEquipmentCardRow>[] = [
    {
      key: 'equipment_code',
      header: t('supplierPoEquipmentField'),
      sortable: true,
      cell: (row) => (
        <PurchasingUnitCell
          unit={{
            code: row.equipment_code ?? '—',
            type: row.equipment_type ?? '',
            plate_number: row.equipment_plate_number,
            chassis_number: row.equipment_chassis_number,
          }}
          withType
        />
      ),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    // 0189: the entry day of the card's visit (a card has no period).
    {
      key: 'entry_at',
      header: t('supplierPoEntryDate'),
      sortable: true,
      className: 'tabular-nums',
      cell: (row) =>
        row.entry_at ? (
          <bdi dir="ltr" className="whitespace-nowrap">
            {formatDate(row.entry_at)}
          </bdi>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'client_po',
      header: t('clientPo'),
      cell: (row) =>
        row.client_po_number ? (
          <PoPill number={row.client_po_number} muted={!row.has_client_po} />
        ) : (
          without
        ),
    },
    {
      key: 'supplier_po',
      header: t('supplierPo'),
      hideBelow: 'sm',
      cell: (row) =>
        isOwned(row) ? (
          <span className="text-xs text-muted">{t('equipmentCardOwned')}</span>
        ) : row.supplier_po_number ? (
          <PoPill number={row.supplier_po_number} />
        ) : (
          without
        ),
    },
    {
      key: 'client_price',
      header: t('salePrice'),
      hideBelow: 'md',
      cell: (row) => (
        <SaleAmountOrDash
          value={row.client_price}
          unit={row.client_rate_unit}
        />
      ),
    },
    {
      key: 'supplier_price',
      header: t('purchasePrice'),
      hideBelow: 'md',
      cell: (row) =>
        isOwned(row) || row.supplier_price === null ? (
          <span className="text-muted">—</span>
        ) : (
          <SaleAmountOrDash
            value={row.supplier_price}
            unit={saleRateUnitOf(row.supplier_rate_unit)}
          />
        ),
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'lg',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('equipmentCards')}
        description={t('equipmentCardsDesc')}
      />
      <DataListToolbar
        config={equipmentCardsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={equipmentCardsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState
          description={t('equipmentCardsLoadError')}
          onRetry={fetchRows}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<CreditCard size={28} aria-hidden="true" />}
          title={
            filtered
              ? t('equipmentCardsEmptyFiltered')
              : t('equipmentCardsEmpty')
          }
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.card_id}
          loading={loading}
          loadingRows={6}
          caption={t('equipmentCards')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectCard(row.card_id)}
          rowHref={(row) => `/sales/cards/${row.card_id}`}
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
