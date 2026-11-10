/**
 * «يحتاج انتباهك» on the admin home (owner 2026-10-29, «اضف الي يحتاج
 * انتباهك لرئيسية الادمن», approved on the /ui-kit «نموذج الرئيسية
 * الجديدة»): the items, their gates and the lists they open, each with the
 * list's own URL filter format (`useDataListState`). Counts are read by
 * `AttentionSection`; this module is pure.
 *
 * Since the owner's review of 2026-11-10 («ويحتاج انتباهك يكون اوامر شراء
 * موردين بحاجة لتعميد، معدات خرجت بانتهاء عمل وكرتها مفتوح، معدات متاحة
 * (العزاني)»): exactly three items. The workshop without a purpose, the
 * units on projects without a PO, the POs that need prices, the Afaqy
 * signal and the long out-of-service units left the list.
 */

import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import { ownersFilter } from '@/lib/adminHomeLinks'
import { CARDS_AWAITING_END_HREF } from '@/lib/cardsAwaitingEnd'

export type AttentionId =
  'awaiting_approval' | 'awaiting_end' | 'available_alazani'

/** Every item in the order the block shows them. */
export const ATTENTION_ORDER: readonly AttentionId[] = [
  'awaiting_approval',
  'awaiting_end',
  'available_alazani',
]

/** «خارج الخدمة اكثر من 30 يوم» (the line of «الورشة حسب الغرض»). */
export const OUT_OF_SERVICE_LONG_DAYS = 30

type UrlFilter = { id: string; field: string; operator: string; value: string }

const filtersParam = (filters: UrlFilter[]) =>
  encodeURIComponent(JSON.stringify(filters))

/** The Saudi day (UTC+03:00) `days` before `now`, as `YYYY-MM-DD`. */
export function saudiDayBefore(now: Date, days: number): string {
  const saudi = new Date(now.getTime() + 3 * 3600_000 - days * 86_400_000)
  return saudi.toISOString().slice(0, 10)
}

/** The log's workshop visits (`/logs`, visits view, `v` prefix). */
function workshopVisitsHref(filters: UrlFilter[]): string {
  return `/logs?context=workshop&vfilters=${filtersParam([
    { id: 'open', field: 'is_open', operator: 'eq', value: 'true' },
    ...filters,
  ])}`
}

/** Open workshop visits «خارج الخدمة» that entered before `cutoff`, of the
 *  chosen owners (empty = every owner; the home v2 workshop card passes its
 *  owner filter). */
export function outOfServiceLongHref(
  cutoff: string,
  owners: readonly AdminHomeOwner[] = [],
): string {
  return workshopVisitsHref([
    {
      id: 'purpose',
      field: 'workshop_purpose',
      operator: 'eq',
      value: 'out_of_service',
    },
    { id: 'since', field: 'entry_at', operator: 'lt', value: cutoff },
    ...ownersFilter('equipment_ownership_status', owners),
  ])
}

const OPEN_PO: UrlFilter = {
  id: 'status',
  field: 'status',
  operator: 'eq',
  value: 'open',
}

/** Open drafts with every line priced: ready for approval. */
export function awaitingApprovalHref(): string {
  return `/purchasing/orders?filters=${filtersParam([
    OPEN_PO,
    {
      id: 'approval',
      field: 'approval_status',
      operator: 'eq',
      value: 'draft',
    },
    { id: 'priced', field: 'unpriced_count', operator: 'eq', value: '0' },
  ])}`
}

/**
 * «معدات خرجت بانتهاء عمل وكرتها مفتوح» (migration 0185): the rows of
 * `sales_cards_awaiting_end`, read only by a `sales.view` holder (the view's
 * RLS) and linked only when the shell opens `sales/cards`.
 */
export const AWAITING_END_PAGE = 'sales/cards' as const

/** The «كروت المعدات» list restricted to the cards awaiting their end. */
export function awaitingEndHref(): string {
  return CARDS_AWAITING_END_HREF
}

/** The items with a count above zero, in the block's order. */
export function visibleAttentionItems(
  counts: Partial<Record<AttentionId, number>>,
): AttentionId[] {
  return ATTENTION_ORDER.filter((id) => (counts[id] ?? 0) > 0)
}
