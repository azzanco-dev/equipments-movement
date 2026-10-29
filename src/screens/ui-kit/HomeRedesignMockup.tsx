import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowUpLeft,
  BadgeCheck,
  CircleDollarSign,
  ClipboardList,
  FileWarning,
  LogIn,
  LogOut,
  PowerOff,
  Radio,
  Truck,
  Warehouse,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  MovementBadge,
  SectionHeader,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  DataTable,
  cn,
  type DataTableColumn,
  type StatCardAccent,
} from '@/components/ui'

// Owner 2026-10-29: «ابغى اعيد تشكيل الرئيسية … ايش رايك», then «Build the
// mockup» on the proposal: what needs action first («يحتاج انتباهك»), the
// fleet now with its three tables as tabs of one card, today's movements,
// and the analysis last. Every section follows the viewer's permissions (the
// «كما يراها» switch below shows three viewers). Sample data only; nothing
// here reads or writes Supabase.

type Viewer = 'admin' | 'purchasing' | 'workshop_manager'

const VIEWERS: { id: Viewer; label: string }[] = [
  { id: 'admin', label: 'الادمن' },
  { id: 'purchasing', label: 'مسؤول المشتريات' },
  { id: 'workshop_manager', label: 'مدير الورشة' },
]

/** Which sections and attention items each sample viewer gets. */
const VIEWER_SEES: Record<
  Viewer,
  {
    attention: AttentionId[]
    fleet: boolean
    today: boolean
    analysis: boolean
    afaqy: boolean
  }
> = {
  admin: {
    attention: [
      'unclassified',
      'no_po',
      'awaiting_approval',
      'unpriced',
      'no_signal',
      'out_of_service_long',
    ],
    fleet: true,
    today: true,
    analysis: true,
    afaqy: true,
  },
  purchasing: {
    attention: ['no_po', 'awaiting_approval', 'unpriced'],
    fleet: true,
    today: false,
    analysis: false,
    afaqy: false,
  },
  workshop_manager: {
    attention: ['unclassified', 'out_of_service_long'],
    fleet: true,
    today: true,
    analysis: false,
    afaqy: false,
  },
}

// --- «يحتاج انتباهك» --------------------------------------------------------

type AttentionId =
  | 'unclassified'
  | 'no_po'
  | 'awaiting_approval'
  | 'unpriced'
  | 'no_signal'
  | 'out_of_service_long'

type AttentionItem = {
  id: AttentionId
  count: number
  label: string
  hint: string
  icon: ReactNode
  tone: 'warning' | 'info' | 'danger'
  /** Where a press goes on the real page. */
  target: string
}

const ATTENTION: AttentionItem[] = [
  {
    id: 'unclassified',
    count: 4,
    label: 'في الورشة بدون تصنيف',
    hint: 'دخلت الورشة ولم يحدد غرضها',
    icon: <Wrench size={16} />,
    tone: 'warning',
    target: 'الدخوليات › الورشة، غير مصنفة',
  },
  {
    id: 'no_po',
    count: 12,
    label: 'في المشاريع بدون PO',
    hint: 'معدات تعمل الان بلا امر شراء',
    icon: <FileWarning size={16} />,
    tone: 'warning',
    target: 'المشتريات › المعدات في المشاريع، بدون PO',
  },
  {
    id: 'awaiting_approval',
    count: 3,
    label: 'اوامر شراء بانتظار الاعتماد',
    hint: 'مسودات مسعرة وجاهزة للاعتماد',
    icon: <BadgeCheck size={16} />,
    tone: 'info',
    target: 'المشتريات › اوامر الشراء، بانتظار الاعتماد',
  },
  {
    id: 'unpriced',
    count: 5,
    label: 'اوامر شراء تحتاج اسعار',
    hint: 'فيها معدات بلا سعر',
    icon: <CircleDollarSign size={16} />,
    tone: 'warning',
    target: 'المشتريات › اوامر الشراء، تحتاج اسعار',
  },
  {
    id: 'no_signal',
    count: 7,
    label: 'انقطعت اشارتها في افاقي',
    hint: 'مربوطة ولم ترسل منذ اكثر من 24 ساعة',
    icon: <Radio size={16} />,
    tone: 'danger',
    target: 'الرئيسية › بيانات التتبع، غير متصلة',
  },
  {
    id: 'out_of_service_long',
    count: 2,
    label: 'خارج الخدمة اكثر من 30 يوم',
    hint: 'في الورشة وغرضها خارج الخدمة',
    icon: <PowerOff size={16} />,
    tone: 'danger',
    target: 'الدخوليات › الورشة، خارج الخدمة',
  },
]

const TONE_TEXT: Record<AttentionItem['tone'], string> = {
  warning: 'var(--warning)',
  info: 'var(--info)',
  danger: 'var(--danger)',
}
const TONE_SOFT: Record<AttentionItem['tone'], string> = {
  warning: 'var(--warning-soft)',
  info: 'var(--info-soft)',
  danger: 'var(--danger-soft)',
}

function AttentionStrip({
  items,
  onPick,
}: {
  items: AttentionItem[]
  onPick: (item: AttentionItem) => void
}) {
  if (items.length === 0) return null
  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title="يحتاج انتباهك"
        description="كل رقم يفتح قائمته مفلترة. يختفي البند اذا صار صفر، ويختفي القسم كله اذا ما بقى شي."
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className="group flex items-center gap-3 rounded-xl border bg-bg p-3 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{
                color: TONE_TEXT[item.tone],
                backgroundColor: TONE_SOFT[item.tone],
              }}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">
                {item.label}
              </span>
              <span className="block truncate text-xs text-muted">
                {item.hint}
              </span>
            </span>
            <span
              className="text-xl font-semibold tabular-nums"
              style={{ color: TONE_TEXT[item.tone] }}
            >
              {item.count}
            </span>
            <ArrowUpLeft
              size={14}
              aria-hidden="true"
              className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
            />
          </button>
        ))}
      </div>
    </Card>
  )
}

// --- «الحالة الان» -----------------------------------------------------------

type FleetTab = 'site' | 'workshop' | 'available'

type FleetRow = {
  id: string
  code: string
  type: string
  where: string
  /** Workshop purpose, for the workshop tab. */
  purpose?: 'صيانة' | 'وقوف' | 'خارج الخدمة' | 'غير مصنفة'
  since: string
  foreman?: string
}

const FLEET_ROWS: Record<FleetTab, FleetRow[]> = {
  site: [
    {
      id: 's1',
      code: 'A291',
      type: 'EXCAVATOR 20 TON',
      where: 'المباني · طريق الملك خالد',
      since: 'منذ 3 ايام',
      foreman: 'سعيد القحطاني',
    },
    {
      id: 's2',
      code: 'U243',
      type: 'BOOM TRUCK 15 TON',
      where: 'المباني · طريق الملك خالد',
      since: 'منذ 12 يوم',
      foreman: 'سعيد القحطاني',
    },
    {
      id: 's3',
      code: 'F118',
      type: 'WHEEL LOADER',
      where: 'نسما · حي النرجس',
      since: 'منذ شهر',
      foreman: 'ماجد العتيبي',
    },
    {
      id: 's4',
      code: 'TK07',
      type: 'DUMP TRUCK',
      where: 'نسما · حي النرجس',
      since: 'منذ شهرين',
      foreman: 'ماجد العتيبي',
    },
    {
      id: 's5',
      code: 'A055',
      type: 'GRADER',
      where: 'الراشد · مطار الملك سلمان',
      since: 'منذ 5 شهور',
      foreman: 'فهد الدوسري',
    },
  ],
  workshop: [
    {
      id: 'w1',
      code: 'A162',
      type: 'CRANE 50 TON',
      where: 'الورشة',
      purpose: 'غير مصنفة',
      since: 'منذ ساعتين',
    },
    {
      id: 'w2',
      code: 'A077',
      type: 'EXCAVATOR 30 TON',
      where: 'الورشة',
      purpose: 'صيانة',
      since: 'منذ 4 ايام',
    },
    {
      id: 'w3',
      code: 'F031',
      type: 'WATER TANKER',
      where: 'الورشة',
      purpose: 'وقوف',
      since: 'منذ 9 ايام',
    },
    {
      id: 'w4',
      code: 'A010',
      type: 'ROLLER',
      where: 'الورشة',
      purpose: 'خارج الخدمة',
      since: 'منذ 3 شهور',
    },
  ],
  available: [
    {
      id: 'a1',
      code: 'A230',
      type: 'FORKLIFT 5 TON',
      where: 'اخر خروج: المباني · طريق الملك خالد',
      since: 'منذ يومين',
    },
    {
      id: 'a2',
      code: 'TK19',
      type: 'DUMP TRUCK',
      where: 'اخر خروج: الورشة',
      since: 'منذ 6 ايام',
    },
    {
      id: 'a3',
      code: 'F204',
      type: 'BACKHOE LOADER',
      where: 'بدون حركة',
      since: '—',
    },
  ],
}

const FLEET_COUNTS: Record<FleetTab, number> = {
  site: 186,
  workshop: 41,
  available: 58,
}

const PURPOSE_TONE: Record<
  NonNullable<FleetRow['purpose']>,
  'warning' | 'info' | 'danger' | 'neutral'
> = {
  صيانة: 'warning',
  وقوف: 'info',
  'خارج الخدمة': 'danger',
  'غير مصنفة': 'neutral',
}

function FleetNow({ initialTab }: { initialTab: FleetTab }) {
  const [tab, setTab] = useState<FleetTab>(initialTab)
  const cards: {
    id: FleetTab | 'total'
    label: string
    value: number
    accent: StatCardAccent
    icon: ReactNode
    hint?: string
  }[] = [
    {
      id: 'total',
      label: 'الاسطول',
      value: 285,
      accent: 'neutral',
      icon: <Truck size={15} />,
    },
    {
      id: 'site',
      label: 'في المشاريع',
      value: FLEET_COUNTS.site,
      accent: 'success',
      icon: <ClipboardList size={15} />,
    },
    {
      id: 'workshop',
      label: 'في الورشة',
      value: FLEET_COUNTS.workshop,
      accent: 'warning',
      icon: <Warehouse size={15} />,
      hint: 'صيانة 22 · وقوف 13 · خارج الخدمة 6',
    },
    {
      id: 'available',
      label: 'متاحة',
      value: FLEET_COUNTS.available,
      accent: 'info',
      icon: <LogOut size={15} />,
    },
  ]

  const columns: DataTableColumn<FleetRow>[] = [
    {
      key: 'code',
      header: 'المعدة',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold">{row.code}</span>
          <span className="text-xs text-muted">{row.type}</span>
        </span>
      ),
    },
    tab === 'workshop'
      ? {
          key: 'purpose',
          header: 'الغرض',
          cell: (row) =>
            row.purpose ? (
              <Badge tone={PURPOSE_TONE[row.purpose]}>{row.purpose}</Badge>
            ) : null,
        }
      : {
          key: 'where',
          header: tab === 'site' ? 'الشركة · المشروع' : 'اخر مكان',
          cell: (row) => (
            <span className="flex flex-col whitespace-normal">
              <span>{row.where}</span>
              {row.foreman && (
                <span className="text-xs text-muted">{row.foreman}</span>
              )}
            </span>
          ),
        },
    {
      key: 'since',
      header: tab === 'available' ? 'من' : 'منذ',
      align: 'end',
      cell: (row) => <span className="text-xs text-muted">{row.since}</span>,
    },
  ]

  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title="الحالة الان"
        description="البطاقة تختار التبويب. الجداول الثلاثة صارت تبويبات في بطاقة واحدة بدل ثلاث بطاقات."
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            hint={card.hint}
            accent={card.accent}
            icon={card.icon}
            onClick={
              card.id === 'total'
                ? undefined
                : () => setTab(card.id as FleetTab)
            }
            className={cn(
              card.id === tab && 'ring-2 ring-[var(--ring)] ring-offset-1',
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(value) => setTab(value as FleetTab)}>
          <TabsList variant="segmented" aria-label="الحالة">
            <TabsTrigger value="site">المشاريع {FLEET_COUNTS.site}</TabsTrigger>
            <TabsTrigger value="workshop">
              الورشة {FLEET_COUNTS.workshop}
            </TabsTrigger>
            <TabsTrigger value="available">
              متاحة {FLEET_COUNTS.available}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" className="ms-auto">
          عرض الكل
        </Button>
      </div>
      <DataTable
        size="md"
        columns={columns}
        rows={FLEET_ROWS[tab]}
        rowKey={(row) => row.id}
        caption="الحالة الان"
        onRowClick={() => undefined}
      />
      <p className="text-xs text-muted">
        الضغط على صف: المشاريع والمتاحة تفتح المعدة، والورشة تفتح حركة دخولها.
      </p>
    </Card>
  )
}

// --- «حركة اليوم» -----------------------------------------------------------

type TodayRow = {
  id: string
  time: string
  code: string
  type: 'entry' | 'exit'
  where: string
  by: string
}

const TODAY: TodayRow[] = [
  {
    id: 't1',
    time: '10:42',
    code: 'A162',
    type: 'entry',
    where: 'الورشة',
    by: 'خالد (الورشة)',
  },
  {
    id: 't2',
    time: '10:15',
    code: 'A230',
    type: 'exit',
    where: 'المباني · طريق الملك خالد',
    by: 'سعيد القحطاني',
  },
  {
    id: 't3',
    time: '09:30',
    code: 'A291',
    type: 'entry',
    where: 'المباني · طريق الملك خالد',
    by: 'سعيد القحطاني',
  },
  {
    id: 't4',
    time: '08:05',
    code: 'F118',
    type: 'entry',
    where: 'نسما · حي النرجس',
    by: 'ماجد العتيبي',
  },
  {
    id: 't5',
    time: '07:20',
    code: 'TK19',
    type: 'exit',
    where: 'الورشة',
    by: 'خالد (الورشة)',
  },
]

function TodaySection() {
  const entries = TODAY.filter((row) => row.type === 'entry').length
  const exits = TODAY.length - entries
  const columns: DataTableColumn<TodayRow>[] = [
    {
      key: 'time',
      header: 'الوقت',
      cell: (row) => (
        <span className="tabular-nums text-muted" dir="ltr">
          {row.time}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'المعدة',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold">{row.code}</span>
          <MovementBadge type={row.type} />
        </span>
      ),
    },
    {
      key: 'where',
      header: 'المكان',
      cell: (row) => <span className="whitespace-normal">{row.where}</span>,
    },
    {
      key: 'by',
      header: 'بواسطة',
      hideBelow: 'sm',
      cell: (row) => <span className="text-xs text-muted">{row.by}</span>,
    },
  ]
  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title="حركة اليوم"
        description="من منتصف الليل بتوقيت السعودية. الصف يفتح الحركة."
        action={
          <Button variant="ghost" size="sm">
            كل الدخوليات
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="دخول اليوم"
          value={entries}
          accent="success"
          icon={<LogIn size={15} />}
        />
        <StatCard
          label="خروج اليوم"
          value={exits}
          accent="warning"
          icon={<LogOut size={15} />}
        />
      </div>
      <DataTable
        size="md"
        columns={columns}
        rows={TODAY}
        rowKey={(row) => row.id}
        caption="حركة اليوم"
        onRowClick={() => undefined}
      />
    </Card>
  )
}

// --- «التحليل» ---------------------------------------------------------------

const AVAILABILITY = [
  { type: 'EXCAVATOR', total: 48, free: 9 },
  { type: 'DUMP TRUCK', total: 61, free: 14 },
  { type: 'WHEEL LOADER', total: 22, free: 3 },
  { type: 'CRANE', total: 15, free: 1 },
  { type: 'WATER TANKER', total: 19, free: 6 },
]

function AnalysisSection({ afaqy }: { afaqy: boolean }) {
  return (
    <div className="space-y-2">
      <h2 className="px-1 text-sm font-semibold text-muted">التحليل</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <SectionHeader
            as="h3"
            title="التوفر حسب النوع"
            description="المتاح من كل نوع، اقل نسبة توفر اولا."
          />
          <ul className="space-y-2.5">
            {[...AVAILABILITY]
              .sort((a, b) => a.free / a.total - b.free / b.total)
              .map((row) => (
                <li key={row.type} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" dir="ltr">
                      {row.type}
                    </span>
                    <span className="tabular-nums text-muted">
                      {row.free} من {row.total}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full"
                    style={{ backgroundColor: 'var(--chart-4)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(row.free / row.total) * 100}%`,
                        backgroundColor: 'var(--chart-stroke-3)',
                      }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </Card>
        <Card className="space-y-3">
          <SectionHeader
            as="h3"
            title="الدخوليات"
            description="المخطط الحالي (يومي / اسبوعي / شهري) بدون تغيير، في مكان اقل."
          />
          <div className="flex h-40 items-end gap-1.5" aria-hidden="true">
            {[6, 9, 4, 11, 8, 13, 7, 10, 5, 12, 9, 14].map((value, index) => (
              <span
                key={index}
                className="flex-1 rounded-t"
                style={{
                  height: `${(value / 14) * 100}%`,
                  backgroundColor: 'var(--chart-1)',
                  borderTop: '2px solid var(--chart-stroke-1)',
                }}
              />
            ))}
          </div>
        </Card>
        {afaqy && (
          <Card className="space-y-3 lg:col-span-2">
            <SectionHeader
              as="h3"
              title="بيانات التتبع في افاقي"
              description="الاربع بطاقات كما هي، والجدولان خلف «عرض التفاصيل» لان غير المتصلة صارت بندا في «يحتاج انتباهك»."
              action={
                <Button variant="ghost" size="sm">
                  عرض التفاصيل
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatCard label="مربوطة" value={214} accent="neutral" />
              <StatCard label="متصلة" value={188} accent="success" />
              <StatCard label="غير متصلة" value={19} accent="warning" />
              <StatCard label="بدون اشارة" value={7} accent="danger" />
            </div>
          </Card>
        )}
      </div>
      <p className="px-1 text-xs text-muted">
        الدونات (الملكية والحالة) تنتقل الى تقرير المعدات، او تبقى هنا اذا
        تبيها.
      </p>
    </div>
  )
}

// --- The page ----------------------------------------------------------------

export function HomeRedesignMockup() {
  const [viewer, setViewer] = useState<Viewer>('admin')
  const [allClear, setAllClear] = useState(false)
  const [picked, setPicked] = useState<AttentionItem | null>(null)
  const sees = VIEWER_SEES[viewer]
  const attention = allClear
    ? []
    : ATTENTION.filter((item) => sees.attention.includes(item.id))

  return (
    <div className="space-y-4">
      {/* Mockup controls, not part of the page. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted">كما يراها:</span>
        <Tabs
          value={viewer}
          onValueChange={(value) => setViewer(value as Viewer)}
        >
          <TabsList variant="segmented" aria-label="كما يراها">
            {VIEWERS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAllClear((value) => !value)}
        >
          {allClear ? 'اظهر البنود' : 'لا شيء يحتاج انتباه'}
        </Button>
      </div>

      <div className="space-y-4 rounded-xl bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">صباح الخير</h1>
            <p className="text-sm text-muted">الخميس 29 اكتوبر</p>
          </div>
          {viewer !== 'purchasing' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<LogIn size={16} />}>
                تسجيل دخول
              </Button>
              <Button variant="outline" icon={<LogOut size={16} />}>
                تسجيل خروج
              </Button>
            </div>
          )}
        </div>

        <AttentionStrip items={attention} onPick={setPicked} />
        {picked && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted">
            <AlertTriangle size={13} aria-hidden="true" />
            في الصفحة الحقيقية يفتح: {picked.target}
          </p>
        )}

        {sees.fleet && (
          <FleetNow
            initialTab={viewer === 'workshop_manager' ? 'workshop' : 'site'}
            key={viewer}
          />
        )}
        {sees.today && <TodaySection />}
        {sees.analysis && <AnalysisSection afaqy={sees.afaqy} />}
      </div>
    </div>
  )
}
