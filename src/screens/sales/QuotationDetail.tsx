import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Building2,
  Calendar,
  CalendarClock,
  Copy,
  FileDown,
  FileSpreadsheet,
  History,
  Pencil,
  SlidersHorizontal,
  Trash2,
  User,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import { Price } from '@/components/purchasing/Price'
import { DeleteQuotationDialog } from '@/components/sales/DeleteQuotationDialog'
import { QuotationFormDialog } from '@/components/sales/QuotationFormDialog'
import { QuotationPrintSheet } from '@/components/sales/QuotationPrintSheet'
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
  quotationErrorMessage,
  type QuotationLine,
} from '@/lib/quotations'
import {
  copyQuotation,
  fetchQuotation,
  type QuotationDetailData,
} from '@/lib/quotationsData'

/** The dialogs the quotation page opens. */
export type QuotationDialogKind = 'edit' | 'delete'

export interface QuotationDetailProps {
  quotationId: string
  onBack: () => void
  /** After the quotation was deleted: the app opens the list. */
  onDeleted?: () => void
  /** Opens another quotation (the one «نسخ العرض» made). */
  onOpenQuotation: (id: string) => void
}

/** The refusal that means the quotation is gone meanwhile
 *  (`invalid_quotation`: somebody deleted it). */
export const QUOTATION_STALE_MESSAGES: ReadonlySet<TranslationKey> = new Set([
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
        <Skeleton className="h-7 w-36" />
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
 * design the owner approved on 2026-11-16): a header card (the number, the
 * client and the project, the actions, then one row of four facts), the
 * prices by equipment type, the copied terms beside the costs and the notes
 * from `xl`. NO timeline (owner: «شيل سجل العرض»).
 *
 * A quotation is a plain document (owner 2026-11-17, «مايحتاج التصنيف او
 * الدورة, شيلها», migration 0200): nothing marks its stage and no step
 * follows its creation. «تصدير PDF» is for every reader; «خيارات» = تعديل /
 * نسخ العرض / حذف العرض for `sales.manage`, always available. Reads go
 * through RLS (`sales.view`); every write through `save_quotation`,
 * `copy_quotation` and `delete_quotation`, which check the key again.
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
  const [data, setData] = useState<QuotationDetailData | null>(null)
  useTabTitle(data?.quotation.quote_number)
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  // The open dialog (edit, delete).
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

  // A dialog that can no longer render (the permission went) is not left
  // named in the state.
  useEffect(() => {
    if (dialog && !canManage) setDialog(null)
  }, [dialog, canManage])

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
  const lineCount = lines.length
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
   * A refused action. When the quotation is gone meanwhile, the dialog is
   * closed and its message shown on the page; any other refusal
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
  const done = (title: TranslationKey) => {
    setDialog(null)
    void reload()
    toast({ title: t(title), tone: 'success' })
  }

  // «نسخ العرض» needs no dialog: a new quotation, then its page.
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

  type MenuItem = {
    key: string
    label: TranslationKey
    icon: ReactNode
    onSelect: () => void
    tone?: 'danger'
    disabled?: boolean
  }
  // «خيارات» of a manager: always the same three, whatever the quotation.
  const menuItems: MenuItem[] = canManage
    ? [
        {
          key: 'edit',
          label: 'quotationEdit',
          icon: <Pencil size={15} />,
          onSelect: () => open('edit'),
        },
        {
          key: 'copy',
          label: 'quotationCopy',
          icon: <Copy size={15} />,
          onSelect: () => void copy(),
          disabled: copying,
        },
        {
          key: 'delete',
          label: 'quotationDelete',
          icon: <Trash2 size={15} />,
          onSelect: () => open('delete'),
          tone: 'danger',
        },
      ]
    : []

  /** «خيارات» (nothing for a reader without `sales.manage`). */
  const optionsMenu =
    menuItems.length === 0 ? null : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            icon={<SlidersHorizontal size={14} aria-hidden="true" />}
            aria-label={t('quotationActions')}
          >
            {t('options')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {menuItems.map((item) => (
            <DropdownMenuItem
              key={item.key}
              icon={item.icon}
              tone={item.tone}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {t(item.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )

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
    {
      key: 'updatedAt',
      icon: <History size={16} />,
      label: t('updatedAt'),
      value: formatDateTime(quotation.updated_at ?? quotation.created_at),
      dir: 'ltr',
    },
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

      {/* 1. Header card: the number, the client and the project, the
          actions; then the four facts. */}
      <Card className="space-y-3 p-4">
        <DetailHeader
          as="h1"
          identifier={quotation.quote_number}
          identifierLtr
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
            <div className="flex flex-wrap items-center gap-2">
              {optionsMenu}
              <Button
                variant="outline"
                size="sm"
                icon={<FileDown size={14} aria-hidden="true" />}
                disabled={printing}
                onClick={() => setPrinting(true)}
              >
                {t('quotationPdf')}
              </Button>
            </div>
          }
        />
        <DescriptionList
          items={facts}
          className="border-t pt-1 sm:grid-cols-2 lg:grid-cols-4"
        />
      </Card>

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

      {printing && (
        <QuotationPrintSheet
          quotation={quotation}
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
      {canManage && (
        <>
          <QuotationFormDialog
            open={dialog === 'edit'}
            onOpenChange={closeDialog}
            quotation={data}
            onSaved={() => done('quotationSavedToast')}
            onStale={refused}
          />
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
        </>
      )}
    </div>
  )
}
