import { useCallback, useMemo } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchInstallmentContractUnits,
  fetchInstallmentDuesMonthCount,
  fetchInstallmentDuesPage,
  fetchInstallmentDuesTotal,
} from '@/lib/installmentsData'
import {
  defaultDuesView,
  installmentMonthLabel,
  installmentsWords,
  monthKeyOf,
  unitsByContract,
  INSTALLMENT_DUES_VIEWS,
  INSTALLMENT_DUES_VIEW_LABEL_KEYS,
  INSTALLMENTS_PAGE_SIZE,
  INSTALLMENTS_URL_KEYS,
  type InstallmentDueRow,
  type InstallmentDuesView,
  type InstallmentFinancierRow,
  type InstallmentOverviewRow,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  ContractCell,
  DueDateCell,
  InstallmentStateBadge,
  Money,
  UnitTags,
} from './cells'
import { useLoad } from './useLoad'

const ALL = 'all'

/**
 * «الاستحقاقات»: every unpaid row of the ACTIVE contracts over
 * `installment_dues`, the oldest first, in four sub-tabs (late, this month,
 * within 30 days, everything unpaid) with a financier filter, paged on the
 * server; the state lives in the URL. The total under the table is the
 * total of the WHOLE filtered view (a bounded read of its remaining
 * amounts), never the sum of the loaded page.
 */
export function InstallmentsDuesTab({
  state,
  update,
  overview,
  financiers,
  version,
  canManage,
  onPay,
  onOpenContract,
}: {
  state: InstallmentsUrlState
  update: (values: Record<string, string | number | null>) => void
  overview: InstallmentOverviewRow
  financiers: readonly InstallmentFinancierRow[]
  version: number
  canManage: boolean
  onPay: (row: InstallmentDueRow) => void
  onOpenContract: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const keys = INSTALLMENTS_URL_KEYS
  const today = useMemo(() => saudiDateKey(), [])
  // Opens on what is late; with nothing late, on what is nearest.
  const view: InstallmentDuesView =
    state.duesView ?? defaultDuesView(overview.overdue_count)
  const financierId = state.duesFinancierId
  const page = state.duesPage

  const loader = useCallback(
    async (signal: AbortSignal) => {
      const query = { view, financierId, today }
      const [list, sum] = await Promise.all([
        fetchInstallmentDuesPage({ ...query, page }, signal),
        fetchInstallmentDuesTotal(query, signal),
      ])
      return { ...list, sum }
    },
    [view, financierId, today, page],
  )
  const load = useLoad(loader, version)
  const rows = useMemo(() => load.data?.rows ?? [], [load.data])
  const total = load.data?.total ?? 0

  // «هذا الشهر» alone needs its own count; the three others are figures of
  // the overview.
  const monthLoader = useCallback(
    (signal: AbortSignal) => fetchInstallmentDuesMonthCount(today, signal),
    [today],
  )
  const monthCount = useLoad(monthLoader, version)
  const counts: Record<InstallmentDuesView, number | null> = {
    overdue: overview.overdue_count,
    month: monthCount.data,
    next30: overview.due_30_count,
    all: overview.open_count,
  }

  // The tags are a nicety: a failed read leaves the cell empty-handed
  // («بدون» is never shown for a contract whose units could not be read).
  const idsKey = [...new Set(rows.map((row) => row.contract_id))].join(',')
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

  const columns: DataTableColumn<InstallmentDueRow>[] = [
    {
      key: 'due',
      header: t('instDueDate'),
      cell: (row) => (
        <DueDateCell dueDate={row.due_date} days={row.days_until_due} />
      ),
    },
    {
      key: 'contract',
      header: t('instContract'),
      cell: (row) => (
        <ContractCell
          description={row.description}
          contractNumber={row.contract_number}
          financierName={row.financier_name}
        />
      ),
    },
    {
      key: 'units',
      header: t('instUnits'),
      hideBelow: 'lg',
      cell: (row) => {
        const list = units.get(row.contract_id) ?? []
        if (unitsLoad.status !== 'ready')
          return <span className="text-muted">—</span>
        return <UnitTags units={list} count={list.length} />
      },
    },
    {
      key: 'seq',
      header: t('instInstallment'),
      hideBelow: 'md',
      cell: (row) => (
        <span className="flex items-center gap-1">
          <bdi dir="ltr" className="tabular-nums">
            {row.seq}/{row.installment_count}
          </bdi>
          {row.is_balloon && (
            <Badge size="sm" tone="info">
              {t('instBalloonBadge')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('instStatus'),
      cell: (row) => (
        <InstallmentStateBadge state={row.state} partial={row.is_partial} />
      ),
    },
    {
      key: 'remaining',
      header: t('instRemaining'),
      align: 'end',
      cell: (row) => (
        <Money value={row.remaining_amount} className="font-medium" />
      ),
    },
    ...(canManage
      ? [
          {
            key: 'action',
            header: <span className="sr-only">{t('instPayRow')}</span>,
            align: 'end' as const,
            cell: (row: InstallmentDueRow) => (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation()
                  onPay(row)
                }}
              >
                {t('instPayRow')}
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('instDuesDesc')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={view}
          onValueChange={(next) =>
            update({ [keys.duesView]: next, [keys.duesPage]: null })
          }
          className="max-w-full"
        >
          <TabsList variant="segmented" aria-label={t('instTabDues')}>
            {INSTALLMENT_DUES_VIEWS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(INSTALLMENT_DUES_VIEW_LABEL_KEYS[value])}
                {counts[value] !== null && (
                  <span className="ms-1 text-xs text-muted tabular-nums">
                    {counts[value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          size="sm"
          aria-label={t('instFinancier')}
          className="w-[190px]"
          value={financierId || ALL}
          onValueChange={(value) =>
            update({
              [keys.duesFinancier]: value === ALL ? null : value,
              [keys.duesPage]: null,
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
      </div>
      {load.status === 'failed' ? (
        <ErrorState
          description={t('instDuesLoadError')}
          onRetry={load.reload}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={!load.data}
          loadingRows={6}
          caption={t('instTabDues')}
          onRowClick={(row) => onOpenContract(row.contract_id)}
          rowHref={(row) => `/installments/${row.contract_id}`}
          rowLinkColumn="contract"
          rowClassName={(row) =>
            row.state === 'overdue' ? 'bg-danger-soft' : undefined
          }
          empty={
            <EmptyState
              icon={<CheckCircle2 size={28} aria-hidden="true" />}
              title={
                view === 'overdue' ? t('instNoOverdue') : t('instNoDuesHere')
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
            update({ [keys.duesPage]: next <= 1 ? null : Math.max(1, next) })
          }
        />
      )}
      {load.data && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-bg p-3 sm:p-4">
          <p className="text-sm font-medium">
            {t('instTotalOf').replace(
              '{count}',
              installmentsWords(total, lang),
            )}
            {view === 'month' && (
              <span className="text-muted">
                {' '}
                · {installmentMonthLabel(monthKeyOf(today), lang)}
              </span>
            )}
            {load.data.sum.partial && (
              <span className="block text-xs font-normal text-warning">
                {t('instPartialFigures')}
              </span>
            )}
          </p>
          <p className="text-lg font-semibold">
            <Money value={load.data.sum.total} />
          </p>
        </div>
      )}
    </div>
  )
}
