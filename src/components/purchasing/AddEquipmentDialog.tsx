import { useEffect, useMemo, useRef, useState } from 'react'
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
  equipmentAtProjectOptionLoader,
  supplierPoParty,
  type SupplierPoRow,
} from '@/lib/purchasingData'

const EMPTY_FORM: SupplierPoLineFormValues = {
  equipment_id: '',
  price: '',
  note: '',
}

/**
 * «اضافة معدة» on an open PO: the unit (server-side search, limited to the
 * PO party's units inside the PO's company and project right now — owner
 * rules 2026-10-19/20, migrations 0137/0138), an optional price excluding
 * VAT («تحتاج سعر» while empty) and a note. Saves through
 * `add_supplier_po_equipment`, which re-checks the rules and creates or
 * reuses the unit's card behind the scenes.
 */
export function AddEquipmentDialog({
  open,
  onOpenChange,
  po,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  po: Pick<SupplierPoRow, 'id' | 'lessor_id' | 'owner_class' | 'company_id' | 'project_id'>
  onAdded: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoLineFormValues>(EMPTY_FORM)
  const [option, setOption] = useState<AsyncSearchSelectOption | null>(null)
  const [errors, setErrors] = useState<FieldErrors<SupplierPoLineFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const party = useMemo(() => supplierPoParty(po), [po])
  const loadOptions = useMemo(
    () =>
      party
        ? equipmentAtProjectOptionLoader(party, po.company_id, po.project_id)
        : async () => [],
    [party, po.company_id, po.project_id],
  )

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setOption(null)
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
    const invalid = validateWithSchema(supplierPoLineFormSchema, form)
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
      poId: po.id,
      equipmentId: form.equipment_id,
      price: form.price.trim() ? Number(form.price.trim()) : null,
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
          hint={t('supplierPoEquipmentAtProjectHint')}
          error={errors.equipment_id && t(errors.equipment_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.equipment_id}
              selectedOption={option}
              placeholder={t('supplierPoEquipmentPlaceholder')}
              loadOptions={loadOptions}
              onChange={(value, next) => {
                setOption(next)
                update({ equipment_id: value })
              }}
            />
          )}
        </Field>
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
