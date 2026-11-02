import { SalePricePreview } from '@/components/sales/SalePrice'
import { Field, Input, Select, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { FieldErrors } from '@/lib/formValidation'
import {
  SALE_RATE_UNIT_LABEL_KEYS,
  SALE_RATE_UNITS,
  saleRateUnitOf,
  type ClientPoLineEditFormValues,
} from '@/lib/sales'

/**
 * The fields a client PO line carries beyond its unit, shared by «اضافة
 * معدة» and «تعديل المعدة»: the sale price (optional, «تحتاج سعر» while
 * empty), its unit (month / day / hour), the standard hours (empty = the
 * PO's default), the contract quantity (empty = no ceiling) and the note.
 */
export function ClientPoLineFields({
  form,
  errors,
  poStandardHours,
  onChange,
}: {
  form: ClientPoLineEditFormValues
  errors: FieldErrors<ClientPoLineEditFormValues>
  /** The PO's default hours, named in the hint when known. */
  poStandardHours: number | null
  onChange: (patch: Partial<ClientPoLineEditFormValues>) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field
          label={t('salePrice')}
          name="price"
          hint={
            form.price.trim() ? (
              <SalePricePreview value={form.price} />
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
              onChange={(event) => onChange({ price: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('supplierPoRateUnit')}
          name="rate_unit"
          required
          error={errors.rate_unit && t(errors.rate_unit)}
        >
          {(control) => (
            <Select
              {...control}
              value={form.rate_unit}
              options={SALE_RATE_UNITS.map((unit) => ({
                value: unit,
                label: t(SALE_RATE_UNIT_LABEL_KEYS[unit]),
              }))}
              onValueChange={(value) =>
                onChange({ rate_unit: saleRateUnitOf(value) })
              }
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('clientPoStandardHours')}
          name="standard_hours"
          hint={
            poStandardHours !== null
              ? t('clientPoLineStandardHoursHint').replace(
                  '{hours}',
                  String(poStandardHours),
                )
              : undefined
          }
          error={errors.standard_hours && t(errors.standard_hours)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="numeric"
              placeholder={
                poStandardHours !== null ? String(poStandardHours) : '260'
              }
              value={form.standard_hours}
              onChange={(event) =>
                onChange({ standard_hours: event.target.value })
              }
            />
          )}
        </Field>
        <Field
          label={t('clientPoQuantity')}
          name="quantity"
          hint={t('clientPoQuantityHint')}
          error={errors.quantity && t(errors.quantity)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              placeholder={t('clientPoNoQuantity')}
              value={form.quantity}
              onChange={(event) => onChange({ quantity: event.target.value })}
            />
          )}
        </Field>
      </div>
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
            onChange={(event) => onChange({ note: event.target.value })}
          />
        )}
      </Field>
    </>
  )
}
