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
 * Step 2 (below `visibleNavItems`) moved the shell selection and the page
 * guards of src/App.tsx onto the same gates (`planShell`, `pageGate`).
 * Callers pass the pages their current shell can render (`routable`) so the
 * menu never offers a link the router would not open.
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

// ===========================================================================
// wave 23 (routing by permissions, step 2) — the shell and the page guards
// ===========================================================================
//
// Which SHELL a signed-in user gets and which pages render inside it are
// decided here from the same permission keys as the sidebar (NAV_ENTRIES plus
// PAGE_GATES below), not from `profiles.role`:
//
//   home.admin    -> 'admin'    the sidebar shell with the admin home
//   home.foreman  -> 'foreman'  the field home, own-site list
//   home.workshop -> 'workshop' the field home; scope 'all' = the managers'
//                                variant with the embedded admin log
//   none of them  -> 'minimal'  no sidebar, lands on /inquiry or /logs
//                 -> 'none'     the no-permissions page (fail closed)
//
// Precedence admin > foreman > workshop. While the permissions load, or after
// their load failed, the decision is the role-based routing of before
// (LEGACY_SHELL_BY_ROLE, captured from src/App.tsx at 8f17f53), so a legacy
// user never sees a flash and a failed load changes nothing.
//
// Only the shell and its page guards moved. In-screen actions, data hooks,
// API routes and Edge Functions still decide by the role.

/** Every page src/App.tsx can route to. `:id` stands for any detail id. */
export type RoutePage =
  | NavItemKey
  | NavChildKey
  | 'reports/entries/all'
  | 'settings/equipment-types'
  | 'settings/workshop-opening-balance'
  | 'settings/afaqy'
  | 'settings/roles'
  | 'movements/new'
  | 'movements/:id'
  | 'equipment/:id'
  | 'drivers/:id'
  | 'users/:id'
  | 'print/export'

type ExtraPage = Exclude<RoutePage, NavItemKey | NavChildKey>

/** The gates of the routable pages that are not sidebar entries. */
const PAGE_GATES: Readonly<Record<ExtraPage, readonly NavGate[]>> = {
  // The full list behind the entries report (same gate as the report).
  'reports/entries/all': [{ key: 'reports.view', scopes: ['site', 'all'] }],
  'settings/equipment-types': [{ key: 'settings.equipment_types' }],
  // add_workshop_opening_balance is gated on movements.import (0127).
  'settings/workshop-opening-balance': [{ key: 'movements.import' }],
  'settings/afaqy': [{ key: 'settings.integrations' }],
  'settings/roles': [{ key: 'settings.roles' }],
  'movements/new': [
    { key: 'movements.site.create' },
    { key: 'movements.workshop.create' },
  ],
  // Any read scope: RLS decides which movement rows the user may open.
  'movements/:id': [{ key: 'movements.read' }],
  'equipment/:id': [{ key: 'equipment.read' }],
  'drivers/:id': [{ key: 'drivers.read' }],
  'users/:id': [{ key: 'users.manage' }],
  'print/export': [{ key: 'movements.export' }],
}

/** A gate no permission passes (fail closed for an unknown page). */
const CLOSED: readonly NavGate[] = [{ key: '' }]

/**
 * The gates of one routable page: ANY passing gate opens it; an empty list
 * opens it in every shell that has it. Sidebar entries and their children
 * reuse NAV_ENTRIES, so the menu and the guards cannot drift apart.
 */
export function pageGate(page: RoutePage): readonly NavGate[] {
  if (Object.prototype.hasOwnProperty.call(PAGE_GATES, page))
    return PAGE_GATES[page as ExtraPage]
  for (const entry of NAV_ENTRIES) {
    if (entry.key === page) return entry.requires
    for (const child of entry.children ?? [])
      if (child.key === page) return child.requires
  }
  return CLOSED
}

const TOP_LEVEL_PAGES: ReadonlySet<string> = new Set(
  NAV_ENTRIES.map((entry) => entry.key),
)
const SETTINGS_SUBPAGES: ReadonlySet<string> = new Set([
  'equipment-types',
  'workshop-opening-balance',
  'afaqy',
])

/**
 * The page a URL asks for (path segments, no query). Mirrors how src/App.tsx
 * read the URL before wave 23: an unknown path asks for the dashboard.
 */
export function routePageOf(segments: readonly string[]): RoutePage {
  const [first = '', second, third] = segments
  if (first === 'print')
    return second === 'export' ? 'print/export' : 'dashboard'
  if (first === 'movements') {
    if (second === 'new') return 'movements/new'
    return second ? 'movements/:id' : 'dashboard'
  }
  if (first === 'equipment' && second) return 'equipment/:id'
  if (first === 'drivers' && second) return 'drivers/:id'
  if (first === 'users' && second) return 'users/:id'
  if (first === 'reports') {
    if (second === 'workshop') return 'reports/workshop'
    if (second === 'equipment') return 'reports/equipment'
    if (second === 'entries' && third === 'all') return 'reports/entries/all'
    return 'reports/entries'
  }
  if (first === 'settings') {
    if (second === 'roles') return 'settings/roles'
    // AdminSettings matches these sub-pages on the exact pathname.
    if (segments.length === 2 && second && SETTINGS_SUBPAGES.has(second))
      return `settings/${second}` as RoutePage
    return 'settings'
  }
  return TOP_LEVEL_PAGES.has(first) ? (first as NavItemKey) : 'dashboard'
}

/** The sidebar entry a page belongs to (the Layout's `activePage`). */
export function navKeyOfPage(page: RoutePage): NavItemKey {
  if (page === 'print/export' || page.startsWith('movements/'))
    return 'dashboard'
  return page.split('/')[0] as NavItemKey
}

export type ShellKind =
  | 'admin'
  | 'foreman'
  | 'workshop'
  | 'minimal'
  /** Permissions loaded and they open nothing: the no-permissions page. */
  | 'none'
  /** Fallback only: an unknown role after a failed load (as before). */
  | 'unavailable'
  /** Fallback only: an unknown role while the permissions load. */
  | 'pending'

/** Same values as HomeMovementsScope (src/lib/homeScope.ts). */
export type ShellHomeScope = 'all_contexts' | 'workshop' | 'own_site'

export interface ShellPlan {
  kind: ShellKind
  /** 'permissions' once loaded; 'role' while loading or after a failure. */
  source: 'permissions' | 'role'
  /**
   * The field home's movement list, from the home.* scope. Undefined in the
   * role fallback, where HomeScreen keeps deriving it from the role.
   */
  homeScope?: ShellHomeScope
  /** The minimal shell's landing page. */
  landing?: 'inquiry' | 'logs'
  /** The pages that render; any other URL renders the shell's home. */
  pages: ReadonlySet<RoutePage>
}

type HomeShell = 'admin' | 'foreman' | 'workshop'

/** The pages each shell can render at all; the gates narrow them further. */
const ADMIN_SHELL_PAGES: readonly RoutePage[] = [
  'dashboard',
  'logs',
  'inquiry',
  'equipment',
  'projects',
  'companies',
  'lessors',
  'drivers',
  'users',
  'activity',
  'reports',
  'reports/entries',
  'reports/entries/all',
  'reports/equipment',
  'reports/workshop',
  'movement-import',
  'settings',
  'settings/equipment-types',
  'settings/workshop-opening-balance',
  'settings/afaqy',
  'settings/roles',
  'movements/new',
  'movements/:id',
  'equipment/:id',
  'drivers/:id',
  'users/:id',
]
const FIELD_SHELL_PAGES: readonly RoutePage[] = [
  'dashboard',
  'inquiry',
  'movements/new',
  'movements/:id',
]
const MINIMAL_SHELL_PAGES: readonly RoutePage[] = [
  'inquiry',
  'logs',
  'movements/:id',
]

export const SHELL_PAGES: Readonly<
  Record<HomeShell | 'minimal', readonly RoutePage[]>
> = {
  admin: ADMIN_SHELL_PAGES,
  foreman: FIELD_SHELL_PAGES,
  workshop: FIELD_SHELL_PAGES,
  minimal: MINIMAL_SHELL_PAGES,
}

/**
 * FALLBACK ONLY: the role-based routing of src/App.tsx at 8f17f53 — the
 * shell of each legacy role and the pages it rendered (the print page sits
 * outside every shell; it was admin and monitor only).
 */
export const LEGACY_SHELL_BY_ROLE: Readonly<
  Record<string, { kind: HomeShell; pages: readonly RoutePage[] }>
> = {
  admin: { kind: 'admin', pages: [...ADMIN_SHELL_PAGES, 'print/export'] },
  monitor: {
    kind: 'admin',
    pages: ['dashboard', 'logs', 'inquiry', 'movements/:id', 'print/export'],
  },
  supervisor: { kind: 'foreman', pages: FIELD_SHELL_PAGES },
  workshop: { kind: 'workshop', pages: FIELD_SHELL_PAGES },
  assistant_workshop_manager: { kind: 'workshop', pages: FIELD_SHELL_PAGES },
  workshop_manager: { kind: 'workshop', pages: FIELD_SHELL_PAGES },
}

/** True when ANY gate of `page` passes (an empty list always passes). */
export function canOpenPage(
  permissions: ReadonlyMap<string, PermissionScope>,
  page: RoutePage,
): boolean {
  const gates = pageGate(page)
  return gates.length === 0 || gates.some((gate) => passes(permissions, gate))
}

function openPages(
  permissions: ReadonlyMap<string, PermissionScope>,
  shellPages: readonly RoutePage[],
): Set<RoutePage> {
  const pages = new Set(
    shellPages.filter((page) => canOpenPage(permissions, page)),
  )
  // The print page renders outside the shell, for anyone who may export.
  if (canOpenPage(permissions, 'print/export')) pages.add('print/export')
  return pages
}

/**
 * The shell for this user and the pages that render in it.
 *
 * - permissions `ready`: home.admin > home.foreman > home.workshop, else the
 *   minimal shell when /inquiry or /logs opens, else 'none';
 * - `loading` / `error`: LEGACY_SHELL_BY_ROLE (`role` is only this
 *   fallback). An unknown role waits ('pending') while loading and gets the
 *   role-unavailable page of before after a failure.
 */
export function planShell(
  state: NavPermissionState,
  role: string | null | undefined,
): ShellPlan {
  if (state.status !== 'ready') {
    const legacy =
      role && Object.prototype.hasOwnProperty.call(LEGACY_SHELL_BY_ROLE, role)
        ? LEGACY_SHELL_BY_ROLE[role]
        : null
    if (!legacy)
      return {
        kind: state.status === 'loading' ? 'pending' : 'unavailable',
        source: 'role',
        pages: new Set(),
      }
    return { kind: legacy.kind, source: 'role', pages: new Set(legacy.pages) }
  }

  const permissions = state.permissions
  if (permissions.has('home.admin'))
    return {
      kind: 'admin',
      source: 'permissions',
      pages: openPages(permissions, ADMIN_SHELL_PAGES),
    }
  // The field home has a single foreman variant (own site movements), so
  // every home.foreman scope gets it.
  if (permissions.has('home.foreman'))
    return {
      kind: 'foreman',
      source: 'permissions',
      homeScope: 'own_site',
      pages: openPages(permissions, FIELD_SHELL_PAGES),
    }
  const workshopScope = permissions.get('home.workshop')
  if (workshopScope)
    return {
      kind: 'workshop',
      source: 'permissions',
      homeScope: workshopScope === 'all' ? 'all_contexts' : 'workshop',
      pages: openPages(permissions, FIELD_SHELL_PAGES),
    }
  const pages = openPages(permissions, MINIMAL_SHELL_PAGES)
  const landing = pages.has('inquiry')
    ? 'inquiry'
    : pages.has('logs')
      ? 'logs'
      : undefined
  if (!landing) return { kind: 'none', source: 'permissions', pages: new Set() }
  return { kind: 'minimal', source: 'permissions', landing, pages }
}
