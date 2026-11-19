import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  COMPANY_CONTACT_EMAIL_MAX,
  COMPANY_CONTACT_FIELD_ORDER,
  COMPANY_CONTACT_NAME_MAX,
  COMPANY_CONTACT_NUMBER_MAX,
  companyContactErrorOutcome,
  companyContactFormErrors,
  companyContactFormValuesOf,
  EMPTY_COMPANY_CONTACT_FORM,
  type CompanyContact,
  type CompanyContactFormValues,
} from '@/lib/companyContacts'
import { saveCompanyContact } from '@/lib/companyContactsData'
import {
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'

/**
 * «اضافة شخص مسؤول» / «تعديل الشخص المسؤول» (migration 0204, owner
 * 2026-11-19): a responsible person of ONE client company — the name, the
 * contact number, the email. The form has NO projects field (owner
 * 2026-11-19, «شيل المشاريع, خليها مرتبطة باختياره للمشروع»): a NEW person
 * is assigned to `projectIds` (the project chosen in the quotation form;
 * none = every project of the company), and an edit keeps the projects the
 * person already has. Saved at once through
 * `save_company_contact` (`sales.manage` or `companies_projects.edit`), apart
 * from whatever form opened it: the quotation form (a new person, who then
 * becomes its «عناية») and the company form's «الاشخاص المسؤولون» section.
 * A refusal names its field or shows its message, never the raw error.
 */
export function CompanyContactFormDialog({
  open,
  onOpenChange,
  companyId,
  contact = null,
  projectIds = [],
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The company the person belongs to (it never changes). */
  companyId: string
  /** The person to edit; null adds a new one. */
  contact?: CompanyContact | null
  /** The projects a NEW person is assigned to (none = every project). */
  projectIds?: readonly string[]
  /** The saved person's id and values (as typed, trimmed by the database). */
  onSaved: (id: string, values: CompanyContactFormValues) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<CompanyContactFormValues>(
    EMPTY_COMPANY_CONTACT_FORM,
  )
  const [errors, setErrors] = useState<FieldErrors<CompanyContactFormValues>>(
    {},
  )
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(
      contact
        ? companyContactFormValuesOf(contact)
        : { ...EMPTY_COMPANY_CONTACT_FORM, project_ids: [...projectIds] },
    )
    setErrors({})
    setFormError(null)
    setSaving(false)
    // The person is read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (patch: Partial<CompanyContactFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(
        patch,
      ) as (keyof CompanyContactFormValues)[])
        delete next[key]
      return next
    })
  }

  async function save() {
    if (saving) return
    const invalid = companyContactFormErrors(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      focusFirstError(invalid, COMPANY_CONTACT_FIELD_ORDER, {
        root: formRef.current,
      })
      return
    }
    setSaving(true)
    setFormError(null)
    const result = await saveCompanyContact({
      id: contact?.id ?? null,
      companyId,
      values: form,
    })
    setSaving(false)
    if (result.error || !result.data) {
      const outcome = companyContactErrorOutcome(result.error)
      // No projects field to point at: its refusal is a form message.
      if ('fieldErrors' in outcome && outcome.fieldErrors.project_ids) {
        setFormError(outcome.fieldErrors.project_ids)
      } else if ('fieldErrors' in outcome) {
        setErrors(outcome.fieldErrors)
        focusFirstError(outcome.fieldErrors, COMPANY_CONTACT_FIELD_ORDER, {
          root: formRef.current,
        })
      } else setFormError(outcome.message)
      return
    }
    onSaved(result.data, form)
  }

  const fieldError = (field: keyof CompanyContactFormValues) =>
    errors[field] ? t(errors[field]) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={contact ? t('companyContactEditTitle') : t('companyContactAdd')}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('companyContactSave')}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="space-y-4">
        {formError && (
          <Notice tone="danger" size="compact">
            {t(formError)}
          </Notice>
        )}
        <Field
          label={t('companyContactName')}
          name="name"
          required
          error={fieldError('name')}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              maxLength={COMPANY_CONTACT_NAME_MAX}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('companyContactNumber')}
            name="contact_number"
            error={fieldError('contact_number')}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                maxLength={COMPANY_CONTACT_NUMBER_MAX}
                value={form.contact_number}
                onChange={(event) =>
                  update({ contact_number: event.target.value })
                }
              />
            )}
          </Field>
          <Field
            label={t('companyContactEmail')}
            name="email"
            error={fieldError('email')}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="email"
                autoComplete="off"
                maxLength={COMPANY_CONTACT_EMAIL_MAX}
                value={form.email}
                onChange={(event) => update({ email: event.target.value })}
              />
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
