import { useCallback, useMemo } from 'react'
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
} from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Notice,
  SectionHeader,
  Skeleton,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  fetchCashflowDues,
  fetchContractFigures,
  fetchContractsByIds,
  fetchDuesWithin,
  fetchNearestDue,
  fetchOverdueContractsCount,
} from '@/lib/installmentsData'
import {
  addDays,
  financierShares,
  financierTone,
  summarizeContracts,
  UPCOMING_CARDS,
  UPCOMING_DAYS,
} from '@/lib/installmentsBoard'
import {
  activeContractsWords,
  amountOf,
  contractsWords,
  installmentsWords,
  monthlyDueBuckets,
  type InstallmentDueRow,
  type InstallmentFinancierRow,
  type InstallmentOverviewRow,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { CashflowBars, CashflowLegend } from './CashflowBars'
import { ContractCard, FigureCard } from './boardParts'
import { Money, WhenBadge } from './cells'
import { useLoad } from './useLoad'

/**
 * «اللوحة» of the unified page (owner 2026-11-21, Figma frame «الاقساط /
 * الصفحة الموحدة: اللوحة», «اعتمد الصفحات وابني»): the four figures of
 * `installment_overview` as the tinted cards of design 1, «القادم خلال 7
 * ايام» as the contract cards of design 4 («عرض الكل» opens «الاستحقاقات»),
 * then «حسب الجهة التمويلية» beside «المستحق في الشهور القادمة» (design 1).
 * Every read is bounded, server-filtered and server-sorted.
 */
export function InstallmentsDashboardTab({
  overview,
  financiers,
  version,
  canManage,
  onPay,
  onShowDues,
}: {
  overview: InstallmentOverviewRow
  financiers: readonly InstallmentFinancierRow[]
  /** Bumped after a write: the reads run again. */
  version: number
  canManage: boolean
  onPay: (row: InstallmentDueRow) => void
  /** Opens «الاستحقاقات». */
  onShowDues: () => void
}) {
  const { t, lang, dir } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const loader = useCallback(
    async (signal: AbortSignal) => {
      const [overdueContracts, nearest, upcoming, cashflow, figures] =
        await Promise.all([
          fetchOverdueContractsCount(signal),
          fetchNearestDue(signal),
          fetchDuesWithin(UPCOMING_DAYS, UPCOMING_CARDS, signal),
          fetchCashflowDues(today, signal),
          fetchContractFigures(signal),
        ])
      const contracts = await fetchContractsByIds(
        upcoming.map((row) => row.contract_id),
        signal,
      )
      return {
        overdueContracts,
        nearest,
        upcoming,
        cashflow,
        figures,
        contracts,
      }
    },
    [today],
  )
  const load = useLoad(loader, version)
  const data = load.data
  const months = useMemo(
    () => (data ? monthlyDueBuckets(data.cashflow.rows, today) : []),
    [data, today],
  )
  const summary = useMemo(
    () => (data ? summarizeContracts(data.figures.rows, today) : null),
    [data, today],
  )
  const shares = useMemo(
    () => (data ? financierShares(data.figures.rows) : []),
    [data],
  )
  const contractsById = useMemo(
    () => new Map((data?.contracts ?? []).map((row) => [row.id, row])),
    [data],
  )
  const nameOf = (id: string) =>
    financiers.find((row) => row.id === id)?.name ?? '—'
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div className="space-y-4">
      {/* The four figures, design 1: late red, 7 days amber, 30 days blue,
          the remaining grey. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          tone="danger"
          icon={<AlertCircle size={20} />}
          title={t('instOverdue')}
          sub={
            overview.overdue_count === 0
              ? t('instNoOverdue')
              : installmentsWords(overview.overdue_count, lang)
          }
          value={<Money value={overview.overdue_amount} />}
          foot={
            overview.overdue_count > 0 && data
              ? t('instOverdueHint')
                  .replace(
                    '{installments}',
                    installmentsWords(overview.overdue_count, lang),
                  )
                  .replace(
                    '{contracts}',
                    contractsWords(data.overdueContracts, lang),
                  )
              : undefined
          }
        />
        <FigureCard
          tone="warning"
          icon={<CalendarClock size={20} />}
          title={t('instDue7')}
          sub={installmentsWords(overview.due_7_count, lang)}
          value={<Money value={overview.due_7_amount} />}
          foot={
            data?.nearest ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                {t('instNearestDue')}{' '}
                <bdi dir="ltr">{formatDate(data.nearest.due_date)}</bdi>
                <WhenBadge days={data.nearest.days_until_due} />
              </span>
            ) : data ? (
              t('instNoUpcoming')
            ) : undefined
          }
        />
        <FigureCard
          tone="info"
          icon={<Clock size={20} />}
          title={t('instDue30')}
          sub={installmentsWords(overview.due_30_count, lang)}
          value={<Money value={overview.due_30_amount} />}
          foot={
            <span>
              {t('instUntil')}{' '}
              <bdi dir="ltr">{formatDate(addDays(today, 30))}</bdi>
            </span>
          }
        />
        <FigureCard
          tone="neutral"
          icon={<FileText size={20} />}
          title={t('instRemainingOnContracts')}
          sub={activeContractsWords(overview.open_contract_count, lang)}
          value={<Money value={overview.remaining_total} />}
          foot={
            summary
              ? t('instPaidShare').replace(
                  '{percent}',
                  String(summary.paidPercent),
                )
              : undefined
          }
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-72 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold">{t('instUpcoming7Title')}</h2>
                <p className="text-xs text-muted">{t('instUpcoming7Desc')}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={onShowDues}>
                {t('instShowAll')}
                <Chevron size={14} aria-hidden="true" />
              </Button>
            </div>
            {data.upcoming.length === 0 ? (
              <Card>
                <EmptyState title={t('instNoUpcoming7')} className="p-6" />
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.upcoming.map((row) => {
                  const contract = contractsById.get(row.contract_id)
                  if (!contract) return null
                  return (
                    <ContractCard
                      key={row.id}
                      contract={contract}
                      tone={financierTone(financiers, row.financier_id)}
                      due={{
                        date: row.due_date,
                        amount: amountOf(row.remaining_amount),
                        days: row.days_until_due,
                      }}
                      canPay={canManage}
                      onPay={() => onPay(row)}
                    />
                  )
                })}
              </div>
            )}
          </section>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="space-y-3 xl:col-span-2">
              <SectionHeader
                title={t('instCashflowTitle')}
                description={t('instCashflowDesc')}
                action={<CashflowLegend />}
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
            <Card className="space-y-3">
              <SectionHeader
                title={t('instByFinancierTitle')}
                description={t('instByFinancierDesc')}
              />
              {shares.length === 0 ? (
                <p className="text-sm text-muted">
                  {t('instNoActiveContracts')}
                </p>
              ) : (
                <ul className="space-y-3">
                  {shares.map((share) => {
                    const tone = financierTone(financiers, share.financierId)
                    return (
                      <li key={share.financierId} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            <span
                              aria-hidden="true"
                              className="size-2.5 shrink-0 rounded-sm"
                              style={{
                                backgroundColor: `var(--chart-stroke-${tone})`,
                              }}
                            />
                            <span
                              className="truncate"
                              title={nameOf(share.financierId)}
                            >
                              {nameOf(share.financierId)}
                            </span>
                          </span>
                          <Money
                            value={share.remaining}
                            className="font-bold"
                          />
                        </div>
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${share.share}%`,
                              backgroundColor: `var(--chart-stroke-${tone})`,
                            }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {data.figures.partial && (
                <Notice tone="warning" size="compact">
                  {t('instPartialFigures')}
                </Notice>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
