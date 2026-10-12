import type { PermissionsStatus } from '@/lib/permissions'
import type { PermissionScope } from '@/lib/types'

/**
 * wave 23 (routing by permissions, step 1) — which sidebar entries a user sees.
 *
 * The sidebar / mobile drawer of `src/components/Layout.tsx` is built from the
 * user's PERMISSIONS (`current_permissions()`, migration 0126, loaded by
 * `usePermissions()`), not from `profiles.role`. `role` is ONLY the fallback
 * used while the permissions load or when they failed to load, so the menu
 * never flashes empty and a failed load changes nothing (RLS still protects
 * the data behind every page).
 *
 * Only the navigation moved. The route guards and home selection in
 * src/App.tsx still decide by `profiles.role`; a later step switches them.
 * Callers pass the pages their current shell can render (`routable`) so the
 * menu never offers a link the role-based router would not open.
 *
 * With the roles system OFF, `current_permissions()` answers from the frozen
 * `legacy_role_permissions(profiles.role)` mapping, and the menu built here is
 * exactly the role-based menu of before (tests/wave23Nav.test.cjs proves it
 * for the six roles).
 *
 * This file has no runtime imports so the node tests can load it directly.
 */

export type NavItemKey =
  | 'dashboard'
  | 'logs'
  | 'inquiry'
  | 'equipment'
  | 'projects'
  | 'companies'
  | 'lessors'
  | 'drivers'
  | 'users'
  | 'activity'
  | 'reports'
  | 'movement-import'
  | 'settings'

export type NavChildKey =
  'reports/entries' | 'reports/equipment' | 'reports/workshop'

/** One permission key, optionally limited to some of its scopes. */
export interface NavGate {
  key: string
  /** Accepted scopes; omitted = any granted scope. */
  scopes?: readonly PermissionScope[]
}

export interface NavEntry<K extends string = NavItemKey> {
  key: K
  /** ANY of these gates shows the entry; an empty list = always shown. */
  requires: readonly NavGate[]
  /** Sub-entries; the parent is hidden when none of them is visible. */
  children?: readonly NavEntry<NavChildKey>[]
}

/**
 * The sidebar exists only for the admin-home shell: a user without this key
 * (the foreman and workshop homes) gets no sidebar at all, as before.
 */
export const NAV_SHELL_PERMISSION = 'home.admin'

/** Item -> permission keys, in menu order. */
export const NAV_ENTRIES: readonly NavEntry[] = [
  // Home: always (inside the admin-home shell).
  { key: 'dashboard', requires: [] },
  {
    key: 'logs',
    requires: [{ key: 'movements.read', scopes: ['all', 'site', 'workshop'] }],
  },
  { key: 'inquiry', requires: [{ key: 'inquiry.view' }] },
  { key: 'equipment', requires: [{ key: 'equipment.read' }] },
  { key: 'projects', requires: [{ key: 'companies_projects.read' }] },
  { key: 'companies', requires: [{ key: 'companies_projects.read' }] },
  { key: 'lessors', requires: [{ key: 'lessors.read' }] },
  { key: 'drivers', requires: [{ key: 'drivers.read' }] },
  { key: 'users', requires: [{ key: 'users.manage' }] },
  { key: 'activity', requires: [{ key: 'movements.activity' }] },
  {
    key: 'reports',
    requires: [{ key: 'reports.view' }],
    children: [
      {
        key: 'reports/entries',
        requires: [{ key: 'reports.view', scopes: ['site', 'all'] }],
      },
      {
        key: 'reports/equipment',
        requires: [{ key: 'reports.view', scopes: ['all'] }],
      },
      {
        key: 'reports/workshop',
        requires: [{ key: 'reports.view', scopes: ['workshop', 'all'] }],
      },
    ],
  },
  { key: 'movement-import', requires: [{ key: 'movements.import' }] },
  {
    key: 'settings',
    requires: [
      { key: 'settings.equipment_types' },
      { key: 'settings.integrations' },
      { key: 'settings.roles' },
    ],
  },
]

export interface VisibleNavItem {
  key: NavItemKey
  children?: NavChildKey[]
}

const ADMIN_MENU: readonly VisibleNavItem[] = [
  { key: 'dashboard' },
  { key: 'logs' },
  { key: 'inquiry' },
  { key: 'equipment' },
  { key: 'projects' },
  { key: 'companies' },
  { key: 'lessors' },
  { key: 'drivers' },
  { key: 'users' },
  { key: 'activity' },
  {
    key: 'reports',
    children: ['reports/entries', 'reports/equipment', 'reports/workshop'],
  },
  { key: 'movement-import' },
  { key: 'settings' },
]

/**
 * FALLBACK ONLY: the role-based menu as it was before wave 23, used while the
 * permissions load or after their load failed. The foreman and workshop roles
 * had no sidebar; an unknown role gets none (fail closed).
 */
export const LEGACY_NAV_BY_ROLE: Readonly<
  Record<string, readonly VisibleNavItem[]>
> = {
  admin: ADMIN_MENU,
  monitor: [{ key: 'dashboard' }, { key: 'logs' }, { key: 'inquiry' }],
  supervisor: [],
  workshop: [],
  assistant_workshop_manager: [],
  workshop_manager: [],
}

export interface NavPermissionState {
  status: PermissionsStatus
  permissions: ReadonlyMap<string, PermissionScope>
}

function passes(
  permissions: ReadonlyMap<string, PermissionScope>,
  gate: NavGate,
): boolean {
  const scope = permissions.get(gate.key)
  if (!scope) return false
  return !gate.scopes || gate.scopes.includes(scope)
}

function allowed(
  permissions: ReadonlyMap<string, PermissionScope>,
  entry: NavEntry<string>,
): boolean {
  return (
    entry.requires.length === 0 ||
    entry.requires.some((gate) => passes(permissions, gate))
  )
}

function fromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): VisibleNavItem[] {
  if (!passes(permissions, { key: NAV_SHELL_PERMISSION })) return []
  const items: VisibleNavItem[] = []
  for (const entry of NAV_ENTRIES) {
    if (!allowed(permissions, entry)) continue
    if (!entry.children) {
      items.push({ key: entry.key })
      continue
    }
    const children = entry.children
      .filter((child) => allowed(permissions, child))
      .map((child) => child.key)
    if (children.length) items.push({ key: entry.key, children })
  }
  return items
}

/**
 * The sidebar entries for this user, in menu order.
 *
 * - permissions `ready`: decided by the permission keys (NAV_ENTRIES);
 * - `loading` / `error`: the legacy role-based menu (`role` is only this
 *   fallback; a missing or unknown role gets nothing);
 * - `routable`, when given, drops entries the current shell cannot open.
 *
 * A menu holding nothing but home is returned empty: the sidebar is hidden
 * and home stays reachable through the header logo, sign-out through the
 * header, as for the roles that never had a sidebar.
 */
export function visibleNavItems(
  state: NavPermissionState,
  role: string | null | undefined,
  routable?: ReadonlySet<string>,
): VisibleNavItem[] {
  const base =
    state.status === 'ready'
      ? fromPermissions(state.permissions)
      : (role && Object.prototype.hasOwnProperty.call(LEGACY_NAV_BY_ROLE, role)
          ? LEGACY_NAV_BY_ROLE[role]
          : []
        ).map((item) =>
          item.children ? { ...item, children: [...item.children] } : item,
        )

  const items = routable
    ? base.flatMap((item): VisibleNavItem[] => {
        if (!routable.has(item.key)) return []
        if (!item.children) return [item]
        const children = item.children.filter((child) => routable.has(child))
        return children.length ? [{ key: item.key, children }] : []
      })
    : base

  return items.every((item) => item.key === 'dashboard') ? [] : items
}
