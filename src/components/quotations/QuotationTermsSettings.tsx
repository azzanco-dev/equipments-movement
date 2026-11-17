import { useCallback, useEffect, useState } from 'react'
import { Edit2, Plus, ScrollText, Trash2 } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  QuotationTermFormDialog,
  quotationTermWriteMessage,
} from '@/components/quotations/QuotationTermFormDialog'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  PageHeader,
  useConfirm,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  QUOTATION_TERMS_PERMISSION,
  type QuotationTermTemplate,
} from '@/lib/quotations'
import {
  deleteQuotationTermTemplate,
  fetchQuotationTermTemplates,
} from '@/lib/quotationsData'

/**
 * Settings › «شروط عروض الاسعار» (/settings/quotation-terms, migration 0199):
 * the terms template every new quotation starts from — a title and a text in
 * Arabic and English, an order, and whether the term is ticked by default.
 * Written directly under RLS (`sales.quotations.approve`) and read back.
 * Saved quotations keep their own copies, so an edit here never changes
 * them. The term form is `QuotationTermFormDialog` (the quotation form
 * opens it too, to add a term).
 */
export function QuotationTermsSettings({
  onBack,
  backLabel,
}: {
  onBack: () => void
  backLabel?: string
}) {
  const { t } = useI18n()
  const { can } = usePermissions()
  const canEdit = can(QUOTATION_TERMS_PERMISSION)
  const [rows, setRows] = useState<QuotationTermTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<QuotationTermTemplate | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const startRequest = useListRequest()

  const fetchRows = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    try {
      const next = await fetchQuotationTermTemplates(signal)
      if (signal.aborted) return
      setRows(next)
    } catch {
      if (signal.aborted) return
      setLoadError(true)
    }
    setLoading(false)
  }, [startRequest])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  const openForm = (row: QuotationTermTemplate | null) => {
    setEditing(row)
    setModalOpen(true)
  }

  async function remove(row: QuotationTermTemplate) {
    setError(null)
    if (
      !(await confirm({
        title: t('quotationTermDeleteTitle'),
        description: t('quotationTermDeleteDesc'),
        confirmLabel: t('delete'),
        tone: 'danger',
      }))
    )
      return
    const message = quotationTermWriteMessage(
      await deleteQuotationTermTemplate(row.id),
    )
    if (message) setError(message)
    await fetchRows()
  }

  const columns: DataTableColumn<QuotationTermTemplate>[] = [
    {
      key: 'position',
      header: '#',
      className: 'tabular-nums text-muted',
      cell: (row) => row.position,
    },
    {
      key: 'title',
      header: t('quotationTermColTitle'),
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="font-semibold">{row.title_ar}</span>
          <bdi dir="ltr" className="text-xs text-muted">
            {row.title_en}
          </bdi>
        </span>
      ),
    },
    {
      key: 'body',
      header: t('quotationTermColBody'),
      cell: (row) => (
        <span className="flex max-w-xl flex-col gap-0.5 text-start">
          <span className="whitespace-pre-wrap break-words">{row.body_ar}</span>
          <span
            dir="ltr"
            className="whitespace-pre-wrap break-words text-start text-xs text-muted"
          >
            {row.body_en}
          </span>
        </span>
      ),
    },
    {
      key: 'is_default',
      header: t('quotationTermDefault'),
      cell: (row) => (
        <Badge tone={row.is_default ? 'success' : 'neutral'} size="sm">
          {t(row.is_default ? 'yes' : 'no')}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('actions'),
            cell: (row: QuotationTermTemplate) => (
              <span className="flex items-center gap-1">
                <IconButton
                  size="sm"
                  label={t('edit')}
                  title={t('edit')}
                  icon={<Edit2 size={15} />}
                  onClick={() => openForm(row)}
                />
                <IconButton
                  size="sm"
                  label={t('delete')}
                  title={t('delete')}
                  icon={<Trash2 size={15} />}
                  onClick={() => void remove(row)}
                />
              </span>
            ),
          },
        ]
      : []),
  ]

  const addButton = canEdit ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => openForm(null)}
    >
      {t('quotationTermAdd')}
    </Button>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('quotationTermsSettings')}
        description={t('quotationTermsSettingsDesc')}
        onBack={onBack}
        backLabel={backLabel}
        actions={addButton}
      />
      {error && (
        <Notice tone="danger" size="compact" onDismiss={() => setError(null)}>
          {t(error)}
        </Notice>
      )}
      {loadError ? (
        <ErrorState
          description={t('quotationTermsLoadError')}
          onRetry={() => void fetchRows()}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={28} aria-hidden="true" />}
          title={t('quotationTermsTemplateNone')}
          action={addButton}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={4}
          caption={t('quotationTermsSettings')}
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
        />
      )}
      <QuotationTermFormDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        term={editing}
        onSaved={() => {
          setModalOpen(false)
          void fetchRows()
        }}
      />
      {confirmDialog}
    </div>
  )
}
