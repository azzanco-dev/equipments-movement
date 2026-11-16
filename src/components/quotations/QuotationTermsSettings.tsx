import { useCallback, useEffect, useRef, useState } from 'react'
import { Edit2, Plus, ScrollText, Trash2 } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Notice,
  PageHeader,
  Switch,
  Textarea,
  useConfirm,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  focusFirstError,
  hasErrors,
  QUOTATION_TERM_BODY_MAX,
  QUOTATION_TERM_TITLE_MAX,
  quotationTermTemplateSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import type {
  QuotationTermTemplate,
  QuotationTermTemplateFormValues,
} from '@/lib/quotations'
import {
  deleteQuotationTermTemplate,
  fetchQuotationTermTemplates,
  insertQuotationTermTemplate,
  updateQuotationTermTemplate,
  type TemplateWriteResult,
} from '@/lib/quotationsData'

/** The permission of the page and of every write (RLS re-checks it). */
export const QUOTATION_TERMS_PERMISSION = 'sales.quotations.approve'

const FIELD_ORDER: readonly (keyof QuotationTermTemplateFormValues)[] = [
  'title_ar',
  'title_en',
  'body_ar',
  'body_en',
  'position',
  'is_default',
]

const EMPTY_FORM: QuotationTermTemplateFormValues = {
  title_ar: '',
  title_en: '',
  body_ar: '',
  body_en: '',
  position: '',
  is_default: true,
}

/** The safe message of a refused template write. */
function writeMessage(result: TemplateWriteResult): TranslationKey | null {
  if (result.ok) return null
  return result.refused ? 'quotationTermSaveNotAllowed' : 'saveFailed'
}

/**
 * Settings › «شروط عروض الاسعار» (/settings/quotation-terms, migration 0199):
 * the terms template every new quotation starts from — a title and a text in
 * Arabic and English, an order, and whether the term is ticked by default.
 * Written directly under RLS (`sales.quotations.approve`) and read back.
 * Saved quotations keep their own copies, so an edit here never changes
 * them. On edit the term keeps its position unless the user changes it (a
 * position of 0 or less would send it to the end).
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
  const [form, setForm] = useState<QuotationTermTemplateFormValues>(EMPTY_FORM)
  const [errors, setErrors] = useState<
    FieldErrors<QuotationTermTemplateFormValues>
  >({})
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
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
    setForm(
      row
        ? {
            title_ar: row.title_ar,
            title_en: row.title_en,
            body_ar: row.body_ar,
            body_en: row.body_en,
            // The current position: sent back unchanged, the term stays.
            position: String(row.position),
            is_default: row.is_default,
          }
        : EMPTY_FORM,
    )
    setErrors({})
    setFormError(null)
    setModalOpen(true)
  }

  const update = (patch: Partial<QuotationTermTemplateFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(
        patch,
      ) as (keyof QuotationTermTemplateFormValues)[])
        delete next[key]
      return next
    })
  }

  async function save() {
    if (saving) return
    const invalid = validateWithSchema(quotationTermTemplateSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      focusFirstError(invalid, FIELD_ORDER, { root: formRef.current })
      return
    }
    setSaving(true)
    setFormError(null)
    const result = editing
      ? await updateQuotationTermTemplate(editing.id, form)
      : await insertQuotationTermTemplate(form)
    setSaving(false)
    const message = writeMessage(result)
    if (message) {
      setFormError(message)
      return
    }
    setModalOpen(false)
    await fetchRows()
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
    const message = writeMessage(await deleteQuotationTermTemplate(row.id))
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

  const fieldError = (field: keyof QuotationTermTemplateFormValues) =>
    errors[field] ? t(errors[field]) : undefined

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
      <Dialog
        open={modalOpen}
        onOpenChange={(next) => {
          if (!next && saving) return
          setModalOpen(next)
        }}
        title={
          editing ? t('quotationTermEditTitle') : t('quotationTermNewTitle')
        }
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setModalOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div ref={formRef} className="space-y-4">
          {formError && (
            <Notice tone="danger" size="compact">
              {t(formError)}
            </Notice>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('quotationTermTitleAr')}
              name="title_ar"
              required
              error={fieldError('title_ar')}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={QUOTATION_TERM_TITLE_MAX}
                  value={form.title_ar}
                  onChange={(event) => update({ title_ar: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('quotationTermTitleEn')}
              name="title_en"
              required
              error={fieldError('title_en')}
            >
              {(control) => (
                <Input
                  {...control}
                  dir="ltr"
                  maxLength={QUOTATION_TERM_TITLE_MAX}
                  value={form.title_en}
                  onChange={(event) => update({ title_en: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            label={t('quotationTermBodyAr')}
            name="body_ar"
            required
            error={fieldError('body_ar')}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={QUOTATION_TERM_BODY_MAX}
                value={form.body_ar}
                onChange={(event) => update({ body_ar: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('quotationTermBodyEn')}
            name="body_en"
            required
            error={fieldError('body_en')}
          >
            {(control) => (
              <Textarea
                {...control}
                dir="ltr"
                rows={3}
                maxLength={QUOTATION_TERM_BODY_MAX}
                value={form.body_en}
                onChange={(event) => update({ body_en: event.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            <Field
              label={t('quotationTermPosition')}
              name="position"
              hint={t('quotationTermPositionHint')}
              error={fieldError('position')}
            >
              {(control) => (
                <Input
                  {...control}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.position}
                  onChange={(event) => update({ position: event.target.value })}
                />
              )}
            </Field>
            <div data-field="is_default" className="pt-6">
              <Switch
                label={t('quotationTermDefault')}
                checked={form.is_default}
                onCheckedChange={(checked) =>
                  update({ is_default: checked === true })
                }
              />
            </div>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
