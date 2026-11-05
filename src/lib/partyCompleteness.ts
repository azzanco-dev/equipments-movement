import type { TranslationKey } from '@/i18n/translations'

/**
 * How complete a supplier's data is (owner 2026-11-05, «نهاية كل صف تضيف
 * PROGRESS BAR درجة اكمال البيانات, او ممكن يكون دائرة، احمر اصفر اخضر،
 * سويها على الموردين بشوف اول»): the share of the supplier form's fields
 * that hold a value, shown as a coloured ring at the end of each row of the
 * suppliers list. Computed from the row alone (no query), so it is not a
 * sortable column.
 */

export type CompletenessTone = 'danger' | 'warning' | 'success'

export interface CompletenessField {
  field: string
  label: TranslationKey
}

/** Every field of the supplier form, in the form's order. */
export const LESSOR_COMPLETENESS_FIELDS: readonly CompletenessField[] = [
  { field: 'name', label: 'lessorName' },
  { field: 'tax_number', label: 'taxNumber' },
  { field: 'commercial_register', label: 'commercialRegister' },
  { field: 'city', label: 'city' },
  { field: 'short_address', label: 'shortAddress' },
  { field: 'address', label: 'address' },
  { field: 'contact_person', label: 'contactPerson' },
  { field: 'contact_number', label: 'contactNumber' },
  { field: 'email', label: 'email' },
  { field: 'bank_name', label: 'bankName' },
  { field: 'iban', label: 'iban' },
]

/** Red under half, yellow from half to just under complete, green when
 *  every field is filled. */
export const COMPLETENESS_WARNING_FROM = 50
export const COMPLETENESS_SUCCESS_AT = 100

export interface Completeness {
  filled: number
  total: number
  /** Whole percent, 0–100. */
  percent: number
  tone: CompletenessTone
  /** The labels of the empty fields, in the form's order. */
  missing: TranslationKey[]
}

export function completenessTone(percent: number): CompletenessTone {
  if (percent >= COMPLETENESS_SUCCESS_AT) return 'success'
  if (percent >= COMPLETENESS_WARNING_FROM) return 'warning'
  return 'danger'
}

export function partyCompleteness(
  record: object,
  fields: readonly CompletenessField[],
): Completeness {
  const values = record as Record<string, unknown>
  const missing = fields
    .filter(({ field }) => {
      const value = values[field]
      return typeof value === 'string' ? !value.trim() : value == null
    })
    .map(({ label }) => label)
  const total = fields.length
  const filled = total - missing.length
  // Floor, so a ring never reads 100 while a field is still empty.
  const percent = total ? Math.floor((filled / total) * 100) : 0
  return { filled, total, percent, tone: completenessTone(percent), missing }
}
