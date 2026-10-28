import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, ErrorState, Field, Input } from '@/components/ui'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import {
  companiesProjectsActions,
  refusedByPolicy,
} from '@/lib/actionPermissions'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_PROJECT_FORM,
  PROJECT_FIELD_ORDER,
  buildProjectPayload,
  projectFormValues,
  projectSaveFieldErrors,
  validateProjectForm,
  type ProjectFormValues,
} from '@/lib/projectForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
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
  // Adding and editing need `companies_projects.edit` (the row policies
  // re-check it): without the key the dialog offers no save.
  const canSave = companiesProjectsActions(usePermissions()).edit
  const notAllowed = t('companiesProjectsSaveNotAllowed')
  const [form, setForm] = useState<ProjectFormValues>(EMPTY_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<ProjectFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(project ? projectFormValues(project) : EMPTY_PROJECT_FORM)
    setError(null)
    setErrors({})
  }, [open, project])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<ProjectFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof ProjectFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (!canSave) {
      setError(notAllowed)
      return
    }
    const invalid = validateProjectForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, PROJECT_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildProjectPayload(form)
    // Without the key an update matches no row and PostgREST answers with no
    // error, so the returned rows are read: none back is a refusal.
    const result = project
      ? await supabase
          .from('projects')
          .update(payload)
          .eq('id', project.id)
          .select('id')
      : await supabase.from('projects').insert(payload).select('id')
    setSaving(false)
    if (refusedByPolicy(result.error, result.data)) {
      setError(notAllowed)
      return
    }
    if (result.error) {
      const attributed = projectSaveFieldErrors(result.error)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, PROJECT_FIELD_ORDER, {
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
      title={project ? t('editProject') : t('addProject')}
      description={t('dialogDescProjectForm')}
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
          label={t('projectNameAr')}
          name="name_ar"
          required
          error={errors.name_ar && t(errors.name_ar)}
        >
          {(control) => (
            <Input
              {...control}
              dir="rtl"
              placeholder={t('projectNameArPlaceholder')}
              value={form.name_ar}
              onChange={(event) => update({ name_ar: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('projectNameEn')}
          name="name_en"
          required
          error={errors.name_en && t(errors.name_en)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('projectNameEnPlaceholder')}
              value={form.name_en}
              onChange={(event) => update({ name_en: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
