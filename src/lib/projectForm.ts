import type { TranslationKey } from '@/i18n/translations'
import type { Project } from '@/lib/types'

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

/** Both names are `NOT NULL` in the database, so both are mandatory here. */
export function validateProjectForm(
  form: ProjectFormValues,
): TranslationKey | null {
  if (!form.name_ar.trim() || !form.name_en.trim())
    return 'projectValidationError'
  return null
}

/** Insert/update payload for the `projects` table. */
export function buildProjectPayload(form: ProjectFormValues) {
  return {
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
  }
}
