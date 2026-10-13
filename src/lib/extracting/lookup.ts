// Shared by the extracting screen and `app/api/extracting/lookup`: what
// already exists for a residence number in each publish target, and whether
// the caller may update it. Keep this module importing only './form' so the
// tests can load it in an isolated VM.
import { isValidIdNumber, type PublishMode, type PublishTargets } from './form'

/** The `drivers` row matched by `id_number` (read through the caller's RLS). */
export interface LookupDriver {
  id: string
  full_name: string
  mobile_number: string | null
}

/** The ERPNext Employee matched by the residence-number field. */
export interface LookupEmployee {
  name: string
  employee_name: string
  user_id: string
  cell_number: string
}

export type LookupErpnext =
  | { configured: false }
  | { configured: true; employee: LookupEmployee | null }
  | { configured: true; error: string }

export interface LookupResult {
  idNumber: string
  /** `public.is_admin()` answered `true` for the caller's token. */
  canUpdate: boolean
  currentSystem: LookupDriver | null
  erpnext: LookupErpnext
}

/** Validates the lookup body with the form's residence-number rule. */
export function parseLookupRequest(
  value: unknown,
): { idNumber: string } | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as Record<string, unknown>).id_number
  if (typeof raw !== 'string') return null
  const idNumber = raw.trim()
  return isValidIdNumber(idNumber) ? { idNumber } : null
}

export function lookupEmployee(result: LookupResult): LookupEmployee | null {
  return result.erpnext.configured && 'employee' in result.erpnext
    ? result.erpnext.employee
    : null
}

/** True when a selected target already holds a record for the number. */
export function hasExistingRecord(
  result: LookupResult,
  targets: PublishTargets,
): boolean {
  return (
    (targets.currentSystem && !!result.currentSystem) ||
    (targets.erpnext && !!lookupEmployee(result))
  )
}

/**
 * The mode the page sends: `update` only when the lookup matched the form's
 * current number, a selected target holds a record and the server said the
 * caller may update. Everything else stays the create flow.
 */
export function publishModeFor(
  result: LookupResult | null,
  idNumber: string,
  targets: PublishTargets,
): PublishMode {
  if (!result || result.idNumber !== idNumber.trim()) return 'create'
  return result.canUpdate && hasExistingRecord(result, targets)
    ? 'update'
    : 'create'
}
