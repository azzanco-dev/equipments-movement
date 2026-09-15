import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Search,
  Settings,
  Sun,
  Truck,
  Wrench,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { useTheme } from '@/theme/ThemeContext'
import { AuthScreen } from '@/screens/AuthScreen'
import { FullPageSpinner } from '@/components/Spinner'
import {
  PALETTE_DIRECTIONS,
  contrastRatio,
  type PaletteDirection,
  type PaletteTokens,
} from '@/screens/ui-kit/palettes'

// Review page for design-system decisions. It is open in development so the
// product owner and Claude can review without a session; production requires
// an admin. All preview content is sample data.
const OPEN_WITHOUT_SESSION = process.env.NODE_ENV !== 'production'

export function UiKit() {
  const { profile, loading } = useAuth()
  const { t } = useI18n()
  if (!OPEN_WITHOUT_SESSION) {
    if (loading) return <FullPageSpinner />
    if (!profile) return <AuthScreen />
    if (profile.role !== 'admin')
      return (
        <div className="flex min-h-[100dvh] items-center justify-center p-4">
          <p className="card max-w-md text-center">
            {t('userPermissionError')}
          </p>
        </div>
      )
  }
  return <UiKitContent />
}

type Mode = 'light' | 'dark'

// Approved by the product owner on 2026-09-15.
const APPROVED_PALETTE: PaletteDirection['id'] = 'current'

function UiKitContent() {
  const [paletteId, setPaletteId] =
    useState<PaletteDirection['id']>(APPROVED_PALETTE)
  const [mode, setMode] = useState<Mode>('light')
  const palette =
    PALETTE_DIRECTIONS.find((item) => item.id === paletteId) ??
    PALETTE_DIRECTIONS[0]
  const tokens = palette[mode]

  return (
    // The review page is Arabic-first regardless of the interface language.
    <div
      dir="rtl"
      lang="ar"
      className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/azzanco-logo.png"
            alt=""
            aria-hidden="true"
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div>
            <h1 className="text-xl font-bold">مكتبة الواجهة</h1>
            <p className="text-sm text-muted">
              تم اعتماد الالوان الحالية. الخطوة التالية: بناء الـ components. كل
              البيانات في المعاينة تجريبية.
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <ApprovedTokens />

      <section aria-labelledby="directions-title" className="space-y-3">
        <h2 id="directions-title" className="text-base font-semibold">
          مقارنة اتجاهات الالوان (مرجع)
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="directions-title"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          {PALETTE_DIRECTIONS.map((item) => (
            <PaletteOption
              key={item.id}
              palette={item}
              selected={item.id === paletteId}
              onSelect={() => setPaletteId(item.id)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="preview-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="preview-title" className="text-base font-semibold">
            معاينة: {palette.name}
          </h2>
          <div
            role="radiogroup"
            aria-label="وضع العرض"
            className="inline-flex rounded-lg border border-[var(--border)] p-0.5"
          >
            {(['light', 'dark'] as const).map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] ${
                  mode === value ? 'nav-active' : 'text-muted'
                }`}
              >
                {value === 'light' ? <Sun size={14} /> : <Moon size={14} />}
                {value === 'light' ? 'فاتح' : 'داكن'}
              </button>
            ))}
          </div>
        </div>
        <PalettePreview tokens={tokens} />
      </section>

      <ContrastChecks tokens={tokens} mode={mode} />
    </div>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button className="btn-outline" onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      {theme === 'dark' ? 'عرض الفاتح' : 'عرض الداكن'}
    </button>
  )
}

const TOKEN_GROUPS: Array<{
  title: string
  items: Array<{ name: string; token: string; soft?: string }>
}> = [
  {
    title: 'الاساس',
    items: [
      { name: 'الخلفية', token: '--bg' },
      { name: 'السطح', token: '--surface' },
      { name: 'الحدود', token: '--border' },
      { name: 'النص', token: '--fg' },
      { name: 'النص الثانوي', token: '--muted' },
      { name: 'الرئيسي', token: '--primary' },
    ],
  },
  {
    title: 'الالوان الوظيفية',
    items: [
      { name: 'دخول', token: '--entry', soft: '--entry-soft' },
      { name: 'خروج', token: '--exit', soft: '--exit-soft' },
      { name: 'تحذير', token: '--warning', soft: '--warning-soft' },
      { name: 'خطا', token: '--danger', soft: '--danger-soft' },
      { name: 'معلومة', token: '--info', soft: '--info-soft' },
    ],
  },
]

// The approved tokens as defined in src/index.css, read live for the
// active theme.
function ApprovedTokens() {
  const { theme } = useTheme()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    const tokens = TOKEN_GROUPS.flatMap((group) =>
      group.items.flatMap((item) => [item.token, item.soft ?? '']),
    ).filter(Boolean)
    setValues(
      Object.fromEntries(
        tokens.map((token) => [token, styles.getPropertyValue(token).trim()]),
      ),
    )
  }, [theme])

  return (
    <section aria-labelledby="tokens-title" className="card space-y-4">
      <h2 id="tokens-title" className="text-base font-semibold">
        الالوان المعتمدة ({theme === 'dark' ? 'داكن' : 'فاتح'})
      </h2>
      {TOKEN_GROUPS.map((group) => (
        <div key={group.title} className="space-y-2">
          <h3 className="text-sm font-medium text-muted">{group.title}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {group.items.map((item) => (
              <div
                key={item.token}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                <span className="flex shrink-0 overflow-hidden rounded-md border">
                  <span
                    className="h-8 w-8"
                    style={{ background: `var(${item.token})` }}
                  />
                  {item.soft && (
                    <span
                      className="h-8 w-8"
                      style={{ background: `var(${item.soft})` }}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm">{item.name}</span>
                  <span
                    dir="ltr"
                    className="block truncate text-[11px] text-muted"
                  >
                    {item.token} {values[item.token]}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function PaletteOption({
  palette,
  selected,
  onSelect,
}: {
  palette: PaletteDirection
  selected: boolean
  onSelect: () => void
}) {
  const swatches: Array<[keyof PaletteTokens, string]> = [
    ['primary', 'رئيسي'],
    ['accent', 'مميز'],
    ['sidebar', 'القائمة'],
    ['entry', 'دخول'],
    ['exit', 'خروج'],
  ]
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`card flex flex-col gap-3 p-4 text-start transition-shadow ${
        selected ? 'ring-2 ring-[var(--ring)] ring-offset-2' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{palette.name}</span>
        {palette.id === APPROVED_PALETTE ? (
          <span className="badge status-entry border">
            <Check size={12} />
            معتمد
          </span>
        ) : (
          selected && <span className="badge nav-active">معروض</span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted">{palette.summary}</p>
      <div className="flex gap-2">
        {swatches.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <span
              className="h-8 w-8 rounded-lg border border-black/10"
              style={{ background: palette.light[key] }}
            />
            <span className="text-[11px] text-muted">{label}</span>
          </div>
        ))}
      </div>
    </button>
  )
}

function toVars(tokens: PaletteTokens) {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [`--k-${key}`, value]),
  ) as CSSProperties
}

const navItems = [
  { label: 'لوحة التحكم', icon: LayoutDashboard, active: true },
  { label: 'سجل الحركات', icon: FileText },
  { label: 'المعدات', icon: Truck },
  { label: 'الورشة', icon: Wrench },
  { label: 'التقارير', icon: BarChart3 },
  { label: 'الاعدادات', icon: Settings },
]

type Tone = 'entry' | 'exit' | 'warning' | 'danger' | 'info'

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{
        color: `var(--k-${tone})`,
        background: `var(--k-${tone}Soft)`,
        borderColor: `color-mix(in srgb, var(--k-${tone}) 30%, transparent)`,
      }}
    >
      {children}
    </span>
  )
}

function PalettePreview({ tokens }: { tokens: PaletteTokens }) {
  return (
    <div
      style={toVars(tokens)}
      className="overflow-hidden rounded-2xl border border-[var(--k-border)] bg-[var(--k-bg)] text-[var(--k-fg)] shadow-sm"
    >
      <div className="flex h-14 items-center justify-between border-b border-[var(--k-border)] px-4">
        <div className="flex items-center gap-2">
          <img
            src="/azzanco-logo.png"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 rounded-md object-contain"
          />
          <div>
            <p className="text-sm font-bold leading-tight">حركة المعدات</p>
            <p className="text-xs leading-tight text-[var(--k-muted)]">
              نظام دخول وخروج المعدات
            </p>
          </div>
        </div>
        <div className="text-end">
          <p className="text-xs font-medium">خالد العتيبي</p>
          <p className="text-xs text-[var(--k-muted)]">مدير النظام</p>
        </div>
      </div>

      <div className="flex">
        <aside className="hidden w-52 shrink-0 flex-col gap-1 bg-[var(--k-sidebar)] p-3 text-[var(--k-sidebarFg)] md:flex">
          {navItems.map(({ label, icon: Icon, active }) => (
            <span
              key={label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                active
                  ? 'bg-[var(--k-sidebarActive)] text-[var(--k-sidebarActiveFg)]'
                  : ''
              }`}
            >
              <Icon
                size={18}
                className={active ? '' : 'text-[var(--k-sidebarMuted)]'}
              />
              {label}
            </span>
          ))}
        </aside>

        <main className="min-w-0 flex-1 space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">لوحة التحكم</h3>
              <p className="text-sm text-[var(--k-muted)]">
                ملخص حركة المعدات اليوم
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex h-8 items-center gap-2 rounded-lg bg-[var(--k-primary)] px-3 text-[13px] text-[var(--k-primaryContrast)] hover:bg-[var(--k-primaryHover)]">
                <LogIn size={16} />
                تسجيل دخول
              </button>
              <button className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--k-border)] bg-[var(--k-bg)] px-3 text-[13px] hover:bg-[var(--k-surfaceHover)]">
                <LogOut size={16} />
                تسجيل خروج
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="دخول اليوم" value="24" tone="entry" icon={LogIn} />
            <StatCard label="خروج اليوم" value="17" tone="exit" icon={LogOut} />
            <StatCard
              label="المعدات النشطة"
              value="312"
              tone="primary"
              icon={Truck}
            />
            <StatCard
              label="داخل الورشة"
              value="9"
              tone="warning"
              icon={Wrench}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <section className="space-y-3">
              <div className="flex gap-4 border-b border-[var(--k-border)] text-sm">
                <span className="-mb-px border-b-2 border-[var(--k-primaryText)] pb-2 font-semibold text-[var(--k-primaryText)]">
                  اخر الحركات
                </span>
                <span className="pb-2 text-[var(--k-muted)]">التقارير</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <SampleMovementCard
                  entry
                  code="A-1024"
                  type="حفار"
                  plate="1234 ا ب ج"
                  location="شركة البناء المتحد · طريق الملك فهد"
                  supervisor="خالد العتيبي"
                  driver="سعيد محمد"
                  date="15/09/2026"
                  today
                />
                <SampleMovementCard
                  code="TK-208"
                  type="رافعة شوكية"
                  plate="5521 ر س ع"
                  location="تكوين · مشروع المستودعات"
                  supervisor="فهد القحطاني"
                  driver="راشد علي"
                  date="14/09/2026"
                />
              </div>
            </section>

            <section className="space-y-3">
              <SampleAlert tone="entry" icon={CheckCircle2}>
                تم حفظ الحركة بنجاح
              </SampleAlert>
              <SampleAlert tone="warning" icon={AlertTriangle}>
                المعدة داخل الموقع منذ 12 يوم
              </SampleAlert>
              <SampleAlert tone="danger" icon={AlertCircle}>
                تعذر تحميل البيانات. حاول مرة اخرى.
              </SampleAlert>
              <SampleAlert tone="info" icon={Info}>
                اختر تاريخ البداية والنهاية لعرض التقرير.
              </SampleAlert>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SampleForm />
            <SampleWorkshopTable />
          </div>
        </main>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: string
  tone: 'entry' | 'exit' | 'warning' | 'primary'
  icon: typeof LogIn
}) {
  const chip =
    tone === 'primary'
      ? { color: 'var(--k-primaryText)', background: 'var(--k-surface)' }
      : { color: `var(--k-${tone})`, background: `var(--k-${tone}Soft)` }
  return (
    <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-bg)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--k-muted)]">
          {label}
        </span>
        <span className="rounded-lg p-1.5" style={chip}>
          <Icon size={18} />
        </span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function SampleMovementCard({
  entry = false,
  code,
  type,
  plate,
  location,
  supervisor,
  driver,
  date,
  today = false,
}: {
  entry?: boolean
  code: string
  type: string
  plate: string
  location: string
  supervisor: string
  driver: string
  date: string
  today?: boolean
}) {
  const tone = entry ? 'entry' : 'exit'
  return (
    <div
      className="rounded-xl border border-s-4 border-[var(--k-border)] bg-[var(--k-bg)] p-3"
      style={{ borderInlineStartColor: `var(--k-${tone})` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-5">{code}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--k-muted)]">
            {type} · <span dir="ltr">{plate}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {today && <Badge tone="info">اليوم</Badge>}
          <Badge tone={tone}>{entry ? 'دخول' : 'خروج'}</Badge>
        </div>
      </div>
      <div className="mt-2.5 flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--k-surface)] px-2.5 py-2 text-xs">
        <MapPin size={14} className="shrink-0 text-[var(--k-muted)]" />
        <span className="truncate font-medium">{location}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 text-xs">
        {[
          ['المشرف', supervisor],
          ['السائق', driver],
          ['التاريخ', date],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[11px] text-[var(--k-muted)]">{label}</p>
            <p className="truncate">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SampleAlert({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone
  icon: typeof Info
  children: ReactNode
}) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border p-3 text-sm font-medium"
      style={{
        color: `var(--k-${tone})`,
        background: `var(--k-${tone}Soft)`,
        borderColor: `color-mix(in srgb, var(--k-${tone}) 35%, transparent)`,
      }}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function SampleForm() {
  const field =
    'h-8 w-full rounded-lg border border-[var(--k-border)] bg-[var(--k-bg)] px-3 text-sm'
  return (
    <section className="space-y-3 rounded-xl border border-[var(--k-border)] bg-[var(--k-bg)] p-4">
      <h4 className="text-sm font-semibold">نموذج</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium">رقم المعدة</p>
          <div className={`${field} flex items-center gap-2`}>
            <Search size={15} className="text-[var(--k-muted)]" />
            <span>A-1024</span>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">الشركة (عند التركيز)</p>
          <div
            className={`${field} flex items-center justify-between`}
            style={{
              borderColor: 'var(--k-primaryText)',
              boxShadow:
                '0 0 0 3px color-mix(in srgb, var(--k-primaryText) 22%, transparent)',
            }}
          >
            <span>شركة البناء المتحد</span>
            <ChevronDown size={15} className="text-[var(--k-muted)]" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[var(--k-primary)] text-[var(--k-primaryContrast)]">
            <Check size={12} />
          </span>
          معدة نشطة
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-5 w-9 items-center justify-end rounded-full bg-[var(--k-primary)] p-0.5">
            <span className="h-4 w-4 rounded-full bg-[var(--k-bg)]" />
          </span>
          ارسال تنبيه
        </span>
        <span className="font-medium text-[var(--k-primaryText)] underline">
          عرض الكل
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="h-8 rounded-lg bg-[var(--k-primary)] px-3 text-[13px] text-[var(--k-primaryContrast)]">
          حفظ
        </button>
        <button className="h-8 rounded-lg border border-[var(--k-border)] px-3 text-[13px]">
          الغاء
        </button>
        <button className="h-8 rounded-lg bg-[var(--k-dangerSoft)] px-3 text-[13px] text-[var(--k-danger)]">
          حذف
        </button>
        <button className="h-8 rounded-lg bg-[var(--k-accent)] px-3 text-[13px] text-[var(--k-accentContrast)]">
          زر مميز
        </button>
      </div>
    </section>
  )
}

function SampleWorkshopTable() {
  const rows: Array<[string, string, 'maintenance' | 'parking', string]> = [
    ['A-311', 'شيول', 'maintenance', '3 ايام'],
    ['F-77', 'قلاب', 'parking', '5 ساعات'],
    ['B-19', 'بوكلين', 'maintenance', '12 يوم'],
  ]
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--k-border)] bg-[var(--k-bg)]">
      <h4 className="p-4 pb-3 text-sm font-semibold">داخل الورشة</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--k-surface)] text-xs text-[var(--k-muted)]">
            <tr>
              {['المعدة', 'النوع', 'الغرض', 'المدة'].map((label) => (
                <th key={label} className="px-4 py-2.5 text-start font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([code, type, purpose, duration]) => (
              <tr key={code} className="border-t border-[var(--k-border)]">
                <td className="px-4 py-2.5 font-semibold">{code}</td>
                <td className="px-4 py-2.5">{type}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={purpose === 'maintenance' ? 'warning' : 'info'}>
                    {purpose === 'maintenance' ? 'صيانة' : 'وقوف'}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-[var(--k-muted)]">
                  {duration}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ContrastChecks({
  tokens,
  mode,
}: {
  tokens: PaletteTokens
  mode: Mode
}) {
  const checks: Array<[string, keyof PaletteTokens, keyof PaletteTokens]> = [
    ['النص على الخلفية', 'fg', 'bg'],
    ['النص الثانوي', 'muted', 'bg'],
    ['نص الزر الرئيسي', 'primaryContrast', 'primary'],
    ['الروابط والتركيز', 'primaryText', 'bg'],
    ['القائمة الجانبية', 'sidebarFg', 'sidebar'],
    ['شارة الدخول', 'entry', 'entrySoft'],
    ['شارة الخروج', 'exit', 'exitSoft'],
    ['رسالة الخطا', 'danger', 'dangerSoft'],
  ]
  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold">
        وضوح النصوص ({mode === 'light' ? 'فاتح' : 'داكن'})
      </h2>
      <p className="text-xs text-muted">
        نسبة التباين حسب معيار WCAG. المطلوب 4.5 او اكثر للنص العادي.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map(([label, fg, bg]) => {
          const ratio = contrastRatio(tokens[fg], tokens[bg])
          const passes = ratio >= 4.5
          return (
            <div
              key={label}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="inline-flex h-6 w-9 items-center justify-center rounded text-xs font-bold"
                  style={{ color: tokens[fg], background: tokens[bg] }}
                >
                  نص
                </span>
                {label}
              </span>
              <span
                dir="ltr"
                className={`text-xs font-semibold ${passes ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
              >
                {ratio.toFixed(1)}:1 {passes ? '✓' : '✗'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
