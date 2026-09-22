import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  COMPANY_FIELD_ORDER,
  EMPTY_COMPANY_FORM,
  buildCompanyPayload,
  companyFormValues,
  companySaveFieldErrors,
  validateCompanyForm,
  type CompanyFormValues,
} from '@/lib/companyForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type { Company } from '@/lib/types'

export interface CompanyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new company; a record edits it. */
  company: Company | null
  onSaved: () => void
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: CompanyFormDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<CompanyFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(company ? companyFormValues(company) : EMPTY_COMPANY_FORM)
    setError(null)
    setErrors({})
  }, [open, company])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<CompanyFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof CompanyFormValues)[],
      ),
    )
  }

  const save = async () => {
    const invalid = validateCompanyForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, COMPANY_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildCompanyPayload(form)
    const result = company
      ? await supabase.from('companies').update(payload).eq('id', company.id)
      : await supabase.from('companies').insert(payload)
    setSaving(false)
    if (result.error) {
      // A duplicate name belongs on the name that caused it; anything else
      // stays a safe top-level message.
      const attributed = companySaveFieldErrors(result.error)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, COMPANY_FIELD_ORDER, {
          root: bodyRef.current,
        })
        return
      }
      setError(t('saveFailed'))
      return
    }
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={company ? t('editCompany') : t('addCompany')}
      description={t('dialogDescCompanyForm')}
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
        {error && <ErrorState title={error} className="p-4" />}
        <Field
          label={t('companyNameAr')}
          name="name_ar"
          required
          error={errors.name_ar && t(errors.name_ar)}
        >
          {(control) => (
            <Input
              {...control}
              dir="rtl"
              placeholder={t('companyNameArPlaceholder')}
              value={form.name_ar}
              onChange={(event) => update({ name_ar: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('companyNameEn')}
          name="name_en"
          required
          error={errors.name_en && t(errors.name_en)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('companyNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) => update({ name_en: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
