/**
 * «يحتاج انتباهك» on the admin home (owner 2026-10-29, «اضف الي يحتاج
 * انتباهك لرئيسية الادمن», approved on the /ui-kit «نموذج الرئيسية
 * الجديدة»): the items, their gates and the lists they open, each with the
 * list's own URL filter format (`useDataListState`). Counts are read by
 * `AttentionSection`; this module is pure.
 */

export type AttentionId =
  | 'unclassified'
  | 'no_po'
  | 'awaiting_approval'
  | 'unpriced'
  | 'no_signal'
  | 'out_of_service_long'

/** Every item in the order the strip shows them. */
export const ATTENTION_ORDER: readonly AttentionId[] = [
  'unclassified',
  'no_po',
  'awaiting_approval',
  'unpriced',
  'no_signal',
  'out_of_service_long',
]

/** «خارج الخدمة اكثر من 30 يوم». */
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

/** Open workshop visits with no purpose yet. */
export function unclassifiedHref(): string {
  return workshopVisitsHref([
    {
      id: 'purpose',
      field: 'workshop_purpose',
      operator: 'is_not_set',
      value: '',
    },
  ])
}

/** Open workshop visits «خارج الخدمة» that entered before `cutoff`. */
export function outOfServiceLongHref(cutoff: string): string {
  return workshopVisitsHref([
    {
      id: 'purpose',
      field: 'workshop_purpose',
      operator: 'eq',
      value: 'out_of_service',
    },
    { id: 'since', field: 'entry_at', operator: 'lt', value: cutoff },
  ])
}

/** «المعدات في المشاريع» without a PO. */
export function noPoHref(): string {
  return `/purchasing/units?filters=${filtersParam([
    { id: 'po', field: 'has_po', operator: 'eq', value: 'false' },
  ])}`
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

/** Open POs with at least one unpriced line. */
export function unpricedHref(): string {
  return `/purchasing/orders?filters=${filtersParam([
    OPEN_PO,
    { id: 'unpriced', field: 'unpriced_count', operator: 'gt', value: '0' },
  ])}`
}

/** The items with a count above zero, in strip order. */
export function visibleAttentionItems(
  counts: Partial<Record<AttentionId, number>>,
): AttentionId[] {
  return ATTENTION_ORDER.filter((id) => (counts[id] ?? 0) > 0)
}
