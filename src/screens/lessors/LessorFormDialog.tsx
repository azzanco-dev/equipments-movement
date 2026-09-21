import { useEffect, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_LESSOR_FORM,
  buildLessorPayload,
  lessorFormValues,
  validateLessorForm,
  type LessorFormValues,
} from '@/lib/lessorForm'
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

  useEffect(() => {
    if (!open) return
    setForm(lessor ? lessorFormValues(lessor) : EMPTY_LESSOR_FORM)
    setError(null)
  }, [open, lessor])

  const save = async () => {
    const invalid = validateLessorForm(form)
    if (invalid) {
      setError(t(invalid))
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
      <div className="space-y-4">
        {error && <ErrorState title={error} className="p-4" />}
        <Field label={t('lessorName')} required>
          {(control) => (
            <Input
              {...control}
              placeholder={t('lessorNamePlaceholder')}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('contactPerson')}>
          {(control) => (
            <Input
              {...control}
              placeholder={t('contactPersonPlaceholder')}
              value={form.contact_person}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contact_person: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('contactNumber')}>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('contactNumberPlaceholder')}
              value={form.contact_number}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contact_number: event.target.value,
                }))
              }
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
