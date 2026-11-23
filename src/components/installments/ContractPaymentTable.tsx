import { useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Pencil,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SectionHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  daysUntilDue,
  formatInstallmentAmount,
  fromHalalas,
  installmentState,
  toHalalas,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  type InstallmentFrequency,
} from '@/lib/installments'
import { vatInsideHalalas } from '@/lib/installmentPlan'
import {
  amountOf,
  firstPaymentsWords,
  installmentsWords,
  isSchedulePaid,
  nearInstallments,
  payableRowLabel,
  scheduleRemaining,
  sumAmounts,
  whenWords,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { contractPaidPercent } from '@/lib/installmentsBoard'
import { Money, WhenBadge } from './cells'

export type PaymentTableView = 'open' | 'paid' | 'all'

/** The fixed widths of the table's columns from md (one grid for the head
 *  and every row, so the columns line up). */
const GRID =
  'md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_7.5rem_8.5rem_8.5rem_7rem] md:items-center'

/**
 * «جدول السداد» of the contract page (owner 2026-11-23, model C approved in
 * Figma, «نموذج C»): ONE card in place of «الدفعات الاولى», «جدول الاقساط»
 * and «دفعة الضريبة». One table in three grey groups — the first payments,
 * the installments, the VAT when it is paid by itself — each row with its
 * day (and the day it was paid), its amount (and what is left of it), its
 * state, «تسديد» for that row and «...» (تسمية / تحديد التاريخ). The views
 * (غير المسدد / مسدد / الكل), the direction, the paid count and the totals
 * cover the whole contract; the installments show the near ones until
 * «عرض كل الاقساط». Below md every row is a small stacked card.
 */
export function ContractPaymentTable({
  contract,
  schedule,
  today,
  paidOn,
  canAct,
  canName,
  waitingRegular,
  onPay,
  onSetDate,
  onName,
  onSetFirstDue,
}: {
  contract: InstallmentContractRow
  schedule: readonly InstallmentScheduleItem[]
  today: string
  /** The latest day a row was paid (a posted payment on it). */
  paidOn: (row: InstallmentScheduleItem) => string | null
  /** installments.manage and an active contract: «تسديد», «تحديد التاريخ». */
  canAct: boolean
  /** installments.manage and a contract that is not cancelled: «تسمية». */
  canName: boolean
  /** The regular installment of a contract still waiting for its first due
   *  date (its preview), else null. */
  waitingRegular: number | null
  onPay: (row: InstallmentScheduleItem) => void
  onSetDate: (row: InstallmentScheduleItem) => void
  onName: (row: InstallmentScheduleItem) => void
  onSetFirstDue: () => void
}) {
  const { t, lang } = useI18n()
  const [chosenView, setChosenView] = useState<PaymentTableView | null>(null)
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [showAll, setShowAll] = useState(false)

  const cancelled = contract.status === 'cancelled'
  const active = contract.status === 'active'
  const view: PaymentTableView =
    chosenView ?? (contract.status === 'paid_off' ? 'all' : 'open')
  const bySeq = (a: InstallmentScheduleItem, b: InstallmentScheduleItem) =>
    a.seq - b.seq
  const firstPayments = schedule
    .filter((row) => row.kind === 'first_payment')
    .sort(bySeq)
  const installments = schedule
    .filter((row) => row.kind === 'installment')
    .sort(bySeq)
  const vatRow =
    contract.vat_mode === 'separate'
      ? (schedule.find((row) => row.kind === 'vat') ?? null)
      : null
  const waiting = active && !contract.first_due_date && installments.length === 0

  const inView = (row: InstallmentScheduleItem) =>
    view === 'all' ? true : view === 'paid' ? isSchedulePaid(row) : !isSchedulePaid(row)
  const ordered = (rows: InstallmentScheduleItem[]) =>
    direction === 'asc' ? rows : [...rows].reverse()

  const viewInstallments = installments.filter(inView)
  const nearRows = nearInstallments(
    viewInstallments.map((row) => ({ row, paid: isSchedulePaid(row) })),
  ).map((item) => item.row)
  const shownInstallments = showAll ? viewInstallments : nearRows
  const groups: {
    key: string
    title: string
    facts: ReactNode
    rows: InstallmentScheduleItem[]
    waiting?: boolean
  }[] = []
  const firstInView = firstPayments.filter(inView)
  if (firstInView.length)
    groups.push({
      key: 'first',
      title: t('instFirstPayments'),
      facts: (
        <>
          {firstPaymentsWords(firstPayments.length, lang)} ·{' '}
          <Money value={sumAmounts(firstPayments.map((row) => row.amount))} />
        </>
      ),
      rows: ordered(firstInView),
    })
  if (shownInstallments.length || (waiting && view !== 'paid'))
    groups.push({
      key: 'installments',
      title: t('instInstallments'),
      facts: (
        <>
          {installmentsWords(contract.installment_count, lang)}{' '}
          {t(
            INSTALLMENT_FREQUENCY_LABEL_KEYS[
              contract.frequency_months as InstallmentFrequency
            ] ?? 'instFrequencyMonthly',
          )}{' '}
          · <Money value={contract.installments_amount} />
        </>
      ),
      rows: ordered(shownInstallments),
      waiting,
    })
  if (vatRow && inView(vatRow))
    groups.push({
      key: 'vat',
      title: t('instGroupVat'),
      facts: <Money value={vatRow.amount} />,
      rows: [vatRow],
    })

  const allRows = [...firstPayments, ...installments, ...(vatRow ? [vatRow] : [])]
  const totalCount =
    allRows.length + (waiting ? contract.installment_count : 0)
  const paidCount = allRows.filter(isSchedulePaid).length
  const lateCount = active
    ? allRows.filter(
        (row) =>
          !isSchedulePaid(row) &&
          row.due_date !== null &&
          daysUntilDue(row.due_date, today) < 0,
      ).length
    : 0
  const hiddenInstallments = viewInstallments.length > nearRows.length
  const percent = contractPaidPercent(contract)

  return (
    <Card padded={false} className="flex min-w-0 flex-col">
      <div className="space-y-3 p-4 pb-0">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              {t('instPayTableTitle')}
              <Badge size="sm">{totalCount}</Badge>
            </span>
          }
          action={
            <div className="flex items-center gap-1.5">
              <Tabs
                value={view}
                onValueChange={(next) => {
                  setChosenView(next as PaymentTableView)
                  setShowAll(false)
                }}
              >
                <TabsList variant="segmented" aria-label={t('instPayTableTitle')}>
                  <TabsTrigger value="open">{t('instScheduleOpen')}</TabsTrigger>
                  <TabsTrigger value="paid">{t('instStatePaid')}</TabsTrigger>
                  <TabsTrigger value="all">{t('instScheduleAll')}</TabsTrigger>
                </TabsList>
              </Tabs>
              <IconButton
                size="sm"
                variant="outline"
                label={
                  direction === 'asc'
                    ? t('instSortDescending')
                    : t('instSortAscending')
                }
                icon={
                  direction === 'asc' ? (
                    <ArrowUp size={14} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={14} aria-hidden="true" />
                  )
                }
                onClick={() =>
                  setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
                }
              />
            </div>
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
            <span>
              {t('instPayTablePaidOf')
                .replace('{paid}', String(paidCount))
                .replace('{total}', String(totalCount))}
            </span>
            {lateCount > 0 && (
              <span className="text-danger">
                · {t('instPayTableLate').replace('{count}', String(lateCount))}
              </span>
            )}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-hover sm:w-40"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('instPaidOfContract')}
            >
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="flex items-center gap-1">
              <Money value={contract.paid_overall} className="font-medium text-fg" />
              {t('instPayTableOf')}
              <Money value={contract.payable_total} />
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 pt-3">
        {groups.length === 0 ? (
          <EmptyState
            title={
              view === 'open' ? t('instPayTableAllPaid') : t('instPayTableNonePaid')
            }
            className="p-6"
          />
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div
              className={cn(
                'hidden h-9 border-b bg-surface text-xs font-medium text-muted',
                GRID,
              )}
            >
              <span className="px-3">#</span>
              <span className="px-3">{t('instColPayment')}</span>
              <span className="px-3">{t('instDueDate')}</span>
              <span className="px-3">{t('instAmount')}</span>
              <span className="px-3">{t('instStatus')}</span>
              <span className="sr-only">{t('instColActions')}</span>
            </div>
            {groups.map((group) => (
              <section
                key={group.key}
                aria-label={group.title}
                className="border-t first-of-type:border-t-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 border-b bg-surface px-3 py-2 text-xs">
                  <span className="font-semibold">{group.title}</span>
                  <span className="text-muted">{group.facts}</span>
                </div>
                <ul>
                  {group.waiting && (
                    <WaitingRow
                      contract={contract}
                      regular={waitingRegular}
                      canAct={canAct}
                      onSetFirstDue={onSetFirstDue}
                    />
                  )}
                  {group.rows.map((row) => (
                    <PaymentRow
                      key={row.id}
                      contract={contract}
                      row={row}
                      today={today}
                      paidOn={paidOn(row)}
                      canAct={canAct}
                      canName={canName}
                      onPay={onPay}
                      onSetDate={onSetDate}
                      onName={onName}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {hiddenInstallments || showAll ? (
          <div className="mt-2 flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              icon={
                showAll ? (
                  <ChevronUp size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )
              }
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll
                ? t('instPayTableShowNear')
                : t('instPayTableShowAll').replace(
                    '{count}',
                    String(viewInstallments.length),
                  )}
            </Button>
          </div>
        ) : null}

        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-surface px-4 py-3">
          <div>
            <dt className="text-xs text-muted">{t('instContractTotal')}</dt>
            <dd className="text-sm font-semibold">
              <Money value={contract.payable_total} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('instPaid')}</dt>
            <dd className="text-sm font-semibold text-success">
              <Money value={contract.paid_overall} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('instRemaining')}</dt>
            <dd className="text-sm font-semibold">
              <Money value={cancelled ? 0 : contract.remaining_total} />
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}

/** What a row is made of, under its name: a first payment's rate or «مبلغ
 *  مقطوع», the VAT's base, an installment's name; the VAT part of a row
 *  when the VAT is inside every amount. */
function rowSub(
  contract: InstallmentContractRow,
  row: InstallmentScheduleItem,
  t: (key: TranslationKey) => string,
): string[] {
  const money = formatInstallmentAmount
  const halalas = toHalalas(amountOf(row.amount))
  const inside = vatInsideHalalas(halalas)
  const vatParts =
    contract.vat_mode === 'inside'
      ? [
          t('instBeforeVat').replace('{amount}', money(fromHalalas(halalas - inside))),
          t('instVatPart').replace('{amount}', money(fromHalalas(inside))),
        ]
      : []
  const beforeVat = sumAmounts([contract.total_amount, -amountOf(contract.vat_amount)])
  if (row.kind === 'first_payment') {
    const rated = row.rate !== null && row.rate !== undefined
    const kind = rated
      ? contract.vat_mode === 'separate'
        ? t('instRateOfBase')
            .replace('{rate}', String(amountOf(row.rate)))
            .replace('{amount}', money(beforeVat))
        : t('instFpRateOfContract').replace('{rate}', String(amountOf(row.rate)))
      : t('instFpKindAmount')
    return [[kind, ...vatParts].join(' · '), ...(row.note ? [row.note] : [])]
  }
  if (row.kind === 'vat') {
    const total = toHalalas(amountOf(contract.total_amount))
    const vat = toHalalas(amountOf(contract.vat_amount))
    const automatic = vat === vatInsideHalalas(total)
    return [
      t(automatic ? 'instVatRateOf' : 'instVatTypedOf').replace(
        '{amount}',
        money(fromHalalas(total - vat)),
      ),
      ...(row.note ? [row.note] : []),
    ]
  }
  return [
    ...(row.note?.trim() ? [row.note.trim()] : []),
    ...(vatParts.length ? [vatParts.join(' · ')] : []),
  ]
}

function PaymentRow({
  contract,
  row,
  today,
  paidOn,
  canAct,
  canName,
  onPay,
  onSetDate,
  onName,
}: {
  contract: InstallmentContractRow
  row: InstallmentScheduleItem
  today: string
  paidOn: string | null
  canAct: boolean
  canName: boolean
  onPay: (row: InstallmentScheduleItem) => void
  onSetDate: (row: InstallmentScheduleItem) => void
  onName: (row: InstallmentScheduleItem) => void
}) {
  const { t, lang } = useI18n()
  const running = contract.status !== 'cancelled'
  const paid = isSchedulePaid(row)
  const partial = amountOf(row.paid_amount) > 0 && !paid
  const date = row.due_date
  const days = date ? daysUntilDue(date, today) : null
  const late = running && !paid && days !== null && days < 0
  const state = date
    ? installmentState(date, amountOf(row.amount), amountOf(row.paid_amount), today)
    : null
  const withLast =
    row.kind === 'vat' && contract.vat_due === 'last' && (days === null || days >= 0)
  const title =
    row.kind === 'installment'
      ? t('instInstallmentN').replace('{seq}', String(row.seq))
      : payableRowLabel(row, t)
  const sub = rowSub(contract, row, t)

  let badge: ReactNode = null
  if (running) {
    if (paid)
      badge = (
        <Badge size="sm" tone="success">
          {t('instStatePaid')}
        </Badge>
      )
    else if (withLast)
      badge = (
        <Badge size="sm" tone="info">
          {t('instWithLast')}
        </Badge>
      )
    else if (days === null)
      badge = (
        <Badge size="sm" tone="warning">
          {t('instFpWaitsDate')}
        </Badge>
      )
    else if (days <= 0) badge = <WhenBadge days={days} />
    else if (state === 'due_soon')
      badge = (
        <Badge size="sm" tone="warning">
          {whenWords(days, lang)}
        </Badge>
      )
    else
      badge = (
        <Badge size="sm" tone="neutral">
          {t('instStateUpcoming')}
        </Badge>
      )
  }

  const canSetDate = canAct && !paid && row.kind !== 'installment' && !date
  const canRename = canName && row.kind === 'installment'
  const menu = canSetDate || canRename

  return (
    <li
      className={cn(
        'border-b last:border-b-0',
        GRID,
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-3 py-3 md:gap-0 md:px-0 md:py-2',
        late && 'bg-danger-soft',
      )}
    >
      <span className="hidden px-3 text-sm tabular-nums text-muted md:block">
        {row.kind === 'vat' ? '—' : row.seq}
      </span>
      <div className="min-w-0 md:px-3">
        <p
          className={cn(
            'flex flex-wrap items-center gap-1.5 break-words text-sm font-medium',
            paid && 'text-muted',
          )}
        >
          {title}
          {row.is_balloon && (
            <Badge size="sm" tone="info">
              {t('instBalloonBadge')}
            </Badge>
          )}
        </p>
        {sub.map((line) => (
          <p key={line} className="break-words text-xs text-muted">
            {line}
          </p>
        ))}
      </div>
      {/* Phone: the state beside the name. */}
      <div className="justify-self-end md:hidden">{badge}</div>
      <div className="md:px-3">
        <p className={cn('text-sm', paid ? 'text-muted' : 'text-fg')}>
          {date ? <bdi dir="ltr">{formatDate(date)}</bdi> : '—'}
        </p>
        {paid && paidOn && (
          <p className="text-xs text-muted">
            {t('instPaidOnShort').replace('{date}', formatDate(paidOn))}
          </p>
        )}
      </div>
      <div className="justify-self-end text-end md:justify-self-auto md:px-3 md:text-start">
        <p className={cn('text-sm font-medium', paid && 'text-muted')}>
          <Money value={row.amount} />
        </p>
        {partial && (
          <p className={cn('text-xs', late ? 'text-danger' : 'text-muted')}>
            {t('instRemaining')} <Money value={scheduleRemaining(row)} />
          </p>
        )}
      </div>
      <div className="hidden flex-wrap items-center gap-1 px-3 md:flex">
        {badge}
        {partial && running && (
          <Badge size="sm" tone="info">
            {t('instPartlyPaid')}
          </Badge>
        )}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1 md:px-3">
        {canAct && !paid && (
          <Button
            size="sm"
            variant={late ? 'primary' : 'outline'}
            onClick={() => onPay(row)}
          >
            {t('instPayRow')}
          </Button>
        )}
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                label={t('instRowOptions').replace('{name}', title)}
                icon={<MoreHorizontal size={16} aria-hidden="true" />}
                className="text-muted"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {canRename && (
                <DropdownMenuItem
                  icon={<Pencil size={14} />}
                  onSelect={() => onName(row)}
                >
                  {t('instRowNameAction')}
                </DropdownMenuItem>
              )}
              {canSetDate && (
                <DropdownMenuItem
                  icon={<CalendarDays size={14} />}
                  onSelect={() => onSetDate(row)}
                >
                  {t('instSetDate')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}

/** The installments of a contract still waiting for its first due date:
 *  one row with what they will be and «تحديد تاريخ اول قسط». */
function WaitingRow({
  contract,
  regular,
  canAct,
  onSetFirstDue,
}: {
  contract: InstallmentContractRow
  regular: number | null
  canAct: boolean
  onSetFirstDue: () => void
}) {
  const { t, lang } = useI18n()
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarDays size={14} aria-hidden="true" className="text-muted" />
          {t('instNotDividedTitle')}
        </p>
        <p className="text-xs text-muted">
          {[
            installmentsWords(contract.installment_count, lang),
            ...(regular !== null
              ? [
                  t('instEachAmount').replace(
                    '{amount}',
                    formatInstallmentAmount(regular),
                  ),
                ]
              : []),
          ].join(' · ')}
        </p>
      </div>
      {canAct && (
        <Button
          size="sm"
          variant="primary"
          icon={<CalendarDays size={14} aria-hidden="true" />}
          onClick={onSetFirstDue}
        >
          {t('instSetFirstDue')}
        </Button>
      )}
    </li>
  )
}
