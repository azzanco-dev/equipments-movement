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
 * - `site_all` (owner 2026-10-28, «سويت دور رئيس الفورمين وعطيته عرض جميع
 *   الحركات، لكن لسى مايعرض الا حركاتي»): a foreman home whose
 *   `movements.read` scope is wider than his own rows (`all` or `site`)
 *   gets the admin log embedded, opening on «المشاريع»; RLS still decides
 *   which rows come back.
 * - `own_site`: the foreman's own site movements. It is also the answer for
 *   any other, unknown or missing role, so the gating fails closed onto the
 *   narrowest list (one user's own rows), never onto the wider ones.
 *
 * The database already lets every workshop role read both contexts
 * (`select_entry_exit_logs` and `can_access_movement`, migration 0098); this
 * only decides what the home shows.
 */
export type HomeMovementsScope =
  | 'all_contexts'
  | 'site_all'
  | 'workshop'
  | 'own_site'

/**
 * wave 24: the decision from the permissions, in the order of
 * `planShell` (src/lib/navPermissions.ts): a `home.foreman` holder gets the
 * foreman's own-site list, or the embedded log when his `movements.read`
 * scope is `all` or `site` (owner 2026-10-28);
 * `home.workshop` 'all' is the managers' variant with the embedded admin log,
 * 'workshop' the plain workshop list. Nothing else fails closed onto the
 * narrowest list. Roles stage 4a (2026-10-27) removed the role variant.
 */
export function homeMovementsScopeFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): HomeMovementsScope {
  if (permissions.has('home.foreman')) {
    const read = permissions.get('movements.read')
    return read === 'all' || read === 'site' ? 'site_all' : 'own_site'
  }
  const workshopScope = permissions.get('home.workshop')
  if (workshopScope === 'all') return 'all_contexts'
  if (workshopScope === 'workshop') return 'workshop'
  return 'own_site'
}

/** Permissions once ready; the narrowest list meanwhile (loading or failed). */
export function resolveHomeMovementsScope(state: {
  status: PermissionsStatus
  permissions: ReadonlyMap<string, PermissionScope>
}): HomeMovementsScope {
  return state.status === 'ready'
    ? homeMovementsScopeFromPermissions(state.permissions)
    : 'own_site'
}

/** The context tab the all-contexts home opens on: their workshop day-to-day. */
export const ALL_CONTEXTS_HOME_DEFAULT_TAB = 'workshop' as const
