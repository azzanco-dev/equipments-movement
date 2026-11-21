import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
} from 'lucide-react'
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { daysUntilDue } from '@/lib/installments'
import {
  fetchContractCards,
  fetchContractFigures,
} from '@/lib/installmentsData'
import {
  amountOf,
  INSTALLMENTS_URL_KEYS,
  type InstallmentContractRow,
  type InstallmentFinancierRow,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'
import {
  CONTRACT_CARDS_PAGE,
  CONTRACT_CHIPS,
  CONTRACT_SORTS,
  contractChipCounts,
  financierTone,
  readContractChip,
  readContractSort,
  summarizeContracts,
  type ContractChip,
  type ContractSort,
} from '@/lib/installmentsBoard'
import { saudiDateKey } from '@/lib/saudiTime'
import { ContractCard, FigureCard, type BoardTone } from './boardParts'
import { Money } from './cells'
import { useLoad } from './useLoad'

/** A chip's urgency colour (design «نموذج 5»): «الكل» neutral, late red,
 *  ending soon amber, paid off green, cancelled grey. */
const CHIP_TONE: Record<ContractChip, BoardTone> = {
  all: 'neutral',
  overdue: 'danger',
  ending: 'warning',
  paid_off: 'success',
  cancelled: 'neutral',
}
const CHIP_LABEL: Record<
  ContractChip,
  | 'instChipAll'
  | 'instChipOverdue'
  | 'instChipEnding'
  | 'instChipPaidOff'
  | 'instChipCancelled'
> = {
  all: 'instChipAll',
  overdue: 'instChipOverdue',
  ending: 'instChipEnding',
  paid_off: 'instChipPaidOff',
  cancelled: 'instChipCancelled',
}
const SORT_LABEL: Record<
  ContractSort,
  'instSortNextDue' | 'instSortUpdated' | 'instSortRemaining' | 'instSortNumber'
> = {
  next_due: 'instSortNextDue',
  updated: 'instSortUpdated',
  remaining: 'instSortRemaining',
  number: 'instSortNumber',
}
const CHIP_DOT: Record<BoardTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
  neutral: 'bg-muted',
}
const CHIP_ACTIVE: Record<BoardTone, string> = {
  danger:
    'data-[state=active]:border-danger data-[state=active]:bg-danger-soft data-[state=active]:text-danger',
  warning:
    'data-[state=active]:border-warning data-[state=active]:bg-warning-soft data-[state=active]:text-warning',
  info: 'data-[state=active]:border-info data-[state=active]:bg-info-soft data-[state=active]:text-info',
  success:
    'data-[state=active]:border-success data-[state=active]:bg-success-soft data-[state=active]:text-success',
  neutral:
    'data-[state=active]:border-fg data-[state=active]:bg-surface-hover data-[state=active]:text-fg',
}

/**
 * «العقود» of the unified page (owner 2026-11-21, Figma frame «الاقساط /
 * الصفحة الموحدة: العقود», design 4 with the chips of «نموذج 5»): four
 * figures — active contracts, paid, remaining, ending this year —, the
 * chips الكل / فيها متاخر / تخلص قريب (last installment within
 * `ENDING_SOON_DAYS`) / مسددة / ملغاة with their counts, the search and the
 * sort, then the contracts as cards (ring, remaining, the next installment,
 * «فتح العقد» and «تسديد»), `CONTRACT_CARDS_PAGE` at a time. Chip, sort and
 * search live in the URL; the cards are read on the server.
 */
export function InstallmentsContractsTab({
  state,
  update,
  financiers,
  totalContracts,
  version,
  canManage,
  onNewContract,
  onPay,
}: {
  state: InstallmentsUrlState
  update: (values: Record<string, string | number | null>) => void
  financiers: readonly InstallmentFinancierRow[]
  /** Every contract of the program (0 = the first-use empty state). */
  totalContracts: number
  version: number
  canManage: boolean
  onNewContract: () => void
  onPay: (contract: InstallmentContractRow) => void
}) {
  const { t } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const chip = readContractChip(state.contractChip)
  const sort = readContractSort(state.contractSort)
  const search = state.contractSearch
  const [typed, setTyped] = useState(search)
  const [limit, setLimit] = useState(CONTRACT_CARDS_PAGE)

  // The search box writes the URL 300 ms after the last key.
  useEffect(() => {
    if (typed === search) return
    const timer = window.setTimeout(() => {
      setLimit(CONTRACT_CARDS_PAGE)
      update({ [INSTALLMENTS_URL_KEYS.contractSearch]: typed.trim() || null })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [typed, search, update])

  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchContractCards({ chip, search, sort, limit, today }, signal),
    [chip, search, sort, limit, today],
  )
  const load = useLoad(loader, version)
  const figuresLoader = useCallback(
    (signal: AbortSignal) => fetchContractFigures(signal),
    [],
  )
  const figures = useLoad(figuresLoader, version)
  const summary = useMemo(
    () => (figures.data ? summarizeContracts(figures.data.rows, today) : null),
    [figures.data, today],
  )
  const counts = useMemo(
    () => (figures.data ? contractChipCounts(figures.data.rows, today) : null),
    [figures.data, today],
  )

  if (totalContracts === 0)
    return (
      <EmptyState
        icon={<FileText size={28} aria-hidden="true" />}
        title={t('instNoContractsYet')}
        action={
          canManage ? (
            <Button
              variant="primary"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={onNewContract}
            >
              {t('instContractNew')}
            </Button>
          ) : undefined
        }
      />
    )

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          tone="success"
          icon={<FileText size={20} />}
          title={t('instActiveContractsTitle')}
          value={summary ? summary.activeCount : '—'}
          foot={
            summary
              ? t('instFinanciersCount').replace(
                  '{count}',
                  String(summary.activeFinanciers),
                )
              : undefined
          }
        />
        <FigureCard
          tone="neutral"
          icon={<CheckCircle2 size={20} />}
          title={t('instPaid')}
          value={summary ? <Money value={summary.paid} /> : '—'}
          foot={
            summary
              ? t('instPaidOfFinancing').replace(
                  '{percent}',
                  String(summary.paidPercent),
                )
              : undefined
          }
        />
        <FigureCard
          tone="info"
          icon={<Clock size={20} />}
          title={t('instRemaining')}
          value={summary ? <Money value={summary.remaining} /> : '—'}
          foot={
            summary?.lastYear
              ? t('instUntilYear').replace('{year}', String(summary.lastYear))
              : undefined
          }
        />
        <FigureCard
          tone="warning"
          icon={<CalendarDays size={20} />}
          title={t('instEndingThisYear')}
          value={summary ? summary.endingThisYear : '—'}
          foot={t('instEndingThisYearHint').replace(
            '{date}',
            formatDate(`${today.slice(0, 4)}-12-31`),
          )}
        />
      </div>
      {figures.status === 'failed' && (
        <Notice tone="danger" size="compact">
          {t('instContractsLoadError')}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={chip}
          onValueChange={(next) => {
            setLimit(CONTRACT_CARDS_PAGE)
            update({
              [INSTALLMENTS_URL_KEYS.contractChip]:
                next === 'all' ? null : next,
            })
          }}
          className="max-w-full"
        >
          <TabsList variant="chips" aria-label={t('instContractsFilters')}>
            {CONTRACT_CHIPS.map((value) => {
              const tone = CHIP_TONE[value]
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className={cn(
                    'bg-bg text-fg hover:bg-surface-hover data-[state=active]:font-semibold',
                    CHIP_ACTIVE[tone],
                  )}
                >
                  {value === chip ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn('size-2 rounded-full', CHIP_DOT[tone])}
                    />
                  )}
                  {t(CHIP_LABEL[value])}
                  {counts && (
                    <span className="text-xs tabular-nums opacity-70">
                      {counts[value]}
                    </span>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchInput
            value={typed}
            onValueChange={setTyped}
            placeholder={t('instContractsSearch')}
            className="w-full sm:w-72"
          />
          <Select
            aria-label={t('instSortLabel')}
            value={sort}
            onValueChange={(next) => {
              setLimit(CONTRACT_CARDS_PAGE)
              update({
                [INSTALLMENTS_URL_KEYS.contractSort]:
                  next === 'next_due' ? null : next,
              })
            }}
            options={CONTRACT_SORTS.map((value) => ({
              value,
              label: `${t('instSortLabel')}: ${t(SORT_LABEL[value])}`,
            }))}
            className="w-full sm:w-52"
          />
        </div>
      </div>

      {load.status === 'failed' ? (
        <ErrorState
          description={t('instContractsLoadError')}
          onRetry={load.reload}
        />
      ) : !load.data ? (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
        >
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-72 w-full" />
          ))}
        </div>
      ) : load.data.rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} aria-hidden="true" />}
          title={t('instNoContractsHere')}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {load.data.rows.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                tone={financierTone(financiers, contract.financier_id)}
                due={
                  contract.status === 'active' && contract.next_due_date
                    ? {
                        date: contract.next_due_date,
                        amount: amountOf(contract.next_due_amount),
                        days: daysUntilDue(contract.next_due_date, today),
                      }
                    : null
                }
                canPay={canManage}
                onPay={() => onPay(contract)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {t('instShownOfContracts')
                .replace('{shown}', String(load.data.rows.length))
                .replace('{total}', String(load.data.total))}
            </p>
            {load.data.rows.length < load.data.total && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setLimit((current) => current + CONTRACT_CARDS_PAGE)
                }
              >
                {t('instShowMore')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
