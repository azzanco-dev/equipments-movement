import { useI18n } from '@/i18n/I18nContext'
import { Button, Field, Input } from '@/components/ui'
import type { FieldErrors } from '@/lib/formValidation'
import type { QuickDriverFormValues } from '@/lib/driverForm'

export interface QuickDriverDraft {
  open: boolean
  fullName: string
  mobile: string
}

export const EMPTY_QUICK_DRIVER: QuickDriverDraft = {
  open: false,
  fullName: '',
  mobile: '',
}

export interface QuickDriverFormProps {
  value: QuickDriverDraft
  onChange: (value: QuickDriverDraft) => void
  /** Per-field messages, set on save only. */
  errors?: FieldErrors<QuickDriverFormValues>
  saving: boolean
  onCancel: () => void
  onSave: () => void
}

/**
 * Inline quick-create for a driver. Quick Create intentionally requires the
 * full name and the mobile number, and creates a real driver record.
 */
export function QuickDriverForm({
  value,
  onChange,
  errors,
  saving,
  onCancel,
  onSave,
}: QuickDriverFormProps) {
  const { t } = useI18n()
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="font-semibold">{t('quickDriverAdd')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('fullName')}
          name="fullName"
          required
          error={errors?.fullName && t(errors.fullName)}
        >
          {(control) => (
            <Input
              {...control}
              placeholder={t('fullNamePlaceholder')}
              value={value.fullName}
              onChange={(event) =>
                onChange({ ...value, fullName: event.target.value })
              }
            />
          )}
        </Field>
        <Field
          label={t('mobileNumber')}
          name="mobile"
          required
          error={errors?.mobile && t(errors.mobile)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('mobileNumberPlaceholder')}
              value={value.mobile}
              onChange={(event) =>
                onChange({
                  ...value,
                  mobile: event.target.value.replace(/[^\d+]/g, ''),
                })
              }
            />
          )}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          loading={saving}
          onClick={onSave}
        >
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
}
