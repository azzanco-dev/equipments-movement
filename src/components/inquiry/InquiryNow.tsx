import type { ReactNode } from 'react'
import { Clock, FileText, User, UserCheck } from 'lucide-react'
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
  // Four levels (owner 2026-10-27: «حسن المسافات فيه والهايوريكي»): the
  // label with the PO chip, the place as the card's heading with its
  // company, since when, then the people in one box of label-over-value
  // pairs.
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: tone.fill }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <InquiryIconTile colors={tone} size={34}>
            {inquiryStateIcon(key, 16)}
          </InquiryIconTile>
          <p className="text-sm font-semibold text-muted">{t('inquiryNow')}</p>
        </div>
        {extra && <div className="shrink-0">{extra}</div>}
      </div>

      <div className="mt-4 space-y-1">
        <p className="text-base leading-snug">{title}</p>
        {place && <p className="text-sm text-muted">{place}</p>}
      </div>

      {since && !Number.isNaN(sinceMs) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-sm">
          <Clock size={14} aria-hidden="true" className="text-muted" />
          <span className="text-muted">{t('inquirySince')}</span>
          <span className="font-semibold">{formatElapsedDuration(now - sinceMs, t, lang)}</span>
          <span className="text-muted">
            {'· '}
            <bdi dir="ltr">{formatDate(since)}</bdi>
          </span>
        </p>
      )}

      {people.length > 0 && (
        <dl
          className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl p-3 sm:grid-cols-2"
          style={INQUIRY_ON_FILL}
        >
          {people.map((person) => (
            <div key={person.label} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden="true">{person.icon}</span>
                {person.label}
              </dt>
              <dd className="m-0 mt-1 min-w-0 truncate-safe text-sm font-semibold">
                {person.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
