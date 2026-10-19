import { useEffect, useRef, useState } from 'react'
import { Price, PricePreview } from '@/components/purchasing/Price'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoPriceFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_PRICE_FIELD_RULES,
  supplierPoErrorOutcome,
  type SupplierPoPriceFormValues,
} from '@/lib/purchasing'
import {
  isInternalUnit,
  updateSupplierPoEquipmentPrice,
  type SupplierPoLineRow,
} from '@/lib/purchasingData'

/**
 * «تعديل السعر» of a line on an open PO. Saves through
 * `update_supplier_po_equipment_price`, which records old and new in the
 * PO's event log.
 */
export function EditPriceDialog({
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
  const [form, setForm] = useState<SupplierPoPriceFormValues>({ price: '' })
  const [errors, setErrors] = useState<FieldErrors<SupplierPoPriceFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const unit = line?.card?.equipment ?? null
  const internal = isInternalUnit(unit)
  const lineId = line?.id ?? null
  const linePrice = line?.price

  useEffect(() => {
    if (!lineId) return
    setForm({ price: linePrice === undefined ? '' : String(linePrice) })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [lineId, linePrice])

  const save = async () => {
    if (!line) return
    const invalid = validateWithSchema(supplierPoPriceFormSchema(internal), form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, ['price'], { root: bodyRef.current })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await updateSupplierPoEquipmentPrice({
      lineId: line.id,
      price: Number(form.price),
    })
    setSaving(false)
    if (!result.error) {
      onSaved()
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_PRICE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) setErrors(outcome.fieldErrors)
    else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={line !== null}
      onOpenChange={onOpenChange}
      title={t('supplierPoEditPrice')}
      description={t('supplierPoEditPriceDesc')}
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
              {t('supplierPoCurrentPrice')}: <Price value={line.price} />
            </span>
          </div>
        )}
        <Field
          label={t('supplierPoPrice')}
          name="price"
          required
          hint={
            internal ? (
              t('supplierPoPriceInternalLocked')
            ) : (
              <PricePreview value={form.price} />
            )
          }
          error={errors.price && t(errors.price)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              value={form.price}
              disabled={internal}
              readOnly={internal}
              onChange={(event) => {
                setForm({ price: event.target.value })
                setErrors({})
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
