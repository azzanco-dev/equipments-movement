import { useCallback, useMemo } from 'react'
import { FileText, Plus } from 'lucide-react'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { RelativeTime } from '@/components/RelativeTime'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  cn,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  fetchInstallmentContractsPage,
} from '@/lib/installmentsData'
import {
  amountOf,
  paidPercent,
  withFinancierOptions,
  INSTALLMENT_CONTRACTS_URL_PREFIX,
  type InstallmentContractRow,
  type InstallmentFinancierRow,
} from '@/lib/installmentsView'
import { installmentContractsListConfig } from '@/lib/listConfigs'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  ContractCell,
  InstallmentContractStatusBadge,
  Money,
  OverdueBadge,
  PaidProgress,
} from './cells'
import { useLoad } from './useLoad'

/**
 * «العقود»: `installment_contract_summary` on the program's unified list
 * (`installmentContractsListConfig`, URL prefix `c`): the shared toolbar
 * with its search (number, title, financier), its filter dialog (status,
 * financier, «المتاخرة فقط», the next due date) and sort menu, the main
 * list table look and the page sizes 20 … 500, all on the server.
 */
export function InstallmentsContractsTab({
  financiers,
  totalContracts,
  version,
  canManage,
  onNewContract,
  onOpenContract,
}: {
  financiers: readonly InstallmentFinancierRow[]
  /** Every contract of the program (0 = the first-use empty state). */
  totalContracts: number
  version: number
  canManage: boolean
  onNewContract: () => void
  onOpenContract: (id: string) => void
}) {
  const { t } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const list = useDataListState(
    installmentContractsListConfig,
    INSTALLMENT_CONTRACTS_URL_PREFIX,
  )
  const { search, filters, sort, direction, page, pageSize } = list
  const filterFields = useMemo(
    () => withFinancierOptions(installmentContractsListConfig, financiers),
    [financiers],
  )

  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchInstallmentContractsPage(
        { search, filters, sort, direction, page, pageSize },
        signal,
      ),
    [search, filters, sort, direction, page, pageSize],
  )
  const load = useLoad(loader, version)
  const rows = useMemo(() => load.data?.rows ?? [], [load.data])
  const total = load.data?.total ?? 0

  const columns: DataTableColumn<InstallmentContractRow>[] = [
    {
      key: 'description',
      header: t('instContract'),
      sortable: true,
      // The identity cell: the title in bold, the number as its muted line.
      cell: (row) => (
        <ContractCell
          description={row.description}
          contractNumber={row.contract_number}
        />
      ),
    },
    {
      key: 'financier',
      header: t('instFinancier'),
      hideBelow: 'md',
      // The financier in its own column (owner 2026-11-19, «واستبدل عمود
      // المعدات بالجهة»: the units column is gone from the lists).
      cell: (row) => <span className="font-medium">{row.financier_name}</span>,
    },
    {
      key: 'paid',
      header: t('instPaid'),
      hideBelow: 'lg',
      cell: (row) => (
        <PaidProgress
          percent={paidPercent(
            amountOf(row.paid_total),
            amountOf(row.financed_amount),
          )}
          paidCount={row.paid_count}
          rowCount={row.installment_count}
        />
      ),
    },
    {
      key: 'remaining_total',
      header: t('instRemaining'),
      sortable: true,
      align: 'end',
      cell: (row) => (
        <Money
          value={row.status === 'cancelled' ? null : row.remaining_total}
        />
      ),
    },
    {
      key: 'next_due_date',
      header: t('instNextInstallment'),
      sortable: true,
      cell: (row) => {
        if (!row.next_due_date || row.status !== 'active')
          return <span className="text-muted">—</span>
        const late = row.next_due_date < today
        return (
          <span className="flex flex-col items-start">
            <bdi dir="ltr" className={cn(late && 'font-medium text-danger')}>
              {formatDate(row.next_due_date)}
            </bdi>
            <span className="text-xs text-muted">
              <Money value={row.next_due_amount} />
            </span>
          </span>
        )
      },
    },
    {
      key: 'status',
      header: t('instStatus'),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <InstallmentContractStatusBadge size="sm" status={row.status} />
          <OverdueBadge
            size="sm"
            count={row.status === 'active' ? row.overdue_count : 0}
          />
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
  ]

  const filtered = Boolean(search) || filters.length > 0
  const noContractsYet = totalContracts === 0 && !filtered

  return (
    <div className="space-y-3">
      <DataListToolbar
        config={installmentContractsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={sort}
        direction={direction}
        onSort={list.setSort}
        filterFields={filterFields}
        filters={filters}
        onFilters={list.setFilters}
      />

      {load.status === 'failed' ? (
        <ErrorState
          description={t('instContractsLoadError')}
          onRetry={load.reload}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={!load.data}
          loadingRows={6}
          caption={t('instTabContracts')}
          onRowClick={(row) => onOpenContract(row.id)}
          rowHref={(row) => `/installments/${row.id}`}
          sort={{ key: sort, direction }}
          onSortChange={list.setSort}
          cellTextClassName="text-[13px]"
          cellClassName="py-3"
          empty={
            <EmptyState
              icon={<FileText size={28} aria-hidden="true" />}
              title={
                noContractsYet
                  ? t('instNoContractsYet')
                  : t('instNoContractsMatch')
              }
              action={
                noContractsYet && canManage ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={14} aria-hidden="true" />}
                    onClick={onNewContract}
                  >
                    {t('instContractNew')}
                  </Button>
                ) : undefined
              }
            />
          }
          className="rounded-xl border bg-bg"
        />
      )}
      {load.status !== 'failed' && total > 0 && (
        <DataListPagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  )
}
