import type { TranslationKey } from '@/i18n/translations'
import type { FieldErrors, PostgresLikeError } from '@/lib/formValidation'

/**
 * company-contacts (0204) — «الاشخاص المسؤولون»: the responsible persons of
 * a client company (owner 2026-11-19, «ابغى خيار اضافة بيانات شخص مسؤول
 * جديد, ويكون فيه تعيين له حسب الشركة وحسب المشروع, الاسم رقم التواصل
 * الايميل»). The pure side: the rows, the form's rules and the token map.
 * The reads and the two RPC wrappers live in `companyContactsData.ts`.
 *
 * A person belongs to ONE company and may be assigned to some projects (no
 * project = every project of the company). The projects are stored; the
 * screens list a client's persons by the company alone for now (owner: «في
 * قاعدة البيانات اضف اسناد الشركة والمشروع … لكن الفلتر يكون حسب الشركة
 * مبدئيا»). The company row's own single contact (0175) is separate.
 */

export const COMPANY_CONTACT_NAME_MAX = 120
export const COMPANY_CONTACT_NUMBER_MAX = 30
export const COMPANY_CONTACT_EMAIL_MAX = 120

/** The database's lenient email shape (0175, 0204). */
export const COMPANY_CONTACT_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface CompanyContactProject {
  id: string
  name_ar: string | null
  name_en: string | null
}

/** A `company_contacts` row with the projects it is assigned to. */
export interface CompanyContact {
  id: string
  company_id: string
  name: string
  contact_number: string | null
  email: string | null
  projects: CompanyContactProject[]
}

/** The values of the person's dialog (add and edit). */
export interface CompanyContactFormValues {
  name: string
  contact_number: string
  email: string
  /** Empty = every project of the company. */
  project_ids: string[]
}

export const EMPTY_COMPANY_CONTACT_FORM: CompanyContactFormValues = {
  name: '',
  contact_number: '',
  email: '',
  project_ids: [],
}

export const COMPANY_CONTACT_FIELD_ORDER: readonly (keyof CompanyContactFormValues)[] =
  ['name', 'contact_number', 'email', 'project_ids']

export function companyContactFormValuesOf(
  contact: CompanyContact,
): CompanyContactFormValues {
  return {
    name: contact.name,
    contact_number: contact.contact_number ?? '',
    email: contact.email ?? '',
    project_ids: contact.projects.map((project) => project.id),
  }
}

/** The form's messages before the save (the database re-checks each). */
export function companyContactFormErrors(
  values: CompanyContactFormValues,
): FieldErrors<CompanyContactFormValues> {
  const errors: FieldErrors<CompanyContactFormValues> = {}
  const name = values.name.trim()
  if (!name) errors.name = 'companyContactNameRequired'
  else if (name.length > COMPANY_CONTACT_NAME_MAX)
    errors.name = 'companyContactNameTooLong'
  if (values.contact_number.trim().length > COMPANY_CONTACT_NUMBER_MAX)
    errors.contact_number = 'companyContactNumberTooLong'
  const email = values.email.trim()
  if (
    email &&
    (email.length > COMPANY_CONTACT_EMAIL_MAX ||
      !COMPANY_CONTACT_EMAIL_PATTERN.test(email))
  )
    errors.email = 'companyContactEmailInvalid'
  return errors
}

/** A refusal of `save_company_contact` that belongs to a field. */
const FIELD_TOKENS: Readonly<
  Record<string, [keyof CompanyContactFormValues, TranslationKey]>
> = {
  invalid_name: ['name', 'companyContactNameRequired'],
  invalid_contact_number: ['contact_number', 'companyContactNumberTooLong'],
  invalid_email: ['email', 'companyContactEmailInvalid'],
  invalid_project: ['project_ids', 'companyContactErrProject'],
}

/** A refusal shown as the dialog's message. */
const MESSAGE_TOKENS: Readonly<Record<string, TranslationKey>> = {
  company_contacts_manage_required: 'companyContactErrManage',
  invalid_contact: 'companyContactErrNotFound',
  invalid_company: 'companyContactErrCompany',
}

/** The stable token of a raised refusal (its message), if it is one. */
function tokenOf(error: PostgresLikeError | null | undefined): string {
  return (error?.message ?? '').trim()
}

/**
 * What a refused write shows: the field's message, or the dialog's message.
 * An unknown error is the generic «تعذر الحفظ», never the raw text.
 */
export function companyContactErrorOutcome(
  error: PostgresLikeError | null | undefined,
):
  | { fieldErrors: FieldErrors<CompanyContactFormValues> }
  | { message: TranslationKey } {
  const token = tokenOf(error)
  const field = FIELD_TOKENS[token]
  if (field) return { fieldErrors: { [field[0]]: field[1] } }
  return { message: MESSAGE_TOKENS[token] ?? 'companyContactSaveFailed' }
}

/** «رقم التواصل · الايميل» of a person, the parts that hold a value. */
export function companyContactSummary(
  contact: Pick<CompanyContact, 'contact_number' | 'email'>,
): string[] {
  return [contact.contact_number, contact.email].filter(
    (part): part is string => Boolean(part && part.trim()),
  )
}
