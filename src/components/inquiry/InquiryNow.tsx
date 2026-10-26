import type { ReactNode } from 'react'
import { FileText, User, UserCheck } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { AppLink } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import type { EquipmentState } from '@/lib/equipmentState'
import type { EquipmentVisit } from '@/lib/visitTimeline'
import { visitStateKey, type InquiryStateKey } from '@/lib/inquiryYear'
import {
  INQUIRY_ON_FILL,
  INQUIRY_STATE_COLORS,
  INQUIRY_STATE_LABEL,
  InquiryIconTile,
  inquiryStateIcon,
} from './inquiryStyle'

/** The PO of the unit's open project visit, when the reader may see it:
 *  `undefined` hides the chip, `null` says «بدون PO». */
export type InquiryNowPo = { id: string; number: string } | null | undefined

/** The workshop state of `get_last_movement`, for a reader whose access
 *  hides the open visit itself. */
function stateKeyOf(state: EquipmentState | null): InquiryStateKey | null {
  if (state === 'working') return 'site'
  if (state === 'parking' || state === 'out_of_service') return state
  if (state === 'maintenance' || state === 'unclassified') return 'maintenance'
  return null
}

/**
 * «الحين» (owner 2026-10-26): where the unit is now, filled with that
 * state's light colour — the project and company, since when, the foreman
 * and driver and the PO chip; the workshop with its purpose and who is
 * responsible for the movement; else «بدون تسجيل» with the last recorded
 * exit. The open visit comes from the visible movements; when the reader's
 * access hides it, the state of the latest movement (`state`) still names
 * where the unit is, without details.
 */
export function InquiryNow({
  visits,
  state,
  po,
  now,
}: {
  /** Newest first, as `buildEquipmentVisits` returns them. */
  visits: EquipmentVisit[]
  state: EquipmentState | null
  po: InquiryNowPo
  now: number
}) {
  const { t, lang } = useI18n()
  const open = visits.find((visit) => visit.open && visit.startedAt) ?? null
  const last = visits[0] ?? null

  let key: InquiryStateKey = 'unrecorded'
  let title: ReactNode
  let place: ReactNode = null
  let since: string | null = null
  const people: { icon: ReactNode; label: string; value: string }[] = []
  let extra: ReactNode = null

  const hiddenKey = open ? null : stateKeyOf(state)
  if (open && open.context === 'site') {
    key = 'site'
    title = (
      <>
        {t('inquiryInside')}{' '}
        <span className="font-bold">{open.entry?.project_name || t('inquiryStateSite')}</span>
      </>
    )
    place = open.entry?.company_name
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={13} />,
        label: t('inquiryForeman'),
        value: open.entry.supervisor_name,
      })
    if (open.entry?.driver_name)
      people.push({
        icon: <User size={13} />,
        label: t('inquiryDriver'),
        value: open.entry.driver_name,
      })
    if (po !== undefined)
      extra = po ? (
        <AppLink
          href={`/purchasing/${po.id}`}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold hover:underline"
          style={INQUIRY_ON_FILL}
        >
          <FileText size={12} aria-hidden="true" />
          <bdi dir="ltr">{po.number}</bdi>
        </AppLink>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={INQUIRY_ON_FILL}
        >
          <FileText size={12} aria-hidden="true" />
          {t('inquiryNoPo')}
        </span>
      )
  } else if (open) {
    key = visitStateKey(open)
    title = (
      <>
        <span className="font-bold">{t('inquiryInWorkshop')}</span> ·{' '}
        {t(INQUIRY_STATE_LABEL[key])}
      </>
    )
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={13} />,
        label: t('inquiryMovementOwner'),
        value: open.entry.supervisor_name,
      })
  } else if (hiddenKey === 'site') {
    key = 'site'
    title = (
      <>
        {t('inquiryInside')} <span className="font-bold">{t('inquiryStateSite')}</span>
      </>
    )
  } else if (hiddenKey) {
    key = hiddenKey
    title = (
      <>
        <span className="font-bold">{t('inquiryInWorkshop')}</span> ·{' '}
        {t(INQUIRY_STATE_LABEL[hiddenKey])}
      </>
    )
  } else if (last) {
    title = <span className="font-bold">{t('inquiryStateUnrecorded')}</span>
    since = last.endedAt
    place = t('inquiryLastRecordedExit').replace(
      '{place}',
      last.context === 'workshop'
        ? t('workshopLocation')
        : (last.entry ?? last.exit)?.project_name || t('inquiryStateSite'),
    )
  } else {
    title = <span className="font-bold">{t('inquiryNoMovementsYet')}</span>
    place = t('inquiryNoMovementsYetDesc')
  }

  const tone = INQUIRY_STATE_COLORS[key]
  const sinceMs = since ? Date.parse(since) : Number.NaN
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: tone.fill }}>
      <div className="flex flex-wrap items-start gap-3">
        <InquiryIconTile colors={tone} size={42}>
          {inquiryStateIcon(key, 19)}
        </InquiryIconTile>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-semibold text-muted">{t('inquiryNow')}</p>
          <p className="text-lg leading-snug">{title}</p>
          {place && <p className="text-sm text-muted">{place}</p>}
          {since && !Number.isNaN(sinceMs) && (
            <p className="text-sm">
              {t('inquirySince')}{' '}
              <span className="font-semibold">
                {formatElapsedDuration(now - sinceMs, t, lang)}
              </span>
              <span className="text-muted">
                {' · '}
                <bdi dir="ltr">{formatDate(since)}</bdi>
              </span>
            </p>
          )}
        </div>
        {/* Under the text on a phone, so it never squeezes the place. */}
        {extra && <div className="basis-full ps-[54px] sm:basis-auto sm:ps-0">{extra}</div>}
      </div>
      {people.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {people.map((person) => (
            <span
              key={person.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              style={INQUIRY_ON_FILL}
            >
              <span aria-hidden="true" className="text-muted">
                {person.icon}
              </span>
              <span className="text-muted">{person.label}</span>
              <span className="truncate-safe font-semibold">{person.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
