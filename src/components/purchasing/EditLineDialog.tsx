import { useEffect, useRef, useState } from 'react'
import { Price, PricePreview } from '@/components/purchasing/Price'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { Button, Dialog, Field, Input, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoLineEditFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_LINE_EDIT_FIELD_ORDER,
  SUPPLIER_PO_LINE_EDIT_FIELD_RULES,
  supplierPoErrorOutcome,
  type SupplierPoLineEditFormValues,
} from '@/lib/purchasing'
import {
  updateSupplierPoEquipment,
  type SupplierPoLineRow,
} from '@/lib/purchasingData'

/**
 * «تعديل المعدة» of a line on an open PO (owner 2026-10-22: the note is
 * edited with the price, migration 0142): the price excluding VAT (empty =
 * «تحتاج تسعير») and the note, saved in one call through
 * `update_supplier_po_equipment`, which records a price change as
 * `price_changed` and a note-only change as `line_updated`.
 */
export function EditLineDialog({
  line,
  onOpenChange,
  onSaved,
}: {
  /** The line being edited; null closes the dialog. */
  line: SupplierPoLineRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoLineEditFormValues>({
    price: '',
    note: '',
  })
  const [errors, setErrors] = useState<
    FieldErrors<SupplierPoLineEditFormValues>
  >({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const unit = line?.card?.equipment ?? null
  const lineId = line?.id ?? null
  const linePrice = line?.price
  const lineNote = line?.note

  useEffect(() => {
    if (!lineId) return
    setForm({
      price: linePrice === undefined || linePrice === null ? '' : String(linePrice),
      note: lineNote ?? '',
    })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [lineId, linePrice, lineNote])

  const update = (patch: Partial<SupplierPoLineEditFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoLineEditFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (!line) return
    const invalid = validateWithSchema(supplierPoLineEditFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_LINE_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await updateSupplierPoEquipment({
      lineId: line.id,
      price: form.price.trim() ? Number(form.price.trim()) : null,
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onSaved()
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_LINE_EDIT_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, SUPPLIER_PO_LINE_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={line !== null}
      onOpenChange={onOpenChange}
      title={t('supplierPoEditLine')}
      description={t('supplierPoEditLineDesc')}
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
        {line && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-sm">
            <PurchasingUnitCell unit={unit} />
            <span className="text-muted">
              {t('supplierPoCurrentPrice')}:{' '}
              {line.price === null ? t('supplierPoNoPrice') : <Price value={line.price} />}
            </span>
          </div>
        )}
        <Field
          label={t('supplierPoPrice')}
          name="price"
          hint={
            form.price.trim() ? (
              <PricePreview value={form.price} />
            ) : (
              t('supplierPoNoPrice')
            )
          }
          error={errors.price && t(errors.price)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              placeholder="0.00"
              value={form.price}
              onChange={(event) => update({ price: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('supplierPoLineNote')}
          name="note"
          error={errors.note && t(errors.note)}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={form.note}
              onChange={(event) => update({ note: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
