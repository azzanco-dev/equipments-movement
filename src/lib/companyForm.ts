import type { Company } from '@/lib/types'
import {
  duplicateFieldErrors,
  fieldErrors,
  required,
  type FieldErrors,
} from '@/lib/formValidation'

/** Values held by the company add/edit dialog. */
export interface CompanyFormValues {
  name_ar: string
  name_en: string
}

export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name_ar: '',
  name_en: '',
}

/** Maps an existing record onto the form values. */
export function companyFormValues(company: Company): CompanyFormValues {
  return {
    name_ar: company.name_ar,
    name_en: company.name_en,
  }
}

/** The order the fields appear in, used to focus the first invalid one. */
export const COMPANY_FIELD_ORDER = ['name_ar', 'name_en'] as const

/** Both names are `NOT NULL` in the database, so both are mandatory here. */
export function validateCompanyForm(
  form: CompanyFormValues,
): FieldErrors<CompanyFormValues> {
  return fieldErrors<CompanyFormValues>({
    name_ar: required(form.name_ar, 'companyNameArRequired'),
    name_en: required(form.name_en, 'companyNameEnRequired'),
  })
}

/** `companies` is unique on `lower(name_ar)` and on `lower(name_en)`. */
export function companySaveFieldErrors(
  error: { code?: string | null; message?: string | null } | null | undefined,
): FieldErrors<CompanyFormValues> | null {
  return duplicateFieldErrors<CompanyFormValues>(error, [
    { match: 'name_ar', field: 'name_ar', key: 'duplicateCompany' },
    { match: 'name_en', field: 'name_en', key: 'duplicateCompany' },
  ])
}

/** Insert/update payload for the `companies` table. */
export function buildCompanyPayload(form: CompanyFormValues) {
  return {
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
  }
}
