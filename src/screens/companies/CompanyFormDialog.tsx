import { useEffect, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_COMPANY_FORM,
  buildCompanyPayload,
  companyFormValues,
  validateCompanyForm,
  type CompanyFormValues,
} from '@/lib/companyForm'
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

  useEffect(() => {
    if (!open) return
    setForm(company ? companyFormValues(company) : EMPTY_COMPANY_FORM)
    setError(null)
  }, [open, company])

  const save = async () => {
    const invalid = validateCompanyForm(form)
    if (invalid) {
      setError(t(invalid))
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
      <div className="space-y-4">
        {error && <ErrorState title={error} className="p-4" />}
        <Field label={t('companyNameAr')} required>
          {(control) => (
            <Input
              {...control}
              dir="rtl"
              placeholder={t('companyNameArPlaceholder')}
              value={form.name_ar}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name_ar: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('companyNameEn')} required>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('companyNameEnPlaceholder')}
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
      </div>
    </Dialog>
  )
}
