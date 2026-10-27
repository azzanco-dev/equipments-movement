import type { ReactNode } from 'react'
import { Clock, Hash, User, UserCheck } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import type { EquipmentState } from '@/lib/equipmentState'
import type { EquipmentVisit } from '@/lib/visitTimeline'
import { visitStateKey, type InquiryStateKey } from '@/lib/inquiryYear'
import {
  INQUIRY_STATE_COLORS,
  INQUIRY_STATE_LABEL,
  InquiryIconTile,
  inquiryInnerFill,
  inquiryStateIcon,
} from './inquiryStyle'

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
 * and driver (no PO badge: owner 2026-10-27, «شيل بادج الPO»); the workshop with its purpose and who is
 * responsible for the movement; else «بدون تسجيل» with the last recorded
 * exit. The open visit comes from the visible movements; when the reader's
 * access hides it, the state of the latest movement (`state`) still names
 * where the unit is, without details.
 */
export function InquiryNow({
  visits,
  state,
  now,
}: {
  /** Newest first, as `buildEquipmentVisits` returns them. */
  visits: EquipmentVisit[]
  state: EquipmentState | null
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

  const hiddenKey = open ? null : stateKeyOf(state)
  if (open && open.context === 'site') {
    key = 'site'
    title = (
      <>
        {t('inquiryInside')}{' '}
        <span className="font-bold">{open.entry?.project_name || t('project')}</span>
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
    // «ترقيم الشركة» in this project (owner 2026-10-27).
    if (open.entry?.contractor_equipment_code)
      people.push({
        icon: <Hash size={13} />,
        label: t('companyNumber'),
        value: open.entry.contractor_equipment_code,
      })
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
        {t('inquiryInside')} <span className="font-bold">{t('project')}</span>
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
        : (last.entry ?? last.exit)?.project_name || t('project'),
    )
  } else {
    title = <span className="font-bold">{t('inquiryNoMovementsYet')}</span>
    place = t('inquiryNoMovementsYetDesc')
  }

  const tone = INQUIRY_STATE_COLORS[key]
  const sinceMs = since ? Date.parse(since) : Number.NaN
  // Four levels (owner 2026-10-27: «حسن المسافات فيه والهايوريكي»): the
  // label with the PO chip, the place with its company, since when, then
  // the people.
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: tone.fill }}>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <InquiryIconTile colors={tone} size={34}>
            {inquiryStateIcon(key, 16)}
          </InquiryIconTile>
          <p className="text-sm font-semibold text-muted">{t('inquiryNow')}</p>
        </div>
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

      {/* The people as small pills in one row (owner 2026-10-27: «حق مسؤول
          الحركة كان حلو» — back from a box of pairs). */}
      {people.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {people.map((person) => (
            <span
              key={person.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              style={inquiryInnerFill(tone)}
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
