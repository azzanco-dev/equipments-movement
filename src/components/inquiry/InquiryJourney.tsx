import type { ReactNode } from 'react'
import { CircleDashed, History, LogIn, LogOut, User, UserCheck } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { AppLink, cn } from '@/components/ui'
import { ExitPurposeBadge } from '@/components/movement/ExitPurposeBadge'
import { formatDate } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import {
  buildTimelineItems,
  visitDurationMs,
  type EquipmentVisit,
  type OutsideGap,
  type TimelineMovement,
} from '@/lib/visitTimeline'
import { visitStateKey } from '@/lib/inquiryYear'
import {
  INQUIRY_STATE_COLORS,
  INQUIRY_STATE_LABEL,
  INQUIRY_SURFACE,
  InquiryCardTitle,
  InquiryIconTile,
  inquiryInnerFill,
  inquiryRise,
  inquiryStateIcon,
} from './inquiryStyle'

/** One fact of a stay, a small label over its value. */
function StayFact({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="m-0 mt-0.5 min-w-0 break-words text-sm font-medium">{children}</dd>
    </div>
  )
}

/** A movement's day as a link to its page, underlined so it reads as one
 *  (owner 2026-10-26: «اضف خط تحت التاريخ دلالة على امكانية الضغط»); the
 *  page shows days without hours («بدون الساعات»). */
function MovementDay({
  movement,
  onSelectMovement,
}: {
  movement: TimelineMovement
  onSelectMovement: (id: string) => void
}) {
  return (
    <AppLink
      href={`/movements/${movement.id}`}
      onNavigate={() => onSelectMovement(movement.id)}
      className="underline underline-offset-4 hover:decoration-2"
    >
      <bdi dir="ltr">{formatDate(movement.recorded_at)}</bdi>
    </AppLink>
  )
}

/**
 * One stay as a tile in its state's colour (owner: «تلون المربعات بحيث كل
 * لون يرمز لحالة معينة»), everything about it in view without a click
 * («احتاجها بدون كليك»): entry and exit days with the exit purpose, the
 * foreman and the driver of a project stay (the exit driver too when it
 * changed), the person responsible for a workshop stay («مسؤول الحركة»; not
 * who recorded its exit).
 */
function StayTile({
  visit,
  now,
  highlighted,
  onSelectMovement,
}: {
  visit: EquipmentVisit
  now: number
  /** Ringed when the 12-month strip opened it. */
  highlighted: boolean
  onSelectMovement: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const key = visitStateKey(visit)
  const colors = INQUIRY_STATE_COLORS[key]
  const duration = visitDurationMs(visit, now)
  const entry = visit.entry
  const exit = visit.exit
  const site = visit.context === 'site'
  const title = site
    ? (entry ?? exit)?.project_name || t('inquiryStateSite')
    : t('workshopLocation')
  const company = site ? (entry ?? exit)?.company_name : null
  const entryDriver = entry?.driver_name || null
  const exitDriver = exit?.driver_name || null

  return (
    <article
      id={inquiryVisitAnchor(visit.key)}
      className="min-w-0 flex-1 scroll-mt-24 rounded-2xl p-3.5 transition-shadow sm:p-4"
      style={{
        backgroundColor: colors.fill,
        boxShadow: highlighted ? `0 0 0 2px ${colors.stroke}` : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-bold">{title}</h4>
            {!site && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={inquiryInnerFill(colors)}
              >
                {t(INQUIRY_STATE_LABEL[key])}
              </span>
            )}
            {visit.open && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: colors.tint, color: colors.stroke }}
              >
                {t('inquiryOpenStay')}
              </span>
            )}
          </div>
          {company && <p className="mt-0.5 truncate-safe text-xs text-muted">{company}</p>}
        </div>
        <div className="shrink-0 text-end">
          <p className="text-sm font-bold">
            {duration !== null ? formatElapsedDuration(duration, t, lang) : '—'}
          </p>
          <p className="text-[11px] text-muted">
            {visit.open ? t('inquiryUntilNow') : t('inquiryDuration')}
          </p>
        </div>
      </div>

      <dl
        className={cn(
          'mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl p-3',
          site ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
        )}
        style={inquiryInnerFill(colors)}
      >
        <StayFact icon={<LogIn size={11} />} label={t('inquiryEntry')}>
          {entry ? <MovementDay movement={entry} onSelectMovement={onSelectMovement} /> : '—'}
        </StayFact>
        <StayFact icon={<LogOut size={11} />} label={t('inquiryExit')}>
          {exit ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <MovementDay movement={exit} onSelectMovement={onSelectMovement} />
              {site && <ExitPurposeBadge purpose={exit.exit_purpose} />}
            </span>
          ) : visit.open ? (
            <span className="text-muted">{t('inquiryStillInside')}</span>
          ) : (
            '—'
          )}
        </StayFact>
        <StayFact
          icon={<UserCheck size={11} />}
          label={site ? t('inquiryForeman') : t('inquiryMovementOwner')}
        >
          {(entry ?? exit)?.supervisor_name || '—'}
        </StayFact>
        {site && (
          <StayFact icon={<User size={11} />} label={t('inquiryDriver')}>
            {entryDriver ?? exitDriver ?? '—'}
            {entryDriver && exitDriver && exitDriver !== entryDriver && (
              <span className="block text-xs text-muted">
                {t('inquiryDriverAtExit').replace('{name}', exitDriver)}
              </span>
            )}
          </StayFact>
        )}
      </dl>
    </article>
  )
}

/** Days with no recorded stay between two stays (or since the last exit). */
function UnrecordedTile({ gap }: { gap: OutsideGap }) {
  const { t } = useI18n()
  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl px-3.5 py-2.5 text-xs"
      style={{ backgroundColor: INQUIRY_STATE_COLORS.unrecorded.fill }}
    >
      <span className="font-semibold">{t('inquiryStateUnrecorded')}</span>
      <span className="text-muted">
        {t(gap.open ? 'inquiryUnrecordedSince' : 'inquiryUnrecordedDays').replace(
          '{count}',
          String(gap.days),
        )}
      </span>
      <span className="ms-auto text-muted">
        <bdi dir="ltr">{formatDate(`${gap.startDayKey}T12:00:00Z`)}</bdi>
        {gap.endDayKey && (
          <>
            {' ← '}
            <bdi dir="ltr">{formatDate(`${gap.endDayKey}T12:00:00Z`)}</bdi>
          </>
        )}
      </span>
    </div>
  )
}

/**
 * «الرحلة» (owner 2026-10-26): every stay and every unrecorded stretch,
 * newest first, on one rail; no project/workshop filter («بدون فلتر»).
 */
/** The element id of a stay's tile, for the strip to scroll to. */
export function inquiryVisitAnchor(key: string): string {
  return `inquiry-visit-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

export function InquiryJourney({
  visits,
  now,
  index,
  highlightedKey = null,
  onSelectMovement,
  footer,
}: {
  /** Newest first, as `buildEquipmentVisits` returns them. */
  visits: EquipmentVisit[]
  now: number
  index: number
  highlightedKey?: string | null
  onSelectMovement: (id: string) => void
  /** «عرض المزيد» under the stays. */
  footer?: ReactNode
}) {
  const { t } = useI18n()
  const items = buildTimelineItems(visits, now)
  return (
    <section className={cn(INQUIRY_SURFACE, 'inq-rise p-4')} style={inquiryRise(index)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <InquiryCardTitle icon={<History size={14} />}>{t('inquiryJourney')}</InquiryCardTitle>
        <span className="text-xs text-muted">
          {t('inquiryVisitCount').replace('{count}', String(visits.length))}
        </span>
      </div>
      {visits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-4 py-10 text-center">
          <InquiryIconTile colors={INQUIRY_STATE_COLORS.unrecorded} size={40}>
            <CircleDashed size={18} />
          </InquiryIconTile>
          <p className="text-sm font-semibold">{t('inquiryJourneyEmptyTitle')}</p>
          <p className="text-xs text-muted">{t('inquiryJourneyEmptyDesc')}</p>
        </div>
      ) : (
        <ol className="relative">
          {/* The rail behind the stops. */}
          <span
            aria-hidden="true"
            className="absolute bottom-5 top-5 w-0.5 rounded-full bg-surface-hover"
            style={{ insetInlineStart: 15 }}
          />
          {items.map((item, position) => (
            <li
              key={item.key}
              className="inq-rise relative flex items-start gap-3 pb-3 last:pb-0"
              style={inquiryRise(index + 1 + position)}
            >
              {item.kind === 'visit' ? (
                <>
                  <span className="relative mt-3.5">
                    <InquiryIconTile
                      colors={INQUIRY_STATE_COLORS[visitStateKey(item.visit)]}
                      size={32}
                    >
                      {inquiryStateIcon(visitStateKey(item.visit), 15)}
                    </InquiryIconTile>
                  </span>
                  <StayTile
                    visit={item.visit}
                    now={now}
                    highlighted={highlightedKey === item.visit.key}
                    onSelectMovement={onSelectMovement}
                  />
                </>
              ) : (
                <>
                  <span className="relative flex h-9 w-8 shrink-0 items-center justify-center">
                    <InquiryIconTile colors={INQUIRY_STATE_COLORS.unrecorded} size={20}>
                      <CircleDashed size={11} />
                    </InquiryIconTile>
                  </span>
                  <UnrecordedTile gap={item.gap} />
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {footer}
    </section>
  )
}
