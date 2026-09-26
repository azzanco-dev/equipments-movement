import {
  DATE_FIELDS,
  ERP_REQUIRED_FIELDS,
  EXTRACTION_FIELDS,
  toIsoDate,
  validateExtractionForm,
  type ExtractionForm,
  type PublishTargets,
} from './form'

export type {
  PublishStatus,
  TargetPublishResult,
  PublishTargets as ExtractionPublishTargets,
} from './form'

/** Reviewed data after server validation: trimmed, dates as YYYY-MM-DD. */
export type ExtractionPublishData = ExtractionForm & { language: 'ar' | 'en' }

const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePublishDate(value: unknown): string {
  return toIsoDate(clean(value))
}

/**
 * Validates the publish request body. ERPNext-only required fields are not
 * checked here: a missing one fails the ERPNext target alone (see
 * `missingErpFields`) so the current system can still be published.
 */
export function parsePublishRequest(value: unknown): {
  data: ExtractionPublishData
  targets: PublishTargets
} | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (!body.data || typeof body.data !== 'object') return null
  if (!body.targets || typeof body.targets !== 'object') return null

  const source = body.data as Record<string, unknown>
  const targetSource = body.targets as Record<string, unknown>
  const targets: PublishTargets = {
    currentSystem: targetSource.currentSystem === true,
    erpnext: targetSource.erpnext === true,
  }
  if (!targets.currentSystem && !targets.erpnext) return null

  const raw = Object.fromEntries(
    EXTRACTION_FIELDS.map((key) => [key, clean(source[key])]),
  ) as ExtractionForm
  raw.language ||= 'ar'
  const errors = validateExtractionForm(raw, {
    currentSystem: true,
    erpnext: false,
  })
  if (Object.keys(errors).length) return null

  const data = {
    ...raw,
    email: raw.email.toLowerCase(),
    employee_number: raw.employee_number || raw.id_number,
  } as ExtractionPublishData
  for (const key of DATE_FIELDS) data[key] = toIsoDate(raw[key])
  return { data, targets }
}

export function missingErpFields(data: ExtractionPublishData) {
  return ERP_REQUIRED_FIELDS.filter((key) => !data[key])
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
    language: data.language,
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
    status: 'Inactive',
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
