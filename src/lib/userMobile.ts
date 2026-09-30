// The admin-maintained mobile number of a user (`profiles.mobile_number`,
// migration 0110), used for WhatsApp movement notices. The database function
// `admin_set_user_mobile` is authoritative; these helpers only mirror its rule
// so the form can answer before a round trip. Pure: no imports, no I/O.

/** Same rule as the column check and the RPC: 8 to 15 digits, optional `+`. */
const MOBILE_PATTERN = /^\+?[0-9]{8,15}$/

/**
 * What the RPC stores for a typed value: spaces and dashes are typing aids and
 * are removed; an empty result clears the number.
 */
export function normalizeUserMobileInput(
  value: string | null | undefined,
): string {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : ''
}

/** An empty value is valid: it clears the number. */
export function isValidUserMobile(normalized: string): boolean {
  return normalized === '' || MOBILE_PATTERN.test(normalized)
}

export type UserMobileErrorCode =
  'invalid_mobile' | 'admin_required' | 'user_not_found' | 'failed'

/**
 * Maps the stable tokens `admin_set_user_mobile` raises onto safe codes.
 * PostgREST appends the PostgreSQL HINT to `error.message`, so substring
 * matching is used. Raw PostgreSQL text is never shown to the user.
 */
export function userMobileErrorCode(
  message: string | null | undefined,
): UserMobileErrorCode {
  if (!message) return 'failed'
  if (message.includes('invalid_mobile')) return 'invalid_mobile'
  // The column check, should a value ever get past the function's own rule.
  if (message.includes('profiles_mobile_number_format')) return 'invalid_mobile'
  if (message.includes('admin_required')) return 'admin_required'
  if (message.includes('user_not_found')) return 'user_not_found'
  return 'failed'
}
