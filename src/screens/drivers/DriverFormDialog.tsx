import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  Select,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  DRIVER_EMPLOYMENT_TYPES,
  DRIVER_NATIONALITIES,
} from '@/lib/driverExcel'
import {
  DRIVER_FIELD_ORDER,
  EMPTY_DRIVER_FORM,
  buildDriverPayload,
  driverFormValues,
  driverSaveFieldErrors,
  sanitizeIdNumber,
  sanitizeMobileNumber,
  validateDriverForm,
  type DriverFormValues,
} from '@/lib/driverForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type { Driver } from '@/lib/types'

/** Radix reserves '' for "no value", so the optional selects use a sentinel. */
const NONE = 'none'

const optionsWithNone = (values: readonly string[]) => [
  { value: NONE, label: '—' },
  ...values.map((value) => ({ value, label: value })),
]

export interface DriverFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new driver; a record edits it. */
  driver: Driver | null
  onSaved: () => void
}

export function DriverFormDialog({
  open,
  onOpenChange,
  driver,
  onSaved,
}: DriverFormDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<DriverFormValues>(EMPTY_DRIVER_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<DriverFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(driver ? driverFormValues(driver) : EMPTY_DRIVER_FORM)
    setError(null)
    setErrors({})
  }, [open, driver])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<DriverFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof DriverFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateDriverForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, DRIVER_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildDriverPayload(form)
    const result = driver
      ? await supabase.from('drivers').update(payload).eq('id', driver.id)
      : await supabase.from('drivers').insert(payload)
    setSaving(false)
    if (result.error) {
      // A duplicate mobile or id number belongs on that field; anything the
      // database does not name stays a safe top-level message.
      const attributed = driverSaveFieldErrors(result.error)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, DRIVER_FIELD_ORDER, {
          root: bodyRef.current,
        })
        return
      }
      setError(
        result.error.code === '23505' ? t('driverIdExists') : t('saveFailed'),
      )
      return
    }
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={driver ? t('editDriver') : t('addDriver')}
      description={t('dialogDescDriverForm')}
      size="md"
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
        {error && <ErrorState title={error} className="p-4" />}
        <Field
          label={t('fullName')}
          name="full_name"
          required
          error={errors.full_name && t(errors.full_name)}
        >
          {(control) => (
            <Input
              {...control}
              placeholder={t('fullNamePlaceholder')}
              value={form.full_name}
              onChange={(event) => update({ full_name: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('driverNameEn')} name="name_en">
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={150}
              placeholder={t('driverNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) => update({ name_en: event.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('idNumber')}
            name="id_number"
            error={errors.id_number && t(errors.id_number)}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="numeric"
                placeholder={t('idNumberPlaceholder')}
                value={form.id_number}
                onChange={(event) =>
                  update({ id_number: sanitizeIdNumber(event.target.value) })
                }
              />
            )}
          </Field>
          <Field
            label={t('mobileNumber')}
            name="mobile_number"
            error={errors.mobile_number && t(errors.mobile_number)}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="tel"
                placeholder={t('mobileNumberPlaceholder')}
                value={form.mobile_number}
                onChange={(event) =>
                  update({
                    mobile_number: sanitizeMobileNumber(event.target.value),
                  })
                }
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('nationality')} name="nationality">
            {(control) => (
              <Select
                {...control}
                value={form.nationality || NONE}
                onValueChange={(value) =>
                  update({ nationality: value === NONE ? '' : value })
                }
                options={optionsWithNone(DRIVER_NATIONALITIES)}
              />
            )}
          </Field>
          <Field label={t('employmentType')} name="employment_type">
            {(control) => (
              <Select
                {...control}
                value={form.employment_type || NONE}
                onValueChange={(value) =>
                  update({ employment_type: value === NONE ? '' : value })
                }
                options={optionsWithNone(DRIVER_EMPLOYMENT_TYPES)}
              />
            )}
          </Field>
        </div>
        <Field label={t('jobTitle')} name="job_title">
          {(control) => (
            <Input
              {...control}
              placeholder={t('jobTitlePlaceholder')}
              value={form.job_title}
              onChange={(event) => update({ job_title: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
