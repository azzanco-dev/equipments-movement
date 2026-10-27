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
 * Who may open Settings › «الادوار والصلاحيات»: a holder of `settings.roles`.
 * Fail closed: nothing is allowed while the permissions load or after a
 * failed load. Roles stage 4a (2026-10-27) dropped the legacy-admin role
 * check; `settings.roles` is an admin-only key (0126 `admin_only`), so the
 * same users pass.
 */
export function rolesPageAccess(
  status: PermissionsStatus,
  map: ReadonlyMap<string, PermissionScope>,
): RolesPageAccess {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'
  return map.has('settings.roles') ? 'allowed' : 'denied'
}
