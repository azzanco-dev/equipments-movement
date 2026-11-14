import type { ReactNode } from 'react'
import { Clock, Hash, MapPin, User, UserCheck, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import type { EquipmentState } from '@/lib/equipmentState'
import type { EquipmentPresence } from '@/lib/equipmentPresence'
import { localizedName } from '@/lib/localizedName'
import { groupWorkshopStops, visitDurationMs, type EquipmentVisit } from '@/lib/visitTimeline'
import { visitStateKey, type InquirySold, type InquiryStateKey } from '@/lib/inquiryYear'
import {
  INQUIRY_STATE_COLORS,
  INQUIRY_STATE_LABEL,
  InquiryIconTile,
  inquiryInnerFill,
  inquiryStateIcon,
} from './inquiryStyle'

/** The state of `get_equipment_presence`, for a reader whose access hides the
 *  open visit itself. */
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
 * where the unit is, without details. A sold unit (owner 2026-11-02) reads
 * «مباعة» whatever its movements say, with its last recorded exit under it.
 *
 * Nested workshop stays (2026-11-14): a unit inside the workshop whose project
 * visit is open shows the workshop box with the project visit nested in it
 * («تابعة لمشروع»); a unit back in its project says when it came back from its
 * latest workshop stop. `presence` (`get_equipment_presence`) names the
 * project when the reader's access hides the visits.
 */
export function InquiryNow({
  visits,
  state,
  presence = null,
  now,
  sold = null,
}: {
  /** Newest first, as `buildEquipmentVisits` returns them. */
  visits: EquipmentVisit[]
  state: EquipmentState | null
  presence?: EquipmentPresence | null
  now: number
  sold?: InquirySold | null
}) {
  const { t, lang } = useI18n()
  const open = visits.find((visit) => visit.open && visit.startedAt) ?? null
  const last = visits[0] ?? null
  const openSite =
    visits.find((visit) => visit.open && visit.startedAt && visit.context === 'site') ?? null
  const siteStops = openSite
    ? (groupWorkshopStops(visits).stopsByVisit.get(openSite.key) ?? [])
    : []
  // The newest stop of the open project visit, once it is closed: the unit
  // came back from the workshop.
  const returnedStop =
    siteStops[0] && !siteStops[0].open && siteStops[0].endedAt ? siteStops[0] : null
  // `localizedName` answers a dash for a missing name: only name a project the
  // presence row gives.
  const presenceProject =
    presence?.siteOpen && (presence.siteProjectNameAr || presence.siteProjectNameEn)
      ? localizedName(lang, presence.siteProjectNameAr, presence.siteProjectNameEn)
      : null
  let nestedSite: {
    project: string
    company: string | null
    since: string | null
    people: { icon: ReactNode; label: string; value: string }[]
  } | null = null
  let underProject: string | null = null

  let key: InquiryStateKey = 'unrecorded'
  let title: ReactNode
  let place: ReactNode = null
  let since: string | null = null
  const people: { icon: ReactNode; label: string; value: string }[] = []

  const hiddenKey = open ? null : stateKeyOf(state)
  if (sold) {
    key = 'sold'
    title = <span className="font-bold">{t('equipmentStatusSold')}</span>
    if (last?.endedAt) {
      since = last.endedAt
      place = t('inquiryLastRecordedExit').replace(
        '{place}',
        last.context === 'workshop'
          ? t('workshopLocation')
          : (last.entry ?? last.exit)?.project_name || t('inquiryStateSite'),
      )
    } else if (!last && sold.since === null) place = t('inquirySoldNoMovements')
  } else if (open && open.context === 'site') {
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
    if (openSite) {
      const entry = openSite.entry
      const sitePeople: { icon: ReactNode; label: string; value: string }[] = []
      if (entry?.supervisor_name)
        sitePeople.push({
          icon: <UserCheck size={13} />,
          label: t('inquiryForeman'),
          value: entry.supervisor_name,
        })
      if (entry?.driver_name)
        sitePeople.push({
          icon: <User size={13} />,
          label: t('inquiryDriver'),
          value: entry.driver_name,
        })
      if (entry?.contractor_equipment_code)
        sitePeople.push({
          icon: <Hash size={13} />,
          label: t('companyNumber'),
          value: entry.contractor_equipment_code,
        })
      nestedSite = {
        project: entry?.project_name || t('inquiryStateSite'),
        company: entry?.company_name || null,
        since: openSite.startedAt,
        people: sitePeople,
      }
    } else underProject = presenceProject
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
    underProject = presenceProject
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
  const siteTone = INQUIRY_STATE_COLORS.site
  const nestedSinceMs = nestedSite?.since ? Date.parse(nestedSite.since) : Number.NaN
  const returnedEndMs = returnedStop?.endedAt ? Date.parse(returnedStop.endedAt) : Number.NaN
  const returnedDuration = returnedStop ? visitDurationMs(returnedStop, now) : null
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
        {underProject && (
          <p className="text-sm text-muted">
            {t('inquiryNestedUnder')} <span className="font-semibold">{underProject}</span>
          </p>
        )}
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

      {/* Back from the workshop: the latest stop of this project visit is
          closed (nested workshop stays, 2026-11-14). */}
      {key === 'site' && returnedStop && !Number.isNaN(returnedEndMs) && returnedDuration !== null && (
        <p
          className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs font-medium"
          style={{ color: INQUIRY_STATE_COLORS[visitStateKey(returnedStop)].stroke }}
        >
          <Wrench size={13} aria-hidden="true" />
          <span>
            {t('inquiryReturnedFromWorkshop')
              .replace('{words}', formatElapsedDuration(now - returnedEndMs, t, lang))
              .replace('{purpose}', t(INQUIRY_STATE_LABEL[visitStateKey(returnedStop)]))
              .replace('{duration}', formatElapsedDuration(returnedDuration, t, lang))}
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

      {/* The project visit this workshop stop is nested in: the open visit
          in the project's own light fill. */}
      {nestedSite && (
        <div
          className="mt-4 space-y-2.5 rounded-xl p-3.5"
          style={{ backgroundColor: siteTone.fill }}
        >
          <div className="flex items-center gap-2.5">
            <InquiryIconTile colors={siteTone} size={30}>
              <MapPin size={14} />
            </InquiryIconTile>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                <span className="text-muted">{t('inquiryNestedUnder')}</span>
                <span className="font-bold">{nestedSite.project}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ backgroundColor: siteTone.tint, color: siteTone.stroke }}
                >
                  {t('inquiryOpenVisit')}
                </span>
              </div>
              {nestedSite.company && (
                <p className="truncate-safe text-xs text-muted">{nestedSite.company}</p>
              )}
            </div>
          </div>
          {nestedSite.since && !Number.isNaN(nestedSinceMs) && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
              <Clock size={14} aria-hidden="true" className="text-muted" />
              <span className="text-muted">{t('inquirySince')}</span>
              <span className="font-semibold">
                {formatElapsedDuration(now - nestedSinceMs, t, lang)}
              </span>
              <span className="text-muted">
                {'· '}
                <bdi dir="ltr">{formatDate(nestedSite.since)}</bdi>
              </span>
            </p>
          )}
          {nestedSite.people.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nestedSite.people.map((person) => (
                <span
                  key={person.label}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                  style={inquiryInnerFill(siteTone)}
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
      )}
    </div>
  )
}
