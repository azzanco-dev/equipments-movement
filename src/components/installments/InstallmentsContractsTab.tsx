import { useCallback, useMemo } from 'react'
import { Building2, FileText, Plus } from 'lucide-react'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  SearchInput,
  Select,
  cn,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { INSTALLMENT_CONTRACT_STATUS_BADGE } from '@/lib/installments'
import {
  fetchInstallmentContractUnits,
  fetchInstallmentContractsPage,
} from '@/lib/installmentsData'
import {
  amountOf,
  paidPercent,
  unitsByContract,
  INSTALLMENT_CONTRACT_STATUSES,
  INSTALLMENTS_PAGE_SIZE,
  INSTALLMENTS_URL_KEYS,
  type InstallmentContractRow,
  type InstallmentFinancierRow,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  ContractCell,
  InstallmentContractStatusBadge,
  Money,
  OverdueBadge,
  PaidProgress,
  UnitTags,
} from './cells'
import { useLoad } from './useLoad'

const ALL = 'all'

/**
 * «العقود»: `installment_contract_summary`, searched (number, title,
 * financier), filtered (status, financier, «المتاخرة فقط»), sorted and paged
 * on the server, twenty a page; the state lives in the URL. The unit tags
 * come from ONE bounded read for the contracts of the page.
 */
export function InstallmentsContractsTab({
  state,
  update,
  searchInput,
  onSearchInput,
  financiers,
  totalContracts,
  version,
  canManage,
  onNewContract,
  onOpenContract,
}: {
  state: InstallmentsUrlState
  update: (values: Record<string, string | number | null>) => void
  searchInput: string
  onSearchInput: (value: string) => void
  financiers: readonly InstallmentFinancierRow[]
  /** Every contract of the program (0 = the first-use empty state). */
  totalContracts: number
  version: number
  canManage: boolean
  onNewContract: () => void
  onOpenContract: (id: string) => void
}) {
  const { t } = useI18n()
  const keys = INSTALLMENTS_URL_KEYS
  const today = useMemo(() => saudiDateKey(), [])
  const { search, status, financierId, overdueOnly, sort, direction, page } =
    state

  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchInstallmentContractsPage(
        { search, status, financierId, overdueOnly, sort, direction, page },
        signal,
      ),
    [search, status, financierId, overdueOnly, sort, direction, page],
  )
  const load = useLoad(loader, version)
  const rows = useMemo(() => load.data?.rows ?? [], [load.data])
  const total = load.data?.total ?? 0

  // The tags are a nicety: a failed read leaves the unit counts.
  const idsKey = rows
    .filter((row) => row.equipment_count > 0)
    .map((row) => row.id)
    .join(',')
  const unitsLoader = useCallback(
    (signal: AbortSignal) =>
      fetchInstallmentContractUnits(idsKey ? idsKey.split(',') : [], signal),
    [idsKey],
  )
  const unitsLoad = useLoad(unitsLoader, version)
  const units = useMemo(
    () => unitsByContract(unitsLoad.data ?? []),
    [unitsLoad.data],
  )

  const columns: DataTableColumn<InstallmentContractRow>[] = [
    {
      key: 'contract',
      header: t('instContract'),
      sortable: true,
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
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <Building2 size={14} aria-hidden="true" className="text-muted" />
          {row.financier_name}
        </span>
      ),
    },
    {
      key: 'units',
      header: t('instUnits'),
      hideBelow: 'md',
      cell: (row) => (
        <UnitTags units={units.get(row.id) ?? []} count={row.equipment_count} />
      ),
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
      key: 'remaining',
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
      key: 'next',
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
          <InstallmentContractStatusBadge status={row.status} />
          <OverdueBadge
            count={row.status === 'active' ? row.overdue_count : 0}
          />
        </span>
      ),
    },
  ]

  const filtered = Boolean(search) || Boolean(status) || Boolean(financierId)
  const noContractsYet = totalContracts === 0 && !filtered && !overdueOnly

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchInput}
          onValueChange={onSearchInput}
          placeholder={t('instContractsSearch')}
          className="w-full sm:w-72"
        />
        <Select
          size="sm"
          aria-label={t('instStatus')}
          className="w-[140px]"
          value={status || ALL}
          onValueChange={(value) =>
            update({
              [keys.status]: value === ALL ? null : value,
              [keys.page]: null,
            })
          }
          options={[
            { value: ALL, label: t('instAllStatuses') },
            ...INSTALLMENT_CONTRACT_STATUSES.map((item) => ({
              value: item,
              label: t(INSTALLMENT_CONTRACT_STATUS_BADGE[item].key),
            })),
          ]}
        />
        <Select
          size="sm"
          aria-label={t('instFinancier')}
          className="w-[190px]"
          value={financierId || ALL}
          onValueChange={(value) =>
            update({
              [keys.financier]: value === ALL ? null : value,
              [keys.page]: null,
            })
          }
          options={[
            { value: ALL, label: t('instAllFinanciers') },
            ...financiers.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
        <Checkbox
          checked={overdueOnly}
          onCheckedChange={(checked) =>
            update({
              [keys.overdueOnly]: checked === true ? '1' : null,
              [keys.page]: null,
            })
          }
          label={t('instOverdueOnly')}
        />
      </div>

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
          onSortChange={(key, next) =>
            update({
              [keys.sort]: key,
              [keys.direction]: next,
              [keys.page]: null,
            })
          }
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
          pageSize={INSTALLMENTS_PAGE_SIZE}
          total={total}
          onPage={(next) =>
            update({ [keys.page]: next <= 1 ? null : Math.max(1, next) })
          }
        />
      )}
    </div>
  )
}
