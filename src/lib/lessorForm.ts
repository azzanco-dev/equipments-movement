import type { Lessor } from '@/lib/types'
import { fieldErrors, required, type FieldErrors } from '@/lib/formValidation'

/** Values held by the lessor add/edit dialog. */
export interface LessorFormValues {
  name: string
  contact_person: string
  contact_number: string
}

export const EMPTY_LESSOR_FORM: LessorFormValues = {
  name: '',
  contact_person: '',
  contact_number: '',
}

/** Maps an existing record onto the form values. */
export function lessorFormValues(lessor: Lessor): LessorFormValues {
  return {
    name: lessor.name,
    contact_person: lessor.contact_person ?? '',
    contact_number: lessor.contact_number ?? '',
  }
}

/** The order the fields appear in, used to focus the first invalid one. */
export const LESSOR_FIELD_ORDER = [
  'name',
  'contact_person',
  'contact_number',
] as const

/**
 * Only the name is mandatory; contact details are optional and stay
 * unvalidated, exactly as before.
 */
export function validateLessorForm(
  form: LessorFormValues,
): FieldErrors<LessorFormValues> {
  return fieldErrors<LessorFormValues>({
    name: required(form.name, 'lessorNameRequired'),
  })
}

/** Insert/update payload for the `lessors` table. */
export function buildLessorPayload(form: LessorFormValues) {
  return {
    name: form.name.trim(),
    contact_person: form.contact_person.trim() || null,
    contact_number: form.contact_number.trim() || null,
  }
}
