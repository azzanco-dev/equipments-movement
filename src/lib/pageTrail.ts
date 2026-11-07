import type { TranslationKey } from '@/i18n/translations'
import type { RoutePage } from '@/lib/navPermissions'

/**
 * The trail above the title of every detail and settings page (owner
 * 2026-11-07, «ونضيف breadcrumbs», approved on /ui-kit «المسار وازرار
 * الرجوع», variant «ب»: the trail with a small back button before it, one
 * back line on a phone). «المشتريات › اوامر الشراء › PO-2026110001»: every
 * crumb but the last is a real link to its page; the last one is the page
 * itself (the record once loaded, null while it loads).
 */

export interface TrailCrumb {
  label: string
  /** The page's path; omitted for the current page, or when the shell does
   *  not open that page (then the crumb is plain text). */
  href?: string
}

export interface PageTrail {
  /** The parents, oldest first, then the current page. */
  crumbs: TrailCrumb[]
  /** The parent the back button falls back to (its path). */
  parentPath: string
  parentLabel: string
}

type Parent = readonly [label: TranslationKey, path: string]

const LOGS: Parent = ['navLogs', '/logs']
const HOME: Parent = ['dashboard', '/dashboard']
const SETTINGS: Parent = ['settings', '/settings']
const PURCHASING: Parent = ['purchasing', '/purchasing']
const SALES: Parent = ['sales', '/sales']

type TrailSpec = {
  parents: readonly Parent[]
  /** The current page's own name (a settings page); a record page names
   *  its record instead. */
  name?: TranslationKey
}

const SPECS: Partial<Record<RoutePage, TrailSpec>> = {
  'movements/:id': { parents: [LOGS] },
  'equipment/:id': { parents: [['equipment', '/equipment']] },
  'drivers/:id': { parents: [['drivers', '/drivers']] },
  'users/:id': { parents: [['users', '/users']] },
  'purchasing/:id': {
    parents: [PURCHASING, ['supplierPos', '/purchasing/orders']],
  },
  'sales/:id': { parents: [SALES, ['clientPos', '/sales/orders']] },
  // Since 0174 the cards are reached from «اسعار المعدات».
  'sales/cards/:id': { parents: [SALES, ['cardPrices', '/sales/prices']] },
  'settings/equipment-types': { parents: [SETTINGS], name: 'equipmentTypes' },
  'settings/workshop-opening-balance': {
    parents: [SETTINGS],
    name: 'workshopOpeningBalance',
  },
  'settings/afaqy': { parents: [SETTINGS], name: 'afaqySettingsTitle' },
  'settings/banks': { parents: [SETTINGS], name: 'banks' },
  'settings/roles': { parents: [SETTINGS], name: 'rolesSettingsTitle' },
}

export interface PageTrailOptions {
  /** A field home (foreman / workshop): a movement's parent is the home. */
  fieldHome?: boolean
  movementType?: 'entry' | 'exit'
  /** Whether the current shell opens a path; a parent it does not open is
   *  shown as plain text. */
  opens?: (path: string) => boolean
}

/**
 * The trail of a page, or null for a page without one (the home, a list).
 * `record` is the record a detail page names (the tab title's record).
 */
export function pageTrail(
  page: RoutePage,
  t: (key: TranslationKey) => string,
  record: string | null,
  options: PageTrailOptions = {},
): PageTrail | null {
  const { fieldHome = false, movementType = 'entry', opens } = options
  let spec: TrailSpec | undefined
  let current: string | null
  if (page === 'movements/new') {
    spec = { parents: [LOGS] }
    current = t(movementType === 'exit' ? 'registerExit' : 'registerEntry')
  } else {
    spec = SPECS[page]
    current = spec?.name ? t(spec.name) : record
  }
  if (!spec) return null
  const parents =
    fieldHome && (page === 'movements/:id' || page === 'movements/new')
      ? [HOME]
      : spec.parents
  const crumbs: TrailCrumb[] = parents.map(([label, path]) => ({
    label: t(label),
    href: !opens || opens(path) ? path : undefined,
  }))
  // While a record loads its crumb is an empty placeholder.
  crumbs.push({ label: current ?? '' })
  const [parentLabel, parentPath] = parents[parents.length - 1]
  return { crumbs, parentPath, parentLabel: t(parentLabel) }
}

/** The pages that carry a trail. */
export function hasPageTrail(page: RoutePage): boolean {
  return page === 'movements/new' || page in SPECS
}
