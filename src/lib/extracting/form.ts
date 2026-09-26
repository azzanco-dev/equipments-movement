// Shared by the extracting screen and its API routes, so the browser and the
// server validate the reviewed identity data with the same rules. Keep this
// module free of imports: the tests load it in an isolated VM.

export const EXTRACTION_FIELDS = [
  'full_name_ar',
  'full_name_en',
  'id_number',
  'date_of_birth',
  'residence_expiry_date',
  'nationality',
  'occupation',
  'email',
  'mobile_number',
  'gender',
  'language',
  'company',
  'employment_type',
  'department',
  'date_of_joining',
  'ctc',
  'employee_number',
] as const

export type ExtractionFieldKey = (typeof EXTRACTION_FIELDS)[number]
export type ExtractionForm = Record<ExtractionFieldKey, string>

export interface PublishTargets {
  currentSystem: boolean
  erpnext: boolean
}
export type PublishTarget = keyof PublishTargets

export type PublishStatus =
  'created' | 'existing' | 'partial' | 'skipped' | 'failed'

export interface TargetPublishResult {
  status: PublishStatus
  id?: string
  userId?: string
  employeeId?: string
  steps?: { user: PublishStatus; employee: PublishStatus }
  error?: string
  /** Sanitised ERPNext server message, shown as-is for diagnosis. */
  details?: string
}

export type PublishResults = Record<PublishTarget, TargetPublishResult>

export const DEFAULT_COMPANY = 'شركة عبدالله احمد العزاني للمقاولات'
export const DEFAULT_EMPLOYMENT_TYPE = 'نقدي'

/** Fields ERPNext needs before a user and employee can be created. */
export const ERP_REQUIRED_FIELDS = [
  'email',
  'gender',
  'nationality',
  'date_of_birth',
  'company',
  'date_of_joining',
] as const satisfies readonly ExtractionFieldKey[]

/** Visible dates are typed as DD-MM-YYYY; the API stores YYYY-MM-DD. */
export const DATE_FIELDS = [
  'date_of_birth',
  'residence_expiry_date',
  'date_of_joining',
] as const satisfies readonly ExtractionFieldKey[]

const ID_NUMBER_PATTERN = /^\d{5,20}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_PATTERN = /^\+?\d{7,15}$/
const CTC_PATTERN = /^\d+(?:\.\d{1,2})?$/

export type FieldErrorCode =
  | 'required'
  | 'invalid_id_number'
  | 'invalid_email'
  | 'invalid_mobile'
  | 'invalid_ctc'
  | 'invalid_date'
  | 'invalid_language'

export type FieldErrors = Partial<Record<ExtractionFieldKey, FieldErrorCode>>

/** Converts DD-MM-YYYY or YYYY-MM-DD to YYYY-MM-DD; '' when not a real date. */
export function toIsoDate(value: string): string {
  const text = value.trim().replace(/[/.]/g, '-').replace(/\s+/g, '')
  if (!text) return ''
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text)
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const year = Number(dmy?.[3] ?? iso?.[1])
  const month = Number(dmy?.[2] ?? iso?.[2])
  const day = Number(dmy?.[1] ?? iso?.[3])
  if (!year || !month || !day) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return ''
  const pad = (part: number, size: number) =>
    part.toString().padStart(size, '0')
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

export function isErpRequired(key: ExtractionFieldKey): boolean {
  return (ERP_REQUIRED_FIELDS as readonly ExtractionFieldKey[]).includes(key)
}

export function isFieldRequired(
  key: ExtractionFieldKey,
  targets: PublishTargets,
): boolean {
  return (
    key === 'full_name_ar' ||
    key === 'id_number' ||
    (targets.erpnext && isErpRequired(key))
  )
}

/**
 * Checks trimmed form values against the publish rules. An empty result means
 * the data can be sent; the API applies the same checks again.
 */
export function validateExtractionForm(
  data: ExtractionForm,
  targets: PublishTargets,
): FieldErrors {
  const errors: FieldErrors = {}
  for (const key of EXTRACTION_FIELDS)
    if (isFieldRequired(key, targets) && !data[key].trim())
      errors[key] = 'required'

  const check = (
    key: ExtractionFieldKey,
    valid: (value: string) => boolean,
    code: FieldErrorCode,
  ) => {
    const value = data[key].trim()
    if (value && !errors[key] && !valid(value)) errors[key] = code
  }
  check(
    'id_number',
    (value) => ID_NUMBER_PATTERN.test(value),
    'invalid_id_number',
  )
  check('email', (value) => EMAIL_PATTERN.test(value), 'invalid_email')
  check(
    'mobile_number',
    (value) => MOBILE_PATTERN.test(value),
    'invalid_mobile',
  )
  check('ctc', (value) => CTC_PATTERN.test(value), 'invalid_ctc')
  check(
    'language',
    (value) => value === 'ar' || value === 'en',
    'invalid_language',
  )
  for (const key of DATE_FIELDS)
    check(key, (value) => !!toIsoDate(value), 'invalid_date')
  return errors
}

/**
 * Applies a patch to the form. The employee number mirrors the identity
 * number until the admin types a different one.
 */
export function applyFormPatch(
  current: ExtractionForm,
  patch: Partial<ExtractionForm>,
): ExtractionForm {
  const next = { ...current, ...patch }
  const followsIdentity =
    !current.employee_number || current.employee_number === current.id_number
  if (
    patch.id_number !== undefined &&
    patch.employee_number === undefined &&
    followsIdentity
  )
    next.employee_number = next.id_number
  return next
}

/** Empty review form; `today` is the Saudi date as DD-MM-YYYY. */
export function createDefaultForm(today: string): ExtractionForm {
  const form = Object.fromEntries(
    EXTRACTION_FIELDS.map((key) => [key, '']),
  ) as ExtractionForm
  return {
    ...form,
    gender: 'Male',
    language: 'ar',
    company: DEFAULT_COMPANY,
    employment_type: DEFAULT_EMPLOYMENT_TYPE,
    date_of_joining: today,
  }
}
