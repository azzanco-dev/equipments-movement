import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  useConfirm,
} from '@/components/ui'
import {
  CHANGED_CONTROL_CLASS,
  ChangedLabel,
} from '@/components/parties/changedField'
import {
  PartyFormSection,
  type PartyFieldSpec,
} from '@/components/parties/PartyFormSection'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import {
  companiesProjectsActions,
  refusedByPolicy,
} from '@/lib/actionPermissions'
import { changedFields } from '@/lib/formChanges'
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

/** EM-260 (0175): «بيانات رسمية», then «بيانات الاتصال». */
const OFFICIAL_FIELDS: readonly PartyFieldSpec<CompanyFormValues>[] = [
  {
    field: 'tax_number',
    label: 'taxNumber',
    placeholder: 'taxNumberPlaceholder',
    ltr: true,
    inputMode: 'numeric',
  },
  {
    field: 'commercial_register',
    label: 'commercialRegister',
    placeholder: 'commercialRegisterPlaceholder',
    ltr: true,
    inputMode: 'numeric',
  },
  // Owner 2026-11-05 «شيل المدينة, العنوان خليه العنوان الكامل»: no city
  // field (the column and its stored value stay, saved back unchanged).
  // 0179: the short national address, split «RRRD | 2929».
  {
    field: 'short_address',
    label: 'shortAddress',
    control: 'shortAddress',
  },
  {
    field: 'address',
    label: 'address',
    placeholder: 'addressPlaceholder',
    wide: true,
  },
]
const CONTACT_FIELDS: readonly PartyFieldSpec<CompanyFormValues>[] = [
  {
    field: 'contact_person',
    label: 'contactPerson',
    placeholder: 'contactPersonPlaceholder',
  },
  {
    field: 'contact_number',
    label: 'contactNumber',
    placeholder: 'contactNumberPlaceholder',
    ltr: true,
    type: 'tel',
  },
  {
    field: 'email',
    label: 'email',
    placeholder: 'partyEmailPlaceholder',
    ltr: true,
    type: 'email',
    wide: true,
  },
]

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
  // Adding and editing need `companies_projects.edit` (the row policies
  // re-check it): without the key the dialog offers no save.
  const canSave = companiesProjectsActions(usePermissions()).edit
  const notAllowed = t('companiesProjectsSaveNotAllowed')
  const [form, setForm] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM)
  // The values the dialog opened with, to tell the user what is unsaved.
  const [initial, setInitial] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM)
  const { confirm, confirmDialog } = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<CompanyFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const start = company ? companyFormValues(company) : EMPTY_COMPANY_FORM
    setForm(start)
    setInitial(start)
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
    if (!canSave) {
      setError(notAllowed)
      return
    }
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
    // Without the key an update matches no row and PostgREST answers with no
    // error, so the returned rows are read: none back is a refusal.
    const result = company
      ? await supabase
          .from('companies')
          .update(payload)
          .eq('id', company.id)
          .select('id')
      : await supabase.from('companies').insert(payload).select('id')
    setSaving(false)
    if (refusedByPolicy(result.error, result.data)) {
      setError(notAllowed)
      return
    }
    if (result.error) {
      // A duplicate name or 0175 value belongs on its field; anything else
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

  const shownError = error ?? (canSave ? null : notAllowed)

  // Owner 2026-11-05 («اعتمد التعديلات هذي للشركات»): as the supplier form —
  // the unsaved count beside save, each changed field in light blue until
  // saved, «حفظ التغييرات» only after a change, and ask before discarding.
  const changedSet = new Set<string>(changedFields(initial, form))
  const changed = changedSet.size
  const dirty = changed > 0

  const requestClose = async () => {
    if (
      dirty &&
      canSave &&
      !(await confirm({
        title: t('unsavedChanges'),
        description: t('dialogDescUnsavedChanges'),
        tone: 'danger',
      }))
    )
      return
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
      title={company ? t('editCompany') : t('addCompany')}
      description={t('dialogDescCompanyForm')}
      size="lg"
      footer={
        <>
          {canSave && dirty && (
            <span
              role="status"
              className="me-auto flex items-center gap-2 self-center text-sm font-medium text-[var(--warning)]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]"
              />
              {t('unsavedFieldsCount').replace('{count}', String(changed))}
            </span>
          )}
          <Button variant="outline" onClick={() => void requestClose()}>
            {t('cancel')}
          </Button>
          {canSave && (
            <Button
              variant="primary"
              loading={saving}
              disabled={!!company && !dirty}
              onClick={save}
            >
              {company ? t('saveChanges') : t('save')}
            </Button>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {shownError && <ErrorState title={shownError} className="p-4" />}
        <Field
          label={
            <ChangedLabel
              label={t('companyNameAr')}
              changed={changedSet.has('name_ar')}
            />
          }
          name="name_ar"
          required
          error={errors.name_ar && t(errors.name_ar)}
        >
          {(control) => (
            <Input
              {...control}
              dir="rtl"
              className={
                changedSet.has('name_ar') ? CHANGED_CONTROL_CLASS : undefined
              }
              placeholder={t('companyNameArPlaceholder')}
              value={form.name_ar}
              onChange={(event) => update({ name_ar: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={
            <ChangedLabel
              label={t('companyNameEn')}
              changed={changedSet.has('name_en')}
            />
          }
          name="name_en"
          required
          error={errors.name_en && t(errors.name_en)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              className={
                changedSet.has('name_en') ? CHANGED_CONTROL_CLASS : undefined
              }
              placeholder={t('companyNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) => update({ name_en: event.target.value })}
            />
          )}
        </Field>
        <PartyFormSection
          title="partyOfficialSection"
          fields={OFFICIAL_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          changed={changedSet}
        />
        <PartyFormSection
          title="partyContactSection"
          fields={CONTACT_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          changed={changedSet}
        />
      </div>
      {confirmDialog}
    </Dialog>
  )
}
