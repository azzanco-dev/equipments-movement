import { useEffect, useRef, useState } from 'react'
import { Price } from '@/components/purchasing/Price'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  focusFirstError,
  hasErrors,
  supplierPoRemoveLineFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import { supplierPoFormMessage, supplierPoRateUnitOf } from '@/lib/purchasing'
import {
  removeSupplierPoEquipment,
  type RemovedSupplierPoLine,
  type SupplierPoLineRow,
} from '@/lib/purchasingData'

interface RemoveLineFormValues {
  note: string
}

const REMOVE_LINE_FIELD_ORDER: readonly (keyof RemoveLineFormValues)[] = [
  'note',
]

/**
 * «حذف المعدة» of a line on an OPEN, DRAFT supplier PO (owner 2026-11-09,
 * migration 0187): a confirm dialog with the unit, an optional note and the
 * danger button. Saves through `remove_supplier_po_equipment`, which
 * re-checks `purchasing.manage`, the open and draft state, and deletes the
 * card too when nothing else uses it (unknowable here, hence the neutral
 * line about the card).
 */
export function RemoveEquipmentDialog({
  line,
  onOpenChange,
  onRemoved,
}: {
  /** The line being removed; null closes the dialog. */
  line: SupplierPoLineRow | null
  onOpenChange: (open: boolean) => void
  onRemoved: (result: RemovedSupplierPoLine | null) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<RemoveLineFormValues>({ note: '' })
  const [errors, setErrors] = useState<FieldErrors<RemoveLineFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lineId = line?.id ?? null
  const unit = line?.card?.equipment ?? null

  useEffect(() => {
    if (!lineId) return
    setForm({ note: '' })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [lineId])

  const remove = async () => {
    if (!line || saving) return
    const invalid = validateWithSchema(supplierPoRemoveLineFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, REMOVE_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await removeSupplierPoEquipment({
      lineId: line.id,
      note: form.note,
    })
    setSaving(false)
    if (result.error) {
      setMessage(supplierPoFormMessage(result.error))
      return
    }
    onRemoved(result.data)
  }

  return (
    <Dialog
      open={line !== null}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('supplierPoRemoveLineTitle')}
      description={t('supplierPoRemoveLineDesc')}
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="danger" loading={saving} onClick={remove}>
            {t('supplierPoRemoveLine')}
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
              {line.price === null ? (
                t('supplierPoNoPrice')
              ) : (
                <Price
                  value={line.price}
                  unit={supplierPoRateUnitOf(line.rate_unit)}
                />
              )}
            </span>
          </div>
        )}
        <p className="text-sm text-muted">
          {t('supplierPoRemoveLineCardNote')}
        </p>
        <Field
          label={t('supplierPoRemoveLineNote')}
          name="note"
          error={errors.note && t(errors.note)}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={form.note}
              onChange={(event) => {
                setForm({ note: event.target.value })
                setErrors({})
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
