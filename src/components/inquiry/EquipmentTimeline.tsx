import { useMemo, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  History,
  Image as ImageIcon,
  LogIn,
  LogOut,
  MapPin,
  Wrench,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  EmptyState,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
  cn,
} from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import {
  buildEquipmentVisits,
  buildTimelineItems,
  summarizeVisits,
  visitDurationMs,
  type EquipmentPresence,
  type EquipmentVisit,
  type MovementContext,
  type OutsideGap,
  type TimelineMovement,
} from '@/lib/visitTimeline'

export type TimelineFilter = 'all' | MovementContext

export interface EquipmentTimelineProps {
  /** One equipment's movements, in any order; pairing sorts them itself. */
  movements: TimelineMovement[]
  /** Opens the photo viewer for a movement; thumbnails are hidden without it. */
  onOpenPhoto?: (movementId: string) => void
  /** Opens a movement's own detail page; the entry/exit lines stay plain text without it. */
  onSelectMovement?: (movementId: string) => void
  /** Reference instant for open-visit durations; defaults to now. */
  now?: Date | string | number
  className?: string
}

const STATE_LABEL = {
  inside_site: 'insideSite',
  inside_workshop: 'insideWorkshop',
  outside: 'outsideSite',
} as const

const STATE_TONE = {
  inside_site: 'success',
  inside_workshop: 'info',
  outside: 'neutral',
} as const

function toMs(value: Date | string | number | undefined): number {
  if (value === undefined) return Date.now()
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? Date.now() : ms
}

/** Month heading key (year-month) of an instant. */
function monthKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 7)
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

/**
 * One equipment's full history as a vertical timeline, newest first. An entry
 * and its matching exit render as a single visit segment; an entry with no
 * exit is marked as still inside and keeps counting; a legacy exit with no
 * entry stays visible as its own segment rather than disappearing.
 *
 * Props are plain data and the pairing lives in `src/lib/visitTimeline.ts`, so
 * this component never fetches and never owns a movement rule.
 */
export function EquipmentTimeline({
  movements,
  onOpenPhoto,
  onSelectMovement,
  now,
  className,
}: EquipmentTimelineProps) {
  const { t, lang } = useI18n()
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const nowMs = toMs(now)

  const visits = useMemo(() => buildEquipmentVisits(movements), [movements])
  // The summary always describes the whole history; the tabs filter the list.
  const summary = useMemo(() => summarizeVisits(visits, nowMs), [visits, nowMs])
  const items = useMemo(
    () => buildTimelineItems(visits, nowMs),
    [visits, nowMs],
  )
  const shown = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'workshop')
      return items.filter(
        (item) => item.kind === 'visit' && item.visit.context === 'workshop',
      )
    // 'site': gaps are periods outside every site, so they stay visible here.
    return items.filter(
      (item) => item.kind === 'gap' || item.visit.context === 'site',
    )
  }, [items, filter])

  if (movements.length === 0)
    return (
      <EmptyState
        className={className}
        icon={<History size={28} aria-hidden="true" />}
        title={t('noMovementHistory')}
        description={t('noMovementHistoryDesc')}
      />
    )

  const locale = lang === 'ar' ? 'ar' : 'en-GB'
  let lastMonth: string | null = null

  return (
    <div className={cn('space-y-4', className)}>
      <Summary summary={summary} nowMs={nowMs} />

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as TimelineFilter)}
      >
        <TabsList variant="segmented" aria-label={t('movementTimeline')}>
          <TabsTrigger value="all">{t('all')}</TabsTrigger>
          <TabsTrigger value="site">{t('sites')}</TabsTrigger>
          <TabsTrigger value="workshop">{t('workshopLocation')}</TabsTrigger>
        </TabsList>
        {/* One content node bound to the active value: the association stays
            correct without re-rendering the list three times. */}
        <TabsContent value={filter}>
          {shown.length === 0 ? (
            <EmptyState
              icon={<History size={24} aria-hidden="true" />}
              title={t('noResults')}
            />
          ) : (
            <ol className="space-y-3">
              {shown.map((item) => {
                const key = monthKey(item.sortAt)
                const newMonth = key !== lastMonth
                lastMonth = key
                return (
                  <li key={item.key} className="space-y-3">
                    {newMonth && (
                      <p className="pt-1 text-xs font-semibold text-muted">
                        {monthLabel(item.sortAt, locale)}
                      </p>
                    )}
                    {item.kind === 'gap' ? (
                      <GapSegment gap={item.gap} />
                    ) : (
                      <VisitSegment
                        visit={item.visit}
                        nowMs={nowMs}
                        onOpenPhoto={onOpenPhoto}
                        onSelectMovement={onSelectMovement}
                      />
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Summary({
  summary,
  nowMs,
}: {
  summary: ReturnType<typeof summarizeVisits>
  nowMs: number
}) {
  const { t, lang } = useI18n()
  const state: EquipmentPresence = summary.status
  const lastMovement = summary.lastMovementAt
  const sinceLast = lastMovement
    ? formatElapsedDuration(
        Math.max(0, nowMs - new Date(lastMovement).getTime()),
        t,
        lang,
      )
    : undefined
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCard
        label={t('currentStatus')}
        value={
          <span className="text-base font-semibold">
            {t(STATE_LABEL[state])}
          </span>
        }
        tone={STATE_TONE[state]}
        icon={
          state === 'inside_workshop' ? (
            <Wrench size={16} />
          ) : (
            <MapPin size={16} />
          )
        }
      />
      {/* Owner decision (wave 6): the visit/day totals were dropped; the
          header answers only "where is it" and "since when". */}
      <StatCard
        label={t('lastMovement')}
        value={
          <span className="text-base font-semibold">{sinceLast ?? '—'}</span>
        }
        hint={lastMovement ? formatDateTime(lastMovement) : undefined}
        icon={<CalendarClock size={16} />}
      />
    </div>
  )
}

function VisitSegment({
  visit,
  nowMs,
  onOpenPhoto,
  onSelectMovement,
}: {
  visit: EquipmentVisit
  nowMs: number
  onOpenPhoto?: (movementId: string) => void
  onSelectMovement?: (movementId: string) => void
}) {
  const { t, lang } = useI18n()
  const workshop = visit.context === 'workshop'
  const duration = visitDurationMs(visit, nowMs)
  const entry = visit.entry
  const exit = visit.exit
  // Company and project sit under the badges as two lines (owner decision);
  // a joined line overflowed the card on long names.
  const placeLines = workshop
    ? [t('workshopLocation')]
    : [entry?.company_name, entry?.project_name].filter(
        (part): part is string => Boolean(part),
      )
  const photoMovementId = entry?.id ?? exit?.id ?? null

  return (
    // The dot sits on the shared vertical rule drawn by the start border.
    <div className="relative border-s ps-5">
      <span
        aria-hidden="true"
        className={cn(
          'absolute -start-[5px] top-4 h-2.5 w-2.5 rounded-full border-2 border-bg',
          visit.open ? 'bg-success' : 'bg-muted',
        )}
      />
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            icon={
              workshop ? (
                <Wrench size={12} aria-hidden="true" />
              ) : (
                <MapPin size={12} aria-hidden="true" />
              )
            }
          >
            {t(workshop ? 'contextWorkshop' : 'contextSite')}
          </Badge>
          {workshop && entry?.workshop_purpose && (
            <WorkshopPurposeBadge purpose={entry.workshop_purpose} />
          )}
          {visit.open && <Badge tone="success">{t('stillInside')}</Badge>}
          {visit.orphanExit && (
            <Badge tone="warning">{t('exitWithoutEntry')}</Badge>
          )}
        </div>
        <div className="min-w-0 space-y-0.5 text-sm">
          {placeLines.length === 0 ? (
            <p className="font-semibold">—</p>
          ) : (
            placeLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                className={cn(
                  'truncate-safe',
                  index === 0 ? 'font-semibold' : 'text-muted',
                )}
                title={line}
              >
                {line}
              </p>
            ))
          )}
        </div>

        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {entry && (
            <Line
              icon={<LogIn size={13} aria-hidden="true" />}
              label={t('entryTime')}
              value={formatDateTime(entry.recorded_at)}
              onClick={
                onSelectMovement ? () => onSelectMovement(entry.id) : undefined
              }
            />
          )}
          {exit && (
            <Line
              icon={<LogOut size={13} aria-hidden="true" />}
              label={t('exitTime')}
              value={formatDateTime(exit.recorded_at)}
              onClick={
                onSelectMovement ? () => onSelectMovement(exit.id) : undefined
              }
            />
          )}
          {duration !== null && (
            <Line
              label={visit.open ? t('durationOnSite') : t('visitDuration')}
              value={formatElapsedDuration(duration, t, lang)}
            />
          )}
          {entry?.supervisor_name && (
            <Line label={t('supervisor')} value={entry.supervisor_name} />
          )}
          {(exit?.driver_name || entry?.driver_name) && (
            <Line
              label={t('driverName')}
              value={exit?.driver_name || entry?.driver_name || ''}
            />
          )}
        </dl>

        {onOpenPhoto && photoMovementId && visit.photoCount > 0 && (
          <PhotoStrip
            count={visit.photoCount}
            urls={entry?.photo_urls ?? exit?.photo_urls ?? null}
            onOpen={() => onOpenPhoto(photoMovementId)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A period the equipment is outside both site and workshop, rendered lighter
 * than a real visit: dashed rule, muted surface, no entry/exit lines.
 */
function GapSegment({ gap }: { gap: OutsideGap }) {
  const { t } = useI18n()
  return (
    <div className="relative border-s border-dashed ps-5">
      <span
        aria-hidden="true"
        className="absolute -start-[5px] top-4 h-2.5 w-2.5 rounded-full border-2 border-bg bg-border"
      />
      <div className="card space-y-1.5 border-dashed bg-surface p-3 text-muted">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t('outsideGap')}</Badge>
          <span className="truncate-safe min-w-0 flex-1 text-sm">
            {gap.open ? (
              <>
                {t('outsideSince')} {formatDate(gap.startDayKey)}
              </>
            ) : (
              <>
                {t('from')} {formatDate(gap.startDayKey)} {t('to')}{' '}
                {formatDate(gap.endDayKey as string)}
              </>
            )}
          </span>
        </div>
        <p className="text-xs">
          {gap.days} {t('days')}
        </p>
      </div>
    </div>
  )
}

function Line({
  icon,
  label,
  value,
  onClick,
}: {
  icon?: ReactNode
  label: string
  value: string
  /** Renders `value` as a link-styled button that opens its own movement. */
  onClick?: () => void
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-muted">
          {icon}
        </span>
      )}
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      {onClick ? (
        <dd className="min-w-0">
          <button
            type="button"
            onClick={onClick}
            className="truncate-safe text-start underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            {value}
          </button>
        </dd>
      ) : (
        <dd className="truncate-safe min-w-0">{value}</dd>
      )}
    </div>
  )
}

/** Up to three thumbnails; evidence photos are never cropped. */
function PhotoStrip({
  count,
  urls,
  onOpen,
}: {
  count: number
  urls: (string | null)[] | null
  onOpen: () => void
}) {
  const { t } = useI18n()
  const shown = Math.min(3, count)
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: shown }, (_, index) => (
        <button
          key={index}
          type="button"
          onClick={onOpen}
          title={t('viewPhotos')}
          aria-label={t('viewPhotos')}
          className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border bg-surface text-muted transition-colors hover:border-fg hover:text-fg"
        >
          {urls?.[index] ? (
            <img
              src={urls[index] ?? undefined}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon size={16} aria-hidden="true" />
          )}
        </button>
      ))}
      <span className="text-xs text-muted">
        {count} {t('photo')}
      </span>
    </div>
  )
}
