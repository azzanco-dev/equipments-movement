import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  AppLink,
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  Notice,
  Skeleton,
  cn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { addMonths } from '@/lib/installments'
import { fetchDuesBetween } from '@/lib/installmentsData'
import {
  dueShownAmount,
  dayDueTotal,
  duesByDay,
  dueTone,
  monthDueSummary,
  monthGrid,
  shiftMonth,
  shortContractNumber,
  weekdayOf,
  WEEKDAYS_AR,
  WEEKDAYS_EN,
  type DueTone,
} from '@/lib/installmentsBoard'
import {
  installmentMonthLabel,
  monthKeyOf,
  payableRowLabel,
  type InstallmentDueRow,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { ProgressRing } from './boardParts'
import { Money, WhenBadge } from './cells'
import { useLoad } from './useLoad'

const CHIP: Record<DueTone, string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
}
const DOT: Record<DueTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
}
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
/** A day cell shows this many chips, then «+N». */
const CHIPS_PER_DAY = 3

/**
 * «التقويم» (owner 2026-11-21, Figma frame «الاقساط / الصفحة الموحدة:
 * التقويم», from design 2): the month as a grid, Sunday first, every
 * installment a chip on its day in its colour — late red, within 7 days
 * amber, later blue, paid green — with the arrows and «اليوم»; beside it the
 * chosen day's installments with «تسديد» and their total (the «بعده» list
 * went on the owner's word of 2026-11-22) and the month's ring (paid against what fell due). ONE bounded read per month of
 * `installment_dues` (active and paid-off contracts, paid or not).
 */
export function InstallmentsCalendarTab({
  version,
  canManage,
  onPay,
}: {
  version: number
  canManage: boolean
  onPay: (row: InstallmentDueRow) => void
}) {
  const { t, lang, dir } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const [month, setMonth] = useState(() => monthKeyOf(today))
  const [selected, setSelected] = useState(today)

  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchDuesBetween(`${month}-01`, addMonths(`${month}-01`, 1), signal),
    [month],
  )
  const load = useLoad(loader, version)
  const rows = useMemo(() => load.data?.rows ?? [], [load.data])
  const byDay = useMemo(() => duesByDay(rows), [rows])
  const weeks = useMemo(() => monthGrid(month), [month])
  const ring = useMemo(() => monthDueSummary(rows), [rows])
  const weekdays = lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN
  const dayRows = byDay.get(selected) ?? []
  // The day's total (owner 2026-11-22, «تحسب الاجمالي حق اليوم»): the
  // installments' own amounts, paid or not.
  const dayAmount = dayDueTotal(dayRows)

  const go = (months: number) => {
    const next = shiftMonth(month, months)
    setMonth(next)
    setSelected(next === monthKeyOf(today) ? today : `${next}-01`)
  }
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight
  const dayTitle = (day: string) =>
    `${weekdays[weekdayOf(day)]} ${Number(day.slice(8, 10))} ${installmentMonthLabel(day.slice(0, 7), lang, true)}`

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">
              {installmentMonthLabel(month, lang)}
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMonth(monthKeyOf(today))
                setSelected(today)
              }}
            >
              {t('instCalToday')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ul className="flex flex-wrap items-center gap-3 text-xs text-muted">
              {(
                [
                  ['danger', 'instOverdue'],
                  ['warning', 'instCalWithin7'],
                  ['info', 'instCalLater'],
                  ['success', 'instPaid'],
                ] as const
              ).map(([tone, key]) => (
                <li key={tone} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn('size-2.5 rounded-sm', DOT[tone])}
                  />
                  {t(key)}
                </li>
              ))}
            </ul>
            <span className="flex gap-1">
              <IconButton
                size="sm"
                variant="outline"
                label={t('instCalPrevMonth')}
                icon={<Prev size={16} aria-hidden="true" />}
                onClick={() => go(-1)}
              />
              <IconButton
                size="sm"
                variant="outline"
                label={t('instCalNextMonth')}
                icon={<Next size={16} aria-hidden="true" />}
                onClick={() => go(1)}
              />
            </span>
          </div>
        </div>

        {load.status === 'failed' ? (
          <ErrorState
            description={t('instCalLoadError')}
            onRetry={load.reload}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-7 text-center text-xs text-muted">
                {weekdays.map((name) => (
                  <div key={name} className="py-2">
                    {name}
                  </div>
                ))}
              </div>
              <div
                className="grid grid-cols-7 overflow-hidden rounded-lg border"
                aria-busy={!load.data}
              >
                {weeks.flat().map((day, index) => {
                  if (!day)
                    return (
                      <div
                        key={`blank-${index}`}
                        className="min-h-20 border-b border-e bg-surface"
                      />
                    )
                  const items = byDay.get(day) ?? []
                  const isToday = day === today
                  const isSelected = day === selected
                  const friday = weekdayOf(day) === 5
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelected(day)}
                      aria-pressed={isSelected}
                      aria-label={`${dayTitle(day)}${items.length ? ` · ${items.length}` : ''}`}
                      className={cn(
                        'flex min-h-20 flex-col items-stretch gap-1 border-b border-e p-1.5 text-start transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                        isSelected &&
                          'bg-warning-soft ring-2 ring-inset ring-[var(--warning)]',
                      )}
                    >
                      <span
                        className={cn(
                          'self-start text-sm tabular-nums',
                          friday && 'text-muted',
                          isToday &&
                            'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-contrast',
                        )}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                      {!load.data ? null : (
                        <>
                          {items.slice(0, CHIPS_PER_DAY).map((row) => {
                            const tone = dueTone(row)
                            return (
                              <span
                                key={row.id}
                                className={cn(
                                  'flex flex-wrap items-center justify-between gap-x-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums',
                                  CHIP[tone],
                                )}
                              >
                                <bdi dir="ltr" className="opacity-80">
                                  {shortContractNumber(row.contract_number)}
                                </bdi>
                                {row.kind !== 'installment' && (
                                  <span>{t('instFirstPayment')}</span>
                                )}
                                {/* Whole riyals, as the approved design:
                                    a cell is too narrow for the halalas. */}
                                <bdi dir="ltr" className="font-bold">
                                  {WHOLE.format(
                                    Math.round(dueShownAmount(row)),
                                  )}
                                </bdi>
                              </span>
                            )
                          })}
                          {items.length > CHIPS_PER_DAY && (
                            <span className="text-[11px] text-muted">
                              +{items.length - CHIPS_PER_DAY}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        {load.data?.partial && (
          <Notice tone="warning" size="compact">
            {t('instPartialFigures')}
          </Notice>
        )}
      </Card>

      <div className="min-w-0 space-y-3">
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-bold">{dayTitle(selected)}</h2>
            <p className="text-xs text-muted">
              {dayRows.length === 0
                ? t('instCalNoneThatDay')
                : t('instCalDueThatDay').replace(
                    '{count}',
                    String(dayRows.length),
                  )}
            </p>
          </div>
          {!load.data ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            dayRows.map((row) => (
              <DueCard
                key={row.id}
                row={row}
                canPay={canManage}
                onPay={() => onPay(row)}
              />
            ))
          )}
          {load.data && dayRows.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3">
              <span className="text-sm font-semibold">
                {t('instCalDayTotal')}
              </span>
              <Money value={dayAmount} className="text-base font-bold" />
            </div>
          )}
        </section>
        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t('instCalMonthOf').replace(
                '{month}',
                installmentMonthLabel(month, lang, true),
              )}
            </h3>
            <p className="text-xs text-muted">{t('instCalRingDesc')}</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <ProgressRing
              percent={ring.percent}
              size={96}
              stroke={10}
              label={
                <>
                  <bdi dir="ltr" className="text-lg font-bold tabular-nums">
                    {ring.percent}%
                  </bdi>
                  <span className="text-xs text-muted">{t('instPaid')}</span>
                </>
              }
            />
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm bg-success"
                />
                {t('instPaid')}
                <Money value={ring.paid} className="font-bold" />
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm bg-warning"
                />
                {t('instRemaining')}
                <Money value={ring.remaining} className="font-bold" />
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** One installment of the side panel: title, number and financier, the
 *  amount, when, and «تسديد» while unpaid. */
function DueCard({
  row,
  canPay,
  onPay,
}: {
  row: InstallmentDueRow
  canPay: boolean
  onPay: () => void
}) {
  const { t } = useI18n()
  const paid = row.state === 'paid'
  return (
    <div className="space-y-2 rounded-xl border bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <AppLink
            href={`/installments/${row.contract_id}`}
            className="block truncate-safe text-sm font-semibold hover:underline"
          >
            {row.description}
          </AppLink>
          <p className="text-xs text-muted">
            <bdi dir="ltr">{row.contract_number}</bdi> · {row.financier_name}
          </p>
          <p className="text-xs text-muted">
            {payableRowLabel(row, t, row.installment_count)}
          </p>
        </div>
        {paid ? (
          <Badge size="sm" tone="success">
            {t('instPaid')}
          </Badge>
        ) : (
          <WhenBadge days={row.days_until_due} />
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Money value={dueShownAmount(row)} className="text-base font-bold" />
        {canPay && !paid && (
          <Button
            size="sm"
            variant="primary"
            icon={<Check size={14} aria-hidden="true" />}
            onClick={onPay}
          >
            {t('instPayRow')}
          </Button>
        )}
      </div>
    </div>
  )
}
