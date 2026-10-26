import type { TranslationKey } from '@/i18n/translations'
import type { RoutePage } from '@/lib/navPermissions'

// The browser tab's title (owner 2026-10-25, «اسماء التابات تتغير بناء على
// الصفحة»): the most specific part first, since a narrow tab shows only its
// start, joined by « · ». The home and the top-level lists end with the
// app's name; a sub-page ends with its section; a detail page shows its
// record (code, PO number, name) then its section, and only the section with
// the app's name while the record loads.

export const TAB_TITLE_SEPARATOR = ' · '

type TitleSpec =
  /** The home or a top-level list: «name · app». */
  | { kind: 'top'; name: TranslationKey }
  /** A sub-page: «name · section». */
  | { kind: 'sub'; name: TranslationKey; section: TranslationKey }
  /** A record's page: «record · section» («section · app» while loading). */
  | { kind: 'detail'; section: TranslationKey }

const PAGE_TITLES: Readonly<
  Record<Exclude<RoutePage, 'print/export' | 'movements/new'>, TitleSpec>
> = {
  dashboard: { kind: 'top', name: 'dashboard' },
  logs: { kind: 'top', name: 'navLogs' },
  inquiry: { kind: 'top', name: 'inquiryPageTitle' },
  equipment: { kind: 'top', name: 'equipment' },
  projects: { kind: 'top', name: 'projects' },
  companies: { kind: 'top', name: 'companies' },
  lessors: { kind: 'top', name: 'lessors' },
  purchasing: { kind: 'top', name: 'purchasing' },
  drivers: { kind: 'top', name: 'drivers' },
  users: { kind: 'top', name: 'users' },
  activity: { kind: 'top', name: 'activityLog' },
  reports: { kind: 'top', name: 'reports' },
  'movement-import': { kind: 'top', name: 'movementImport' },
  settings: { kind: 'top', name: 'settings' },
  'reports/entries': { kind: 'sub', name: 'entryReports', section: 'reports' },
  'reports/entries/all': {
    kind: 'sub',
    name: 'entryReports',
    section: 'reports',
  },
  'reports/equipment': {
    kind: 'sub',
    name: 'equipmentReports',
    section: 'reports',
  },
  'reports/workshop': {
    kind: 'sub',
    name: 'workshopReports',
    section: 'reports',
  },
  'purchasing/orders': {
    kind: 'sub',
    name: 'supplierPos',
    section: 'purchasing',
  },
  'purchasing/units': { kind: 'sub', name: 'siteUnits', section: 'purchasing' },
  'settings/equipment-types': {
    kind: 'sub',
    name: 'equipmentTypes',
    section: 'settings',
  },
  'settings/workshop-opening-balance': {
    kind: 'sub',
    name: 'workshopOpeningBalance',
    section: 'settings',
  },
  'settings/afaqy': {
    kind: 'sub',
    name: 'afaqySettingsTitle',
    section: 'settings',
  },
  'settings/roles': {
    kind: 'sub',
    name: 'rolesSettingsTitle',
    section: 'settings',
  },
  'movements/:id': { kind: 'detail', section: 'tabMovements' },
  'equipment/:id': { kind: 'detail', section: 'equipment' },
  'drivers/:id': { kind: 'detail', section: 'drivers' },
  'users/:id': { kind: 'detail', section: 'users' },
  'purchasing/:id': { kind: 'detail', section: 'supplierPos' },
}

const join = (...parts: string[]) => parts.join(TAB_TITLE_SEPARATOR)

/**
 * The tab title of a page. `record` is what a detail page (or a list's open
 * record dialog, the driver) names once loaded. Null for the print page,
 * which names its own tab.
 */
export function tabTitle(
  page: RoutePage,
  t: (key: TranslationKey) => string,
  record: string | null,
  movementType: 'entry' | 'exit' = 'entry',
): string | null {
  if (page === 'print/export') return null
  if (page === 'movements/new')
    return join(
      t(movementType === 'exit' ? 'registerExit' : 'registerEntry'),
      t('tabMovements'),
    )
  const spec = PAGE_TITLES[page]
  if (spec.kind === 'detail')
    return record
      ? join(record, t(spec.section))
      : join(t(spec.section), t('tabAppName'))
  if (spec.kind === 'sub') return join(record ?? t(spec.name), t(spec.section))
  return record
    ? join(record, t(spec.name))
    : join(t(spec.name), t('tabAppName'))
}
