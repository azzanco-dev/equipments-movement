export interface ExtractionPublishData {
  full_name_ar: string
  full_name_en: string
  id_number: string
  date_of_birth: string
  residence_expiry_date: string
  nationality: string
  occupation: string
  email: string
  gender: string
  mobile_number: string
  employment_type: string
  company: string
  date_of_joining: string
  department: string
  ctc: string
  employee_number: string
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
  details?: string
}

const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePublishDate(value: unknown): string {
  const text = clean(value).replace(/[/.]/g, '-').replace(/\s+/g, '')
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
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
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
  const rawBirthDate = clean(source.date_of_birth)
  const rawExpiryDate = clean(source.residence_expiry_date)
  const rawJoiningDate = clean(source.date_of_joining)
  const data: ExtractionPublishData = {
    full_name_ar: clean(source.full_name_ar),
    full_name_en: clean(source.full_name_en),
    id_number: clean(source.id_number),
    date_of_birth: normalizePublishDate(rawBirthDate),
    residence_expiry_date: normalizePublishDate(rawExpiryDate),
    nationality: clean(source.nationality),
    occupation: clean(source.occupation),
    email: clean(source.email).toLowerCase(),
    gender: clean(source.gender),
    mobile_number: clean(source.mobile_number),
    employment_type: clean(source.employment_type),
    company: clean(source.company),
    date_of_joining: normalizePublishDate(rawJoiningDate),
    department: clean(source.department),
    ctc: clean(source.ctc),
    employee_number: clean(source.employee_number) || clean(source.id_number),
  }
  const targets = {
    currentSystem: targetSource.currentSystem === true,
    erpnext: targetSource.erpnext === true,
  }
  if (!targets.currentSystem && !targets.erpnext) return null
  if (!data.full_name_ar || !/^\d{5,20}$/.test(data.id_number)) return null
  if (
    (rawBirthDate && !data.date_of_birth) ||
    (rawExpiryDate && !data.residence_expiry_date) ||
    (rawJoiningDate && !data.date_of_joining)
  )
    return null
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null
  if (data.mobile_number && !/^\+?\d{7,15}$/.test(data.mobile_number))
    return null
  if (data.ctc && !/^\d+(?:\.\d{1,2})?$/.test(data.ctc)) return null
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

function cleanErpMessage(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/token\s+[^\s:]+:[^\s]+/gi, 'token [محجوب]')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectServerMessages(value: unknown, messages: string[], depth = 0) {
  if (depth > 5 || messages.length >= 5) return
  if (typeof value === 'string') {
    try {
      collectServerMessages(JSON.parse(value), messages, depth + 1)
    } catch {
      const cleaned = cleanErpMessage(value)
      if (cleaned) messages.push(cleaned)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectServerMessages(item, messages, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string')
    collectServerMessages(record.message, messages, depth + 1)
}

export function erpErrorDetails(
  payload: Record<string, unknown> | undefined,
  status: number,
) {
  const messages: string[] = []
  collectServerMessages(payload?._server_messages, messages)
  collectServerMessages(payload?.message, messages)
  if (!messages.length && typeof payload?.exc_type === 'string')
    messages.push(cleanErpMessage(payload.exc_type))
  const unique = Array.from(new Set(messages)).filter(Boolean)
  return (unique.join(' — ') || `ERPNext HTTP ${status}`).slice(0, 800)
}

export function configuredFieldName(
  value: string | undefined,
  fallback?: string,
): string | null {
  const fieldName = value?.trim() || fallback || ''
  return FIELD_NAME_PATTERN.test(fieldName) ? fieldName : null
}

function availableFieldName(
  availableFields: ReadonlySet<string> | undefined,
  configured: string | undefined,
  fallback: string,
): string | null {
  const preferred = configuredFieldName(configured)
  if (preferred && (!availableFields || availableFields.has(preferred)))
    return preferred
  return !availableFields || availableFields.has(fallback) ? fallback : null
}

export function erpEmployeePayload(
  data: ExtractionPublishData,
  availableFields?: ReadonlySet<string>,
) {
  const payload: Record<string, string> = {
    first_name: data.full_name_ar,
    user_id: data.email,
    status: 'Active',
  }
  const optional: Array<[string, string]> = [
    ['gender', data.gender],
    ['date_of_birth', data.date_of_birth],
    ['date_of_joining', data.date_of_joining],
    ['company', data.company],
    ['employment_type', data.employment_type],
    ['department', data.department],
    ['designation', data.occupation],
    ['cell_number', data.mobile_number],
    ['ctc', data.ctc],
    ['employee_number', data.employee_number || data.id_number],
  ]
  for (const [key, value] of optional) if (value) payload[key] = value

  const nationalityField = availableFieldName(
    availableFields,
    process.env.ERPNEXT_NATIONALITY_FIELD,
    'custom_nationality',
  )
  if (nationalityField && data.nationality)
    payload[nationalityField] = data.nationality

  const customFields: Array<[string | null, string]> = [
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_EMPLOYEE_NAME_EN_FIELD,
        'custom_employee_name_en',
      ),
      data.full_name_en,
    ],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
        'custom_residence_permit_number',
      ),
      data.id_number,
    ],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD,
        'custom_rp_valid_upto',
      ),
      data.residence_expiry_date,
    ],
  ]
  for (const [field, fieldValue] of customFields)
    if (field && fieldValue) payload[field] = fieldValue
  return payload
}
