import type { Project } from '@/lib/types'
import {
  duplicateFieldErrors,
  fieldErrors,
  required,
  type FieldErrors,
} from '@/lib/formValidation'

/** Values held by the project add/edit dialog. */
export interface ProjectFormValues {
  name_ar: string
  name_en: string
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name_ar: '',
  name_en: '',
}

/** Maps an existing record onto the form values. */
export function projectFormValues(project: Project): ProjectFormValues {
  return {
    name_ar: project.name_ar,
    name_en: project.name_en,
  }
}

/** The order the fields appear in, used to focus the first invalid one. */
export const PROJECT_FIELD_ORDER = ['name_ar', 'name_en'] as const

/** Both names are `NOT NULL` in the database, so both are mandatory here. */
export function validateProjectForm(
  form: ProjectFormValues,
): FieldErrors<ProjectFormValues> {
  return fieldErrors<ProjectFormValues>({
    name_ar: required(form.name_ar, 'projectNameArRequired'),
    name_en: required(form.name_en, 'projectNameEnRequired'),
  })
}

/** A duplicate name is attributed to the name the database names. */
export function projectSaveFieldErrors(
  error: { code?: string | null; message?: string | null } | null | undefined,
): FieldErrors<ProjectFormValues> | null {
  return duplicateFieldErrors<ProjectFormValues>(error, [
    { match: 'name_ar', field: 'name_ar', key: 'duplicateProject' },
    { match: 'name_en', field: 'name_en', key: 'duplicateProject' },
  ])
}

/** Insert/update payload for the `projects` table. */
export function buildProjectPayload(form: ProjectFormValues) {
  return {
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
  }
}
