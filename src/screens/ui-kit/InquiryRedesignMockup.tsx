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
  CircleDashed,
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
import { formatDate } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import { splitPlateForDisplay } from '@/lib/plate'
import {
  equipmentStateFromMovement,
  type EquipmentState,
} from '@/lib/equipmentState'
import {
  buildEquipmentVisits,
  buildTimelineItems,
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

// --- Colour, motion and small pieces ------------------------------------------------

/** `fill` is the light tile, `tint` the icon circle, `stroke` the icon. */
type Colors = { fill: string; tint: string; stroke: string }

/** A chart shade lightened toward the page (owner 2026-10-26: «فتّح
 *  الالوان»). */
function light(token: string): string {
  return `color-mix(in srgb, ${token} 55%, var(--bg))`
}

/** One colour per state (owner 2026-10-26: «كل لون يرمز لحالة معينة»).
 *  The grey is a general state, not "on the road": the unit may be at a
 *  site that never recorded it («مو شرط انها على الطريق … خليها حالة
 *  عامة»). */
const STATE_COLORS = {
  site: {
    fill: light('var(--chart-1)'),
    tint: 'var(--chart-1)',
    stroke: 'var(--chart-stroke-1)',
  },
  maintenance: {
    fill: light('var(--chart-2)'),
    tint: 'var(--chart-2)',
    stroke: 'var(--chart-stroke-2)',
  },
  parking: {
    fill: light('var(--chart-3)'),
    tint: 'var(--chart-3)',
    stroke: 'var(--chart-stroke-3)',
  },
  out_of_service: {
    fill: 'var(--danger-soft)',
    tint: light('var(--danger)'),
    stroke: 'var(--danger)',
  },
  unrecorded: {
    fill: light('var(--chart-4)'),
    tint: 'var(--chart-4)',
    stroke: 'var(--chart-stroke-4)',
  },
} satisfies Record<string, Colors>

type StateKey = keyof typeof STATE_COLORS

const STATE_LABEL: Record<StateKey, string> = {
  site: 'مشروع',
  maintenance: 'صيانة',
  parking: 'وقوف',
  out_of_service: 'خارج الخدمة',
  unrecorded: 'بدون تسجيل',
}

function visitStateKey(visit: EquipmentVisit): StateKey {
  if (visit.context === 'site') return 'site'
  const purpose = visit.entry?.workshop_purpose
  if (purpose === 'parking') return 'parking'
  if (purpose === 'out_of_service') return 'out_of_service'
  return 'maintenance'
}

function visitColors(visit: EquipmentVisit): Colors {
  return STATE_COLORS[visitStateKey(visit)]
}

/** The colour of where the unit is now: its open visit's, else unrecorded. */
function presenceColors(visits: EquipmentVisit[]): Colors {
  const open = visits.find((visit) => visit.open)
  return open ? visitColors(open) : STATE_COLORS.unrecorded
}

/** Surfaces have no border (owner: «الحدود مش كويسة»): the page colour on
 *  the frame, with a soft shadow. */
const SURFACE = 'rounded-2xl bg-bg shadow-sm'

/** A translucent page-colour chip that reads on any state fill. */
const ON_FILL: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--bg) 65%, transparent)',
}

/** Mockup-only motion (owner: «لما تجي النتايج تجي بانيميشن»). */
const MOTION_CSS = `
@keyframes inq-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes inq-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes inq-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes inq-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
.inq-rise { animation: inq-rise 560ms cubic-bezier(.2,.8,.2,1) both; }
.inq-grow { animation: inq-grow 900ms cubic-bezier(.2,.8,.2,1) both; transform-origin: right; }
.inq-pop { animation: inq-pop 420ms cubic-bezier(.2,.8,.2,1) both; }
.inq-dot { animation: inq-dot 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .inq-rise, .inq-grow, .inq-pop, .inq-dot { animation: none; }
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

/** A round tile in a state's tint with the icon in its strong colour. */
function IconTile({
  colors,
  size = 32,
  children,
}: {
  colors: Pick<Colors, 'tint' | 'stroke'>
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
        backgroundColor: colors.tint,
        color: colors.stroke,
      }}
    >
      {children}
    </span>
  )
}

function stateIcon(key: StateKey, size: number): ReactNode {
  const Icon =
    key === 'site'
      ? MapPin
      : key === 'parking'
        ? ParkingCircle
        : key === 'out_of_service'
          ? Ban
          : key === 'maintenance'
            ? Wrench
            : CircleDashed
  return <Icon size={size} />
}

function visitTitle(visit: EquipmentVisit): string {
  if (visit.context === 'workshop') return 'الورشة'
  const movement = visit.entry ?? visit.exit
  return movement?.project_name ?? 'مشروع'
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
          big ? 'h-14' : 'h-11',
        )}
      >
        <Search size={big ? 20 : 17} aria-hidden="true" className="shrink-0 text-muted" />
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
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-placeholder"
        />
        <button
          type="button"
          onClick={() => matches[0] && choose(matches[0])}
          disabled={matches.length === 0}
          aria-label="اعرض المعدة"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-contrast transition-opacity disabled:opacity-25',
            big ? 'h-10 w-10' : 'h-8 w-8',
          )}
        >
          <ArrowLeft size={17} aria-hidden="true" />
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
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm',
                  index === active && 'bg-surface-hover',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: presenceColors(buildEquipmentVisits(unit.movements))
                      .stroke,
                  }}
                />
                <bdi dir="ltr" className="font-semibold">
                  {unit.code}
                </bdi>
                <span className="min-w-0 flex-1 truncate-safe text-muted">{unit.type}</span>
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
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}

// --- The answer: header, now, numbers ---------------------------------------------------

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

  let key: StateKey = 'unrecorded'
  let title: ReactNode
  let place: ReactNode = null
  let since: string | null = null
  const people: { icon: ReactNode; label: string; value: string }[] = []
  let extra: ReactNode = null

  if (where === 'inside_site' && open) {
    key = 'site'
    title = (
      <>
        داخل <span className="font-bold">{open.entry?.project_name}</span>
      </>
    )
    place = open.entry?.company_name
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={13} />,
        label: 'الفورمان',
        value: open.entry.supervisor_name,
      })
    if (open.entry?.driver_name)
      people.push({
        icon: <User size={13} />,
        label: 'السائق',
        value: open.entry.driver_name,
      })
    extra = (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={ON_FILL}
      >
        <FileText size={12} aria-hidden="true" />
        {unit.po ? <bdi dir="ltr">{unit.po}</bdi> : 'بدون PO'}
      </span>
    )
  } else if (where === 'inside_workshop' && open) {
    key = visitStateKey(open)
    title = (
      <>
        في <span className="font-bold">الورشة</span> · {STATE_LABEL[key]}
      </>
    )
    since = open.startedAt
    if (open.entry?.supervisor_name)
      people.push({
        icon: <UserCheck size={13} />,
        label: 'مسجل الدخول',
        value: open.entry.supervisor_name,
      })
  } else if (last) {
    title = <span className="font-bold">بدون تسجيل</span>
    since = last.endedAt
    place = `اخر حركة مسجلة: خروج من ${visitTitle(last)}.`
  } else {
    title = <span className="font-bold">لا توجد حركات بعد</span>
    place = 'لم تسجل لها اي حركة منذ اضافتها.'
  }

  const tone = STATE_COLORS[key]
  const sinceMs = since ? Date.parse(since) : null
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: tone.fill }}>
      <div className="flex flex-wrap items-start gap-3">
        <IconTile colors={tone} size={42}>
          {stateIcon(key, 19)}
        </IconTile>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-semibold text-muted">الحين</p>
          <p className="text-lg leading-snug">{title}</p>
          {place && <p className="text-sm text-muted">{place}</p>}
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
        {extra && <div className="basis-full ps-[54px] sm:basis-auto sm:ps-0">{extra}</div>}
      </div>
      {people.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {people.map((person) => (
            <span
              key={person.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              style={ON_FILL}
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
    <section className={cn(SURFACE, 'inq-rise space-y-4 p-4')} style={rise(0)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold leading-none">
              <bdi dir="ltr">{unit.code}</bdi>
            </h2>
            <EquipmentStateBadge state={unitState(unit)} />
            <EquipmentNewBadge isNew={unit.createdDaysAgo <= 7} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
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
      className={cn('inq-rise rounded-2xl p-3.5', !colors && SURFACE)}
      style={{ ...rise(index), ...(colors ? { backgroundColor: colors.fill } : null) }}
    >
      <div className="flex items-center gap-2">
        <IconTile
          colors={colors ?? { tint: 'var(--surface-hover)', stroke: 'var(--fg)' }}
          size={26}
        >
          {icon}
        </IconTile>
        <span className="truncate-safe text-xs text-muted">{label}</span>
      </div>
      <p className="mt-2.5 text-2xl font-bold leading-none tabular-nums">{shown}</p>
      {share !== undefined && colors && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full" style={ON_FILL}>
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
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
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
  // The same calendar days as the day calendar, so the numbers always
  // match its counts.
  const days = yearDays(visits, createdAt, now).filter((cell) => cell.state !== 'before')
  const daysOf = (...keys: StateKey[]) =>
    days.filter((cell) => keys.includes(cell.state as StateKey)).length
  const counted = days.length
  const share = (count: number) => (counted > 0 ? count / counted : 0)
  const year = {
    siteDays: daysOf('site'),
    workshopDays: daysOf('maintenance', 'parking', 'out_of_service'),
    outsideDays: daysOf('unrecorded'),
    visitCount: new Set(days.map((cell) => cell.visit?.key).filter(Boolean)).size,
    siteShare: Math.round(share(daysOf('site')) * 100),
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        index={1}
        colors={STATE_COLORS.site}
        icon={<MapPin size={13} />}
        label="ايام في المشاريع"
        value={year.siteDays}
        hint={`${year.siteShare}% من السنة`}
        share={share(year.siteDays)}
      />
      <StatTile
        index={2}
        colors={STATE_COLORS.maintenance}
        icon={<Wrench size={13} />}
        label="ايام في الورشة"
        value={year.workshopDays}
        share={share(year.workshopDays)}
      />
      <StatTile
        index={3}
        colors={STATE_COLORS.unrecorded}
        icon={<CircleDashed size={13} />}
        label="ايام بدون تسجيل"
        value={year.outsideDays}
        share={share(year.outsideDays)}
      />
      {/* A count, not a place: neutral. */}
      <StatTile
        index={4}
        colors={null}
        icon={<History size={13} />}
        label="الزيارات"
        value={year.visitCount}
        hint="خلال 12 شهر"
      />
    </div>
  )
}

// --- The year as days ------------------------------------------------------------------

const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000

/** Days since the epoch of an instant's Saudi calendar day. */
function saudiDay(ms: number): number {
  return Math.floor((ms + SAUDI_OFFSET_MS) / DAY_MS)
}

type DayCell = { day: number; state: StateKey | 'before'; visit: EquipmentVisit | null }

/** A day square's colour: a stay's strong colour, the light grey of
 *  «بدون تسجيل» (owner: «خلي الرمادي في اخر 12 شهر افتح»), or the frame
 *  colour before the unit was added. */
function dayColor(state: DayCell['state']): string {
  if (state === 'before') return 'var(--surface)'
  if (state === 'unrecorded') return STATE_COLORS.unrecorded.fill
  return STATE_COLORS[state].stroke
}

/** Every Saudi day of the last 12 months with the state it was in: the
 *  latest stay covering it, else «بدون تسجيل», or nothing before the unit
 *  was added. */
function yearDays(visits: EquipmentVisit[], createdAt: number, now: number): DayCell[] {
  const today = saudiDay(now)
  const first = today - (YEAR_DAYS - 1)
  const created = saudiDay(createdAt)
  const cells: DayCell[] = []
  for (let day = first; day <= today; day += 1)
    cells.push({ day, state: day < created ? 'before' : 'unrecorded', visit: null })
  // Oldest first, so a later stay on the same day wins.
  for (const visit of [...visits].reverse()) {
    if (!visit.startedAt) continue
    const from = Math.max(saudiDay(Date.parse(visit.startedAt)), first)
    const to = Math.min(visit.endedAt ? saudiDay(Date.parse(visit.endedAt)) : today, today)
    for (let day = from; day <= to; day += 1) {
      const cell = cells[day - first]
      cell.state = visitStateKey(visit)
      cell.visit = visit
    }
  }
  return cells
}

/**
 * The last 12 months as a calendar of days (owner 2026-10-26: «اخر 12 شهر
 * فكرته حلوة لكن تنفيذه مو افضل شي»): one small square per day, a column
 * per week (Sunday on top), the oldest week at the start edge, coloured by
 * the state of that day; the legend counts the days of each state. A day of
 * a stay opens that stay in the timeline below.
 */
function YearCalendar({
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
  const cells = yearDays(visits, createdAt, now)
  // Sunday-first weeks: blank cells before the first day of the window.
  const lead = new Date(cells[0].day * DAY_MS).getUTCDay()
  const columns = Math.ceil((lead + cells.length) / 7)
  const monthFormat = new Intl.DateTimeFormat(
    lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB',
    { month: 'short' },
  )
  const months = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => index === 0 || new Date(cell.day * DAY_MS).getUTCDate() === 1)
    .map(({ cell, index }) => ({
      key: cell.day,
      column: Math.floor((lead + index) / 7),
      label: monthFormat.format(new Date(cell.day * DAY_MS)),
    }))
    // A month starting in the window's first week would collide with it.
    .filter((month, index, all) => index === 0 || month.column - all[index - 1].column >= 3)

  const counts = new Map<StateKey, number>()
  for (const cell of cells)
    if (cell.state !== 'before') counts.set(cell.state, (counts.get(cell.state) ?? 0) + 1)
  const legend = (Object.keys(STATE_COLORS) as StateKey[]).filter((key) => counts.get(key))

  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: 'clamp(1px, 0.35vw, 3px)',
  }

  return (
    <section className={cn(SURFACE, 'inq-rise space-y-3 p-4')} style={rise(5)}>
      <CardTitle icon={<Calendar size={14} />}>اخر 12 شهر، يوم بيوم</CardTitle>
      <div className="mx-auto max-w-[900px] space-y-1.5">
        <div style={grid} className="h-4 text-[11px] text-muted" aria-hidden="true">
          {months.map((month) => (
            <span
              key={month.key}
              className="whitespace-nowrap"
              style={{ gridColumn: `${month.column + 1} / span 3` }}
            >
              {month.label}
            </span>
          ))}
        </div>
        <div
          style={{
            ...grid,
            gridTemplateRows: 'repeat(7, auto)',
            gridAutoFlow: 'column',
            rowGap: 'clamp(1px, 0.35vw, 3px)',
          }}
          role="img"
          aria-label={legend
            .map((key) => `${STATE_LABEL[key]} ${counts.get(key)} يوم`)
            .join('، ')}
        >
          {Array.from({ length: lead }, (_, index) => (
            <span key={`lead-${index}`} />
          ))}
          {cells.map((cell, index) => {
            const date = formatDate(new Date(cell.day * DAY_MS))
            const visit = cell.visit
            return (
              <span
                key={cell.day}
                title={
                  cell.state === 'before'
                    ? `${date} · قبل اضافة المعدة`
                    : `${date} · ${visit ? `${visitTitle(visit)} · ` : ''}${STATE_LABEL[cell.state]}`
                }
                onClick={visit ? () => onSelectVisit(visit.key) : undefined}
                className={cn(
                  'inq-pop aspect-square rounded-[2px] sm:rounded-[3px]',
                  visit && 'cursor-pointer hover:opacity-70',
                )}
                style={{
                  backgroundColor: dayColor(cell.state),
                  animationDelay: `${300 + Math.floor((lead + index) / 7) * 14}ms`,
                }}
              />
            )
          })}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-1.5 text-xs">
        {legend.map((key) => (
          <li
            key={key}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ backgroundColor: STATE_COLORS[key].fill }}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{
                backgroundColor: dayColor(key),
              }}
            />
            {STATE_LABEL[key]}
            <span className="font-bold tabular-nums">{counts.get(key)}</span>
            <span className="text-muted">يوم</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// --- The answer: facts, location, timeline -----------------------------------------------

function FactsCard({ unit, now, index }: { unit: DemoUnit; now: number; index: number }) {
  const items: DescriptionListItem[] = [
    { key: 'owner', icon: <Tag size={15} />, label: 'المالك', value: unit.owner },
    ...(unit.supplier
      ? [
          {
            key: 'supplier',
            icon: <Building2 size={15} />,
            label: 'المورد',
            value: unit.supplier,
          },
        ]
      : []),
    {
      key: 'plate',
      icon: <Hash size={15} />,
      label: 'رقم اللوحة',
      value: unit.plate ? <PlateText plate={unit.plate} /> : null,
    },
    {
      key: 'chassis',
      icon: <Hash size={15} />,
      label: 'رقم الشاصي',
      value: unit.chassis,
      dir: 'ltr',
    },
    {
      key: 'companyNumber',
      icon: <Hash size={15} />,
      label: 'رقم المعدة لدى الشركة',
      value: unit.companyNumber,
      dir: 'ltr',
    },
    ...(unit.previousCodes.length
      ? [
          {
            key: 'previous',
            icon: <History size={15} />,
            label: 'ارقام سابقة',
            value: unit.previousCodes.join('، '),
            dir: 'ltr' as const,
          },
        ]
      : []),
    {
      key: 'created',
      icon: <Calendar size={15} />,
      label: 'تاريخ الاضافة',
      value: formatDate(new Date(now - unit.createdDaysAgo * DAY_MS)),
      dir: 'ltr',
    },
  ]
  return (
    <section className={cn(SURFACE, 'inq-rise p-4 text-sm')} style={rise(index)}>
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
    <section className={cn(SURFACE, 'inq-rise space-y-3 p-4')} style={rise(index)}>
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
          'h-40 items-center justify-center rounded-xl bg-surface text-sm text-muted xl:flex',
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

/** One fact of a stay, as a small label over its value. */
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

/** One stay as a tile in its state's colour (owner: «تلون المربعات بحيث
 *  كل لون يرمز لحالة معينة»), with everything about it in view (owner:
 *  «الحركة تحتاج معلومات اكثر»). */
function StayTile({
  visit,
  now,
  highlighted,
}: {
  visit: EquipmentVisit
  now: number
  highlighted: boolean
}) {
  const { t, lang } = useI18n()
  const key = visitStateKey(visit)
  const colors = STATE_COLORS[key]
  const duration = visitDurationMs(visit, now)
  const entry = visit.entry
  const exit = visit.exit
  const site = visit.context === 'site'
  const company = site ? (entry ?? exit)?.company_name : null
  const entryDriver = entry?.driver_name ?? null
  const exitDriver = exit?.driver_name ?? null

  return (
    <article
      id={`visit-${visit.key}`}
      className="min-w-0 flex-1 scroll-mt-24 rounded-2xl p-3.5 transition-shadow sm:p-4"
      style={{
        backgroundColor: colors.fill,
        boxShadow: highlighted ? `0 0 0 2px ${colors.stroke}` : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-bold">{visitTitle(visit)}</h4>
            {!site && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={ON_FILL}>
                {STATE_LABEL[key]}
              </span>
            )}
            {visit.open && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: colors.tint, color: colors.stroke }}
              >
                الحين
              </span>
            )}
          </div>
          {company && <p className="mt-0.5 truncate-safe text-xs text-muted">{company}</p>}
        </div>
        <div className="shrink-0 text-end">
          <p className="text-sm font-bold">
            {duration !== null ? formatElapsedDuration(duration, t, lang) : '—'}
          </p>
          <p className="text-[11px] text-muted">{visit.open ? 'حتى الان' : 'المدة'}</p>
        </div>
      </div>

      <dl
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl p-3 sm:grid-cols-4"
        style={ON_FILL}
      >
        <StayFact icon={<LogIn size={11} />} label="الدخول">
          {entry ? (
            <button type="button" className="text-start underline-offset-4 hover:underline">
              {formatDate(entry.recorded_at)}
            </button>
          ) : (
            '—'
          )}
        </StayFact>
        <StayFact icon={<LogOut size={11} />} label="الخروج">
          {exit ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <button type="button" className="text-start underline-offset-4 hover:underline">
                {formatDate(exit.recorded_at)}
              </button>
              {site && <ExitPurposeBadge purpose={exit.exit_purpose} />}
            </span>
          ) : visit.open ? (
            <span className="text-muted">ما زالت داخل</span>
          ) : (
            '—'
          )}
        </StayFact>
        <StayFact
          icon={<UserCheck size={11} />}
          label={site ? 'الفورمان' : 'مسجل الدخول'}
        >
          {entry?.supervisor_name ?? '—'}
        </StayFact>
        {site ? (
          <StayFact icon={<User size={11} />} label="السائق">
            {entryDriver ?? '—'}
            {exitDriver && exitDriver !== entryDriver && (
              <span className="block text-xs text-muted">عند الخروج: {exitDriver}</span>
            )}
          </StayFact>
        ) : (
          <StayFact icon={<LogOut size={11} />} label="مسجل الخروج">
            {exit?.supervisor_name ?? '—'}
          </StayFact>
        )}
      </dl>
    </article>
  )
}

/** The days with no recorded stay, a general state (owner: «مو شرط انها
 *  على الطريق، ممكن تكون في الموقع لكن ماتسجلت»). */
function UnrecordedTile({ gap }: { gap: OutsideGap }) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs"
      style={{ backgroundColor: STATE_COLORS.unrecorded.fill }}
    >
      <span className="font-semibold">بدون تسجيل</span>
      <span className="text-muted">
        {gap.open ? 'منذ' : ''} {gap.days} يوم
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

/** Every stay and every unrecorded stretch, newest first, on one rail. */
function Timeline({
  visits,
  now,
  highlightedKey,
  index,
}: {
  visits: EquipmentVisit[]
  now: number
  highlightedKey: string | null
  index: number
}) {
  const items = buildTimelineItems(visits, now)
  return (
    <section className={cn(SURFACE, 'inq-rise p-4')} style={rise(index)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <CardTitle icon={<History size={14} />}>الرحلة</CardTitle>
        <span className="text-xs text-muted">{visits.length} زيارة</span>
      </div>
      {visits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-4 py-10 text-center">
          <IconTile colors={STATE_COLORS.unrecorded} size={40}>
            <CircleDashed size={18} />
          </IconTile>
          <p className="text-sm font-semibold">الرحلة لم تبدا بعد</p>
          <p className="text-xs text-muted">اول دخول للمعدة الى مشروع او الورشة يظهر هنا.</p>
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
              style={rise(index + 1 + position)}
            >
              {item.kind === 'visit' ? (
                <>
                  <span className="relative mt-3.5">
                    <IconTile colors={visitColors(item.visit)} size={32}>
                      {stateIcon(visitStateKey(item.visit), 15)}
                    </IconTile>
                  </span>
                  <StayTile
                    visit={item.visit}
                    now={now}
                    highlighted={highlightedKey === item.visit.key}
                  />
                </>
              ) : (
                <>
                  <span className="relative flex h-9 w-8 shrink-0 items-center justify-center">
                    <IconTile colors={STATE_COLORS.unrecorded} size={20}>
                      <CircleDashed size={11} />
                    </IconTile>
                  </span>
                  <UnrecordedTile gap={item.gap} />
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
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)

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
    setHighlightedKey(null)
    setRecent((current) =>
      [picked.id, ...current.filter((id) => id !== picked.id)].slice(0, 5),
    )
    setRun((value) => value + 1)
    setPhase('loading')
  }

  const selectVisit = (key: string) => {
    setHighlightedKey(key)
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
            بيانات عينة: A291 في مشروع، F118 في الورشة، B044 بدون تسجيل، U214
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

      <div className="relative min-h-[600px] rounded-2xl bg-surface px-3 py-6 sm:px-6">
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
            <div className="space-y-2 pb-6 text-center">
              <h2
                className="text-2xl font-bold sm:text-3xl"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                وين المعدة؟
              </h2>
              <p className="text-sm text-muted">
                اكتب الكود او اللوحة، ونوريك وين هي الحين ووين قضت سنتها.
              </p>
            </div>
          </div>
        </div>

        <div
          className="mx-auto transition-[max-width] duration-500"
          style={{ maxWidth: hero ? 640 : 520 }}
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
                  className="inline-flex items-center gap-2 rounded-full bg-bg px-3 py-1.5 text-sm shadow-sm transition-transform hover:-translate-y-0.5"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: presenceColors(buildEquipmentVisits(item.movements))
                        .stroke,
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
                    <YearCalendar
                      visits={visits}
                      createdAt={createdAt}
                      now={now}
                      onSelectVisit={selectVisit}
                    />
                  </>
                )}
                {/* Below xl: facts, location, timeline. From xl the
                    timeline spans two columns beside them; the facts sit
                    above the location (owner: «جدول بيانات المعدة فوق
                    الموقع الحالي»). */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <div className="space-y-4 xl:col-start-3 xl:row-start-1">
                    <FactsCard unit={unit} now={now} index={6} />
                    {viewer === 'admin' && unit.movements.length > 0 && (
                      <LocationCard index={7} />
                    )}
                  </div>
                  <div className="xl:col-span-2 xl:col-start-1 xl:row-start-1">
                    <Timeline
                      visits={visits}
                      now={now}
                      index={8}
                      highlightedKey={highlightedKey}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        اضغط على اي يوم ملون في التقويم ليبرز زيارته في الرحلة.
      </p>
    </section>
  )
}
