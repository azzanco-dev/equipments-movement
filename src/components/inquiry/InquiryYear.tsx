import type { ReactNode } from 'react'
import { Calendar, CircleDashed, History, MapPin, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui'
import {
  INQUIRY_STATE_ORDER,
  type InquiryDay,
  type InquiryMonth,
  type InquiryYearSummary,
} from '@/lib/inquiryYear'
import {
  INQUIRY_STATE_COLORS,
  INQUIRY_STATE_LABEL,
  INQUIRY_SURFACE,
  InquiryCardTitle,
  InquiryIconTile,
  inquiryDayColor,
  inquiryInnerFill,
  inquiryRise,
  useCountUp,
  type InquiryColors,
} from './inquiryStyle'

function YearTile({
  colors,
  icon,
  label,
  value,
  hint,
  share,
  index,
}: {
  /** null: a count, not a place — a plain surface. */
  colors: InquiryColors | null
  icon: ReactNode
  label: string
  value: number
  hint?: string
  share?: number
  index: number
}) {
  const shown = useCountUp(value)
  return (
    <div
      className={cn('inq-rise rounded-2xl p-3.5', !colors && INQUIRY_SURFACE)}
      style={{
        ...inquiryRise(index),
        ...(colors ? { backgroundColor: colors.fill } : null),
      }}
    >
      <div className="flex items-center gap-2">
        <InquiryIconTile
          colors={colors ?? { tint: 'var(--surface-hover)', stroke: 'var(--fg)' }}
          size={26}
        >
          {icon}
        </InquiryIconTile>
        <span className="truncate-safe text-xs text-muted">{label}</span>
      </div>
      <p className="mt-2.5 text-2xl font-bold leading-none tabular-nums">{shown}</p>
      {share !== undefined && colors && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full" style={inquiryInnerFill(colors)}>
          <div
            className="inq-grow h-full rounded-full"
            style={{
              width: `${Math.round(share * 100)}%`,
              backgroundColor: colors.stroke,
              animationDelay: inquiryRise(index).animationDelay,
            }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** The four numbers of the last 12 months, from the same days as the
 *  rings so they always match. */
export function InquiryYearNumbers({
  summary,
  year,
  index,
}: {
  summary: InquiryYearSummary
  year: number
  index: number
}) {
  const { t } = useI18n()
  const share = (days: number) => (summary.counted > 0 ? days / summary.counted : 0)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <YearTile
        index={index}
        colors={INQUIRY_STATE_COLORS.site}
        icon={<MapPin size={13} />}
        label={t('inquiryDaysInProjects')}
        value={summary.siteDays}
        hint={t('inquiryShareOfYear').replace('{percent}', String(summary.siteShare))}
        share={share(summary.siteDays)}
      />
      <YearTile
        index={index + 1}
        colors={INQUIRY_STATE_COLORS.maintenance}
        icon={<Wrench size={13} />}
        label={t('inquiryDaysInWorkshop')}
        value={summary.workshopDays}
        share={share(summary.workshopDays)}
      />
      <YearTile
        index={index + 2}
        colors={INQUIRY_STATE_COLORS.unrecorded}
        icon={<CircleDashed size={13} />}
        label={t('inquiryDaysUnrecorded')}
        value={summary.unrecordedDays}
        share={share(summary.unrecordedDays)}
      />
      <YearTile
        index={index + 3}
        colors={null}
        icon={<History size={13} />}
        label={t('inquiryVisits')}
        value={summary.visitCount}
        hint={t('inquiryWithinYear').replace('{year}', String(year))}
      />
    </div>
  )
}

/** A ring split into parts; `total` is the full circle. */
function Ring({
  parts,
  total,
  size,
  thickness,
  delay,
  children,
}: {
  parts: { key: string; value: number; color: string }[]
  total: number
  size: number
  thickness: number
  delay: number
  children?: ReactNode
}) {
  const radius = 50 - thickness / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--surface)"
          strokeWidth={thickness}
        />
        {parts.map((part) => {
          const length = total > 0 ? (part.value / total) * circumference : 0
          const circle = (
            <circle
              key={part.key}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={part.color}
              strokeWidth={thickness}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              className="inq-ring"
              style={{ animationDelay: `${delay}ms` }}
            />
          )
          offset += length
          return circle
        })}
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  )
}

type Run = { state: InquiryDay['state']; visit: InquiryDay['visit']; start: number; end: number }

/** Consecutive days of the same state and stay. */
function runsOf(days: InquiryDay[]): Run[] {
  const runs: Run[] = []
  days.forEach((day, position) => {
    const last = runs[runs.length - 1]
    if (last && last.state === day.state && last.visit === day.visit) last.end = position
    else runs.push({ state: day.state, visit: day.visit, start: position, end: position })
  })
  return runs
}

/** The legend under a year view: each state with its days. */
function YearLegend({ days }: { days: InquiryDay[] }) {
  const { t } = useI18n()
  const counts = new Map<string, number>()
  for (const day of days)
    if (day.state !== 'before' && day.state !== 'future')
      counts.set(day.state, (counts.get(day.state) ?? 0) + 1)
  return (
    <ul className="flex flex-wrap items-center gap-1.5 text-xs">
      {INQUIRY_STATE_ORDER.filter((key) => counts.get(key)).map((key) => (
        <li
          key={key}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ backgroundColor: INQUIRY_STATE_COLORS[key].fill }}
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: inquiryDayColor(key) }}
          />
          {t(INQUIRY_STATE_LABEL[key])}
          <span className="font-bold tabular-nums">{counts.get(key)}</span>
          <span className="text-muted">{t('days')}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The chosen year as one strip (owner 2026-10-27: «غير اخر 12 شهر لشريط»,
 * then «المفروض بالسنة»): 1 January at the start edge, 31 December at the
 * end edge, every stay a block as long as it lasted in its state's colour,
 * named with its days when it lasted four weeks or more; «بدون تسجيل» light
 * grey; the days before the unit was added and after today left bare. A
 * stay opens its tile in the visit history below.
 */
export function InquiryYearStrip({
  days,
  months,
  index,
  onSelectVisit,
}: {
  days: InquiryDay[]
  months: InquiryMonth[]
  index: number
  onSelectVisit: (key: string) => void
}) {
  const { t, lang } = useI18n()
  const format = new Intl.DateTimeFormat(
    lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB',
    { month: 'short', timeZone: 'UTC' },
  )
  const pct = (position: number) => (position / days.length) * 100
  const starts = new Map<string, number>()
  days.forEach((day, position) => {
    const date = new Date(day.day * 86_400_000)
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    if (!starts.has(key)) starts.set(key, position)
  })
  const labels = months
    .map((month) => ({ month, start: starts.get(month.key) ?? 0 }))

  return (
    <section
      className={cn(INQUIRY_SURFACE, 'inq-rise space-y-3 p-4')}
      style={inquiryRise(index)}
    >
      <InquiryCardTitle icon={<Calendar size={14} />}>{t('inquiryTimeline')}</InquiryCardTitle>
      <div className="space-y-1.5">
        <div className="relative h-14 overflow-hidden rounded-xl bg-surface">
          {runsOf(days).map((run, position) => {
            if (run.state === 'before' || run.state === 'future') return null
            const length = run.end - run.start + 1
            const strong = run.state !== 'unrecorded'
            const visit = run.visit
            const name = visit
              ? visit.context === 'site'
                ? (visit.entry ?? visit.exit)?.project_name || t('project')
                : `${t('workshopLocation')} · ${t(INQUIRY_STATE_LABEL[run.state])}`
              : t(INQUIRY_STATE_LABEL[run.state])
            const label = `${name} · ${length} ${t('days')}`
            const style = {
              insetInlineStart: `${pct(run.start)}%`,
              width: `${pct(length)}%`,
              backgroundColor: inquiryDayColor(run.state),
              color: strong ? 'var(--bg)' : 'var(--muted)',
              boxShadow: 'inset -2px 0 0 var(--bg)',
              animationDelay: `${300 + position * 80}ms`,
            }
            const body =
              length >= 28 ? (
                <>
                  <span className="truncate-safe text-xs font-semibold">{name}</span>
                  <span className="text-[11px] opacity-80">
                    {length} {t('days')}
                  </span>
                </>
              ) : null
            const classes =
              'inq-grow absolute inset-y-0 flex flex-col justify-center overflow-hidden px-2 text-start'
            return visit ? (
              <button
                key={run.start}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onSelectVisit(visit.key)}
                className={cn(
                  classes,
                  'hover:brightness-95 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                )}
                style={style}
              >
                {body}
              </button>
            ) : (
              <div key={run.start} title={label} className={classes} style={style}>
                {body}
              </div>
            )
          })}
        </div>
        <div className="relative h-4 text-[11px] text-muted" aria-hidden="true">
          {labels.map(({ month, start }, position) => (
            <span
              key={month.key}
              className={cn(
                'absolute top-0 whitespace-nowrap',
                position % 2 === 1 && 'hidden sm:inline',
              )}
              style={{ insetInlineStart: `${pct(start)}%` }}
            >
              {format.format(new Date(Date.UTC(month.year, month.month, 1)))}
            </span>
          ))}
        </div>
      </div>
      <YearLegend days={days} />
    </section>
  )
}

/**
 * The last 12 months as a ring per month (owner 2026-10-26, chosen among
 * six views on /ui-kit: «اختار مبدئيا الحلقات»): the month's days in the
 * colour of their state, a part month (the window's first and last) only
 * partly drawn, the project days in the middle; the legend counts the days
 * of each state.
 */
export function InquiryYearRings({
  days,
  months,
  index,
}: {
  days: InquiryDay[]
  months: InquiryMonth[]
  index: number
}) {
  const { t, lang } = useI18n()
  const format = new Intl.DateTimeFormat(
    lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB',
    { month: 'short', timeZone: 'UTC' },
  )
  const counts = new Map<string, number>()
  for (const day of days)
    if (day.state !== 'before' && day.state !== 'future')
      counts.set(day.state, (counts.get(day.state) ?? 0) + 1)
  const legend = INQUIRY_STATE_ORDER.filter((key) => counts.get(key))
  const summary = legend
    .map((key) => `${t(INQUIRY_STATE_LABEL[key])} ${counts.get(key)} ${t('days')}`)
    .join('، ')

  return (
    <section
      className={cn(INQUIRY_SURFACE, 'inq-rise space-y-4 p-4')}
      style={inquiryRise(index)}
    >
      <InquiryCardTitle icon={<Calendar size={14} />}>{t('inquiryTimeline')}</InquiryCardTitle>
      <p className="sr-only">{summary}</p>
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-7 xl:grid-cols-[repeat(13,minmax(0,1fr))]">
        {months.map((month, position) => {
          const label = format.format(new Date(Date.UTC(month.year, month.month, 1)))
          return (
            <div
              key={month.key}
              className="flex flex-col items-center gap-1.5"
              title={INQUIRY_STATE_ORDER.filter((key) => month.counts[key])
                .map((key) => `${t(INQUIRY_STATE_LABEL[key])} ${month.counts[key]}`)
                .join(' · ')}
            >
              <Ring
                size={58}
                thickness={13}
                total={month.daysInMonth}
                delay={250 + position * 60}
                parts={INQUIRY_STATE_ORDER.filter((key) => month.counts[key]).map((key) => ({
                  key,
                  value: month.counts[key],
                  color: inquiryDayColor(key),
                }))}
              >
                <span className="text-xs font-bold tabular-nums">{month.counts.site}</span>
              </Ring>
              <span className="whitespace-nowrap text-[11px] text-muted">
                {label}
                <span className="sr-only"> {month.year}</span>
              </span>
            </div>
          )
        })}
      </div>
      <ul className="flex flex-wrap items-center gap-1.5 text-xs">
        {legend.map((key) => (
          <li
            key={key}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ backgroundColor: INQUIRY_STATE_COLORS[key].fill }}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: inquiryDayColor(key) }}
            />
            {t(INQUIRY_STATE_LABEL[key])}
            <span className="font-bold tabular-nums">{counts.get(key)}</span>
            <span className="text-muted">{t('days')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
