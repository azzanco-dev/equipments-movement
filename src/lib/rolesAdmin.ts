import type { TranslationKey } from '@/i18n/translations'
import type {
  Permission,
  PermissionScope,
  RoleChange,
  RolePermission,
  RolesSystemOffender,
  RolesSystemToggleResult,
  UserRole,
} from '@/lib/types'
import { PERMISSION_SCOPES, isPermissionScope } from '@/lib/permissions'
import { ROLE_KEY_FORMAT } from '@/lib/formValidation'

/**
 * wave 22B — pure helpers of Settings › «الادوار والصلاحيات» (migration 0126).
 * The database validates everything again (admin_set_role_permissions and
 * friends); these helpers only keep the page honest and its messages safe.
 */

// --- Role keys --------------------------------------------------------------

/** `roles.key` (0126 `roles_key_format`), shared with `roleFormSchema`. */
export const ROLE_KEY_PATTERN = ROLE_KEY_FORMAT
export const ROLE_KEY_MAX = 40

/**
 * A role key suggested from the English name: lowercase ASCII letters and
 * digits joined by single underscores, starting with a letter, at most 40
 * characters. Returns '' when the name yields no valid key (an Arabic-only
 * or one-letter name), so the admin types the key himself.
 */
export function suggestRoleKey(nameEn: string): string {
  const words = nameEn
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  let key = words.join('_').replace(/^[^a-z]+/, '')
  if (key.length > ROLE_KEY_MAX) key = key.slice(0, ROLE_KEY_MAX)
  key = key.replace(/_+$/, '')
  return ROLE_KEY_PATTERN.test(key) ? key : ''
}

// --- Scopes -------------------------------------------------------------------

export const SCOPE_LABEL_KEYS: Record<PermissionScope, TranslationKey> = {
  all: 'permissionScopeAll',
  site: 'permissionScopeSite',
  workshop: 'permissionScopeWorkshop',
  companies: 'permissionScopeCompanies',
  own: 'permissionScopeOwn',
}

/** The scopes a key accepts, narrowest first; [] for an unscoped key. */
export function scopeOptions(
  permission: Pick<Permission, 'scoped' | 'scopes'>,
): PermissionScope[] {
  if (!permission.scoped || !permission.scopes) return []
  const accepted = new Set(permission.scopes)
  return PERMISSION_SCOPES.filter((scope) => accepted.has(scope))
}

/** The scope a newly ticked key starts with: its narrowest accepted scope,
 *  null for an unscoped key. */
export function defaultScope(
  permission: Pick<Permission, 'scoped' | 'scopes'>,
): PermissionScope | null {
  return scopeOptions(permission)[0] ?? null
}

// --- The selection of one role ----------------------------------------------

/** `permission_key -> scope` (null for an unscoped key) of one role. */
export type PermissionSelection = Readonly<
  Record<string, PermissionScope | null>
>

export function selectionFromRows(
  rows: ReadonlyArray<Pick<RolePermission, 'permission_key' | 'scope'>>,
): PermissionSelection {
  const selection: Record<string, PermissionScope | null> = {}
  for (const row of rows)
    selection[row.permission_key] = isPermissionScope(row.scope)
      ? row.scope
      : null
  return selection
}

export function selectionsEqual(
  a: PermissionSelection,
  b: PermissionSelection,
): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => key in b && a[key] === b[key])
}

/** The payload of `admin_set_role_permissions`, in a stable order. */
export function toPermissionsPayload(
  selection: PermissionSelection,
): Array<{ key: string; scope: PermissionScope | null }> {
  return Object.keys(selection)
    .sort()
    .map((key) => ({ key, scope: selection[key] ?? null }))
}

type CatalogueEntry = Pick<
  Permission,
  'key' | 'scoped' | 'scopes' | 'requires' | 'admin_only'
>

function catalogueIndex<T extends CatalogueEntry>(
  catalogue: ReadonlyArray<T>,
): Map<string, T> {
  return new Map(catalogue.map((permission) => [permission.key, permission]))
}

/**
 * Ticks `key` and, transitively, every prerequisite (`requires`) that is not
 * ticked yet, each with its default scope. Returns the new selection and the
 * prerequisites it added, so the page can say so. A key that is already
 * ticked keeps its scope.
 */
export function tickPermission(
  selection: PermissionSelection,
  catalogue: ReadonlyArray<CatalogueEntry>,
  key: string,
): { selection: PermissionSelection; autoAdded: string[] } {
  const index = catalogueIndex(catalogue)
  const next: Record<string, PermissionScope | null> = { ...selection }
  const autoAdded: string[] = []
  const visit = (current: string, isRequested: boolean) => {
    const permission = index.get(current)
    if (!permission) return
    if (!(current in next)) {
      next[current] = defaultScope(permission)
      if (!isRequested) autoAdded.push(current)
    }
    for (const required of permission.requires)
      if (!(required in next)) visit(required, false)
  }
  visit(key, true)
  return { selection: next, autoAdded }
}

/** The ticked keys that require `key` (directly). */
export function requiredBy(
  selection: PermissionSelection,
  catalogue: ReadonlyArray<CatalogueEntry>,
  key: string,
): string[] {
  return catalogue
    .filter(
      (permission) =>
        permission.key in selection && permission.requires.includes(key),
    )
    .map((permission) => permission.key)
}

/**
 * Unticks `key` unless a ticked key still requires it; then the selection is
 * returned unchanged with the blocking keys, so the page can explain which
 * ones to untick first (no silent cascade).
 */
export function untickPermission(
  selection: PermissionSelection,
  catalogue: ReadonlyArray<CatalogueEntry>,
  key: string,
): { selection: PermissionSelection; blockedBy: string[] } {
  const blockedBy = requiredBy(selection, catalogue, key)
  if (blockedBy.length > 0) return { selection, blockedBy }
  const next: Record<string, PermissionScope | null> = { ...selection }
  delete next[key]
  return { selection: next, blockedBy: [] }
}

/** Sets the scope of a ticked, scoped key; anything else is ignored. */
export function setPermissionScope(
  selection: PermissionSelection,
  catalogue: ReadonlyArray<CatalogueEntry>,
  key: string,
  scope: string,
): PermissionSelection {
  const permission = catalogueIndex(catalogue).get(key)
  if (!permission || !(key in selection)) return selection
  if (!isPermissionScope(scope) || !scopeOptions(permission).includes(scope))
    return selection
  return { ...selection, [key]: scope }
}

/**
 * The same checks as `admin_set_role_permissions`, per permission key, so the
 * page marks the row before sending: unknown key, scope not accepted,
 * admin-only key on another role, missing prerequisite.
 */
export function selectionProblems(
  selection: PermissionSelection,
  catalogue: ReadonlyArray<CatalogueEntry>,
  roleKey: string,
): Record<string, TranslationKey> {
  const index = catalogueIndex(catalogue)
  const problems: Record<string, TranslationKey> = {}
  for (const [key, scope] of Object.entries(selection)) {
    const permission = index.get(key)
    if (!permission) {
      problems[key] = 'rolesErrUnknownPermission'
      continue
    }
    const options = scopeOptions(permission)
    if (
      permission.scoped
        ? scope === null || !options.includes(scope)
        : scope !== null
    ) {
      problems[key] = 'rolesErrInvalidScope'
      continue
    }
    if (permission.admin_only && roleKey !== 'admin') {
      problems[key] = 'rolesErrAdminOnly'
      continue
    }
    if (permission.requires.some((required) => !(required in selection)))
      problems[key] = 'rolesErrMissingRequired'
  }
  return problems
}

/**
 * Non-blocking hints about scope combinations the database accepts but that
 * do not give what they suggest: `get_equipment_attention_report` (the
 * equipment report) needs `movements.read` with scope `all` besides
 * `reports.view` `all`.
 */
export function selectionScopeHints(
  selection: PermissionSelection,
): Record<string, TranslationKey> {
  const hints: Record<string, TranslationKey> = {}
  if (
    selection['reports.view'] === 'all' &&
    'movements.read' in selection &&
    selection['movements.read'] !== 'all'
  )
    hints['reports.view'] = 'rolePermissionsHintReportsNeedReadAll'
  return hints
}

export interface PermissionGroup<
  T extends Pick<Permission, 'group_key' | 'sort'>,
> {
  key: string
  permissions: T[]
}

/** Groups by `group_key`, groups and keys ordered by the catalogue `sort`. */
export function groupPermissions<
  T extends Pick<Permission, 'key' | 'group_key' | 'sort'>,
>(catalogue: ReadonlyArray<T>): PermissionGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const permission of [...catalogue].sort(
    (a, b) => a.sort - b.sort || a.key.localeCompare(b.key),
  )) {
    const list = groups.get(permission.group_key) ?? []
    list.push(permission)
    groups.set(permission.group_key, list)
  }
  return Array.from(groups.entries()).map(([key, permissions]) => ({
    key,
    permissions,
  }))
}

export const PERMISSION_GROUP_LABEL_KEYS: Record<string, TranslationKey> = {
  home: 'permissionGroupHome',
  movements: 'permissionGroupMovements',
  reports: 'permissionGroupReports',
  equipment: 'permissionGroupEquipment',
  drivers: 'permissionGroupDrivers',
  master_data: 'permissionGroupMasterData',
  users: 'permissionGroupUsers',
  settings: 'permissionGroupSettings',
  map: 'permissionGroupMap',
  purchasing: 'permissionGroupPurchasing',
}

// --- Database errors ------------------------------------------------------------

/** The `RAISE EXCEPTION '<token>'` codes of the 0126 admin functions. */
export const ROLES_ERROR_KEYS: Readonly<Record<string, TranslationKey>> = {
  admin_required: 'rolesErrAdminRequired',
  role_not_found: 'rolesErrRoleNotFound',
  user_not_found: 'rolesErrUserNotFound',
  invalid_role_key: 'roleKeyInvalid',
  invalid_role_name: 'rolesErrInvalidRoleName',
  invalid_role_description: 'roleDescriptionTooLong',
  role_name_taken: 'roleNameTaken',
  invalid_payload: 'rolesErrInvalidPayload',
  invalid_permissions_payload: 'rolesErrInvalidPayload',
  system_role_locked: 'rolesErrSystemRoleLocked',
  role_in_use: 'rolesErrRoleInUse',
  duplicate_permission: 'rolesErrDuplicatePermission',
  unknown_permission: 'rolesErrUnknownPermission',
  invalid_permission_scope: 'rolesErrInvalidScope',
  admin_only_permission: 'rolesErrAdminOnly',
  missing_required_permission: 'rolesErrMissingRequired',
  admin_role_locked: 'rolesErrAdminRoleLocked',
  role_inactive: 'rolesErrRoleInactive',
  cannot_change_own_admin: 'rolesErrCannotChangeOwnAdmin',
  admin_role_mismatch: 'rolesErrAdminMismatch',
  // Raised by the profiles trigger, not by a roles function (user screens).
  roles_system_active_use_assignment: 'roleChangeUseAssignment',
}

export interface RolesRpcError {
  /** The raised token, or null when the error is not one of ours. */
  code: string | null
  /** Translation key of the safe message (generic when unknown). */
  messageKey: TranslationKey
  /** The permission key the DETAIL names (permission errors only). */
  permissionKey: string | null
  /** For missing_required_permission: the prerequisite that is missing. */
  requiredKey: string | null
}

interface ErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
}

/**
 * Turns a Supabase/PostgREST error of a roles RPC into a safe message key and,
 * for the permission errors, the key the DETAIL names. The raw database text
 * is never returned.
 */
export function rolesRpcError(
  error: ErrorLike | null | undefined,
  fallback: TranslationKey = 'rolesErrGeneric',
): RolesRpcError {
  const message = (error?.message ?? '').trim()
  // Exact token first (that is how RAISE EXCEPTION '<token>' arrives), then
  // the longest token contained in the text.
  let code: string | null = message in ROLES_ERROR_KEYS ? message : null
  if (!code) {
    const lower = message.toLowerCase()
    code =
      Object.keys(ROLES_ERROR_KEYS)
        .sort((a, b) => b.length - a.length)
        .find((token) => new RegExp(`\\b${token}\\b`).test(lower)) ?? null
  }
  if (!code)
    return {
      code: null,
      messageKey: fallback,
      permissionKey: null,
      requiredKey: null,
    }
  let permissionKey: string | null = null
  let requiredKey: string | null = null
  const details = (error?.details ?? '').trim()
  const permissionPattern = /^[a-z_]+(\.[a-z_]+)+$/
  if (details) {
    const requires = /^(\S+) requires (\S+)$/.exec(details)
    if (requires) {
      if (permissionPattern.test(requires[1])) permissionKey = requires[1]
      if (permissionPattern.test(requires[2])) requiredKey = requires[2]
    } else if (permissionPattern.test(details)) permissionKey = details
  }
  return {
    code,
    messageKey: ROLES_ERROR_KEYS[code],
    permissionKey,
    requiredKey,
  }
}

// --- Activation -------------------------------------------------------------

export const OFFENDER_REASON_KEYS: Record<
  RolesSystemOffender['reason'],
  TranslationKey
> = {
  no_role: 'rolesOffenderNoRole',
  unknown_role: 'rolesOffenderUnknownRole',
  inactive_role: 'rolesOffenderInactiveRole',
  admin_mismatch: 'rolesOffenderAdminMismatch',
}

export function offenderReasonKey(reason: string): TranslationKey {
  return (
    OFFENDER_REASON_KEYS[reason as RolesSystemOffender['reason']] ??
    'rolesOffenderUnknownRole'
  )
}

/** `app_settings.roles_system.value`: enabled only for a literal `true`. */
export function rolesSystemEnabledFromValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { enabled?: unknown }).enabled === true
  )
}

/** A defensive read of the `set_roles_system_enabled` answer. */
export function parseToggleResult(data: unknown): RolesSystemToggleResult {
  const value = (data ?? {}) as Partial<RolesSystemToggleResult>
  return {
    enabled: value.enabled === true,
    changed: value.changed === true,
    offenders: Array.isArray(value.offenders) ? value.offenders : [],
    reason:
      value.reason === 'offenders' || value.reason === 'preview_changed'
        ? value.reason
        : null,
    preview_rows:
      typeof value.preview_rows === 'number' ? value.preview_rows : null,
  }
}

/**
 * Mirrors the `sync_profile_role_assignment` trigger (0126): while the roles
 * system is ON, changing a user's legacy role (`profiles.role`) is refused
 * with `roles_system_active_use_assignment` when neither role is admin and the
 * user's assignment was customised (differs from the old legacy role). The
 * user page checks it first so the `manage-user` Edge Function, which writes
 * the login details before the profile, is not called for a doomed change.
 * An unknown flag (null) is not blocked here; the database still decides.
 */
export function legacyRoleChangeBlocked(input: {
  rolesSystemEnabled: boolean | null
  oldRole: string
  newRole: string
  /** `profile_roles.role_key`, null when the user has no assignment. */
  assignedRoleKey: string | null
}): boolean {
  return (
    input.rolesSystemEnabled === true &&
    input.newRole !== input.oldRole &&
    input.newRole !== 'admin' &&
    input.oldRole !== 'admin' &&
    input.assignedRoleKey !== null &&
    input.assignedRoleKey !== input.oldRole
  )
}

/** The typed confirmation matches the word (surrounding spaces ignored). */
export function confirmationMatches(typed: string, word: string): boolean {
  return typed.replace(/\s+/g, ' ').trim() === word.trim()
}

/**
 * Whether the enable button may be pressed: the offenders and the preview
 * were loaded (the preview row count is what the admin acknowledges), there
 * is no offender, the system is not already enabled, nothing is running, and
 * the confirmation word was typed. Never true by default.
 */
export function canEnableRolesSystem(input: {
  enabled: boolean | null
  offendersLoaded: boolean
  offenderCount: number
  previewLoaded: boolean
  typed: string
  word: string
  busy: boolean
}): boolean {
  return (
    input.enabled === false &&
    input.offendersLoaded &&
    input.offenderCount === 0 &&
    input.previewLoaded &&
    !input.busy &&
    confirmationMatches(input.typed, input.word)
  )
}

/** One row of `admin_roles_system_preview()`. */
export interface RolesSystemPreviewRow {
  profile_id: string
  full_name: string
  legacy_role: UserRole | string
  role_key: string | null
  permission_key: string
  legacy_scope: PermissionScope | null
  active_scope: PermissionScope | null
  change: 'gained' | 'lost' | 'scope_changed'
}

export interface RolesSystemPreviewUser {
  profile_id: string
  full_name: string
  legacy_role: string
  role_key: string | null
  gained: RolesSystemPreviewRow[]
  lost: RolesSystemPreviewRow[]
  scope_changed: RolesSystemPreviewRow[]
}

/** The preview grouped by user, in the order the function returned. */
export function groupPreviewByUser(
  rows: ReadonlyArray<RolesSystemPreviewRow>,
): RolesSystemPreviewUser[] {
  const users = new Map<string, RolesSystemPreviewUser>()
  for (const row of rows) {
    let user = users.get(row.profile_id)
    if (!user) {
      user = {
        profile_id: row.profile_id,
        full_name: row.full_name,
        legacy_role: row.legacy_role,
        role_key: row.role_key,
        gained: [],
        lost: [],
        scope_changed: [],
      }
      users.set(row.profile_id, user)
    }
    if (row.change === 'gained') user.gained.push(row)
    else if (row.change === 'lost') user.lost.push(row)
    else if (row.change === 'scope_changed') user.scope_changed.push(row)
  }
  return Array.from(users.values())
}

// --- Audit ----------------------------------------------------------------------

export const ROLE_CHANGE_ACTION_KEYS: Record<
  RoleChange['action'],
  TranslationKey
> = {
  seeded: 'roleChangeSeeded',
  role_created: 'roleChangeRoleCreated',
  role_updated: 'roleChangeRoleUpdated',
  role_deleted: 'roleChangeRoleDeleted',
  permission_granted: 'roleChangePermissionGranted',
  permission_scope_changed: 'roleChangePermissionScopeChanged',
  permission_revoked: 'roleChangePermissionRevoked',
  role_assigned: 'roleChangeRoleAssigned',
  role_reassigned: 'roleChangeRoleReassigned',
  role_unassigned: 'roleChangeRoleUnassigned',
  roles_system_enabled: 'roleChangeSystemEnabled',
  roles_system_disabled: 'roleChangeSystemDisabled',
  setting_changed: 'roleChangeSettingChanged',
}

export function roleChangeActionKey(action: string): TranslationKey {
  return (
    ROLE_CHANGE_ACTION_KEYS[action as RoleChange['action']] ??
    'roleChangeSettingChanged'
  )
}

/**
 * The old/new value of an audit row, reduced to what the log shows:
 * permission rows -> scope, assignment rows -> role key, role rows -> the
 * Arabic name and the active flag, the flag row -> enabled. Raw JSON is never
 * shown as is.
 */
export type RoleChangeValue =
  | { kind: 'scope'; scope: PermissionScope | null }
  | { kind: 'role'; roleKey: string }
  | {
      kind: 'roleRow'
      nameAr: string | null
      nameEn: string | null
      active: boolean | null
    }
  | { kind: 'enabled'; enabled: boolean }
  | null

export function roleChangeValue(
  action: string,
  value: unknown,
): RoleChangeValue {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (action.startsWith('permission_'))
    return {
      kind: 'scope',
      scope: isPermissionScope(record.scope) ? record.scope : null,
    }
  if (action.startsWith('role_') && 'role_key' in record) {
    return typeof record.role_key === 'string'
      ? { kind: 'role', roleKey: record.role_key }
      : null
  }
  if (action.startsWith('role_'))
    return {
      kind: 'roleRow',
      nameAr: typeof record.name_ar === 'string' ? record.name_ar : null,
      nameEn: typeof record.name_en === 'string' ? record.name_en : null,
      active: typeof record.is_active === 'boolean' ? record.is_active : null,
    }
  if (action.startsWith('roles_system_') || action === 'setting_changed')
    return {
      kind: 'enabled',
      enabled: rolesSystemEnabledFromValue(record.value),
    }
  return null
}
