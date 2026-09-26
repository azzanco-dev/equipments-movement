export const OCR_FIELDS = [
  'full_name_ar',
  'full_name_en',
  'id_number',
  'date_of_birth',
  'residence_expiry_date',
  'nationality',
  'occupation',
] as const

export const OCR_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const OCR_MAX_BYTES = 10 * 1024 * 1024

export type OcrFields = Record<(typeof OCR_FIELDS)[number], string>

const DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
}

export function normalizeOcrText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[٠-٩۰-۹]/g, (char) => DIGITS[char] ?? char).trim()
    : ''
}

export function normalizeOcrDate(value: unknown): string {
  const text = normalizeOcrText(value).replace(/[/.]/g, '-').replace(/\s+/g, '')
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (iso)
    return `${iso[3].padStart(2, '0')}-${iso[2].padStart(2, '0')}-${iso[1]}`
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text)
  if (dmy)
    return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`
  return text
}

/**
 * Maps a failed Mistral OCR HTTP status to a specific, user-explainable code
 * instead of forwarding the provider's raw status text.
 */
export function ocrErrorForStatus(status: number): string {
  if (status === 401 || status === 403) return 'ocr_auth_failed'
  if (status === 402 || status === 429) return 'ocr_rate_limited'
  if (status === 400 || status === 413 || status === 415 || status === 422)
    return 'ocr_image_rejected'
  if (status === 408 || status === 504) return 'ocr_timeout'
  if (status >= 500) return 'ocr_provider_unavailable'
  return 'ocr_failed'
}

/** The Mistral annotation arrives either as an object or a JSON string. */
export function readOcrAnnotation(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function hasOcrData(fields: OcrFields): boolean {
  return OCR_FIELDS.some((field) => fields[field] !== '')
}

export function parseOcrFields(value: unknown): OcrFields {
  const source =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const result = {} as OcrFields
  for (const field of OCR_FIELDS)
    result[field] = field.includes('date')
      ? normalizeOcrDate(source[field])
      : normalizeOcrText(source[field])
  return result
}
