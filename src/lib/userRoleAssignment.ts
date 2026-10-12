import type { UserRole } from '@/lib/types'

/**
 * wave 23 (routing by permissions, step 3) — pure rules of the users screens
 * while the roles system (migration 0126) is ON: the user forms show and
 * assign ONE role, the `profile_roles` assignment, and derive the legacy
 * `profiles.role` from it. No runtime import, so node tests can load it.
 *
 * Why the legacy role still exists: `profiles.role` is NOT NULL and still
 * drives `is_admin()`, the Edge Functions and the in-screen logic until the
 * later steps. The database keeps the two in step with the
 * `sync_profile_role_assignment` trigger (0126): while the flag is ON a
 * legacy change is copied into the assignment only when the assignment still
 * equals the old legacy role, or when the change is to or from admin (admin
 * parity); any other legacy change is REFUSED, and `admin_assign_profile_role`
 * refuses an admin assignment unless the legacy role is admin.
 */

/** The six system roles: `roles.is_system` rows, equal to the legacy values. */
export const SYSTEM_ROLE_KEYS: readonly UserRole[] = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]

/** The narrowest legacy role; what a custom role falls back to. */
export const NARROWEST_LEGACY_ROLE: UserRole = 'monitor'

export function isSystemRoleKey(key: string): key is UserRole {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(key)
}

/**
 * The legacy role a user must carry for the chosen assignment:
 * - a system role → that same key (the two stay aligned);
 * - a custom role → the current legacy role is kept, except `admin`, which
 *   becomes `monitor`: a custom role must never leave someone with the legacy
 *   admin role (admin parity) and must never grant it. A NEW user (no current
 *   legacy role) with a custom role gets `monitor` as well.
 */
export function legacyRoleFor(
  newRoleKey: string,
  currentLegacyRole: UserRole | null,
): UserRole {
  if (isSystemRoleKey(newRoleKey)) return newRoleKey
  if (currentLegacyRole === null || currentLegacyRole === 'admin')
    return NARROWEST_LEGACY_ROLE
  return currentLegacyRole
}

export type RoleChangeStep =
  { kind: 'changeLegacy'; to: UserRole } | { kind: 'assign'; roleKey: string }

/**
 * The ordered steps that move a user to `newRoleKey` while the flag is ON:
 *
 * 1. `changeLegacy(to)` when `legacyRoleFor(...)` differs from the current
 *    legacy role AND the trigger accepts the change (to or from admin, no
 *    assignment yet, or the assignment still equals the current legacy role).
 *    Otherwise the legacy change is skipped — the database would refuse it —
 *    and the user keeps the legacy role he has.
 * 2. `assign(newRoleKey)` when the assignment after step 1 still differs from
 *    `newRoleKey`. After a legacy change the trigger has already synced the
 *    assignment to the new legacy role, so a system target needs no assign
 *    and a custom target still does.
 *
 * Choosing `admin` is a legacy change to admin only (parity: the trigger
 * assigns the admin role). Nothing changes → no step.
 *
 * `isSystemRole` (the `roles.is_system` flag) is accepted for callers that
 * have it, but a role is treated as a system role exactly when its key is a
 * legacy value: only those keys may be written to `profiles.role`.
 */
export function planRoleChange(input: {
  currentLegacy: UserRole
  /** `profile_roles.role_key`, null when the user has no assignment. */
  currentAssigned: string | null
  newRoleKey: string
  isSystemRole?: boolean
}): RoleChangeStep[] {
  const steps: RoleChangeStep[] = []
  const targetLegacy = legacyRoleFor(input.newRoleKey, input.currentLegacy)
  let assigned = input.currentAssigned
  if (targetLegacy !== input.currentLegacy) {
    const accepted =
      targetLegacy === 'admin' ||
      input.currentLegacy === 'admin' ||
      input.currentAssigned === null ||
      input.currentAssigned === input.currentLegacy
    if (accepted) {
      steps.push({ kind: 'changeLegacy', to: targetLegacy })
      assigned = targetLegacy
    }
  }
  if (assigned !== input.newRoleKey)
    steps.push({ kind: 'assign', roleKey: input.newRoleKey })
  return steps
}

/** The legacy role the user carries once the plan ran. */
export function legacyRoleAfter(
  plan: ReadonlyArray<RoleChangeStep>,
  currentLegacy: UserRole,
): UserRole {
  for (const step of plan) if (step.kind === 'changeLegacy') return step.to
  return currentLegacy
}

/** A user's assignment with the names of its role, as the screens show it. */
export interface AssignedRole {
  key: string
  name_ar: string
  name_en: string
}

/**
 * Reads `profile_roles(role_key, roles(name_ar, name_en))` as PostgREST
 * returns it, defensively: the embed of a one-to-one (`profile_roles.profile_id`
 * is the primary key) is an object, but a single-element array is accepted
 * too, as is a missing `roles` embed (the key then stands for the names).
 */
export function assignedRoleFromEmbed(value: unknown): AssignedRole | null {
  const row = Array.isArray(value) ? value[0] : value
  if (typeof row !== 'object' || row === null) return null
  const record = row as { role_key?: unknown; roles?: unknown }
  if (typeof record.role_key !== 'string' || !record.role_key) return null
  const names = Array.isArray(record.roles) ? record.roles[0] : record.roles
  const role =
    typeof names === 'object' && names !== null
      ? (names as { name_ar?: unknown; name_en?: unknown })
      : null
  return {
    key: record.role_key,
    name_ar:
      typeof role?.name_ar === 'string' && role.name_ar
        ? role.name_ar
        : record.role_key,
    name_en:
      typeof role?.name_en === 'string' && role.name_en
        ? role.name_en
        : record.role_key,
  }
}

/**
 * The `admin_assign_profile_role` codes that belong under the role field of a
 * user form; every other failure is a form-level message.
 */
export const ASSIGN_ROLE_FIELD_CODES: ReadonlySet<string> = new Set([
  'admin_role_mismatch',
  'cannot_change_own_admin',
  'role_inactive',
  'role_not_found',
])
