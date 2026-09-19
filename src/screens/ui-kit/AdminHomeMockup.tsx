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
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
} from '@/components/ui'
import type { DataTableColumn, DateRangeValue } from '@/components/ui'
import { AttentionList } from '@/components/home/AttentionList'
import type { AttentionItem } from '@/components/home/AttentionList'
import { CollapsibleSection } from '@/components/home/CollapsibleSection'
import {
  BarChart,
  DonutChart,
  HorizontalBarList,
  StackedBar,
} from '@/components/charts'
import { saudiPeriodKeys } from '@/lib/saudiTime'

// Admin home mockup v2 for owner review on /ui-kit (owner request 2026-09-19:
// a command dashboard with collapsible sections, simple SVG charts, no chart
// library). Every number below is demo data held in this file: the mockup
// never calls Supabase and never changes a real screen.

export type MockLang = 'ar' | 'en'
export type MockState = 'ready' | 'loading' | 'error'

type Bi = Record<MockLang, string>
const bi = (ar: string, en: string): Bi => ({ ar, en })

const COPY = {
  ar: {
    // 0 — toolbar
    toolbarTitle: 'لوحة التحكم',
    toolbarDescription:
      'بحث المعدة والاجراءات السريعة وفلتر فترة واحد يتحكم في الاقسام الزمنية.',
    quickActions: 'اجراءات سريعة',
    registerEntry: 'تسجيل دخول',
    registerExit: 'تسجيل خروج',
    periodLabel: 'الفترة',
    periodNote: 'يؤثر على الاقسام الزمنية فقط. اقسام «الان» لا تتغير.',
    periodFrom: 'من',
    periodTo: 'الى',
    periodScoped: 'حسب الفترة',
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
    // 2 — trend
    trendTitle: 'اتجاه الحركة',
    trendDescription: 'الدخول مقابل الخروج لكل يوم خلال الفترة.',
    trendSites: 'مواقع',
    trendWorkshop: 'ورشة',
    entries: 'دخول',
    exits: 'خروج',
    trendAria: 'الدخول والخروج لكل يوم',
    // 3 — fleet now
    fleetNowTitle: 'اين الاسطول الان',
    fleetNowDescription: 'توزيع كل المعدات في هذه اللحظة.',
    insideSites: 'داخل مواقع',
    workshopMaintenance: 'ورشة صيانة',
    workshopParking: 'ورشة وقوف',
    outside: 'خارج',
    fleetTotal: 'معدة',
    byOwnerTitle: 'حسب المالك',
    donutAria: 'توزيع الاسطول الان',
    ownerBarAria: 'توزيع الاسطول حسب المالك',
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
    // 7 — companies
    companiesTitle: 'الشركات والمشاريع',
    companiesDescription: 'اكثر خمس شركات ومشاريع نشاطا.',
    colCompanyProject: 'الشركة / المشروع',
    colEquipmentNow: 'معدات داخلها الان',
    colPeriodEntries: 'دخوليات الفترة',
    colLongestVisit: 'اطول زيارة',
    // 8 — foremen
    foremenTitle: 'الفورمين',
    foremenDescription: 'نشاط مسجلي الحركات خلال الفترة.',
    colForeman: 'الفورمان',
    colPeriodMovements: 'حركات الفترة',
    colOpenVisits: 'زيارات مفتوحة',
    colLastActivity: 'اخر نشاط',
    noActivity7: 'بلا نشاط 7 ايام',
    // 9 — workshop
    workshopTitle: 'الورشة',
    workshopDescription: 'حالة الورشة الان واطول المعدات بقاء فيها.',
    maintenanceNow: 'صيانة الان',
    parkingNow: 'وقوف الان',
    avgStay: 'متوسط مدة البقاء',
    longestInWorkshop: 'اطول خمس معدات في الورشة',
    colPurpose: 'الغرض',
    colStayDays: 'مدة البقاء',
    // 10 — latest movements
    latestTitle: 'اخر الحركات',
    latestDescription: 'اخر 10 حركات في المواقع والورشة معا.',
    colContext: 'السياق',
    colStatus: 'الحالة',
    colWhere: 'الموقع / الغرض',
    colWhen: 'التاريخ',
    siteChip: 'موقع',
    workshopChip: 'ورشة',
    noMovements: 'لا توجد حركات',
    // 11 — fleet breakdown
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
    // 12 — data quality
    qualityTitle: 'جودة البيانات',
    qualityDescription: 'نواقص تؤثر على دقة التقارير.',
    qualityNoPlate: 'معدات بلا لوحة او شاصي',
    qualityNoMobile: 'سائقون بلا جوال',
    qualityFewPhotos: 'حركات ورشة باقل من 3 صور',
    qualityQuickCreate: 'معدات الاضافة السريعة تنتظر مراجعة',
    // 13 — users and audit
    usersTitle: 'المستخدمون والتدقيق',
    usersDescription: 'من يعمل اليوم واخر التعديلات على الحركات.',
    activeToday: 'مستخدمون نشطون اليوم',
    editsToday: 'تعديلات اليوم',
    recentEdits: 'اخر خمسة تعديلات',
    colWho: 'من',
    colWhat: 'ماذا',
    colEditedAt: 'متى',
  },
  en: {
    toolbarTitle: 'Command dashboard',
    toolbarDescription:
      'Equipment search, quick actions, and one period filter driving the time-based sections.',
    quickActions: 'Quick actions',
    registerEntry: 'Register entry',
    registerExit: 'Register exit',
    periodLabel: 'Period',
    periodNote:
      'Affects time-based sections only. "Now" sections never change.',
    periodFrom: 'From',
    periodTo: 'To',
    periodScoped: 'For the period',
    nowScoped: 'Now',
    pulseTitle: "Today's pulse",
    pulseDescription: "Today's numbers compared with yesterday.",
    entriesToday: 'Entries today',
    exitsToday: 'Exits today',
    insideSitesNow: 'Inside sites now',
    inWorkshopNow: 'In the workshop now',
    outsideAvailable: 'Outside / available',
    vsYesterday: 'vs yesterday',
    trendTitle: 'Movement trend',
    trendDescription: 'Entries against exits per day over the period.',
    trendSites: 'Sites',
    trendWorkshop: 'Workshop',
    entries: 'Entries',
    exits: 'Exits',
    trendAria: 'Entries and exits per day',
    fleetNowTitle: 'Where the fleet is now',
    fleetNowDescription: 'Every unit, at this moment.',
    insideSites: 'Inside sites',
    workshopMaintenance: 'Workshop maintenance',
    workshopParking: 'Workshop standby',
    outside: 'Outside',
    fleetTotal: 'units',
    byOwnerTitle: 'By owner',
    donutAria: 'Fleet distribution now',
    ownerBarAria: 'Fleet distribution by owner',
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
    companiesTitle: 'Companies and projects',
    companiesDescription: 'The five busiest companies and projects.',
    colCompanyProject: 'Company / project',
    colEquipmentNow: 'Units inside now',
    colPeriodEntries: 'Entries in period',
    colLongestVisit: 'Longest visit',
    foremenTitle: 'Foremen',
    foremenDescription: 'Who recorded movements during the period.',
    colForeman: 'Foreman',
    colPeriodMovements: 'Movements in period',
    colOpenVisits: 'Open visits',
    colLastActivity: 'Last activity',
    noActivity7: 'No activity for 7 days',
    workshopTitle: 'Workshop',
    workshopDescription: 'Workshop state now and the longest stays.',
    maintenanceNow: 'Maintenance now',
    parkingNow: 'Standby now',
    avgStay: 'Average stay',
    longestInWorkshop: 'Five longest stays in the workshop',
    colPurpose: 'Purpose',
    colStayDays: 'Stay',
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
    qualityTitle: 'Data quality',
    qualityDescription: 'Gaps that affect report accuracy.',
    qualityNoPlate: 'Units with no plate or chassis',
    qualityNoMobile: 'Drivers with no mobile number',
    qualityFewPhotos: 'Workshop movements with under 3 photos',
    qualityQuickCreate: 'Quick-created equipment awaiting review',
    usersTitle: 'Users and audit',
    usersDescription: 'Who is working today and the latest movement edits.',
    activeToday: 'Users active today',
    editsToday: 'Edits today',
    recentEdits: 'Last five edits',
    colWho: 'Who',
    colWhat: 'What',
    colEditedAt: 'When',
  },
}

type Copy = typeof COPY.ar

// ---------------------------------------------------------------------------
// Demo data: a fleet of 812 units. Every breakdown below adds up to that total.
// ---------------------------------------------------------------------------

const FLEET_TOTAL = 812
const INSIDE_SITES = 498
const WORKSHOP_MAINTENANCE = 96
const WORKSHOP_PARKING = 63
const OUTSIDE = 155

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

const OWNERS: Bi[] = [
  bi('العزاني', 'Al-Azani'),
  bi('تكوين', 'Takween'),
  bi('طرف ثالث F', 'Third party F'),
  bi('طرف ثالث B', 'Third party B'),
  bi('مورد خارجي', 'External supplier'),
]

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

// Ownership is derived: Al-Azani is owned, every other classification is
// rented (AGENTS.md, equipment ownership).
const AVAILABILITY_BY_OWNER: AvailabilityRow[] = [
  {
    id: 'azani',
    label: OWNERS[0],
    all: [402, 248, 79, 75],
    owned: [402, 248, 79, 75],
  },
  {
    id: 'takween',
    label: OWNERS[1],
    all: [168, 104, 33, 31],
    owned: [0, 0, 0, 0],
  },
  { id: 'f', label: OWNERS[2], all: [104, 64, 21, 19], owned: [0, 0, 0, 0] },
  { id: 'b', label: OWNERS[3], all: [76, 47, 15, 14], owned: [0, 0, 0, 0] },
  {
    id: 'external',
    label: OWNERS[4],
    all: [62, 35, 11, 16],
    owned: [0, 0, 0, 0],
  },
]

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

type CompanyRow = {
  id: string
  label: Bi
  now: number
  entries: number
  longestVisit: number
}

const COMPANY_ROWS: CompanyRow[] = [
  {
    id: 'c1',
    label: bi('مقاولات الخليج · مشروع الرياض', 'Gulf Contracting · Riyadh'),
    now: 128,
    entries: 96,
    longestVisit: 74,
  },
  {
    id: 'c2',
    label: bi('شركة النخبة · مشروع جدة', 'Elite Co. · Jeddah'),
    now: 96,
    entries: 71,
    longestVisit: 58,
  },
  {
    id: 'c3',
    label: bi('مقاولات الشرق · مشروع الدمام', 'East Contracting · Dammam'),
    now: 84,
    entries: 63,
    longestVisit: 112,
  },
  {
    id: 'c4',
    label: bi('البناء الحديث · مشروع الخبر', 'Modern Build · Khobar'),
    now: 61,
    entries: 44,
    longestVisit: 39,
  },
  {
    id: 'c5',
    label: bi('مجموعة الاعمار · مشروع القصيم', 'Emaar Group · Qassim'),
    now: 47,
    entries: 31,
    longestVisit: 66,
  },
]

type ForemanRow = {
  id: string
  name: Bi
  movements: number
  openVisits: number
  lastActivity: Bi
  stale: boolean
}

const FOREMAN_ROWS: ForemanRow[] = [
  {
    id: 'f1',
    name: bi('سعد العمري', 'Saad Al-Amri'),
    movements: 142,
    openVisits: 18,
    lastActivity: bi('اليوم', 'Today'),
    stale: false,
  },
  {
    id: 'f2',
    name: bi('راشد الحربي', 'Rashed Al-Harbi'),
    movements: 118,
    openVisits: 12,
    lastActivity: bi('اليوم', 'Today'),
    stale: false,
  },
  {
    id: 'f3',
    name: bi('محمد الزهراني', 'Mohammed Al-Zahrani'),
    movements: 96,
    openVisits: 9,
    lastActivity: bi('امس', 'Yesterday'),
    stale: false,
  },
  {
    id: 'f4',
    name: bi('عمر السالم', 'Omar Al-Salem'),
    movements: 74,
    openVisits: 6,
    lastActivity: bi('12/09/2026', '12/09/2026'),
    stale: false,
  },
  {
    id: 'f5',
    name: bi('فهد القحطاني', 'Fahd Al-Qahtani'),
    movements: 12,
    openVisits: 2,
    lastActivity: bi('09/09/2026', '09/09/2026'),
    stale: true,
  },
]

type WorkshopStayRow = {
  id: string
  code: string
  type: Bi
  purpose: 'maintenance' | 'parking'
  days: number
}

const WORKSHOP_STAYS: WorkshopStayRow[] = [
  {
    id: 'ws1',
    code: 'A-217',
    type: TYPES[1],
    purpose: 'maintenance',
    days: 63,
  },
  { id: 'ws2', code: 'F-88', type: TYPES[3], purpose: 'parking', days: 47 },
  {
    id: 'ws3',
    code: 'TK-330',
    type: TYPES[2],
    purpose: 'maintenance',
    days: 39,
  },
  { id: 'ws4', code: 'B-24', type: TYPES[4], purpose: 'maintenance', days: 31 },
  { id: 'ws5', code: 'U014', type: TYPES[9], purpose: 'parking', days: 27 },
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
    at: bi('قبل 12 دقيقة', '12 minutes ago'),
  },
  {
    id: 'e2',
    who: bi('ادارة النظام', 'System admin'),
    what: bi('تصنيف دخول ورشة 4812', 'Classified workshop entry 4812'),
    at: bi('قبل ساعتين', '2 hours ago'),
  },
  {
    id: 'e3',
    who: bi('راشد الحربي', 'Rashed Al-Harbi'),
    what: bi('اضافة صورة للحركة 4805', 'Added a photo to movement 4805'),
    at: bi('قبل 3 ساعات', '3 hours ago'),
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

// Deterministic demo trend, so the mockup looks the same on every render.
function pseudoRandom(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

const TREND_BASE = new Date('2026-09-19T00:00:00Z')

function trendSeries(days: number, context: 'site' | 'workshop') {
  const next = pseudoRandom(context === 'site' ? 20260919 : 77031)
  const labels: string[] = []
  const entries: number[] = []
  const exits: number[] = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(TREND_BASE.getTime() - index * 86400000)
    const day = String(date.getUTCDate()).padStart(2, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    labels.push(`${day}/${month}`)
    const weekend = date.getUTCDay() === 5
    const scale = weekend ? 0.4 : 1
    if (context === 'site') {
      entries.push(Math.round((22 + next() * 26) * scale))
      exits.push(Math.round((17 + next() * 24) * scale))
    } else {
      entries.push(Math.round((5 + next() * 11) * scale))
      exits.push(Math.round((4 + next() * 10) * scale))
    }
  }
  return { labels, entries, exits }
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

  const periodDays =
    period.preset === 'month' || period.preset === 'custom' ? 30 : 14

  return (
    <div className="space-y-4">
      <Toolbar
        copy={copy}
        lang={lang}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PulseSection copy={copy} loading={loading} error={error} />
      <TrendSection
        copy={copy}
        lang={lang}
        dir={dir}
        days={periodDays}
        period={period}
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
      <CompaniesSection
        copy={copy}
        lang={lang}
        period={period}
        loading={loading}
        error={error}
      />
      <ForemenSection
        copy={copy}
        lang={lang}
        period={period}
        loading={loading}
        error={error}
      />
      <WorkshopSection
        copy={copy}
        lang={lang}
        loading={loading}
        error={error}
      />
      <LatestSection copy={copy} lang={lang} loading={loading} error={error} />
      <FleetBreakdownSection
        copy={copy}
        lang={lang}
        dir={dir}
        loading={loading}
        error={error}
      />
      <QualitySection copy={copy} loading={loading} />
      <UsersSection copy={copy} lang={lang} loading={loading} error={error} />
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

/** Small chip repeating the selected range on every period-scoped section. */
function PeriodChip({ period }: { period: DateRangeValue }) {
  return (
    <Badge>
      <span className="tabular-nums" dir="ltr">
        {period.from} – {period.to}
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
    {
      id: 'in',
      label: copy.entriesToday,
      value: 38,
      delta: 6,
      tone: 'entry',
    },
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

// --- 2. Movement trend -----------------------------------------------------

function TrendSection({
  copy,
  lang,
  dir,
  days,
  period,
  loading,
  error,
}: {
  copy: Copy
  lang: MockLang
  dir: 'rtl' | 'ltr'
  days: number
  period: DateRangeValue
  loading: boolean
  error: true | undefined
}) {
  const [context, setContext] = useState<'site' | 'workshop'>('site')
  const data = useMemo(() => trendSeries(days, context), [context, days])

  return (
    <CollapsibleSection
      as="h2"
      title={copy.trendTitle}
      description={copy.trendDescription}
      action={<PeriodChip period={period} />}
      bodyClassName="space-y-3"
    >
      <Tabs
        value={context}
        onValueChange={(next) => setContext(next as 'site' | 'workshop')}
      >
        <TabsList variant="segmented">
          <TabsTrigger value="site">{copy.trendSites}</TabsTrigger>
          <TabsTrigger value="workshop">{copy.trendWorkshop}</TabsTrigger>
        </TabsList>
      </Tabs>
      <BarChart
        ariaLabel={copy.trendAria}
        dir={dir}
        lang={lang}
        labels={data.labels}
        loading={loading}
        error={error}
        series={[
          {
            id: 'entries',
            label: copy.entries,
            color: 'var(--entry)',
            values: data.entries,
          },
          {
            id: 'exits',
            label: copy.exits,
            color: 'var(--exit)',
            values: data.exits,
          },
        ]}
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
  return (
    <CollapsibleSection
      as="h2"
      title={copy.fleetNowTitle}
      description={copy.fleetNowDescription}
      action={<NowChip copy={copy} />}
      bodyClassName="space-y-4"
    >
      <DonutChart
        ariaLabel={copy.donutAria}
        lang={lang}
        loading={loading}
        error={error}
        centerValue={FLEET_TOTAL}
        centerLabel={copy.fleetTotal}
        slices={[
          {
            id: 'sites',
            label: copy.insideSites,
            value: INSIDE_SITES,
            color: 'var(--entry)',
          },
          {
            id: 'maintenance',
            label: copy.workshopMaintenance,
            value: WORKSHOP_MAINTENANCE,
            color: 'var(--exit)',
          },
          {
            id: 'parking',
            label: copy.workshopParking,
            value: WORKSHOP_PARKING,
            color: 'var(--info)',
          },
          {
            id: 'outside',
            label: copy.outside,
            value: OUTSIDE,
            color: 'var(--muted)',
          },
        ]}
      />
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">{copy.byOwnerTitle}</h4>
        <StackedBar
          ariaLabel={copy.ownerBarAria}
          dir={dir}
          lang={lang}
          loading={loading}
          error={error}
          segments={AVAILABILITY_BY_OWNER.map((row) => ({
            id: row.id,
            label: row.label[lang],
            value: row.all[0],
          }))}
        />
      </div>
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
        size="sm"
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

// --- 5. Availability by type ----------------------------------------------

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
          size="sm"
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
          size="sm"
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

// --- 7. Companies and projects --------------------------------------------

function CompaniesSection({
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
  const columns: DataTableColumn<CompanyRow>[] = [
    {
      key: 'label',
      header: copy.colCompanyProject,
      cell: (row) => <span className="font-medium">{row.label[lang]}</span>,
    },
    {
      key: 'now',
      header: copy.colEquipmentNow,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.now}</span>,
    },
    {
      key: 'entries',
      header: copy.colPeriodEntries,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => <span className="tabular-nums">{row.entries}</span>,
    },
    {
      key: 'longest',
      header: copy.colLongestVisit,
      align: 'end',
      hideBelow: 'md',
      cell: (row) => (
        <span className="tabular-nums text-muted">
          {row.longestVisit} {copy.dayUnit}
        </span>
      ),
    },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.companiesTitle}
      description={copy.companiesDescription}
      action={
        <div className="flex items-center gap-2">
          <PeriodChip period={period} />
          <Button size="sm" variant="ghost">
            {copy.viewAll}
          </Button>
        </div>
      }
    >
      <DataTable
        size="sm"
        columns={columns}
        rows={COMPANY_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={5}
        error={error}
        caption={copy.companiesTitle}
      />
    </CollapsibleSection>
  )
}

// --- 8. Foremen ------------------------------------------------------------

function ForemenSection({
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
  const columns: DataTableColumn<ForemanRow>[] = [
    {
      key: 'name',
      header: copy.colForeman,
      cell: (row) => <span className="font-medium">{row.name[lang]}</span>,
    },
    {
      key: 'movements',
      header: copy.colPeriodMovements,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.movements}</span>,
    },
    {
      key: 'open',
      header: copy.colOpenVisits,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => <span className="tabular-nums">{row.openVisits}</span>,
    },
    {
      key: 'last',
      header: copy.colLastActivity,
      align: 'end',
      cell: (row) =>
        row.stale ? (
          <Badge tone="warning">{copy.noActivity7}</Badge>
        ) : (
          <span className="text-muted">{row.lastActivity[lang]}</span>
        ),
    },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.foremenTitle}
      description={copy.foremenDescription}
      action={<PeriodChip period={period} />}
    >
      <DataTable
        size="sm"
        columns={columns}
        rows={FOREMAN_ROWS}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={5}
        error={error}
        caption={copy.foremenTitle}
      />
    </CollapsibleSection>
  )
}

// --- 9. Workshop -----------------------------------------------------------

function WorkshopSection({
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
  const columns: DataTableColumn<WorkshopStayRow>[] = [
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
      key: 'purpose',
      header: copy.colPurpose,
      cell: (row) => <WorkshopPurposeBadge purpose={row.purpose} />,
    },
    {
      key: 'days',
      header: copy.colStayDays,
      align: 'end',
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
      title={copy.workshopTitle}
      description={copy.workshopDescription}
      action={<NowChip copy={copy} />}
      bodyClassName="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">
          {copy.longestInWorkshop}
        </h4>
        <DataTable
          size="sm"
          columns={columns}
          rows={WORKSHOP_STAYS}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={error}
          caption={copy.longestInWorkshop}
        />
      </div>
    </CollapsibleSection>
  )
}

// --- 10. Latest movements --------------------------------------------------

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
        size="sm"
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

// --- 11. Fleet breakdown ---------------------------------------------------

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

// --- 12. Data quality ------------------------------------------------------

function QualitySection({ copy, loading }: { copy: Copy; loading: boolean }) {
  const cards = [
    { id: 'plate', label: copy.qualityNoPlate, value: 37 },
    { id: 'mobile', label: copy.qualityNoMobile, value: 14 },
    { id: 'photos', label: copy.qualityFewPhotos, value: 62 },
    { id: 'quick', label: copy.qualityQuickCreate, value: 9 },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.qualityTitle}
      description={copy.qualityDescription}
      bodyClassName="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {cards.map((card) => (
        <StatCard
          key={card.id}
          label={card.label}
          value={card.value}
          tone="warning"
          loading={loading}
        />
      ))}
    </CollapsibleSection>
  )
}

// --- 13. Users and audit ---------------------------------------------------

function UsersSection({
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
  const columns: DataTableColumn<EditRow>[] = [
    {
      key: 'who',
      header: copy.colWho,
      cell: (row) => <span className="font-medium">{row.who[lang]}</span>,
    },
    {
      key: 'what',
      header: copy.colWhat,
      cell: (row) => row.what[lang],
    },
    {
      key: 'at',
      header: copy.colEditedAt,
      align: 'end',
      cell: (row) => <span className="text-muted">{row.at[lang]}</span>,
    },
  ]
  return (
    <CollapsibleSection
      as="h2"
      title={copy.usersTitle}
      description={copy.usersDescription}
      bodyClassName="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg">{copy.recentEdits}</h4>
        <DataTable
          size="sm"
          columns={columns}
          rows={EDIT_ROWS}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={error}
          caption={copy.recentEdits}
        />
      </div>
    </CollapsibleSection>
  )
}
