import type { SupabaseClient } from '@supabase/supabase-js'
import type { TranslationKey } from '@/i18n/translations'

/**
 * Migration 0166 (owner 2026-10-31): the admin corrects ONE driver of a
 * project visit in place — the entry driver (`changeId` null) or the new
 * driver of one change — through `admin_correct_visit_driver`. The database
 * keeps the chain consistent (the next change starts from the corrected
 * driver, a change from a driver to the same driver is deleted, a closed
 * visit's exit follows its last driver); the genuine swap during an open
 * visit stays `change_active_movement_driver`.
 */
export interface VisitDriverCorrection {
  entryId: string
  /** The change whose new driver is corrected; null = the entry driver. */
  changeId: string | null
  driverId: string
}

export async function correctVisitDriver(
  client: SupabaseClient,
  correction: VisitDriverCorrection,
): Promise<{ error: { message?: string } | null }> {
  const { error } = await client.rpc('admin_correct_visit_driver', {
    p_entry_log_id: correction.entryId,
    p_change_id: correction.changeId,
    p_new_driver_id: correction.driverId,
  })
  return { error }
}

/** The field the message belongs to, or null for a form-level message. */
export type DriverCorrectionErrorTarget = 'driver_id' | null

const CORRECTION_ERRORS: [
  token: string,
  key: TranslationKey,
  target: DriverCorrectionErrorTarget,
][] = [
  ['driver_unchanged', 'driverChangeSameDriver', 'driver_id'],
  ['invalid_driver_id', 'movementAdminInvalidDriver', 'driver_id'],
  ['admin_required', 'movementAdminAccessDenied', null],
  ['movement_not_found', 'movementNotFound', null],
  ['driver_change_not_found', 'driverCorrectionStale', null],
]

/**
 * A failed correction as a translation key; raw PostgreSQL text never
 * reaches the user.
 */
export function driverCorrectionError(message: string | null | undefined): {
  key: TranslationKey
  target: DriverCorrectionErrorTarget
} {
  const text = message ?? ''
  for (const [token, key, target] of CORRECTION_ERRORS)
    if (text.includes(token)) return { key, target }
  return { key: 'driverCorrectionFailed', target: null }
}
