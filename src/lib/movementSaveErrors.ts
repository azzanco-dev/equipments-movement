import type { TranslationKey } from '@/i18n/translations'

// The movement API answers with a stable error code (see `movementErrors.ts`).
// Raw PostgreSQL/Supabase text must never reach the user, so the form maps the
// code onto a translation key here and falls back to the generic message.

const MOVEMENT_SAVE_ERROR_KEYS: Record<string, TranslationKey> = {
  future_time: 'movementTimeCannotBeFuture',
  company_required: 'companyRequiredForEntry',
  project_required: 'projectRequiredForEntry',
  driver_required: 'driverRequired',
  no_prior_entry: 'noPriorEntryAtSelectedTime',
  exit_not_entry_owner: 'siteExitNotEntryOwner',
  exit_equipment_in_workshop: 'siteExitEquipmentInWorkshop',
  workshop_exit_owner: 'workshopExitOwner',
  invalid_photos: 'invalidPhotoType',
  photo_required: 'workshopPhotoRequired',
  photo_decode_failed: 'photoCompressionFailed',
  photo_compression_failed: 'photoCompressionFailed',
  invalid_movement_payload: 'movementSaveFailed',
  photo_upload_failed: 'photoUploadFailed',
  unauthorized: 'authError',
  access_denied: 'accessDenied',
  movement_save_failed: 'movementSaveFailed',
}

/**
 * Translation key for a movement save failure. `invalid_sequence` depends on
 * the movement type, so it is resolved separately.
 */
export function movementSaveErrorKey(
  code: string,
  isEntry: boolean,
): TranslationKey {
  if (code === 'invalid_sequence')
    return isEntry ? 'entrySequenceConflict' : 'exitSequenceConflict'
  return MOVEMENT_SAVE_ERROR_KEYS[code] ?? 'movementSaveFailed'
}
