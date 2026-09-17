import { useMemo, useState, type ReactNode } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import {
  Button,
  DataTable,
  MovementBadge,
  SearchInput,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
  Badge,
  cn,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { Card, SectionHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { EquipmentStatusCard } from '@/components/home/EquipmentStatusCard'
import type {
  EquipmentState,
  EquipmentTimelineItem,
} from '@/components/home/EquipmentStatusCard'
import { AttentionList } from '@/components/home/AttentionList'
import type { AttentionItem } from '@/components/home/AttentionList'

// Home page mockup for owner approval on /ui-kit. Everything below is demo
// data held in this file: the mockup never calls Supabase and never changes a
// real screen. Approved direction (owner, 2026-09-17): separate the lists,
// unify the equipment.

type DemoLang = 'ar' | 'en'
type Bi = Record<DemoLang, string>
type DemoRole = 'admin' | 'foreman' | 'workshop'
type DemoState = 'ready' | 'loading' | 'error'

const bi = (ar: string, en: string): Bi => ({ ar, en })

const COPY = {
  ar: {
    title: 'الصفحة الرئيسية (نموذج للمراجعة)',
    description:
      'نموذج تفاعلي ببيانات تجريبية فقط. الفكرة: بحث موحد عن المعدة فوق كل شيء، وقوائم منفصلة للمواقع والورشة تحته.',
    roleLabel: 'الدور',
    roleAdmin: 'ادمن / متابعة',
    roleForeman: 'فورمين',
    roleWorkshop: 'الورشة',
    stateLabel: 'حالة البيانات',
    stateReady: 'بيانات',
    stateLoading: 'تحميل',
    stateError: 'خطا',
    searchTitle: 'بحث عن معدة',
    searchDescription:
      'بحث واحد يغطي المواقع والورشة معا. جرب الكود A120، واي كود اخر يعرض حالة عدم العثور.',
    searchPlaceholder: 'كود المعدة، مثال: A120',
    searchPrompt: 'اكتب كود المعدة لعرض حالتها الحالية واخر حركاتها.',
    quickActions: 'اجراءات سريعة',
    quickActionsNote: 'الازرار في النموذج غير مفعلة.',
    registerEntry: 'تسجيل دخول',
    registerExit: 'تسجيل خروج',
    tabSites: 'المواقع',
    tabWorkshop: 'الورشة',
    siteEntriesToday: 'دخول اليوم',
    siteExitsToday: 'خروج اليوم',
    insideSitesNow: 'داخل المواقع الان',
    outsideSites: 'خارج المواقع',
    insideWorkshopNow: 'داخل الورشة الان',
    maintenance: 'صيانة',
    parking: 'وقوف',
    awaitingClassification: 'بانتظار تصنيف',
    attentionTitle: 'يحتاج متابعة',
    attentionSitesDescription: 'حالات مفتوحة او بيانات ناقصة في المواقع.',
    attentionWorkshopDescription: 'حالات تحتاج قرار من الورشة.',
    openVisits30: 'زيارات مفتوحة اكثر من 30 يوم',
    openVisits30Hint: 'دخول بلا خروج حتى الان',
    noMovementEquipment: 'معدات بلا اي حركة',
    noMovementEquipmentHint: 'معدات مسجلة ولم تسجل لها اي حركة',
    incompleteEquipment: 'بيانات معدات غير مكتملة',
    incompleteEquipmentHint: 'معدات تم انشاؤها سريعا وتنتظر مراجعة الادمن',
    unclassifiedEntries: 'دخوليات بلا تصنيف',
    unclassifiedEntriesHint: 'دخول ورشة لم يحدد له صيانة او وقوف',
    longStayWorkshop: 'معدات طال بقاؤها في الورشة',
    longStayWorkshopHint: 'داخل الورشة اكثر من 30 يوم',
    latestSiteMovements: 'اخر حركات المواقع',
    latestWorkshopMovements: 'اخر حركات الورشة',
    myMovements: 'حركاتي',
    latestTen: 'اخر 10 حركات',
    viewAll: 'عرض الكل',
    classifyTitle: 'بانتظار تصنيف',
    classifyDescription:
      'دخوليات ورشة تحتاج تحديد صيانة او وقوف. عنصر التصنيف هنا معطل في النموذج.',
    classifyPlaceholder: 'اختر التصنيف',
    classifySave: 'حفظ',
    colEquipment: 'المعدة',
    colType: 'النوع',
    colStatus: 'الحالة',
    colLocation: 'الموقع',
    colDriver: 'السائق',
    colPurpose: 'الغرض',
    colDate: 'التاريخ',
    noMovements: 'لا توجد حركات',
  },
  en: {
    title: 'Home page (mockup for review)',
    description:
      'Interactive mockup with demo data only. The idea: one equipment search above everything, with separate site and workshop lists below it.',
    roleLabel: 'Role',
    roleAdmin: 'Admin / monitor',
    roleForeman: 'Foreman',
    roleWorkshop: 'Workshop',
    stateLabel: 'Data state',
    stateReady: 'Data',
    stateLoading: 'Loading',
    stateError: 'Error',
    searchTitle: 'Equipment search',
    searchDescription:
      'One search covering sites and workshop together. Try code A120; any other code shows the not-found state.',
    searchPlaceholder: 'Equipment code, e.g. A120',
    searchPrompt:
      'Type an equipment code to see its current state and latest movements.',
    quickActions: 'Quick actions',
    quickActionsNote: 'Buttons are not wired up in this mockup.',
    registerEntry: 'Register entry',
    registerExit: 'Register exit',
    tabSites: 'Sites',
    tabWorkshop: 'Workshop',
    siteEntriesToday: 'Entries today',
    siteExitsToday: 'Exits today',
    insideSitesNow: 'Inside sites now',
    outsideSites: 'Outside sites',
    insideWorkshopNow: 'Inside workshop now',
    maintenance: 'Maintenance',
    parking: 'Standby',
    awaitingClassification: 'Awaiting classification',
    attentionTitle: 'Needs attention',
    attentionSitesDescription: 'Open visits or incomplete data on sites.',
    attentionWorkshopDescription: 'Cases waiting for a workshop decision.',
    openVisits30: 'Open visits over 30 days',
    openVisits30Hint: 'Entry with no exit so far',
    noMovementEquipment: 'Equipment with no movements',
    noMovementEquipmentHint: 'Registered equipment with no movement recorded',
    incompleteEquipment: 'Incomplete equipment records',
    incompleteEquipmentHint: 'Quick-created equipment waiting for admin review',
    unclassifiedEntries: 'Entries without a classification',
    unclassifiedEntriesHint:
      'Workshop entries with no maintenance or standby set',
    longStayWorkshop: 'Equipment staying long in the workshop',
    longStayWorkshopHint: 'Inside the workshop for over 30 days',
    latestSiteMovements: 'Latest site movements',
    latestWorkshopMovements: 'Latest workshop movements',
    myMovements: 'My movements',
    latestTen: 'Latest 10 movements',
    viewAll: 'View all',
    classifyTitle: 'Awaiting classification',
    classifyDescription:
      'Workshop entries that need maintenance or standby. The control here is disabled in the mockup.',
    classifyPlaceholder: 'Select classification',
    classifySave: 'Save',
    colEquipment: 'Equipment',
    colType: 'Type',
    colStatus: 'Status',
    colLocation: 'Location',
    colDriver: 'Driver',
    colPurpose: 'Purpose',
    colDate: 'Date',
    noMovements: 'No movements',
  },
}

type Copy = typeof COPY.ar

const DEMO_EQUIPMENT = {
  id: 'eq-a120',
  code: 'A120',
  type: bi('حفار هيدروليكي', 'Hydraulic excavator'),
  plate: '4821 ا ب ج',
  owner: bi('العزاني', 'Al-Azani'),
}

const DEMO_STATE: EquipmentState = {
  kind: 'inside_workshop',
  purpose: 'maintenance',
  days: 6,
}

type TimelineSeed = {
  id: string
  context: 'site' | 'workshop'
  movement: 'entry' | 'exit'
  location: Bi
  date: string
}

const RIYADH = bi('مقاولات الخليج · مشروع الرياض', 'Gulf Contracting · Riyadh')

const DEMO_TIMELINE: TimelineSeed[] = [
  {
    id: 'tl1',
    context: 'workshop',
    movement: 'entry',
    location: bi('صيانة', 'Maintenance'),
    date: '11/09/2026',
  },
  {
    id: 'tl2',
    context: 'site',
    movement: 'exit',
    location: RIYADH,
    date: '11/09/2026',
  },
  {
    id: 'tl3',
    context: 'site',
    movement: 'entry',
    location: RIYADH,
    date: '02/08/2026',
  },
  {
    id: 'tl4',
    context: 'workshop',
    movement: 'exit',
    location: bi('وقوف', 'Standby'),
    date: '30/07/2026',
  },
  {
    id: 'tl5',
    context: 'site',
    movement: 'exit',
    location: bi('شركة النخبة · مشروع جدة', 'Elite Co. · Jeddah Project'),
    date: '22/07/2026',
  },
]

type SiteRow = {
  id: string
  code: string
  type: Bi
  movement: 'entry' | 'exit'
  where: Bi
  driver: Bi
  at: string
}

const JEDDAH = bi('شركة النخبة · مشروع جدة', 'Elite Co. · Jeddah')
const DAMMAM = bi('مقاولات الشرق · مشروع الدمام', 'East Contracting · Dammam')

const SITE_ROWS: SiteRow[] = [
  {
    id: 's1',
    code: 'A-1024',
    type: bi('حفار', 'Excavator'),
    movement: 'entry',
    where: RIYADH,
    driver: bi('سعد العمري', 'Saad Al-Amri'),
    at: '17/09/2026',
  },
  {
    id: 's2',
    code: 'TK-208',
    type: bi('رافعة شوكية', 'Forklift'),
    movement: 'exit',
    where: JEDDAH,
    driver: bi('راشد الحربي', 'Rashed Al-Harbi'),
    at: '17/09/2026',
  },
  {
    id: 's3',
    code: 'F-77',
    type: bi('قلاب', 'Dump truck'),
    movement: 'entry',
    where: DAMMAM,
    driver: bi('محمد الزهراني', 'Mohammed Al-Zahrani'),
    at: '17/09/2026',
  },
  {
    id: 's4',
    code: 'B-19',
    type: bi('بوكلين', 'Backhoe'),
    movement: 'entry',
    where: RIYADH,
    driver: bi('عمر السالم', 'Omar Al-Salem'),
    at: '16/09/2026',
  },
  {
    id: 's5',
    code: 'A-311',
    type: bi('شيول', 'Loader'),
    movement: 'exit',
    where: JEDDAH,
    driver: bi('فهد القحطاني', 'Fahd Al-Qahtani'),
    at: '16/09/2026',
  },
  {
    id: 's6',
    code: 'U001',
    type: bi('صهريج ماء', 'Water tanker'),
    movement: 'entry',
    where: DAMMAM,
    driver: bi('ناصر الدوسري', 'Nasser Al-Dosari'),
    at: '16/09/2026',
  },
  {
    id: 's7',
    code: 'TK-140',
    type: bi('ونش', 'Boom truck'),
    movement: 'exit',
    where: RIYADH,
    driver: bi('سالم الغامدي', 'Salem Al-Ghamdi'),
    at: '15/09/2026',
  },
  {
    id: 's8',
    code: 'A-905',
    type: bi('كومبريسر', 'Compressor'),
    movement: 'entry',
    where: JEDDAH,
    driver: bi('بدر المطيري', 'Badr Al-Mutairi'),
    at: '15/09/2026',
  },
  {
    id: 's9',
    code: 'F-42',
    type: bi('جريدر', 'Grader'),
    movement: 'exit',
    where: DAMMAM,
    driver: bi('طارق العتيبي', 'Tarek Al-Otaibi'),
    at: '15/09/2026',
  },
  {
    id: 's10',
    code: 'A120',
    type: bi('حفار هيدروليكي', 'Hydraulic excavator'),
    movement: 'exit',
    where: RIYADH,
    driver: bi('سعد العمري', 'Saad Al-Amri'),
    at: '11/09/2026',
  },
]

type WorkshopRow = {
  id: string
  code: string
  type: Bi
  movement: 'entry' | 'exit'
  purpose: 'maintenance' | 'parking' | null
  at: string
}

const WORKSHOP_ROWS: WorkshopRow[] = [
  {
    id: 'w1',
    code: 'B-19',
    type: bi('بوكلين', 'Backhoe'),
    movement: 'entry',
    purpose: null,
    at: '17/09/2026',
  },
  {
    id: 'w2',
    code: 'A-905',
    type: bi('كومبريسر', 'Compressor'),
    movement: 'entry',
    purpose: 'maintenance',
    at: '17/09/2026',
  },
  {
    id: 'w3',
    code: 'TK-208',
    type: bi('رافعة شوكية', 'Forklift'),
    movement: 'exit',
    purpose: 'maintenance',
    at: '16/09/2026',
  },
  {
    id: 'w4',
    code: 'U002',
    type: bi('صهريج ماء', 'Water tanker'),
    movement: 'entry',
    purpose: null,
    at: '15/09/2026',
  },
  {
    id: 'w5',
    code: 'A120',
    type: bi('حفار هيدروليكي', 'Hydraulic excavator'),
    movement: 'entry',
    purpose: 'maintenance',
    at: '11/09/2026',
  },
  {
    id: 'w6',
    code: 'F-77',
    type: bi('قلاب', 'Dump truck'),
    movement: 'entry',
    purpose: 'parking',
    at: '09/09/2026',
  },
  {
    id: 'w7',
    code: 'A-311',
    type: bi('شيول', 'Loader'),
    movement: 'exit',
    purpose: 'parking',
    at: '08/09/2026',
  },
  {
    id: 'w8',
    code: 'TK-140',
    type: bi('ونش', 'Boom truck'),
    movement: 'entry',
    purpose: 'maintenance',
    at: '07/09/2026',
  },
]

const PENDING_CLASSIFICATION = [
  { id: 'p1', code: 'B-19', type: bi('بوكلين', 'Backhoe'), at: '17/09/2026' },
  {
    id: 'p2',
    code: 'U002',
    type: bi('صهريج ماء', 'Water tanker'),
    at: '15/09/2026',
  },
]

export function HomeMockupShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [role, setRole] = useState<DemoRole>('admin')
  const [state, setState] = useState<DemoState>('ready')
  const [query, setQuery] = useState('A120')

  const copy: Copy = COPY[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{copy.title}</h3>
          <p className="text-xs text-muted">{copy.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={lang === 'ar' ? 'primary' : 'outline'}
            onClick={() => setLang('ar')}
          >
            عربي
          </Button>
          <Button
            size="sm"
            variant={lang === 'en' ? 'primary' : 'outline'}
            onClick={() => setLang('en')}
          >
            English
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Control label={copy.roleLabel}>
          <Tabs
            value={role}
            onValueChange={(next) => setRole(next as DemoRole)}
          >
            <TabsList variant="segmented">
              <TabsTrigger value="admin">{copy.roleAdmin}</TabsTrigger>
              <TabsTrigger value="foreman">{copy.roleForeman}</TabsTrigger>
              <TabsTrigger value="workshop">{copy.roleWorkshop}</TabsTrigger>
            </TabsList>
          </Tabs>
        </Control>
        <Control label={copy.stateLabel}>
          <Tabs
            value={state}
            onValueChange={(next) => setState(next as DemoState)}
          >
            <TabsList variant="segmented">
              <TabsTrigger value="ready">{copy.stateReady}</TabsTrigger>
              <TabsTrigger value="loading">{copy.stateLoading}</TabsTrigger>
              <TabsTrigger value="error">{copy.stateError}</TabsTrigger>
            </TabsList>
          </Tabs>
        </Control>
      </div>

      <div
        dir={direction}
        lang={lang}
        className="space-y-4 rounded-xl border bg-surface p-3 sm:p-4"
      >
        <EquipmentSearch
          copy={copy}
          lang={lang}
          role={role}
          state={state}
          query={query}
          onQueryChange={setQuery}
        />

        {role === 'foreman' && (
          <ForemanHome copy={copy} lang={lang} state={state} />
        )}

        {role === 'workshop' && (
          <WorkshopHome copy={copy} lang={lang} state={state} />
        )}

        {role === 'admin' && (
          <AdminHome copy={copy} lang={lang} state={state} />
        )}
      </div>
    </section>
  )
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs text-muted">{label}</span>
      {children}
    </div>
  )
}

function EquipmentSearch({
  copy,
  lang,
  role,
  state,
  query,
  onQueryChange,
}: {
  copy: Copy
  lang: DemoLang
  role: DemoRole
  state: DemoState
  query: string
  onQueryChange: (value: string) => void
}) {
  const trimmed = query.trim()
  const found = trimmed.toUpperCase() === DEMO_EQUIPMENT.code

  // Owner decision 2026-09-17: a foreman sees the workshop state, but not the
  // workshop movement rows themselves.
  const timeline: EquipmentTimelineItem[] = useMemo(
    () =>
      DEMO_TIMELINE.filter(
        (item) => role !== 'foreman' || item.context === 'site',
      ).map((item) => ({
        id: item.id,
        context: item.context,
        movement: item.movement,
        location: item.location[lang],
        date: item.date,
      })),
    [lang, role],
  )

  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title={copy.searchTitle}
        description={copy.searchDescription}
      />
      <SearchInput
        value={query}
        onValueChange={onQueryChange}
        placeholder={copy.searchPlaceholder}
        className="max-w-md"
      />
      {trimmed.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted">
          {copy.searchPrompt}
        </p>
      ) : (
        <EquipmentStatusCard
          equipment={
            found
              ? {
                  id: DEMO_EQUIPMENT.id,
                  code: DEMO_EQUIPMENT.code,
                  type: DEMO_EQUIPMENT.type[lang],
                  plate: DEMO_EQUIPMENT.plate,
                  owner: DEMO_EQUIPMENT.owner[lang],
                }
              : null
          }
          state={found ? DEMO_STATE : undefined}
          timeline={found ? timeline : []}
          href={found ? `/equipment/${DEMO_EQUIPMENT.id}` : undefined}
          loading={state === 'loading'}
          error={state === 'error' || undefined}
        />
      )}
    </Card>
  )
}

function QuickActions({
  copy,
  large = false,
}: {
  copy: Copy
  large?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className={cn('grid grid-cols-2 gap-3', !large && 'sm:max-w-md')}>
        <Button
          variant="primary"
          icon={<LogIn size={large ? 18 : 15} aria-hidden="true" />}
          className={large ? 'h-16 text-base' : undefined}
        >
          {copy.registerEntry}
        </Button>
        <Button
          variant="outline"
          icon={<LogOut size={large ? 18 : 15} aria-hidden="true" />}
          className={large ? 'h-16 text-base' : undefined}
        >
          {copy.registerExit}
        </Button>
      </div>
      <p className="text-xs text-muted">{copy.quickActionsNote}</p>
    </div>
  )
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

function statValue(state: DemoState, value: number) {
  return state === 'error' ? '—' : value
}

function SitesPanel({
  copy,
  lang,
  state,
  movementsTitle,
}: {
  copy: Copy
  lang: DemoLang
  state: DemoState
  movementsTitle: string
}) {
  const loading = state === 'loading'
  const columns = useMemo(() => siteColumns(copy, lang), [copy, lang])
  const items: AttentionItem[] = [
    {
      id: 'open30',
      label: copy.openVisits30,
      hint: copy.openVisits30Hint,
      count: 7,
      tone: 'warning',
    },
    {
      id: 'noMovement',
      label: copy.noMovementEquipment,
      hint: copy.noMovementEquipmentHint,
      count: 12,
    },
    {
      id: 'incomplete',
      label: copy.incompleteEquipment,
      hint: copy.incompleteEquipmentHint,
      count: 5,
      tone: 'warning',
    },
  ]

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard
          label={copy.siteEntriesToday}
          value={statValue(state, 14)}
          tone="entry"
          loading={loading}
        />
        <StatCard
          label={copy.siteExitsToday}
          value={statValue(state, 9)}
          tone="exit"
          loading={loading}
        />
        <StatCard
          label={copy.insideSitesNow}
          value={statValue(state, 63)}
          loading={loading}
        />
        <StatCard
          label={copy.outsideSites}
          value={statValue(state, 28)}
          loading={loading}
        />
      </StatGrid>

      <Card className="space-y-3">
        <SectionHeader
          title={copy.attentionTitle}
          description={copy.attentionSitesDescription}
        />
        <AttentionList
          items={items}
          loading={loading}
          error={state === 'error' || undefined}
        />
      </Card>

      <Card className="space-y-3">
        <SectionHeader
          title={movementsTitle}
          description={copy.latestTen}
          action={
            <Button size="sm" variant="ghost">
              {copy.viewAll}
            </Button>
          }
        />
        <DataTable
          size="sm"
          columns={columns}
          rows={SITE_ROWS}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={state === 'error' || undefined}
          empty={copy.noMovements}
          caption={movementsTitle}
        />
      </Card>
    </div>
  )
}

function WorkshopPanel({
  copy,
  lang,
  state,
  classifyFirst = false,
}: {
  copy: Copy
  lang: DemoLang
  state: DemoState
  classifyFirst?: boolean
}) {
  const loading = state === 'loading'
  const columns = useMemo(() => workshopColumns(copy, lang), [copy, lang])
  const items: AttentionItem[] = [
    {
      id: 'unclassified',
      label: copy.unclassifiedEntries,
      hint: copy.unclassifiedEntriesHint,
      count: 2,
      tone: 'warning',
    },
    {
      id: 'longStay',
      label: copy.longStayWorkshop,
      hint: copy.longStayWorkshopHint,
      count: 4,
      tone: 'warning',
    },
  ]

  const classify = (
    <Card className="space-y-3">
      <SectionHeader
        title={copy.classifyTitle}
        description={copy.classifyDescription}
      />
      <ul className="divide-y rounded-lg border">
        {PENDING_CLASSIFICATION.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-fg">
                {row.code}
              </span>
              <span className="block text-xs text-muted">
                {row.type[lang]} · {row.at}
              </span>
            </span>
            <Badge tone="warning">{copy.awaitingClassification}</Badge>
            <Select
              disabled
              options={[
                { value: 'maintenance', label: copy.maintenance },
                { value: 'parking', label: copy.parking },
              ]}
              placeholder={copy.classifyPlaceholder}
              aria-label={copy.classifyPlaceholder}
              className="w-40"
            />
            <Button disabled>{copy.classifySave}</Button>
          </li>
        ))}
      </ul>
    </Card>
  )

  return (
    <div className="space-y-4">
      {classifyFirst && classify}

      <StatGrid>
        <StatCard
          label={copy.insideWorkshopNow}
          value={statValue(state, 21)}
          loading={loading}
        />
        <StatCard
          label={copy.maintenance}
          value={statValue(state, 13)}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label={copy.parking}
          value={statValue(state, 6)}
          tone="info"
          loading={loading}
        />
        <StatCard
          label={copy.awaitingClassification}
          value={statValue(state, 2)}
          tone="warning"
          loading={loading}
        />
      </StatGrid>

      <Card className="space-y-3">
        <SectionHeader
          title={copy.attentionTitle}
          description={copy.attentionWorkshopDescription}
        />
        <AttentionList
          items={items}
          loading={loading}
          error={state === 'error' || undefined}
        />
      </Card>

      {!classifyFirst && classify}

      <Card className="space-y-3">
        <SectionHeader
          title={copy.latestWorkshopMovements}
          description={copy.latestTen}
          action={
            <Button size="sm" variant="ghost">
              {copy.viewAll}
            </Button>
          }
        />
        <DataTable
          size="sm"
          columns={columns}
          rows={WORKSHOP_ROWS}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={state === 'error' || undefined}
          empty={copy.noMovements}
          caption={copy.latestWorkshopMovements}
        />
      </Card>
    </div>
  )
}

function AdminHome({
  copy,
  lang,
  state,
}: {
  copy: Copy
  lang: DemoLang
  state: DemoState
}) {
  return (
    <>
      <Card className="space-y-3">
        <SectionHeader title={copy.quickActions} />
        <QuickActions copy={copy} />
      </Card>
      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites">{copy.tabSites}</TabsTrigger>
          <TabsTrigger value="workshop">{copy.tabWorkshop}</TabsTrigger>
        </TabsList>
        <TabsContent value="sites">
          <SitesPanel
            copy={copy}
            lang={lang}
            state={state}
            movementsTitle={copy.latestSiteMovements}
          />
        </TabsContent>
        <TabsContent value="workshop">
          <WorkshopPanel copy={copy} lang={lang} state={state} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ForemanHome({
  copy,
  lang,
  state,
}: {
  copy: Copy
  lang: DemoLang
  state: DemoState
}) {
  const loading = state === 'loading'
  const columns = useMemo(() => siteColumns(copy, lang), [copy, lang])
  return (
    <>
      <Card className="space-y-3">
        <SectionHeader as="h2" title={copy.quickActions} />
        <QuickActions copy={copy} large />
      </Card>
      <Card className="space-y-3">
        <SectionHeader
          as="h2"
          title={copy.myMovements}
          description={copy.latestTen}
          action={
            <Button size="sm" variant="ghost">
              {copy.viewAll}
            </Button>
          }
        />
        <DataTable
          size="sm"
          columns={columns}
          rows={SITE_ROWS.slice(0, 6)}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={5}
          error={state === 'error' || undefined}
          empty={copy.noMovements}
          caption={copy.myMovements}
        />
      </Card>
    </>
  )
}

function WorkshopHome({
  copy,
  lang,
  state,
}: {
  copy: Copy
  lang: DemoLang
  state: DemoState
}) {
  return (
    <>
      <Card className="space-y-3">
        <SectionHeader as="h2" title={copy.quickActions} />
        <QuickActions copy={copy} />
      </Card>
      <WorkshopPanel copy={copy} lang={lang} state={state} classifyFirst />
    </>
  )
}

function siteColumns(copy: Copy, lang: DemoLang): DataTableColumn<SiteRow>[] {
  return [
    {
      key: 'code',
      header: copy.colEquipment,
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
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
      header: copy.colLocation,
      hideBelow: 'sm',
      cell: (row) => row.where[lang],
    },
    {
      key: 'driver',
      header: copy.colDriver,
      hideBelow: 'md',
      cell: (row) => row.driver[lang],
    },
    {
      key: 'at',
      header: copy.colDate,
      align: 'end',
      cell: (row) => <span className="text-muted">{row.at}</span>,
    },
  ]
}

function workshopColumns(
  copy: Copy,
  lang: DemoLang,
): DataTableColumn<WorkshopRow>[] {
  return [
    {
      key: 'code',
      header: copy.colEquipment,
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
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
      hideBelow: 'md',
      cell: (row) => row.type[lang],
    },
    {
      key: 'purpose',
      header: copy.colPurpose,
      cell: (row) =>
        row.purpose ? (
          <WorkshopPurposeBadge purpose={row.purpose} />
        ) : (
          <Badge tone="warning">{copy.awaitingClassification}</Badge>
        ),
    },
    {
      key: 'at',
      header: copy.colDate,
      align: 'end',
      cell: (row) => <span className="text-muted">{row.at}</span>,
    },
  ]
}
