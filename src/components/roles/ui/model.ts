import type { TranslationKey } from '@/i18n/translations'
import type { BadgeTone } from '@/components/ui'
import type { Permission, PermissionScope } from '@/lib/types'
import type { PermissionSelection } from '@/lib/rolesAdmin'

/**
 * The display model of the roles & permissions page, shared by the real page
 * (`src/components/roles/RolesSettings.tsx`, fed from Supabase) and the
 * approved mockup on /ui-kit (`src/screens/ui-kit/RolesPageMockup.tsx`, fed
 * from sample data). Nothing in `src/components/roles/ui/**` reads or writes
 * the database; the containers map rows to these items and pass callbacks.
 */

/** `permission_key -> scope` (null for an unscoped key): the grants of one role. */
export type Grants = PermissionSelection

export interface RoleItem {
  key: string
  /** Name in the interface language. */
  name: string
  /** The other name, matched by the list search. */
  nameEn: string
  description: string | null
  isSystem: boolean
  isActive: boolean
  userCount: number
}

export interface PermissionItem {
  key: string
  group: string
  name: string
  description: string
  /** Accepted scopes, narrowest first; [] for an unscoped key. */
  scopes: PermissionScope[]
  requires: string[]
  adminOnly: boolean
  enforcedIn: Permission['enforced_in']
}

export interface PermissionGroupItem {
  key: string
  name: string
  /** Opens collapsed (the reserved purchasing keys). */
  collapsed?: boolean
}

export interface RoleUserItem {
  id: string
  name: string
  legacyLabel: string
  legacyTone: BadgeTone
  /** Formatted date of the assignment, null when unknown. */
  since: string | null
}

export interface ChangeItem {
  id: string
  roleKey: string | null
  who: string
  when: string
  what: string
}

/** One candidate of «اسناد مستخدم»: an AsyncSearchSelect option plus the
 *  role the user holds today (null when none), for the one-role note. */
export interface AssignCandidate {
  value: string
  label: string
  description?: string
  currentRoleName: string | null
}

/** A row of the activation blockers (`admin_roles_system_offenders()`). */
export interface OffenderItem {
  id: string
  name: string
  legacyLabel: string
  roleLabel: string
  reasonLabel: string
}

/** One user of the activation preview (`admin_roles_system_preview()`). */
export interface PreviewUserItem {
  id: string
  name: string
  legacyLabel: string
  roleLabel: string
  gained: string[]
  lost: string[]
  scopeChanged: string[]
}

export type Loaded<T> =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; rows: T[] }

/** The catalogue shape the `rolesAdmin` selection helpers expect. */
export function toCatalogue(
  permissions: ReadonlyArray<PermissionItem>,
): Array<
  Pick<Permission, 'key' | 'scoped' | 'scopes' | 'requires' | 'admin_only'>
> {
  return permissions.map((permission) => ({
    key: permission.key,
    scoped: permission.scopes.length > 0,
    scopes: permission.scopes.length > 0 ? permission.scopes : null,
    requires: permission.requires,
    admin_only: permission.adminOnly,
  }))
}

export const normalise = (value: string) => value.trim().toLowerCase()

export function matchesPermission(permission: PermissionItem, query: string) {
  if (!query) return true
  const q = normalise(query)
  return (
    normalise(permission.name).includes(q) ||
    normalise(permission.key).includes(q) ||
    normalise(permission.description).includes(q)
  )
}

export function matchesRole(role: RoleItem, query: string) {
  const q = normalise(query)
  return (
    !q ||
    normalise(role.name).includes(q) ||
    normalise(role.nameEn).includes(q) ||
    role.key.includes(q)
  )
}

/** Requirements of a granted key that the draft no longer holds. */
export function missingRequirements(
  grants: Grants,
  byKey: ReadonlyMap<string, PermissionItem>,
  key: string,
): string[] {
  const permission = byKey.get(key)
  if (!permission || !(key in grants)) return []
  return permission.requires.filter((required) => !(required in grants))
}

export type GrantChange = {
  key: string
  kind: 'added' | 'removed' | 'scope'
}

export function diffGrants(base: Grants, draft: Grants): GrantChange[] {
  const changes: GrantChange[] = []
  for (const key of Object.keys(draft)) {
    if (!(key in base)) changes.push({ key, kind: 'added' })
    else if (base[key] !== draft[key]) changes.push({ key, kind: 'scope' })
  }
  for (const key of Object.keys(base)) {
    if (!(key in draft)) changes.push({ key, kind: 'removed' })
  }
  return changes
}

export type CountLabelKeys = {
  none: TranslationKey
  one: TranslationKey
  two: TranslationKey
  few: TranslationKey
  many: TranslationKey
}

export const USERS_COUNT_KEYS: CountLabelKeys = {
  none: 'rolesUsersCountNone',
  one: 'rolesUsersCountOne',
  two: 'rolesUsersCountTwo',
  few: 'rolesUsersCountFew',
  many: 'rolesUsersCountMany',
}

export const CHANGES_COUNT_KEYS: CountLabelKeys = {
  none: 'rolesChangesCountNone',
  one: 'rolesChangesCountOne',
  two: 'rolesChangesCountTwo',
  few: 'rolesChangesCountFew',
  many: 'rolesChangesCountMany',
}

/** Arabic plural forms: 0, 1, 2, 3–10, 11+ (English keys repeat a form). */
export function countLabel(
  t: (key: TranslationKey) => string,
  keys: CountLabelKeys,
  count: number,
): string {
  const key =
    count === 0
      ? keys.none
      : count === 1
        ? keys.one
        : count === 2
          ? keys.two
          : count <= 10
            ? keys.few
            : keys.many
  return t(key).replace('{count}', String(count))
}
