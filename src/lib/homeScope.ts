import type { PermissionScope } from '@/lib/types'
import type { PermissionsStatus } from '@/lib/permissions'

/**
 * wave-21-workshop-scope: which movements the field home lists for a role.
 *
 * Owner decision (2026-10-11): the workshop manager and the assistant
 * workshop manager read every movement and visit, projects and workshop, with
 * the admin log's context tabs (المشاريع / الورشة / الكل), its filter dialog
 * and its export. The workshop tab stays their default so the day-to-day view
 * does not change. READ only: they still record and classify workshop
 * movements only, and PostgreSQL keeps enforcing that.
 *
 * - `all_contexts`: `workshop_manager`, `assistant_workshop_manager`.
 * - `workshop`: the plain `workshop` role, workshop movements only (unchanged).
 * - `own_site`: the foreman's own site movements. It is also the answer for
 *   any other, unknown or missing role, so the gating fails closed onto the
 *   narrowest list (one user's own rows), never onto the wider ones.
 *
 * The database already lets every workshop role read both contexts
 * (`select_entry_exit_logs` and `can_access_movement`, migration 0098); this
 * only decides what the home shows.
 */
export type HomeMovementsScope = 'all_contexts' | 'workshop' | 'own_site'

/**
 * FALLBACK ONLY since wave 24: the role variant answers while the permissions
 * load or after a failed load (`resolveHomeMovementsScope`); src/App.tsx
 * passes the permission-derived scope once they are ready.
 */
export function homeMovementsScope(
  role: string | null | undefined,
): HomeMovementsScope {
  if (role === 'workshop_manager' || role === 'assistant_workshop_manager')
    return 'all_contexts'
  if (role === 'workshop') return 'workshop'
  return 'own_site'
}

/**
 * wave 24: the same decision from the permissions, in the order of
 * `planShell` (src/lib/navPermissions.ts): a `home.foreman` holder gets the
 * foreman's own-site list whatever its scope (one foreman variant);
 * `home.workshop` 'all' is the managers' variant with the embedded admin log,
 * 'workshop' the plain workshop list. Nothing else fails closed onto the
 * narrowest list, as the role variant always did.
 */
export function homeMovementsScopeFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): HomeMovementsScope {
  if (permissions.has('home.foreman')) return 'own_site'
  const workshopScope = permissions.get('home.workshop')
  if (workshopScope === 'all') return 'all_contexts'
  if (workshopScope === 'workshop') return 'workshop'
  return 'own_site'
}

/** Permissions once ready, the role meanwhile (loading or failed). */
export function resolveHomeMovementsScope(
  state: {
    status: PermissionsStatus
    permissions: ReadonlyMap<string, PermissionScope>
  },
  role: string | null | undefined,
): HomeMovementsScope {
  return state.status === 'ready'
    ? homeMovementsScopeFromPermissions(state.permissions)
    : homeMovementsScope(role)
}

/** The context tab the all-contexts home opens on: their workshop day-to-day. */
export const ALL_CONTEXTS_HOME_DEFAULT_TAB = 'workshop' as const
