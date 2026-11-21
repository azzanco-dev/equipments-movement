import { useCallback } from 'react'
import { AlertTriangle, Calendar, CalendarClock, Coins } from 'lucide-react'
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  SectionHeader,
  Skeleton,
  StatCard,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  fetchNearestDue,
  fetchOverdueContractsCount,
  fetchUpcomingDues,
} from '@/lib/installmentsData'
import {
  activeContractsWords,
  contractsWords,
  installmentsWords,
  type InstallmentDueRow,
  type InstallmentDuesView,
  type InstallmentOverviewRow,
} from '@/lib/installmentsView'
import {
  ContractCell,
  DueDateCell,
  WhenBadge,
  InstallmentStateBadge,
  Money,
} from './cells'
import { useLoad } from './useLoad'

/** The «القادم خلال 30 يوما» table shows this many rows. */
export const DASHBOARD_UPCOMING_ROWS = 20

/**
 * «اللوحة»: the four figures of `installment_overview` (overdue is the only
 * red one), then the table of what is due within 30 days alone across the
 * width — the chart of the coming months and the overdue card were removed
 * on the owner's word of 2026-11-21 («مانحتاج الرسم البياني … وشيل جدول
 * المتاخرة»). The table is a bounded, server-filtered, server-sorted read of
 * `installment_dues`.
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
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [overdueContracts, nearest, upcoming] = await Promise.all([
        fetchOverdueContractsCount(signal),
        fetchNearestDue(signal),
        fetchUpcomingDues(DASHBOARD_UPCOMING_ROWS, signal),
      ])
      return { overdueContracts, nearest, upcoming }
    },
    [],
  )
  const load = useLoad(loader, version)
  const data = load.data

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
        <InstallmentStateBadge
          size="sm"
          state={row.state}
          partial={row.is_partial}
        />
      ),
    },
    {
      // The installment's own amount, as in «الاستحقاقات» (owner
      // 2026-11-21); a partly paid one shows what remains under it.
      key: 'amount',
      header: t('instInstallment'),
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
              <span className="inline-flex flex-wrap items-center gap-1">
                {t('instNearestDue')}{' '}
                <bdi dir="ltr">{formatDate(data.nearest.due_date)}</bdi>
                <WhenBadge days={data.nearest.days_until_due} />
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
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <>
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
              cellTextClassName="text-[13px]"
              cellClassName="py-3"
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
