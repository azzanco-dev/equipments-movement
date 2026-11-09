import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Briefcase,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FileText,
  HardHat,
  Home,
  Languages,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  UserRound,
  X,
} from 'lucide-react'
import {
  Badge,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  SearchInput,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@/components/ui'

// Owner 2026-11-08: «طيب برضه ابغاك تسوي تصميم جديد للheader اللي فيه اللوقو
// والايقونات», after the home v2 mockup built from his four reference
// dashboards. From the images: the logo with the app name, one wide general
// search with its Ctrl K hint, the Saudi date and time with a calendar icon,
// the language and theme as quiet icons, and the user as one chip (avatar,
// name, role, a chevron) whose menu holds the rest. Kept from his review of
// 2026-11-01 (the dense dashboard's header): no movement buttons and no
// attention count in the bar. Left out of the images: the notifications bell
// and the messages icon (no notifications module), «انشاء جديد» (it would
// carry the movement entry he asked to keep out). Two variants were shown:
// «ا» one bar across the page, «ب» the logo in a block as wide as the
// sidebar so the two read as one column. APPROVED the same day as «ب»
// («اعتمد الشعار مع القائمة الجانبية»), with the WhatsApp gateway state
// left where it is today, at the foot of the sidebar («بوابة الواتس خليها
// نفس مكانها»): it is not in the header. Sample data only.

type Variant = 'bar' | 'column'

const VARIANTS: { id: Variant; label: string; note: string }[] = [
  {
    id: 'bar',
    label: 'ا · شريط واحد',
    note: 'شريط واحد بعرض الصفحة: الشعار والاسم، البحث العام في الوسط، والتاريخ والايقونات والمستخدم في الطرف.',
  },
  {
    id: 'column',
    label: 'ب · الشعار مع القائمة الجانبية (المعتمد)',
    note: 'الشعار الكامل في مربع بعرض القائمة الجانبية فيصيران عمود واحد، والباقي مثل «ا».',
  },
]

const USER = { name: 'مبارك باكرمان', role: 'ادمن', initial: 'م' }

// --- the general search ----------------------------------------------------

type ResultGroup = {
  id: string
  title: string
  icon: ReactNode
  items: { id: string; label: string; detail: string; ltr?: boolean }[]
}

const RESULT_GROUPS: ResultGroup[] = [
  {
    id: 'equipment',
    title: 'المعدات',
    icon: <Truck size={14} />,
    items: [
      {
        id: 'e1',
        label: 'A291',
        detail: 'WHEEL LOADER · في طريق الخرج',
        ltr: true,
      },
      { id: 'e2', label: 'A290', detail: 'EXCAVATOR · في الورشة', ltr: true },
    ],
  },
  {
    id: 'drivers',
    title: 'السائقون',
    icon: <UserRound size={14} />,
    items: [{ id: 'd1', label: 'احمد محمد', detail: '0551234567' }],
  },
  {
    id: 'projects',
    title: 'الشركات والمشاريع',
    icon: <Briefcase size={14} />,
    items: [{ id: 'p1', label: 'طريق الخرج', detail: 'شركة الطرق الحديثة' }],
  },
  {
    id: 'po',
    title: 'اوامر الشراء',
    icon: <FileText size={14} />,
    items: [
      {
        id: 'po1',
        label: 'PO-2026110004',
        detail: 'شركة الخليج للمعدات · 3 معدات',
        ltr: true,
      },
    ],
  },
]

function matches(query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return RESULT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q),
    ),
  })).filter((group) => group.items.length > 0)
}

function GlobalSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const groups = matches(query)

  // Ctrl K / Cmd K focuses the search, as the hint says.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  return (
    <div ref={boxRef} className="relative w-full">
      <SearchInput
        ref={inputRef}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="ابحث عن معدة، سائق، مشروع او PO"
        aria-label="بحث عام"
        className="[&_input]:rounded-full [&_input]:!bg-surface lg:[&_input]:!pe-24"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute end-9 top-1/2 hidden -translate-y-1/2 rounded-md border bg-bg px-1.5 font-latin text-[10px] leading-5 text-muted lg:block"
      >
        {/* The direction on the inner text only: on the kbd itself it
            would turn its logical «end» into the right edge. */}
        <span dir="ltr">Ctrl K</span>
      </kbd>
      {open && query.trim() && (
        <Card
          padded={false}
          className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto rounded-xl p-1.5 shadow-lg"
        >
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted">
              لا توجد نتائج
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.id} className="py-1">
                <p className="flex items-center gap-1.5 px-2 pb-1 text-[11px] text-muted">
                  <span aria-hidden="true">{group.icon}</span>
                  {group.title}
                </p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span
                          className="font-semibold"
                          dir={item.ltr ? 'ltr' : undefined}
                        >
                          {item.label}
                        </span>
                        <span className="truncate-safe min-w-0 flex-1 text-xs text-muted">
                          {item.detail}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  )
}

// --- the end-side pieces ---------------------------------------------------

function DateChip() {
  return (
    <span className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs xl:flex">
      <CalendarDays size={15} aria-hidden="true" className="text-muted" />
      <span className="text-muted">الاحد 8 نوفمبر 2026</span>
      <span className="h-3.5 w-px bg-border" aria-hidden="true" />
      <span className="font-semibold tabular-nums">10:24</span>
    </span>
  )
}

function QuietIcons() {
  return (
    <span className="hidden items-center gap-0.5 sm:flex">
      <IconButton
        label="تبديل اللغة: English"
        variant="ghost"
        size="sm"
        icon={
          <span className="flex items-center gap-1 font-latin text-xs font-semibold">
            <Languages size={15} aria-hidden="true" />
            EN
          </span>
        }
        className="!w-auto px-2"
      />
      <IconButton
        label="تبديل المظهر"
        variant="ghost"
        size="sm"
        icon={<Moon size={16} />}
      />
    </span>
  )
}

function UserChip() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`قائمة المستخدم: ${USER.name}`}
          className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:pe-2.5"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-contrast"
          >
            {USER.initial}
          </span>
          <span className="hidden text-start leading-tight lg:block">
            <span className="block text-xs font-semibold">{USER.name}</span>
            <span className="block text-[11px] text-muted">{USER.role}</span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="hidden text-muted sm:block"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-fg">
            {USER.name}
          </span>
          <span className="mt-0.5 block text-xs text-muted">{USER.role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Phones only (owner 2026-11-08, «مايحتاج تكرر الوضع الداكن
            والانقليزي في قائمة البروفايل»): from sm the bar shows them. */}
        <DropdownMenuItem
          className="sm:hidden"
          icon={<Moon size={16} />}
          onSelect={() => undefined}
        >
          المظهر الداكن
        </DropdownMenuItem>
        <DropdownMenuItem
          className="sm:hidden"
          icon={<Languages size={16} />}
          onSelect={() => undefined}
        >
          اللغة: <bdi>English</bdi>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="sm:hidden" />
        <DropdownMenuItem
          tone="danger"
          icon={<LogOut size={16} />}
          onSelect={() => undefined}
        >
          تسجيل الخروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 hidden h-6 w-px bg-border sm:block"
    />
  )
}

// --- the two headers -------------------------------------------------------

function BrandMark({ withName }: { withName: boolean }) {
  return (
    <a
      href="#app-header-v2"
      className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => event.preventDefault()}
    >
      <img
        src="/azzanco-logo.png"
        alt=""
        aria-hidden="true"
        className="h-9 w-9 shrink-0 rounded-lg object-contain"
      />
      {withName && (
        <span className="hidden leading-tight sm:block">
          <span className="block text-sm font-bold">ادارة المعدات الثقيلة</span>
          <span className="block font-latin text-[11px] text-muted" dir="ltr">
            Heavy Equipment Management
          </span>
        </span>
      )}
      <span className="sr-only">الرئيسية</span>
    </a>
  )
}

/** The phone row: the search opens as a row of its own under the bar. */
function PhoneSearchToggle({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <IconButton
      className="md:hidden"
      label={open ? 'اغلاق البحث' : 'بحث عام'}
      variant="ghost"
      aria-expanded={open}
      onClick={onToggle}
      icon={open ? <X size={18} /> : <Search size={18} />}
    />
  )
}

function BarHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <header className="border-b bg-bg">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
        <IconButton
          className="lg:hidden"
          label="القائمة"
          variant="ghost"
          icon={<Menu size={20} />}
        />
        <BrandMark withName />
        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          <div className="w-full max-w-xl">
            <GlobalSearch />
          </div>
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-1">
          <PhoneSearchToggle
            open={searchOpen}
            onToggle={() => setSearchOpen((value) => !value)}
          />
          <DateChip />
          <Divider />
          <QuietIcons />
          <Divider />
          <UserChip />
        </div>
      </div>
      {searchOpen && (
        <div className="border-t px-3 py-2 md:hidden">
          <GlobalSearch autoFocus />
        </div>
      )}
    </header>
  )
}

function ColumnHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <header className="border-b bg-bg">
      <div className="flex h-16 items-stretch">
        {/* As wide as the sidebar under it, with the full logo; no
            collapse button (owner 2026-11-08, «شيل زر الطي»). */}
        <div className="hidden w-60 shrink-0 items-center border-e px-4 lg:flex">
          {/* On the white logo tile in both themes (the bank logos'
              token): the logo's dark lettering stays readable in dark. */}
          <span className="flex h-12 items-center rounded-lg bg-[var(--logo-tile)] px-1.5">
            <img
              src="/azzanco-logo-full.png"
              alt="شعار شركة العزاني"
              className="h-11 w-auto object-contain"
            />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 sm:px-5">
          <IconButton
            className="lg:hidden"
            label="القائمة"
            variant="ghost"
            icon={<Menu size={20} />}
          />
          <span className="lg:hidden">
            <BrandMark withName={false} />
          </span>
          <div className="hidden min-w-0 max-w-xl flex-1 md:block">
            <GlobalSearch />
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <PhoneSearchToggle
              open={searchOpen}
              onToggle={() => setSearchOpen((value) => !value)}
            />
            <DateChip />
            <Divider />
            <QuietIcons />
            <Divider />
            <UserChip />
          </div>
        </div>
      </div>
      {searchOpen && (
        <div className="border-t px-3 py-2 md:hidden">
          <GlobalSearch autoFocus />
        </div>
      )}
    </header>
  )
}

// --- a stub of the page under the header -----------------------------------

const NAV = [
  { id: 'home', label: 'الرئيسية', icon: <Home size={16} />, active: true },
  { id: 'logs', label: 'الدخوليات', icon: <ClipboardList size={16} /> },
  { id: 'equipment', label: 'المعدات', icon: <Truck size={16} /> },
  { id: 'drivers', label: 'السائقون', icon: <HardHat size={16} /> },
  { id: 'purchasing', label: 'المشتريات', icon: <ShoppingCart size={16} /> },
  { id: 'settings', label: 'الاعدادات', icon: <Settings size={16} /> },
]

function PageStub({ variant }: { variant: Variant }) {
  return (
    <div className="flex bg-surface">
      <nav
        aria-label="القائمة الجانبية (عينة)"
        className={cn(
          'hidden w-60 shrink-0 space-y-0.5 p-3 lg:block',
          variant === 'column' && 'border-e bg-bg',
        )}
      >
        {NAV.map((item) => (
          <span
            key={item.id}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
              item.active
                ? 'bg-primary font-medium text-primary-contrast'
                : 'text-muted',
            )}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </span>
        ))}
        {/* Owner 2026-11-08: «بوابة الواتس خليها نفس مكانها» — the gateway
            state stays at the foot of the sidebar, as today. */}
        <span className="mt-3 block border-t pt-3">
          {/* The real card's look (owner 2026-11-09, «رجع البار حق الواتس
              نفس ماكان اول»): the soft state tone, the dot and the name. */}
          <span className="flex w-full items-center gap-2.5 rounded-lg bg-success-soft px-3 py-2.5 text-xs">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-success"
            />
            <span className="min-w-0 truncate text-fg">واتساب</span>
            <span className="ms-auto shrink-0 text-success">متصل</span>
          </span>
        </span>
      </nav>
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <div>
          <p className="text-lg font-bold">صباح الخير، مبارك</p>
          <p className="text-sm text-muted">
            الرئيسية تبدا هنا، تحت الهيدر مباشرة.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              aria-hidden="true"
              className="block h-16 rounded-2xl border bg-bg"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function AppHeaderV2Mockup() {
  const [variant, setVariant] = useState<Variant>('column')
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
          <TabsList variant="segmented" aria-label="نسخة الهيدر">
            {VARIANTS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted">{current.note}</span>
      </div>
      {/* No overflow clip around the header: the search results hang
          below it over the page. */}
      <div className="rounded-2xl border">
        <div className="relative z-10 rounded-t-2xl bg-bg [&>header]:rounded-t-2xl">
          {variant === 'bar' ? <BarHeader /> : <ColumnHeader />}
        </div>
        <div className="overflow-hidden rounded-b-2xl">
          <PageStub variant={variant} />
        </div>
      </div>
      <ul className="space-y-1 text-xs text-muted">
        <li>
          جرب البحث: اكتب A29 او احمد او PO، و Ctrl K يوديك للبحث من اي مكان.
        </li>
        <li>
          قائمة المستخدم فيها تسجيل الخروج، وعلى الجوال تختفي ايقونات المظهر
          واللغة وتنتقل لها.
        </li>
        <li>
          <Badge size="sm" tone="neutral">
            بدون
          </Badge>{' '}
          جرس التنبيهات والرسائل و«انشاء جديد» من الصور: ما عندنا تنبيهات،
          وتسجيل الحركة ما يكون في الهيدر.
        </li>
      </ul>
    </div>
  )
}
