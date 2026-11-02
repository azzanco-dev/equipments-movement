import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { RelativeTime } from '@/components/RelativeTime'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { ClientPoLinesPanel } from '@/components/sales/ClientPoLinesPanel'
import { ClientPoStatusBadge } from '@/components/sales/ClientPoStatusBadge'
import { CreateClientPoDialog } from '@/components/sales/CreateClientPoDialog'
import {
  AppLink,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  PRIMARY_ACTIVE_TRIGGER,
  Tabs,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { clientPosListConfig } from '@/lib/listConfigs'
import { localizedName } from '@/lib/localizedName'
import {
  CLIENT_PO_LIST_SELECT,
  clientPoLineCount,
  type ClientPoRow,
} from '@/lib/salesData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { ClientPoUnitsList } from '@/screens/sales/ClientPoUnitsList'

/**
 * The purchasing rule (owner 2026-10-31): «حسب المعدات» (one row per unit
 * on a PO, its list state under the `u` prefix; see `ClientPoUnitsList`) or
 * «حسب الاوامر» (the PO list, `?view=orders`, with the unprefixed list
 * state). «حسب المعدات» is the default and is left out of the query string.
 */
type PoListView = 'orders' | 'units'

const VIEWS: PoListView[] = ['units', 'orders']

/** Unprefixed list state that only the orders list reads: a URL holding any
 *  of these without a `view` still opens the orders list. */
const PO_ORDERS_STATE_KEYS = ['q', 'filters', 'sort', 'dir', 'page', 'size']

function hasOrdersState(params: Pick<URLSearchParams, 'has'>): boolean {
  return PO_ORDERS_STATE_KEYS.some((key) => params.has(key))
}

function resolvePoListView(
  params: Pick<URLSearchParams, 'get' | 'has'>,
): PoListView {
  const requested = params.get('view')
  if (requested === 'orders' || requested === 'units') return requested
  return hasOrdersState(params) ? 'orders' : 'units'
}

export interface ClientPosListScreenProps {
  onSelectPo: (poId: string) => void
}

/**
 * «PO العملاء» (/sales/orders, migration 0169, the /ui-kit mockup the
 * owner approved on 2026-11-02): the client POs, server-side searched by
 * the client's number, filtered by status / company / project / pricing,
 * sorted and paged through the unified list system; a row shows its units,
 * «تفاصيل» opens the PO page. The «PO عميل جديد» button needs
 * `sales.manage` (the database checks it again in `create_client_po`).
 */
export function ClientPosListScreen({ onSelectPo }: ClientPosListScreenProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const pathname = usePathname()
  const params = useSearchParams()
  const view = resolvePoListView(params)
  const list = useDataListState(clientPosListConfig)
  const [rows, setRows] = useState<ClientPoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ ...companyProjectFilters }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('client_pos')
      .select(CLIENT_PO_LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      clientPosListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(clientPosListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('clientPoListLoadError'))
    setRows((data as unknown as ClientPoRow[] | null) ?? [])
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

  // Each view fetches only while it is shown.
  useEffect(() => {
    if (view === 'orders') fetchRows()
  }, [fetchRows, view])

  const setView = (next: PoListView) => {
    const query = new URLSearchParams(
      [...params.entries()].filter(([key]) => key !== 'view'),
    )
    if (next === 'orders' || hasOrdersState(query)) query.set('view', next)
    const search = query.toString()
    window.history.replaceState(
      null,
      '',
      search ? `${pathname}?${search}` : pathname,
    )
  }

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const columns: DataTableColumn<ClientPoRow>[] = [
    {
      key: 'po_number',
      header: t('clientPoNumber'),
      sortable: true,
      cell: (row) => (
        <bdi dir="ltr" className="font-semibold">
          {row.po_number}
        </bdi>
      ),
    },
    // The client in the table's own style, the project under it.
    {
      key: 'company',
      header: t('company'),
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="font-medium">
            {row.company
              ? localizedName(lang, row.company.name_ar, row.company.name_en)
              : '—'}
          </span>
          <span className="text-xs text-muted">
            {row.project
              ? localizedName(lang, row.project.name_ar, row.project.name_en)
              : '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'issue_date',
      header: t('clientPoIssueDate'),
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) => formatDate(row.issue_date),
    },
    {
      key: 'expiry_date',
      header: t('clientPoExpiryDate'),
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) =>
        row.expiry_date ? (
          formatDate(row.expiry_date)
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'equipment_count',
      header: t('supplierPoEquipmentCount'),
      align: 'center',
      hideBelow: 'sm',
      className: 'tabular-nums',
      cell: (row) => clientPoLineCount(row),
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <ClientPoStatusBadge status={row.status} size="sm" />
          {(row.unpriced_count ?? 0) > 0 && (
            <Badge tone="warning" size="sm">
              {t('supplierPoNeedsPrices')} ({row.unpriced_count})
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.updated_at ?? row.created_at} />,
    },
    // The row opens its units; this button opens the PO (a real link).
    {
      key: 'details',
      header: <span className="sr-only">{t('supplierPoDetailsButton')}</span>,
      align: 'end',
      cell: (row) => (
        <Button size="sm" variant="primary" asChild>
          <AppLink
            href={`/sales/${row.id}`}
            onNavigate={() => onSelectPo(row.id)}
          >
            {t('supplierPoDetailsButton')}
          </AppLink>
        </Button>
      ),
    },
  ]

  const addButton = canManage ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => setCreateOpen(true)}
    >
      {t('clientPoNew')}
    </Button>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('clientPos')}
        description={t('clientPosDesc')}
        actions={addButton && <DataListActions primaryAction={addButton} />}
      />
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as PoListView)}
      >
        <TabsList variant="segmented" aria-label={t('poUnitsViewFilter')}>
          {VIEWS.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className={PRIMARY_ACTIVE_TRIGGER}
            >
              {value === 'orders'
                ? t('poUnitsViewOrders')
                : t('poUnitsViewUnits')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {view === 'units' ? (
        <ClientPoUnitsList onSelectPo={onSelectPo} />
      ) : (
        <>
          <DataListToolbar
            config={clientPosListConfig}
            search={list.searchInput}
            onSearch={list.setSearchInput}
            sort={list.sort}
            direction={list.direction}
            onSort={list.setSort}
            filterFields={clientPosListConfig.filterFields}
            filters={list.filters}
            onFilters={list.setFilters}
            asyncFields={asyncFields}
          />
          {loadError ? (
            <ErrorState description={loadError} onRetry={fetchRows} />
          ) : !loading && rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={28} aria-hidden="true" />}
              title={filtered ? t('clientPoEmptyFiltered') : t('clientPoEmpty')}
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
              caption={t('clientPos')}
              sort={{ key: list.sort, direction: list.direction }}
              onSortChange={list.setSort}
              expandable={{
                render: (row) => <ClientPoLinesPanel poId={row.id} />,
              }}
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
      )}
      <CreateClientPoDialog
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
