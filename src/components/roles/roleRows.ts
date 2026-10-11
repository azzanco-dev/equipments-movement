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

/** System roles first in their usual order, then custom roles by creation. */
export function sortRoles<
  T extends Pick<Role, 'key' | 'is_system' | 'created_at'>,
>(rows: ReadonlyArray<T>): T[] {
  const rank = (row: T) => {
    if (!row.is_system) return SYSTEM_ROLE_ORDER.length + 1
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
