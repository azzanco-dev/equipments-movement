import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  Ban,
  Building2,
  Calendar,
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
  Button,
  DescriptionList,
  ErrorState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type DescriptionListItem,
} from '@/components/ui'
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
// Sample data only, no database reads.
//
// Second round, same day: the gradients and the coloured borders are gone
// («مو طبيعي سوء القريديانت», «الحدود مش كويسة حتى الحدود الجانبية»). The
// page opens like the home of an AI assistant — one big field in the middle
// with a short line under the question — and the answer rises in with
// motion; the timeline gives every state its own colour and draws the time
// outside as a road («الحالة الرمادية ابغى شي ابداعي»).

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_DAYS = 365

type Viewer = 'admin' | 'other'
type Phase = 'hero' | 'loading' | 'result'

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

// --- Colour, motion and small pieces ------------------------------------------------

type Colors = { fill: string; stroke: string }

/** One colour per state (owner 2026-10-26: «كل لون يرمز لحالة معينة»). The
 *  fills are the light chart shades, read with `--chart-text`. */
const STATE_COLORS = {
  site: { fill: 'var(--chart-1)', stroke: 'var(--chart-stroke-1)' },
  maintenance: { fill: 'var(--chart-2)', stroke: 'var(--chart-stroke-2)' },
  parking: { fill: 'var(--chart-3)', stroke: 'var(--chart-stroke-3)' },
  out_of_service: { fill: 'var(--danger-soft)', stroke: 'var(--danger)' },
  outside: { fill: 'var(--chart-4)', stroke: 'var(--chart-stroke-4)' },
} satisfies Record<string, Colors>

const STATE_LEGEND: { key: keyof typeof STATE_COLORS; label: string }[] = [
  { key: 'site', label: 'مشروع' },
  { key: 'maintenance', label: 'صيانة' },
  { key: 'parking', label: 'وقوف' },
  { key: 'out_of_service', label: 'خارج الخدمة' },
  { key: 'outside', label: 'على الطريق' },
]

function visitColors(visit: EquipmentVisit): Colors {
  if (visit.context === 'site') return STATE_COLORS.site
  const purpose = visit.entry?.workshop_purpose
  if (purpose === 'parking') return STATE_COLORS.parking
  if (purpose === 'out_of_service') return STATE_COLORS.out_of_service
  return STATE_COLORS.maintenance
}

/** The colour of where the unit is now: its open visit's, else outside. */
function presenceColors(visits: EquipmentVisit[]): Colors {
  const open = visits.find((visit) => visit.open)
  return open ? visitColors(open) : STATE_COLORS.outside
}

/** Surfaces have no border (owner: «الحدود مش كويسة»): the page colour on
 *  the frame, with a soft shadow. */
const SURFACE = 'rounded-2xl bg-bg shadow-sm'

/** A translucent page-colour chip that reads on any state fill. */
const ON_FILL: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--bg) 60%, transparent)',
}

/** Mockup-only motion (owner: «لما تجي النتايج تجي بانيميشن»). */
const MOTION_CSS = `
@keyframes inq-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes inq-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes inq-drive { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes inq-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
.inq-rise { animation: inq-rise 560ms cubic-bezier(.2,.8,.2,1) both; }
.inq-grow { animation: inq-grow 900ms cubic-bezier(.2,.8,.2,1) both; transform-origin: right; }
.inq-drive { animation: inq-drive 1100ms cubic-bezier(.2,.8,.2,1) both; }
.inq-dot { animation: inq-dot 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .inq-rise, .inq-grow, .inq-drive, .inq-dot { animation: none; }
}
`

/** The stagger of the n-th block of the answer. */
function rise(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 14) * 70}ms` }
}

/** Counts a number up from zero when the answer arrives. */
function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}

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
      className="flex shrink-0 items-center justify-center rounded-full"
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

function visitIcon(visit: EquipmentVisit, size: number): ReactNode {
  const purpose = visit.entry?.workshop_purpose
  const Icon =
    visit.context === 'site'
      ? MapPin
      : purpose === 'parking'
        ? ParkingCircle
        : purpose === 'out_of_service'
          ? Ban
          : Wrench
  return <Icon size={size} />
}

function visitTitle(visit: EquipmentVisit): string {
  if (visit.context === 'workshop') return 'الورشة'
  const movement = visit.entry ?? visit.exit
  return movement?.project_name ?? 'مشروع'
}

function visitPurposeLabel(visit: EquipmentVisit): string | null {
  if (visit.context !== 'workshop') return null
  const purpose = visit.entry?.workshop_purpose
  if (purpose === 'parking') return 'وقوف'
  if (purpose === 'out_of_service') return 'خارج الخدمة'
  if (purpose === 'maintenance') return 'صيانة'
  return null
}

function visitRange(visit: EquipmentVisit): string {
  const from = visit.startedAt ? formatDate(visit.startedAt) : '—'
  const to = visit.open ? 'الان' : visit.endedAt ? formatDate(visit.endedAt) : '—'
  return `${from} ← ${to}`
}

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
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

/** The road: the grey of «خارج» drawn as asphalt with a dashed centre line
 *  (owner: «الحالة الرمادية ابغى شي ابداعي»). */
function RoadMarking({ inset = 12 }: { inset?: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed"
      style={{
        insetInlineStart: inset,
        insetInlineEnd: inset,
        borderColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
      }}
    />
  )
}

// --- The search (the start of the page) -----------------------------------------------

function matchUnits(units: DemoUnit[], query: string): DemoUnit[] {
  const term = query.trim().toLowerCase()
  if (!term) return []
  return units.filter((unit) =>
    [unit.code, unit.type, unit.plate, unit.chassis, ...unit.previousCodes]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(term)),
  )
}

/**
 * The one field of the page, AI-home style: big and rounded with a round
 * send button while nothing is chosen, smaller once the answer is shown.
 */
function InquirySearch({
  units,
  big,
  initial,
  onPick,
}: {
  units: DemoUnit[]
  big: boolean
  initial: string
  onPick: (unit: DemoUnit) => void
}) {
  const [query, setQuery] = useState(initial)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = matchUnits(units, query)
  const listOpen = open && matches.length > 0

  const choose = (unit: DemoUnit) => {
    setQuery(unit.code)
    setOpen(false)
    onPick(unit)
  }

  return (
    <div className="relative w-full">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl bg-bg pe-2 ps-4 shadow-md transition-[height] duration-500',
          big ? 'h-16' : 'h-12',
        )}
      >
        <Search
          size={big ? 22 : 18}
          aria-hidden="true"
          className="shrink-0 text-muted"
        />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, matches.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter' && matches[active]) {
              event.preventDefault()
              choose(matches[active])
            } else if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="الكود او اللوحة او الشاصي او النوع"
          dir={query ? 'auto' : undefined}
          role="combobox"
          aria-label="ابحث عن معدة"
          aria-expanded={listOpen}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder',
            big ? 'text-lg' : 'text-base',
          )}
        />
        <button
          type="button"
          onClick={() => matches[0] && choose(matches[0])}
          disabled={matches.length === 0}
          aria-label="اعرض المعدة"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-contrast transition-opacity disabled:opacity-25',
            big ? 'h-11 w-11' : 'h-9 w-9',
          )}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
      </div>
      {listOpen && (
        <ul
          role="listbox"
          className="inq-rise absolute inset-x-0 top-full z-30 mt-2 space-y-0.5 rounded-2xl bg-bg p-1.5 shadow-xl"
          style={{ animationDuration: '220ms' }}
        >
          {matches.map((unit, index) => (
            <li key={unit.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(unit)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start',
                  index === active && 'bg-surface-hover',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: presenceColors(
                      buildEquipmentVisits(unit.movements),
                    ).stroke,
                  }}
                />
                <bdi dir="ltr" className="font-semibold">
                  {unit.code}
                </bdi>
                <span className="min-w-0 flex-1 truncate-safe text-sm text-muted">
                  {unit.type}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {unit.plate ? (
                    <PlateText plate={unit.plate} />
                  ) : (
                    <bdi dir="ltr">{unit.chassis}</bdi>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** While the answer is fetched: the AI-style «looking» line and the shape
 *  of the answer. */
function Thinking({ code }: { code: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4" aria-busy="true">
      <p className="flex items-center justify-center gap-1.5 text-sm text-muted" role="status">
        نبحث عن <bdi dir="ltr" className="font-semibold text-fg">{code}</bdi>
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="inq-dot h-1.5 w-1.5 rounded-full bg-fg"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
      </p>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  )
}

// --- The answer: header, now, numbers, the year -----------------------------------------

function NowPanel({
  unit,
  visits,
  now,
}: {
  unit: DemoUnit
  visits: EquipmentVisit[]
  now: number
}) {
  const { t, lang } = useI18n()
  const where = presence(visits)
  const open = visits.find((visit) => visit.open) ?? null
  const last = visits[0] ?? null

  let tone: Colors = STATE_COLORS.outside
  let icon: ReactNode = <Truck size={20} />
  let title: ReactNode
  let place: ReactNode = null
  let since: string | null = null
  const people: { icon: ReactNode; label: string; value: string }[] = []
  let extra: ReactNode = null

  if (where === 'inside_site' && open) {
    tone = visitColors(open)
    icon = visitIcon(open, 20)
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
    extra = (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={ON_FILL}
      >
        <FileText size={13} aria-hidden="true" />
        {unit.po ? <bdi dir="ltr">{unit.po}</bdi> : 'بدون PO'}
      </span>
    )
  } else if (where === 'inside_workshop' && open) {
    tone = visitColors(open)
    icon = visitIcon(open, 20)
    title = (
      <>
        في <span className="font-bold">الورشة</span>
        {visitPurposeLabel(open) && <> · {visitPurposeLabel(open)}</>}
      </>
    )
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={14} />,
        label: 'مسجل الدخول',
        value: open.entry.supervisor_name,
      })
  } else if (last) {
    title = <span className="font-bold">على الطريق</span>
    since = last.endedAt
    place = `خرجت من ${visitTitle(last)}، وما دخلت مشروع ولا الورشة بعدها.`
  } else {
    title = <span className="font-bold">لا توجد حركات بعد</span>
    place = 'لم تدخل اي مشروع ولا الورشة منذ اضافتها.'
  }

  const sinceMs = since ? Date.parse(since) : null
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
      style={{ backgroundColor: tone.fill, color: 'var(--chart-text)' }}
    >
      {tone === STATE_COLORS.outside && <RoadMarking inset={0} />}
      <div className="relative flex flex-wrap items-start gap-3">
        <IconTile colors={tone} size={48}>
          {icon}
        </IconTile>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold opacity-80">الحين</p>
          <p className="text-xl leading-snug">{title}</p>
          {place && <p className="text-sm opacity-80">{place}</p>}
          {sinceMs !== null && (
            <p className="text-sm">
              منذ{' '}
              <span className="font-bold">
                {formatElapsedDuration(now - sinceMs, t, lang)}
              </span>
              <span className="opacity-70"> · {formatDate(since!)}</span>
            </p>
          )}
        </div>
        {extra && (
          <div className="basis-full ps-[60px] sm:basis-auto sm:ps-0">{extra}</div>
        )}
      </div>
      {people.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-2">
          {people.map((person) => (
            <span
              key={person.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
              style={ON_FILL}
            >
              <span aria-hidden="true" className="opacity-70">
                {person.icon}
              </span>
              <span className="opacity-70">{person.label}</span>
              <span className="truncate-safe font-semibold">{person.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Header({
  unit,
  visits,
  now,
  onAnother,
}: {
  unit: DemoUnit
  visits: EquipmentVisit[]
  now: number
  onAnother: () => void
}) {
  return (
    <section className={cn(SURFACE, 'inq-rise space-y-4 p-4 sm:p-5')} style={rise(0)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-3xl font-bold leading-none">
              <bdi dir="ltr">{unit.code}</bdi>
            </h2>
            <EquipmentStateBadge state={unitState(unit)} />
            <EquipmentNewBadge isNew={unit.createdDaysAgo <= 7} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className="font-medium text-fg">{unit.type}</span>
            <span aria-hidden="true">·</span>
            {unit.plate ? (
              <PlateText plate={unit.plate} />
            ) : (
              <bdi dir="ltr">{unit.chassis}</bdi>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<ExternalLink size={14} aria-hidden="true" />}
          >
            صفحة المعدة
          </Button>
          <Button size="sm" variant="ghost" onClick={onAnother}>
            معدة اخرى
          </Button>
        </div>
      </div>
      <NowPanel unit={unit} visits={visits} now={now} />
    </section>
  )
}

function StatTile({
  colors,
  icon,
  label,
  value,
  hint,
  share,
  index,
}: {
  colors: Colors | null
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
      className={cn('inq-rise rounded-2xl p-4', !colors && SURFACE)}
      style={{
        ...rise(index),
        ...(colors
          ? { backgroundColor: colors.fill, color: 'var(--chart-text)' }
          : null),
      }}
    >
      <div className="flex items-center gap-2">
        <IconTile colors={colors ?? { stroke: 'var(--primary)' }} size={30}>
          {icon}
        </IconTile>
        <span className="truncate-safe text-xs font-medium opacity-80">
          {label}
        </span>
      </div>
      <p className="mt-3 text-4xl font-bold leading-none tabular-nums">{shown}</p>
      {share !== undefined && colors && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={ON_FILL}>
          <div
            className="inq-grow h-full rounded-full"
            style={{
              width: `${Math.round(share * 100)}%`,
              backgroundColor: colors.stroke,
              animationDelay: rise(index).animationDelay,
            }}
          />
        </div>
      )}
      {hint && <p className="mt-2 text-xs opacity-80">{hint}</p>}
    </div>
  )
}

function YearNumbers({
  visits,
  createdAt,
  now,
}: {
  visits: EquipmentVisit[]
  createdAt: number
  now: number
}) {
  const year = summarizeYear(visits, createdAt, now)
  const counted = year.siteDays + year.workshopDays + year.outsideDays
  const share = (days: number) => (counted > 0 ? days / counted : 0)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        index={1}
        colors={STATE_COLORS.site}
        icon={<MapPin size={15} />}
        label="ايام في المشاريع"
        value={year.siteDays}
        hint={`${year.siteShare}% من السنة`}
        share={share(year.siteDays)}
      />
      <StatTile
        index={2}
        colors={STATE_COLORS.maintenance}
        icon={<Wrench size={15} />}
        label="ايام في الورشة"
        value={year.workshopDays}
        share={share(year.workshopDays)}
      />
      <StatTile
        index={3}
        colors={STATE_COLORS.outside}
        icon={<Truck size={15} />}
        label="ايام على الطريق"
        value={year.outsideDays}
        share={share(year.outsideDays)}
      />
      {/* A count, not a place: monochrome. */}
      <StatTile
        index={4}
        colors={null}
        icon={<History size={15} />}
        label="الزيارات"
        value={year.visitCount}
        hint="خلال 12 شهر"
      />
    </div>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-1.5 text-xs">
      {STATE_LEGEND.map((item) => {
        const colors = STATE_COLORS[item.key]
        return (
          <li
            key={item.key}
            className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-2.5 py-1"
            style={{ backgroundColor: colors.fill, color: 'var(--chart-text)' }}
          >
            <span
              aria-hidden="true"
              className="relative h-2 w-2 rounded-full"
              style={{ backgroundColor: colors.stroke }}
            />
            <span className="relative">{item.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The last 12 months as a road (owner 2026-10-26, «مع شريط النشاط»): the
 * oldest day at the start edge, today at the end edge; every stay is a pill
 * in its state's colour, and the time outside is the bare road between them.
 * A pill opens its visit in the timeline below.
 */
function YearRoad({
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
  const { lang } = useI18n()
  const windowStart = now - YEAR_DAYS * DAY_MS
  const span = now - windowStart
  const pct = (ms: number) => ((ms - windowStart) / span) * 100

  const segments = visits
    .filter((visit) => visit.startedAt)
    .map((visit) => ({
      visit,
      from: Math.max(Date.parse(visit.startedAt!), windowStart),
      to: Math.min(visit.endedAt ? Date.parse(visit.endedAt) : now, now),
    }))
    .filter((segment) => segment.to > segment.from)
  const blankUntil = createdAt > windowStart ? pct(createdAt) : 0

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

  return (
    <section className={cn(SURFACE, 'inq-rise space-y-3 p-4 sm:p-5')} style={rise(5)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Calendar size={14} />}>اخر 12 شهر</CardTitle>
        <Legend />
      </div>
      <div
        className="relative h-12 rounded-full p-1.5"
        style={{ backgroundColor: STATE_COLORS.outside.fill }}
      >
        <RoadMarking inset={14} />
        <div className="relative h-full">
          {blankUntil > 0 && (
            <div
              className="absolute inset-y-0 start-0 rounded-full bg-surface"
              style={{ width: `${blankUntil}%` }}
              title="قبل اضافة المعدة"
            />
          )}
          {segments.map(({ visit, from, to }, index) => {
            const colors = visitColors(visit)
            const label = `${visitTitle(visit)} · ${visitRange(visit)} · ${msToDays(to - from)} يوم`
            return (
              <button
                key={visit.key}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onSelectVisit(visit.key)}
                className="inq-grow absolute inset-y-0 min-w-[6px] rounded-full transition-transform hover:scale-y-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{
                  insetInlineStart: `${pct(from)}%`,
                  width: `max(6px, calc(${pct(to) - pct(from)}% - 3px))`,
                  backgroundColor: colors.stroke,
                  animationDelay: `${400 + index * 90}ms`,
                }}
              />
            )
          })}
        </div>
      </div>
      <div className="relative h-4 text-[11px] text-muted" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span
            key={tick.key}
            className={cn(
              'absolute top-0 translate-x-1/2 whitespace-nowrap',
              index % 2 === 1 && 'hidden sm:inline',
            )}
            style={{ insetInlineStart: `${tick.at}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </section>
  )
}

// --- The answer: facts, location, timeline -----------------------------------------------

function FactsCard({ unit, now, index }: { unit: DemoUnit; now: number; index: number }) {
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
    <section className={cn(SURFACE, 'inq-rise p-4 sm:p-5')} style={rise(index)}>
      <CardTitle icon={<Tag size={14} />}>بيانات المعدة</CardTitle>
      {/* Two columns while the card spans the page, one beside the timeline. */}
      <DescriptionList items={items} columns={2} className="mt-1 xl:grid-cols-1" />
    </section>
  )
}

/** Admin only, as today (`equipment.location.view`). Folded on a phone. */
function LocationCard({ index }: { index: number }) {
  const [shown, setShown] = useState(false)
  return (
    <section className={cn(SURFACE, 'inq-rise space-y-3 p-4 sm:p-5')} style={rise(index)}>
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
          onClick={() => setShown((value) => !value)}
          aria-expanded={shown}
        >
          {shown ? 'اخفاء' : 'الخريطة'}
        </Button>
      </div>
      <div
        className={cn(
          'h-44 items-center justify-center rounded-xl bg-surface text-sm text-muted xl:flex',
          shown ? 'flex' : 'hidden',
        )}
      >
        <MapPin size={16} aria-hidden="true" className="me-2" />
        خريطة مصغرة
      </div>
      <Button size="sm" variant="ghost" icon={<ExternalLink size={14} aria-hidden="true" />}>
        فتح في خرائط قوقل
      </Button>
    </section>
  )
}

/** One stay as a tile in its state's colour (owner: «تلون المربعات بحيث
 *  كل لون يرمز لحالة معينة»). */
function VisitTile({
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
  const colors = visitColors(visit)
  const duration = visitDurationMs(visit, now)
  const entry = visit.entry
  const exit = visit.exit
  const company = visit.context === 'site' ? (entry ?? exit)?.company_name : null
  const driver = exit?.driver_name || entry?.driver_name || null
  const purpose = visitPurposeLabel(visit)
  const details: { key: string; icon: ReactNode; label: string; value: ReactNode }[] = []
  if (entry)
    details.push({
      key: 'entry',
      icon: <LogIn size={14} />,
      label: 'الدخول',
      value: (
        <button type="button" className="underline underline-offset-4">
          {formatDateTime(entry.recorded_at)}
        </button>
      ),
    })
  if (exit)
    details.push({
      key: 'exit',
      icon: <LogOut size={14} />,
      label: 'الخروج',
      value: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <button type="button" className="underline underline-offset-4">
            {formatDateTime(exit.recorded_at)}
          </button>
          {visit.context === 'site' && <ExitPurposeBadge purpose={exit.exit_purpose} />}
        </span>
      ),
    })
  if (entry?.supervisor_name)
    details.push({
      key: 'foreman',
      icon: <UserCheck size={14} />,
      label: visit.context === 'site' ? 'الفورمان' : 'مسجل الدخول',
      value: entry.supervisor_name,
    })
  if (visit.context === 'site' && driver)
    details.push({ key: 'driver', icon: <User size={14} />, label: 'السائق', value: driver })

  return (
    <div
      id={`visit-${visit.key}`}
      className="min-w-0 flex-1 scroll-mt-24 rounded-2xl transition-shadow"
      style={{
        backgroundColor: colors.fill,
        color: 'var(--chart-text)',
        boxShadow: expanded ? `0 0 0 2px ${colors.stroke}` : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-3.5 text-start sm:p-4"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-bold">{visitTitle(visit)}</span>
            {purpose && (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={ON_FILL}>
                {purpose}
              </span>
            )}
            {visit.open && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-bold"
                style={{ backgroundColor: colors.stroke, color: 'var(--bg)' }}
              >
                الحين
              </span>
            )}
          </span>
          {company && (
            <span className="mt-0.5 block truncate-safe text-sm opacity-80">{company}</span>
          )}
          <span className="mt-1 block text-xs opacity-75">
            <bdi dir="ltr">{visit.startedAt ? formatDate(visit.startedAt) : '—'}</bdi>
            {' ← '}
            {visit.open ? (
              'الان'
            ) : (
              <bdi dir="ltr">{visit.endedAt ? formatDate(visit.endedAt) : '—'}</bdi>
            )}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-lg font-bold leading-tight">
            {duration !== null ? formatElapsedDuration(duration, t, lang) : '—'}
          </span>
        </span>
      </button>
      {expanded && details.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3.5 sm:px-4 sm:pb-4">
          {details.map((detail) => (
            <span
              key={detail.key}
              className="inline-flex max-w-full items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm"
              style={ON_FILL}
            >
              <span aria-hidden="true" className="opacity-70">
                {detail.icon}
              </span>
              <span className="opacity-70">{detail.label}</span>
              <span className="min-w-0 font-semibold">{detail.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The time outside as a stretch of road with a truck driving in. */
function RoadTile({ gap }: { gap: OutsideGap }) {
  return (
    <div
      className="relative flex h-11 min-w-0 flex-1 items-center overflow-hidden rounded-full px-3"
      style={{ backgroundColor: STATE_COLORS.outside.fill, color: 'var(--chart-text)' }}
    >
      <RoadMarking inset={12} />
      <span
        className="inq-drive relative flex h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: STATE_COLORS.outside.stroke, color: 'var(--bg)' }}
        aria-hidden="true"
      >
        <Truck size={14} />
      </span>
      <span
        className="relative ms-auto rounded-full px-3 py-1 text-xs font-semibold"
        style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
      >
        {gap.open ? 'على الطريق منذ' : 'على الطريق'} {gap.days} يوم
      </span>
    </div>
  )
}

type VisitFilter = 'all' | 'site' | 'workshop'

function Timeline({
  visits,
  now,
  expandedKey,
  onToggle,
  index,
}: {
  visits: EquipmentVisit[]
  now: number
  expandedKey: string | null
  onToggle: (key: string) => void
  index: number
}) {
  const [filter, setFilter] = useState<VisitFilter>('all')
  const items = buildTimelineItems(visits, now).filter((item) =>
    filter === 'all' ? true : item.kind === 'visit' && item.visit.context === filter,
  )
  const count = (context: VisitFilter) =>
    context === 'all'
      ? visits.length
      : visits.filter((visit) => visit.context === context).length

  return (
    <section className={cn(SURFACE, 'inq-rise p-4 sm:p-5')} style={rise(index)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<History size={14} />}>الرحلة</CardTitle>
        <Tabs value={filter} onValueChange={(next) => setFilter(next as VisitFilter)}>
          <TabsList variant="segmented" aria-label="نوع الزيارات">
            <TabsTrigger value="all">الكل {count('all')}</TabsTrigger>
            <TabsTrigger value="site">المشاريع {count('site')}</TabsTrigger>
            <TabsTrigger value="workshop">الورشة {count('workshop')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {visits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-4 py-10 text-center">
          <IconTile colors={STATE_COLORS.outside} size={44}>
            <Truck size={20} />
          </IconTile>
          <p className="font-semibold">الرحلة لم تبدا بعد</p>
          <p className="text-sm text-muted">اول دخول للمعدة الى مشروع او الورشة يظهر هنا.</p>
        </div>
      ) : (
        <ol className="relative">
          {/* The rail behind the stops. */}
          <span
            aria-hidden="true"
            className="absolute bottom-6 top-6 w-0.5 rounded-full bg-surface-hover"
            style={{ insetInlineStart: 19 }}
          />
          {items.map((item, position) => (
            <li
              key={item.key}
              className="inq-rise relative flex items-start gap-3 pb-3 last:pb-0"
              style={rise(index + 1 + position)}
            >
              {item.kind === 'visit' ? (
                <>
                  <span className="relative mt-3">
                    <IconTile colors={visitColors(item.visit)} size={40}>
                      {visitIcon(item.visit, 18)}
                    </IconTile>
                  </span>
                  <VisitTile
                    visit={item.visit}
                    now={now}
                    expanded={expandedKey === item.visit.key}
                    onToggle={() => onToggle(item.visit.key)}
                  />
                </>
              ) : (
                <>
                  <span className="relative flex h-11 w-10 shrink-0 items-center justify-center">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: STATE_COLORS.outside.stroke }}
                    />
                  </span>
                  <RoadTile gap={item.gap} />
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// --- The mockup ---------------------------------------------------------------------------

export function InquiryRedesignMockup() {
  // Taken once after mounting (the server render has no "now" of the
  // reviewer's, and a different one would not hydrate), then fixed so
  // durations do not drift while reviewing.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])
  if (now === null) return <Skeleton className="h-[560px] w-full rounded-2xl" />
  return <InquiryRedesignMockupAt now={now} />
}

function InquiryRedesignMockupAt({ now }: { now: number }) {
  const units = useMemo(() => sampleUnits(now), [now])
  const [phase, setPhase] = useState<Phase>('hero')
  const [failed, setFailed] = useState(false)
  const [viewer, setViewer] = useState<Viewer>('admin')
  const [unitId, setUnitId] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const [recent, setRecent] = useState<string[]>(['u-f118', 'u-b044', 'u-a291'])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const unit = units.find((item) => item.id === unitId) ?? null
  const visits = useMemo(
    () => (unit ? buildEquipmentVisits(unit.movements) : []),
    [unit],
  )

  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setTimeout(() => setPhase('result'), 900)
    return () => window.clearTimeout(timer)
  }, [phase, run])

  const pick = (picked: DemoUnit) => {
    setUnitId(picked.id)
    setExpandedKey(null)
    setRecent((current) =>
      [picked.id, ...current.filter((id) => id !== picked.id)].slice(0, 5),
    )
    setRun((value) => value + 1)
    setPhase('loading')
  }

  const selectVisit = (key: string) => {
    setExpandedKey(key)
    window.requestAnimationFrame(() =>
      document
        .getElementById(`visit-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }

  const hero = phase === 'hero'
  const createdAt = unit ? now - unit.createdDaysAgo * DAY_MS : now
  const recentUnits = recent
    .map((id) => units.find((item) => item.id === id))
    .filter((item): item is DemoUnit => Boolean(item))

  return (
    <section className="space-y-3">
      <style>{MOTION_CSS}</style>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">صفحة الاستعلام — التصميم الجديد</h3>
          <p className="text-xs text-muted">
            بيانات عينة: A291 في مشروع، F118 في الورشة، B044 على الطريق، U214
            جديدة. الموقع الحالي للمسؤول فقط.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={viewer} onValueChange={(next) => setViewer(next as Viewer)}>
            <TabsList variant="segmented" aria-label="المستخدم">
              <TabsTrigger value="admin">مسؤول</TabsTrigger>
              <TabsTrigger value="other">غيره</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs
            value={failed ? 'error' : 'ok'}
            onValueChange={(next) => setFailed(next === 'error')}
          >
            <TabsList variant="segmented" aria-label="حالة المعاينة">
              <TabsTrigger value="ok">عادي</TabsTrigger>
              <TabsTrigger value="error">خطا</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={() => setPhase('hero')}>
            من البداية
          </Button>
        </div>
      </div>

      <div className="relative min-h-[620px] rounded-2xl bg-surface px-3 py-6 sm:px-6">
        {/* The space above the field shrinks away when the answer comes. */}
        <div
          aria-hidden="true"
          style={{
            height: hero ? 'clamp(48px, 16vh, 150px)' : 0,
            transition: 'height 600ms cubic-bezier(.2,.8,.2,1)',
          }}
        />
        <div
          className="grid transition-[grid-template-rows,opacity] duration-500"
          style={{ gridTemplateRows: hero ? '1fr' : '0fr', opacity: hero ? 1 : 0 }}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 pb-7 text-center">
              <h2
                className="text-3xl font-bold sm:text-4xl"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                وين المعدة؟
              </h2>
              <p className="text-muted">
                اكتب الكود او اللوحة، ونوريك وين هي الحين ووين قضت سنتها.
              </p>
            </div>
          </div>
        </div>

        <div
          className="mx-auto transition-[max-width] duration-500"
          style={{ maxWidth: hero ? 672 : 560 }}
        >
          <InquirySearch
            key={`${unitId ?? 'none'}-${hero}`}
            units={units}
            big={hero}
            initial={hero ? '' : (unit?.code ?? '')}
            onPick={pick}
          />
        </div>

        {hero && recentUnits.length > 0 && (
          <div className="inq-rise mx-auto mt-5 max-w-2xl space-y-2 text-center" style={rise(2)}>
            <p className="text-xs text-muted">اخر استعلاماتك</p>
            <div className="flex flex-wrap justify-center gap-2">
              {recentUnits.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pick(item)}
                  className="inline-flex items-center gap-2 rounded-full bg-bg px-3.5 py-2 text-sm shadow-sm transition-transform hover:-translate-y-0.5"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: presenceColors(
                        buildEquipmentVisits(item.movements),
                      ).stroke,
                    }}
                  />
                  <bdi dir="ltr" className="font-semibold">
                    {item.code}
                  </bdi>
                  <span className="text-xs text-muted">{item.type}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'loading' && unit && (
          <div className="mt-6">
            <Thinking code={unit.code} />
          </div>
        )}

        {phase === 'result' && unit && (
          <div key={run} className="mx-auto mt-6 max-w-6xl space-y-4">
            {failed ? (
              <div className={cn(SURFACE, 'inq-rise p-4')}>
                <ErrorState onRetry={() => setFailed(false)} />
              </div>
            ) : (
              <>
                <Header
                  unit={unit}
                  visits={visits}
                  now={now}
                  onAnother={() => setPhase('hero')}
                />
                {visits.length > 0 && (
                  <>
                    <YearNumbers visits={visits} createdAt={createdAt} now={now} />
                    <YearRoad
                      visits={visits}
                      createdAt={createdAt}
                      now={now}
                      onSelectVisit={selectVisit}
                    />
                  </>
                )}
                {/* Below xl: facts, location, timeline. From xl the
                    timeline spans two columns beside them. */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <div className="space-y-4 xl:col-start-3 xl:row-start-1">
                    {viewer === 'admin' && unit.movements.length > 0 && (
                      <LocationCard index={6} />
                    )}
                    <FactsCard unit={unit} now={now} index={7} />
                  </div>
                  <div className="xl:col-span-2 xl:col-start-1 xl:row-start-1">
                    <Timeline
                      visits={visits}
                      now={now}
                      index={8}
                      expandedKey={expandedKey}
                      onToggle={(key) =>
                        setExpandedKey((current) => (current === key ? null : key))
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        اضغط على اي جزء من شريط السنة ليفتح زيارته في الرحلة.
      </p>
    </section>
  )
}
