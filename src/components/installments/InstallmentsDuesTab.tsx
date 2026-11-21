import { useCallback, useMemo } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchInstallmentDuesPage,
  fetchInstallmentDuesViewCount,
  fetchInstallmentDuesTotal,
} from '@/lib/installmentsData'
import {
  DEFAULT_DUES_VIEW,
  installmentMonthLabel,
  installmentsWords,
  monthKeyOf,
  withFinancierOptions,
  INSTALLMENT_DUES_URL_PREFIX,
  INSTALLMENT_DUES_VIEWS,
  INSTALLMENT_DUES_VIEW_LABEL_KEYS,
  INSTALLMENT_DUES_VIEW_TONES,
  type InstallmentDuesViewTone,
  INSTALLMENTS_URL_KEYS,
  type InstallmentDueRow,
  type InstallmentDuesView,
  type InstallmentFinancierRow,
  type InstallmentOverviewRow,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'
import { installmentDuesListConfig } from '@/lib/listConfigs'
import { formatDate } from '@/lib/dateFormat'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  ContractCell,
  DueDateCell,
  InstallmentStateBadge,
  Money,
} from './cells'
import { useLoad } from './useLoad'

/**
 * «الاستحقاقات»: every unpaid row of the ACTIVE contracts over
 * `installment_dues`, the oldest first, in four sub-tabs (late, this month —
 * the default since 2026-11-21 —, within 30 days, everything unpaid), plus
 * «المسددة», the fully paid rows the latest paid first (the page's URL key
 * `view`), then the
 * program's unified list (`installmentDuesListConfig`, URL prefix `d`): the
 * shared toolbar with its search, filters (financier, due date) and sort,
 * the main list table look and the page sizes, all on the server. The total under the table is the
 * total of the WHOLE filtered view (a bounded read of its remaining
 * amounts), never the sum of the loaded page.
 */
/** A chip's colours by its urgency: a white chip with a dot of its colour,
 *  the chosen one in its light fill with a tick. */
const CHIP_TONE: Record<
  InstallmentDuesViewTone,
  { dot: string; active: string }
> = {
  danger: {
    dot: 'bg-danger',
    active:
      'data-[state=active]:border-danger data-[state=active]:bg-danger-soft data-[state=active]:text-danger',
  },
  warning: {
    dot: 'bg-warning',
    active:
      'data-[state=active]:border-warning data-[state=active]:bg-warning-soft data-[state=active]:text-warning',
  },
  info: {
    dot: 'bg-info',
    active:
      'data-[state=active]:border-info data-[state=active]:bg-info-soft data-[state=active]:text-info',
  },
  neutral: {
    dot: 'bg-muted',
    active:
      'data-[state=active]:border-fg data-[state=active]:bg-surface-hover data-[state=active]:text-fg',
  },
  success: {
    dot: 'bg-success',
    active:
      'data-[state=active]:border-success data-[state=active]:bg-success-soft data-[state=active]:text-success',
  },
}

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
  const today = useMemo(() => saudiDateKey(), [])
  // Always opens on «هذا الشهر» (owner 2026-11-21).
  const view: InstallmentDuesView = state.duesView ?? DEFAULT_DUES_VIEW
  const paidView = view === 'paid'
  const list = useDataListState(
    installmentDuesListConfig,
    INSTALLMENT_DUES_URL_PREFIX,
  )
  const { search, filters, sort, direction, page, pageSize } = list
  const filterFields = useMemo(
    () => withFinancierOptions(installmentDuesListConfig, financiers),
    [financiers],
  )

  const loader = useCallback(
    async (signal: AbortSignal) => {
      const query = { view, today, search, filters }
      const [rowsPage, sum] = await Promise.all([
        fetchInstallmentDuesPage(
          { ...query, sort, direction, page, pageSize },
          signal,
        ),
        fetchInstallmentDuesTotal(query, signal),
      ])
      return { ...rowsPage, sum }
    },
    [view, today, search, filters, sort, direction, page, pageSize],
  )
  const load = useLoad(loader, version)
  const rows = useMemo(() => load.data?.rows ?? [], [load.data])
  const total = load.data?.total ?? 0

  // «هذا الشهر» and «المسددة» need their own counts; the three others are
  // figures of the overview.
  const countsLoader = useCallback(
    async (signal: AbortSignal) => {
      const [month, paid] = await Promise.all([
        fetchInstallmentDuesViewCount('month', today, signal),
        fetchInstallmentDuesViewCount('paid', today, signal),
      ])
      return { month, paid }
    },
    [today],
  )
  const viewCounts = useLoad(countsLoader, version)
  const counts: Record<InstallmentDuesView, number | null> = {
    overdue: overview.overdue_count,
    month: viewCounts.data?.month ?? null,
    next30: overview.due_30_count,
    all: overview.open_count,
    paid: viewCounts.data?.paid ?? null,
  }

  const columns: DataTableColumn<InstallmentDueRow>[] = [
    {
      key: 'due_date',
      header: t('instDueDate'),
      sortable: true,
      cell: (row) =>
        paidView ? (
          <bdi dir="ltr" className="font-medium">
            {formatDate(row.due_date)}
          </bdi>
        ) : (
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
      key: 'seq',
      header: t('instInstallmentNo'),
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
        <InstallmentStateBadge
          size="sm"
          state={row.state}
          partial={row.is_partial}
        />
      ),
    },
    ...(paidView
      ? [
          {
            key: 'last_paid_on',
            header: t('instPaidOnCol'),
            sortable: true,
            cell: (row: InstallmentDueRow) =>
              row.last_paid_on ? (
                <bdi dir="ltr">{formatDate(row.last_paid_on)}</bdi>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
        ]
      : []),
    {
      // The installment's own amount (owner 2026-11-21, «مفروض باسم
      // القسط»); a partly paid one shows what remains under it.
      key: 'amount',
      header: t('instInstallment'),
      sortable: true,
      align: 'end',
      cell: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <Money value={row.amount} className="font-medium" />
          {row.is_partial && (
            <span className="flex items-center gap-1 text-xs text-muted">
              {t('instRemaining')}
              <Money value={row.remaining_amount} />
            </span>
          )}
        </span>
      ),
    },
    ...(canManage && !paidView
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
      {/* The approved design «نموذج 5»: the views as chips coloured by
          urgency, wrapping on a phone, and the open view's count and total
          beside them. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(next) =>
            update({
              [INSTALLMENTS_URL_KEYS.duesView]: next,
              [`${INSTALLMENT_DUES_URL_PREFIX}page`]: null,
            })
          }
          className="max-w-full"
        >
          <TabsList variant="chips" aria-label={t('instTabDues')}>
            {INSTALLMENT_DUES_VIEWS.map((value) => {
              const tone = CHIP_TONE[INSTALLMENT_DUES_VIEW_TONES[value]]
              const active = value === view
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className={cn(
                    'bg-bg text-fg hover:bg-surface-hover',
                    tone.active,
                    'data-[state=active]:font-semibold',
                  )}
                >
                  {active ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn('size-2 rounded-full', tone.dot)}
                    />
                  )}
                  {t(INSTALLMENT_DUES_VIEW_LABEL_KEYS[value])}
                  {counts[value] !== null && (
                    <span className="text-xs tabular-nums opacity-70">
                      {counts[value]}
                    </span>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
        {load.data && total > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {t(paidView ? 'instSummaryPaid' : 'instSummaryDue').replace(
              '{count}',
              installmentsWords(total, lang),
            )}
            {view === 'month' && (
              <span>· {installmentMonthLabel(monthKeyOf(today), lang)}</span>
            )}
            <Money
              value={load.data.sum.total}
              className="font-semibold text-fg"
            />
            {load.data.sum.partial && (
              <span className="w-full text-xs text-warning">
                {t('instPartialFigures')}
              </span>
            )}
          </p>
        )}
      </div>
      <DataListToolbar
        config={installmentDuesListConfig}
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
          sort={{ key: sort, direction }}
          onSortChange={list.setSort}
          cellTextClassName="text-[13px]"
          cellClassName="py-3"
          empty={
            <EmptyState
              icon={<CheckCircle2 size={28} aria-hidden="true" />}
              title={
                view === 'overdue'
                  ? t('instNoOverdue')
                  : paidView
                    ? t('instNoPaidHere')
                    : t('instNoDuesHere')
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
