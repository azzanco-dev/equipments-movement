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

export function homeMovementsScope(
  role: string | null | undefined,
): HomeMovementsScope {
  if (role === 'workshop_manager' || role === 'assistant_workshop_manager')
    return 'all_contexts'
  if (role === 'workshop') return 'workshop'
  return 'own_site'
}

/** The context tab the all-contexts home opens on: their workshop day-to-day. */
export const ALL_CONTEXTS_HOME_DEFAULT_TAB = 'workshop' as const
