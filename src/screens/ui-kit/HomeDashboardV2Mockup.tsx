import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileWarning,
  HardHat,
  LogIn,
  LogOut,
  ParkingCircle,
  Radio,
  Repeat,
  Truck,
  WifiOff,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Select,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type BadgeTone,
  type DataTableColumn,
  type StatCardAccent,
} from '@/components/ui'
import { deepTint } from '@/components/charts'
import {
  SoftAreaChart,
  SoftBarChart,
  SoftDonut,
} from '@/components/charts/lazy'
import { CountUp } from '@/components/admin-home/CountUp'
import { workshopPurposeTone, type WorkshopPurpose } from '@/lib/equipmentState'

// Arabic like the rest of the mockup (the real page reads `t()`).
const PURPOSE_LABEL: Record<WorkshopPurpose, string> = {
  maintenance: 'صيانة',
  parking: 'انتظار',
  out_of_service: 'خارج الخدمة',
}
const PURPOSE_ICON: Record<WorkshopPurpose, ReactNode> = {
  maintenance: <Wrench size={11} aria-hidden="true" />,
  parking: <ParkingCircle size={11} aria-hidden="true" />,
  out_of_service: <Ban size={11} aria-hidden="true" />,
}

// Owner 2026-11-08: «نبغى نشتغل على الرئيسية … خليه يعيد بناء الرئيسية بناء
// على استلهام من هذا الصور … خليه يسويها في ui-kit», with four reference
// dashboards (dense KPI strip with sparklines, three analytic cards, dense
// tables and lists, a bottom row of bars and charts). Taken from them: the
// LAYOUT and the DENSITY only (EM-252, «الارقام الحالية تاخذ كامل الصفحة»).
// Every block shows data this program already has — the fleet by owner and
// state, projects, site and workshop visits, movements, suppliers, Afaqy,
// purchasing and sales. Their fuel, stock, staff, work-order, cost, map and
// document blocks have no data here and are left out. Two densities on the
// same data: «ا» compact (the images' density) and «ب» the current home's
// spacing with the new arrangement. Sample data only: nothing here reads or
// writes Supabase.

type Variant = 'compact' | 'roomy'

const VARIANTS: { id: Variant; label: string; note: string }[] = [
  {
    id: 'compact',
    label: 'ا · مضغوطة',
    note: 'كثافة الصور المرجعية: نص 13، مسافات صغيرة، الرئيسية كلها في شاشة ونص تقريبا.',
  },
  {
    id: 'roomy',
    label: 'ب · مسافات الرئيسية الحالية',
    note: 'نفس الترتيب والبيانات بمسافات واحجام الرئيسية الحالية.',
  },
]

/** Every size the two variants disagree on, in one place. */
type Density = {
  gap: string
  cardPad: string
  text: string
  title: string
  tileValue: string
  rowPad: string
  tableSize: 'sm' | 'md'
  cellPad: string
  donutHeight: number
  barsHeight: number
  areaHeight: number
  rows: number
  /** Analytic rows go three-wide from this breakpoint. */
  threeCols: string
  kpiCols: string
}

const DENSITY: Record<Variant, Density> = {
  compact: {
    gap: 'gap-2.5',
    cardPad: 'p-3',
    text: 'text-[13px]',
    title: 'text-[13px]',
    tileValue: 'text-xl',
    rowPad: 'py-1.5',
    tableSize: 'sm',
    cellPad: 'py-1',
    donutHeight: 150,
    barsHeight: 170,
    areaHeight: 170,
    rows: 6,
    threeCols: 'lg:grid-cols-3',
    kpiCols: 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-8',
  },
  roomy: {
    gap: 'gap-4',
    cardPad: 'p-4',
    text: 'text-sm',
    title: 'text-sm',
    tileValue: 'text-2xl',
    rowPad: 'py-2.5',
    tableSize: 'md',
    cellPad: 'py-2',
    donutHeight: 190,
    barsHeight: 210,
    areaHeight: 220,
    rows: 6,
    threeCols: 'md:grid-cols-2 xl:grid-cols-3',
    kpiCols: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  },
}

// --- sample data -----------------------------------------------------------
// The figures add up: the fleet (285) = in projects (186) + the workshop (61)
// + available (38); the owners sum to the fleet; the workshop purposes sum to
// the workshop.

const OWNERS = [
  { id: 'alazani', label: 'العزاني', fleet: 142, inProjects: 88, shade: 1 },
  { id: 'takween', label: 'تكوين', fleet: 38, inProjects: 24, shade: 3 },
  {
    id: 'third_party_f',
    label: 'طرف ثالث F',
    fleet: 47,
    inProjects: 33,
    shade: 2,
  },
  {
    id: 'third_party_b',
    label: 'طرف ثالث B',
    fleet: 21,
    inProjects: 14,
    shade: 5,
  },
  {
    id: 'external_supplier',
    label: 'مالك اخر',
    fleet: 37,
    inProjects: 27,
    shade: 4,
  },
] as const

const FLEET = OWNERS.reduce((sum, owner) => sum + owner.fleet, 0) // 285
const IN_PROJECTS = OWNERS.reduce((sum, owner) => sum + owner.inProjects, 0) // 186

type StateId = 'working' | WorkshopPurpose | 'unclassified' | 'available'

const STATES: { id: StateId; label: string; count: number; shade: number }[] = [
  { id: 'working', label: 'في المشاريع', count: IN_PROJECTS, shade: 1 },
  { id: 'maintenance', label: 'صيانة', count: 28, shade: 2 },
  { id: 'parking', label: 'انتظار', count: 17, shade: 3 },
  { id: 'out_of_service', label: 'خارج الخدمة', count: 12, shade: 5 },
  { id: 'unclassified', label: 'غير مصنفة', count: 4, shade: 4 },
  { id: 'available', label: 'متاحة', count: 38, shade: 6 },
]

const countOf = (id: StateId) =>
  STATES.find((state) => state.id === id)?.count ?? 0
const IN_WORKSHOP =
  countOf('maintenance') +
  countOf('parking') +
  countOf('out_of_service') +
  countOf('unclassified') // 61

function shareOf(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'
}

/** Units inside each project now (the open site visits). */
const TOP_PROJECTS = [
  { id: 'p1', label: 'طريق الخرج', count: 41 },
  { id: 'p2', label: 'حي الياسمين', count: 33 },
  { id: 'p3', label: 'مستودعات السلي', count: 27 },
  { id: 'p4', label: 'جسر العليا', count: 22 },
  { id: 'p5', label: 'مجمع النرجس', count: 18 },
  { id: 'p6', label: 'محطة الحاير', count: 14 },
]
const OTHER_PROJECTS =
  IN_PROJECTS - TOP_PROJECTS.reduce((sum, row) => sum + row.count, 0) // 31

type Movement = {
  id: string
  time: string
  type: 'entry' | 'exit'
  code: string
  unit: string
  driver: string
  place: string
  workshop?: boolean
}

const MOVEMENTS: Movement[] = [
  {
    id: 'm1',
    time: '10:15',
    type: 'exit',
    code: 'A291',
    unit: 'WHEEL LOADER',
    driver: 'احمد محمد',
    place: 'طريق الخرج',
  },
  {
    id: 'm2',
    time: '09:42',
    type: 'entry',
    code: 'TK012',
    unit: 'DUMP TRUCK',
    driver: 'سالم علي',
    place: 'حي الياسمين',
  },
  {
    id: 'm3',
    time: '09:20',
    type: 'entry',
    code: 'A055',
    unit: 'EXCAVATOR',
    driver: '—',
    place: 'الورشة',
    workshop: true,
  },
  {
    id: 'm4',
    time: '08:36',
    type: 'exit',
    code: 'F018',
    unit: 'CRANE',
    driver: 'ناصر خالد',
    place: 'جسر العليا',
  },
  {
    id: 'm5',
    time: '08:12',
    type: 'entry',
    code: 'B007',
    unit: 'GRADER',
    driver: 'فهد عبدالله',
    place: 'مستودعات السلي',
  },
  {
    id: 'm6',
    time: '07:50',
    type: 'exit',
    code: 'A140',
    unit: 'DUMP TRUCK',
    driver: '—',
    place: 'الورشة',
    workshop: true,
  },
  {
    id: 'm7',
    time: '07:31',
    type: 'entry',
    code: 'S204',
    unit: 'WATER TANKER',
    driver: 'محمد سالم',
    place: 'مجمع النرجس',
  },
]

type Attention = {
  id: string
  label: string
  detail: string
  count: number
  age: string
  tone: Exclude<BadgeTone, 'neutral'>
  icon: ReactNode
  /** Which section of the program it belongs to; shown as a small tag. */
  area: 'الورشة' | 'المشتريات' | 'المبيعات' | 'افاقي'
}

const ATTENTION: Attention[] = [
  {
    id: 'unclassified',
    label: 'في الورشة بدون تصنيف',
    detail: 'A233 · WATER TANKER',
    count: countOf('unclassified'),
    age: 'منذ 3 ساعات',
    tone: 'warning',
    icon: <Wrench size={14} />,
    area: 'الورشة',
  },
  {
    id: 'oos_long',
    label: 'خارج الخدمة اكثر من 30 يوم',
    detail: 'F018 · CRANE',
    count: 2,
    age: 'منذ 41 يوما',
    tone: 'danger',
    icon: <Ban size={14} />,
    area: 'الورشة',
  },
  {
    id: 'no_po',
    label: 'في المشاريع بدون PO',
    detail: 'اقدمها S112 في طريق الخرج',
    count: 12,
    age: 'منذ 9 ايام',
    tone: 'warning',
    icon: <FileWarning size={14} />,
    area: 'المشتريات',
  },
  {
    id: 'unpriced',
    label: 'اوامر شراء تحتاج اسعار',
    detail: 'PO-2026110004 · 3 معدات',
    count: 5,
    age: 'منذ 4 ايام',
    tone: 'warning',
    icon: <CircleDollarSign size={14} />,
    area: 'المشتريات',
  },
  {
    id: 'to_approve',
    label: 'اوامر شراء جاهزة للاعتماد',
    detail: 'كل بنودها مسعرة',
    count: 3,
    age: 'منذ يومين',
    tone: 'info',
    icon: <BadgeCheck size={14} />,
    area: 'المشتريات',
  },
  {
    id: 'prices',
    label: 'اسعار كروت بانتظار الاعتماد',
    detail: 'سعر العميل مسجل',
    count: 9,
    age: 'منذ يوم',
    tone: 'info',
    icon: <ClipboardCheck size={14} />,
    area: 'المبيعات',
  },
  {
    id: 'card_end',
    label: 'كروت تنتظر الانهاء',
    detail: 'خرجت معداتها من المشروع',
    count: 4,
    age: 'منذ 6 ايام',
    tone: 'warning',
    icon: <Repeat size={14} />,
    area: 'المبيعات',
  },
  {
    id: 'afaqy',
    label: 'غير متصلة في افاقي منذ 24 ساعة',
    detail: 'اطولها A078',
    count: 19,
    age: 'منذ 7 شهور',
    tone: 'danger',
    icon: <WifiOff size={14} />,
    area: 'افاقي',
  },
]

type WorkshopRow = {
  code: string
  type: string
  purpose: WorkshopPurpose | null
  since: string
}

const WORKSHOP_ROWS: WorkshopRow[] = [
  { code: 'A233', type: 'WATER TANKER', purpose: null, since: '3 ساعات' },
  { code: 'A055', type: 'EXCAVATOR', purpose: 'maintenance', since: 'يومين' },
  { code: 'TK012', type: 'DUMP TRUCK', purpose: 'parking', since: '5 ايام' },
  { code: 'A140', type: 'DUMP TRUCK', purpose: 'maintenance', since: 'اسبوع' },
  { code: 'B007', type: 'GRADER', purpose: 'parking', since: '12 يوما' },
  { code: 'F018', type: 'CRANE', purpose: 'out_of_service', since: '41 يوما' },
  {
    code: 'TK031',
    type: 'BULLDOZER',
    purpose: 'out_of_service',
    since: 'شهرين',
  },
]

/** «مالك اخر» units inside projects, by supplier (27 in all). */
const SUPPLIERS = [
  { id: 's1', label: 'شركة الخليج للمعدات', count: 9 },
  { id: 's2', label: 'مؤسسة النخيل', count: 7 },
  { id: 's3', label: 'الصحراء للتاجير', count: 5 },
  { id: 's4', label: 'البحر الاحمر للمقاولات', count: 3 },
  { id: 'none', label: 'بدون مورد', count: 3 },
]

/** Per type: inside projects, in the workshop, available (sums to the fleet). */
const TYPES = [
  { id: 'dump', label: 'DUMP TRUCK', projects: 62, workshop: 14, available: 9 },
  { id: 'exc', label: 'EXCAVATOR', projects: 41, workshop: 12, available: 6 },
  {
    id: 'loader',
    label: 'WHEEL LOADER',
    projects: 22,
    workshop: 8,
    available: 7,
  },
  {
    id: 'tanker',
    label: 'WATER TANKER',
    projects: 19,
    workshop: 9,
    available: 5,
  },
  { id: 'crane', label: 'CRANE', projects: 15, workshop: 7, available: 3 },
  {
    id: 'others',
    label: 'باقي الانواع',
    projects: 27,
    workshop: 11,
    available: 8,
  },
]

const AFAQY = { linked: 214, connected: 188, notConnected: 19, noSignal: 7 }
const AFAQY_LONGEST = [
  { code: 'A078', last: '7 شهور' },
  { code: 'TK031', last: '3 شهور' },
  { code: 'A112', last: '19 يوما' },
]

// Thirty days ending on 2026-11-08 (the mockup's day); fixed, no randomness.
const ENTRIES_30 = [
  5, 8, 6, 9, 4, 0, 7, 10, 6, 8, 11, 5, 0, 9, 12, 7, 6, 10, 8, 0, 7, 9, 13, 6,
  8, 11, 7, 0, 9, 14,
]
const EXITS_30 = [
  3, 6, 5, 7, 4, 0, 5, 8, 6, 5, 9, 4, 0, 7, 10, 6, 5, 8, 7, 0, 6, 7, 11, 5, 6,
  9, 6, 0, 8, 9,
]
const DAYS_30 = ENTRIES_30.map((entries, index) => {
  const day = new Date(Date.UTC(2026, 10, 8))
  day.setUTCDate(day.getUTCDate() - (ENTRIES_30.length - 1 - index))
  const dd = String(day.getUTCDate()).padStart(2, '0')
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
  return {
    key: `2026-${mm}-${dd}`,
    label: `${dd}/${mm}`,
    title: `${dd}/${mm}/2026`,
    entries,
    exits: EXITS_30[index],
  }
})
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0)

// --- small shared pieces ---------------------------------------------------

/** A run of tiny bars in a light chart shade: the tile's last 14 days. */
function MiniBars({ values, shade }: { values: number[]; shade: number }) {
  const max = Math.max(1, ...values)
  return (
    <span aria-hidden="true" className="flex h-6 shrink-0 items-end gap-[2px]">
      {values.map((value, index) => (
        <span
          key={index}
          className="block w-[3px] rounded-t-sm"
          style={{
            height: `${Math.max(12, (value / max) * 100)}%`,
            backgroundColor: deepTint(
              `var(--chart-${shade})`,
              `var(--chart-stroke-${shade})`,
            ),
          }}
        />
      ))}
    </span>
  )
}

/** The block header of the images: Arabic title, its English under it in
 *  small muted text, and a «عرض الكل» link or a period select at the end. */
function BlockHeader({
  title,
  en,
  action,
  density,
}: {
  title: string
  en: string
  action?: ReactNode
  density: Density
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className={cn('font-semibold leading-tight', density.title)}>
          {title}
        </h3>
        <p
          className="font-latin text-[11px] leading-tight text-muted"
          dir="ltr"
        >
          {en}
        </p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Block({
  title,
  en,
  action,
  density,
  className,
  children,
}: {
  title: string
  en: string
  action?: ReactNode
  density: Density
  className?: string
  children: ReactNode
}) {
  return (
    <Card
      padded={false}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl',
        density.cardPad,
        className,
      )}
    >
      <BlockHeader title={title} en={en} action={action} density={density} />
      <div className="min-w-0 flex-1">{children}</div>
    </Card>
  )
}

function ViewAll() {
  return (
    <Button size="sm" variant="ghost">
      عرض الكل
    </Button>
  )
}

const PERIODS = [
  { value: '7', label: 'اخر 7 ايام' },
  { value: '30', label: 'اخر 30 يوم' },
  { value: 'month', label: 'هذا الشهر' },
]

function PeriodSelect({ label }: { label: string }) {
  const [value, setValue] = useState('30')
  return (
    <Select
      size="sm"
      value={value}
      onValueChange={setValue}
      options={PERIODS}
      aria-label={label}
    />
  )
}

const OWNER_OPTIONS = [
  { value: 'all', label: 'كل الملاك' },
  ...OWNERS.map((owner) => ({ value: owner.id, label: owner.label })),
]

function OwnerSelect({ label }: { label: string }) {
  const [value, setValue] = useState('all')
  return (
    <Select
      size="sm"
      value={value}
      onValueChange={setValue}
      options={OWNER_OPTIONS}
      aria-label={label}
    />
  )
}

// --- (1) the greeting line -------------------------------------------------

function Greeting({ density }: { density: Density }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-bold leading-tight">صباح الخير، مبارك</h2>
        <p className={cn('text-muted', density.text)}>
          الاحد 8 نوفمبر 2026 · اخر تحديث 10:24
        </p>
      </div>
      <OwnerSelect label="ملاك الرئيسية" />
    </div>
  )
}

// --- (2) the KPI strip -----------------------------------------------------

type Kpi = {
  id: string
  label: string
  en: string
  value: number
  /** The share chip, or the change against 7 days ago. */
  chip: string
  chipTone: BadgeTone
  trend?: 'up' | 'down'
  accent: StatCardAccent
  shade: number
  icon: ReactNode
  spark: number[]
}

const KPIS: Kpi[] = [
  {
    id: 'fleet',
    label: 'الاسطول',
    en: 'Fleet',
    value: FLEET,
    chip: '+4 هذا الشهر',
    chipTone: 'success',
    trend: 'up',
    accent: 'chart-1',
    shade: 1,
    icon: <Truck size={15} />,
    spark: [
      279, 280, 280, 281, 281, 282, 282, 283, 283, 283, 284, 284, 285, 285,
    ],
  },
  {
    id: 'projects',
    label: 'في المشاريع',
    en: 'On projects',
    value: IN_PROJECTS,
    chip: shareOf(IN_PROJECTS, FLEET),
    chipTone: 'neutral',
    trend: 'up',
    accent: 'chart-1',
    shade: 1,
    icon: <HardHat size={15} />,
    spark: [
      174, 176, 175, 179, 180, 178, 181, 183, 182, 184, 183, 185, 184, 186,
    ],
  },
  {
    id: 'maintenance',
    label: 'صيانة',
    en: 'Maintenance',
    value: countOf('maintenance'),
    chip: shareOf(countOf('maintenance'), FLEET),
    chipTone: 'neutral',
    trend: 'down',
    accent: 'warning',
    shade: 2,
    icon: <Wrench size={15} />,
    spark: [33, 31, 32, 30, 31, 29, 30, 30, 29, 28, 29, 28, 27, 28],
  },
  {
    id: 'parking',
    label: 'انتظار',
    en: 'Standby',
    value: countOf('parking'),
    chip: shareOf(countOf('parking'), FLEET),
    chipTone: 'neutral',
    accent: 'info',
    shade: 3,
    icon: <ParkingCircle size={15} />,
    spark: [16, 18, 17, 19, 18, 17, 16, 18, 17, 17, 18, 16, 17, 17],
  },
  {
    id: 'oos',
    label: 'خارج الخدمة',
    en: 'Out of service',
    value: countOf('out_of_service'),
    chip: shareOf(countOf('out_of_service'), FLEET),
    chipTone: 'neutral',
    trend: 'up',
    accent: 'danger',
    shade: 5,
    icon: <Ban size={15} />,
    spark: [9, 9, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  },
  {
    id: 'available',
    label: 'متاحة',
    en: 'Available',
    value: countOf('available'),
    chip: shareOf(countOf('available'), FLEET),
    chipTone: 'neutral',
    trend: 'down',
    accent: 'chart-6',
    shade: 6,
    icon: <CheckCircle2 size={15} />,
    spark: [47, 45, 46, 43, 42, 44, 41, 40, 41, 39, 40, 38, 39, 38],
  },
  {
    id: 'today',
    label: 'دخول اليوم',
    en: 'Entries today',
    value: ENTRIES_30[29],
    chip: `خروج ${EXITS_30[29]}`,
    chipTone: 'exit',
    accent: 'entry',
    shade: 1,
    icon: <ArrowDownRight size={15} />,
    spark: ENTRIES_30.slice(-14),
  },
  {
    id: 'no_po',
    label: 'بدون PO',
    en: 'Without PO',
    value: 12,
    chip: `من ${IN_PROJECTS}`,
    chipTone: 'warning',
    accent: 'warning',
    shade: 2,
    icon: <FileWarning size={15} />,
    spark: [17, 16, 16, 15, 15, 14, 15, 14, 13, 13, 12, 13, 12, 12],
  },
]

function KpiTile({ kpi, density }: { kpi: Kpi; density: Density }) {
  const TrendIcon = kpi.trend === 'down' ? ArrowDownRight : ArrowUpRight
  return (
    <StatCard
      accent={kpi.accent}
      icon={kpi.icon}
      className={cn('rounded-2xl', density.cardPad)}
      label={
        <span className="block whitespace-normal leading-tight">
          <span className="block">{kpi.label}</span>
          <span
            className="block font-latin text-[10px] leading-tight"
            dir="ltr"
          >
            {kpi.en}
          </span>
        </span>
      }
      value={
        <span className="flex items-end justify-between gap-2">
          <span className={cn('leading-none', density.tileValue)}>
            <CountUp value={kpi.value} />
          </span>
          <MiniBars values={kpi.spark} shade={kpi.shade} />
        </span>
      }
      hint={
        <span className="mt-1 flex items-center gap-1">
          <Badge size="sm" tone={kpi.chipTone} className="tabular-nums">
            {kpi.trend && kpi.id !== 'fleet' && (
              <TrendIcon size={11} aria-hidden="true" />
            )}
            {kpi.chip}
          </Badge>
        </span>
      }
    />
  )
}

// --- (3) the analytic row --------------------------------------------------

function FleetStateCard({ density }: { density: Density }) {
  return (
    <Block
      title="حالة الاسطول"
      en="Fleet status"
      density={density}
      action={<OwnerSelect label="ملاك حالة الاسطول" />}
    >
      <SoftDonut
        ariaLabel="حالة الاسطول"
        centerLabel="معدة"
        height={density.donutHeight}
        legend="side"
        slices={STATES.map((state) => ({
          id: state.id,
          label: state.label,
          value: state.count,
          color: `var(--chart-${state.shade})`,
          strokeColor: `var(--chart-stroke-${state.shade})`,
        }))}
      />
    </Block>
  )
}

function TopProjectsCard({ density }: { density: Density }) {
  return (
    <Block
      title="المشاريع الاكثر معدات"
      en="Top projects by units inside"
      density={density}
      action={<ViewAll />}
    >
      <SoftBarChart
        ariaLabel="المعدات داخل كل مشروع الان"
        height={density.barsHeight}
        singleColor="var(--chart-1)"
        singleStroke="var(--chart-stroke-1)"
        items={TOP_PROJECTS.map((row) => ({
          id: row.id,
          label: row.label,
          value: row.count,
        }))}
      />
      <p className={cn('mt-1 text-muted', density.text)}>
        باقي المشاريع:{' '}
        <span className="font-semibold tabular-nums text-fg">
          {OTHER_PROJECTS}
        </span>{' '}
        معدة
      </p>
    </Block>
  )
}

function WorkshopPurposeCard({ density }: { density: Density }) {
  const slices = STATES.filter(
    (state) => state.id !== 'working' && state.id !== 'available',
  )
  return (
    <Block
      title="الورشة حسب الغرض"
      en="Workshop by purpose"
      density={density}
      action={<ViewAll />}
    >
      <SoftDonut
        ariaLabel="المعدات في الورشة حسب الغرض"
        centerLabel="في الورشة"
        height={density.donutHeight}
        legend="side"
        slices={slices.map((state) => ({
          id: state.id,
          label: state.label,
          value: state.count,
          color: `var(--chart-${state.shade})`,
          strokeColor: `var(--chart-stroke-${state.shade})`,
        }))}
      />
      <p
        className={cn(
          'mt-2 flex items-center gap-1.5 border-t pt-2 text-muted',
          density.text,
        )}
      >
        <AlertTriangle size={14} aria-hidden="true" className="text-danger" />
        خارج الخدمة اكثر من 30 يوم:
        <span className="font-semibold tabular-nums text-fg">2</span>
      </p>
    </Block>
  )
}

// --- (4) the dense tables and lists ----------------------------------------

function MovementsCard({ density }: { density: Density }) {
  const columns: DataTableColumn<Movement>[] = [
    {
      // The type with its time under it: three columns fit a third.
      key: 'type',
      header: 'الحركة',
      // Arabic like the rest of the mockup (the real page uses MovementBadge,
      // whose label follows the app language).
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <Badge
            size="sm"
            tone={row.type}
            icon={
              row.type === 'entry' ? (
                <LogIn size={11} aria-hidden="true" />
              ) : (
                <LogOut size={11} aria-hidden="true" />
              )
            }
          >
            {row.type === 'entry' ? 'دخول' : 'خروج'}
          </Badge>
          <span className="text-[11px] leading-4 tabular-nums text-muted">
            {row.time}
          </span>
        </span>
      ),
    },
    {
      key: 'unit',
      header: 'المعدة',
      cell: (row) => (
        <span className="block">
          <span className="font-semibold" dir="ltr">
            {row.code}
          </span>
          <span className="block text-[11px] leading-4 text-muted" dir="ltr">
            {row.unit}
          </span>
        </span>
      ),
    },
    {
      // The project with its driver under it: four columns fit a third.
      key: 'place',
      header: 'المشروع',
      cell: (row) =>
        row.workshop ? (
          <Badge size="sm" tone="neutral">
            الورشة
          </Badge>
        ) : (
          <span className="block">
            <span className="block">{row.place}</span>
            <span className="block text-[11px] leading-4 text-muted">
              {row.driver}
            </span>
          </span>
        ),
    },
  ]
  return (
    <Block
      title="اخر الحركات"
      en="Latest gate movements"
      density={density}
      action={<ViewAll />}
    >
      <DataTable
        size={density.tableSize}
        columns={columns}
        rows={MOVEMENTS.slice(0, density.rows)}
        rowKey={(row) => row.id}
        caption="اخر الحركات"
        stickyHeader={false}
        cellTextClassName={density.text}
        cellClassName={density.cellPad}
        onRowClick={() => undefined}
      />
    </Block>
  )
}

function AttentionCard({ density }: { density: Density }) {
  return (
    <Block
      title="يحتاج انتباهك"
      en="Needs attention"
      density={density}
      action={
        <Badge size="sm" tone="danger" className="tabular-nums">
          {ATTENTION.length}
        </Badge>
      }
    >
      <ul className="divide-y">
        {ATTENTION.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                density.rowPad,
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  color: `var(--${item.tone})`,
                  backgroundColor: `var(--${item.tone}-soft)`,
                }}
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'truncate-safe block font-medium',
                    density.text,
                  )}
                >
                  {item.label}
                </span>
                <span className="truncate-safe block text-[11px] leading-4 text-muted">
                  {item.area} · {item.detail}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <Badge size="sm" tone={item.tone} className="tabular-nums">
                  {item.count}
                </Badge>
                <span className="text-[10px] leading-3 text-muted">
                  {item.age}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Block>
  )
}

type SideTab = 'workshop' | 'suppliers'

function WorkshopSuppliersCard({ density }: { density: Density }) {
  const [tab, setTab] = useState<SideTab>('workshop')
  const columns: DataTableColumn<WorkshopRow>[] = [
    {
      key: 'code',
      header: 'المعدة',
      cell: (row) => (
        <span className="block">
          <span className="font-semibold" dir="ltr">
            {row.code}
          </span>
          <span className="block text-[11px] leading-4 text-muted" dir="ltr">
            {row.type}
          </span>
        </span>
      ),
    },
    {
      key: 'purpose',
      header: 'الغرض',
      cell: (row) =>
        row.purpose ? (
          <Badge
            size="sm"
            tone={workshopPurposeTone(row.purpose)}
            icon={PURPOSE_ICON[row.purpose]}
          >
            {PURPOSE_LABEL[row.purpose]}
          </Badge>
        ) : (
          <Badge size="sm" tone="neutral">
            غير مصنفة
          </Badge>
        ),
    },
    {
      key: 'since',
      header: 'منذ',
      align: 'end',
      cell: (row) => <span className="text-muted">{row.since}</span>,
    },
  ]
  const supplierTotal = sum(SUPPLIERS.map((row) => row.count))
  const supplierMax = Math.max(...SUPPLIERS.map((row) => row.count))
  return (
    <Block
      title={tab === 'workshop' ? 'في الورشة الان' : 'الموردون في المشاريع'}
      en={tab === 'workshop' ? 'Open workshop visits' : 'Suppliers on projects'}
      density={density}
      action={<ViewAll />}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as SideTab)}>
        <TabsList
          variant="segmented"
          aria-label="الورشة او الموردون"
          className="mb-2"
        >
          <TabsTrigger value="workshop">
            الورشة{' '}
            <span className="ms-1 tabular-nums text-muted">{IN_WORKSHOP}</span>
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            الموردون{' '}
            <span className="ms-1 tabular-nums text-muted">
              {supplierTotal}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'workshop' ? (
        <DataTable
          size={density.tableSize}
          columns={columns}
          rows={WORKSHOP_ROWS.slice(0, density.rows)}
          rowKey={(row) => row.code}
          caption="في الورشة الان"
          stickyHeader={false}
          cellTextClassName={density.text}
          cellClassName={density.cellPad}
          onRowClick={() => undefined}
        />
      ) : (
        <ul className="space-y-2">
          {SUPPLIERS.map((row) => (
            <BarRow
              key={row.id}
              label={row.label}
              value={row.count}
              share={shareOf(row.count, supplierTotal)}
              width={(row.count / supplierMax) * 100}
              shade={4}
              density={density}
            />
          ))}
        </ul>
      )}
    </Block>
  )
}

function BarRow({
  label,
  value,
  share,
  width,
  shade,
  density,
  labelDir,
}: {
  label: string
  value: number
  share: string
  width: number
  shade: number
  density: Density
  labelDir?: 'ltr'
}) {
  return (
    <li className={cn('flex items-center gap-2', density.text)}>
      <span className="truncate-safe w-28 shrink-0 text-start" dir={labelDir}>
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: deepTint(
              `var(--chart-${shade})`,
              `var(--chart-stroke-${shade})`,
            ),
          }}
        />
      </span>
      <span className="w-8 shrink-0 text-end font-semibold tabular-nums">
        {value}
      </span>
      <span className="w-9 shrink-0 text-end tabular-nums text-muted">
        {share}
      </span>
    </li>
  )
}

// --- (5) the bottom row ----------------------------------------------------

function AvailabilityCard({ density }: { density: Density }) {
  const max = Math.max(
    ...TYPES.map((row) => row.projects + row.workshop + row.available),
  )
  const parts = [
    { key: 'projects', label: 'في المشاريع', shade: 1 },
    { key: 'workshop', label: 'الورشة', shade: 2 },
    { key: 'available', label: 'متاحة', shade: 6 },
  ] as const
  return (
    <Block
      title="التوفر حسب النوع"
      en="Availability by type"
      density={density}
      action={<ViewAll />}
    >
      <ul className={density.gap === 'gap-4' ? 'space-y-2.5' : 'space-y-1.5'}>
        {TYPES.map((row) => {
          const total = row.projects + row.workshop + row.available
          return (
            <li
              key={row.id}
              className={cn('flex items-center gap-2', density.text)}
            >
              <span
                className="truncate-safe w-28 shrink-0 text-start"
                dir={row.id === 'others' ? undefined : 'ltr'}
              >
                {row.label}
              </span>
              <span
                aria-hidden="true"
                className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
              >
                <span
                  className="flex h-full gap-px"
                  style={{ width: `${(total / max) * 100}%` }}
                >
                  {parts.map((part) => (
                    <span
                      key={part.key}
                      className="block h-full first:rounded-s-full last:rounded-e-full"
                      style={{
                        width: `${(row[part.key] / total) * 100}%`,
                        backgroundColor: deepTint(
                          `var(--chart-${part.shade})`,
                          `var(--chart-stroke-${part.shade})`,
                        ),
                      }}
                    />
                  ))}
                </span>
              </span>
              <span className="w-8 shrink-0 text-end font-semibold tabular-nums">
                {row.available}
              </span>
              <span className="w-9 shrink-0 text-end tabular-nums text-muted">
                {shareOf(row.available, total)}
              </span>
            </li>
          )
        })}
      </ul>
      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="block h-2 w-2 rounded-full"
              style={{ backgroundColor: `var(--chart-stroke-${part.shade})` }}
            />
            {part.label}
          </li>
        ))}
        <li className="ms-auto">الرقم: المتاحة من النوع</li>
      </ul>
    </Block>
  )
}

function AfaqyCard({ density }: { density: Density }) {
  const cells: {
    label: string
    value: number
    tone: BadgeTone
    icon: ReactNode
  }[] = [
    {
      label: 'مربوطة',
      value: AFAQY.linked,
      tone: 'neutral',
      icon: <Radio size={14} />,
    },
    {
      label: 'متصلة',
      value: AFAQY.connected,
      tone: 'success',
      icon: <CheckCircle2 size={14} />,
    },
    {
      label: 'غير متصلة',
      value: AFAQY.notConnected,
      tone: 'warning',
      icon: <WifiOff size={14} />,
    },
    {
      label: 'بدون اشارة',
      value: AFAQY.noSignal,
      tone: 'danger',
      icon: <Ban size={14} />,
    },
  ]
  const segments = [
    { id: 'connected', value: AFAQY.connected, tone: 'success' },
    { id: 'notConnected', value: AFAQY.notConnected, tone: 'warning' },
    { id: 'noSignal', value: AFAQY.noSignal, tone: 'danger' },
  ]
  return (
    <Block
      title="التتبع في افاقي"
      en="Afaqy tracking · last 24 h"
      density={density}
      action={<ViewAll />}
    >
      <ul className="grid grid-cols-2 gap-1.5">
        {cells.map((cell) => (
          <li
            key={cell.label}
            className={cn(
              'flex items-center gap-2 rounded-lg bg-surface px-2',
              density.rowPad,
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={
                cell.tone === 'neutral'
                  ? {
                      color: 'var(--muted)',
                      backgroundColor: 'var(--surface-hover)',
                    }
                  : {
                      color: `var(--${cell.tone})`,
                      backgroundColor: `var(--${cell.tone}-soft)`,
                    }
              }
            >
              {cell.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight tabular-nums">
                <CountUp value={cell.value} />
              </span>
              <span className="block text-[11px] leading-3 text-muted">
                {cell.label}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div
        aria-hidden="true"
        className="mt-2.5 flex h-2 gap-px overflow-hidden rounded-full"
      >
        {segments.map((segment) => (
          <span
            key={segment.id}
            style={{
              width: `${(segment.value / AFAQY.linked) * 100}%`,
              // Light fills, never the saturated tone itself.
              backgroundColor: deepTint(
                `var(--${segment.tone}-soft)`,
                `var(--${segment.tone})`,
              ),
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        متصلة {shareOf(AFAQY.connected, AFAQY.linked)} من المربوطة
      </p>
      <ul className={cn('mt-2 divide-y border-t', density.text)}>
        {AFAQY_LONGEST.map((row) => (
          <li key={row.code} className="flex items-center justify-between py-1">
            <span className="font-semibold" dir="ltr">
              {row.code}
            </span>
            <span className="text-muted">اخر اشارة منذ {row.last}</span>
          </li>
        ))}
      </ul>
    </Block>
  )
}

function EntriesCard({ density }: { density: Density }) {
  const entries = sum(ENTRIES_30)
  const exits = sum(EXITS_30)
  return (
    <Block
      title="الدخول والخروج اليومي"
      en="Daily entries and exits"
      density={density}
      action={<PeriodSelect label="فترة الدخول والخروج" />}
    >
      <div className={cn('mb-1 flex flex-wrap gap-x-4 gap-y-1', density.text)}>
        <span>
          <span className="text-muted">دخول </span>
          <span className="font-bold tabular-nums">
            <CountUp value={entries} />
          </span>
        </span>
        <span>
          <span className="text-muted">خروج </span>
          <span className="font-bold tabular-nums">
            <CountUp value={exits} />
          </span>
        </span>
        <span className="text-muted">
          متوسط اليوم {Math.round(entries / 30)}
        </span>
      </div>
      <SoftAreaChart
        ariaLabel="الدخول والخروج في اخر 30 يوم"
        points={DAYS_30}
        entriesLabel="دخول"
        exitsLabel="خروج"
        showExits
        height={density.areaHeight}
      />
    </Block>
  )
}

// --- the page --------------------------------------------------------------

function Dashboard({ variant }: { variant: Variant }) {
  const density = DENSITY[variant]
  return (
    <div
      className={cn(
        'rounded-2xl bg-surface p-3 sm:p-4',
        variant === 'compact' ? 'space-y-2.5' : 'space-y-4',
      )}
    >
      <Greeting density={density} />
      <div className={cn('grid', density.kpiCols, density.gap)}>
        {KPIS.map((kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} density={density} />
        ))}
      </div>
      <div className={cn('grid', density.threeCols, density.gap)}>
        <FleetStateCard density={density} />
        <TopProjectsCard density={density} />
        <WorkshopPurposeCard density={density} />
      </div>
      <div className={cn('grid', density.threeCols, density.gap)}>
        <MovementsCard density={density} />
        <AttentionCard density={density} />
        <WorkshopSuppliersCard density={density} />
      </div>
      <div className={cn('grid', density.threeCols, density.gap)}>
        <AvailabilityCard density={density} />
        <AfaqyCard density={density} />
        <EntriesCard density={density} />
      </div>
    </div>
  )
}

export function HomeDashboardV2Mockup() {
  const [variant, setVariant] = useState<Variant>('compact')
  const current = VARIANTS.find((item) => item.id === variant) ?? VARIANTS[0]
  return (
    <div className="space-y-4">
      {/* Mockup controls, not part of the page. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted">النسخة:</span>
        <Tabs
          value={variant}
          onValueChange={(value) => setVariant(value as Variant)}
        >
          <TabsList variant="segmented" aria-label="نسخة الرئيسية">
            {VARIANTS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted">{current.note}</span>
      </div>
      <Dashboard variant={variant} />
      <p className="text-xs text-muted">
        بيانات عينة. الشريط الصغير في كل مربع: اخر 14 يوم. الاسهم: مقارنة بقبل 7
        ايام.
      </p>
    </div>
  )
}
