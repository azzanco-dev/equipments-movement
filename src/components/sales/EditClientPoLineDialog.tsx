import { useEffect, useRef, useState } from 'react'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { ClientPoLineFields } from '@/components/sales/ClientPoLineFields'
import { SalePrice } from '@/components/sales/SalePrice'
import { Button, Dialog, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  clientPoLineEditFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  CLIENT_PO_LINE_EDIT_FIELD_ORDER,
  CLIENT_PO_LINE_EDIT_FIELD_RULES,
  SALE_DEFAULT_RATE_UNIT,
  clientPoErrorOutcome,
  saleRateUnitOf,
  type ClientPoLineEditFormValues,
} from '@/lib/sales'
import { updateClientPoEquipment, type ClientPoLineRow } from '@/lib/salesData'

/**
 * «تعديل المعدة» of a line on an open client PO: the sale price (empty =
 * «تحتاج سعر»), its unit, the standard hours, the contract quantity and the
 * note, saved in one call through `update_client_po_equipment`, which
 * records a price change as `price_changed` and any other change as
 * `line_updated`.
 */
export function EditClientPoLineDialog({
  line,
  poStandardHours,
  onOpenChange,
  onSaved,
}: {
  /** The line being edited; null closes the dialog. */
  line: ClientPoLineRow | null
  poStandardHours: number | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<ClientPoLineEditFormValues>({
    price: '',
    rate_unit: SALE_DEFAULT_RATE_UNIT,
    standard_hours: '',
    quantity: '',
    note: '',
  })
  const [errors, setErrors] = useState<FieldErrors<ClientPoLineEditFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const unit = line?.card?.equipment ?? null
  const lineId = line?.id ?? null
  const linePrice = line?.price
  const lineRateUnit = line?.rate_unit
  const lineHours = line?.standard_hours
  const lineQuantity = line?.quantity
  const lineNote = line?.note

  useEffect(() => {
    if (!lineId) return
    setForm({
      price:
        linePrice === undefined || linePrice === null ? '' : String(linePrice),
      rate_unit: saleRateUnitOf(lineRateUnit),
      standard_hours:
        lineHours === undefined || lineHours === null ? '' : String(lineHours),
      quantity:
        lineQuantity === undefined || lineQuantity === null
          ? ''
          : String(lineQuantity),
      note: lineNote ?? '',
    })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [lineId, linePrice, lineRateUnit, lineHours, lineQuantity, lineNote])

  const update = (patch: Partial<ClientPoLineEditFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof ClientPoLineEditFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (!line) return
    const invalid = validateWithSchema(clientPoLineEditFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, CLIENT_PO_LINE_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await updateClientPoEquipment({
      lineId: line.id,
      price: form.price.trim() ? Number(form.price.trim()) : null,
      rateUnit: form.rate_unit,
      // Empty = unchanged for the hours (NOT NULL on the line): the current
      // value is sent back explicitly.
      standardHours: form.standard_hours.trim()
        ? Number(form.standard_hours.trim())
        : line.standard_hours,
      quantity: form.quantity.trim() ? Number(form.quantity.trim()) : null,
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onSaved()
      return
    }
    const outcome = clientPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, CLIENT_PO_LINE_EDIT_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, CLIENT_PO_LINE_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={line !== null}
      onOpenChange={onOpenChange}
      title={t('supplierPoEditLine')}
      description={t('clientPoEditLineDesc')}
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
              {line.price === null ? (
                t('supplierPoNoPrice')
              ) : (
                <SalePrice
                  value={line.price}
                  unit={saleRateUnitOf(line.rate_unit)}
                />
              )}
            </span>
          </div>
        )}
        <ClientPoLineFields
          form={form}
          errors={errors}
          poStandardHours={poStandardHours}
          onChange={update}
        />
      </div>
    </Dialog>
  )
}
