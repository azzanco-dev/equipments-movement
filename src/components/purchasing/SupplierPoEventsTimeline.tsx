import { useI18n } from '@/i18n/I18nContext'
import { formatDateTime } from '@/lib/dateFormat'
import {
  SUPPLIER_PO_EVENT_LABEL_KEYS,
  SUPPLIER_PO_EVENTS_LIMIT,
  formatSupplierPoPrice,
} from '@/lib/purchasing'
import { supplierPoEventDetail, type SupplierPoEventRow } from '@/lib/purchasingData'

/**
 * The latest events of a PO as a vertical timeline (the approved detail-page
 * pattern): type, a short detail from the payload, who and when.
 */
export function SupplierPoEventsTimeline({
  events,
  actorNames,
  codeOf,
}: {
  events: readonly SupplierPoEventRow[]
  /** `profile_names` of the actors; a missing name shows a dash. */
  actorNames: ReadonlyMap<string, string>
  /** The code of a unit named in a payload, from the page's lines. */
  codeOf: (equipmentId: string) => string | null
}) {
  const { t } = useI18n()
  const latest = events.slice(0, SUPPLIER_PO_EVENTS_LIMIT)
  if (latest.length === 0)
    return <p className="text-sm text-muted">{t('supplierPoNoEvents')}</p>
  return (
    <ol className="relative ms-1.5 space-y-4 border-s ps-4">
      {latest.map((event) => {
        const detail = supplierPoEventDetail(event, codeOf, (value) =>
          formatSupplierPoPrice(value as number | string | null | undefined),
        )
        const actor = event.actor_id ? actorNames.get(event.actor_id) : null
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-muted"
            />
            <p className="text-sm font-medium">
              {t(SUPPLIER_PO_EVENT_LABEL_KEYS[event.event_type])}
            </p>
            {detail && (
              <p className="text-sm text-muted">
                <bdi dir="ltr">{detail}</bdi>
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted">
              {actor ?? '—'} ·{' '}
              <bdi dir="ltr">{formatDateTime(event.created_at, false)}</bdi>
            </p>
          </li>
        )
      })}
    </ol>
  )
}
