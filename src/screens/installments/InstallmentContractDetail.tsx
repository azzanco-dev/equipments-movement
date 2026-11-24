import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Lock,
  MoreHorizontal,
  Percent,
  Pencil,
  Printer,
  Repeat,
  Landmark,
  Package,
  StickyNote,
  Trash2,
  Truck,
  User,
  Wallet,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { ContractFilesCard } from '@/components/installments/InstallmentContractFiles'
import {
  SetFirstDueDateDialog,
  SetInstallmentNameDialog,
  SetPaymentDateDialog,
} from '@/components/installments/InstallmentDateDialogs'
import { ContractPaymentTable } from '@/components/installments/ContractPaymentTable'
import { InstallmentPrintSheet } from '@/components/installments/InstallmentPrintSheet'
import { installmentToPay } from '@/lib/installmentPrint'
import { InstallmentPaymentDialog } from '@/components/installments/InstallmentPaymentDialog'
import { BankAccountLine } from '@/components/installments/BankAccountFields'
import { PaymentReceiptLine } from '@/components/installments/InstallmentReceipt'
import { receiptOf } from '@/lib/installmentReceipts'
import {
  CancelInstallmentContractDialog,
  VoidInstallmentPaymentDialog,
} from '@/components/installments/InstallmentReasonDialogs'
import {
  InstallmentContractStatusBadge,
  InstallmentStateBadge,
  Money,
  OverdueBadge,
  PaidProgress,
  PeriodRange,
  UnitTags,
} from '@/components/installments/cells'
import {
  setInstallmentFlash,
  takeInstallmentFlash,
} from '@/components/installments/flash'
import { useLoad } from '@/components/installments/useLoad'
import { useTabTitle } from '@/components/TabTitle'
import {
  AppLink,
  Badge,
  Button,
  Card,
  DescriptionList,
  DetailHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Notice,
  PageTrailBar,
  SectionHeader,
  Skeleton,
  StatCard,
  ToastProvider,
  cn,
  useConfirm,
  useToast,
  type DescriptionListItem,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  installmentState,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  installmentErrorMessage,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  type InstallmentFrequency,
} from '@/lib/installments'
import { removeInstallmentReceiptFiles } from '@/lib/installmentReceiptsData'
import {
  deleteInstallmentContract,
  fetchContractFiles,
  fetchInstallmentContract,
} from '@/lib/installmentsData'
import {
  allocationOthersByPayment,
  allocationSeqsByPayment,
  amountOf,
  contractHistory,
  coveredSeqsLabel,
  duesWords,
  firstPaymentsWords,
  installmentsWords,
  isAwaitingFirstDue,
  isSchedulePaid,
  payableRowLabel,
  scheduleRemaining,
  sumAmounts,
  INSTALLMENT_HISTORY_LABEL_KEYS,
  installmentAccountOf,
  type InstallmentPaymentRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { contractPaidPercent } from '@/lib/installmentsBoard'
import {
  formatItemQuantity,
  planDivision,
  INSTALLMENT_VAT_LABEL_KEYS,
} from '@/lib/installmentPlan'
import { removeInstallmentFileObjects } from '@/lib/installmentFilesData'

/** The dialogs the contract page opens. */
export type InstallmentContractDialogKind =
  | { kind: 'cancel' }
  | { kind: 'first_due' }
  | { kind: 'payment_date'; row: InstallmentScheduleItem }
  /** `targetId`: the row paid first (a first payment, the VAT row). */
  | { kind: 'pay'; amount?: number; targetId?: string }
  | { kind: 'void'; payment: InstallmentPaymentRow }
  /** 0210: «تسمية القسط». */
  | { kind: 'row_name'; row: InstallmentScheduleItem }

export const PAYMENTS_PREVIEW_ROWS = 10
export const EVENTS_PREVIEW_ROWS = 20

export interface InstallmentContractDetailProps {
  contractId: string
  onBack: () => void
  /** After «حذف العقد» (0207): opens the contracts list. */
  onDeleted: () => void
}

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-7 w-40" />
      <div className="card space-y-4 p-4">
        <Skeleton className="h-7 w-36" />
        <Skeleton variant="text" className="w-56" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      </div>
      <div className="card space-y-3 p-4">
        <Skeleton variant="text" className="w-28" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * The contract page (/installments/:id, migration 0203; the /ui-kit mockup
 * the owner approved on 2026-11-18) in the approved detail-page pattern: a
 * header card (the number with its status, the TITLE on its own line, the
 * financier, the actions) over four figures and the paid progress bar; the
 * schedule as wide cards and the payments as cards beside the facts and
 * «سجل العقد» — since 0209 with the first payments, the VAT row and the
 * files, and a division that waits for the first due date — — a history DERIVED from the contract and its payments
 * (`contractHistory`; 0203 keeps no event table).
 *
 * Reads go through RLS (`installments.view`). «تسجيل سداد», «الغاء السداد»
 * and «خيارات» → تعديل العقد / الغاء العقد show for `installments.manage`
 * only; every write is a database function, which checks the key again.
 */
export function InstallmentContractDetail(
  props: InstallmentContractDetailProps,
) {
  // The dialogs' successes show their Toasts through this provider; no
  // shell provides one.
  return (
    <ToastProvider>
      <InstallmentContractDetailInner {...props} />
    </ToastProvider>
  )
}

function InstallmentContractDetailInner({
  contractId,
  onBack,
  onDeleted,
}: InstallmentContractDetailProps) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { can } = usePermissions()
  // Fails closed: `can` answers false until the permissions are ready.
  const canManage = can('installments.manage')
  const today = useMemo(() => saudiDateKey(), [])
  const [version, setVersion] = useState(0)
  const loader = useCallback(
    (signal: AbortSignal) => fetchInstallmentContract(contractId, signal),
    [contractId],
  )
  const load = useLoad(loader, version)
  const data = load.data
  useTabTitle(data?.contract.contract_number)

  const [dialog, setDialog] = useState<InstallmentContractDialogKind | null>(
    null,
  )
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** «تصدير القسط»: the print sheet is mounted while the dialog is up. */
  const [printing, setPrinting] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  // The message of the list page that opened this one (a new contract).
  useEffect(() => {
    const flash = takeInstallmentFlash()
    if (flash) toast({ title: t(flash.message), tone: flash.tone })
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A dialog that can no longer render (the permission went) is not left
  // named in the state.
  useEffect(() => {
    if (dialog && !canManage) setDialog(null)
  }, [dialog, canManage])

  const history = useMemo(
    () =>
      data ? contractHistory(data.contract, data.payments, data.files) : [],
    [data],
  )
  const coveredBy = useMemo(
    () => allocationSeqsByPayment(data?.allocations ?? []),
    [data],
  )
  const othersBy = useMemo(
    () => allocationOthersByPayment(data?.allocations ?? []),
    [data],
  )

  if (load.status === 'failed')
    return (
      <div className="space-y-4">
        <PageTrailBar onBack={onBack} fallbackLabel={t('installments')} />
        <ErrorState
          description={t('instContractLoadError')}
          onRetry={load.reload}
        />
      </div>
    )
  if (!data)
    return load.status === 'loading' ? (
      <PageSkeleton label={t('loading')} />
    ) : (
      <div className="space-y-4">
        <PageTrailBar onBack={onBack} fallbackLabel={t('installments')} />
        <EmptyState
          icon={<FileText size={28} aria-hidden="true" />}
          title={t('instContractNotFound')}
        />
      </div>
    )

  const { contract, schedule, payments, units, files, items } = data
  const active = contract.status === 'active'
  const cancelled = contract.status === 'cancelled'
  // A posted payment locks the cancellation; the terms are locked by money
  // on an installment (`installments_locked`, 0209).
  const locked = payments.some((payment) => payment.status === 'posted')
  const awaiting = isAwaitingFirstDue(contract)
  const paid = amountOf(contract.paid_overall)
  const remaining = amountOf(contract.remaining_total)
  // The view counts the late rows of a closed contract too: only a running
  // contract is late.
  const overdueCount = active ? contract.overdue_count : 0
  const overdueAmount = active ? amountOf(contract.overdue_amount) : 0
  const percent = contractPaidPercent(contract)
  const next = active
    ? schedule.find((row) => row.id === contract.next_due_id)
    : null
  const firstPayments = schedule
    .filter((row) => row.kind === 'first_payment')
    .sort((a, b) => a.seq - b.seq)
  const installments = schedule.filter((row) => row.kind === 'installment')
  const vatRow = schedule.find((row) => row.kind === 'vat') ?? null
  const vatSeparate = contract.vat_mode === 'separate'
  const contractVat = amountOf(contract.vat_amount)
  // The latest posted payment on a row: the day a row paid without one shows.
  const paidOnOf = (target: InstallmentScheduleItem) =>
    payments.reduce<string | null>(
      (latest, payment) =>
        payment.status === 'posted' &&
        (othersBy.get(payment.id) ?? []).some(
          (row) => row.kind === target.kind && row.seq === target.seq,
        ) &&
        (!latest || payment.paid_on > latest)
          ? payment.paid_on
          : latest,
      null,
    )
  const division = awaiting
    ? planDivision(
        contract,
        null,
        contract.installment_count,
        contract.frequency_months,
      ).plan
    : null
  const settledPayments = firstPayments.filter(isSchedulePaid)
  const unpaidPayments = firstPayments.filter((row) => !isSchedulePaid(row))
  // «الدفعة الثانية والاقساط والضريبة»: what the remaining is made of, for
  // a contract with more than installments.
  const openParts = [
    ...(unpaidPayments.length === 1
      ? [payableRowLabel(unpaidPayments[0], t)]
      : unpaidPayments.length > 1
        ? [t('instPartPayments')]
        : []),
    ...(awaiting || installments.some((row) => !isSchedulePaid(row))
      ? [t('instPartInstallments')]
      : []),
    ...(vatSeparate && vatRow && !isSchedulePaid(vatRow)
      ? [t('instPartVat')]
      : []),
  ]
  const remainingParts =
    active && (firstPayments.length > 0 || vatSeparate)
      ? openParts.join(t('instListAnd'))
      : ''
  const shownPayments = showAllPayments
    ? payments
    : payments.slice(0, PAYMENTS_PREVIEW_ROWS)
  /** What a payment covered: «الدفعة الاولى، القسط 5». */
  const coverageOf = (paymentId: string) => {
    const names = (othersBy.get(paymentId) ?? []).map((row) =>
      payableRowLabel(row, t),
    )
    const seqs = coveredBy.get(paymentId) ?? []
    if (seqs.length === 1) names.push(payableRowLabel({ seq: seqs[0] }, t))
    else if (seqs.length > 1)
      names.push(`${t('instInstallments')} ${coveredSeqsLabel(seqs, lang)}`)
    return names.join(t('instListComma'))
  }

  const open = (kind: InstallmentContractDialogKind) => setDialog(kind)
  const payRow = (row: InstallmentScheduleItem) =>
    open({ kind: 'pay', amount: scheduleRemaining(row), targetId: row.id })
  const closeDialog = (isOpen: boolean) => {
    if (!isOpen) setDialog(null)
  }
  const refresh = () => setVersion((current) => current + 1)
  /** A dialog succeeded: close it, read again, say so. */
  // A payment whose receipt could not be attached is still saved: say so,
  // and that the receipt can be attached from its card.
  const paymentSaved = ({
    receiptError,
  }: {
    receiptError: TranslationKey | null
  }) => {
    if (!receiptError) {
      done('instToastPaymentRecorded')
      return
    }
    setDialog(null)
    refresh()
    toast({
      title: t('instToastPaymentRecordedNoReceipt'),
      description: `${t(receiptError)} ${t('instReceiptAttachLater')}`,
      tone: 'warning',
    })
  }
  /** «حذف العقد» (0207): a cancelled contract only, confirmed first; the
   *  database deletes it after its copy to the archive, then its receipt
   *  files go and the list opens with the message. */
  const deleteContract = async () => {
    const confirmed = await confirm({
      title: t('instDeleteContractTitle').replace(
        '{number}',
        contract.contract_number,
      ),
      description: t('instDeleteContractDesc'),
      confirmLabel: t('instDeleteContractConfirm'),
      tone: 'danger',
    })
    if (!confirmed) return
    setDeleting(true)
    // The function returns the receipts' paths only: the files' paths are
    // read before their rows go.
    let filePaths = files.map((file) => file.storage_path)
    try {
      filePaths = (await fetchContractFiles(contract.id)).map(
        (file) => file.storage_path,
      )
    } catch {
      // The paths this page loaded stand.
    }
    const result = await deleteInstallmentContract(contract.id)
    if (result.error) {
      setDeleting(false)
      toast({ title: t(installmentErrorMessage(result.error)), tone: 'danger' })
      refresh()
      return
    }
    const [receiptsGone, contractFilesGone] = await Promise.all([
      removeInstallmentReceiptFiles(result.data),
      removeInstallmentFileObjects(filePaths),
    ])
    const filesGone = receiptsGone && contractFilesGone
    setInstallmentFlash(
      filesGone ? 'instContractDeleted' : 'instDeleteReceiptsLeft',
      filesGone ? 'success' : 'warning',
    )
    onDeleted()
  }

  const done = (message: TranslationKey) => {
    setDialog(null)
    refresh()
    toast({ title: t(message), tone: 'success' })
  }

  const none = <span className="text-muted">{t('instNone')}</span>
  const facts: DescriptionListItem[] = [
    {
      key: 'financier',
      icon: <Building2 size={16} />,
      label: t('instFinancier'),
      value: contract.financier_name,
    },
    {
      // 0208: the contract's own account, else the financier's.
      key: 'account',
      icon: <Landmark size={16} />,
      label: t('instAccountTitle'),
      value: <BankAccountLine account={installmentAccountOf(contract)} />,
    },
    {
      key: 'total',
      icon: <Banknote size={16} />,
      label: t('instContractTotal'),
      value: <Money value={contract.total_amount} />,
    },
    ...(amountOf(contract.down_payment) > 0
      ? [
          {
            key: 'down',
            icon: <Wallet size={16} />,
            label: t('instDownPayment'),
            value: <Money value={contract.down_payment} />,
          },
        ]
      : []),
    ...(contractVat > 0
      ? [
          {
            key: 'before_vat',
            icon: <FileText size={16} />,
            label: t('instBeforeVatLabel'),
            value: (
              <Money
                value={sumAmounts([contract.total_amount, -contractVat])}
              />
            ),
          },
        ]
      : []),
    {
      key: 'vat',
      icon: <Percent size={16} />,
      label: t('instVatLabel'),
      value: (
        <span className="flex flex-wrap items-baseline gap-x-2">
          {t(INSTALLMENT_VAT_LABEL_KEYS[contract.vat_mode])}
          {contractVat > 0 && (
            <Money value={contractVat} className="text-muted" />
          )}
        </span>
      ),
    },
    {
      key: 'first_payments',
      icon: <CheckCircle2 size={16} />,
      label: t('instFirstPayments'),
      value:
        firstPayments.length > 0 ? (
          <span>
            {t('instFpTotalOf').replace(
              '{payments}',
              firstPaymentsWords(firstPayments.length, lang),
            )}{' '}
            <Money value={contract.first_payments_total} />
          </span>
        ) : (
          <span className="text-muted">{t('instFpNone')}</span>
        ),
    },
    ...(amountOf(contract.balloon_amount) > 0
      ? [
          {
            key: 'balloon',
            icon: <Coins size={16} />,
            label: t('instBalloon'),
            value: <Money value={contract.balloon_amount} />,
          },
        ]
      : []),
    {
      key: 'plan',
      icon: <Repeat size={16} />,
      label: t('instInstallments'),
      value: `${installmentsWords(contract.installment_count, lang)} · ${t(
        INSTALLMENT_FREQUENCY_LABEL_KEYS[
          contract.frequency_months as InstallmentFrequency
        ] ?? 'instFrequencyMonthly',
      )}`,
    },
    {
      key: 'period',
      icon: <CalendarClock size={16} />,
      label: t('instTerm'),
      value: contract.first_due_date ? (
        <PeriodRange
          from={contract.first_due_date}
          // The installments' own last day, never the VAT's.
          to={installments[installments.length - 1]?.due_date ?? null}
        />
      ) : (
        <span className="text-warning">{t('instAwaitingFirstDue')}</span>
      ),
    },
    {
      key: 'units',
      icon: <Truck size={16} />,
      label: t('instLinkedUnits'),
      value: (
        <UnitTags
          units={units}
          count={contract.equipment_count}
          max={Math.max(units.length, 1)}
        />
      ),
    },
    {
      key: 'items',
      icon: <Package size={16} />,
      label: t('instItemsTitle'),
      value: items.length ? (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline gap-1.5">
              <span className="min-w-0 break-words">{item.name}</span>
              <bdi dir="ltr" className="shrink-0 text-muted">
                × {formatItemQuantity(item.quantity)}
              </bdi>
            </li>
          ))}
        </ul>
      ) : (
        none
      ),
    },
    {
      key: 'notes',
      icon: <StickyNote size={16} />,
      label: t('notes'),
      value: contract.notes ? (
        <span className="whitespace-pre-wrap break-words">
          {contract.notes}
        </span>
      ) : (
        none
      ),
    },
    {
      key: 'by',
      icon: <User size={16} />,
      label: t('instCreatedBy'),
      value: contract.created_by_name ?? '—',
    },
    {
      key: 'at',
      icon: <Clock size={16} />,
      label: t('instCreatedOn'),
      value: formatDate(saudiDateKey(contract.created_at)),
      dir: 'ltr',
    },
    ...(contract.closed_at
      ? [
          {
            key: 'closed',
            icon: <Lock size={16} />,
            label: cancelled ? t('instCancelledOn') : t('instPaidOffOn'),
            value: formatDate(saudiDateKey(contract.closed_at)),
            dir: 'ltr' as const,
          },
        ]
      : []),
  ]

  const payButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<Wallet size={14} aria-hidden="true" />}
      onClick={() => open({ kind: 'pay' })}
    >
      {t('instPayTitle')}
    </Button>
  )

  // Editing stays for a paid-off contract (title, financier, units, notes);
  // cancelling is for an active contract without a posted payment.
  const optionsMenu = (className?: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={className}
          icon={<MoreHorizontal size={14} aria-hidden="true" />}
        >
          {t('options')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {!cancelled && (
          <DropdownMenuItem asChild>
            <AppLink href={`/installments/${contract.id}/edit`}>
              <Pencil size={14} aria-hidden="true" />
              {t('instContractEdit')}
            </AppLink>
          </DropdownMenuItem>
        )}
        {active && !awaiting && !contract.installments_locked && (
          <DropdownMenuItem
            icon={<CalendarDays size={14} />}
            onSelect={() => open({ kind: 'first_due' })}
          >
            {t('instChangeFirstDue')}
          </DropdownMenuItem>
        )}
        {cancelled && (
          <DropdownMenuItem
            icon={<Trash2 size={14} />}
            tone="danger"
            disabled={deleting}
            onSelect={() => void deleteContract()}
          >
            {t('instDeleteContract')}
          </DropdownMenuItem>
        )}
        {active && (
          <DropdownMenuItem
            icon={<Ban size={14} />}
            tone="danger"
            disabled={locked}
            onSelect={() => open({ kind: 'cancel' })}
          >
            {locked ? t('instCancelLocked') : t('instCancelTitle')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  // A cancelled contract takes one action: «حذف العقد» (owner 2026-11-21,
  // «حذف عقد اقساط بس بعد الالغاء»).
  const showActions = canManage
  // «تصدير القسط» (owner 2026-11-24): every reader, while the contract has a
  // row to pay.
  const askedRow = installmentToPay(contract, schedule)
  const exportButton = askedRow ? (
    <Button
      size="sm"
      variant="outline"
      icon={<Printer size={14} aria-hidden="true" />}
      disabled={printing}
      onClick={() => setPrinting(true)}
    >
      {t('instPrintExport')}
    </Button>
  ) : null

  return (
    <div className="space-y-3">
      <PageTrailBar onBack={onBack} fallbackLabel={t('installments')} />

      {/* 1. Header card: the number with its status, the title on its own
          line, the financier, the actions, then the summary strip. */}
      <div className="card space-y-3 p-3">
        <DetailHeader
          as="h1"
          identifier={contract.contract_number}
          identifierLtr
          subtitle={
            <>
              <span className="block whitespace-normal break-words text-base font-semibold text-fg">
                {contract.description}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <Building2 size={14} aria-hidden="true" />
                {contract.financier_name}
              </span>
            </>
          }
          badges={
            <span className="flex flex-wrap items-center gap-1">
              <InstallmentContractStatusBadge status={contract.status} />
              {awaiting && (
                <Badge tone="warning">{t('instAwaitingFirstDue')}</Badge>
              )}
              <OverdueBadge count={overdueCount} />
            </span>
          }
          actions={
            showActions || exportButton ? (
              <div className="hidden gap-2 sm:flex">
                {exportButton}
                {showActions && active && payButton}
                {showActions && optionsMenu()}
              </div>
            ) : undefined
          }
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            size="sm"
            label={t('instContractTotal')}
            value={<Money value={contract.payable_total} />}
            hint={
              amountOf(contract.vat_amount) > 0 ? t('instWithVat') : undefined
            }
            icon={<Banknote size={16} />}
          />
          <StatCard
            size="sm"
            label={t('instPaid')}
            value={<Money value={paid} />}
            hint={t('instPercentOfContract').replace(
              '{percent}',
              String(percent),
            )}
            icon={<CheckCircle2 size={16} />}
            accent="success"
          />
          <StatCard
            size="sm"
            label={t('instRemaining')}
            value={<Money value={cancelled ? 0 : remaining} />}
            hint={
              overdueAmount > 0 ? (
                <span className="text-danger">
                  {t('instOfWhichOverdue')} <Money value={overdueAmount} />
                </span>
              ) : (
                remainingParts || undefined
              )
            }
            icon={<Coins size={16} />}
          />
          <StatCard
            size="sm"
            label={t('instNextDue')}
            value={next ? <Money value={scheduleRemaining(next)} /> : '—'}
            hint={
              next?.due_date ? (
                <span className="flex flex-wrap items-center gap-1">
                  {next.kind !== 'installment' && (
                    <span>{payableRowLabel(next, t)} ·</span>
                  )}
                  <bdi dir="ltr">{formatDate(next.due_date)}</bdi>
                  <InstallmentStateBadge
                    state={installmentState(
                      next.due_date,
                      amountOf(next.amount),
                      amountOf(next.paid_amount),
                      today,
                    )}
                  />
                </span>
              ) : awaiting ? (
                t('instAwaitingShort')
              ) : undefined
            }
            icon={<CalendarClock size={16} />}
          />
        </div>
        <PaidProgress percent={percent} />
      </div>

      {awaiting && (
        <Notice
          tone="warning"
          size="compact"
          icon={<Clock size={16} />}
          action={
            canManage ? (
              <Button
                size="sm"
                variant="outline"
                icon={<CalendarDays size={14} aria-hidden="true" />}
                onClick={() => open({ kind: 'first_due' })}
              >
                {t('instSetFirstDue')}
              </Button>
            ) : undefined
          }
        >
          {settledPayments.length === 1
            ? t('instAwaitingNoticePaid').replace('{title}', () =>
                payableRowLabel(settledPayments[0], t),
              )
            : t('instAwaitingNotice')}
        </Notice>
      )}
      {contract.status === 'paid_off' && (
        <Notice tone="success" size="compact" icon={<CheckCircle2 size={16} />}>
          {contract.closed_at ? (
            <>
              {t('instPaidOffNoticeOn')}{' '}
              <bdi dir="ltr">
                {formatDate(saudiDateKey(contract.closed_at))}
              </bdi>
              .
            </>
          ) : (
            t('instPaidOffNotice')
          )}
        </Notice>
      )}
      {cancelled && (
        <Notice
          tone="neutral"
          size="compact"
          icon={<Ban size={16} />}
          title={t('instCancelledNotice')}
        >
          {contract.cancel_reason}
        </Notice>
      )}
      {overdueCount > 0 && (
        <Notice
          tone="danger"
          size="compact"
          icon={<AlertTriangle size={16} />}
          action={
            canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => open({ kind: 'pay', amount: overdueAmount })}
              >
                {t('instPayOverdue')}
              </Button>
            ) : undefined
          }
        >
          {t('instOverdueOnContract').replace(
            '{installments}',
            firstPayments.length > 0 || vatSeparate
              ? duesWords(overdueCount, lang)
              : installmentsWords(overdueCount, lang),
          )}{' '}
          <Money value={overdueAmount} className="font-semibold" />
        </Notice>
      )}

      {/* 2. Body: the facts above the records below xl; from xl the records
          span two columns beside the facts and the history. */}
      <div className="grid gap-3 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-3 xl:col-start-3 xl:row-start-1">
          <ContractFilesCard
            contractId={contract.id}
            files={files}
            canManage={canManage && !cancelled}
            onChanged={refresh}
          />
          <Card className="space-y-1 p-3">
            <SectionHeader title={t('instFactsTitle')} />
            <DescriptionList items={facts} dense className="-my-1" />
          </Card>
        </div>

        <div className="min-w-0 space-y-3 xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          {/* «جدول السداد» (owner 2026-11-23, model C): the first payments,
              the installments and the VAT in one table. */}
          <ContractPaymentTable
            contract={contract}
            schedule={schedule}
            today={today}
            paidOn={paidOnOf}
            canAct={canManage && active}
            canName={canManage && !cancelled}
            waitingRegular={division ? division.regular : null}
            onPay={payRow}
            onSetDate={(row) => open({ kind: 'payment_date', row })}
            onName={(row) => open({ kind: 'row_name', row })}
            onSetFirstDue={() => open({ kind: 'first_due' })}
          />

          {/* Payments: the latest ten, voided ones kept and struck out. */}
          <Card padded={false}>
            <div className="p-3 pb-0">
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    {t('instPaymentsTitle')}
                    <Badge size="sm">{payments.length}</Badge>
                  </span>
                }
                description={t('instPaymentsDesc')}
                action={canManage && active ? payButton : undefined}
              />
            </div>
            {payments.length === 0 ? (
              <div className="p-3">
                <EmptyState title={t('instNoPayments')} className="p-6" />
              </div>
            ) : (
              <ul className="space-y-1.5 p-3 pt-2">
                {shownPayments.map((payment) => (
                  <PaymentCard
                    key={payment.id}
                    payment={payment}
                    coverage={coverageOf(payment.id)}
                    canVoid={canManage && !cancelled}
                    canManageReceipt={canManage}
                    onVoid={() => open({ kind: 'void', payment })}
                    onReceiptChanged={refresh}
                  />
                ))}
                {payments.length > PAYMENTS_PREVIEW_ROWS && (
                  <li className="flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllPayments((current) => !current)}
                    >
                      {showAllPayments
                        ? t('instShowLess')
                        : t('instAllPayments').replace(
                            '{count}',
                            String(payments.length),
                          )}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </Card>
        </div>

        <Card className="space-y-2 p-3 xl:col-start-3 xl:row-start-2 xl:self-start">
          <SectionHeader
            title={t('instHistoryTitle')}
            description={t('instHistoryDesc')}
          />
          <ol className="space-y-2">
            {history.slice(0, EVENTS_PREVIEW_ROWS).map((event) => (
              <li key={event.key} className="relative flex gap-3 ps-1">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      event.kind === 'payment_voided' ||
                      event.kind === 'cancelled'
                        ? 'var(--danger)'
                        : event.kind === 'paid_off'
                          ? 'var(--success)'
                          : 'var(--muted)',
                  }}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[13px] font-medium">
                    {t(INSTALLMENT_HISTORY_LABEL_KEYS[event.kind])}
                    {event.amount !== null && (
                      <>
                        {' · '}
                        <Money value={event.amount} />
                      </>
                    )}
                  </p>
                  {event.kind === 'payment_recorded' &&
                    coverageOf(event.key.split(':')[0]) && (
                      <p className="break-words text-xs text-muted">
                        {coverageOf(event.key.split(':')[0])}
                      </p>
                    )}
                  {event.detail && (
                    <p className="break-words text-xs text-muted">
                      {event.detail}
                    </p>
                  )}
                  {(event.by || event.at) && (
                    <p className="text-xs text-muted">
                      {event.by}
                      {event.by && event.at && ' · '}
                      {event.at && (
                        <bdi dir="ltr">
                          {formatDate(saudiDateKey(event.at))}
                        </bdi>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {history.length > EVENTS_PREVIEW_ROWS && (
            <p className="text-xs text-muted">
              {t('instHistoryShown')
                .replace('{shown}', String(EVENTS_PREVIEW_ROWS))
                .replace('{total}', String(history.length))}
            </p>
          )}
        </Card>
      </div>

      {/* 3. Mobile action bar. */}
      {showActions && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {awaiting && (
            <Button
              variant="primary"
              className="h-11 min-w-0 flex-1 px-2"
              onClick={() => open({ kind: 'first_due' })}
            >
              {t('instSetFirstDue')}
            </Button>
          )}
          {active && (
            <Button
              variant={awaiting ? 'outline' : 'primary'}
              className={awaiting ? 'h-11 px-2.5' : 'h-11 flex-1'}
              icon={<Wallet size={16} aria-hidden="true" />}
              onClick={() => open({ kind: 'pay' })}
            >
              {t(awaiting ? 'instPayRow' : 'instPayTitle')}
            </Button>
          )}
          {optionsMenu(active ? 'h-11' : 'h-11 flex-1')}
        </div>
      )}

      {confirmDialog}

      {printing && askedRow && (
        <InstallmentPrintSheet
          contract={contract}
          schedule={schedule}
          asked={askedRow}
          onDone={() => setPrinting(false)}
        />
      )}

      {/* The dialogs, each open while `dialog` names it. A success reads
          the contract again and shows its Toast; a refusal shows its
          message in the dialog and reads the contract again. */}
      {canManage && (
        <>
          <SetFirstDueDateDialog
            contract={dialog?.kind === 'first_due' ? contract : null}
            onOpenChange={closeDialog}
            onDone={() => done('instToastFirstDueSet')}
            onStale={refresh}
          />
          <SetInstallmentNameDialog
            row={dialog?.kind === 'row_name' ? dialog.row : null}
            onOpenChange={closeDialog}
            onDone={() => done('instRowNameSaved')}
            onStale={refresh}
          />
          <SetPaymentDateDialog
            row={dialog?.kind === 'payment_date' ? dialog.row : null}
            onOpenChange={closeDialog}
            onDone={() => done('instToastPaymentDateSet')}
            onStale={refresh}
          />
          <InstallmentPaymentDialog
            open={dialog?.kind === 'pay'}
            onOpenChange={closeDialog}
            contract={contract}
            initialAmount={dialog?.kind === 'pay' ? dialog.amount : undefined}
            targetId={dialog?.kind === 'pay' ? dialog.targetId : undefined}
            onSaved={paymentSaved}
            onStale={refresh}
          />
          <VoidInstallmentPaymentDialog
            payment={dialog?.kind === 'void' ? dialog.payment : null}
            contractNumber={contract.contract_number}
            onOpenChange={closeDialog}
            onDone={() => done('instToastPaymentVoided')}
            onRefused={refresh}
          />
          <CancelInstallmentContractDialog
            open={dialog?.kind === 'cancel'}
            onOpenChange={closeDialog}
            contract={contract}
            units={units}
            onDone={() => done('instToastContractCancelled')}
            onRefused={refresh}
          />
        </>
      )}
    </div>
  )
}

function PaymentCard({
  payment,
  coverage,
  canVoid,
  canManageReceipt,
  onVoid,
  onReceiptChanged,
}: {
  payment: InstallmentPaymentRow
  /** What the payment covered; empty when nothing says. */
  coverage: string
  canVoid: boolean
  /** installments.manage: attach, replace or remove the receipt of a
   *  posted payment (a voided one keeps its file, view only). */
  canManageReceipt: boolean
  onVoid: () => void
  onReceiptChanged: () => void
}) {
  const { t } = useI18n()
  const voided = payment.status === 'voided'
  return (
    <li
      className={cn(
        'rounded-xl border bg-bg p-2.5 sm:p-3',
        voided && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1 sm:basis-2/5">
          <p className="break-words text-[13px] font-semibold">
            {coverage || <bdi dir="ltr">{formatDate(payment.paid_on)}</bdi>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <bdi dir="ltr">{formatDate(payment.paid_on)}</bdi>
            {' · '}
            {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
            {payment.reference ? (
              <>
                {' · '}
                <bdi dir="ltr">{payment.reference}</bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-1 text-xs text-muted sm:basis-3/5">
          <p>
            <Badge size="sm" tone={voided ? 'neutral' : 'success'}>
              {t(voided ? 'instPaymentVoided' : 'instPaymentPosted')}
            </Badge>
          </p>
          {payment.created_by_name && (
            <p className="flex items-center gap-1.5">
              <User size={12} aria-hidden="true" />
              {payment.created_by_name}
            </p>
          )}
          {payment.note && <p className="break-words">{payment.note}</p>}
          <PaymentReceiptLine
            contractId={payment.contract_id}
            paymentId={payment.id}
            receipt={receiptOf(payment)}
            canManage={canManageReceipt && !voided}
            onChanged={onReceiptChanged}
          />
          {voided && payment.void_reason && (
            <p className="break-words text-danger">
              {t('instVoidReason')} {payment.void_reason}
              {payment.voided_by_name && <> · {payment.voided_by_name}</>}
            </p>
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
          <p className={cn('text-base font-semibold', voided && 'line-through')}>
            <Money value={payment.amount} />
          </p>
          {!voided && canVoid && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Ban size={14} aria-hidden="true" />}
              onClick={onVoid}
            >
              {t('instVoidConfirm')}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
