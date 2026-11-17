import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  Switch,
  Textarea,
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
  insertQuotationTermTemplate,
  updateQuotationTermTemplate,
  type TemplateWriteResult,
} from '@/lib/quotationsData'

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
export function quotationTermWriteMessage(
  result: TemplateWriteResult,
): TranslationKey | null {
  if (result.ok) return null
  return result.refused ? 'quotationTermSaveNotAllowed' : 'saveFailed'
}

/**
 * «شرط جديد» / «تعديل الشرط»: one term of the quotation terms template — a
 * title and a text in Arabic and English, its order and whether a new
 * quotation ticks it. Written directly under RLS (`sales.quotations.approve`)
 * and read back. Opened from Settings › «شروط عروض الاسعار» (add and edit)
 * and from the quotation form (owner 2026-11-17, «اقدر من اضافة عرض سعر جديد
 * اني اضيف شروط واحكام»: a new term only, which joins the template). On edit
 * the term keeps its position unless the user changes it (a position of 0 or
 * less would send it to the end).
 */
export function QuotationTermFormDialog({
  open,
  onOpenChange,
  term = null,
  note,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The template term to edit; null adds a new one. */
  term?: QuotationTermTemplate | null
  /** A line above the fields (the quotation form says where the term goes). */
  note?: ReactNode
  onSaved: (id: string) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<QuotationTermTemplateFormValues>(EMPTY_FORM)
  const [errors, setErrors] = useState<
    FieldErrors<QuotationTermTemplateFormValues>
  >({})
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(
      term
        ? {
            title_ar: term.title_ar,
            title_en: term.title_en,
            body_ar: term.body_ar,
            body_en: term.body_en,
            // The current position: sent back unchanged, the term stays.
            position: String(term.position),
            is_default: term.is_default,
          }
        : EMPTY_FORM,
    )
    setErrors({})
    setFormError(null)
    setSaving(false)
    // The term is read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
    const result = term
      ? await updateQuotationTermTemplate(term.id, form)
      : await insertQuotationTermTemplate(form)
    setSaving(false)
    if (!result.ok) {
      setFormError(quotationTermWriteMessage(result))
      return
    }
    onSaved(result.id)
  }

  const fieldError = (field: keyof QuotationTermTemplateFormValues) =>
    errors[field] ? t(errors[field]) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={term ? t('quotationTermEditTitle') : t('quotationTermNewTitle')}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
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
        {note && (
          <Notice tone="info" size="compact">
            {note}
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
  )
}
