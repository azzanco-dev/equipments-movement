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
  'workshop_exit_owner',
  'invalid_sequence',
  'access_denied',
  'movement_save_failed',
] as const

export type MovementErrorCode = (typeof MOVEMENT_ERROR_CODES)[number]

export function movementErrorCode(message: string): MovementErrorCode {
  if (message.includes('movement time cannot be in the future'))
    return 'future_time'
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
// conflict (409).
export function movementErrorStatus(code: MovementErrorCode): number {
  return code === 'exit_not_entry_owner' ||
    code === 'exit_equipment_in_workshop' ||
    code === 'workshop_exit_owner' ||
    code === 'access_denied'
    ? 403
    : 409
}

// wave6-J3 — admin edit (notes/driver) and delete of one movement.
// Maps the stable tokens raised by `admin_update_movement_details` and
// `admin_delete_movement` (migration 0104) onto safe codes. PostgREST appends
// the PostgreSQL HINT to `error.message`, so substring matching is used, and
// anything unknown falls back to the generic code for the operation.

export const MOVEMENT_ADMIN_ERROR_CODES = [
  'access_denied',
  'movement_not_found',
  'invalid_driver',
  'driver_not_supported',
  'open_visit_driver_change',
  'movement_notes_too_long',
  'entry_has_later_exit',
  'movement_not_last',
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
  // `admin_required` is raised by 0068 and 0104 alike; both mean 403.
  if (message.includes('admin_required')) return 'access_denied'
  if (message.includes('movement_not_found')) return 'movement_not_found'
  if (message.includes('invalid_driver')) return 'invalid_driver'
  if (message.includes('driver_not_supported')) return 'driver_not_supported'
  if (message.includes('open_visit_driver_change'))
    return 'open_visit_driver_change'
  if (message.includes('movement_notes_too_long'))
    return 'movement_notes_too_long'
  if (message.includes('entry_has_later_exit')) return 'entry_has_later_exit'
  if (message.includes('movement_not_last')) return 'movement_not_last'
  return fallback
}

// A missing movement is 404; a refused role is 403; everything else is a state
// conflict the admin can resolve (409).
export function movementAdminErrorStatus(code: MovementAdminErrorCode): number {
  if (code === 'access_denied') return 403
  if (code === 'movement_not_found') return 404
  if (code === 'movement_notes_too_long') return 400
  return 409
}
