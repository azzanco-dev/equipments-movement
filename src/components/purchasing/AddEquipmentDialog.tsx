import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { PricePreview } from '@/components/purchasing/Price'
import { Button, Dialog, Field, Input, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoLineFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_LINE_FIELD_ORDER,
  SUPPLIER_PO_LINE_FIELD_RULES,
  supplierPoErrorOutcome,
  type SupplierPoLineFormValues,
} from '@/lib/purchasing'
import {
  addSupplierPoEquipment,
  equipmentOptionLoader,
  isInternalUnit,
  type PurchasingUnit,
} from '@/lib/purchasingData'

const EMPTY_FORM: SupplierPoLineFormValues = {
  equipment_id: '',
  price: '',
  note: '',
}

/**
 * «اضافة معدة» on an open PO: the unit (server-side search by code or
 * plate), the price excluding VAT (locked at 0 for an Al-Azani or internal
 * unit) and a note. Saves through `add_supplier_po_equipment`, which creates
 * or reuses the unit's card behind the scenes.
 */
export function AddEquipmentDialog({
  open,
  onOpenChange,
  poId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  poId: string
  onAdded: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoLineFormValues>(EMPTY_FORM)
  const [option, setOption] = useState<AsyncSearchSelectOption | null>(null)
  const [unit, setUnit] = useState<PurchasingUnit | null>(null)
  const [errors, setErrors] = useState<FieldErrors<SupplierPoLineFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const loader = useMemo(() => equipmentOptionLoader(), [])
  const internal = isInternalUnit(unit)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setOption(null)
    setUnit(null)
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [open])

  const update = (patch: Partial<SupplierPoLineFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoLineFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateWithSchema(supplierPoLineFormSchema(internal), form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await addSupplierPoEquipment({
      poId,
      equipmentId: form.equipment_id,
      price: Number(form.price),
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onAdded()
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_LINE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, SUPPLIER_PO_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoAddEquipment')}
      description={t('supplierPoAddEquipmentDesc')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('supplierPoAddEquipment')}
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
          label={t('supplierPoEquipmentField')}
          name="equipment_id"
          required
          error={errors.equipment_id && t(errors.equipment_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.equipment_id}
              selectedOption={option}
              placeholder={t('supplierPoEquipmentPlaceholder')}
              loadOptions={loader.loadOptions}
              onChange={(value, next) => {
                const picked = value ? loader.unitOf(value) : null
                setUnit(picked)
                // An internal unit locks the price at 0 the moment it is
                // picked; another unit gets the field back empty.
                update({
                  equipment_id: value,
                  price: isInternalUnit(picked) ? '0' : '',
                })
                setOption(next)
              }}
            />
          )}
        </Field>
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
              placeholder="0.00"
              value={form.price}
              disabled={internal}
              readOnly={internal}
              startIcon={
                internal ? <Lock size={14} aria-hidden="true" /> : undefined
              }
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
