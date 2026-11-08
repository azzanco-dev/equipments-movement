import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Building2,
  Calendar,
  CalendarClock,
  CalendarOff,
  ChevronDown,
  Clock,
  Coins,
  Lock,
  MapPin,
  MoreHorizontal,
  Pencil,
  Percent,
  Plus,
  ReceiptText,
  StickyNote,
  Trash2,
  Truck,
  User,
} from 'lucide-react'
import { CountUp } from '@/components/admin-home/CountUp'
import { useCountUp } from '@/components/inquiry/inquiryStyle'
import {
  Badge,
  Button,
  Card,
  DescriptionList,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  PRIMARY_ACTIVE_TRIGGER,
  RiyalSign,
  SectionHeader,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type DescriptionListItem,
} from '@/components/ui'
import { vatOf, withVat } from '@/lib/purchasing'
import { splitPlateForDisplay } from '@/lib/plate'

/**
 * /ui-kit «نموذج صفحة PO العميل الجديدة» (Notion EM-262). The owner liked
 * his experimental page /client-po-lab («عجبتني ابغاك تستلهم منها لصفحة
 * تفاصيل po العميل»): its feel — a dark header card with a live status pill
 * and a ring of the elapsed PO period, four counting KPI cards, the lines
 * with a consumption bar each, a side column with the facts, the notes and a
 * timeline, staggered rise animations — rebuilt here on the project tokens
 * and the shared components, with the owner decisions of 2026-11-08:
 *   1. a client PO has NO approval («يجي من العميل فهو معتمد by default»):
 *      open / closed only;
 *   2. four price units per line: month, week, day, hour;
 *   3. a line has a contract quantity in its unit (consumed N of M with a
 *      bar) or none («حسب العمل», the amount accrued so far, no bar);
 *   4. the contract value = Σ price × quantity of the lines that have both
 *      (an amount, so units never mix), VAT 15 %, with VAT, the unit count;
 *   5. the header ring is the elapsed share of issue → expiry, «بلا تاريخ
 *      انتهاء» without an expiry;
 *   6. a line menu «تعديل» / «حذف» (hover / focus, always on touch);
 *   7. «خيارات» (edit, close) and «اضافة معدة» in the top bar, a bottom
 *      action bar on a phone;
 *   8. no manual card end and no PDF.
 * Two variants on the same sample data: «ا» the lab's dark header (the
 * primary surface: black in light mode, white in dark mode), «ب» a light
 * header card as the current pattern. Static sample data only.
 */

type PriceUnit = 'month' | 'week' | 'day' | 'hour'
type PoStatus = 'open' | 'closed'
type Variant = 'dark' | 'light'

const UNIT: Record<
  PriceUnit,
  { label: string; per: string; one: string; few: string }
> = {
  month: { label: 'شهري', per: 'لكل شهر', one: 'شهر', few: 'اشهر' },
  week: { label: 'اسبوعي', per: 'لكل اسبوع', one: 'اسبوع', few: 'اسابيع' },
  day: { label: 'يومي', per: 'لكل يوم', one: 'يوم', few: 'ايام' },
  hour: { label: 'ساعة', per: 'لكل ساعة', one: 'ساعة', few: 'ساعات' },
}

/** «3 ايام» … «10 ايام», then «11 يوم», «30 يوم» as the lab reads. */
const unitWord = (unit: PriceUnit, count: number) =>
  count >= 3 && count <= 10 ? UNIT[unit].few : UNIT[unit].one

interface SampleLine {
  id: string
  code: string
  type: string
  plate?: string
  chassis?: string
  unit: PriceUnit
  /** Excluding VAT; null = «بلا سعر». */
  price: number | null
  /** The contract quantity in the line's unit; null = «حسب العمل». */
  qty: number | null
  /** Consumed so far, in the same unit (only with a quantity). */
  used?: number
  /** «حسب العمل»: the amount accrued so far. */
  accrued?: number
}

const PO = {
  number: '4500098213',
  client: 'شركة المباني مقاولون عامون',
  project: 'مشروع الدرعية - المرحلة الثالثة',
  issueDate: '2026-10-01',
  expiryDate: '2026-12-31',
  standardHours: 260,
  createdBy: 'عبدالله العزاني',
  notes: 'يسلم الوقود على الموقع. لا تقبل المعدات دون فحص المشرف.',
}

/** The day the mockup is read on, so the ring and bars never drift. */
const TODAY = '2026-11-08'

const LINES: SampleLine[] = [
  {
    id: 'l1',
    code: 'A282',
    type: 'رافعة شوكية JCB',
    plate: '4821-ABJ',
    unit: 'day',
    price: 1450,
    qty: 30,
    used: 18,
  },
  {
    id: 'l2',
    code: 'TK-DT-32',
    type: 'قلاب 18 طن',
    plate: '1180-DHW',
    unit: 'month',
    price: 18500,
    qty: 6,
    used: 5,
  },
  {
    id: 'l3',
    code: 'F76',
    type: 'بوبكات كاتربيلر',
    plate: '9034-ZHT',
    unit: 'week',
    price: 4200,
    qty: 8,
    used: 8,
  },
  {
    id: 'l4',
    code: 'U160',
    type: 'مان لفت 20 متر',
    plate: '2210-YKL',
    unit: 'hour',
    price: 180,
    qty: 1560,
    used: 620,
  },
  {
    id: 'l5',
    code: 'B214',
    type: 'حفار كاتربيلر 320',
    plate: '7702-RSD',
    unit: 'hour',
    price: 220,
    qty: null,
    accrued: 12400,
  },
  {
    id: 'l6',
    code: 'TK-CS-12',
    type: 'مولد كهرباء 250 كيلو',
    chassis: 'CAT250-77812',
    unit: 'month',
    price: null,
    qty: 3,
    used: 1,
  },
]

type EventKind = 'created' | 'added' | 'price' | 'note'

const EVENT_TONE: Record<EventKind, string> = {
  created: 'var(--success)',
  added: 'var(--chart-stroke-3)',
  price: 'var(--chart-stroke-6)',
  note: 'var(--chart-stroke-2)',
}

const EVENTS: {
  id: string
  kind: EventKind
  title: ReactNode
  by: string
  at: string
}[] = [
  {
    id: 'e1',
    kind: 'created',
    title: 'انشئ PO العميل',
    by: 'عبدالله العزاني',
    at: '2026-10-01 09:12',
  },
  {
    id: 'e2',
    kind: 'added',
    title: (
      <>
        اضيفت المعدة <bdi dir="ltr">A282</bdi>
      </>
    ),
    by: 'عبدالله العزاني',
    at: '2026-10-01 09:20',
  },
  {
    id: 'e3',
    kind: 'price',
    title: (
      <>
        تغير سعر <bdi dir="ltr">F76</bdi>: 4,000 ← 4,200
      </>
    ),
    by: 'سعد القحطاني',
    at: '2026-10-03 11:05',
  },
  {
    id: 'e4',
    kind: 'added',
    title: (
      <>
        اضيفت المعدة <bdi dir="ltr">U160</bdi>
      </>
    ),
    by: 'سعد القحطاني',
    at: '2026-10-07 08:41',
  },
  {
    id: 'e5',
    kind: 'note',
    title: 'عدلت الملاحظات',
    by: 'عبدالله العزاني',
    at: '2026-10-09 14:02',
  },
]

/* ------------------------------ helpers ------------------------------ */

const num = (value: number) =>
  value.toLocaleString('en-US', { maximumFractionDigits: 2 })

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  )

/** Decision 4: an amount per line (price × quantity), so the sum is safe. */
function poTotals(lines: SampleLine[]) {
  const contracted = lines.filter(
    (line) => line.price !== null && line.qty !== null,
  )
  const subtotal = contracted.reduce(
    (sum, line) => sum + (line.price ?? 0) * (line.qty ?? 0),
    0,
  )
  return {
    subtotal,
    vat: vatOf(subtotal),
    total: withVat(subtotal),
    count: lines.length,
    byWork: lines.filter((line) => line.qty === null).length,
    unpriced: lines.filter((line) => line.price === null).length,
  }
}

const linesWord = (count: number, one: string, many: string) =>
  count === 1 ? one : `${count} ${many}`

const rise = (delay: number): CSSProperties => ({
  animationDelay: `${delay}ms`,
})

/** An amount counting up with its thousands separators (the shared
 *  `CountUp` writes bare digits, fine for counts); screen readers get the
 *  final amount only. */
function CountingNumber({ value }: { value: number }) {
  const shown = useCountUp(Math.round(value))
  return (
    <>
      <span aria-hidden="true">{num(shown)}</span>
      <span className="sr-only">{num(value)}</span>
    </>
  )
}

function Money({
  value,
  className,
  counting = false,
}: {
  value: number
  className?: string
  counting?: boolean
}) {
  return (
    <span
      className={cn('inline-flex items-baseline gap-1 tabular-nums', className)}
    >
      <bdi dir="ltr">
        {counting ? <CountingNumber value={value} /> : num(value)}
      </bdi>
      <RiyalSign />
      <span className="sr-only">ريال</span>
    </span>
  )
}

function Plate({ line }: { line: SampleLine }) {
  const parts = line.plate ? splitPlateForDisplay(line.plate) : null
  if (parts)
    return (
      <bdi dir="ltr" className="whitespace-nowrap tabular-nums">
        {parts.digits}{' '}
        <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
      </bdi>
    )
  return line.chassis ? <bdi dir="ltr">{line.chassis}</bdi> : null
}

/* ------------------------------ header ------------------------------ */

/** Decision 5: the elapsed share of issue → expiry. `onPrimary` draws it in
 *  the primary surface's contrast colour (monochrome, both themes). */
function PeriodRing({
  elapsed,
  total,
  onPrimary,
}: {
  elapsed: number
  total: number
  onPrimary: boolean
}) {
  const ratio = Math.min(1, Math.max(0, elapsed / total))
  const size = 88
  const stroke = 8
  const radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={onPrimary ? 'currentColor' : 'var(--surface-hover)'}
          strokeOpacity={onPrimary ? 0.2 : 1}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={onPrimary ? 'currentColor' : 'var(--fg)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * ratio} ${circ}`}
          className="inq-ring"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-semibold tabular-nums">
          <bdi dir="ltr">
            <CountUp value={Math.round(ratio * 100)} />%
          </bdi>
        </span>
        <span
          className={cn('text-[11px]', onPrimary ? 'opacity-70' : 'text-muted')}
        >
          من المدة
        </span>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: PoStatus }) {
  // Decision 1: open / closed only, never «مسودة» or «معتمد».
  if (status === 'closed')
    return <Badge icon={<Lock size={12} aria-hidden="true" />}>مقفل</Badge>
  return (
    <Badge
      tone="success"
      icon={
        <span
          aria-hidden="true"
          className="inq-dot inline-block size-1.5 rounded-full"
          style={{ backgroundColor: 'var(--success)' }}
        />
      }
    >
      مفتوح
    </Badge>
  )
}

function HeaderBody({
  variant,
  status,
  withExpiry,
}: {
  variant: Variant
  status: PoStatus
  withExpiry: boolean
}) {
  const onPrimary = variant === 'dark'
  const soft = onPrimary ? 'opacity-70' : 'text-muted'
  const totals = poTotals(LINES)
  const span = daysBetween(PO.issueDate, PO.expiryDate)
  const passed = Math.min(span, Math.max(0, daysBetween(PO.issueDate, TODAY)))
  const sinceIssue = Math.max(0, daysBetween(PO.issueDate, TODAY))

  const meta: { icon: ReactNode; label: string; value: ReactNode }[] = [
    {
      icon: <Calendar size={14} />,
      label: 'الاصدار',
      value: <bdi dir="ltr">{PO.issueDate}</bdi>,
    },
    {
      icon: <CalendarClock size={14} />,
      label: 'الانتهاء',
      value: withExpiry ? <bdi dir="ltr">{PO.expiryDate}</bdi> : 'بلا تاريخ',
    },
    {
      icon: <Truck size={14} />,
      label: 'المعدات',
      value: `${totals.count} معدات`,
    },
    { icon: <User size={14} />, label: 'انشاه', value: PO.createdBy },
  ]

  return (
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0 flex-[1_1_16rem]">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {totals.unpriced > 0 && (
            <Badge tone="warning">
              {linesWord(totals.unpriced, 'بند واحد بلا سعر', 'بنود بلا سعر')}
            </Badge>
          )}
        </div>
        <h2 className="mt-2 font-mono text-2xl font-semibold leading-none tabular-nums">
          <span className="sr-only">رقم PO العميل </span>
          <bdi dir="ltr">{PO.number}</bdi>
        </h2>
        {/* The client is the counterpart sales works with: its own line. */}
        <p className="mt-3 flex items-center gap-1.5 text-base font-semibold">
          <Building2 size={16} aria-hidden="true" className={soft} />
          {PO.client}
        </p>
        <p className={cn('mt-1 flex items-center gap-1.5 text-sm', soft)}>
          <MapPin size={14} aria-hidden="true" />
          {PO.project}
        </p>
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {meta.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={soft}>
                {item.icon}
              </span>
              <dt className={soft}>{item.label}</dt>
              <dd className="whitespace-nowrap font-medium tabular-nums">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {withExpiry ? (
        <div className="flex items-center gap-3">
          <PeriodRing elapsed={passed} total={span} onPrimary={onPrimary} />
          <div className="text-xs leading-5">
            <p>
              متبقي{' '}
              <span className="font-semibold tabular-nums">
                {span - passed} يوم
              </span>
            </p>
            <p className={soft}>
              من اصل <span className="tabular-nums">{span} يوم</span>
            </p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border border-dashed p-3 text-xs',
            onPrimary && 'border-current',
          )}
        >
          <CalendarOff size={22} aria-hidden="true" className={soft} />
          <div className="leading-5">
            <p className="font-semibold">بلا تاريخ انتهاء</p>
            <p className={soft}>
              مضى <span className="tabular-nums">{sinceIssue} يوم</span> من
              الاصدار
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ actions ------------------------------ */

function OptionsMenu({ wide = false }: { wide?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={wide ? 'md' : 'sm'}
          className={cn(wide && 'h-11 flex-1 md:h-11')}
        >
          خيارات
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<Pencil size={14} />}>تعديل</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" icon={<Lock size={14} />}>
          اقفال
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddButton({ wide = false }: { wide?: boolean }) {
  return (
    <Button
      variant="primary"
      size={wide ? 'md' : 'sm'}
      className={cn(wide && 'h-11 flex-1 md:h-11')}
      icon={<Plus size={14} aria-hidden="true" />}
    >
      اضافة معدة
    </Button>
  )
}

/* ------------------------------ lines ------------------------------ */

function usageTone(pct: number) {
  if (pct >= 100) return 'var(--danger)'
  if (pct >= 70) return 'var(--warning)'
  return 'var(--success)'
}

function Consumption({ line, delay }: { line: SampleLine; delay: number }) {
  if (line.qty === null)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge size="sm">حسب العمل</Badge>
        {line.accrued !== undefined && (
          <span className="text-muted">
            المتراكم حتى الان:{' '}
            <Money value={line.accrued} className="font-medium text-fg" />
          </span>
        )}
      </div>
    )
  const used = line.used ?? 0
  const pct = Math.min(100, Math.round((used / line.qty) * 100))
  const tone = usageTone(pct)
  return (
    <div className="mt-2 max-w-md">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          المستهلك{' '}
          <span className="font-medium tabular-nums text-fg">{num(used)}</span>{' '}
          من{' '}
          <span className="tabular-nums">
            {num(line.qty)} {unitWord(line.unit, line.qty)}
          </span>
        </span>
        <span className="tabular-nums" style={{ color: tone }}>
          {pct}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="المستهلك من الكمية"
      >
        <div
          className="inq-grow h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: tone, ...rise(delay) }}
        />
      </div>
    </div>
  )
}

function LineMenu() {
  // Decision 6: revealed on hover / focus where the device can hover, always
  // visible on touch; kept visible while its menu is open.
  return (
    <div className="transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:has-[[data-state=open]]:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            label="خيارات البند"
            icon={<MoreHorizontal size={16} aria-hidden="true" />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem icon={<Pencil size={14} />}>تعديل</DropdownMenuItem>
          <DropdownMenuItem tone="danger" icon={<Trash2 size={14} />}>
            حذف
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function LineRow({
  line,
  index,
  open,
}: {
  line: SampleLine
  index: number
  open: boolean
}) {
  const delay = 180 + index * 55
  const amount =
    line.price !== null && line.qty !== null ? line.price * line.qty : null
  return (
    <li
      className="inq-rise group flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-surface sm:flex-row sm:items-start"
      style={rise(delay)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-xs font-semibold transition-transform duration-300 motion-safe:group-hover:scale-105"
        >
          <bdi dir="ltr" className="font-mono">
            {line.code.split('-')[0].slice(0, 4)}
          </bdi>
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate-safe text-sm font-medium">
              {line.type}
            </span>
            <Badge size="sm">{UNIT[line.unit].label}</Badge>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <bdi dir="ltr" className="font-semibold text-fg">
              {line.code}
            </bdi>
            <span aria-hidden="true">·</span>
            <Plate line={line} />
          </p>
          <Consumption line={line} delay={delay} />
        </div>
      </div>

      <div className="flex items-start justify-between gap-2 border-t pt-3 sm:justify-end sm:border-t-0 sm:pt-0">
        <div className="text-start sm:w-40 sm:text-end">
          {line.price === null ? (
            <p className="text-sm font-semibold text-warning">بلا سعر</p>
          ) : (
            <p className="text-sm font-semibold">
              <Money value={line.price} />
            </p>
          )}
          <p className="text-xs text-muted">{UNIT[line.unit].per}</p>
          {amount !== null && (
            <p className="mt-1 text-xs text-muted">
              القيمة: <Money value={amount} className="text-fg" />
            </p>
          )}
        </div>
        {open && <LineMenu />}
      </div>
    </li>
  )
}

/* ------------------------------ page ------------------------------ */

function ClientPoPage({
  variant,
  status,
  withExpiry,
}: {
  variant: Variant
  status: PoStatus
  withExpiry: boolean
}) {
  const open = status === 'open'
  const totals = poTotals(LINES)

  const facts: DescriptionListItem[] = [
    {
      key: 'client',
      icon: <Building2 size={16} />,
      label: 'العميل',
      value: PO.client,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: 'المشروع',
      value: PO.project,
    },
    {
      key: 'issue',
      icon: <Calendar size={16} />,
      label: 'تاريخ الاصدار',
      value: PO.issueDate,
      dir: 'ltr',
    },
    withExpiry
      ? {
          key: 'expiry',
          icon: <CalendarClock size={16} />,
          label: 'تاريخ الانتهاء',
          value: PO.expiryDate,
          dir: 'ltr',
        }
      : {
          key: 'expiry',
          icon: <CalendarOff size={16} />,
          label: 'تاريخ الانتهاء',
          value: 'بلا تاريخ انتهاء',
        },
    {
      key: 'hours',
      icon: <Clock size={16} />,
      label: 'ساعات العمل القياسية',
      value: `${PO.standardHours} ساعة`,
    },
    {
      key: 'by',
      icon: <User size={16} />,
      label: 'انشاه',
      value: PO.createdBy,
    },
    {
      key: 'status',
      icon: <Lock size={16} />,
      label: 'الحالة',
      value: open ? 'مفتوح' : 'مقفل',
    },
  ]

  const kpis: {
    label: string
    value: ReactNode
    icon: ReactNode
    accent: 'chart-1' | 'chart-2' | 'chart-5' | 'chart-6'
  }[] = [
    {
      label: 'القيمة التعاقدية قبل الضريبة',
      value: <Money value={totals.subtotal} counting />,
      icon: <Coins size={15} />,
      accent: 'chart-2',
    },
    {
      label: 'ضريبة القيمة المضافة 15%',
      value: <Money value={totals.vat} counting />,
      icon: <Percent size={15} />,
      accent: 'chart-6',
    },
    {
      label: 'الاجمالي مع الضريبة',
      value: <Money value={totals.total} counting />,
      icon: <ReceiptText size={15} />,
      accent: 'chart-5',
    },
    {
      label: 'عدد المعدات',
      value: <CountUp value={totals.count} />,
      icon: <Truck size={15} />,
      accent: 'chart-1',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Top bar: the trail, then the actions (decision 7). */}
      <div className="inq-rise flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          المبيعات <span aria-hidden="true">›</span> PO العملاء{' '}
          <span aria-hidden="true">›</span>{' '}
          <bdi dir="ltr" className="font-medium text-fg">
            {PO.number}
          </bdi>
        </p>
        {open && (
          <div className="hidden items-center gap-2 sm:flex">
            <OptionsMenu />
            <AddButton />
          </div>
        )}
      </div>

      {variant === 'dark' ? (
        <header
          className="inq-rise rounded-2xl bg-primary p-4 text-primary-contrast sm:p-5"
          style={rise(40)}
        >
          <HeaderBody variant="dark" status={status} withExpiry={withExpiry} />
        </header>
      ) : (
        <div className="inq-rise" style={rise(40)}>
          <Card as="header" className="rounded-2xl p-4 sm:p-5">
            <HeaderBody
              variant="light"
              status={status}
              withExpiry={withExpiry}
            />
          </Card>
        </div>
      )}

      {/* The summary strip (decision 4). */}
      <div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 2xl:grid-cols-4">
          {kpis.map((kpi, index) => (
            <div
              key={kpi.label}
              className="inq-rise"
              style={rise(80 + index * 60)}
            >
              <StatCard
                label={kpi.label}
                value={kpi.value}
                icon={kpi.icon}
                accent={kpi.accent}
                className="h-full rounded-2xl transition-transform duration-300 motion-safe:hover:-translate-y-0.5"
              />
            </div>
          ))}
        </div>
        {(totals.byWork > 0 || totals.unpriced > 0) && (
          <p className="mt-2 text-xs text-muted">
            {totals.byWork > 0 &&
              linesWord(
                totals.byWork,
                'بند واحد حسب العمل غير مشمول في القيمة التعاقدية',
                'بنود حسب العمل غير مشمولة في القيمة التعاقدية',
              )}
            {totals.byWork > 0 && totals.unpriced > 0 && ' · '}
            {totals.unpriced > 0 && (
              <span className="text-warning">
                {linesWord(totals.unpriced, 'بند واحد بلا سعر', 'بنود بلا سعر')}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Body: facts above the lines below xl, beside them from xl. */}
      <div className="grid gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
        <div
          className="inq-rise xl:col-start-3 xl:row-start-1"
          style={rise(200)}
        >
          <Card className="rounded-2xl">
            <SectionHeader title="التفاصيل" />
            <DescriptionList items={facts} className="mt-1" />
            {PO.notes && (
              <div className="mt-3 flex gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-xs leading-5 text-fg">
                <StickyNote
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-warning"
                />
                <p>
                  <span className="sr-only">الملاحظات: </span>
                  {PO.notes}
                </p>
              </div>
            )}
          </Card>
        </div>

        <div
          className="inq-rise min-w-0 xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1"
          style={rise(140)}
        >
          <Card padded={false} className="rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                المعدات المشمولة
                <Badge size="sm">{totals.count}</Badge>
              </h3>
              <span className="text-xs text-muted">
                السعر قبل الضريبة لكل وحدة متفق عليها
              </span>
            </div>
            <ul className="divide-y">
              {LINES.map((line, index) => (
                <LineRow key={line.id} line={line} index={index} open={open} />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              {open ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={14} aria-hidden="true" />}
                >
                  اضافة معدة
                </Button>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Lock size={12} aria-hidden="true" />
                  PO مقفل: لا تعديل على البنود
                </span>
              )}
              <span
                className={cn(
                  'text-xs',
                  totals.unpriced > 0 ? 'text-warning' : 'text-muted',
                )}
              >
                {totals.unpriced > 0
                  ? linesWord(
                      totals.unpriced,
                      'بند واحد يحتاج تسعير',
                      'بنود تحتاج تسعير',
                    )
                  : 'كل البنود مسعرة'}
              </span>
            </div>
          </Card>
        </div>

        <div
          className="inq-rise xl:col-start-3 xl:row-start-2"
          style={rise(260)}
        >
          <Card className="rounded-2xl">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  السجل
                  <Badge size="sm">{EVENTS.length}</Badge>
                </span>
              }
            />
            <ol className="relative mt-3 space-y-3 ps-5">
              <span
                aria-hidden="true"
                className="absolute inset-y-1 start-[5px] w-px bg-border"
              />
              {EVENTS.map((event, index) => (
                <li
                  key={event.id}
                  className="inq-rise relative"
                  style={rise(300 + index * 60)}
                >
                  <span
                    aria-hidden="true"
                    className="absolute -start-5 top-1 size-2.5 rounded-full ring-4 ring-[var(--bg)]"
                    style={{ backgroundColor: EVENT_TONE[event.kind] }}
                  />
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {event.by} ·{' '}
                    <bdi dir="ltr" className="tabular-nums">
                      {event.at}
                    </bdi>
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* Phone: the primary actions at the bottom (the approved pattern). */}
      {open && (
        <div
          className="sticky bottom-0 z-10 -mx-3 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <AddButton wide />
          <OptionsMenu wide />
        </div>
      )}
    </div>
  )
}

/* ------------------------------ section ------------------------------ */

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
        <TabsList variant="segmented" aria-label={label}>
          {options.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              className={PRIMARY_ACTIVE_TRIGGER}
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

export function ClientPoPageMockup() {
  const [variant, setVariant] = useState<Variant>('dark')
  const [status, setStatus] = useState<PoStatus>('open')
  const [expiry, setExpiry] = useState<'with' | 'without'>('with')

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented
          label="النسخة"
          value={variant}
          onChange={setVariant}
          options={[
            { value: 'dark', label: 'ا · راس داكن' },
            { value: 'light', label: 'ب · راس فاتح' },
          ]}
        />
        <Segmented
          label="الحالة"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'مفتوح' },
            { value: 'closed', label: 'مقفل' },
          ]}
        />
        <Segmented
          label="تاريخ الانتهاء"
          value={expiry}
          onChange={setExpiry}
          options={[
            { value: 'with', label: 'موجود' },
            { value: 'without', label: 'بلا تاريخ' },
          ]}
        />
      </div>
      <p className="text-xs text-muted">
        بيانات عينة. PO العميل بلا اعتماد (مفتوح او مقفل فقط)، اربع وحدات سعر،
        بند بكمية تعاقدية او حسب العمل. انهاء الكرت يدويا وتصدير PDF ليسا ضمن
        هذه الصفحة.
      </p>
      <div className="rounded-2xl border bg-surface p-3 sm:p-4">
        <ClientPoPage
          key={`${variant}-${status}-${expiry}`}
          variant={variant}
          status={status}
          withExpiry={expiry === 'with'}
        />
      </div>
    </div>
  )
}
