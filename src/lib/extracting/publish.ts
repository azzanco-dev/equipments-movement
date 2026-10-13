import {
  DATE_FIELDS,
  ERP_REQUIRED_FIELDS,
  EXTRACTION_FIELDS,
  PUBLISH_MODES,
  isUpdateField,
  toIsoDate,
  validateExtractionForm,
  type ExtractionFieldKey,
  type ExtractionForm,
  type PublishMode,
  type PublishTargets,
} from './form'

export type {
  PublishMode,
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

function parsePublishMode(value: unknown): PublishMode | null {
  if (value === undefined) return 'create'
  return (PUBLISH_MODES as readonly unknown[]).includes(value)
    ? (value as PublishMode)
    : null
}

/**
 * Validates the publish request body. ERPNext-only required fields are not
 * checked here: a missing one fails the ERPNext target alone (see
 * `missingErpFields`) so the current system can still be published. `mode`
 * is optional and defaults to `create`; the route decides whether the caller
 * may use `update`, never this parser.
 */
export function parsePublishRequest(value: unknown): {
  data: ExtractionPublishData
  targets: PublishTargets
  mode: PublishMode
} | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (!body.data || typeof body.data !== 'object') return null
  if (!body.targets || typeof body.targets !== 'object') return null
  const mode = parsePublishMode(body.mode)
  if (!mode) return null

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
  // Sent to ERPNext exactly as typed; trimming would change the password.
  raw.password = typeof source.password === 'string' ? source.password : ''
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
  return { data, targets, mode }
}

export function missingErpFields(data: ExtractionPublishData) {
  return ERP_REQUIRED_FIELDS.filter((key) => !data[key])
}

/** `drivers` column <- reviewed field; the one mapping for create and update. */
const DRIVER_COLUMNS: ReadonlyArray<[string, ExtractionFieldKey]> = [
  ['full_name', 'full_name_ar'],
  ['name_en', 'full_name_en'],
  ['id_number', 'id_number'],
  ['mobile_number', 'mobile_number'],
  ['nationality', 'nationality'],
  ['employment_type', 'employment_type'],
  ['job_title', 'occupation'],
]

export function currentSystemDriverPayload(data: ExtractionPublishData) {
  const payload: Record<string, string | null> = {}
  for (const [column, key] of DRIVER_COLUMNS)
    payload[column] =
      column === 'full_name' || column === 'id_number'
        ? data[key]
        : data[key] || null
  return payload
}

/**
 * Update mode: the `DRIVER_COLUMNS` fed by an `UPDATE_FIELDS` identity field
 * (`full_name`, `name_en`, `mobile_number`, `nationality`, `job_title`) whose
 * reviewed value is non-empty. `id_number` is the match key and
 * `employment_type` is employment data: neither is ever written, and an empty
 * field never clears a stored value.
 */
export function currentSystemDriverUpdatePayload(data: ExtractionPublishData) {
  const update: Record<string, string> = {}
  for (const [column, key] of DRIVER_COLUMNS)
    if (isUpdateField(key) && data[key]) update[column] = data[key]
  return update
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
    // `new_password` is the User doctype's "Set New Password" field.
    ...(data.password ? { new_password: data.password } : {}),
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

/**
 * Employee field <- value <- the reviewed field it comes from (`null` for a
 * constant or derived value). Standard fields first, then the custom fields
 * resolved against the Employee's available field names.
 */
function erpEmployeeEntries(
  data: ExtractionPublishData,
  availableFields?: ReadonlySet<string>,
): Array<[string | null, string, ExtractionFieldKey | null]> {
  return [
    ['first_name', data.full_name_ar, 'full_name_ar'],
    ['user_id', data.email, null],
    ['status', 'Inactive', null],
    ['gender', data.gender, 'gender'],
    ['date_of_birth', data.date_of_birth, 'date_of_birth'],
    ['date_of_joining', data.date_of_joining, 'date_of_joining'],
    ['company', data.company, 'company'],
    ['employment_type', data.employment_type, 'employment_type'],
    ['department', data.department, 'department'],
    ['designation', data.occupation, 'occupation'],
    ['cell_number', data.mobile_number, 'mobile_number'],
    ['ctc', data.ctc, 'ctc'],
    ['employee_number', data.employee_number || data.id_number, null],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_NATIONALITY_FIELD,
        'custom_nationality',
      ),
      data.nationality,
      'nationality',
    ],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_EMPLOYEE_NAME_EN_FIELD,
        'custom_employee_name_en',
      ),
      data.full_name_en,
      'full_name_en',
    ],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
        'custom_residence_permit_number',
      ),
      data.id_number,
      'id_number',
    ],
    [
      availableFieldName(
        availableFields,
        process.env.ERPNEXT_RESIDENCE_EXPIRY_FIELD,
        'custom_rp_valid_upto',
      ),
      data.residence_expiry_date,
      'residence_expiry_date',
    ],
  ]
}

export function erpEmployeePayload(
  data: ExtractionPublishData,
  availableFields?: ReadonlySet<string>,
) {
  const payload: Record<string, string> = {}
  for (const [field, value] of erpEmployeeEntries(data, availableFields))
    if (field && value) payload[field] = value
  return payload
}

/**
 * Update mode: the Employee fields of `erpEmployeePayload` fed by an
 * `UPDATE_FIELDS` identity field, non-empty only. Never written: `user_id`
 * (the route sets it only when the Employee has none, as in create mode),
 * `status`, the residence number (the match key), `employee_number`, and the
 * employment data (`date_of_joining`, `company`, `employment_type`,
 * `department`, `ctc`). The User's email and password are never part of an
 * Employee update.
 */
export function erpEmployeeUpdatePayload(
  data: ExtractionPublishData,
  availableFields?: ReadonlySet<string>,
) {
  const update: Record<string, string> = {}
  for (const [field, value, source] of erpEmployeeEntries(
    data,
    availableFields,
  ))
    if (field && source && isUpdateField(source) && value) update[field] = value
  return update
}
