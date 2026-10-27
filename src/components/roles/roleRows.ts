import type { Language } from '@/i18n/translations'
import { localizedName } from '@/lib/localizedName'
import type { Role } from '@/lib/types'

/** A `roles` row with the counts the list shows. */
export type RoleRow = Role & {
  /** Users assigned in `profile_roles` (admins read every row). */
  user_count: number
  /** Rows in `role_permissions` (the ACTIVE-mode set). */
  permission_count: number
}

/** The six legacy roles in the order the user forms list them. */
const SYSTEM_ROLE_ORDER = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]

/**
 * The six original roles first in their usual order, then the others by
 * creation. By key, not `is_system`: since migration 0151 only the admin
 * role is a locked system role, and the five others keep their place.
 */
export function sortRoles<
  T extends Pick<Role, 'key' | 'is_system' | 'created_at'>,
>(rows: ReadonlyArray<T>): T[] {
  const rank = (row: T) => {
    const index = SYSTEM_ROLE_ORDER.indexOf(row.key)
    return index === -1 ? SYSTEM_ROLE_ORDER.length : index
  }
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.created_at.localeCompare(b.created_at) ||
      a.key.localeCompare(b.key),
  )
}

export function roleName(
  lang: Language,
  role: Pick<Role, 'name_ar' | 'name_en'> | null | undefined,
): string {
  return localizedName(lang, role?.name_ar, role?.name_en)
}

/** Replaces `{name}`-style placeholders in a translated string. */
export function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

/** `app_settings.roles_system`: the flag with its last change. */
export interface RolesSystemFlag {
  enabled: boolean
  /** `app_settings.updated_at` of the flag row: when it last changed. */
  updatedAt: string | null
  updatedByName: string | null
}

/** The localized description of a role, null when both are empty. */
export function roleDescription(
  lang: Language,
  role: Pick<Role, 'description_ar' | 'description_en'>,
): string | null {
  const text =
    lang === 'ar'
      ? role.description_ar || role.description_en
      : role.description_en || role.description_ar
  return text?.trim() || null
}
