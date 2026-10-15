import type { CurrentPermission, PermissionScope } from '@/lib/types'

/**
 * wave 22B — the client view of `current_permissions()` (migration 0126).
 *
 * These helpers are read by the roles settings page and, since wave 23, the
 * sidebar, the shell selection and the page guards of src/App.tsx (through
 * src/lib/navPermissions.ts) and, since wave 24, the in-screen actions
 * (src/lib/actionPermissions.ts). While the roles system is inactive the
 * answer is the frozen legacy mapping, so the app behaves exactly as before.
 *
 * This file has no runtime imports so the node tests can load it directly.
 */

export const PERMISSION_SCOPES: readonly PermissionScope[] = [
  'own',
  'companies',
  'site',
  'workshop',
  'all',
]

export function isPermissionScope(value: unknown): value is PermissionScope {
  return (
    typeof value === 'string' &&
    (PERMISSION_SCOPES as readonly string[]).includes(value)
  )
}

/** `permission_key -> scope`. A row with an unknown scope is dropped, so a
 *  malformed answer can only take a permission away (fail closed). */
export function toPermissionMap(
  rows: ReadonlyArray<Partial<CurrentPermission> | null> | null | undefined,
): Map<string, PermissionScope> {
  const map = new Map<string, PermissionScope>()
  for (const row of rows ?? []) {
    if (!row || typeof row.permission_key !== 'string') continue
    if (!isPermissionScope(row.scope)) continue
    map.set(row.permission_key, row.scope)
  }
  return map
}

export type PermissionsStatus = 'loading' | 'ready' | 'error'

/** The caller's scope for `key`, or null when not granted or not loaded. */
export function permissionScopeOf(
  status: PermissionsStatus,
  map: ReadonlyMap<string, PermissionScope>,
  key: string,
): PermissionScope | null {
  if (status !== 'ready') return null
  return map.get(key) ?? null
}

export type RolesPageAccess = 'allowed' | 'loading' | 'denied' | 'error'

/**
 * Who may open Settings › «الادوار والصلاحيات». Fail closed: only a legacy
 * admin (the same rule the admin interface routing applies) who also holds
 * `settings.roles` in the current mode. A missing or unknown role is denied
 * before the permissions are even consulted.
 */
export function rolesPageAccess(
  role: string | null | undefined,
  status: PermissionsStatus,
  map: ReadonlyMap<string, PermissionScope>,
): RolesPageAccess {
  if (role !== 'admin') return 'denied'
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'
  return map.has('settings.roles') ? 'allowed' : 'denied'
}
