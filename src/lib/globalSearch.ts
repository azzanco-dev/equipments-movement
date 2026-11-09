import {
  COMPANY_PROJECT_SEARCH_FIELDS,
  DRIVER_SEARCH_FIELDS,
  EQUIPMENT_SEARCH_FIELDS,
  sanitizeSearchTerm,
} from '@/lib/search'
import type { TranslationKey } from '@/i18n/translations'
import type { RoutePage } from '@/lib/navPermissions'

/**
 * The header's general search (owner 2026-11-08, approved on /ui-kit
 * «نموذج الهيدر الجديد» as variant «ب»): one field for units, drivers,
 * companies, projects and supplier POs. Pure rules only; the reads live in
 * `globalSearchData.ts`.
 *
 * A group is searched ONLY when the reader's shell opens the page its result
 * leads to, so the search never offers a page the user cannot open, and RLS
 * still decides the rows of every read. Companies and projects have no
 * detail page: their result opens the list filtered by the name.
 *
 * A unit also opens on «استعلام معدة» (owner 2026-11-08, «اضف للبحث العام
 * صفحة استعلام عن معدة»): `/inquiry?equipment=<id>`. With both pages open
 * the result is the unit page with a small «استعلام» link beside it; with
 * the inquiry alone (a foreman, say) the result IS the inquiry.
 */

export type GlobalSearchGroupId =
  'equipment' | 'drivers' | 'companies' | 'projects' | 'purchaseOrders'

/** Search from two characters on, at most five rows per group, debounced. */
export const GLOBAL_SEARCH_MIN_CHARS = 2
export const GLOBAL_SEARCH_GROUP_LIMIT = 5
export const GLOBAL_SEARCH_DEBOUNCE_MS = 300

type GroupDef = {
  id: GlobalSearchGroupId
  /** The pages (route keys) a result can open; the group needs one open. */
  pages: readonly RoutePage[]
  label: TranslationKey
  table: string
  select: string
  /** Real columns of `table`, fed to `buildSearchFilter`. */
  searchFields: readonly string[]
  order: string
}

export const GLOBAL_SEARCH_GROUPS: readonly GroupDef[] = [
  {
    id: 'equipment',
    pages: ['equipment/:id', 'inquiry'],
    label: 'equipment',
    table: 'equipment',
    select: 'id,code,type,plate_number,chassis_number',
    searchFields: EQUIPMENT_SEARCH_FIELDS,
    order: 'code',
  },
  {
    id: 'drivers',
    pages: ['drivers/:id'],
    label: 'drivers',
    table: 'drivers',
    select: 'id,full_name,mobile_number',
    searchFields: DRIVER_SEARCH_FIELDS,
    order: 'full_name',
  },
  {
    id: 'companies',
    pages: ['companies'],
    label: 'companies',
    table: 'companies',
    select: 'id,name_ar,name_en',
    searchFields: COMPANY_PROJECT_SEARCH_FIELDS,
    order: 'name_ar',
  },
  {
    id: 'projects',
    pages: ['projects'],
    label: 'projects',
    table: 'projects',
    select: 'id,name_ar,name_en',
    searchFields: COMPANY_PROJECT_SEARCH_FIELDS,
    order: 'name_ar',
  },
  {
    id: 'purchaseOrders',
    pages: ['purchasing/:id'],
    label: 'globalSearchPurchaseOrders',
    table: 'supplier_pos',
    select: 'id,po_number,status,is_internal,owner_class,lessor:lessors(name)',
    searchFields: ['po_number'],
    order: 'po_number',
  },
]

/** The groups the reader may search, in the order they are shown. */
export function globalSearchGroupsFor(
  opens: (page: RoutePage) => boolean,
): GroupDef[] {
  return GLOBAL_SEARCH_GROUPS.filter((group) => group.pages.some(opens))
}

/** The term to search, or null while it is too short to send. */
export function globalSearchTerm(raw: string): string | null {
  const term = sanitizeSearchTerm(raw)
  return term.length >= GLOBAL_SEARCH_MIN_CHARS ? term : null
}

/** One result as the panel shows it: a title, a muted detail, the page. */
export type GlobalSearchItem = {
  id: string
  title: string
  detail: string
  href: string
  /** Codes, plates and PO numbers read left to right. */
  ltr: boolean
  /** A unit's «استعلام» link beside its page, when both are open. */
  inquiryHref?: string
}

/** The inquiry page opened on one unit. */
export function inquiryHrefOf(equipmentId: string): string {
  return `/inquiry?${new URLSearchParams({ equipment: equipmentId }).toString()}`
}

function listHref(page: string, name: string): string {
  return `/${page}?${new URLSearchParams({ q: name }).toString()}`
}

type Row = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** Maps a read row of a group to the item the panel shows. */
export function globalSearchItem(
  group: GlobalSearchGroupId,
  row: Row,
  lang: 'ar' | 'en',
  opens: (page: RoutePage) => boolean,
  supplierLabel?: string,
): GlobalSearchItem {
  const id = String(row.id)
  switch (group) {
    case 'equipment': {
      const unitPage = opens('equipment/:id')
      const inquiry = opens('inquiry')
      return {
        id,
        title: text(row.code),
        detail: [
          text(row.type),
          text(row.plate_number) || text(row.chassis_number),
        ]
          .filter(Boolean)
          .join(' · '),
        href: unitPage ? `/equipment/${id}` : inquiryHrefOf(id),
        ltr: true,
        inquiryHref: unitPage && inquiry ? inquiryHrefOf(id) : undefined,
      }
    }
    case 'drivers':
      return {
        id,
        title: text(row.full_name),
        detail: text(row.mobile_number),
        href: `/drivers/${id}`,
        ltr: false,
      }
    case 'companies':
    case 'projects': {
      const arabic = text(row.name_ar)
      const english = text(row.name_en)
      const title = (lang === 'en' && english) || arabic || english
      return {
        id,
        title,
        detail: title === arabic ? english : arabic,
        href: listHref(group, arabic || english),
        ltr: false,
      }
    }
    case 'purchaseOrders':
      return {
        id,
        title: text(row.po_number),
        detail: supplierLabel ?? '',
        href: `/purchasing/${id}`,
        ltr: true,
      }
  }
}
