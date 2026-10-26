import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  Ban,
  Building2,
  Calendar,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  History,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  ParkingCircle,
  Search,
  Tag,
  Truck,
  User,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Button,
  DescriptionList,
  DetailHeader,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
  cn,
  type DescriptionListItem,
} from '@/components/ui'
import {
  EquipmentSuggestSearch,
  type EquipmentSuggestion,
} from '@/components/inquiry/EquipmentSuggestSearch'
import { ExitPurposeBadge } from '@/components/movement/ExitPurposeBadge'
import { EquipmentStateBadge } from '@/components/equipment/EquipmentStateBadge'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import { splitPlateForDisplay } from '@/lib/plate'
import {
  equipmentStateFromMovement,
  type EquipmentState,
} from '@/lib/equipmentState'
import {
  buildEquipmentVisits,
  buildTimelineItems,
  msToDays,
  visitDurationMs,
  type EquipmentPresence,
  type EquipmentVisit,
  type OutsideGap,
  type TimelineMovement,
  type WorkshopPurpose,
} from '@/lib/visitTimeline'

// Review of the inquiry page redesign (owner 2026-10-26: «صفحة الاستعلام
// ابغى تحسين جذري لها», then «ابدا بالنموذج في /ui-kit مع شريط النشاط»).
// Sample data only, no database reads. It follows the approved detail-page
// pattern of the supplier PO page: a header card (identity, the one state,
// "now", the summary strip and the year's activity strip), then the facts
// and the location beside a compact visit list.

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_DAYS = 365

type DemoState = 'data' | 'loading' | 'start' | 'error'
type Viewer = 'admin' | 'other'

interface DemoUnit {
  id: string
  code: string
  type: string
  plate: string | null
  chassis: string | null
  companyNumber: string | null
  owner: string
  supplier: string | null
  previousCodes: string[]
  createdDaysAgo: number
  /** The open PO of the unit's current project visit, if any. */
  po: string | null
  movements: TimelineMovement[]
}

/** An instant `daysAgo` days back at a Saudi wall-clock hour. */
function at(now: number, daysAgo: number, hour = 9, minute = 0): string {
  const day = new Date(now - daysAgo * DAY_MS)
  day.setUTCHours(hour - 3, minute, 0, 0)
  return day.toISOString()
}

type Place = { company: string; project: string; foreman: string }

const SALINI: Place = {
  company: 'شركة ساليني العربية السعودية المحدودة',
  project: 'مشروع الدرعية',
  foreman: 'Jagdeep Chopra',
}
const NESMA: Place = {
  company: 'شركة نسما للمقاولات',
  project: 'مشروع البحر الاحمر',
  foreman: 'محمد صالح',
}
const MABANI: Place = {
  company: 'شركة المباني',
  project: 'مشروع حي السفارات',
  foreman: 'احمد يوسف',
}

function sampleUnits(now: number): DemoUnit[] {
  let seq = 0
  const site = (
    type: 'entry' | 'exit',
    daysAgo: number,
    place: Place,
    extra: Partial<TimelineMovement> = {},
  ): TimelineMovement => ({
    id: `m${++seq}`,
    movement_context: 'site',
    movement_type: type,
    recorded_at: at(now, daysAgo, type === 'entry' ? 8 : 17, 10),
    company_name: place.company,
    project_name: place.project,
    supervisor_name: place.foreman,
    ...extra,
  })
  const workshop = (
    type: 'entry' | 'exit',
    daysAgo: number,
    purpose: WorkshopPurpose | null,
  ): TimelineMovement => ({
    id: `m${++seq}`,
    movement_context: 'workshop',
    movement_type: type,
    recorded_at: at(now, daysAgo, type === 'entry' ? 11 : 15, 5),
    workshop_purpose: type === 'entry' ? purpose : null,
    supervisor_name: 'صادق الساقية',
  })

  return [
    {
      id: 'u-a291',
      code: 'A291',
      type: 'CRANE 7 TON BASKET',
      plate: '1128-XVV',
      chassis: 'JHHZJL1H0BK001128',
      companyNumber: 'SA-7781',
      owner: 'العزاني',
      supplier: null,
      previousCodes: [],
      createdDaysAgo: 900,
      po: 'SPO260046',
      movements: [
        site('entry', 700, SALINI, { driver_name: 'سالم العتيبي' }),
        site('exit', 13, SALINI, {
          driver_name: 'سالم العتيبي',
          exit_purpose: 'maintenance',
        }),
        workshop('entry', 11, 'parking'),
        workshop('exit', 7, null),
        site('entry', 1, SALINI, {
          driver_name: 'عبدالله احمد علي احمد النعمي',
        }),
      ],
    },
    {
      id: 'u-f118',
      code: 'F118',
      type: 'حفار 330',
      plate: null,
      chassis: 'CAT0330DJXBN01182',
      companyNumber: null,
      owner: 'طرف ثالث F',
      supplier: null,
      previousCodes: ['A120'],
      createdDaysAgo: 600,
      po: null,
      movements: [
        site('entry', 340, NESMA, { driver_name: 'ماجد الحربي' }),
        site('exit', 250, NESMA, {
          driver_name: 'ماجد الحربي',
          exit_purpose: 'work_completed',
        }),
        site('entry', 230, SALINI, { driver_name: 'ماجد الحربي' }),
        site('exit', 150, SALINI, {
          driver_name: 'ماجد الحربي',
          exit_purpose: 'maintenance',
        }),
        workshop('entry', 149, 'maintenance'),
        workshop('exit', 120, null),
        site('entry', 118, MABANI, { driver_name: 'فهد القحطاني' }),
        site('exit', 40, MABANI, {
          driver_name: 'فهد القحطاني',
          exit_purpose: 'maintenance',
        }),
        workshop('entry', 38, 'out_of_service'),
        workshop('exit', 30, null),
        site('entry', 25, SALINI, { driver_name: 'فهد القحطاني' }),
        site('exit', 7, SALINI, {
          driver_name: 'فهد القحطاني',
          exit_purpose: 'maintenance',
        }),
        workshop('entry', 6, 'maintenance'),
      ],
    },
    {
      id: 'u-b044',
      code: 'B044',
      type: 'لودر 950',
      plate: '4501-SQR',
      chassis: 'CAT950HX3B04411',
      companyNumber: 'B-44',
      owner: 'طرف ثالث B',
      supplier: null,
      previousCodes: [],
      createdDaysAgo: 420,
      po: null,
      movements: [
        site('entry', 300, MABANI, { driver_name: 'سعيد الشمري' }),
        site('exit', 180, MABANI, {
          driver_name: 'سعيد الشمري',
          exit_purpose: 'work_completed',
        }),
        site('entry', 170, NESMA, { driver_name: 'سعيد الشمري' }),
        site('exit', 9, NESMA, {
          driver_name: 'سعيد الشمري',
          exit_purpose: 'work_completed',
        }),
      ],
    },
    {
      id: 'u-u214',
      code: 'U214',
      type: 'رافعة شوكية',
      plate: '5521-RSA',
      chassis: null,
      companyNumber: null,
      owner: 'مالك اخر',
      supplier: 'مؤسسة الراجحي لتاجير المعدات',
      previousCodes: [],
      createdDaysAgo: 3,
      po: null,
      movements: [],
    },
  ]
}

// --- Derived values -----------------------------------------------------------

function latestMovement(unit: DemoUnit): TimelineMovement | null {
  let latest: TimelineMovement | null = null
  for (const movement of unit.movements)
    if (!latest || movement.recorded_at > latest.recorded_at) latest = movement
  return latest
}

function unitState(unit: DemoUnit): EquipmentState {
  const latest = latestMovement(unit)
  return equipmentStateFromMovement(
    latest
      ? {
          movement_type: latest.movement_type,
          movement_context: latest.movement_context,
          workshop_purpose: latest.workshop_purpose ?? null,
        }
      : null,
  )
}

function presence(visits: EquipmentVisit[]): EquipmentPresence {
  const open = visits.find((visit) => visit.open)
  if (!open) return 'outside'
  return open.context === 'site' ? 'inside_site' : 'inside_workshop'
}

/** Days of `[from, to)` that fall inside the window. */
function overlapDays(
  from: number,
  to: number,
  windowStart: number,
  windowEnd: number,
): number {
  const start = Math.max(from, windowStart)
  const end = Math.min(to, windowEnd)
  return end > start ? (end - start) / DAY_MS : 0
}

interface YearSummary {
  siteDays: number
  workshopDays: number
  outsideDays: number
  visitCount: number
  /** Share of the counted days spent in a project. */
  siteShare: number
}

/** The last 12 months, from the unit's creation when it is younger. */
function summarizeYear(
  visits: EquipmentVisit[],
  createdAt: number,
  now: number,
): YearSummary {
  const windowStart = Math.max(now - YEAR_DAYS * DAY_MS, createdAt)
  let site = 0
  let workshop = 0
  let count = 0
  for (const visit of visits) {
    if (!visit.startedAt) continue
    const from = Date.parse(visit.startedAt)
    const to = visit.endedAt ? Date.parse(visit.endedAt) : now
    const days = overlapDays(from, to, windowStart, now)
    if (days <= 0) continue
    count += 1
    if (visit.context === 'site') site += days
    else workshop += days
  }
  const total = Math.max(0, (now - windowStart) / DAY_MS)
  const outside = Math.max(0, total - site - workshop)
  return {
    siteDays: Math.round(site),
    workshopDays: Math.round(workshop),
    outsideDays: Math.round(outside),
    visitCount: count,
    siteShare: total > 0 ? Math.round((site / total) * 100) : 0,
  }
}

// --- Small pieces -------------------------------------------------------------

function PlateText({ plate }: { plate: string }) {
  const parts = splitPlateForDisplay(plate)
  if (!parts) return <>{plate}</>
  return (
    <bdi dir="ltr">
      {parts.digits}{' '}
      <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
    </bdi>
  )
}

/** The colour pair of a visit: projects green, the workshop by purpose. */
function visitColors(visit: EquipmentVisit): { fill: string; stroke: string } {
  if (visit.context === 'site')
    return { fill: 'var(--chart-1)', stroke: 'var(--chart-stroke-1)' }
  const purpose = visit.entry?.workshop_purpose
  if (purpose === 'parking')
    return { fill: 'var(--chart-3)', stroke: 'var(--chart-stroke-3)' }
  if (purpose === 'out_of_service')
    return { fill: 'var(--danger-soft)', stroke: 'var(--danger)' }
  return { fill: 'var(--chart-2)', stroke: 'var(--chart-stroke-2)' }
}

const OUTSIDE_COLORS = { fill: 'var(--chart-4)', stroke: 'var(--chart-stroke-4)' }

/** The colour of where the unit is now: its open visit's, else outside. */
function presenceColors(visits: EquipmentVisit[]): {
  fill: string
  stroke: string
} {
  const open = visits.find((visit) => visit.open)
  return open ? visitColors(open) : OUTSIDE_COLORS
}

/**
 * Two flat looks to compare (owner 2026-10-26: the gradients «مو طبيعي
 * سوء القريديانت» were dropped). Colour means one thing only, where the
 * unit is: projects green, maintenance amber, standby blue, out of service
 * light red, outside grey.
 *   * calm: white cards; only «الحين» is filled with the place's colour.
 *   * bold: the header card is filled with it, and so are the day tiles.
 */
type Look = 'calm' | 'bold'

/** A small heading with a neutral icon circle. */
function CardTitle({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-hover text-muted"
      >
        {icon}
      </span>
      {children}
    </h3>
  )
}

/** A round tile in the strong colour with the icon in the page colour. */
function IconTile({
  colors,
  size = 32,
  children,
}: {
  colors: { stroke: string }
  size?: number
  children: ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full shadow-sm"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.stroke,
        color: 'var(--bg)',
      }}
    >
      {children}
    </span>
  )
}

function VisitIcon({ visit }: { visit: EquipmentVisit }) {
  const colors = visitColors(visit)
  const purpose = visit.entry?.workshop_purpose
  const Icon =
    visit.context === 'site'
      ? MapPin
      : purpose === 'parking'
        ? ParkingCircle
        : purpose === 'out_of_service'
          ? Ban
          : Wrench
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.fill, color: colors.stroke }}
    >
      <Icon size={15} />
    </span>
  )
}

function visitTitle(visit: EquipmentVisit): string {
  if (visit.context === 'workshop') return 'الورشة'
  const movement = visit.entry ?? visit.exit
  return movement?.project_name ?? 'مشروع'
}

function visitRange(visit: EquipmentVisit): string {
  const from = visit.startedAt ? formatDate(visit.startedAt) : '—'
  const to = visit.open ? 'الان' : visit.endedAt ? formatDate(visit.endedAt) : '—'
  return `${from} ← ${to}`
}

// --- Start view (before a unit is chosen) -------------------------------------

function SearchField({
  units,
  onPick,
  initial = '',
}: {
  units: DemoUnit[]
  onPick: (id: string) => void
  initial?: string
}) {
  const [query, setQuery] = useState(initial)
  const term = query.trim().toLowerCase()
  const suggestions: EquipmentSuggestion[] =
    term.length < 1
      ? []
      : units
          .filter((unit) =>
            [unit.code, unit.type, unit.plate, unit.chassis, ...unit.previousCodes]
              .filter(Boolean)
              .some((value) => value!.toLowerCase().includes(term)),
          )
          .map((unit) => ({
            id: unit.id,
            code: unit.code,
            type_name: unit.type,
            plate_number: unit.plate,
            chassis_number: unit.chassis,
            matched_previous_code:
              !unit.code.toLowerCase().includes(term) &&
              unit.previousCodes.some((code) => code.toLowerCase().includes(term)),
          }))
  return (
    <EquipmentSuggestSearch
      query={query}
      onQueryChange={setQuery}
      suggestions={suggestions}
      onPick={(suggestion) => {
        setQuery(suggestion.code)
        onPick(suggestion.id)
      }}
      placeholder="الكود او اللوحة او الشاصي او النوع"
      inputDir="auto"
    />
  )
}

function StartView({
  units,
  recent,
  onPick,
}: {
  units: DemoUnit[]
  recent: string[]
  onPick: (id: string) => void
}) {
  const recentUnits = recent
    .map((id) => units.find((unit) => unit.id === id))
    .filter((unit): unit is DemoUnit => Boolean(unit))
  return (
    <div className="card mx-auto max-w-2xl space-y-5 px-4 py-8 text-center sm:px-8 sm:py-10">
      <span className="mx-auto flex w-fit">
        <IconTile colors={{ stroke: 'var(--primary)' }} size={52}>
          <Search size={24} />
        </IconTile>
      </span>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">ابحث عن معدة</h3>
        <p className="text-sm text-muted">
          اعرف وين المعدة الحين، ووين اشتغلت خلال السنة.
        </p>
      </div>
      <div className="text-start">
        <SearchField units={units} onPick={onPick} />
      </div>
      {recentUnits.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted">اخر استعلاماتك</p>
          <div className="flex flex-wrap justify-center gap-2">
            {recentUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => onPick(unit.id)}
                className="inline-flex items-center gap-2 rounded-full border bg-bg px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-surface-hover"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: presenceColors(
                      buildEquipmentVisits(unit.movements),
                    ).stroke,
                  }}
                />
                <bdi dir="ltr" className="font-semibold">
                  {unit.code}
                </bdi>
                <span className="text-xs text-muted">{unit.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Header: identity, now, summary, activity -----------------------------------

function NowPanel({
  unit,
  visits,
  now,
  look,
}: {
  unit: DemoUnit
  visits: EquipmentVisit[]
  now: number
  look: Look
}) {
  const { t, lang } = useI18n()
  const where = presence(visits)
  const open = visits.find((visit) => visit.open) ?? null
  const last = visits[0] ?? null

  let icon: ReactNode
  let tone: { fill: string; stroke: string }
  let title: ReactNode
  let place: ReactNode = null
  let since: string | null = null
  const people: { icon: ReactNode; label: string; value: string }[] = []
  let extra: ReactNode = null

  if (where === 'inside_site' && open) {
    tone = visitColors(open)
    icon = <MapPin size={18} />
    title = (
      <>
        داخل <span className="font-bold">{open.entry?.project_name}</span>
      </>
    )
    place = open.entry?.company_name
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={14} />,
        label: 'الفورمان',
        value: open.entry.supervisor_name,
      })
    if (open.entry?.driver_name)
      people.push({
        icon: <User size={14} />,
        label: 'السائق',
        value: open.entry.driver_name,
      })
    extra = unit.po ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-bg px-2.5 py-1 text-xs font-semibold">
        <FileText size={13} aria-hidden="true" className="text-muted" />
        <bdi dir="ltr">{unit.po}</bdi>
      </span>
    ) : (
      <Badge tone="warning" size="sm">
        بدون PO
      </Badge>
    )
  } else if (where === 'inside_workshop' && open) {
    tone = visitColors(open)
    icon = <Wrench size={18} />
    title = <span className="font-bold">في الورشة</span>
    since = open.startedAt
    if (open.entry?.workshop_purpose)
      extra = <WorkshopPurposeBadge purpose={open.entry.workshop_purpose} />
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={14} />,
        label: 'مسجل الدخول',
        value: open.entry.supervisor_name,
      })
  } else if (last) {
    tone = { fill: 'var(--chart-4)', stroke: 'var(--chart-stroke-4)' }
    icon = <Truck size={18} />
    title = <span className="font-bold">خارج المشاريع والورشة</span>
    since = last.endedAt
    place = `اخر مكان: ${visitTitle(last)}`
  } else {
    tone = { fill: 'var(--chart-4)', stroke: 'var(--chart-stroke-4)' }
    icon = <Truck size={18} />
    title = <span className="font-bold">لا توجد حركات بعد</span>
    place = 'لم تدخل اي مشروع ولا الورشة منذ اضافتها.'
  }

  const sinceMs = since ? Date.parse(since) : null
  // calm: this is THE coloured block of the page, filled flat. bold: the
  // header around it is already filled, so it stands out in white.
  const filled = look === 'calm'
  return (
    <div
      className={cn('rounded-xl border p-3 sm:p-4', !filled && 'bg-bg')}
      style={
        {
          borderColor: tone.stroke,
          backgroundColor: filled ? tone.fill : undefined,
        } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-start gap-3">
        <IconTile colors={tone} size={44}>
          {icon}
        </IconTile>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p
            className="text-xs font-semibold"
            style={{ color: filled ? 'var(--chart-text)' : tone.stroke }}
          >
            الحين
          </p>
          <p className="text-lg leading-snug">{title}</p>
          {place && (
            <p
              className="text-sm"
              style={{ color: filled ? 'var(--chart-text)' : 'var(--muted)' }}
            >
              {place}
            </p>
          )}
          {sinceMs !== null && (
            <p className="text-sm">
              منذ{' '}
              <span className="font-semibold">
                {formatElapsedDuration(now - sinceMs, t, lang)}
              </span>
              <span className="text-muted"> · {formatDate(since!)}</span>
            </p>
          )}
        </div>
        {/* Under the text on a phone, so it never squeezes the place name. */}
        {extra && (
          <div className="basis-full ps-14 sm:basis-auto sm:shrink-0 sm:ps-0">
            {extra}
          </div>
        )}
      </div>
      {people.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 border-t pt-3 text-sm sm:grid-cols-2">
          {people.map((person) => (
            <div key={person.label} className="flex items-center gap-2">
              <span aria-hidden="true" className="text-muted">
                {person.icon}
              </span>
              <dt className="text-muted">{person.label}:</dt>
              <dd className="m-0 min-w-0 truncate-safe font-medium">
                {person.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * The last 12 months as one bar (owner 2026-10-26, «مع شريط النشاط»): the
 * oldest day at the start edge, today at the end edge; projects green, the
 * workshop by its purpose, outside grey, and the time before the unit was
 * added left blank. A segment is a button that opens its visit below.
 */
function ActivityStrip({
  visits,
  createdAt,
  now,
  onSelectVisit,
}: {
  visits: EquipmentVisit[]
  createdAt: number
  now: number
  onSelectVisit: (key: string) => void
}) {
  const { t, lang } = useI18n()
  const windowStart = now - YEAR_DAYS * DAY_MS
  const span = now - windowStart
  const pct = (ms: number) => ((ms - windowStart) / span) * 100

  const segments = visits
    .filter((visit) => visit.startedAt)
    .map((visit) => {
      const from = Math.max(Date.parse(visit.startedAt!), windowStart)
      const to = Math.min(
        visit.endedAt ? Date.parse(visit.endedAt) : now,
        now,
      )
      return { visit, from, to }
    })
    .filter((segment) => segment.to > segment.from)

  const blankUntil = createdAt > windowStart ? pct(createdAt) : 0

  // One tick per month start inside the window.
  const ticks: { key: string; at: number; label: string }[] = []
  const cursor = new Date(windowStart)
  cursor.setUTCDate(1)
  cursor.setUTCHours(0, 0, 0, 0)
  const monthFormat = new Intl.DateTimeFormat(
    lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB',
    { month: 'short' },
  )
  while (cursor.getTime() <= now) {
    if (cursor.getTime() >= windowStart)
      ticks.push({
        key: cursor.toISOString(),
        at: pct(cursor.getTime()),
        label: monthFormat.format(cursor),
      })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  const legend = [
    { label: 'مشروع', fill: 'var(--chart-1)', stroke: 'var(--chart-stroke-1)' },
    { label: 'صيانة', fill: 'var(--chart-2)', stroke: 'var(--chart-stroke-2)' },
    { label: 'وقوف', fill: 'var(--chart-3)', stroke: 'var(--chart-stroke-3)' },
    { label: 'خارج الخدمة', fill: 'var(--danger-soft)', stroke: 'var(--danger)' },
    { label: 'خارج', fill: 'var(--chart-4)', stroke: 'var(--chart-stroke-4)' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Calendar size={14} />}>نشاط اخر 12 شهر</CardTitle>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border"
                style={{ backgroundColor: item.fill, borderColor: item.stroke }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="relative h-10 overflow-hidden rounded-lg border"
        style={{ backgroundColor: 'var(--chart-4)' }}
      >
        {blankUntil > 0 && (
          <div
            className="absolute inset-y-0 start-0 border-e border-dashed bg-surface"
            style={{ width: `${blankUntil}%` }}
            title="قبل اضافة المعدة"
          />
        )}
        {segments.map(({ visit, from, to }) => {
          const colors = visitColors(visit)
          const days = msToDays(to - from)
          const label = `${visitTitle(visit)} · ${visitRange(visit)} · ${days} يوم`
          return (
            <button
              key={visit.key}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onSelectVisit(visit.key)}
              className="absolute inset-y-0 min-w-[3px] border-x transition-opacity hover:opacity-80 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              style={{
                insetInlineStart: `${pct(from)}%`,
                width: `${pct(to) - pct(from)}%`,
                backgroundColor: colors.fill,
                borderColor: colors.stroke,
              }}
            />
          )
        })}
      </div>
      <div className="relative h-4 text-[11px] text-muted" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span
            key={tick.key}
            className={cn(
              'absolute top-0 -translate-x-1/2 whitespace-nowrap rtl:translate-x-1/2',
              index % 2 === 1 && 'hidden sm:inline',
            )}
            style={{ insetInlineStart: `${tick.at}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <p className="sr-only">
        {segments
          .map(
            ({ visit, from, to }) =>
              `${visitTitle(visit)} ${msToDays(to - from)} ${t('days')}`,
          )
          .join('، ')}
      </p>
    </div>
  )
}

/** A number tile for this review (a candidate look, not the shared
 *  `StatCard`): the number in its place's colour and, for the day counts, a
 *  thin bar of its share of the year. calm: white; bold: filled flat. */
function StatTile({
  colors,
  icon,
  label,
  value,
  hint,
  share,
  look,
}: {
  colors: { fill: string; stroke: string }
  icon: ReactNode
  label: string
  value: number
  hint?: string
  share?: number
  look: Look
}) {
  const filled = look === 'bold'
  return (
    <div
      className={cn('rounded-xl border p-3', !filled && 'bg-bg')}
      style={
        filled
          ? { backgroundColor: colors.fill, borderColor: colors.stroke }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <IconTile colors={colors} size={28}>
          {icon}
        </IconTile>
        <span
          className="truncate-safe text-xs"
          style={{ color: filled ? 'var(--chart-text)' : 'var(--muted)' }}
        >
          {label}
        </span>
      </div>
      <p
        className="mt-2 text-3xl font-bold leading-none tabular-nums"
        style={{ color: filled ? 'var(--chart-text)' : colors.stroke }}
      >
        {value}
      </p>
      {share !== undefined ? (
        <div
          className="mt-2.5 h-1.5 overflow-hidden rounded-full"
          style={{ backgroundColor: filled ? 'var(--bg)' : 'var(--surface-hover)' }}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(share * 100)}%`,
              backgroundColor: colors.stroke,
            }}
          />
        </div>
      ) : null}
      {hint && (
        <p
          className="mt-1.5 text-xs"
          style={{ color: filled ? 'var(--chart-text)' : 'var(--muted)' }}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

function HeaderCard({
  unit,
  visits,
  now,
  onSelectVisit,
  onChange,
  look,
}: {
  unit: DemoUnit
  visits: EquipmentVisit[]
  now: number
  onSelectVisit: (key: string) => void
  onChange: () => void
  look: Look
}) {
  const createdAt = now - unit.createdDaysAgo * DAY_MS
  const year = summarizeYear(visits, createdAt, now)
  const hasHistory = visits.length > 0
  const counted = year.siteDays + year.workshopDays + year.outsideDays
  const share = (days: number) => (counted > 0 ? days / counted : 0)
  const place = presenceColors(visits)
  return (
    <div
      className="card space-y-4 p-4"
      style={
        look === 'bold'
          ? { backgroundColor: place.fill, borderColor: place.stroke }
          : undefined
      }
    >
      <DetailHeader
        as="h2"
        identifier={unit.code}
        identifierLtr
        badges={
          <>
            <EquipmentStateBadge state={unitState(unit)} />
            <EquipmentNewBadge isNew={unit.createdDaysAgo <= 7} />
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-medium text-fg">{unit.type}</span>
            <span aria-hidden="true">·</span>
            {unit.plate ? (
              <PlateText plate={unit.plate} />
            ) : (
              <bdi dir="ltr">{unit.chassis}</bdi>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<ExternalLink size={14} aria-hidden="true" />}
            >
              صفحة المعدة
            </Button>
            <Button size="sm" variant="ghost" onClick={onChange}>
              معدة اخرى
            </Button>
          </div>
        }
      />

      <NowPanel unit={unit} visits={visits} now={now} look={look} />

      {hasHistory && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              look={look}
              colors={{ fill: 'var(--chart-1)', stroke: 'var(--chart-stroke-1)' }}
              icon={<MapPin size={15} />}
              label="ايام في المشاريع"
              value={year.siteDays}
              hint={`${year.siteShare}% من السنة`}
              share={share(year.siteDays)}
            />
            <StatTile
              look={look}
              colors={{ fill: 'var(--chart-2)', stroke: 'var(--chart-stroke-2)' }}
              icon={<Wrench size={15} />}
              label="ايام في الورشة"
              value={year.workshopDays}
              share={share(year.workshopDays)}
            />
            <StatTile
              look={look}
              colors={OUTSIDE_COLORS}
              icon={<Truck size={15} />}
              label="ايام خارج"
              value={year.outsideDays}
              share={share(year.outsideDays)}
            />
            {/* A count, not a place: monochrome. */}
            <StatTile
              look="calm"
              colors={{ fill: 'var(--bg)', stroke: 'var(--primary)' }}
              icon={<History size={15} />}
              label="الزيارات"
              value={year.visitCount}
              hint="خلال 12 شهر"
            />
          </div>
          {/* On the filled header the strip gets its own white box, or its
              green would vanish into the card's. */}
          <div
            className={cn(look === 'bold' && 'rounded-xl border bg-bg p-3')}
          >
            <ActivityStrip
              visits={visits}
              createdAt={createdAt}
              now={now}
              onSelectVisit={onSelectVisit}
            />
          </div>
        </>
      )}
    </div>
  )
}

// --- Body: facts, location, visits ---------------------------------------------

function FactsCard({ unit, now }: { unit: DemoUnit; now: number }) {
  const items: DescriptionListItem[] = [
    { key: 'owner', icon: <Tag size={16} />, label: 'المالك', value: unit.owner },
    ...(unit.supplier
      ? [
          {
            key: 'supplier',
            icon: <Building2 size={16} />,
            label: 'المورد',
            value: unit.supplier,
          },
        ]
      : []),
    {
      key: 'plate',
      icon: <Hash size={16} />,
      label: 'رقم اللوحة',
      value: unit.plate ? <PlateText plate={unit.plate} /> : null,
    },
    {
      key: 'chassis',
      icon: <Hash size={16} />,
      label: 'رقم الشاصي',
      value: unit.chassis,
      dir: 'ltr',
    },
    {
      key: 'companyNumber',
      icon: <Hash size={16} />,
      label: 'رقم المعدة لدى الشركة',
      value: unit.companyNumber,
      dir: 'ltr',
    },
    ...(unit.previousCodes.length
      ? [
          {
            key: 'previous',
            icon: <History size={16} />,
            label: 'ارقام سابقة',
            value: unit.previousCodes.join('، '),
            dir: 'ltr' as const,
          },
        ]
      : []),
    {
      key: 'created',
      icon: <Calendar size={16} />,
      label: 'تاريخ الاضافة',
      value: formatDate(new Date(now - unit.createdDaysAgo * DAY_MS)),
      dir: 'ltr',
    },
  ]
  return (
    <div className="card p-4">
      <CardTitle icon={<Tag size={14} />}>بيانات المعدة</CardTitle>
      {/* Two columns while the card spans the page, one beside the visits. */}
      <DescriptionList items={items} columns={2} className="mt-1 xl:grid-cols-1" />
    </div>
  )
}

/** Admin only, as today (`equipment.location.view`). Smaller than the live
 *  card, and folded on a phone until asked for. */
function LocationCard() {
  const [shown, setShown] = useState(false)
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <CardTitle icon={<Navigation size={14} />}>الموقع الحالي</CardTitle>
          <p className="text-xs text-muted">
            اخر اشارة منذ 20 ث · السرعة 0 كم/س · المحرك يعمل
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="xl:hidden"
          icon={<Navigation size={14} aria-hidden="true" />}
          onClick={() => setShown((value) => !value)}
          aria-expanded={shown}
        >
          {shown ? 'اخفاء الخريطة' : 'عرض الخريطة'}
        </Button>
      </div>
      <div
        className={cn(
          'h-44 items-center justify-center rounded-lg border bg-surface text-muted xl:flex',
          shown ? 'flex' : 'hidden',
        )}
      >
        <span className="flex items-center gap-2 text-sm">
          <MapPin size={16} aria-hidden="true" />
          خريطة مصغرة
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon={<ExternalLink size={14} aria-hidden="true" />}
      >
        فتح في خرائط قوقل
      </Button>
    </div>
  )
}

function VisitRow({
  visit,
  now,
  expanded,
  onToggle,
}: {
  visit: EquipmentVisit
  now: number
  expanded: boolean
  onToggle: () => void
}) {
  const { t, lang } = useI18n()
  const duration = visitDurationMs(visit, now)
  const entry = visit.entry
  const exit = visit.exit
  const company = visit.context === 'site' ? (entry ?? exit)?.company_name : null
  const driver = exit?.driver_name || entry?.driver_name || null
  const colors = visitColors(visit)
  const details: DescriptionListItem[] = [
    {
      key: 'entry',
      icon: <LogIn size={15} />,
      label: 'الدخول',
      value: entry ? (
        <button type="button" className="underline underline-offset-4">
          {formatDateTime(entry.recorded_at)}
        </button>
      ) : null,
    },
    {
      key: 'exit',
      icon: <LogOut size={15} />,
      label: 'الخروج',
      value: exit ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="underline underline-offset-4">
            {formatDateTime(exit.recorded_at)}
          </button>
          {visit.context === 'site' && (
            <ExitPurposeBadge purpose={exit.exit_purpose} />
          )}
        </span>
      ) : visit.open ? (
        'ما زالت داخل'
      ) : null,
    },
    {
      key: 'foreman',
      icon: <UserCheck size={15} />,
      label: visit.context === 'site' ? 'الفورمان' : 'مسجل الدخول',
      value: entry?.supervisor_name,
    },
    ...(visit.context === 'site'
      ? [
          {
            key: 'driver',
            icon: <User size={15} />,
            label: 'السائق',
            value: driver,
          },
        ]
      : []),
  ]
  return (
    <li
      id={`visit-${visit.key}`}
      className="scroll-mt-24 overflow-hidden rounded-lg border-s-4"
      style={{
        borderInlineStartColor: colors.stroke,
        backgroundColor: expanded ? 'var(--surface-hover)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-2 py-2.5 text-start transition-colors hover:bg-surface-hover sm:px-3"
      >
        <VisitIcon visit={visit} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{visitTitle(visit)}</span>
            {visit.context === 'workshop' && entry?.workshop_purpose && (
              <WorkshopPurposeBadge purpose={entry.workshop_purpose} />
            )}
            {visit.open && (
              <Badge tone="success" size="sm">
                ما زالت داخل
              </Badge>
            )}
          </span>
          {company && (
            <span className="mt-0.5 block truncate-safe text-xs text-muted">
              {company}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-muted">
            <span className="whitespace-nowrap">
              <bdi dir="ltr">
                {visit.startedAt ? formatDate(visit.startedAt) : '—'}
              </bdi>
              {' ← '}
              {visit.open ? (
                'الان'
              ) : (
                <bdi dir="ltr">
                  {visit.endedAt ? formatDate(visit.endedAt) : '—'}
                </bdi>
              )}
            </span>
            {duration !== null && (
              <span
                className="ms-1.5 whitespace-nowrap font-bold sm:hidden"
                style={{ color: colors.stroke }}
              >
                · {formatElapsedDuration(duration, t, lang)}
              </span>
            )}
          </span>
        </span>
        {/* On a phone the duration joins the dates line instead. */}
        <span className="hidden w-32 shrink-0 justify-end sm:flex">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
            style={{ backgroundColor: colors.fill, color: 'var(--chart-text)' }}
          >
            {duration !== null ? formatElapsedDuration(duration, t, lang) : '—'}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="pb-2 ps-11 pe-2 sm:ps-14">
          <DescriptionList items={details} columns={2} />
        </div>
      )}
    </li>
  )
}

function GapRow({ gap }: { gap: OutsideGap }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1 text-xs text-muted sm:px-3">
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed" />
      <span>
        {gap.open ? 'خارج منذ' : 'خارج'} {gap.days} يوم
      </span>
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed" />
    </li>
  )
}

type VisitFilter = 'all' | 'site' | 'workshop'

function VisitList({
  visits,
  now,
  expandedKey,
  onToggle,
}: {
  visits: EquipmentVisit[]
  now: number
  expandedKey: string | null
  onToggle: (key: string) => void
}) {
  const [filter, setFilter] = useState<VisitFilter>('all')
  const items = buildTimelineItems(visits, now).filter((item) =>
    filter === 'all'
      ? true
      : item.kind === 'visit' && item.visit.context === filter,
  )
  const count = (context: VisitFilter) =>
    context === 'all'
      ? visits.length
      : visits.filter((visit) => visit.context === context).length

  // A year heading before the first item of each year.
  let lastYear = ''
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<History size={14} />}>سجل الزيارات</CardTitle>
        <Tabs value={filter} onValueChange={(next) => setFilter(next as VisitFilter)}>
          <TabsList variant="segmented" aria-label="نوع الزيارات">
            <TabsTrigger value="all">الكل {count('all')}</TabsTrigger>
            <TabsTrigger value="site">المشاريع {count('site')}</TabsTrigger>
            <TabsTrigger value="workshop">الورشة {count('workshop')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {visits.length === 0 ? (
        <EmptyState
          icon={<History size={24} aria-hidden="true" />}
          title="لا توجد زيارات بعد"
          description="اول دخول للمعدة الى مشروع او الورشة يظهر هنا."
        />
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => {
            const year = item.sortAt.slice(0, 4)
            const heading =
              year !== lastYear ? (
                <li
                  key={`year-${year}-${item.key}`}
                  className="px-2 pb-1 pt-3 text-xs font-semibold text-muted first:pt-0 sm:px-3"
                >
                  {year}
                </li>
              ) : null
            lastYear = year
            return [
              heading,
              item.kind === 'visit' ? (
                <VisitRow
                  key={item.key}
                  visit={item.visit}
                  now={now}
                  expanded={expandedKey === item.visit.key}
                  onToggle={() => onToggle(item.visit.key)}
                />
              ) : (
                <GapRow key={item.key} gap={item.gap} />
              ),
            ]
          })}
        </ul>
      )}
    </div>
  )
}

function InquirySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="card space-y-4 p-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-[74px] w-full" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="card space-y-2 p-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

// --- The mockup ------------------------------------------------------------------

export function InquiryRedesignMockup() {
  // Taken once after mounting (the server render has no "now" of the
  // reviewer's, and a different one would not hydrate), then fixed so
  // durations do not drift while reviewing.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])
  if (now === null) return <InquirySkeleton />
  return <InquiryRedesignMockupAt now={now} />
}

function InquiryRedesignMockupAt({ now }: { now: number }) {
  const units = useMemo(() => sampleUnits(now), [now])
  const [state, setState] = useState<DemoState>('data')
  const [viewer, setViewer] = useState<Viewer>('admin')
  const [look, setLook] = useState<Look>('calm')
  const [unitId, setUnitId] = useState(units[0].id)
  const [recent, setRecent] = useState<string[]>(['u-f118', 'u-b044'])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const unit = units.find((item) => item.id === unitId) ?? units[0]
  const visits = useMemo(
    () => buildEquipmentVisits(unit.movements),
    [unit],
  )

  const pick = (id: string) => {
    setUnitId(id)
    setExpandedKey(null)
    setRecent((current) => [id, ...current.filter((item) => item !== id)].slice(0, 6))
    setState('data')
  }

  const selectVisit = (key: string) => {
    setExpandedKey(key)
    window.requestAnimationFrame(() =>
      document
        .getElementById(`visit-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">صفحة الاستعلام — التصميم الجديد</h3>
          <p className="text-xs text-muted">
            بيانات عينة. الموقع الحالي للمسؤول فقط كما هو اليوم
            (equipment.location.view).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={look} onValueChange={(next) => setLook(next as Look)}>
            <TabsList variant="segmented" aria-label="الشكل">
              <TabsTrigger value="calm">ا · هادئة</TabsTrigger>
              <TabsTrigger value="bold">ب · جريئة</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            size="sm"
            aria-label="المعدة المعروضة"
            className="w-[210px]"
            value={unit.id}
            onValueChange={pick}
            options={units.map((item) => ({
              value: item.id,
              label: `${item.code} · ${
                item.movements.length === 0
                  ? 'بدون حركات'
                  : presence(buildEquipmentVisits(item.movements)) === 'inside_site'
                    ? 'في مشروع'
                    : presence(buildEquipmentVisits(item.movements)) ===
                        'inside_workshop'
                      ? 'في الورشة'
                      : 'خارج'
              }`,
            }))}
          />
          <Tabs value={viewer} onValueChange={(next) => setViewer(next as Viewer)}>
            <TabsList variant="segmented" aria-label="المستخدم">
              <TabsTrigger value="admin">مسؤول</TabsTrigger>
              <TabsTrigger value="other">غيره</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={state} onValueChange={(next) => setState(next as DemoState)}>
            <TabsList variant="segmented" aria-label="حالة المعاينة">
              <TabsTrigger value="start">قبل البحث</TabsTrigger>
              <TabsTrigger value="data">بيانات</TabsTrigger>
              <TabsTrigger value="loading">تحميل</TabsTrigger>
              <TabsTrigger value="error">خطا</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="rounded-xl border bg-surface p-3 sm:p-4">
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">استعلام معدة</h2>

          {state === 'start' ? (
            <StartView units={units} recent={recent} onPick={pick} />
          ) : (
            <>
              <div className="max-w-xl">
                <SearchField
                  key={unit.id}
                  units={units}
                  onPick={pick}
                  initial={unit.code}
                />
              </div>
              {state === 'loading' ? (
                <InquirySkeleton />
              ) : state === 'error' ? (
                <ErrorState onRetry={() => setState('data')} />
              ) : (
                <>
                  <HeaderCard
                    unit={unit}
                    visits={visits}
                    now={now}
                    onSelectVisit={selectVisit}
                    onChange={() => setState('start')}
                    look={look}
                  />
                  {/* Below xl: facts, location, visits. From xl the visits
                      span two columns beside the facts and the location. */}
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
                    <div className="space-y-4 xl:col-start-3 xl:row-span-2">
                      {viewer === 'admin' && unit.movements.length > 0 && (
                        <LocationCard />
                      )}
                      <FactsCard unit={unit} now={now} />
                    </div>
                    <div className="xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
                      <VisitList
                        visits={visits}
                        now={now}
                        expandedKey={expandedKey}
                        onToggle={(key) =>
                          setExpandedKey((current) => (current === key ? null : key))
                        }
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Clock size={12} aria-hidden="true" />
        اضغط على اي جزء من شريط النشاط ليفتح زيارته في السجل.
      </p>
    </section>
  )
}
