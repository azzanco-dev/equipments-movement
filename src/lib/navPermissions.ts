import type { PermissionsStatus } from '@/lib/permissions'
import type { PermissionScope } from '@/lib/types'

/**
 * wave 23 (routing by permissions, step 1) — which sidebar entries a user sees.
 *
 * The sidebar / mobile drawer of `src/components/Layout.tsx` is built from the
 * user's PERMISSIONS (`current_permissions()`, migration 0126, loaded by
 * `usePermissions()`), not from `profiles.role`. Roles stage 4a (2026-10-27):
 * there is no role fallback any more; until the permissions are 'ready' the
 * menu is empty and the shell waits ('pending') or shows the load error
 * ('unavailable').
 *
 * Step 2 (below `visibleNavItems`) moved the shell selection and the page
 * guards of src/App.tsx onto the same gates (`planShell`, `pageGate`).
 * Callers pass the pages their current shell can render (`routable`) so the
 * menu never offers a link the router would not open.
 *
 * Every shell has the sidebar (owner 2026-10-28: «نبغى نضيف السايد بار
 * للجميع، بس التابات الي فيه بحسب صلاحيات كل مستخدم»): the admin shell and
 * the foreman and workshop homes alike list exactly the sections the user's
 * permissions pass. The home entry «الرئيسية» needs a home key (home.admin,
 * home.foreman or home.workshop; it opens that user's own home); a user
 * without any home gets the admin shell with just its sections (owner
 * decision 2026-10-13).
 *
 * With the frozen `legacy_role_permissions` mapping of the six roles, the menu
 * built here is exactly the role-based menu of before (tests/wave23Nav.test.cjs
 * proves it for the six roles).
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
  | 'purchasing'
  | 'drivers'
  | 'users'
  | 'activity'
  | 'reports'
  | 'movement-import'
  | 'settings'

export type NavChildKey =
  | 'reports/entries'
  | 'reports/equipment'
  | 'reports/workshop'
  | 'purchasing/orders'
  | 'purchasing/units'

/** One permission key, optionally limited to some of its scopes. */
export interface NavGate {
  key: string
  /** Accepted scopes; omitted = any granted scope. */
  scopes?: readonly PermissionScope[]
  /**
   * Further gates that must ALL pass too (an AND inside this one gate), for
   * a page whose database function checks more than one key.
   */
  with?: readonly NavGate[]
}

export interface NavEntry<K extends string = NavItemKey> {
  key: K
  /** ANY of these gates shows the entry; an empty list = always shown. */
  requires: readonly NavGate[]
  /** Sub-entries; the parent is hidden when none of them is visible. */
  children?: readonly NavEntry<NavChildKey>[]
  /**
   * Reachable by URL only: never listed in the sidebar and never a landing
   * section, while its pages still open for whoever passes its gates
   * (owner 2026-10-20: purchasing goes to production by link only for now).
   */
  hidden?: boolean
}

/**
 * Item -> permission keys, in menu order. The order also decides where a user
 * without `home.admin` lands (`planShell`: the first passing entry).
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  // The home: the admin home with home.admin, the field home with
  // home.foreman / home.workshop (planShell decides which one renders;
  // 2026-10-28, the sidebar for every user). Without any home the admin
  // shell has no dashboard and lands on the first section below.
  {
    key: 'dashboard',
    requires: [
      { key: 'home.admin' },
      { key: 'home.foreman' },
      { key: 'home.workshop' },
    ],
  },
  {
    key: 'logs',
    // 2026-10-28: the `companies` scope reads the rows of the user's
    // companies (RLS), so it opens the log too.
    requires: [
      {
        key: 'movements.read',
        scopes: ['all', 'site', 'workshop', 'companies'],
      },
    ],
  },
  { key: 'inquiry', requires: [{ key: 'inquiry.view' }] },
  { key: 'equipment', requires: [{ key: 'equipment.read' }] },
  { key: 'projects', requires: [{ key: 'companies_projects.read' }] },
  { key: 'companies', requires: [{ key: 'companies_projects.read' }] },
  { key: 'lessors', requires: [{ key: 'lessors.read' }] },
  // Purchasing (migration 0136, screens 2026-10-19): a parent with its
  // sections (owner 2026-10-19: «رئيسية وتحتها فرعيات»), the supplier POs
  // first; the key is held by the admin and the custom «المشتريات» role.
  // Listed in the sidebar since 2026-10-20 (owner: «اظهر التبويب»); `hidden`
  // stays available for an entry that should open by link only.
  {
    key: 'purchasing',
    requires: [{ key: 'purchasing.view' }],
    children: [
      { key: 'purchasing/orders', requires: [{ key: 'purchasing.view' }] },
      // «المعدات في المشاريع» (owner 2026-10-24, migration 0147).
      { key: 'purchasing/units', requires: [{ key: 'purchasing.view' }] },
    ],
  },
  { key: 'drivers', requires: [{ key: 'drivers.read' }] },
  { key: 'users', requires: [{ key: 'users.manage' }] },
  // Owner 2026-10-22: «سجل النشاط» left the sidebar for a Settings card
  // (/activity still opens by link for movements.activity).
  { key: 'activity', requires: [{ key: 'movements.activity' }], hidden: true },
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
        // get_equipment_attention_report also requires movements.read all
        // (2026-10-28), so the page opens only with both.
        requires: [
          {
            key: 'reports.view',
            scopes: ['all'],
            with: [{ key: 'movements.read', scopes: ['all'] }],
          },
        ],
      },
      {
        key: 'reports/workshop',
        requires: [{ key: 'reports.view', scopes: ['workshop', 'all'] }],
      },
    ],
  },
  // Owner 2026-10-22: the Excel import of movements is no longer needed in
  // the menu (the page stays reachable by URL for movements.import).
  {
    key: 'movement-import',
    requires: [{ key: 'movements.import' }],
    hidden: true,
  },
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
  if (gate.scopes && !gate.scopes.includes(scope)) return false
  return (gate.with ?? []).every((other) => passes(permissions, other))
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
  const items: VisibleNavItem[] = []
  for (const entry of NAV_ENTRIES) {
    if (entry.hidden || !allowed(permissions, entry)) continue
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
 * - `loading` / `error`: nothing (roles stage 4a: no role fallback);
 * - `routable`, when given, drops entries the current shell cannot open.
 *
 * Every shell calls this with its open pages (2026-10-28: the sidebar for
 * every user). A menu holding nothing but home is still a menu: the sidebar
 * is always there for a user with a home.
 */
export function visibleNavItems(
  state: NavPermissionState,
  routable?: ReadonlySet<string>,
): VisibleNavItem[] {
  const base =
    state.status === 'ready' ? fromPermissions(state.permissions) : []

  return routable
    ? base.flatMap((item): VisibleNavItem[] => {
        if (!routable.has(item.key)) return []
        if (!item.children) return [item]
        const children = item.children.filter((child) => routable.has(child))
        return children.length ? [{ key: item.key, children }] : []
      })
    : base
}

// ===========================================================================
// wave 23 (routing by permissions, step 2) — the shell and the page guards
// ===========================================================================
//
// Which SHELL a signed-in user gets and which pages render inside it are
// decided here from the same permission keys as the sidebar (NAV_ENTRIES plus
// PAGE_GATES below), not from `profiles.role`:
//
//   home.admin    -> 'admin'    the admin home
//   home.foreman  -> 'foreman'  the field home, own-site list
//   home.workshop -> 'workshop' the field home; scope 'all' = the managers'
//                                variant with the embedded admin log
// Every shell has the sidebar and opens every admin-shell page its
// permissions pass (2026-10-28); the shell only decides which home renders
// at / and a few home-specific details (the workshop form, the way back).
//   none of them, but some sidebar section of NAV_ENTRIES passes
//                 -> 'admin'    the sidebar shell WITHOUT the dashboard: the
//                                sidebar lists the passing sections and the
//                                user lands on the first of them (owner
//                                decision 2026-10-13, e.g. equipment.read
//                                alone -> «المعدات» only, landing /equipment)
//   nothing       -> 'none'     the no-permissions page (fail closed)
//
// Precedence admin > foreman > workshop > sections. While the permissions
// load the shell waits ('pending', the bootstrap spinner); after their load
// failed it is 'unavailable' (the load-error page with a retry). Roles stage
// 4a (2026-10-27) removed the role-based fallback routing of before.

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
  | 'purchasing/:id'
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
  'purchasing/:id': [{ key: 'purchasing.view' }],
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
  if (first === 'purchasing') {
    // /purchasing opens its first section, like /reports; any other second
    // segment is a PO id.
    if (!second || second === 'orders') return 'purchasing/orders'
    if (second === 'units') return 'purchasing/units'
    return 'purchasing/:id'
  }
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
  /** Permissions loaded and they open nothing: the no-permissions page. */
  | 'none'
  /** The permissions failed to load: the load-error page with a retry. */
  | 'unavailable'
  /** The permissions are loading: the bootstrap spinner. */
  | 'pending'

/** Same values as HomeMovementsScope (src/lib/homeScope.ts). */
export type ShellHomeScope =
  | 'all_contexts'
  | 'site_all'
  | 'workshop_all'
  | 'workshop'
  | 'own_site'

export interface ShellPlan {
  kind: ShellKind
  /** 'permissions' once loaded; 'status' while loading or after a failure. */
  source: 'permissions' | 'status'
  /** The field home's movement list, from the home.* scope (field homes). */
  homeScope?: ShellHomeScope
  /**
   * The page a URL the shell does not open lands on: the shell's home
   * ('dashboard'), except in the admin shell without home.admin, where it is
   * the first open section in menu order (src/App.tsx then replaces the URL).
   */
  landing: RoutePage
  /** The pages that render; any other URL renders `landing`. */
  pages: ReadonlySet<RoutePage>
  /**
   * A page OUTSIDE this router to land on instead (2026-10-28): the
   * identity-extraction page (`/extracting`, its own Next route) for a user
   * whose permissions open nothing else. src/App.tsx replaces the URL.
   */
  externalLanding?: '/extracting'
}

type HomeShell = 'admin' | 'foreman' | 'workshop'

/** Every page a shell renders; the gates narrow them further. */
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
  'purchasing',
  'purchasing/orders',
  'purchasing/units',
  'purchasing/:id',
]
/**
 * The field home's own pages (its home, the inquiry, the movement form and
 * page). Since 2026-10-28 a field shell opens every page of
 * ADMIN_SHELL_PAGES its permissions pass, these included (`fieldPages`), so
 * SHELL_PAGES.foreman / .workshop name only the field home's own pages.
 */
const FIELD_SHELL_PAGES: readonly RoutePage[] = [
  'dashboard',
  'inquiry',
  'movements/new',
  'movements/:id',
]
export const SHELL_PAGES: Readonly<Record<HomeShell, readonly RoutePage[]>> = {
  admin: ADMIN_SHELL_PAGES,
  foreman: FIELD_SHELL_PAGES,
  workshop: FIELD_SHELL_PAGES,
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
 * The pages of a field home (2026-10-28, the sidebar for every user): every
 * page the admin shell would open with these permissions, its home included
 * (the dashboard gate passes on home.foreman / home.workshop), so the sidebar
 * never offers a link the router refuses.
 */
function fieldPages(
  permissions: ReadonlyMap<string, PermissionScope>,
): Set<RoutePage> {
  return openPages(permissions, ADMIN_SHELL_PAGES).add('dashboard')
}

/**
 * The first sidebar SECTION (every entry but the dashboard) the permissions
 * pass, in menu order; for a parent with children, its first passing child.
 * The entries listed in the sidebar come first; only when none of them
 * passes, the first passing HIDDEN entry (2026-10-28: a role holding only
 * `movements.activity` or `movements.import` lands on that page instead of
 * the no-permissions page). Undefined when no section passes.
 */
function firstOpenSection(
  permissions: ReadonlyMap<string, PermissionScope>,
): RoutePage | undefined {
  for (const hidden of [false, true])
    for (const entry of NAV_ENTRIES) {
      if (
        entry.key === 'dashboard' ||
        Boolean(entry.hidden) !== hidden ||
        !allowed(permissions, entry)
      )
        continue
      if (!entry.children) return entry.key
      const child = entry.children.find((item) => allowed(permissions, item))
      if (child) return child.key
    }
  return undefined
}

/**
 * The shell for this user and the pages that render in it.
 *
 * - permissions `ready`: home.admin > home.foreman > home.workshop, else the
 *   admin shell without its dashboard when any sidebar section passes
 *   (landing on the first one), else 'none';
 * - `loading`: 'pending' (src/App.tsx keeps the bootstrap spinner);
 * - `error`: 'unavailable' (the load-error page with a retry).
 * Neither opens any page (roles stage 4a: no role fallback).
 */
export function planShell(state: NavPermissionState): ShellPlan {
  if (state.status !== 'ready')
    return {
      kind: state.status === 'loading' ? 'pending' : 'unavailable',
      source: 'status',
      landing: 'dashboard',
      pages: new Set(),
    }

  const permissions = state.permissions
  if (permissions.has('home.admin'))
    return {
      kind: 'admin',
      source: 'permissions',
      landing: 'dashboard',
      pages: openPages(permissions, ADMIN_SHELL_PAGES),
    }
  // The foreman home lists the user's own site movements, unless his
  // movements.read scope is wider (all / site / companies / workshop): then
  // the log embedded (owner 2026-10-28, «رئيس الفورمين … مايشوف غير حقه»).
  // The same rule as homeMovementsScopeFromPermissions in src/lib/homeScope.ts.
  if (permissions.has('home.foreman')) {
    const read = permissions.get('movements.read')
    return {
      kind: 'foreman',
      source: 'permissions',
      homeScope:
        read === 'all' || read === 'site' || read === 'companies'
          ? 'site_all'
          : read === 'workshop'
            ? 'workshop_all'
            : 'own_site',
      landing: 'dashboard',
      pages: fieldPages(permissions),
    }
  }
  const workshopScope = permissions.get('home.workshop')
  if (workshopScope)
    return {
      kind: 'workshop',
      source: 'permissions',
      homeScope: workshopScope === 'all' ? 'all_contexts' : 'workshop',
      landing: 'dashboard',
      pages: fieldPages(permissions),
    }
  // No home at all: the admin shell for the sections the permissions open.
  // The dashboard is gated on home.admin, so openPages leaves it out and the
  // user lands on the first open section instead.
  const landing = firstOpenSection(permissions)
  // Nothing in this router, but the identity-extraction page (its own Next
  // route, gated on extracting.view): land there.
  if (!landing && permissions.has('extracting.view'))
    return {
      kind: 'admin',
      source: 'permissions',
      landing: 'dashboard',
      pages: openPages(permissions, ADMIN_SHELL_PAGES),
      externalLanding: '/extracting',
    }
  if (!landing)
    return {
      kind: 'none',
      source: 'permissions',
      landing: 'dashboard',
      pages: new Set(),
    }
  return {
    kind: 'admin',
    source: 'permissions',
    landing,
    pages: openPages(permissions, ADMIN_SHELL_PAGES),
  }
}
