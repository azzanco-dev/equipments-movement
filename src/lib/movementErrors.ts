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
