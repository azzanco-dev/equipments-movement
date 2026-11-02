import { useI18n } from '@/i18n/I18nContext'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import {
  CLIENT_PO_EVENT_LABEL_KEYS,
  CLIENT_PO_EVENTS_LIMIT,
  SALE_RATE_UNIT_LABEL_KEYS,
  clientPoEventDetail,
} from '@/lib/sales'
import { formatSupplierPoPrice } from '@/lib/purchasing'
import type { ClientPoEventRow } from '@/lib/salesData'

/** One event of a vertical timeline, already labelled. */
export interface TimelineItem {
  id: string
  label: string
  detail: string | null
  actor: string | null
  created_at: string
}

/**
 * The approved detail-page timeline (the supplier PO page's): label, a
 * short detail, who and when. Shared by the client PO page and the
 * equipment card page, whose events come from two tables.
 */
export function EventTimeline({
  items,
  emptyLabel,
}: {
  items: readonly TimelineItem[]
  emptyLabel: string
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted">{emptyLabel}</p>
  return (
    <ol className="relative ms-1.5 space-y-4 border-s ps-4">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-muted"
          />
          <p className="text-sm font-medium">{item.label}</p>
          {item.detail && (
            <p className="text-sm text-muted">
              <bdi dir="ltr">{item.detail}</bdi>
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {item.actor ?? '—'} ·{' '}
            <bdi dir="ltr">{formatDateTime(item.created_at, false)}</bdi>
          </p>
        </li>
      ))}
    </ol>
  )
}

/** The latest events of a client PO as timeline items. */
export function useClientPoTimelineItems(
  events: readonly ClientPoEventRow[],
  codeOf: (equipmentId: string) => string | null,
  labelPrefix?: string,
): TimelineItem[] {
  const { t } = useI18n()
  return events.slice(0, CLIENT_PO_EVENTS_LIMIT).map((event) => ({
    id: event.id,
    label: `${labelPrefix ?? ''}${t(CLIENT_PO_EVENT_LABEL_KEYS[event.event_type] ?? 'clientPoEventUpdated')}`,
    detail: clientPoEventDetail(
      event,
      codeOf,
      (value) =>
        formatSupplierPoPrice(value as number | string | null | undefined),
      formatDate,
      (unit) => t(SALE_RATE_UNIT_LABEL_KEYS[unit]),
    ),
    actor: event.actor_name,
    created_at: event.created_at,
  }))
}

/** The client PO page's timeline. */
export function ClientPoEventsTimeline({
  events,
  codeOf,
}: {
  events: readonly ClientPoEventRow[]
  /** The code of a unit named in a payload, from the page's lines. */
  codeOf: (equipmentId: string) => string | null
}) {
  const { t } = useI18n()
  const items = useClientPoTimelineItems(events, codeOf)
  return <EventTimeline items={items} emptyLabel={t('supplierPoNoEvents')} />
}
