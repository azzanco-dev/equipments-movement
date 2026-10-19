import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, ShoppingCart } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { CreateSupplierPoDialog } from '@/components/purchasing/CreateSupplierPoDialog'
import { SupplierPoStatusBadge } from '@/components/purchasing/SupplierPoStatusBadge'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { lessorFilterOptions } from '@/lib/equipmentSupplier'
import { supplierPosListConfig } from '@/lib/listConfigs'
import { supplierPoSupplierLabel } from '@/lib/purchasing'
import {
  SUPPLIER_PO_LIST_SELECT,
  supplierPoCompanyProject,
  supplierPoLineCount,
  type SupplierPoRow,
} from '@/lib/purchasingData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export interface SupplierPosListScreenProps {
  onSelectPo: (poId: string) => void
}

/**
 * «اوامر الشراء» (/purchasing): the supplier POs, server-side searched by
 * number, filtered by status / supplier / company / project, sorted and
 * paged through the unified list system; a row opens the PO page. The
 * «امر شراء جديد» button needs `purchasing.manage` (the database checks it
 * again in `create_supplier_po`).
 */
export function SupplierPosListScreen({ onSelectPo }: SupplierPosListScreenProps) {
  const { t } = useI18n()
  const { can } = usePermissions()
  const canManage = can('purchasing.manage')
  const list = useDataListState(supplierPosListConfig)
  const [rows, setRows] = useState<SupplierPoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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
    setLoadError(null)
    let query = supabase
      .from('supplier_pos')
      .select(SUPPLIER_PO_LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      supplierPosListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(supplierPosListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('supplierPoListLoadError'))
    setRows((data as unknown as SupplierPoRow[] | null) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    startListRequest,
    t,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const columns: DataTableColumn<SupplierPoRow>[] = [
    {
      key: 'po_number',
      header: t('supplierPoNumber'),
      sortable: true,
      cell: (row) => (
        <bdi dir="ltr" className="font-semibold">
          {row.po_number}
        </bdi>
      ),
    },
    {
      key: 'lessor',
      header: t('supplierPoSupplier'),
      className: 'font-medium',
      cell: (row) => supplierPoSupplierLabel(row, t),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      cell: (row) => <CompanyProjectCell row={supplierPoCompanyProject(row)} />,
    },
    {
      key: 'start_date',
      header: t('supplierPoStartDate'),
      sortable: true,
      className: 'tabular-nums',
      cell: (row) => formatDate(row.start_date),
    },
    {
      key: 'equipment_count',
      header: t('supplierPoEquipmentCount'),
      align: 'center',
      hideBelow: 'sm',
      className: 'tabular-nums',
      cell: (row) => supplierPoLineCount(row),
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      cell: (row) => <SupplierPoStatusBadge status={row.status} />,
    },
  ]

  const addButton = canManage ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => setCreateOpen(true)}
    >
      {t('supplierPoNew')}
    </Button>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('supplierPos')}
        description={t('supplierPosDesc')}
        actions={addButton && <DataListActions primaryAction={addButton} />}
      />
      <DataListToolbar
        config={supplierPosListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={supplierPosListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState description={loadError} onRetry={fetchRows} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart size={28} aria-hidden="true" />}
          title={filtered ? t('supplierPoEmptyFiltered') : t('supplierPoEmpty')}
          action={filtered ? undefined : addButton}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          caption={t('supplierPos')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectPo(row.id)}
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
      <CreateSupplierPoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false)
          onSelectPo(id)
        }}
      />
    </div>
  )
}
