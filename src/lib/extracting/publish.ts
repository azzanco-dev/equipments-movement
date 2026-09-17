export interface ExtractionPublishData {
  full_name_ar: string
  full_name_en: string
  id_number: string
  date_of_birth: string
  residence_expiry_date: string
  nationality: string
  occupation: string
  employer_name: string
  email: string
  gender: string
  mobile_number: string
  employment_type: string
  company: string
  date_of_joining: string
  department: string
}

export interface ExtractionPublishTargets {
  currentSystem: boolean
  erpnext: boolean
}

export type PublishStatus =
  'created' | 'existing' | 'partial' | 'skipped' | 'failed'

export interface TargetPublishResult {
  status: PublishStatus
  id?: string
  userId?: string
  employeeId?: string
  steps?: { user: PublishStatus; employee: PublishStatus }
  error?: string
}

const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parsePublishRequest(value: unknown): {
  data: ExtractionPublishData
  targets: ExtractionPublishTargets
} | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  const rawData = body.data
  const rawTargets = body.targets
  if (!rawData || typeof rawData !== 'object') return null
  if (!rawTargets || typeof rawTargets !== 'object') return null

  const source = rawData as Record<string, unknown>
  const targetSource = rawTargets as Record<string, unknown>
  const data: ExtractionPublishData = {
    full_name_ar: clean(source.full_name_ar),
    full_name_en: clean(source.full_name_en),
    id_number: clean(source.id_number),
    date_of_birth: clean(source.date_of_birth),
    residence_expiry_date: clean(source.residence_expiry_date),
    nationality: clean(source.nationality),
    occupation: clean(source.occupation),
    employer_name: clean(source.employer_name),
    email: clean(source.email).toLowerCase(),
    gender: clean(source.gender),
    mobile_number: clean(source.mobile_number),
    employment_type: clean(source.employment_type),
    company: clean(source.company),
    date_of_joining: clean(source.date_of_joining),
    department: clean(source.department),
  }
  const targets = {
    currentSystem: targetSource.currentSystem === true,
    erpnext: targetSource.erpnext === true,
  }
  if (!targets.currentSystem && !targets.erpnext) return null
  if (!data.full_name_ar || !/^\d{5,20}$/.test(data.id_number)) return null
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null
  if (data.mobile_number && !/^\+?\d{7,15}$/.test(data.mobile_number))
    return null
  return { data, targets }
}

export function currentSystemDriverPayload(data: ExtractionPublishData) {
  return {
    full_name: data.full_name_ar,
    name_en: data.full_name_en || null,
    id_number: data.id_number,
    mobile_number: data.mobile_number || null,
    nationality: data.nationality || null,
    employment_type: data.employment_type || null,
    job_title: data.occupation || null,
  }
}

export function configuredFieldName(
  value: string | undefined,
  fallback?: string,
): string | null {
  const fieldName = value?.trim() || fallback || ''
  return FIELD_NAME_PATTERN.test(fieldName) ? fieldName : null
}

export function erpUserPayload(data: ExtractionPublishData) {
  return {
    email: data.email,
    first_name: data.full_name_ar,
    username: data.id_number,
    language: 'ar',
    enabled: 1,
    send_welcome_email: 0,
    role_profile_name: process.env.ERPNEXT_DRIVER_ROLE_PROFILE || 'Driver',
    module_profile: process.env.ERPNEXT_DRIVER_MODULE_PROFILE || 'Employee',
    ...(data.date_of_birth ? { birth_date: data.date_of_birth } : {}),
    ...(data.gender ? { gender: data.gender } : {}),
    ...(data.mobile_number
      ? { mobile_no: data.mobile_number, phone: data.mobile_number }
      : {}),
  }
}

export function erpEmployeePayload(data: ExtractionPublishData) {
  const payload: Record<string, string> = {
    first_name: data.full_name_ar,
    user_id: data.email,
    status: 'Active',
  }
  const optional: Array<[string, string]> = [
    ['gender', data.gender],
    ['nationality', data.nationality],
    ['date_of_birth', data.date_of_birth],
    ['date_of_joining', data.date_of_joining],
    ['company', data.company],
    ['employment_type', data.employment_type],
    ['department', data.department],
    ['designation', data.occupation],
    ['cell_number', data.mobile_number],
  ]
  for (const [key, value] of optional) if (value) payload[key] = value

  const customFields: Array<[string | null, string]> = [
    [
      configuredFieldName(
        process.env.ERPNEXT_EMPLOYEE_NAME_EN_FIELD,
        'custom_employee_name_en',
      ),
      data.full_name_en,
    ],
    [
      configuredFieldName(
        process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
        'custom_residence_permit_number',
      ),
      data.id_number,
    ],
    [
      configuredFieldName(process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD),
      data.residence_expiry_date,
    ],
    [
      configuredFieldName(process.env.ERPNEXT_EMPLOYER_NAME_FIELD),
      data.employer_name,
    ],
  ]
  for (const [field, fieldValue] of customFields)
    if (field && fieldValue) payload[field] = fieldValue
  return payload
}
