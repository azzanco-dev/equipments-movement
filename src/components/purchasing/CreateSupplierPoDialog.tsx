import { useEffect, useRef, useState } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useMovementFormOptions } from '@/components/movement/useMovementFormOptions'
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
  supplierPoFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_CREATE_FIELD_RULES,
  SUPPLIER_PO_FIELD_ORDER,
  supplierPoErrorOutcome,
  type SupplierPoFormValues,
} from '@/lib/purchasing'
import { createSupplierPo } from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'

const EMPTY_FORM: SupplierPoFormValues = {
  lessor_id: '',
  company_id: '',
  project_id: '',
  start_date: '',
  notes: '',
}

/**
 * «امر شراء جديد»: supplier (optional: none = an internal Al-Azani PO),
 * company, project, start date (today by default), notes. Saves through
 * `create_supplier_po` and hands the new id back; the 0136 tokens land on
 * their fields, anything else becomes one safe form message.
 */
export function CreateSupplierPoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (poId: string) => void
}) {
  const { t } = useI18n()
  const { loadLessors, loadCompanies, loadProjects } = useMovementFormOptions()
  const [form, setForm] = useState<SupplierPoFormValues>(EMPTY_FORM)
  const [options, setOptions] = useState<
    Record<'lessor' | 'company' | 'project', AsyncSearchSelectOption | null>
  >({ lessor: null, company: null, project: null })
  const [errors, setErrors] = useState<FieldErrors<SupplierPoFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY_FORM, start_date: saudiDateKey() })
    setOptions({ lessor: null, company: null, project: null })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [open])

  const update = (patch: Partial<SupplierPoFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateWithSchema(supplierPoFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await createSupplierPo(form)
    setSaving(false)
    if (!result.error && result.data) {
      onCreated(result.data)
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_CREATE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, SUPPLIER_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoNew')}
      description={t('supplierPoCreateDesc')}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('supplierPoCreate')}
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
          label={t('supplierPoSupplier')}
          name="lessor_id"
          hint={t('supplierPoSupplierHint')}
          error={errors.lessor_id && t(errors.lessor_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.lessor_id}
              selectedOption={options.lessor}
              placeholder={t('supplierPoSupplierPlaceholder')}
              loadOptions={loadLessors}
              onChange={(value, option) => {
                update({ lessor_id: value })
                setOptions((current) => ({ ...current, lessor: option }))
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('company')}
            name="company_id"
            required
            error={errors.company_id && t(errors.company_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.company_id}
                selectedOption={options.company}
                placeholder={t('selectCompany')}
                loadOptions={loadCompanies}
                onChange={(value, option) => {
                  update({ company_id: value })
                  setOptions((current) => ({ ...current, company: option }))
                }}
              />
            )}
          </Field>
          <Field
            label={t('project')}
            name="project_id"
            required
            error={errors.project_id && t(errors.project_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.project_id}
                selectedOption={options.project}
                placeholder={t('selectProject')}
                loadOptions={loadProjects}
                onChange={(value, option) => {
                  update({ project_id: value })
                  setOptions((current) => ({ ...current, project: option }))
                }}
              />
            )}
          </Field>
        </div>
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
