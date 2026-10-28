import type { UserRole } from '@/lib/types'

/**
 * Pure rules of the users screens for a user's ONE role, the `profile_roles`
 * assignment (wave 23, step 3; roles stages 4b–4c-2). No runtime import, so
 * node tests can load it.
 *
 * Since roles stage 4c-2 (migration 0156) the legacy `profiles.role` no
 * longer exists: a role is chosen as a `roles.key` and changed through
 * `admin_assign_profile_role` alone (0153), which keeps the last admin and
 * refuses an admin's own demotion.
 */

/** The six original roles (the 0126 seed); their badges keep their tones. */
export const SYSTEM_ROLE_KEYS: readonly UserRole[] = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]

export function isSystemRoleKey(key: string): key is UserRole {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(key)
}

export type RoleChangeStep = { kind: 'assign'; roleKey: string }

/**
 * The steps that move a user to `newRoleKey`: one `assign(newRoleKey)` step
 * when it differs from the current assignment, none otherwise.
 */
export function planRoleChange(input: {
  /** `profile_roles.role_key`, null when the user has no assignment. */
  currentAssigned: string | null
  newRoleKey: string
}): RoleChangeStep[] {
  return input.currentAssigned === input.newRoleKey
    ? []
    : [{ kind: 'assign', roleKey: input.newRoleKey }]
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
  'last_admin',
  'role_inactive',
  'role_not_found',
])
