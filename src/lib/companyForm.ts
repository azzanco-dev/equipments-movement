import type { TranslationKey } from '@/i18n/translations'
import type { Company } from '@/lib/types'

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

/** Both names are `NOT NULL` in the database, so both are mandatory here. */
export function validateCompanyForm(
  form: CompanyFormValues,
): TranslationKey | null {
  if (!form.name_ar.trim() || !form.name_en.trim())
    return 'companyValidationError'
  return null
}

/** Insert/update payload for the `companies` table. */
export function buildCompanyPayload(form: CompanyFormValues) {
  return {
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
  }
}
