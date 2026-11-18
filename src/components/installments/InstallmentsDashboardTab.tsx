import { useCallback, useMemo } from 'react'
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Coins,
} from 'lucide-react'
import {
  AppLink,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Notice,
  SectionHeader,
  Skeleton,
  StatCard,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  fetchCashflowDues,
  fetchNearestDue,
  fetchOverdueContractsCount,
  fetchOverdueDues,
  fetchUpcomingDues,
} from '@/lib/installmentsData'
import {
  activeContractsWords,
  contractsWords,
  installmentsWords,
  monthlyDueBuckets,
  whenWords,
  type InstallmentDueRow,
  type InstallmentDuesView,
  type InstallmentOverviewRow,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { CashflowBars } from './CashflowBars'
import {
  ContractCell,
  DueDateCell,
  InstallmentStateBadge,
  Money,
} from './cells'
import { useLoad } from './useLoad'

/** The overdue card lists this many rows; the rest are a link away. */
export const DASHBOARD_OVERDUE_ROWS = 7
/** The «القادم خلال 30 يوما» table shows this many rows. */
export const DASHBOARD_UPCOMING_ROWS = 20

/**
 * «اللوحة»: the four figures of `installment_overview` (overdue is the only
 * red one), the bars of what is still to pay in the coming twelve months,
 * the overdue card and the table of what is due within 30 days. Every list
 * is a bounded, server-filtered, server-sorted read of `installment_dues`.
 */
export function InstallmentsDashboardTab({
  overview,
  version,
  canManage,
  onPay,
  onOpenContract,
  onShowDues,
}: {
  overview: InstallmentOverviewRow
  /** Bumped after a write: the reads run again. */
  version: number
  canManage: boolean
  onPay: (row: InstallmentDueRow) => void
  onOpenContract: (id: string) => void
  /** Opens «الاستحقاقات», on one of its sub-tabs when given. */
  onShowDues: (view?: InstallmentDuesView) => void
}) {
  const { t, lang } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [overdueContracts, nearest, overdue, upcoming, cashflow] =
        await Promise.all([
          fetchOverdueContractsCount(signal),
          fetchNearestDue(signal),
          fetchOverdueDues(DASHBOARD_OVERDUE_ROWS, signal),
          fetchUpcomingDues(DASHBOARD_UPCOMING_ROWS, signal),
          fetchCashflowDues(today, signal),
        ])
      return { overdueContracts, nearest, overdue, upcoming, cashflow }
    },
    [today],
  )
  const load = useLoad(loader, version)
  const data = load.data
  const months = useMemo(
    () => (data ? monthlyDueBuckets(data.cashflow.rows, today) : []),
    [data, today],
  )

  const payButton = (row: InstallmentDueRow) => (
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
  )

  const columns: DataTableColumn<InstallmentDueRow>[] = [
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
      key: 'due',
      header: t('instDueDate'),
      cell: (row) => (
        <DueDateCell dueDate={row.due_date} days={row.days_until_due} />
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
            cell: payButton,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      {/* The four numbers; overdue is the only red one. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('instOverdue')}
          value={<Money value={overview.overdue_amount} />}
          hint={
            overview.overdue_count === 0
              ? t('instNoOverdue')
              : data
                ? t('instOverdueHint')
                    .replace(
                      '{installments}',
                      installmentsWords(overview.overdue_count, lang),
                    )
                    .replace(
                      '{contracts}',
                      contractsWords(data.overdueContracts, lang),
                    )
                : installmentsWords(overview.overdue_count, lang)
          }
          icon={<AlertTriangle size={18} />}
          accent={overview.overdue_count > 0 ? 'danger' : undefined}
        />
        <StatCard
          label={t('instDue7')}
          value={<Money value={overview.due_7_amount} />}
          hint={
            !data ? undefined : data.nearest ? (
              <span>
                {t('instNearestDue')}{' '}
                <bdi dir="ltr">{formatDate(data.nearest.due_date)}</bdi> ·{' '}
                {whenWords(data.nearest.days_until_due, lang)}
              </span>
            ) : (
              t('instNoUpcoming')
            )
          }
          icon={<CalendarClock size={18} />}
          accent="warning"
        />
        <StatCard
          label={t('instDue30')}
          value={<Money value={overview.due_30_amount} />}
          hint={installmentsWords(overview.due_30_count, lang)}
          icon={<Calendar size={18} />}
        />
        <StatCard
          label={t('instRemainingOnContracts')}
          value={<Money value={overview.remaining_total} />}
          hint={activeContractsWords(overview.open_contract_count, lang)}
          icon={<Coins size={18} />}
        />
      </div>

      {load.status === 'failed' ? (
        <ErrorState
          description={t('instDashboardLoadError')}
          onRetry={load.reload}
        />
      ) : !data ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          <div className="grid gap-4 xl:grid-cols-3">
            <Skeleton className="h-80 w-full xl:col-span-2" />
            <Skeleton className="h-80 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="space-y-3 p-4 xl:col-span-2">
              <SectionHeader
                title={t('instCashflowTitle')}
                description={t('instCashflowDesc')}
              />
              {overview.open_contract_count > 0 ? (
                <>
                  <CashflowBars months={months} />
                  {data.cashflow.partial && (
                    <Notice tone="warning" size="compact">
                      {t('instPartialFigures')}
                    </Notice>
                  )}
                </>
              ) : (
                <EmptyState
                  title={t('instNoActiveContracts')}
                  className="p-6"
                />
              )}
            </Card>

            <Card padded={false} className="flex min-w-0 flex-col">
              <div className="p-4 pb-2">
                <SectionHeader
                  title={
                    <span className="flex items-center gap-2">
                      {t('instOverdueListTitle')}
                      {overview.overdue_count > 0 && (
                        <Badge size="sm" tone="danger">
                          {overview.overdue_count}
                        </Badge>
                      )}
                    </span>
                  }
                  description={t('instOverdueListDesc')}
                />
              </div>
              {data.overdue.length > 0 ? (
                // A list, not a table: the card is a third of the page, and a
                // row has to keep its title, its amount and «تسديد» in view.
                <ul className="divide-y border-t">
                  {data.overdue.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 p-3 ps-4"
                    >
                      <AppLink
                        href={`/installments/${row.contract_id}`}
                        className="block min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <span
                          className="block truncate-safe text-sm font-semibold"
                          title={row.description}
                        >
                          {row.description}
                        </span>
                        <span className="block truncate-safe text-xs text-muted">
                          <bdi dir="ltr">{row.contract_number}</bdi> ·{' '}
                          {row.financier_name}
                        </span>
                        <span className="mt-0.5 block text-xs text-danger">
                          <bdi dir="ltr">{formatDate(row.due_date)}</bdi> ·{' '}
                          {whenWords(row.days_until_due, lang)}
                        </span>
                      </AppLink>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Money
                          value={row.remaining_amount}
                          className="text-sm font-semibold"
                        />
                        {canManage && payButton(row)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 pt-0">
                  <Notice
                    tone="success"
                    size="compact"
                    icon={<CheckCircle2 size={16} />}
                  >
                    {t('instNoOverdue')}
                  </Notice>
                </div>
              )}
              {overview.overdue_count > data.overdue.length && (
                <div className="flex justify-center p-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onShowDues('overdue')}
                  >
                    {t('instAllOverdue').replace(
                      '{count}',
                      String(overview.overdue_count),
                    )}
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <Card padded={false}>
            <div className="p-4 pb-2">
              <SectionHeader
                title={t('instUpcomingTitle')}
                description={t('instUpcomingDesc')}
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onShowDues()}
                  >
                    {t('instAllDues')}
                  </Button>
                }
              />
            </div>
            <DataTable
              columns={columns}
              rows={data.upcoming}
              rowKey={(row) => row.id}
              onRowClick={(row) => onOpenContract(row.contract_id)}
              rowHref={(row) => `/installments/${row.contract_id}`}
              caption={t('instUpcomingTitle')}
              empty={
                <EmptyState title={t('instNoUpcoming30')} className="p-6" />
              }
              className="border-t"
            />
            {overview.due_30_count > data.upcoming.length && (
              <div className="flex justify-center border-t p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onShowDues('next30')}
                >
                  {t('instShowAllCount').replace(
                    '{count}',
                    String(overview.due_30_count),
                  )}
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
