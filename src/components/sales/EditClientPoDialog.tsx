import { useEffect, useRef, useState } from 'react'
import {
  Button,
  DatePicker,
  Dialog,
  Field,
  Notice,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  clientPoEditFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  CLIENT_PO_EDIT_FIELD_ORDER,
  CLIENT_PO_EDIT_FIELD_RULES,
  clientPoErrorOutcome,
  type ClientPoEditFormValues,
} from '@/lib/sales'
import { updateClientPo, type ClientPoRow } from '@/lib/salesData'

/**
 * «تعديل PO العميل» (0169): the issue date, the expiry date and the notes of
 * an open PO; the company, the project and the client's number never change
 * (the cards and lines depend on them). Saves through `update_client_po`,
 * which records old and new as the event `updated`.
 */
export function EditClientPoDialog({
  po,
  open,
  onOpenChange,
  onSaved,
}: {
  po: Pick<
    ClientPoRow,
    'id' | 'po_number' | 'issue_date' | 'expiry_date' | 'notes'
  >
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<ClientPoEditFormValues>({
    issue_date: '',
    expiry_date: '',
    notes: '',
  })
  const [errors, setErrors] = useState<FieldErrors<ClientPoEditFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { issue_date: issueDate, expiry_date: expiryDate, notes } = po

  useEffect(() => {
    if (!open) return
    setForm({
      issue_date: issueDate,
      expiry_date: expiryDate ?? '',
      notes: notes ?? '',
    })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [open, issueDate, expiryDate, notes])

  const update = (patch: Partial<ClientPoEditFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof ClientPoEditFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateWithSchema(clientPoEditFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, CLIENT_PO_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await updateClientPo({
      poId: po.id,
      issueDate: form.issue_date,
      expiryDate: form.expiry_date,
      notes: form.notes,
    })
    setSaving(false)
    if (!result.error) {
      onSaved()
      return
    }
    const outcome = clientPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, CLIENT_PO_EDIT_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, CLIENT_PO_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span>
          {t('clientPoEdit')} <bdi dir="ltr">{po.po_number}</bdi>
        </span>
      }
      description={t('clientPoEditDesc')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('clientPoIssueDate')}
          name="issue_date"
          required
          error={errors.issue_date && t(errors.issue_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={form.issue_date}
              onChange={(value) => update({ issue_date: value })}
            />
          )}
        </Field>
        <Field
          label={t('clientPoExpiryDate')}
          name="expiry_date"
          hint={t('clientPoNoExpiry')}
          error={errors.expiry_date && t(errors.expiry_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={form.expiry_date}
              onChange={(value) => update({ expiry_date: value })}
            />
          )}
        </Field>
        <Field
          label={t('notes')}
          name="notes"
          error={errors.notes && t(errors.notes)}
        >
          {(control) => (
            <Textarea
              {...control}
              value={form.notes}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
