// Maps the movement sequence trigger's PostgreSQL exceptions onto stable,
// safe error codes. Raw PostgreSQL text must never reach the UI, so the API
// route sends only the code from here and the client translates it.

export const MOVEMENT_ERROR_CODES = [
  'future_time',
  'company_required',
  'project_required',
  'driver_required',
  'no_prior_entry',
  'exit_not_entry_owner',
  'exit_equipment_in_workshop',
  'exit_equipment_on_site',
  // wave-10-exit-purpose (migration 0111)
  'exit_purpose_required',
  'invalid_exit_purpose',
  // wave-13-drivers (migration 0120): a site entry needs its driver.
  'site_entry_driver_required',
  'workshop_exit_owner',
  'invalid_sequence',
  'access_denied',
  'movement_save_failed',
] as const

export type MovementErrorCode = (typeof MOVEMENT_ERROR_CODES)[number]

export function movementErrorCode(message: string): MovementErrorCode {
  if (message.includes('movement time cannot be in the future'))
    return 'future_time'
  // wave-13-drivers (migration 0120): checked before the older driver text.
  if (message.includes('site_entry_driver_required'))
    return 'site_entry_driver_required'
  if (message.includes('company_id is required')) return 'company_required'
  if (message.includes('project_id is required')) return 'project_required'
  if (
    message.includes('driver_id is required') ||
    message.includes('invalid driver_id')
  )
    return 'driver_required'
  // Checked before the generic "no prior entry" text: the owner rule is a
  // permission failure, not a missing entry.
  if (message.includes('exit_not_entry_owner')) return 'exit_not_entry_owner'
  if (message.includes('exit_equipment_in_workshop'))
    return 'exit_equipment_in_workshop'
  // wave-8-security (migration 0108): the symmetrical rule for a workshop exit
  // on a unit whose open entry is a site entry.
  if (message.includes('exit_equipment_on_site'))
    return 'exit_equipment_on_site'
  // wave-10-exit-purpose (migration 0111): a site exit needs its purpose.
  if (message.includes('exit_purpose_required')) return 'exit_purpose_required'
  if (
    message.includes('no prior entry') ||
    message.includes('not inside the gate')
  )
    return 'no_prior_entry'
  if (message.includes('workshop exit must be registered by entry user'))
    return 'workshop_exit_owner'
  if (message.includes('sequence would be invalid')) return 'invalid_sequence'
  if (
    message.includes('foreman role required') ||
    message.includes('supervisor role required') ||
    message.includes('workshop role required')
  )
    return 'access_denied'
  return 'movement_save_failed'
}

// Closing somebody else's visit is a permission failure (403), not a state
// conflict (409). A missing or unknown exit purpose, and a site entry without
// a driver, are invalid input (400).
export function movementErrorStatus(code: MovementErrorCode): number {
  if (
    code === 'exit_purpose_required' ||
    code === 'invalid_exit_purpose' ||
    code === 'site_entry_driver_required'
  )
    return 400
  return code === 'exit_not_entry_owner' ||
    code === 'exit_equipment_in_workshop' ||
    code === 'exit_equipment_on_site' ||
    code === 'workshop_exit_owner' ||
    code === 'access_denied'
    ? 403
    : 409
}

// wave6-J3/J4 — admin correction and delete of one movement.
// Maps the stable tokens raised by `admin_update_movement` (migration 0105)
// and `admin_delete_movement` (migrations 0104/0105) onto safe codes.
// PostgREST appends the PostgreSQL HINT to `error.message`, so substring
// matching is used, and anything unknown falls back to the generic code for
// the operation.

export const MOVEMENT_ADMIN_ERROR_CODES = [
  'access_denied',
  'movement_not_found',
  'invalid_movement_payload',
  'future_time',
  'invalid_sequence',
  'invalid_driver',
  'driver_not_supported',
  'open_visit_driver_change',
  'contractor_code_too_long',
  'movement_notes_too_long',
  // 0186: the purpose of a site exit.
  'invalid_exit_purpose',
  'exit_purpose_not_allowed',
  'entry_has_later_exit',
  'movement_not_last',
  // 0193: the entry's card sits on a supplier or client PO.
  'movement_on_po',
  'movement_update_failed',
  'movement_delete_failed',
] as const

export type MovementAdminErrorCode = (typeof MOVEMENT_ADMIN_ERROR_CODES)[number]

export function movementAdminErrorCode(
  message: string | null | undefined,
  operation: 'update' | 'delete' = 'update',
): MovementAdminErrorCode {
  const fallback: MovementAdminErrorCode =
    operation === 'delete' ? 'movement_delete_failed' : 'movement_update_failed'
  if (!message) return fallback
  if (message.includes('admin_required')) return 'access_denied'
  if (message.includes('movement_not_found')) return 'movement_not_found'
  if (message.includes('invalid_payload')) return 'invalid_movement_payload'
  if (message.includes('future_time')) return 'future_time'
  if (message.includes('invalid_sequence')) return 'invalid_sequence'
  if (message.includes('invalid_driver')) return 'invalid_driver'
  if (message.includes('driver_not_supported')) return 'driver_not_supported'
  if (message.includes('open_visit_driver_change'))
    return 'open_visit_driver_change'
  if (message.includes('contractor_code_too_long'))
    return 'contractor_code_too_long'
  if (message.includes('movement_notes_too_long'))
    return 'movement_notes_too_long'
  if (message.includes('invalid_exit_purpose')) return 'invalid_exit_purpose'
  if (message.includes('exit_purpose_not_allowed'))
    return 'exit_purpose_not_allowed'
  if (message.includes('entry_has_later_exit')) return 'entry_has_later_exit'
  if (message.includes('movement_not_last')) return 'movement_not_last'
  if (message.includes('movement_on_po')) return 'movement_on_po'
  return fallback
}

/** PO numbers shown by the movement lock message: `DRAFT-0558` or
 *  `PO-2026110012`, nothing else. */
const PO_NUMBER_PATTERN = /^[A-Z]+-[0-9]+$/
const PO_NUMBERS_LIMIT = 5

/**
 * The PO numbers of a `movement_on_po` refusal (0193): the error's
 * `details` carries them comma separated. Each part is validated against
 * `^[A-Z]+-[0-9]+$` before it is returned — raw database text is never
 * passed on — duplicates dropped, at most five kept.
 */
export function movementOnPoNumbers(
  details: string | null | undefined,
): string[] {
  if (!details) return []
  const numbers: string[] = []
  for (const part of details.split(',')) {
    const value = part.trim()
    if (PO_NUMBER_PATTERN.test(value) && !numbers.includes(value))
      numbers.push(value)
    if (numbers.length >= PO_NUMBERS_LIMIT) break
  }
  return numbers
}

// A missing movement is 404; a refused role is 403; malformed input is 400;
// everything else is a state conflict the admin can resolve (409).
export function movementAdminErrorStatus(code: MovementAdminErrorCode): number {
  if (code === 'access_denied') return 403
  if (code === 'movement_not_found') return 404
  if (
    code === 'invalid_movement_payload' ||
    code === 'contractor_code_too_long' ||
    code === 'movement_notes_too_long' ||
    code === 'invalid_exit_purpose' ||
    code === 'exit_purpose_not_allowed'
  )
    return 400
  return 409
}
