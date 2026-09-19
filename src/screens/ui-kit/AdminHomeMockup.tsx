import { useMemo, useState } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import {
  Badge,
  Button,
  DataTable,
  DateRangeFilter,
  MovementBadge,
  SearchInput,
  StatCard,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
} from '@/components/ui'
import type { DataTableColumn, DateRangeValue } from '@/components/ui'
import { MiniTable, MiniTableGrid } from '@/components/ui/MiniTable'
import { AttentionList } from '@/components/home/AttentionList'
import type { AttentionItem } from '@/components/home/AttentionList'
import { CollapsibleSection } from '@/components/home/CollapsibleSection'
import { FleetNowExplorer } from '@/components/home/FleetNowExplorer'
import type { FleetStateCategory } from '@/components/home/FleetNowExplorer'
import { HorizontalBarList } from '@/components/charts'
import { EntriesLineChart } from '@/components/charts/lazy'
import type { EntriesLinePoint } from '@/components/charts/lazy'
import {
  buildChartBuckets,
  chartBucketLabel,
  chartBucketRangeLabel,
  type ChartBucket,
  type ChartBucketUnit,
} from '@/lib/chartBuckets'
import { saudiDateKey, saudiPeriodKeys } from '@/lib/saudiTime'

// Admin home mockup v3 for owner review on /ui-kit, applying the owner's
// review of v2 (2026-09-19): the movement bar chart is gone, entries are a
// line chart whose granularity follows the period, the fleet donut drills in
// both directions, the main tables use 44 px rows, and the smaller lists are
// one-third-wide mini tables. Every number below is demo data held in this
// file: the mockup never calls Supabase and never changes a real screen.

export type MockLang = 'ar' | 'en'
export type MockState = 'ready' | 'loading' | 'error'

type Bi = Record<MockLang, string>
const bi = (ar: string, en: string): Bi => ({ ar, en })

const COPY = {
  ar: {
    // 0 — toolbar
    toolbarTitle: 'لوحة التحكم',
    toolbarDescription:
      'الاجراءات السريعة وفلتر فترة واحد يتحكم في الاقسام الزمنية.',
    registerEntry: 'تسجيل دخول',
    registerExit: 'تسجيل خروج',
    periodLabel: 'الفترة',
    periodNote: 'يؤثر على الاقسام الزمنية فقط. اقسام «الان» لا تتغير.',
    nowScoped: 'الان',
    // 1 — pulse
    pulseTitle: 'نبض اليوم',
    pulseDescription: 'ارقام اليوم مقارنة بامس.',
    entriesToday: 'دخول اليوم',
    exitsToday: 'خروج اليوم',
    insideSitesNow: 'داخل المواقع الان',
    inWorkshopNow: 'في الورشة الان',
    outsideAvailable: 'خارج / متاحة',
    vsYesterday: 'مقارنة بامس',
    // 2 — entries line chart
    flowTitle: 'حركة الدخول',
    flowDescription:
      'عدد الدخوليات خلال الفترة. التقسيم يتبع طول الفترة: السنة تعرض شهورا، والشهر يعرض ايامه، والفترة المخصصة تختار ايام او اسابيع او شهور حسب طولها.',
    flowThisYear: 'هذه السنة',
    flowThisMonth: 'هذا الشهر',
    flowCustom: 'مخصص',
    flowShowExits: 'اظهار الخروج',
    flowAria: 'الدخول والخروج خلال الفترة',
    entries: 'دخول',
    exits: 'خروج',
    unitDay: 'يومي',
    unitWeek: 'اسبوعي',
    unitMonth: 'شهري',
    // 3 — fleet now
    fleetNowTitle: 'اين الاسطول الان',
    fleetNowDescription:
      'توزيع المعدات في هذه اللحظة. اختر مالكا لتصفية التوزيع، او اضغط شريحة لعرضها حسب المالك.',
    insideSites: 'داخل المواقع',
    workshopMaintenance: 'ورشة صيانة',
    workshopParking: 'ورشة وقوف',
    outside: 'خارج المواقع',
    fleetTotal: 'معدة',
    fleetAllOwners: 'الكل',
    fleetOwnerFilter: 'تصفية حسب المالك',
    fleetDrillHint: 'اضغط على شريحة لعرض توزيعها حسب المالك.',
    fleetStateAria: 'توزيع الاسطول الان',
    fleetOwnerAriaPrefix: 'حسب المالك',
    back: 'رجوع',
    // 4 — idle
    idleTitle: 'المعدات بلا حركة',
    idleDescription:
      'اطول المعدات بلا اي حركة مسجلة. المعدات بلا اي تاريخ حركة مميزة باللون الاحمر.',
    idleCaption: 'المعدات بلا حركة',
    colEquipment: 'المعدة',
    colType: 'النوع',
    colOwner: 'المالك',
    colLastMovement: 'اخر حركة',
    colDays: 'عدد الايام',
    exitedOn: 'خروج بتاريخ',
    noMovementEver: 'لا يوجد تاريخ',
    filterByType: 'النوع',
    filterByOwner: 'المالك',
    all: 'الكل',
    dayUnit: 'يوم',
    viewAll: 'عرض الكل',
    // 5 — availability
    availabilityTitle: 'التوفر حسب النوع',
    availabilityDescription:
      'كل رقم مقسوم الى ملك ومستاجر. الجدول الثاني يعرض نفس الاعمدة حسب المالك.',
    availabilityByType: 'حسب النوع',
    availabilityByOwner: 'حسب المالك',
    searchTypePlaceholder: 'ابحث في الانواع',
    colTotal: 'الاجمالي',
    colInside: 'داخل المواقع',
    colWorkshop: 'في الورشة',
    colAvailable: 'متاح',
    owned: 'ملك',
    rented: 'مستاجر',
    noTypeMatch: 'لا يوجد نوع مطابق',
    // 6 — attention
    attentionTitle: 'يحتاج انتباهك',
    attentionDescription: 'حالات تحتاج قرارا او استكمال بيانات.',
    attnLongStay: 'في الورشة اكثر من 14 يوم',
    attnLongStayHint: 'دخول ورشة بلا خروج حتى الان',
    attnUnclassified: 'دخوليات ورشة بلا تصنيف',
    attnUnclassifiedHint: 'لم يحدد لها صيانة او وقوف',
    attnExpiring: 'تسجيل او تامين ينتهي خلال 30 يوم',
    attnExpiringHint: 'استمارة او وثيقة تامين قاربت على الانتهاء',
    attnIncomplete: 'بيانات معدات ناقصة',
    attnIncompleteHint: 'معدات تم انشاؤها سريعا وتنتظر مراجعة الادمن',
    // 7 — latest movements
    latestTitle: 'اخر الحركات',
    latestDescription: 'اخر 10 حركات في المواقع والورشة معا.',
    colContext: 'السياق',
    colStatus: 'الحالة',
    colWhere: 'الموقع / الغرض',
    colWhen: 'التاريخ',
    siteChip: 'موقع',
    workshopChip: 'ورشة',
    noMovements: 'لا توجد حركات',
    // 8 — fleet breakdown
    fleetTitle: 'الاسطول',
    fleetDescription: 'توزيع المعدات حسب النوع او المالك او النشاط.',
    fleetByType: 'النوع',
    fleetByOwner: 'المالك',
    fleetByActivity: 'النشاط',
    activeEquipment: 'نشطة (حركة خلال 90 يوم)',
    inactiveEquipment: 'غير نشطة',
    fleetTypesAria: 'اكثر عشرة انواع معدات',
    fleetOwnersAria: 'المعدات حسب المالك',
    fleetActivityAria: 'المعدات حسب النشاط',
    // 9 — workshop
    workshopTitle: 'الورشة',
    workshopDescription: 'حالة الورشة في هذه اللحظة.',
    maintenanceNow: 'صيانة الان',
    parkingNow: 'وقوف الان',
    avgStay: 'متوسط مدة البقاء',
    // 10 — users
    usersTitle: 'المستخدمون',
    usersDescription: 'من يعمل اليوم.',
    activeToday: 'مستخدمون نشطون اليوم',
    editsToday: 'تعديلات اليوم',
    // 11 — mini tables
    companiesTitle: 'الشركات والمشاريع',
    companiesDescription: 'اكثر خمس شركات نشاطا.',
    colCompanyProject: 'الشركة / المشروع',
    colEquipmentNow: 'داخلها الان',
    foremenTitle: 'الفورمين',
    foremenDescription: 'نشاط مسجلي الحركات.',
    colForeman: 'الفورمان',
    colPeriodMovements: 'حركات الفترة',
    noActivity7: 'بلا نشاط 7 ايام',
    longestInWorkshop: 'اطول بقاء في الورشة',
    longestInWorkshopDescription: 'اطول خمس معدات بقاء داخل الورشة الان.',
    colPurpose: 'الغرض',
    colStayDays: 'المدة',
    qualityTitle: 'جودة البيانات',
    qualityDescription: 'نواقص تؤثر على دقة التقارير.',
    colCheck: 'الفحص',
    colCount: 'العدد',
    qualityNoPlate: 'معدات بلا لوحة او شاصي',
    qualityNoMobile: 'سائقون بلا جوال',
    qualityFewPhotos: 'حركات ورشة باقل من 3 صور',
    qualityQuickCreate: 'معدات الاضافة السريعة تنتظر مراجعة',
    auditTitle: 'التدقيق',
    auditDescription: 'اخر خمسة تعديلات على الحركات.',
    colWhat: 'التعديل',
    colEditedAt: 'متى',
  },
  en: {
    toolbarTitle: 'Command dashboard',
    toolbarDescription:
      'Quick actions and one period filter driving the time-based sections.',
    registerEntry: 'Register entry',
    registerExit: 'Register exit',
    periodLabel: 'Period',
    periodNote:
      'Affects time-based sections only. "Now" sections never change.',
    nowScoped: 'Now',
    pulseTitle: "Today's pulse",
    pulseDescription: "Today's numbers compared with yesterday.",
    entriesToday: 'Entries today',
    exitsToday: 'Exits today',
    insideSitesNow: 'Inside sites now',
    inWorkshopNow: 'In the workshop now',
    outsideAvailable: 'Outside / available',
    vsYesterday: 'vs yesterday',
    flowTitle: 'Entry flow',
    flowDescription:
      'Entries over the period. Granularity follows the length: a year shows months, a month shows its days, and a custom range picks days, weeks or months by length.',
    flowThisYear: 'This year',
    flowThisMonth: 'This month',
    flowCustom: 'Custom',
    flowShowExits: 'Show exits',
    flowAria: 'Entries and exits over the period',
    entries: 'Entries',
    exits: 'Exits',
    unitDay: 'Daily',
    unitWeek: 'Weekly',
    unitMonth: 'Monthly',
    fleetNowTitle: 'Where the fleet is now',
    fleetNowDescription:
      'Every unit, at this moment. Pick an owner to filter, or click a slice to see it split by owner.',
    insideSites: 'Inside sites',
    workshopMaintenance: 'Workshop maintenance',
    workshopParking: 'Workshop standby',
    outside: 'Outside sites',
    fleetTotal: 'units',
    fleetAllOwners: 'All',
    fleetOwnerFilter: 'Filter by owner',
    fleetDrillHint: 'Click a slice to see it split by owner.',
    fleetStateAria: 'Fleet distribution now',
    fleetOwnerAriaPrefix: 'by owner',
    back: 'Back',
    idleTitle: 'Equipment with no movement',
    idleDescription:
      'Longest-idle units first. Units with no movement at all are marked in red.',
    idleCaption: 'Equipment with no movement',
    colEquipment: 'Equipment',
    colType: 'Type',
    colOwner: 'Owner',
    colLastMovement: 'Last movement',
    colDays: 'Days',
    exitedOn: 'Exit on',
    noMovementEver: 'No date',
    filterByType: 'Type',
    filterByOwner: 'Owner',
    all: 'All',
    dayUnit: 'days',
    viewAll: 'View all',
    availabilityTitle: 'Availability by type',
    availabilityDescription:
      'Every number is split into owned and rented. The second table shows the same columns by owner.',
    availabilityByType: 'By type',
    availabilityByOwner: 'By owner',
    searchTypePlaceholder: 'Search types',
    colTotal: 'Total',
    colInside: 'Inside sites',
    colWorkshop: 'In workshop',
    colAvailable: 'Available',
    owned: 'Owned',
    rented: 'Rented',
    noTypeMatch: 'No matching type',
    attentionTitle: 'Needs your attention',
    attentionDescription: 'Cases waiting for a decision or missing data.',
    attnLongStay: 'In the workshop over 14 days',
    attnLongStayHint: 'Workshop entry with no exit so far',
    attnUnclassified: 'Workshop entries without a classification',
    attnUnclassifiedHint: 'No maintenance or standby set',
    attnExpiring: 'Registration or insurance expiring within 30 days',
    attnExpiringHint: 'Registration card or insurance close to expiry',
    attnIncomplete: 'Incomplete equipment records',
    attnIncompleteHint: 'Quick-created equipment waiting for admin review',
    latestTitle: 'Latest movements',
    latestDescription: 'The last 10 movements across sites and workshop.',
    colContext: 'Context',
    colStatus: 'Status',
    colWhere: 'Location / purpose',
    colWhen: 'Date',
    siteChip: 'Site',
    workshopChip: 'Workshop',
    noMovements: 'No movements',
    fleetTitle: 'Fleet',
    fleetDescription: 'Units by type, owner, or activity.',
    fleetByType: 'Type',
    fleetByOwner: 'Owner',
    fleetByActivity: 'Activity',
    activeEquipment: 'Active (moved within 90 days)',
    inactiveEquipment: 'Inactive',
    fleetTypesAria: 'Top ten equipment types',
    fleetOwnersAria: 'Equipment by owner',
    fleetActivityAria: 'Equipment by activity',
    workshopTitle: 'Workshop',
    workshopDescription: 'The workshop at this moment.',
    maintenanceNow: 'Maintenance now',
    parkingNow: 'Standby now',
    avgStay: 'Average stay',
    usersTitle: 'Users',
    usersDescription: 'Who is working today.',
    activeToday: 'Users active today',
    editsToday: 'Edits today',
    companiesTitle: 'Companies and projects',
    companiesDescription: 'The five busiest companies.',
    colCompanyProject: 'Company / project',
    colEquipmentNow: 'Inside now',
    foremenTitle: 'Foremen',
    foremenDescription: 'Who recorded movements.',
    colForeman: 'Foreman',
    colPeriodMovements: 'Movements',
    noActivity7: 'No activity for 7 days',
    longestInWorkshop: 'Longest workshop stays',
    longestInWorkshopDescription:
      'The five units that have been in the workshop longest.',
    colPurpose: 'Purpose',
    colStayDays: 'Stay',
    qualityTitle: 'Data quality',
    qualityDescription: 'Gaps that affect report accuracy.',
    colCheck: 'Check',
    colCount: 'Count',
    qualityNoPlate: 'Units with no plate or chassis',
    qualityNoMobile: 'Drivers with no mobile number',
    qualityFewPhotos: 'Workshop movements with under 3 photos',
    qualityQuickCreate: 'Quick-created equipment awaiting review',
    auditTitle: 'Audit',
    auditDescription: 'The last five movement edits.',
    colWhat: 'Edit',
    colEditedAt: 'When',
  },
}

type Copy = typeof COPY.ar

// ---------------------------------------------------------------------------
// Demo data: a fleet of 812 units. Every breakdown below adds up to that
// total, and the fleet matrix is the single source the totals derive from.
// ---------------------------------------------------------------------------

const TYPES: Bi[] = [
  bi('صهريج ماء', 'Water tanker'),
  bi('حفار', 'Excavator'),
  bi('شيول', 'Loader'),
  bi('قلاب', 'Dump truck'),
  bi('بوكلين', 'Backhoe'),
  bi('رافعة شوكية', 'Forklift'),
  bi('ونش', 'Boom truck'),
  bi('جريدر', 'Grader'),
  bi('كومبريسر', 'Compressor'),
  bi('مولد كهرباء', 'Generator'),
]

const OWNER_IDS = ['azani', 'takween', 'f', 'b', 'external'] as const

const OWNERS: Bi[] = [
  bi('العزاني', 'Al-Azani'),
  bi('تكوين', 'Takween'),
  bi('طرف ثالث F', 'Third party F'),
  bi('طرف ثالث B', 'Third party B'),
  bi('مورد خارجي', 'External supplier'),
]

/**
 * Units per owner and per state, right now. The states are data everywhere
 * they are used, so a future state ("ورشة عامة" and so on) only needs a new
 * key here plus a new entry in `fleetStates()` below.
 */
const FLEET_MATRIX: Record<string, Record<string, number>> = {
  azani: { inside: 248, maintenance: 48, parking: 31, outside: 75 },
  takween: { inside: 104, maintenance: 20, parking: 13, outside: 31 },
  f: { inside: 64, maintenance: 13, parking: 8, outside: 19 },
  b: { inside: 47, maintenance: 9, parking: 6, outside: 14 },
  external: { inside: 35, maintenance: 6, parking: 5, outside: 16 },
}

const fleetCount = (ownerId: string, stateId: string) =>
  FLEET_MATRIX[ownerId]?.[stateId] ?? 0

const fleetStateTotal = (stateId: string) =>
  OWNER_IDS.reduce((sum, id) => sum + fleetCount(id, stateId), 0)

const INSIDE_SITES = fleetStateTotal('inside')
const WORKSHOP_MAINTENANCE = fleetStateTotal('maintenance')
const WORKSHOP_PARKING = fleetStateTotal('parking')
const OUTSIDE = fleetStateTotal('outside')
// The donut's middle number is the sum of whatever slices it is showing, so a
// filtered view reports that owner's total instead of the whole 812.

/** State categories, coloured with tokens. Order drives the donut. */
function fleetStates(copy: Copy): FleetStateCategory[] {
  return [
    { id: 'inside', label: copy.insideSites, color: 'var(--entry)' },
    {
      id: 'maintenance',
      label: copy.workshopMaintenance,
      color: 'var(--exit)',
    },
    { id: 'parking', label: copy.workshopParking, color: 'var(--info)' },
    { id: 'outside', label: copy.outside, color: 'var(--muted)' },
  ]
}

/** [total, inside sites, in workshop, available] */
type Counts = [number, number, number, number]

type AvailabilityRow = {
  id: string
  label: Bi
  all: Counts
  /** The owned (Al-Azani) share of the same four columns. */
  owned: Counts
}

const AVAILABILITY_BY_TYPE: AvailabilityRow[] = [
  {
    id: 'tanker',
    label: TYPES[0],
    all: [128, 82, 24, 22],
    owned: [62, 38, 11, 13],
  },
  {
    id: 'excavator',
    label: TYPES[1],
    all: [96, 58, 20, 18],
    owned: [51, 31, 11, 9],
  },
  {
    id: 'loader',
    label: TYPES[2],
    all: [88, 54, 18, 16],
    owned: [44, 28, 9, 7],
  },
  {
    id: 'dump',
    label: TYPES[3],
    all: [142, 96, 26, 20],
    owned: [70, 46, 13, 11],
  },
  {
    id: 'backhoe',
    label: TYPES[4],
    all: [74, 46, 15, 13],
    owned: [38, 23, 8, 7],
  },
  {
    id: 'forklift',
    label: TYPES[5],
    all: [58, 34, 12, 12],
    owned: [30, 18, 6, 6],
  },
  { id: 'boom', label: TYPES[6], all: [52, 31, 11, 10], owned: [27, 17, 5, 5] },
  {
    id: 'grader',
    label: TYPES[7],
    all: [46, 28, 10, 8],
    owned: [23, 14, 5, 4],
  },
  {
    id: 'compressor',
    label: TYPES[8],
    all: [68, 42, 14, 12],
    owned: [33, 21, 7, 5],
  },
  {
    id: 'generator',
    label: TYPES[9],
    all: [60, 27, 9, 24],
    owned: [24, 12, 4, 8],
  },
]

// Derived from the same matrix as the donut, so the two can never disagree.
// Ownership is derived, not edited: Al-Azani is owned, every other
// classification is rented (AGENTS.md, equipment ownership).
const AVAILABILITY_BY_OWNER: AvailabilityRow[] = OWNER_IDS.map((id, index) => {
  const cells = FLEET_MATRIX[id]
  const all: Counts = [
    cells.inside + cells.maintenance + cells.parking + cells.outside,
    cells.inside,
    cells.maintenance + cells.parking,
    cells.outside,
  ]
  return {
    id,
    label: OWNERS[index],
    all,
    owned: id === 'azani' ? all : [0, 0, 0, 0],
  }
})

type IdleRow = {
  id: string
  code: string
  type: Bi
  owner: Bi
  /** `null` means the unit has never had a movement recorded. */
  lastExit: string | null
  days: number
}

const IDLE_ROWS: IdleRow[] = [
  {
    id: 'i1',
    code: 'B-24',
    type: TYPES[4],
    owner: OWNERS[3],
    lastExit: null,
    days: 412,
  },
  {
    id: 'i2',
    code: 'U017',
    type: TYPES[9],
    owner: OWNERS[4],
    lastExit: null,
    days: 388,
  },
  {
    id: 'i3',
    code: 'F-131',
    type: TYPES[3],
    owner: OWNERS[2],
    lastExit: '12/03/2026',
    days: 191,
  },
  {
    id: 'i4',
    code: 'A-745',
    type: TYPES[0],
    owner: OWNERS[0],
    lastExit: '28/03/2026',
    days: 175,
  },
  {
    id: 'i5',
    code: 'TK-402',
    type: TYPES[2],
    owner: OWNERS[1],
    lastExit: '19/04/2026',
    days: 153,
  },
  {
    id: 'i6',
    code: 'A-318',
    type: TYPES[1],
    owner: OWNERS[0],
    lastExit: '02/05/2026',
    days: 140,
  },
  {
    id: 'i7',
    code: 'U009',
    type: TYPES[8],
    owner: OWNERS[4],
    lastExit: null,
    days: 132,
  },
  {
    id: 'i8',
    code: 'B-61',
    type: TYPES[5],
    owner: OWNERS[3],
    lastExit: '30/05/2026',
    days: 112,
  },
  {
    id: 'i9',
    code: 'F-77',
    type: TYPES[7],
    owner: OWNERS[2],
    lastExit: '21/06/2026',
    days: 90,
  },
  {
    id: 'i10',
    code: 'TK-118',
    type: TYPES[6],
    owner: OWNERS[1],
    lastExit: '14/07/2026',
    days: 67,
  },
  {
    id: 'i11',
    code: 'A-902',
    type: TYPES[3],
    owner: OWNERS[0],
    lastExit: '05/08/2026',
    days: 45,
  },
  {
    id: 'i12',
    code: 'A-533',
    type: TYPES[0],
    owner: OWNERS[0],
    lastExit: '26/08/2026',
    days: 24,
  },
]

type CompanyRow = { id: string; label: Bi; now: number }

const COMPANY_ROWS: CompanyRow[] = [
  {
    id: 'c1',
    label: bi('مقاولات الخليج · الرياض', 'Gulf Contracting · Riyadh'),
    now: 128,
  },
  { id: 'c2', label: bi('شركة النخبة · جدة', 'Elite Co. · Jeddah'), now: 96 },
  {
    id: 'c3',
    label: bi('مقاولات الشرق · الدمام', 'East Contracting · Dammam'),
    now: 84,
  },
  {
    id: 'c4',
    label: bi('البناء الحديث · الخبر', 'Modern Build · Khobar'),
    now: 61,
  },
  {
    id: 'c5',
    label: bi('مجموعة الاعمار · القصيم', 'Emaar Group · Qassim'),
    now: 47,
  },
]

type ForemanRow = {
  id: string
  name: Bi
  movements: number
  stale: boolean
}

const FOREMAN_ROWS: ForemanRow[] = [
  {
    id: 'f1',
    name: bi('سعد العمري', 'Saad Al-Amri'),
    movements: 142,
    stale: false,
  },
  {
    id: 'f2',
    name: bi('راشد الحربي', 'Rashed Al-Harbi'),
    movements: 118,
    stale: false,
  },
  {
    id: 'f3',
    name: bi('محمد الزهراني', 'Mohammed Al-Zahrani'),
    movements: 96,
    stale: false,
  },
  {
    id: 'f4',
    name: bi('عمر السالم', 'Omar Al-Salem'),
    movements: 74,
    stale: false,
  },
  {
    id: 'f5',
    name: bi('فهد القحطاني', 'Fahd Al-Qahtani'),
    movements: 12,
    stale: true,
  },
]

type WorkshopStayRow = {
  id: string
  code: string
  purpose: 'maintenance' | 'parking'
  days: number
}

const WORKSHOP_STAYS: WorkshopStayRow[] = [
  { id: 'ws1', code: 'A-217', purpose: 'maintenance', days: 63 },
  { id: 'ws2', code: 'F-88', purpose: 'parking', days: 47 },
  { id: 'ws3', code: 'TK-330', purpose: 'maintenance', days: 39 },
  { id: 'ws4', code: 'B-24', purpose: 'maintenance', days: 31 },
  { id: 'ws5', code: 'U014', purpose: 'parking', days: 27 },
]

type LatestRow = {
  id: string
  code: string
  type: Bi
  context: 'site' | 'workshop'
  movement: 'entry' | 'exit'
  where: Bi
  at: string
}

const RIYADH = bi('مقاولات الخليج · الرياض', 'Gulf Contracting · Riyadh')
const JEDDAH = bi('شركة النخبة · جدة', 'Elite Co. · Jeddah')
const DAMMAM = bi('مقاولات الشرق · الدمام', 'East Contracting · Dammam')
const MAINTENANCE = bi('صيانة', 'Maintenance')
const PARKING = bi('وقوف', 'Standby')

const LATEST_ROWS: LatestRow[] = [
  {
    id: 'm1',
    code: 'A-1024',
    type: TYPES[1],
    context: 'site',
    movement: 'entry',
    where: RIYADH,
    at: '19/09/2026',
  },
  {
    id: 'm2',
    code: 'TK-208',
    type: TYPES[5],
    context: 'workshop',
    movement: 'entry',
    where: MAINTENANCE,
    at: '19/09/2026',
  },
  {
    id: 'm3',
    code: 'F-77',
    type: TYPES[3],
    context: 'site',
    movement: 'exit',
    where: DAMMAM,
    at: '19/09/2026',
  },
  {
    id: 'm4',
    code: 'A-311',
    type: TYPES[2],
    context: 'site',
    movement: 'entry',
    where: JEDDAH,
    at: '19/09/2026',
  },
  {
    id: 'm5',
    code: 'U001',
    type: TYPES[0],
    context: 'workshop',
    movement: 'exit',
    where: PARKING,
    at: '18/09/2026',
  },
  {
    id: 'm6',
    code: 'B-19',
    type: TYPES[4],
    context: 'site',
    movement: 'entry',
    where: RIYADH,
    at: '18/09/2026',
  },
  {
    id: 'm7',
    code: 'TK-140',
    type: TYPES[6],
    context: 'site',
    movement: 'exit',
    where: RIYADH,
    at: '18/09/2026',
  },
  {
    id: 'm8',
    code: 'A-905',
    type: TYPES[8],
    context: 'workshop',
    movement: 'entry',
    where: MAINTENANCE,
    at: '18/09/2026',
  },
  {
    id: 'm9',
    code: 'F-42',
    type: TYPES[7],
    context: 'site',
    movement: 'exit',
    where: DAMMAM,
    at: '17/09/2026',
  },
  {
    id: 'm10',
    code: 'A120',
    type: TYPES[1],
    context: 'site',
    movement: 'entry',
    where: JEDDAH,
    at: '17/09/2026',
  },
]

type EditRow = { id: string; who: Bi; what: Bi; at: Bi }

const EDIT_ROWS: EditRow[] = [
  {
    id: 'e1',
    who: bi('سعد العمري', 'Saad Al-Amri'),
    what: bi('تغيير سائق الحركة 4821', 'Changed driver on movement 4821'),
    at: bi('قبل 12 دقيقة', '12 min ago'),
  },
  {
    id: 'e2',
    who: bi('ادارة النظام', 'System admin'),
    what: bi('تصنيف دخول ورشة 4812', 'Classified workshop entry 4812'),
    at: bi('قبل ساعتين', '2 h ago'),
  },
  {
    id: 'e3',
    who: bi('راشد الحربي', 'Rashed Al-Harbi'),
    what: bi('اضافة صورة للحركة 4805', 'Added a photo to movement 4805'),
    at: bi('قبل 3 ساعات', '3 h ago'),
  },
  {
    id: 'e4',
    who: bi('محمد الزهراني', 'Mohammed Al-Zahrani'),
    what: bi('تصحيح تاريخ الحركة 4790', 'Corrected the date of movement 4790'),
    at: bi('امس', 'Yesterday'),
  },
  {
    id: 'e5',
    who: bi('ادارة النظام', 'System admin'),
    what: bi('حذف صورة مكررة 4788', 'Removed a duplicate photo on 4788'),
    at: bi('امس', 'Yesterday'),
  },
]

// --- Demo series -----------------------------------------------------------

/** FNV-1a, so a bucket always gets the same demo numbers. */
function hashKey(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Plausible demo traffic for a fleet of this size: roughly 24–40 entries and
 * 18–32 exits a day. The numbers scale with the days each bucket covers, so a
 * monthly chart and a daily chart of the same period stay consistent.
 */
function demoFlowPoints(
  buckets: ChartBucket[],
  lang: MockLang,
): EntriesLinePoint[] {
  return buckets.map((bucket) => {
    const seed = hashKey(bucket.key)
    const entriesPerDay = 24 + (seed % 17)
    const exitsPerDay = 18 + ((seed >>> 8) % 15)
    return {
      key: bucket.key,
      label: chartBucketLabel(bucket, lang),
      title: chartBucketRangeLabel(bucket),
      entries: entriesPerDay * bucket.days,
      exits: exitsPerDay * bucket.days,
    }
  })
}

// ---------------------------------------------------------------------------

export function AdminHomeMockup({
  lang,
  state,
}: {
  lang: MockLang
  state: MockState
}) {
  const copy: Copy = COPY[lang]
  const loading = state === 'loading'
  const error = state === 'error' || undefined
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [period, setPeriod] = useState<DateRangeValue>(() => {
    const { from, to } = saudiPeriodKeys('week')
    return { preset: 'week', from, to }
  })

  return (
    <div className="space-y-4">
      <Toolbar
        copy={copy}
        lang={lang}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PulseSection copy={copy} loading={loading} error={error} />
      <FlowSection
        copy={copy}
        lang={lang}
        dir={dir}
        loading={loading}
        error={error}
      />
      <FleetNowSection
        copy={copy}
        lang={lang}
        dir={dir}
        loading={loading}
        error={error}
      />
      <IdleSection copy={copy} lang={lang} loading={loading} error={error} />
      <AvailabilitySection
        copy={copy}
        lang={lang}
        loading={loading}
        error={error}
      />
      <AttentionSection copy={copy} loading={loading} error={error} />
      <LatestSection copy={copy} lang={lang} loading={loading} error={error} />
      <FleetBreakdownSection
        copy={copy}
        lang={lang}
        dir={dir}
        loading={loading}
        error={error}
      />
      <WorkshopSection copy={copy} loading={loading} error={error} />
      <UsersSection copy={copy} loading={loading} error={error} />
      <MiniTables
        copy={copy}
        lang={lang}
        period={period}
        loading={loading}
        error={error}
      />
    </div>
  )
}

// --- 0. Toolbar ------------------------------------------------------------

function Toolbar({
  copy,
  lang,
  period,
  onPeriodChange,
}: {
  copy: Copy
  lang: MockLang
  period: DateRangeValue
  onPeriodChange: (value: DateRangeValue) => void
}) {
  return (
    <CollapsibleSection
      as="h2"
      lang={lang}
      title={copy.toolbarTitle}
      description={copy.toolbarDescription}
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<LogIn size={15} aria-hidden="true" />}>
          {copy.registerEntry}
        </Button>
        <Button
          variant="outline"
          icon={<LogOut size={15} aria-hidden="true" />}
        >
          {copy.registerExit}
        </Button>
      </div>
      <div className="space-y-1.5">
        <span className="block text-xs text-muted">{copy.periodLabel}</span>
        {/* The four presets are wider than a 375 px screen: scroll the filter
            itself instead of letting the page scroll sideways. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <DateRangeFilter
            value={period}
            onChange={onPeriodChange}
            lang={lang}
            className="w-max flex-nowrap"
          />
        </div>
        <p className="text-xs text-muted">{copy.periodNote}</p>
      </div>
    </CollapsibleSection>
  )
}

/** Small chip repeating a range on a period-scoped section. */
function PeriodChip({ from, to }: { from: string; to: string }) {
  return (
    <Badge>
      <span className="tabular-nums" dir="ltr">
        {from} – {to}
      </span>
    </Badge>
  )
}

function NowChip({ copy }: { copy: Copy }) {
  return <Badge tone="info">{copy.nowScoped}</Badge>
}

// --- 1. Today's pulse ------------------------------------------------------

function Delta({ value, label }: { value: number; label: string }) {
  return (
    <span className={value >= 0 ? 'text-success' : 'text-warning'}>
      <span dir="ltr" className="tabular-nums">
        {value >= 0 ? `+${value}` : value}
      </span>{' '}
      {label}
    </span>
  )
}

function statValue(error: true | undefined, value: number | string) {
  return error ? '—' : value
}

function PulseSection({
  copy,
  loading,
  error,
}: {
  copy: Copy
  loading: boolean
  error: true | undefined
}) {
  const cards: {
    id: string
    label: string
    value: number
    delta: number
    tone?: 'entry' | 'exit' | 'info'
  }[] = [
    { id: 'in', label: copy.entriesToday, value: 38, delta: 6, tone: 'entry' },
    { id: 'out', label: copy.exitsToday, value: 29, delta: -4, tone: 'exit' },
    { id: 'sites', label: copy.insideSitesNow, value: INSIDE_SITES, delta: 9 },
    {
      id: 'workshop',
      label: copy.inWorkshopNow,
      value: WORKSHOP_MAINTENANCE + WORKSHOP_PARKING,
      delta: 3,
      tone: 'info',
    },
    { id: 'free', label: copy.outsideAvailable, value: OUTSIDE, delta: -12 },
  ]

  return (
    <CollapsibleSection
      as="h2"
      title={copy.pulseTitle}
      description={copy.pulseDescription}
      bodyClassName="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
    >
      {cards.map((card) => (
        <StatCard
          key={card.id}
          label={card.label}
          value={statValue(error, card.value)}
          tone={card.tone}
          loading={loading}
          hint={
            error ? undefined : (
              <Delta value={card.delta} label={copy.vsYesterday} />
            )
          }
        />
      ))}
    </CollapsibleSection>
  )
}

// --- 2. Entry flow ---------------------------------------------------------

type FlowPreset = 'year' | 'month' | 'custom'

function unitLabel(copy: Copy, unit: ChartBucketUnit | undefined) {
  if (unit === 'month') return copy.unitMonth
  if (unit === 'week') return copy.unitWeek
  return copy.unitDay
}

function FlowSection({
  copy,
  lang,
  dir,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  dir: 'rtl' | 'ltr'
  loading: boolean
  error: true | undefined
}) {
  // Read the clock once: a mockup that re-bucketed on every render would jump
  // around while the owner is looking at it.
  const today = useMemo(() => saudiDateKey(), [])
  const [preset, setPreset] = useState<FlowPreset>('year')
  const [showExits, setShowExits] = useState(false)
  const [custom, setCustom] = useState<DateRangeValue>(() => {
    const { from, to } = saudiPeriodKeys('month')
    return { preset: 'month', from, to }
  })

  const range = useMemo(() => {
    if (preset === 'custom')
      return { from: custom.from, to: custom.to, unit: undefined }
    if (preset === 'month') {
      const { from, to } = saudiPeriodKeys('month')
      // A month is always drawn day by day, even on the 2nd of the month.
      return { from, to, unit: 'day' as ChartBucketUnit }
    }
    // "This year" is always monthly, so early January is still 12-month
    // shaped instead of falling back to weeks.
    return {
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
      unit: 'month' as ChartBucketUnit,
    }
  }, [custom.from, custom.to, preset, today])

  const buckets = useMemo(
    () => buildChartBuckets(range.from, range.to, range.unit),
    [range],
  )
  const points = useMemo(() => demoFlowPoints(buckets, lang), [buckets, lang])

  return (
    <CollapsibleSection
      as="h2"
      title={copy.flowTitle}
      description={copy.flowDescription}
      action={
        <div className="flex items-center gap-2">
          <Badge tone="info">{unitLabel(copy, buckets[0]?.unit)}</Badge>
          <PeriodChip from={range.from} to={range.to} />
        </div>
      }
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={preset}
          onValueChange={(next) => setPreset(next as FlowPreset)}
        >
          <TabsList variant="segmented">
            <TabsTrigger value="year">{copy.flowThisYear}</TabsTrigger>
            <TabsTrigger value="month">{copy.flowThisMonth}</TabsTrigger>
            <TabsTrigger value="custom">{copy.flowCustom}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Switch
          checked={showExits}
          onCheckedChange={setShowExits}
          label={copy.flowShowExits}
        />
      </div>

      {preset === 'custom' && (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <DateRangeFilter
            value={custom}
            onChange={setCustom}
            lang={lang}
            className="w-max flex-nowrap"
          />
        </div>
      )}

      <EntriesLineChart
        ariaLabel={copy.flowAria}
        dir={dir}
        lang={lang}
        loading={loading}
        error={error}
        points={points}
        entriesLabel={copy.entries}
        exitsLabel={copy.exits}
        showExits={showExits}
      />
    </CollapsibleSection>
  )
}

// --- 3. Where the fleet is now ---------------------------------------------

function FleetNowSection({
  copy,
  lang,
  dir,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  dir: 'rtl' | 'ltr'
  loading: boolean
  error: true | undefined
}) {
  const states = useMemo(() => fleetStates(copy), [copy])
  const owners = useMemo(
    () => OWNER_IDS.map((id, index) => ({ id, label: OWNERS[index][lang] })),
    [lang],
  )

  return (
    <CollapsibleSection
      as="h2"
      title={copy.fleetNowTitle}
      description={copy.fleetNowDescription}
      action={<NowChip copy={copy} />}
    >
      <FleetNowExplorer
        dir={dir}
        lang={lang}
        loading={loading}
        error={error}
        owners={owners}
        states={states}
        count={fleetCount}
        labels={{
          allOwners: copy.fleetAllOwners,
          ownerFilter: copy.fleetOwnerFilter,
          total: copy.fleetTotal,
          byState: copy.fleetStateAria,
          byOwner: (stateLabel) =>
            `${stateLabel} — ${copy.fleetOwnerAriaPrefix}`,
          drillHint: copy.fleetDrillHint,
          back: copy.back,
        }}
      />
    </CollapsibleSection>
  )
}

// --- 4. Equipment with no movement -----------------------------------------

function FilterChips({
  label,
  options,
  value,
  onChange,
  allLabel,
}: {
  label: string
  options: { id: string; label: string }[]
  value: string
  onChange: (next: string) => void
  allLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {[{ id: 'all', label: allLabel }, ...options].map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={value === option.id ? 'primary' : 'outline'}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

function IdleSection({
  copy,
  lang,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  loading: boolean
  error: true | undefined
}) {
  const [type, setType] = useState('all')
  const [owner, setOwner] = useState('all')

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    IDLE_ROWS.forEach((row) => seen.set(row.type.ar, row.type[lang]))
    return [...seen].map(([id, label]) => ({ id, label }))
  }, [lang])

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>()
    IDLE_ROWS.forEach((row) => seen.set(row.owner.ar, row.owner[lang]))
    return [...seen].map(([id, label]) => ({ id, label }))
  }, [lang])

  const rows = useMemo(
    () =>
      IDLE_ROWS.filter(
        (row) =>
          (type === 'all' || row.type.ar === type) &&
          (owner === 'all' || row.owner.ar === owner),
      ).sort((a, b) => b.days - a.days),
    [owner, type],
  )

  const columns: DataTableColumn<IdleRow>[] = [
    {
      key: 'code',
      header: copy.colEquipment,
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'type',
      header: copy.colType,
      hideBelow: 'sm',
      cell: (row) => row.type[lang],
    },
    {
      key: 'owner',
      header: copy.colOwner,
      hideBelow: 'md',
      cell: (row) => row.owner[lang],
    },
    {
      key: 'last',
      header: copy.colLastMovement,
      cell: (row) =>
        row.lastExit ? (
          <span className="text-muted">
            {copy.exitedOn} {row.lastExit}
          </span>
        ) : (
          <Badge tone="danger">{copy.noMovementEver}</Badge>
        ),
    },
    {
      key: 'days',
      header: copy.colDays,
      align: 'end',
      width: '7rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {row.days} {copy.dayUnit}
        </span>
      ),
    },
  ]

  return (
    <CollapsibleSection
      as="h2"
      highlight
      title={copy.idleTitle}
      description={copy.idleDescription}
      action={
        <Button size="sm" variant="ghost">
          {copy.viewAll}
        </Button>
      }
      bodyClassName="space-y-3"
    >
      <div className="space-y-2">
        <FilterChips
          label={copy.filterByType}
          options={typeOptions}
          value={type}
          onChange={setType}
          allLabel={copy.all}
        />
        <FilterChips
          label={copy.filterByOwner}
          options={ownerOptions}
          value={owner}
          onChange={setOwner}
          allLabel={copy.all}
        />
      </div>
      <DataTable
        size="lg"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={6}
        error={error}
        caption={copy.idleCaption}
        rowClassName={(row) => (row.lastExit ? undefined : 'bg-danger-soft')}
      />
    </CollapsibleSection>
  )
}

// --- 5. Availability -------------------------------------------------------

function SplitCell({
  copy,
  all,
  owned,
}: {
  copy: Copy
  all: number
  owned: number
}) {
  return (
    <span className="block py-1 leading-tight">
      <span className="block text-[13px] font-semibold tabular-nums text-fg">
        {all}
      </span>
      <span className="block text-[11px] tabular-nums text-muted">
        {copy.owned} {owned} · {copy.rented} {all - owned}
      </span>
    </span>
  )
}

function availabilityColumns(
  copy: Copy,
  lang: MockLang,
  firstHeader: string,
): DataTableColumn<AvailabilityRow>[] {
  const metric = (
    key: string,
    header: string,
    index: 0 | 1 | 2 | 3,
    hideBelow?: 'sm' | 'md' | 'lg',
  ): DataTableColumn<AvailabilityRow> => ({
    key,
    header,
    align: 'end',
    hideBelow,
    cell: (row) => (
      <SplitCell copy={copy} all={row.all[index]} owned={row.owned[index]} />
    ),
  })
  return [
    {
      key: 'label',
      header: firstHeader,
      cell: (row) => <span className="font-medium">{row.label[lang]}</span>,
    },
    metric('total', copy.colTotal, 0),
    metric('inside', copy.colInside, 1),
    metric('workshop', copy.colWorkshop, 2, 'sm'),
    metric('available', copy.colAvailable, 3),
  ]
}

function AvailabilitySection({
  copy,
  lang,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  loading: boolean
  error: true | undefined
}) {
  const [query, setQuery] = useState('')

  const typeRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return AVAILABILITY_BY_TYPE
    return AVAILABILITY_BY_TYPE.filter(
      (row) =>
        row.label.ar.toLowerCase().includes(needle) ||
        row.label.en.toLowerCase().includes(needle),
    )
  }, [query])

  return (
    <CollapsibleSection
      as="h2"
      title={copy.availabilityTitle}
      description={copy.availabilityDescription}
      action={<NowChip copy={copy} />}
      bodyClassName="space-y-4"
    >
      <div className="space-y-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={copy.searchTypePlaceholder}
          aria-label={copy.searchTypePlaceholder}
          className="max-w-xs"
        />
        <DataTable
          size="lg"
          columns={availabilityColumns(copy, lang, copy.colType)}
          rows={typeRows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          error={error}
          empty={copy.noTypeMatch}
          caption={copy.availabilityByType}
        />
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">
          {copy.availabilityByOwner}
        </h4>
        <DataTable
          size="lg"
          columns={availabilityColumns(copy, lang, copy.colOwner)}
          rows={AVAILABILITY_BY_OWNER}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={error}
          caption={copy.availabilityByOwner}
        />
      </div>
    </CollapsibleSection>
  )
}

// --- 6. Needs your attention ----------------------------------------------

function AttentionSection({
  copy,
  loading,
  error,
}: {
  copy: Copy
  loading: boolean
  error: true | undefined
}) {
  const items: AttentionItem[] = [
    {
      id: 'longStay',
      label: copy.attnLongStay,
      hint: copy.attnLongStayHint,
      count: 34,
      tone: 'warning',
    },
    {
      id: 'unclassified',
      label: copy.attnUnclassified,
      hint: copy.attnUnclassifiedHint,
      count: 11,
      tone: 'warning',
    },
    {
      id: 'expiring',
      label: copy.attnExpiring,
      hint: copy.attnExpiringHint,
      count: 23,
      tone: 'danger',
    },
    {
      id: 'incomplete',
      label: copy.attnIncomplete,
      hint: copy.attnIncompleteHint,
      count: 9,
    },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.attentionTitle}
      description={copy.attentionDescription}
    >
      <AttentionList items={items} loading={loading} error={error} />
    </CollapsibleSection>
  )
}

// --- 7. Latest movements ---------------------------------------------------

function LatestSection({
  copy,
  lang,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  loading: boolean
  error: true | undefined
}) {
  const columns: DataTableColumn<LatestRow>[] = [
    {
      key: 'code',
      header: copy.colEquipment,
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'context',
      header: copy.colContext,
      width: '6rem',
      cell: (row) => (
        <Badge tone={row.context === 'site' ? 'neutral' : 'info'}>
          {row.context === 'site' ? copy.siteChip : copy.workshopChip}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: copy.colStatus,
      width: '6rem',
      cell: (row) => <MovementBadge type={row.movement} />,
    },
    {
      key: 'type',
      header: copy.colType,
      hideBelow: 'lg',
      cell: (row) => row.type[lang],
    },
    {
      key: 'where',
      header: copy.colWhere,
      hideBelow: 'sm',
      cell: (row) => row.where[lang],
    },
    {
      key: 'at',
      header: copy.colWhen,
      align: 'end',
      cell: (row) => <span className="text-muted">{row.at}</span>,
    },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.latestTitle}
      description={copy.latestDescription}
      action={
        <Button size="sm" variant="ghost">
          {copy.viewAll}
        </Button>
      }
    >
      <DataTable
        size="lg"
        columns={columns}
        rows={LATEST_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={6}
        error={error}
        empty={copy.noMovements}
        caption={copy.latestTitle}
      />
    </CollapsibleSection>
  )
}

// --- 8. Fleet breakdown ----------------------------------------------------

function FleetBreakdownSection({
  copy,
  lang,
  dir,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  dir: 'rtl' | 'ltr'
  loading: boolean
  error: true | undefined
}) {
  const [mode, setMode] = useState<'type' | 'owner' | 'activity'>('type')

  const items = useMemo(() => {
    if (mode === 'owner')
      return AVAILABILITY_BY_OWNER.map((row) => ({
        id: row.id,
        label: row.label[lang],
        value: row.all[0],
      }))
    if (mode === 'activity')
      return [
        { id: 'active', label: copy.activeEquipment, value: 731 },
        { id: 'inactive', label: copy.inactiveEquipment, value: 81 },
      ]
    return [...AVAILABILITY_BY_TYPE]
      .sort((a, b) => b.all[0] - a.all[0])
      .map((row) => ({
        id: row.id,
        label: row.label[lang],
        value: row.all[0],
      }))
  }, [copy.activeEquipment, copy.inactiveEquipment, lang, mode])

  const ariaLabel =
    mode === 'owner'
      ? copy.fleetOwnersAria
      : mode === 'activity'
        ? copy.fleetActivityAria
        : copy.fleetTypesAria

  return (
    <CollapsibleSection
      as="h2"
      title={copy.fleetTitle}
      description={copy.fleetDescription}
      action={<NowChip copy={copy} />}
      bodyClassName="space-y-3"
    >
      <Tabs
        value={mode}
        onValueChange={(next) => setMode(next as 'type' | 'owner' | 'activity')}
      >
        <TabsList variant="segmented">
          <TabsTrigger value="type">{copy.fleetByType}</TabsTrigger>
          <TabsTrigger value="owner">{copy.fleetByOwner}</TabsTrigger>
          <TabsTrigger value="activity">{copy.fleetByActivity}</TabsTrigger>
        </TabsList>
      </Tabs>
      <HorizontalBarList
        ariaLabel={ariaLabel}
        dir={dir}
        lang={lang}
        items={items}
        loading={loading}
        error={error}
        singleColor="var(--fg)"
        labelWidth={dir === 'rtl' ? 200 : 220}
      />
    </CollapsibleSection>
  )
}

// --- 9. Workshop -----------------------------------------------------------

function WorkshopSection({
  copy,
  loading,
  error,
}: {
  copy: Copy
  loading: boolean
  error: true | undefined
}) {
  return (
    <CollapsibleSection
      as="h2"
      title={copy.workshopTitle}
      description={copy.workshopDescription}
      action={<NowChip copy={copy} />}
      bodyClassName="grid grid-cols-2 gap-3 lg:grid-cols-3"
    >
      <StatCard
        label={copy.maintenanceNow}
        value={statValue(error, WORKSHOP_MAINTENANCE)}
        tone="warning"
        loading={loading}
      />
      <StatCard
        label={copy.parkingNow}
        value={statValue(error, WORKSHOP_PARKING)}
        tone="info"
        loading={loading}
      />
      <StatCard
        label={copy.avgStay}
        value={statValue(error, `11 ${copy.dayUnit}`)}
        loading={loading}
      />
    </CollapsibleSection>
  )
}

// --- 10. Users -------------------------------------------------------------

function UsersSection({
  copy,
  loading,
  error,
}: {
  copy: Copy
  loading: boolean
  error: true | undefined
}) {
  return (
    <CollapsibleSection
      as="h2"
      title={copy.usersTitle}
      description={copy.usersDescription}
      bodyClassName="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <StatCard
        label={copy.activeToday}
        value={statValue(error, 12)}
        loading={loading}
      />
      <StatCard
        label={copy.editsToday}
        value={statValue(error, 7)}
        loading={loading}
      />
    </CollapsibleSection>
  )
}

// --- 11. Mini tables -------------------------------------------------------

type QualityRow = { id: string; label: string; value: number }

/**
 * The narrow lists, three across on desktop and stacked on mobile. Each one
 * shows five rows and hands the rest to "View all", so the page keeps a fixed
 * height no matter how much data sits behind it.
 */
function MiniTables({
  copy,
  lang,
  period,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  period: DateRangeValue
  loading: boolean
  error: true | undefined
}) {
  const periodNote = `${period.from} – ${period.to}`

  const companyColumns: DataTableColumn<CompanyRow>[] = [
    {
      key: 'label',
      header: copy.colCompanyProject,
      cell: (row) => <span className="font-medium">{row.label[lang]}</span>,
    },
    {
      key: 'now',
      header: copy.colEquipmentNow,
      align: 'end',
      width: '6rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">{row.now}</span>
      ),
    },
  ]

  const foremanColumns: DataTableColumn<ForemanRow>[] = [
    {
      key: 'name',
      header: copy.colForeman,
      cell: (row) => (
        <span>
          <span className="block font-medium">{row.name[lang]}</span>
          {row.stale && (
            <Badge tone="warning" size="sm">
              {copy.noActivity7}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'movements',
      header: copy.colPeriodMovements,
      align: 'end',
      width: '6rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">{row.movements}</span>
      ),
    },
  ]

  const stayColumns: DataTableColumn<WorkshopStayRow>[] = [
    {
      key: 'code',
      header: copy.colEquipment,
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'purpose',
      header: copy.colPurpose,
      cell: (row) => <WorkshopPurposeBadge purpose={row.purpose} />,
    },
    {
      key: 'days',
      header: copy.colStayDays,
      align: 'end',
      width: '5rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {row.days} {copy.dayUnit}
        </span>
      ),
    },
  ]

  const qualityRows: QualityRow[] = [
    { id: 'plate', label: copy.qualityNoPlate, value: 37 },
    { id: 'mobile', label: copy.qualityNoMobile, value: 14 },
    { id: 'photos', label: copy.qualityFewPhotos, value: 62 },
    { id: 'quick', label: copy.qualityQuickCreate, value: 9 },
  ]

  const qualityColumns: DataTableColumn<QualityRow>[] = [
    { key: 'label', header: copy.colCheck, cell: (row) => row.label },
    {
      key: 'value',
      header: copy.colCount,
      align: 'end',
      width: '5rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums text-warning">
          {row.value}
        </span>
      ),
    },
  ]

  const editColumns: DataTableColumn<EditRow>[] = [
    {
      key: 'what',
      header: copy.colWhat,
      cell: (row) => (
        <span>
          <span className="block">{row.what[lang]}</span>
          <span className="block text-[11px] text-muted">{row.who[lang]}</span>
        </span>
      ),
    },
    {
      key: 'at',
      header: copy.colEditedAt,
      align: 'end',
      width: '6rem',
      cell: (row) => <span className="text-muted">{row.at[lang]}</span>,
    },
  ]

  return (
    <MiniTableGrid>
      <MiniTable
        title={copy.companiesTitle}
        description={`${copy.companiesDescription} · ${periodNote}`}
        columns={companyColumns}
        rows={COMPANY_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onViewAll={() => undefined}
      />
      <MiniTable
        title={copy.foremenTitle}
        description={`${copy.foremenDescription} · ${periodNote}`}
        columns={foremanColumns}
        rows={FOREMAN_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onViewAll={() => undefined}
      />
      <MiniTable
        title={copy.longestInWorkshop}
        description={copy.longestInWorkshopDescription}
        columns={stayColumns}
        rows={WORKSHOP_STAYS}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onViewAll={() => undefined}
      />
      <MiniTable
        title={copy.qualityTitle}
        description={copy.qualityDescription}
        columns={qualityColumns}
        rows={qualityRows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
      />
      <MiniTable
        title={copy.auditTitle}
        description={copy.auditDescription}
        columns={editColumns}
        rows={EDIT_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onViewAll={() => undefined}
      />
    </MiniTableGrid>
  )
}
