import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrapRows } from '@/lib/supabaseResult'

/**
 * Who holds a permission, by role (owner 2026-10-27, retiring the legacy
 * role: «نبغى نشيل التقسيم هذا وتكون كلها واحد»). The pickers that listed a
 * legacy role name (the foreman filters, the recorder of a movement, the
 * companies a user is responsible for) list the users whose ASSIGNED role
 * holds the permission instead, so a custom role counts like an original
 * one. `role_permissions` and `roles` are readable by every signed-in user
 * (0126); an inactive role grants nothing and is left out. Throws on a
 * failed read (`unwrapRows`), so a picker shows its load error.
 */
export async function roleKeysHolding(
  client: SupabaseClient,
  permissionKey: string,
): Promise<string[]> {
  const rows = unwrapRows<{ role_key: string }>(
    await client
      .from('role_permissions')
      .select('role_key,roles!inner(is_active)')
      .eq('permission_key', permissionKey)
      .eq('roles.is_active', true),
  )
  return [...new Set(rows.map((row) => row.role_key))]
}

/**
 * The roles of the foremen: they record project movements, the admin
 * aside. For the original roles that is exactly the foreman
 * (`supervisor`), as before.
 */
export async function foremanRoleKeys(client: SupabaseClient): Promise<string[]> {
  return (await roleKeysHolding(client, 'movements.site.create')).filter(
    (key) => key !== 'admin',
  )
}

/** The pure rule behind `foremanRoleKeys`, for the user page. */
export function isForemanRoleKey(
  roleKey: string | null | undefined,
  foremanKeys: ReadonlySet<string>,
): boolean {
  return Boolean(roleKey) && roleKey !== 'admin' && foremanKeys.has(roleKey!)
}
