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
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoEditFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_EDIT_FIELD_ORDER,
  SUPPLIER_PO_EDIT_FIELD_RULES,
  supplierPoErrorOutcome,
  type SupplierPoEditFormValues,
} from '@/lib/purchasing'
import { updateSupplierPo, type SupplierPoRow } from '@/lib/purchasingData'

/**
 * «تعديل الامر» (owner 2026-10-22, migration 0142): the start date and the
 * notes of an open PO; the party, company and project never change (the
 * cards and lines depend on them). Saves through `update_supplier_po`,
 * which records the old and new values as the event `updated`.
 */
export function EditSupplierPoDialog({
  po,
  open,
  onOpenChange,
  onSaved,
}: {
  po: Pick<SupplierPoRow, 'id' | 'po_number' | 'start_date' | 'notes'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoEditFormValues>({
    start_date: '',
    notes: '',
  })
  const [errors, setErrors] = useState<FieldErrors<SupplierPoEditFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { start_date: poStartDate, notes: poNotes } = po

  useEffect(() => {
    if (!open) return
    setForm({ start_date: poStartDate, notes: poNotes ?? '' })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [open, poStartDate, poNotes])

  const update = (patch: Partial<SupplierPoEditFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoEditFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateWithSchema(supplierPoEditFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await updateSupplierPo({
      poId: po.id,
      startDate: form.start_date,
      notes: form.notes,
    })
    setSaving(false)
    if (!result.error) {
      onSaved()
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_EDIT_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, SUPPLIER_PO_EDIT_FIELD_ORDER, {
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
          {t('supplierPoEdit')} <bdi dir="ltr">{po.po_number}</bdi>
        </span>
      }
      description={t('supplierPoEditDesc')}
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
          label={t('supplierPoStartDate')}
          name="start_date"
          required
          error={errors.start_date && t(errors.start_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={form.start_date}
              onChange={(value) => update({ start_date: value })}
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
