import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import {
  PartyFormSection,
  type PartyFieldSpec,
} from '@/components/parties/PartyFormSection'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import { usePermissions } from '@/auth/PermissionsContext'
import { bankOptionLoader } from '@/lib/banks'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_LESSOR_FORM,
  LESSOR_FIELD_ORDER,
  buildLessorPayload,
  lessorFormValues,
  lessorSaveFieldErrors,
  validateLessorForm,
  type LessorFormValues,
} from '@/lib/lessorForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type { Lessor } from '@/lib/types'

/** EM-260 (0175): «بيانات رسمية», then the contact details, then the bank. */
const OFFICIAL_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
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
  { field: 'city', label: 'city', placeholder: 'cityPlaceholder' },
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
const CONTACT_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
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
/** The bank itself is picked from the banks list (0177), above the IBAN. */
const BANK_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
  { field: 'iban', label: 'iban', placeholder: 'ibanPlaceholder', ltr: true },
]

export interface LessorFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new lessor; a record edits it. */
  lessor: Lessor | null
  onSaved: () => void
}

export function LessorFormDialog({
  open,
  onOpenChange,
  lessor,
  onSaved,
}: LessorFormDialogProps) {
  const { t } = useI18n()
  // Adding and editing need `lessors.edit` (the row policies re-check it):
  // without the key the dialog offers no save.
  const canSave = lessorsActions(usePermissions()).edit
  const notAllowed = t('lessorSaveNotAllowed')
  const [form, setForm] = useState<LessorFormValues>(EMPTY_LESSOR_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<LessorFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const loadBanks = useMemo(() => bankOptionLoader(supabase), [])

  useEffect(() => {
    if (!open) return
    setForm(lessor ? lessorFormValues(lessor) : EMPTY_LESSOR_FORM)
    setError(null)
    setErrors({})
  }, [open, lessor])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<LessorFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof LessorFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (!canSave) {
      setError(notAllowed)
      return
    }
    const invalid = validateLessorForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, LESSOR_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildLessorPayload(form)
    // Without the key an update matches no row and PostgREST answers with no
    // error, so the returned rows are read: none back is a refusal.
    const result = lessor
      ? await supabase
          .from('lessors')
          .update(payload)
          .eq('id', lessor.id)
          .select('id')
      : await supabase.from('lessors').insert(payload).select('id')
    setSaving(false)
    if (refusedByPolicy(result.error, result.data)) {
      setError(notAllowed)
      return
    }
    if (result.error) {
      // A duplicate or malformed 0175 value belongs on its field; anything
      // else stays a safe top-level message.
      const attributed = lessorSaveFieldErrors(result.error)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, LESSOR_FIELD_ORDER, {
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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={lessor ? t('editLessor') : t('addLessor')}
      description={t('dialogDescLessorForm')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {canSave && (
            <Button variant="primary" loading={saving} onClick={save}>
              {t('save')}
            </Button>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {shownError && <ErrorState title={shownError} className="p-4" />}
        <Field
          label={t('lessorName')}
          name="name"
          required
          error={errors.name && t(errors.name)}
        >
          {(control) => (
            <Input
              {...control}
              placeholder={t('lessorNamePlaceholder')}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          )}
        </Field>
        <PartyFormSection
          title="partyOfficialSection"
          fields={OFFICIAL_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
        />
        <PartyFormSection
          title="partyContactSection"
          fields={CONTACT_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
        />
        <PartyFormSection
          title="partyBankSection"
          fields={BANK_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          leading={
            <Field
              label={t('bankName')}
              name="bank_name"
              error={errors.bank_name && t(errors.bank_name)}
            >
              {(control) => (
                <AsyncSearchSelect
                  {...control}
                  size="md"
                  menuSide="top"
                  value={form.bank_name}
                  selectedOption={
                    form.bank_name
                      ? { value: form.bank_name, label: form.bank_name }
                      : null
                  }
                  onChange={(value) => update({ bank_name: value })}
                  loadOptions={loadBanks}
                  placeholder={t('bankNamePlaceholder')}
                />
              )}
            </Field>
          }
        />
      </div>
    </Dialog>
  )
}
