import type { TranslationKey } from '@/i18n/translations'

// wave6-J3 — client helpers for the admin actions on a movement detail page:
// editing the note and the driver, and deleting the movement.
//
// The database is authoritative (migration 0104,
// `public.admin_update_movement_details` and `public.admin_delete_movement`).
// These helpers only mirror its rules so the dialog can refuse obviously
// invalid input before the round trip, choose the right driver path, and map
// the API's stable error codes onto translation keys. Raw PostgreSQL or
// Supabase text must never reach the user.

/** Must stay in sync with the 1000-character check in migration 0104. */
export const MOVEMENT_NOTES_MAX_LENGTH = 1000

/** Trimmed note, or `null` when the admin cleared the field. */
export function normalizeMovementNotes(value: string): string | null {
  return value.trim() || null
}

/** `true` when the value is accepted by the database check. */
export function isValidMovementNotes(value: string): boolean {
  const notes = normalizeMovementNotes(value)
  return notes === null || notes.length <= MOVEMENT_NOTES_MAX_LENGTH
}

/**
 * `true` when saving would change neither the note nor the driver, so the
 * dialog can keep Save disabled instead of writing an audit-free no-op.
 */
export function movementEditUnchanged(params: {
  notes: string
  currentNotes: string | null | undefined
  driverId: string | null
  currentDriverId: string | null | undefined
}): boolean {
  const sameNotes =
    normalizeMovementNotes(params.notes) ===
    (params.currentNotes?.trim() || null)
  const sameDriver =
    !params.driverId || params.driverId === (params.currentDriverId ?? null)
  return sameNotes && sameDriver
}

export type MovementDriverEditMode = 'unsupported' | 'driver_change' | 'admin'

/**
 * Which path a driver change must take, mirroring migration 0104:
 *   * `unsupported` — workshop movements are recorded without a driver;
 *   * `driver_change` — a site ENTRY whose visit is still open keeps its
 *     immutable entry driver, so the append-only
 *     `change_active_movement_driver` (migration 0040) is the only path;
 *   * `admin` — a closed visit or an EXIT row, corrected through
 *     `admin_update_movement_details`.
 */
export function movementDriverEditMode(params: {
  movementType: string
  movementContext: string | null | undefined
  hasLaterMovement: boolean
}): MovementDriverEditMode {
  if ((params.movementContext ?? 'site') !== 'site') return 'unsupported'
  if (params.movementType === 'entry' && !params.hasLaterMovement)
    return 'driver_change'
  return 'admin'
}

const MOVEMENT_ADMIN_ERROR_KEYS: Record<string, TranslationKey> = {
  unauthorized: 'authError',
  access_denied: 'movementAdminAccessDenied',
  movement_not_found: 'movementNotFound',
  invalid_driver: 'movementAdminInvalidDriver',
  driver_not_supported: 'movementAdminDriverNotSupported',
  open_visit_driver_change: 'movementAdminOpenVisitDriver',
  movement_notes_too_long: 'movementNotesTooLong',
  entry_has_later_exit: 'movementDeleteEntryHasExit',
  movement_not_last: 'movementDeleteNotLast',
  movement_update_failed: 'movementEditFailed',
  movement_delete_failed: 'movementDeleteFailed',
}

/**
 * Translation key for a failed admin edit or delete. `operation` picks the
 * generic fallback so an unknown code never shows the wrong message.
 */
export function movementAdminErrorKey(
  code: string | null | undefined,
  operation: 'update' | 'delete' = 'update',
): TranslationKey {
  const fallback: TranslationKey =
    operation === 'delete' ? 'movementDeleteFailed' : 'movementEditFailed'
  if (!code) return fallback
  return MOVEMENT_ADMIN_ERROR_KEYS[code] ?? fallback
}
