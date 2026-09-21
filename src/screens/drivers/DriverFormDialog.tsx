import { useEffect, useState } from 'react'
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
  EMPTY_DRIVER_FORM,
  buildDriverPayload,
  driverFormValues,
  sanitizeIdNumber,
  sanitizeMobileNumber,
  validateDriverForm,
  type DriverFormValues,
} from '@/lib/driverForm'
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

  useEffect(() => {
    if (!open) return
    setForm(driver ? driverFormValues(driver) : EMPTY_DRIVER_FORM)
    setError(null)
  }, [open, driver])

  const save = async () => {
    const invalid = validateDriverForm(form)
    if (invalid) {
      setError(t(invalid))
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
      <div className="space-y-4">
        {error && <ErrorState title={error} className="p-4" />}
        <Field label={t('fullName')} required>
          {(control) => (
            <Input
              {...control}
              placeholder={t('fullNamePlaceholder')}
              value={form.full_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  full_name: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('driverNameEn')}>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={150}
              placeholder={t('driverNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name_en: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('idNumber')}>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="numeric"
                placeholder={t('idNumberPlaceholder')}
                value={form.id_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    id_number: sanitizeIdNumber(event.target.value),
                  }))
                }
              />
            )}
          </Field>
          <Field label={t('mobileNumber')}>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="tel"
                placeholder={t('mobileNumberPlaceholder')}
                value={form.mobile_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mobile_number: sanitizeMobileNumber(event.target.value),
                  }))
                }
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('nationality')}>
            {(control) => (
              <Select
                {...control}
                value={form.nationality || NONE}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    nationality: value === NONE ? '' : value,
                  }))
                }
                options={optionsWithNone(DRIVER_NATIONALITIES)}
              />
            )}
          </Field>
          <Field label={t('employmentType')}>
            {(control) => (
              <Select
                {...control}
                value={form.employment_type || NONE}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    employment_type: value === NONE ? '' : value,
                  }))
                }
                options={optionsWithNone(DRIVER_EMPLOYMENT_TYPES)}
              />
            )}
          </Field>
        </div>
        <Field label={t('jobTitle')}>
          {(control) => (
            <Input
              {...control}
              placeholder={t('jobTitlePlaceholder')}
              value={form.job_title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  job_title: event.target.value,
                }))
              }
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
