import type { TranslationKey } from '@/i18n/translations'

// Helpers for the foreman edit of `contractor_equipment_code` on his own open
// site ENTRY (migration 0093, `public.update_entry_contractor_code`).
//
// The database is authoritative: it trims, treats an empty code as NULL and
// rejects anything longer than CONTRACTOR_CODE_MAX_LENGTH. These helpers only
// mirror that so the UI can refuse obviously invalid input before the round
// trip, and map the function's stable error tokens onto translation keys.
// Raw PostgreSQL text must never reach the user.

/** Must stay in sync with the 50-character check in migration 0093. */
export const CONTRACTOR_CODE_MAX_LENGTH = 50

/** Trimmed code, or `null` when the foreman cleared the field. */
export function normalizeContractorCode(value: string): string | null {
  return value.trim() || null
}

/** `true` when the value is accepted by the database check. */
export function isValidContractorCode(value: string): boolean {
  const code = normalizeContractorCode(value)
  return code === null || code.length <= CONTRACTOR_CODE_MAX_LENGTH
}

/**
 * `true` when saving would change nothing, so the dialog can keep Save
 * disabled instead of writing an audit-free no-op update.
 */
export function contractorCodeUnchanged(
  value: string,
  current: string | null | undefined,
): boolean {
  return normalizeContractorCode(value) === (current?.trim() || null)
}

const CONTRACTOR_CODE_ERROR_KEYS: Record<string, TranslationKey> = {
  contractor_code_not_allowed: 'contractorCodeNotAllowed',
  entry_not_accessible: 'contractorCodeNotAllowed',
  visit_is_closed: 'contractorCodeVisitClosed',
  contractor_code_too_long: 'contractorCodeTooLong',
}

/**
 * Translation key for a failed contractor-code edit. The tokens are the ones
 * `public.update_entry_contractor_code` raises; anything else (network error,
 * unexpected PostgreSQL state) falls back to the generic message.
 */
export function contractorCodeErrorKey(
  message: string | null | undefined,
): TranslationKey {
  if (!message) return 'contractorCodeUpdateFailed'
  for (const [token, key] of Object.entries(CONTRACTOR_CODE_ERROR_KEYS)) {
    if (message.includes(token)) return key
  }
  return 'contractorCodeUpdateFailed'
}
