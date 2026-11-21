import { useCallback, useMemo, useState } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import {
  AppLink,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Notice,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { fetchContractFigures, fetchDuesFeed } from '@/lib/installmentsData'
import {
  dueShownAmount,
  dueTone,
  DUES_FEED_PAGE,
  DUES_FEED_VIEWS,
  financierShares,
  financierTone,
  groupDues,
  readDuesFeedView,
  summarizeContracts,
  type DuesFeedView,
  type DuesGroup,
  type DueTone,
} from '@/lib/installmentsBoard'
import {
  activeContractsWords,
  installmentMonthLabel,
  installmentsWords,
  INSTALLMENTS_URL_KEYS,
  type InstallmentDueRow,
  type InstallmentFinancierRow,
  type InstallmentOverviewRow,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { FinancierTile } from './boardParts'
import { Money, WhenBadge } from './cells'
import { useLoad } from './useLoad'

const VIEW_LABEL: Record<
  DuesFeedView,
  'instFeedOpen' | 'instFeedPaid' | 'instFeedAll'
> = {
  open: 'instFeedOpen',
  paid: 'instFeedPaid',
  all: 'instFeedAll',
}
const BAR: Record<DuesGroup['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
  neutral: 'bg-muted',
}
const ROW_BOX: Record<DueTone, string> = {
  danger: 'bg-danger-soft',
  warning: 'bg-warning-soft',
  info: 'bg-surface',
  success: 'bg-surface',
}
const DAY_INK: Record<DueTone, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
}

/**
 * «الاستحقاقات» of the unified page (owner 2026-11-21, Figma frame «الاقساط /
 * الصفحة الموحدة: الاستحقاقات», design 3 without its top ribbon): the
 * installments in groups — «متاخر», «هذا الاسبوع», «الاسبوع الجاي», then one
 * group a month — each with its count and total, every installment with its
 * day, its contract, its amount and «تسديد»; beside them the remaining on
 * the contracts, «عرض» (غير المسدد / المسدد / الكل) with the financier, and
 * the financiers' shares. «المسدد» is the quick way to the paid ones. The
 * view and the financier live in the URL; the rows are read in pages of
 * `DUES_FEED_PAGE` («عرض المزيد»).
 */
export function InstallmentsDuesTab({
  state,
  update,
  overview,
  financiers,
  version,
  canManage,
  onPay,
}: {
  state: InstallmentsUrlState
  update: (values: Record<string, string | number | null>) => void
  overview: InstallmentOverviewRow
  financiers: readonly InstallmentFinancierRow[]
  version: number
  canManage: boolean
  onPay: (row: InstallmentDueRow) => void
}) {
  const { t, lang } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const view = readDuesFeedView(state.feedView)
  const financierId =
    state.feedFinancier &&
    financiers.some((row) => row.id === state.feedFinancier)
      ? state.feedFinancier
      : null
  const [limit, setLimit] = useState(DUES_FEED_PAGE)

  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchDuesFeed({ view, financierId, limit }, signal),
    [view, financierId, limit],
  )
  const load = useLoad(loader, version)
  const figuresLoader = useCallback(
    (signal: AbortSignal) => fetchContractFigures(signal),
    [],
  )
  const figures = useLoad(figuresLoader, version)
  const groups = useMemo(
    () => groupDues(load.data?.rows ?? [], view, today),
    [load.data, view, today],
  )
  const summary = useMemo(
    () => (figures.data ? summarizeContracts(figures.data.rows, today) : null),
    [figures.data, today],
  )
  const shares = useMemo(
    () => (figures.data ? financierShares(figures.data.rows) : []),
    [figures.data],
  )
  const nameOf = (id: string) =>
    financiers.find((row) => row.id === id)?.name ?? '—'

  const groupTitle = (group: DuesGroup) => {
    if (group.kind === 'overdue') return t('instOverdue')
    if (group.kind === 'this_week') return t('instFeedThisWeek')
    if (group.kind === 'next_week') return t('instFeedNextWeek')
    const month = installmentMonthLabel(group.month ?? '', lang)
    return group.kind === 'paid_month'
      ? t('instFeedPaidIn').replace('{month}', month)
      : month
  }

  const feed = (
    <div className="min-w-0 space-y-4">
      {load.status === 'failed' ? (
        <ErrorState
          description={t('instDuesLoadError')}
          onRetry={load.reload}
        />
      ) : !load.data ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={28} aria-hidden="true" />}
          title={view === 'paid' ? t('instNoPaidHere') : t('instNoDuesHere')}
        />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <span
                    aria-hidden="true"
                    className={cn('h-5 w-1 rounded-full', BAR[group.tone])}
                  />
                  {groupTitle(group)}
                  <Badge size="sm">
                    {installmentsWords(group.rows.length, lang)}
                  </Badge>
                </h2>
                <Money value={group.total} className="font-bold" />
              </header>
              <ul className="space-y-2">
                {group.rows.map((row) => (
                  <FeedRow
                    key={row.id}
                    row={row}
                    canPay={canManage}
                    onPay={() => onPay(row)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {load.data.rows.length < load.data.total && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                {t('instShownOf')
                  .replace('{shown}', String(load.data.rows.length))
                  .replace('{total}', String(load.data.total))}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLimit((current) => current + DUES_FEED_PAGE)}
              >
                {t('instShowMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )

  const side = (
    <div className="min-w-0 space-y-3">
      <Card className="space-y-3">
        <p className="text-xs text-muted">{t('instRemainingOnContracts')}</p>
        <Money
          value={overview.remaining_total}
          className="text-2xl font-bold"
        />
        {summary && (
          <>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-hover"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${summary.paidPercent}%` }}
              />
            </div>
            <p className="flex justify-between gap-2 text-xs">
              <span className="text-success">
                {t('instPaidShare').replace(
                  '{percent}',
                  String(summary.paidPercent),
                )}
              </span>
              <span className="text-muted">
                {activeContractsWords(summary.activeCount, lang)}
              </span>
            </p>
          </>
        )}
      </Card>
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">{t('instFeedShow')}</h3>
        <Tabs
          value={view}
          onValueChange={(next) => {
            setLimit(DUES_FEED_PAGE)
            update({
              [INSTALLMENTS_URL_KEYS.duesView]: next === 'open' ? null : next,
            })
          }}
        >
          <TabsList
            variant="segmented"
            aria-label={t('instFeedShow')}
            className="w-full"
          >
            {DUES_FEED_VIEWS.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-1 justify-center"
              >
                {t(VIEW_LABEL[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          aria-label={t('instFinancier')}
          value={financierId ?? 'all'}
          onValueChange={(next) => {
            setLimit(DUES_FEED_PAGE)
            update({
              [INSTALLMENTS_URL_KEYS.feedFinancier]:
                next === 'all' ? null : next,
            })
          }}
          options={[
            { value: 'all', label: t('instAllFinanciers') },
            ...financiers.map((row) => ({ value: row.id, label: row.name })),
          ]}
        />
      </Card>
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">{t('instTabFinanciers')}</h3>
        {figures.status === 'failed' ? (
          <ErrorState
            description={t('instFinanciersLoadError')}
            onRetry={figures.reload}
          />
        ) : !figures.data ? (
          <Skeleton className="h-32 w-full" />
        ) : shares.length === 0 ? (
          <p className="text-sm text-muted">{t('instNoActiveContracts')}</p>
        ) : (
          <ul className="space-y-3">
            {shares.map((share) => (
              <li
                key={share.financierId}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FinancierTile
                    tone={financierTone(financiers, share.financierId)}
                    size={36}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {nameOf(share.financierId)}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('instShareOfRemaining').replace(
                        '{percent}',
                        String(share.share),
                      )}
                    </span>
                  </span>
                </span>
                <Money value={share.remaining} className="text-sm font-bold" />
              </li>
            ))}
          </ul>
        )}
        {figures.data?.partial && (
          <Notice tone="warning" size="compact">
            {t('instPartialFigures')}
          </Notice>
        )}
      </Card>
    </div>
  )

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      {feed}
      {side}
    </div>
  )
}

/** One installment of the feed: its day in its colour, the contract, the
 *  amount with when (or when it was paid) and «تسديد». */
function FeedRow({
  row,
  canPay,
  onPay,
}: {
  row: InstallmentDueRow
  canPay: boolean
  onPay: () => void
}) {
  const { t, lang } = useI18n()
  const tone = dueTone(row)
  const paid = row.state === 'paid'
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 sm:flex-nowrap',
        ROW_BOX[tone],
      )}
    >
      <div className={cn('w-12 shrink-0 text-center', DAY_INK[tone])}>
        <p className="text-xl font-bold leading-none tabular-nums">
          {Number(row.due_date.slice(8, 10))}
        </p>
        <p className="mt-1 text-xs text-muted">
          {installmentMonthLabel(row.due_date.slice(0, 7), lang, true)}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <AppLink
          href={`/installments/${row.contract_id}`}
          className="block truncate-safe text-sm font-semibold hover:underline"
        >
          {row.description}
        </AppLink>
        <p className="text-xs text-muted">
          <bdi dir="ltr">{row.contract_number}</bdi> · {row.financier_name} ·{' '}
          {t('instCardSeqOf')
            .replace('{seq}', String(row.seq))
            .replace('{count}', String(row.installment_count))}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Money value={dueShownAmount(row)} className="text-sm font-bold" />
        {paid ? (
          <span className="text-xs text-success">
            {row.last_paid_on
              ? t('instPaidOnShort').replace(
                  '{date}',
                  formatDate(row.last_paid_on),
                )
              : t('instPaid')}
          </span>
        ) : (
          <WhenBadge days={row.days_until_due} />
        )}
      </div>
      {canPay && !paid && (
        <Button
          size="sm"
          variant="outline"
          icon={<Check size={14} aria-hidden="true" />}
          onClick={onPay}
        >
          {t('instPayRow')}
        </Button>
      )}
    </li>
  )
}
