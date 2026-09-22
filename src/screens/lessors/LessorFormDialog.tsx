import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
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
    const result = lessor
      ? await supabase.from('lessors').update(payload).eq('id', lessor.id)
      : await supabase.from('lessors').insert(payload)
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
      title={lessor ? t('editLessor') : t('addLessor')}
      description={t('dialogDescLessorForm')}
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
