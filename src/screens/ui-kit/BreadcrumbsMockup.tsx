import { useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, MoreHorizontal } from 'lucide-react'
import { Badge, Button, StatCard } from '@/components/ui'
import { RiyalSign } from '@/components/ui/RiyalSign'

/**
 * Owner 2026-11-07: «نبغى نضبط ازرار الرجوع الي عندنا كلها» then «ونضيف
 * breadcrumbs». A mockup only: the trail above the title of every detail and
 * settings page, the one back rule, and how both look on a phone. No screen
 * uses it until he approves.
 */

interface Crumb {
  label: string
  /** Omitted for the current page (the last crumb). */
  href?: string
}

/** The trail: every crumb but the last is a real link; the separator points
 *  the way the trail reads (left in Arabic). */
function Trail({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="مسار الصفحة">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
        {crumbs.map((crumb, index) => (
          <li key={crumb.label} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronLeft
                size={14}
                aria-hidden="true"
                className="text-placeholder"
              />
            )}
            {crumb.href ? (
              <a
                href={crumb.href}
                onClick={(event) => event.preventDefault()}
                className="rounded px-0.5 hover:text-fg hover:underline underline-offset-4"
              >
                {crumb.label}
              </a>
            ) : (
              <span aria-current="page" className="font-medium text-fg">
                <bdi>{crumb.label}</bdi>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The phone: only the way back, to the parent, as one line. */
function PhoneBack({ parent }: { parent: string }) {
  return (
    <a
      href="#"
      onClick={(event) => event.preventDefault()}
      className="inline-flex h-10 items-center gap-1.5 text-sm text-muted hover:text-fg"
    >
      <ArrowLeft size={16} aria-hidden="true" className="rtl-flip" />
      {parent}
    </a>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const EXAMPLES: ReadonlyArray<{ page: string; crumbs: Crumb[] }> = [
  {
    page: 'امر شراء مورد',
    crumbs: [
      { label: 'المشتريات', href: '/purchasing' },
      { label: 'اوامر الشراء', href: '/purchasing/orders' },
      { label: 'PO-2026110001' },
    ],
  },
  {
    page: 'معدة',
    crumbs: [{ label: 'المعدات', href: '/equipment' }, { label: 'A291' }],
  },
  {
    page: 'حركة',
    crumbs: [{ label: 'الدخوليات', href: '/logs' }, { label: 'A291 دخول' }],
  },
  {
    page: 'كرت معدة',
    crumbs: [
      { label: 'المبيعات', href: '/sales' },
      { label: 'اسعار المعدات', href: '/sales/prices' },
      { label: 'كرت A291' },
    ],
  },
  {
    page: 'سائق',
    crumbs: [{ label: 'السائقين', href: '/drivers' }, { label: 'محمد علي' }],
  },
  {
    page: 'مستخدم',
    crumbs: [
      { label: 'المستخدمين', href: '/users' },
      { label: 'خالد العتيبي' },
    ],
  },
  {
    page: 'صفحة اعدادات',
    crumbs: [{ label: 'الاعدادات', href: '/settings' }, { label: 'البنوك' }],
  },
  {
    page: 'دور في الصلاحيات',
    crumbs: [
      { label: 'الاعدادات', href: '/settings' },
      { label: 'الادوار والصلاحيات', href: '/settings/roles' },
      { label: 'المشتريات' },
    ],
  },
]

const RULES: ReadonlyArray<[string, string]> = [
  [
    'فتحت PO من قائمة اوامر الشراء وفيها فلتر «مسودة» وانت في الصفحة 3',
    'ترجع لنفس القائمة: نفس الفلتر ونفس الصفحة',
  ],
  [
    'فتحت معدة من صفحة PO',
    'ترجع لصفحة الـ PO، مو لقائمة المعدات',
  ],
  [
    'فتحت الصفحة من رابط مباشر او في تبويب جديد',
    'تروح للقائمة الاصلية حقها (اوامر الشراء، المعدات …)',
  ],
  [
    'ضغطت «اوامر الشراء» في المسار',
    'تفتح القائمة باخر فلاتر استخدمتها فيها',
  ],
]

export function BreadcrumbsMockup() {
  const [variant, setVariant] = useState<'trail' | 'trail-back'>('trail')

  return (
    <div className="space-y-4" dir="rtl">
      <Panel title="1. راس صفحة التفاصيل على الكمبيوتر">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={variant === 'trail' ? 'primary' : 'outline'}
            onClick={() => setVariant('trail')}
          >
            ا: المسار فقط
          </Button>
          <Button
            size="sm"
            variant={variant === 'trail-back' ? 'primary' : 'outline'}
            onClick={() => setVariant('trail-back')}
          >
            ب: المسار مع زر رجوع صغير
          </Button>
        </div>
        <div className="space-y-4 rounded-xl border bg-[var(--surface)] p-4">
          <div className="flex items-center gap-3">
            {variant === 'trail-back' && (
              <a
                href="#"
                onClick={(event) => event.preventDefault()}
                title="رجوع"
                aria-label="رجوع"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-muted hover:bg-surface-hover hover:text-fg"
              >
                <ArrowLeft size={15} aria-hidden="true" className="rtl-flip" />
              </a>
            )}
            <Trail crumbs={EXAMPLES[0].crumbs} />
          </div>
          <div className="rounded-xl border bg-[var(--bg)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">PO-2026110001</h1>
                  <Badge tone="success" size="sm">
                    مفتوح
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    مسودة
                  </Badge>
                </div>
                <p className="text-base font-semibold">
                  مؤسسة الخليج لتاجير المعدات
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">تصدير PDF</Button>
                <Button
                  variant="outline"
                  icon={<MoreHorizontal size={16} aria-hidden="true" />}
                >
                  خيارات
                </Button>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="الاجمالي بدون الضريبة"
              value={
                <span className="inline-flex items-center gap-1">
                  48,500 <RiyalSign />
                </span>
              }
            />
            <StatCard label="عدد المعدات" value="6" />
            <StatCard label="تحتاج سعر" value="1" />
          </div>
        </div>
        <p className="text-xs text-muted">
          المسار يحل محل زر «الرجوع الى …» الحالي فوق العنوان. في «ب» يبقى زر
          رجوع صغير قبل المسار يرجعك خطوة حسب القاعدة تحت.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="2. المسار في كل الصفحات">
          <ul className="divide-y">
            {EXAMPLES.map((example) => (
              <li
                key={example.page}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <Trail crumbs={example.crumbs} />
                <span className="text-xs text-placeholder">
                  {example.page}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            كل جزء غير الاخير رابط حقيقي: ينفتح في تبويب جديد بـ Ctrl او بالزر
            اليمين. الجزء الاخير اسم الصفحة الحالية وما يضغط.
          </p>
        </Panel>

        <Panel title="3. على الجوال">
          <div className="mx-auto w-full max-w-[375px] space-y-3 rounded-[28px] border-4 border-[var(--border)] bg-[var(--bg)] p-4">
            <PhoneBack parent="اوامر الشراء" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">PO-2026110001</h1>
                <Badge tone="success" size="sm">
                  مفتوح
                </Badge>
              </div>
              <p className="text-sm font-semibold">
                مؤسسة الخليج لتاجير المعدات
              </p>
            </div>
            <div className="h-20 rounded-lg border bg-[var(--surface)]" />
            <div className="h-28 rounded-lg border bg-[var(--surface)]" />
          </div>
          <p className="text-xs text-muted">
            على الجوال ما فيه مكان للمسار كامل، فيظهر سطر رجوع واحد باسم الصفحة
            الاب، وارتفاعه 40 بكسل عشان يسهل ضغطه.
          </p>
        </Panel>
      </div>

      <Panel title="4. قاعدة الرجوع الوحدة">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-xs text-muted">
                <th className="py-2 text-start font-medium">لو …</th>
                <th className="py-2 text-start font-medium">الرجوع …</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(([when, then]) => (
                <tr key={when} className="border-b last:border-0">
                  <td className="py-2.5 pe-4">{when}</td>
                  <td className="py-2.5 font-medium">{then}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          النص موحد في كل الصفحات: «رجوع الى» واسم الصفحة الاب، بدل «العودة
          للسائقين» و«رجوع للحركات» و«الرجوع الى اوامر الشراء».
        </p>
      </Panel>
    </div>
  )
}
