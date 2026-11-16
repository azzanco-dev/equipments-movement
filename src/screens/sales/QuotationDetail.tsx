import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  BadgeCheck,
  Building2,
  Calendar,
  CalendarClock,
  Copy,
  Eraser,
  FileDown,
  FileSpreadsheet,
  MessageSquareReply,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  User,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import { Price } from '@/components/purchasing/Price'
import { ApproveQuotationDialog } from '@/components/sales/ApproveQuotationDialog'
import { DeleteQuotationDialog } from '@/components/sales/DeleteQuotationDialog'
import { QuotationFormDialog } from '@/components/sales/QuotationFormDialog'
import {
  ClearQuotationOutcomeDialog,
  QuotationOutcomeDialog,
} from '@/components/sales/QuotationOutcomeDialog'
import { QuotationPrintSheet } from '@/components/sales/QuotationPrintSheet'
import { ReturnQuotationDialog } from '@/components/sales/ReturnQuotationDialog'
import { useTabTitle } from '@/components/TabTitle'
import {
  Badge,
  Button,
  Card,
  DataTable,
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
  ToastProvider,
  useToast,
  type DataTableColumn,
  type DescriptionListItem,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import {
  BORNE_BY,
  canDeleteQuotation,
  daysLeftLabel,
  isQuotationDraftRef,
  QUOTATION_STATE_BADGE,
  quotationApprovalBlocker,
  quotationErrorMessage,
  quotationStateOf,
  showsDaysLeft,
  type QuotationLine,
} from '@/lib/quotations'
import {
  copyQuotation,
  fetchQuotation,
  type QuotationDetailData,
} from '@/lib/quotationsData'
import { saudiDateKey } from '@/lib/saudiTime'

/** The dialogs the quotation page opens. */
export type QuotationDialogKind =
  'edit' | 'approve' | 'return' | 'outcome' | 'clearOutcome' | 'delete'

export interface QuotationDetailProps {
  quotationId: string
  onBack: () => void
  /** After the quotation was deleted: the app opens the list. */
  onDeleted?: () => void
  /** Opens another quotation (the draft «نسخ العرض» made). */
  onOpenQuotation: (id: string) => void
}

/** The refusals that mean the quotation changed meanwhile (0199:
 *  quotation_not_draft, quotation_not_approved, quotation_approved_locked,
 *  quotation_number_issued, invalid_quotation). */
export const QUOTATION_STALE_MESSAGES: ReadonlySet<TranslationKey> = new Set([
  'quotationErrNotDraft',
  'quotationErrNotApproved',
  'quotationErrApprovedLocked',
  'quotationErrNumberIssued',
  'quotationErrNotFound',
])

/** The list the page returns to. */
export const QUOTATIONS_PATH = '/sales/quotations'

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-7 w-40" />
      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-[22px] w-16 rounded-md" />
        </div>
        <Skeleton variant="text" className="w-56" />
        <div className="grid grid-cols-2 gap-3 border-t pt-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <div className="card space-y-3 p-4">
        <Skeleton variant="text" className="w-28" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * The quotation page (/sales/quotations/:id, migration 0199, the Figma
 * design the owner approved on 2026-11-16): a header card (the number with
 * its state and the days left, the client and the project, the actions,
 * then one row of four facts), the prices by equipment type, the copied
 * terms beside the costs and the notes from `xl`, and on a phone the
 * primary action in a bottom bar. NO timeline (owner: «شيل سجل العرض»).
 * Reads through RLS (`sales.view`); every write goes through the 0199
 * functions, which check the keys again.
 */
export function QuotationDetail(props: QuotationDetailProps) {
  // The dialogs' successes show their Toasts through this provider; no
  // shell provides one.
  return (
    <ToastProvider>
      <QuotationDetailInner {...props} />
    </ToastProvider>
  )
}

function QuotationDetailInner({
  quotationId,
  onBack,
  onDeleted,
  onOpenQuotation,
}: QuotationDetailProps) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { can } = usePermissions()
  // Fails closed: `can` answers false until the permissions are ready.
  const canManage = can('sales.manage')
  const canApprove = can('sales.quotations.approve')
  const [data, setData] = useState<QuotationDetailData | null>(null)
  useTabTitle(data?.quotation.quote_number)
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  // The open dialog (edit, approve, return, outcome, clear, delete).
  const [dialog, setDialog] = useState<QuotationDialogKind | null>(null)
  const [printing, setPrinting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [actionError, setActionError] = useState<TranslationKey | null>(null)
  const startRequest = useListRequest()

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const signal = startRequest()
    try {
      const result = await fetchQuotation(quotationId, signal)
      if (signal.aborted) return
      setData(result)
    } catch {
      if (signal.aborted) return
      setLoadError(true)
    }
    setLoadedId(quotationId)
    setLoading(false)
  }, [quotationId, startRequest])

  useEffect(() => {
    void reload()
  }, [reload])

  // A dialog that can no longer render (the quotation changed state, or a
  // permission went) is not left named in the state.
  const draftNow = data?.quotation.status === 'draft'
  const approvedNow = data?.quotation.status === 'approved'
  useEffect(() => {
    if (!dialog) return
    const renders =
      dialog === 'edit' || dialog === 'delete'
        ? canManage && draftNow
        : dialog === 'approve'
          ? canApprove && draftNow
          : dialog === 'return'
            ? canApprove && approvedNow
            : canManage && approvedNow
    if (!renders) setDialog(null)
  }, [dialog, canManage, canApprove, draftNow, approvedNow])

  if (loading && (loadedId !== quotationId || !data))
    return <PageSkeleton label={t('loading')} />
  if (!data)
    return (
      <div className="space-y-4">
        <PageTrailBar
          onBack={onBack}
          fallbackLabel={t('quotationBackToList')}
        />
        {loadError ? (
          <ErrorState
            description={t('quotationLoadError')}
            onRetry={() => void reload()}
          />
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={28} aria-hidden="true" />}
            title={t('quotationNotFound')}
          />
        )}
      </div>
    )

  const { quotation, lines, costs, terms, company } = data
  const today = saudiDateKey()
  const state = quotationStateOf(quotation, today)
  const badge = QUOTATION_STATE_BADGE[state]
  const draft = quotation.status === 'draft'
  const approved = quotation.status === 'approved'
  const hasOutcome = approved && quotation.outcome !== null
  const lineCount = lines.length
  const approveBlocker = quotationApprovalBlocker(lineCount)
  const clientName =
    localizedName(lang, quotation.company_name_ar, quotation.company_name_en) ||
    '—'
  const projectName = quotation.project_id
    ? localizedName(lang, quotation.project_name_ar, quotation.project_name_en)
    : null

  const open = (kind: QuotationDialogKind) => {
    setActionError(null)
    setDialog(kind)
  }
  /**
   * A refused action. When the quotation changed meanwhile, the dialog
   * would vanish with the reload (it renders only in the state it acts on),
   * so it is closed and its message shown on the page; any other refusal
   * (validation, permission) stays inside the dialog. Either way the page
   * refetches.
   */
  const refused = (message: TranslationKey) => {
    if (QUOTATION_STALE_MESSAGES.has(message)) {
      setDialog(null)
      setActionError(message)
    }
    void reload()
  }
  const closeDialog = (next: boolean) => {
    if (!next) setDialog(null)
  }
  /** A dialog succeeded: close it, refetch, and say so. */
  const done = (title: TranslationKey, values: { number?: string } = {}) => {
    setDialog(null)
    void reload()
    toast({
      title: values.number
        ? t(title).replace('{number}', values.number)
        : t(title),
      tone: 'success',
    })
  }

  // «نسخ العرض» needs no dialog: a new draft, then its page.
  const copy = async () => {
    setActionError(null)
    setCopying(true)
    const result = await copyQuotation(quotation.id)
    setCopying(false)
    if (result.error || !result.data) {
      setActionError(quotationErrorMessage(result.error))
      void reload()
      return
    }
    onOpenQuotation(result.data)
  }

  // The primary action: the client's answer of an approved quotation (a
  // manager), or the approval of a draft (an approver).
  const primary: {
    kind: QuotationDialogKind
    label: TranslationKey
    icon: ReactNode
    disabled: boolean
  } | null =
    approved && canManage
      ? {
          kind: 'outcome',
          label: 'quotationRecordOutcome',
          icon: <MessageSquareReply size={16} aria-hidden="true" />,
          disabled: false,
        }
      : draft && canApprove
        ? {
            kind: 'approve',
            label: 'quotationApprove',
            icon: <BadgeCheck size={16} aria-hidden="true" />,
            disabled: Boolean(approveBlocker),
          }
        : null

  type MenuItem = {
    key: string
    label: TranslationKey
    icon: ReactNode
    onSelect: () => void
    tone?: 'danger'
    disabled?: boolean
    reason?: TranslationKey | null
  }
  const menuItems: MenuItem[] = draft
    ? [
        ...(canManage
          ? [
              {
                key: 'edit',
                label: 'quotationEdit' as const,
                icon: <Pencil size={15} />,
                onSelect: () => open('edit'),
              },
            ]
          : []),
        ...(canApprove
          ? [
              {
                key: 'approve',
                label: 'quotationApprove' as const,
                icon: <BadgeCheck size={15} />,
                onSelect: () => open('approve'),
                disabled: Boolean(approveBlocker),
                reason: approveBlocker,
              },
            ]
          : []),
        ...(canManage
          ? [
              {
                key: 'copy',
                label: 'quotationCopy' as const,
                icon: <Copy size={15} />,
                onSelect: () => void copy(),
                disabled: copying,
              },
            ]
          : []),
        ...(canManage && canDeleteQuotation(quotation)
          ? [
              {
                key: 'delete',
                label: 'quotationDelete' as const,
                icon: <Trash2 size={15} />,
                onSelect: () => open('delete'),
                tone: 'danger' as const,
              },
            ]
          : []),
      ]
    : [
        ...(canApprove
          ? [
              {
                key: 'return',
                label: 'quotationReturn' as const,
                icon: <RotateCcw size={15} />,
                onSelect: () => open('return'),
              },
            ]
          : []),
        ...(canManage
          ? [
              {
                key: 'copy',
                label: 'quotationCopy' as const,
                icon: <Copy size={15} />,
                onSelect: () => void copy(),
                disabled: copying,
              },
            ]
          : []),
        ...(canManage && hasOutcome
          ? [
              {
                key: 'clearOutcome',
                label: 'quotationClearOutcome' as const,
                icon: <Eraser size={15} />,
                onSelect: () => open('clearOutcome'),
              },
            ]
          : []),
      ]

  /** «خيارات»; on the phone bar it also holds «تصدير PDF». */
  const optionsMenu = (phone = false) => {
    const items: MenuItem[] = phone
      ? [
          {
            key: 'pdf',
            label: 'quotationPdf',
            icon: <FileDown size={15} />,
            onSelect: () => setPrinting(true),
            disabled: printing,
          },
          ...menuItems,
        ]
      : menuItems
    if (items.length === 0) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={phone ? 'md' : 'sm'}
            className={phone ? 'h-11' : undefined}
            icon={<SlidersHorizontal size={14} aria-hidden="true" />}
            aria-label={t('quotationActions')}
          >
            {t('options')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              icon={item.icon}
              tone={item.tone}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.reason ? (
                <span className="flex min-w-0 flex-col">
                  <span>{t(item.label)}</span>
                  <span className="max-w-56 whitespace-normal text-xs text-muted">
                    {t(item.reason)}
                  </span>
                </span>
              ) : (
                t(item.label)
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const primaryButton = (phone = false) =>
    primary ? (
      <Button
        variant="primary"
        size={phone ? 'md' : 'sm'}
        className={phone ? 'h-11 flex-1' : undefined}
        icon={primary.icon}
        disabled={primary.disabled}
        onClick={() => open(primary.kind)}
      >
        {t(primary.label)}
      </Button>
    ) : null

  const facts: DescriptionListItem[] = [
    {
      key: 'issue',
      icon: <Calendar size={16} />,
      label: t('quotationIssueDate'),
      value: formatDate(quotation.issue_date),
      dir: 'ltr',
    },
    {
      key: 'valid',
      icon: <CalendarClock size={16} />,
      label: t('quotationValidUntil'),
      value: formatDate(quotation.valid_until),
      dir: 'ltr',
    },
    {
      key: 'createdBy',
      icon: <User size={16} />,
      label: t('quotationCreatedBy'),
      value: quotation.created_by_name ?? '—',
    },
    ...(approved
      ? [
          {
            key: 'approvedBy',
            icon: <BadgeCheck size={16} />,
            label: t('quotationApprovedBy'),
            value: (
              <span className="flex flex-col">
                <span>{quotation.approved_by_name ?? '—'}</span>
                {quotation.approved_at && (
                  <span className="text-xs font-normal text-muted">
                    {formatDateTime(quotation.approved_at)}
                  </span>
                )}
              </span>
            ),
          },
        ]
      : []),
  ]

  const priceCell = (value: QuotationLine['daily_price']) =>
    value === null || value === undefined || value === '' ? (
      <span className="text-muted">{t('quotationNoPrice')}</span>
    ) : (
      <Price value={value} />
    )
  const priceColumns: DataTableColumn<QuotationLine>[] = [
    {
      key: 'equipment_type',
      header: t('quotationEquipmentType'),
      cell: (line) => (
        <span className="flex flex-col text-start">
          <span className="font-semibold">{line.equipment_type}</span>
          {line.note && (
            <span className="whitespace-normal break-words text-xs text-muted">
              {line.note}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'daily_price',
      header: t('quotationDaily'),
      align: 'end',
      cell: (line) => priceCell(line.daily_price),
    },
    {
      key: 'monthly_price',
      header: t('quotationMonthly'),
      align: 'end',
      cell: (line) => priceCell(line.monthly_price),
    },
    {
      key: 'mob_demob_price',
      header: t('quotationMobDemob'),
      align: 'end',
      cell: (line) => priceCell(line.mob_demob_price),
    },
  ]

  const phoneBar = Boolean(primary)

  return (
    <div className="space-y-4">
      <PageTrailBar onBack={onBack} fallbackLabel={t('quotationBackToList')} />

      {loadError && (
        <Notice tone="danger" size="compact">
          {t('quotationLoadError')}
        </Notice>
      )}
      {actionError && (
        <Notice
          tone="danger"
          size="compact"
          onDismiss={() => setActionError(null)}
        >
          {t(actionError)}
        </Notice>
      )}

      {/* 1. Header card: the number, its state and the days left, the
          client and the project, the actions; then the four facts. */}
      <Card className="space-y-3 p-4">
        <DetailHeader
          as="h1"
          identifier={quotation.quote_number}
          identifierLtr
          badges={
            <>
              <Badge tone={badge.tone}>{t(badge.key)}</Badge>
              {showsDaysLeft(state) && (
                <span className="text-xs text-muted">
                  {daysLeftLabel(quotation.valid_until, today, lang)}
                </span>
              )}
            </>
          }
          subtitle={
            <span className="flex flex-col">
              <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
                <Building2
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-muted"
                />
                {clientName}
              </span>
              <span className="text-sm text-muted">
                {projectName ?? t('quotationNoProject')}
              </span>
            </span>
          }
          actions={
            /* On a phone the primary action and the menu sit in the bottom
               bar when there is a primary action. */
            <div
              className={`${phoneBar ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-2`}
            >
              {optionsMenu()}
              <Button
                variant="outline"
                size="sm"
                icon={<FileDown size={14} aria-hidden="true" />}
                disabled={printing}
                onClick={() => setPrinting(true)}
              >
                {t('quotationPdf')}
              </Button>
              {primaryButton()}
            </div>
          }
        />
        <DescriptionList
          items={facts}
          className="border-t pt-1 sm:grid-cols-2 lg:grid-cols-4"
        />
      </Card>

      {isQuotationDraftRef(quotation.quote_number) && (
        <Notice tone="info" size="compact">
          {t('quotationDraftRefNotice')}
        </Notice>
      )}
      {approved && (
        <Notice tone="info" size="compact">
          {t(
            canApprove
              ? 'quotationApprovedNotice'
              : 'quotationApprovedNoticeNoApprove',
          )}
        </Notice>
      )}
      {hasOutcome && quotation.outcome_note && (
        <Notice
          tone={quotation.outcome === 'accepted' ? 'success' : 'danger'}
          size="compact"
          title={t(
            quotation.outcome === 'accepted'
              ? 'quotationAcceptedNotice'
              : 'quotationRejectedNotice',
          )}
        >
          <span className="whitespace-pre-wrap break-words">
            {quotation.outcome_note}
          </span>
        </Notice>
      )}

      {/* 2. The prices by equipment type. */}
      <Card padded={false} className="min-w-0">
        <div className="p-4 pb-3">
          <SectionHeader
            title={t('quotationPricesTitle')}
            description={t('quotationPricesDesc')}
          />
        </div>
        {lineCount === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState title={t('quotationNoLines')} className="p-6" />
          </div>
        ) : (
          <DataTable
            size="md"
            columns={priceColumns}
            rows={lines}
            rowKey={(line) => line.id}
            caption={t('quotationPricesTitle')}
            cellTextClassName="text-[13px]"
            cellClassName="py-2"
          />
        )}
      </Card>

      {/* 3. The terms (two thirds from xl) beside the costs and the notes. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="space-y-3 p-4 xl:col-span-2">
          <SectionHeader
            title={t('quotationTermsTitle')}
            description={t('quotationTermsDesc')}
          />
          {terms.length === 0 ? (
            <EmptyState title={t('quotationNoTerms')} className="p-6" />
          ) : (
            <ol className="m-0 list-none space-y-3 p-0">
              {terms.map((term, index) => (
                <li key={term.id} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium">{term.title_ar}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-muted">
                      {term.body_ar}
                    </p>
                    <p
                      dir="ltr"
                      className="whitespace-pre-wrap break-words text-start text-xs text-muted"
                    >
                      {term.title_en}: {term.body_en}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <SectionHeader
              title={t('quotationCostsTitle')}
              description={t('quotationCostsDesc')}
            />
            {costs.length === 0 ? (
              <p className="text-sm text-muted">{t('quotationNoCosts')}</p>
            ) : (
              <ul className="m-0 list-none divide-y p-0">
                {costs.map((cost) => (
                  <li
                    key={cost.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 break-words text-sm">
                      {cost.name}
                    </span>
                    <Badge tone={BORNE_BY[cost.borne_by].tone} size="sm">
                      {t(BORNE_BY[cost.borne_by].key)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {quotation.notes && (
            <Card className="space-y-2 p-4">
              <SectionHeader title={t('notes')} />
              <p className="whitespace-pre-wrap break-words text-sm">
                {quotation.notes}
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* 4. Phone action bar (44 px targets). */}
      {phoneBar && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {primaryButton(true)}
          {optionsMenu(true)}
        </div>
      )}

      {printing && (
        <QuotationPrintSheet
          quotation={quotation}
          state={state}
          lines={lines}
          costs={costs}
          terms={terms}
          company={company}
          client={{
            ar: quotation.company_name_ar ?? clientName,
            en: quotation.company_name_en,
          }}
          project={
            quotation.project_id
              ? {
                  ar: quotation.project_name_ar ?? projectName ?? '',
                  en: quotation.project_name_en,
                }
              : null
          }
          onDone={() => setPrinting(false)}
        />
      )}

      {/* The dialogs, each open while `dialog` names it. A success
          refetches and shows its Toast (a delete leaves the page); a
          refusal shows its message in the dialog and refetches. */}
      {canManage && draft && (
        <QuotationFormDialog
          open={dialog === 'edit'}
          onOpenChange={closeDialog}
          quotation={data}
          onSaved={() => done('quotationSavedToast')}
          onStale={refused}
        />
      )}
      {canApprove && draft && (
        <ApproveQuotationDialog
          open={dialog === 'approve'}
          onOpenChange={closeDialog}
          quotation={quotation}
          onApproved={(number) => done('quotationApprovedToast', { number })}
          onRefused={refused}
        />
      )}
      {canApprove && approved && (
        <ReturnQuotationDialog
          open={dialog === 'return'}
          onOpenChange={closeDialog}
          quotation={quotation}
          onReturned={() => done('quotationReturnedToast')}
          onRefused={refused}
        />
      )}
      {canManage && approved && (
        <>
          <QuotationOutcomeDialog
            open={dialog === 'outcome'}
            onOpenChange={closeDialog}
            quotation={quotation}
            onSaved={() => done('quotationOutcomeSavedToast')}
            onRefused={refused}
          />
          <ClearQuotationOutcomeDialog
            open={dialog === 'clearOutcome'}
            onOpenChange={closeDialog}
            quotation={quotation}
            onCleared={() => done('quotationOutcomeClearedToast')}
            onRefused={refused}
          />
        </>
      )}
      {canManage && draft && (
        <DeleteQuotationDialog
          open={dialog === 'delete'}
          onOpenChange={closeDialog}
          quotation={quotation}
          onDeleted={() => {
            setDialog(null)
            if (onDeleted) onDeleted()
            else onBack()
          }}
          onRefused={refused}
        />
      )}
    </div>
  )
}
