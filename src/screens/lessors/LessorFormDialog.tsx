import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_LESSOR_FORM,
  LESSOR_FIELD_ORDER,
  buildLessorPayload,
  lessorFormValues,
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
      size="sm"
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
        <Field
          label={t('lessorNameEn')}
          name="name_en"
          hint={t('lessorNameEnHint')}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={200}
              placeholder={t('lessorNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) => update({ name_en: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('contactPerson')} name="contact_person">
          {(control) => (
            <Input
              {...control}
              placeholder={t('contactPersonPlaceholder')}
              value={form.contact_person}
              onChange={(event) =>
                update({ contact_person: event.target.value })
              }
            />
          )}
        </Field>
        <Field label={t('contactNumber')} name="contact_number">
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('contactNumberPlaceholder')}
              value={form.contact_number}
              onChange={(event) =>
                update({ contact_number: event.target.value })
              }
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
