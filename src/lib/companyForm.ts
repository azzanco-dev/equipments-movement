import type { Company } from '@/lib/types'
import {
  companyFormSchema,
  mapDatabaseErrorToField,
  validateWithSchema,
  type DatabaseFieldRule,
  type FieldErrors,
  type PostgresLikeError,
} from '@/lib/formValidation'
import {
  optionalTextOrNull,
  partySharedDatabaseRules,
  partySharedFormValues,
  partySharedPayload,
} from '@/lib/partyFields'

/** Values held by the company add/edit dialog. */
export interface CompanyFormValues {
  name_ar: string
  name_en: string
  /** EM-260 (migration 0175): the official and contact details. */
  tax_number: string
  commercial_register: string
  address: string
  /** 0179: the short national address, «RRRD2929». */
  short_address: string
  contact_person: string
  contact_number: string
  email: string
}

export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name_ar: '',
  name_en: '',
  tax_number: '',
  commercial_register: '',
  address: '',
  short_address: '',
  contact_person: '',
  contact_number: '',
  email: '',
}

/** Maps an existing record onto the form values. */
export function companyFormValues(company: Company): CompanyFormValues {
  return {
    name_ar: company.name_ar,
    name_en: company.name_en,
    ...partySharedFormValues(company),
    contact_person: company.contact_person ?? '',
    contact_number: company.contact_number ?? '',
  }
}

/** The order the fields appear in, used to focus the first invalid one:
 *  the names, «بيانات رسمية», then «بيانات الاتصال». */
export const COMPANY_FIELD_ORDER = [
  'name_ar',
  'name_en',
  'tax_number',
  'commercial_register',
  'address',
  'short_address',
  'contact_person',
  'contact_number',
  'email',
] as const

/** Both names are `NOT NULL` in the database, so both are mandatory here;
 *  the 0175 fields are optional with their shapes. */
export function validateCompanyForm(
  form: CompanyFormValues,
): FieldErrors<CompanyFormValues> {
  return validateWithSchema(companyFormSchema, form)
}

/**
 * Database rejections of a company save, by field: `companies` is unique on
 * `lower(name_ar)` / `lower(name_en)` (0009) and, since 0175, on the tax
 * number and the CR; the 0175 CHECKs cover the shapes and lengths.
 */
export const COMPANY_DATABASE_RULES: readonly DatabaseFieldRule<CompanyFormValues>[] =
  [
    { on: 'unique', match: 'name_ar', field: 'name_ar', key: 'duplicateCompany' },
    { on: 'unique', match: 'name_en', field: 'name_en', key: 'duplicateCompany' },
    ...partySharedDatabaseRules<CompanyFormValues>('companies', {
      tax_number: 'taxNumberExistsCompany',
      commercial_register: 'commercialRegisterExistsCompany',
    }),
    {
      on: 'check',
      match: 'companies_contact_person_check',
      field: 'contact_person',
      key: 'contactPersonTooLong',
    },
    {
      on: 'check',
      match: 'companies_contact_number_check',
      field: 'contact_number',
      key: 'contactNumberTooLong',
    },
  ]

/** The field errors of a known database rejection, or `null` (the dialog
 *  then shows its safe top-level message). */
export function companySaveFieldErrors(
  error: PostgresLikeError | null | undefined,
): FieldErrors<CompanyFormValues> | null {
  return mapDatabaseErrorToField(error, COMPANY_DATABASE_RULES)
}

/** Insert/update payload for the `companies` table (normalised like the
 *  0175 trigger, so what the form validated is what is stored). */
export function buildCompanyPayload(form: CompanyFormValues) {
  return {
    name_ar: form.name_ar.trim(),
    name_en: form.name_en.trim(),
    ...partySharedPayload(form),
    contact_person: optionalTextOrNull(form.contact_person),
    contact_number: optionalTextOrNull(form.contact_number),
  }
}
