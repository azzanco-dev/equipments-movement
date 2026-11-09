import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { ClientPoLineFields } from '@/components/sales/ClientPoLineFields'
import { Button, Dialog, Field, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  clientPoLineFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  CLIENT_PO_LINE_FIELD_ORDER,
  CLIENT_PO_LINE_FIELD_RULES,
  SALE_DEFAULT_RATE_UNIT,
  clientPoErrorOutcome,
  type ClientPoLineFormValues,
} from '@/lib/sales'
import {
  addClientPoEquipment,
  equipmentAtClientProjectOptionLoader,
} from '@/lib/salesData'

const EMPTY_FORM: ClientPoLineFormValues = {
  equipment_id: '',
  price: '',
  rate_unit: SALE_DEFAULT_RATE_UNIT,
  standard_hours: '',
  quantity: '',
  note: '',
}

/**
 * «اضافة معدة» on an open client PO: the unit (server-side search, limited
 * to the units inside the PO's company and project right now — the 0169
 * join rule, no entry-day rule), the optional sale price with its unit, the
 * standard hours (empty = the PO's), the contract quantity and a note.
 * Saves through `add_client_po_equipment`, which re-checks the rules and
 * reuses or creates the unit's card behind the scenes.
 */
export function AddClientPoEquipmentDialog({
  open,
  onOpenChange,
  po,
  excludeEquipmentIds = [],
  initialUnit = null,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  po: {
    id: string
    company_id: string
    project_id: string
    /** The PO's default hours; unknown (null) from the tickets page. */
    standard_hours: number | null
  }
  /** Units already on the PO: the search leaves them out. */
  excludeEquipmentIds?: readonly string[]
  /** «المعدات في المشاريع»: the unit the dialog opens with, already chosen. */
  initialUnit?: AsyncSearchSelectOption | null
  onAdded: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<ClientPoLineFormValues>(EMPTY_FORM)
  const [option, setOption] = useState<AsyncSearchSelectOption | null>(null)
  const [errors, setErrors] = useState<FieldErrors<ClientPoLineFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The exclusion list is keyed by content so a parent re-render with the
  // same lines does not rebuild the loader (and refetch).
  const excludeKey = excludeEquipmentIds.join(',')
  const loadOptions = useMemo(
    () =>
      equipmentAtClientProjectOptionLoader(po.company_id, po.project_id, {
        excludeEquipmentIds: excludeKey ? excludeKey.split(',') : [],
        // 0188: a unit that left the project within 60 days, marked.
        exitedLabel: t('siteUnitsExited'),
      }),
    [po.company_id, po.project_id, excludeKey, t],
  )

  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY_FORM, equipment_id: initialUnit?.value ?? '' })
    setOption(initialUnit)
    setErrors({})
    setMessage(null)
    setSaving(false)
    // Read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (patch: Partial<ClientPoLineFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof ClientPoLineFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateWithSchema(clientPoLineFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, CLIENT_PO_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await addClientPoEquipment({
      poId: po.id,
      equipmentId: form.equipment_id,
      price: form.price.trim() ? Number(form.price.trim()) : null,
      rateUnit: form.rate_unit,
      standardHours: form.standard_hours.trim()
        ? Number(form.standard_hours.trim())
        : null,
      quantity: form.quantity.trim() ? Number(form.quantity.trim()) : null,
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onAdded()
      return
    }
    const outcome = clientPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, CLIENT_PO_LINE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, CLIENT_PO_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoAddEquipment')}
      description={t('clientPoAddEquipmentDesc')}
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
          hint={t('clientPoEquipmentAtProjectHint')}
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
        <ClientPoLineFields
          form={form}
          errors={errors}
          poStandardHours={po.standard_hours}
          onChange={update}
        />
      </div>
    </Dialog>
  )
}
