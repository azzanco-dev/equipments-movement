import { useEffect, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_PROJECT_FORM,
  buildProjectPayload,
  projectFormValues,
  validateProjectForm,
  type ProjectFormValues,
} from '@/lib/projectForm'
import type { Project } from '@/lib/types'

export interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new project; a record edits it. */
  project: Project | null
  onSaved: () => void
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: ProjectFormDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<ProjectFormValues>(EMPTY_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(project ? projectFormValues(project) : EMPTY_PROJECT_FORM)
    setError(null)
  }, [open, project])

  const save = async () => {
    const invalid = validateProjectForm(form)
    if (invalid) {
      setError(t(invalid))
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildProjectPayload(form)
    const result = project
      ? await supabase.from('projects').update(payload).eq('id', project.id)
      : await supabase.from('projects').insert(payload)
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
      title={project ? t('editProject') : t('addProject')}
      description={t('dialogDescProjectForm')}
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
        <Field label={t('projectNameAr')} required>
          {(control) => (
            <Input
              {...control}
              dir="rtl"
              placeholder={t('projectNameArPlaceholder')}
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
        <Field label={t('projectNameEn')} required>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('projectNameEnPlaceholder')}
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
