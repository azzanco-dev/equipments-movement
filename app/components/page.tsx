'use client'

import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Badge, Field, MultiSelect, Select, cn } from '@/components/ui'
import type { SelectOption as UiSelectOption } from '@/components/ui'
import { Select as LegacySelect } from '@/components/Select'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { AsyncMultiSelect } from '@/components/AsyncMultiSelect'
import type { SelectOption } from '@/lib/selectOption'

// مرجع تطويري لمكونات البرنامج. كل ما في الصفحة يعمل فعليا ببيانات تجريبية،
// ولا يتصل بقاعدة البيانات. نبدا بحقول الاختيار؛ كل مجموعة لها قسم مستقل يمكن
// اضافته لاحقا بنفس الشكل (Section + Demo + Props).

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

/** اصلاح تجريبي **داخل هذه الصفحة فقط**: يُبقي لوحة الاختيار المفتوحة داخل
 *  المساحة المرئية على الجوال. السبب ان Radix يقيس layout viewport بينما
 *  الكيبورد يقلّص visualViewport وحده، فتُغطى اللوحة او تنقلب فوق الحقل.
 *  لا يعدّل هذا الكود اي مكوّن مشترك. */
const MOBILE_QUERY = '(max-width: 767px)'

function useVisualViewportPanelFit() {
  useEffect(() => {
    let frame = 0
    let settle: number[] = []
    /** اخر ارتفاع مرئي عولج عنده الحقل، لنعيد الضبط مرة واحدة عند فتح الكيبورد. */
    const alignedAt = new WeakMap<HTMLElement, number>()

    const naturalHeight = (panel: HTMLElement) => {
      const previous = panel.style.maxHeight
      panel.style.maxHeight = 'none'
      const height = panel.scrollHeight
      panel.style.maxHeight = previous
      return height
    }

    /** الزر الذي فتح اللوحة: عبر aria-controls، والا اقرب حقل مفتوح. */
    const triggerFor = (panel: HTMLElement): HTMLElement | null => {
      if (panel.id) {
        const byId = document.querySelector<HTMLElement>(
          `[aria-controls="${panel.id}"]`,
        )
        if (byId) return byId
      }
      const active = document.activeElement
      if (active instanceof HTMLElement) {
        const owner = active.closest<HTMLElement>(
          '[aria-haspopup], [role="combobox"]',
        )
        if (owner) return owner
      }
      const panelRect = panel.getBoundingClientRect()
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]',
        ),
      )
      let best: HTMLElement | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect()
        const distance = Math.min(
          Math.abs(rect.bottom - panelRect.top),
          Math.abs(rect.top - panelRect.bottom),
        )
        if (distance < bestDistance) {
          bestDistance = distance
          best = candidate
        }
      }
      return best
    }

    /** الحقل الى اعلى المساحة المرئية، لتبقى القائمة تحته ممتدة الى الكيبورد. */
    const alignToTop = (trigger: HTMLElement) => {
      const viewTop = window.visualViewport?.offsetTop ?? 0
      const rect = trigger.getBoundingClientRect()
      const delta = rect.top - (viewTop + 8)
      if (Math.abs(delta) > 2) window.scrollBy({ top: delta })
    }

    const fit = () => {
      frame = 0
      if (!window.matchMedia(MOBILE_QUERY).matches) return
      const visual = window.visualViewport
      const viewTop = visual?.offsetTop ?? 0
      const viewHeight = visual?.height ?? window.innerHeight
      const viewBottom = viewTop + viewHeight
      const gap = 8
      const edge = 4
      /** اقل مساحة مقبولة تحت الحقل قبل ان ننقل القائمة الى فوقه. */
      const minBelow = 168
      const maxPanel = 480

      /** يحسب الارتفاع والموضع الراسي داخل المساحة المرئية. */
      const place = (panel: HTMLElement) => {
        const trigger = triggerFor(panel)

        if (!trigger) {
          const current = panel.getBoundingClientRect().top
          const content = naturalHeight(panel)
          const height = Math.min(
            content,
            maxPanel,
            Math.max(160, viewBottom - current - gap),
          )
          const top = Math.min(
            Math.max(viewTop + gap, current),
            viewBottom - gap - height,
          )
          panel.style.maxHeight = `${height}px`
          panel.style.overflowY = 'auto'
          return top
        }

        // ١) الحقل الى الاعلى. نعيد الضبط حين يتغير ارتفاع المساحة المرئية
        //    (اي عند فتح الكيبورد) ثم نتوقف حتى لا نعاند تمرير المستخدم.
        const heightNow = Math.round(viewHeight)
        const alignedFor = alignedAt.get(panel)
        if (alignedFor === undefined || alignedFor !== heightNow) {
          alignToTop(trigger)
          alignedAt.set(panel, heightNow)
        }

        const rect = trigger.getBoundingClientRect()
        const content = naturalHeight(panel)
        const below = viewBottom - (rect.bottom + edge) - gap
        const above = rect.top - edge - viewTop - gap
        // ٢) الافتراضي تحت الحقل؛ وفوقه فقط حين تضيق المساحة تحته.
        const openBelow = below >= minBelow || below >= above
        const space = Math.max(0, openBelow ? below : above)
        const height = Math.min(content, maxPanel, Math.max(160, space))
        const top = openBelow ? rect.bottom + edge : rect.top - edge - height

        panel.style.maxHeight = `${height}px`
        panel.style.overflowY = 'auto'
        return top
      }

      // لوحات Radix: نضبط الازاحة الراسية في غلاف Popper.
      document
        .querySelectorAll<HTMLElement>('[data-radix-popper-content-wrapper]')
        .forEach((wrapper) => {
          const panel = wrapper.firstElementChild
          if (!(panel instanceof HTMLElement)) return
          const top = place(panel)
          const computed = window.getComputedStyle(wrapper).transform
          const matrix3d = computed.match(/matrix3d\(([^)]+)\)/)
          const matrix = computed.match(/matrix\(([^)]+)\)/)
          let tx = 0
          if (matrix3d) tx = Number(matrix3d[1].split(',')[12]) || 0
          else if (matrix) tx = Number(matrix[1].split(',')[4]) || 0
          wrapper.style.transform = `translate3d(${tx}px, ${top}px, 0)`
        })

      // اللوحات التي ترسم في portal يدوي (AsyncMultiSelect).
      document
        .querySelectorAll<HTMLElement>('[data-select-portal="true"]')
        .forEach((panel) => {
          if (panel.closest('[data-radix-popper-content-wrapper]')) return
          const top = place(panel)
          panel.style.bottom = 'auto'
          panel.style.top = `${top}px`
        })
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(fit)
      settle.forEach((id) => window.clearTimeout(id))
      settle = [window.setTimeout(fit, 50), window.setTimeout(fit, 220)]
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true })
    const visual = window.visualViewport
    visual?.addEventListener('resize', schedule)
    visual?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      observer.disconnect()
      visual?.removeEventListener('resize', schedule)
      visual?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      settle.forEach((id) => window.clearTimeout(id))
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])
}

/** على الجوال: الحقل الى اعلى الشاشة قبل ان يفتح الكيبورد. */
function alignSelectTrigger(event: ReactPointerEvent<HTMLDivElement>) {
  if (!window.matchMedia(MOBILE_QUERY).matches) return
  const trigger = (event.target as HTMLElement).closest<HTMLElement>(
    'button[aria-haspopup], [role="combobox"]:not(input)',
  )
  if (!trigger) return
  const viewTop = window.visualViewport?.offsetTop ?? 0
  const rect = trigger.getBoundingClientRect()
  window.scrollBy({ top: rect.top - (viewTop + 8) })
}

const EQUIPMENT_OPTIONS: UiSelectOption[] = [
  { value: 'a282', label: 'A282 — رافعة شوكية JCB' },
  { value: 'tk-dt-32', label: 'TK-DT-32 — قلاب مرسيدس' },
  { value: 'f76', label: 'F76 — بوبكات' },
  { value: 'b113', label: 'B113 — معدة موقوفة', disabled: true },
]

const DRIVER_OPTIONS: UiSelectOption[] = [
  { value: 'khaled', label: 'خالد العتيبي', description: 'اقامة رقم 1122334455' },
  {
    value: 'saleh',
    label: 'سالم عبدالله بن سعيد القحطاني الحربي',
    description: 'اقامة رقم 2456789012 · جوال 0555123456',
  },
  { value: 'rashed', label: 'راشد علي', description: 'اقامة رقم 3344556677' },
]

const PROJECT_OPTIONS: UiSelectOption[] = [
  { value: 'diriyah', label: 'مشروع الدرعية' },
  { value: 'quiddiya', label: 'مشروع القدية' },
  { value: 'bulvard', label: 'موقع البوليفارد' },
]

const OWNER_OPTIONS = [
  { value: 'alazani', label: 'العزاني' },
  { value: 'takween', label: 'تكوين' },
  { value: 'third_party_f', label: 'طرف ثالث F' },
  { value: 'third_party_b', label: 'طرف ثالث B' },
  {
    value: 'external_supplier',
    label: 'مالك اخر',
    description: 'معدات مستاجرة من مورد خارجي',
  },
]

const LEGACY_OPTIONS: SelectOption[] = [
  { value: 'diriyah', label: 'مشروع الدرعية' },
  { value: 'quiddiya', label: 'مشروع القدية' },
  { value: 'bulvard', label: 'موقع البوليفارد' },
  { value: 'kkr', label: 'طريق الملك خالد - KKR' },
  { value: 'p3', label: 'مشروع Package 3' },
]

const ASYNC_EQUIPMENT: AsyncSearchSelectOption[] = [
  {
    value: 'a282',
    label: 'A282 — رافعة شوكية JCB',
    description: 'الدرعية · تحالف نسما - مان',
    badge: { label: 'داخل موقع', tone: 'entry' },
  },
  {
    value: 'tk-dt-32',
    label: 'TK-DT-32 — قلاب مرسيدس',
    description: 'مشروع الثمامة · شركة المباني',
  },
  {
    value: 'f76',
    label: 'F76 — بوبكات',
    description: 'الدرعية · بوان المعمار',
    badge: { label: 'في الورشة', tone: 'warning' },
  },
  {
    value: 'a069',
    label: 'A069 — شيول كاتربلر',
    description: 'موقع البوليفارد · شركة المباني',
  },
  {
    value: 'u160',
    label: 'U160 — مان لفت',
    description: 'مشروع الامام عبد الله · شركة المباني',
  },
  {
    value: 'b113',
    label: 'B113 — مولد كهرباء',
    description: 'موقع القدية · شركة مجد الوفاء',
  },
]

const ASYNC_PROJECTS: SelectOption[] = PROJECT_OPTIONS.map((option) => ({
  value: option.value,
  label: String(option.label),
}))

/** بحث على الخادم في التطبيق الحقيقي؛ هنا تصفية بيانات ثابتة بتاخير بسيط. */
async function loadEquipmentOptions(
  query: string,
): Promise<AsyncSearchSelectOption[]> {
  await delay(180)
  const q = query.trim().toLowerCase()
  if (!q) return ASYNC_EQUIPMENT
  return ASYNC_EQUIPMENT.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      (option.description ?? '').toLowerCase().includes(q),
  )
}

async function loadProjectOptions(query: string): Promise<SelectOption[]> {
  await delay(150)
  const q = query.trim().toLowerCase()
  if (!q) return ASYNC_PROJECTS
  return ASYNC_PROJECTS.filter((option) =>
    option.label.toLowerCase().includes(q),
  )
}

async function loadAllProjectOptions(): Promise<SelectOption[]> {
  await delay(120)
  return ASYNC_PROJECTS
}

/* ============================ عناصر التنسيق ============================ */

/** عنوان قسم + ملاحظة + المسار في الكود. */
function Section({
  id,
  title,
  note,
  source,
  children,
}: {
  id: string
  title: string
  note: string
  source: string
  children: ReactNode
}) {
  return (
    <section id={id} className="card scroll-mt-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs leading-6 text-muted">{note}</p>
        <p className="font-mono text-[11px] text-muted">
          <bdi>{source}</bdi>
        </p>
      </div>
      {children}
    </section>
  )
}

/** مثال واحد داخل شبكة: عنوان صغير + الحقل + ملاحظة. */
function Demo({
  label,
  note,
  children,
  className,
}: {
  label: string
  note?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-xs font-medium">{label}</p>
      {children}
      {note ? <p className="text-[11px] leading-5 text-muted">{note}</p> : null}
    </div>
  )
}

/** جدول خصائص مختصر. */
function Props({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-xs">
        <thead>
          <tr className="text-muted">
            <th className="text-start font-medium">الخاصية</th>
            <th className="text-start font-medium">النوع</th>
            <th className="text-start font-medium">ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, note]) => (
            <tr key={name} className="border-t">
              <td className="py-1.5 pe-3">
                <bdi className="font-mono text-[11px]">{name}</bdi>
              </td>
              <td className="py-1.5 pe-3 text-muted">
                <bdi className="font-mono text-[11px]">{type}</bdi>
              </td>
              <td className="py-1.5 text-muted">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ANCHORS = [
  ['select', 'حقل اختيار'],
  ['multi-select', 'اختيار متعدد'],
  ['legacy-select', 'الحقل القديم'],
  ['async-select', 'بحث غير متزامن'],
  ['async-multi', 'متعدد غير متزامن'],
  ['compare', 'مقارنة'],
] as const

/* ================================ الصفحة ================================ */

export default function ComponentsPage() {
  useVisualViewportPanelFit()

  const [emptyValue, setEmptyValue] = useState<string | undefined>(undefined)
  const [equipmentValue, setEquipmentValue] = useState<string | undefined>(
    'tk-dt-32',
  )
  const [driverValue, setDriverValue] = useState<string | undefined>('khaled')
  const [smallValue, setSmallValue] = useState<string | undefined>('a282')
  const [fieldValue, setFieldValue] = useState<string | undefined>(undefined)
  const [invalidValue, setInvalidValue] = useState<string | undefined>(
    undefined,
  )

  const [ownersNone, setOwnersNone] = useState<string[]>([])
  const [ownersThree, setOwnersThree] = useState<string[]>([
    'alazani',
    'takween',
    'third_party_f',
  ])
  const [ownersChips, setOwnersChips] = useState<string[]>([
    'alazani',
    'external_supplier',
  ])
  const [ownersSmall, setOwnersSmall] = useState<string[]>(['takween'])

  const [legacyValue, setLegacyValue] = useState('diriyah')
  const [legacySearchValue, setLegacySearchValue] = useState('')

  const [asyncValue, setAsyncValue] = useState('')
  const [asyncOption, setAsyncOption] =
    useState<AsyncSearchSelectOption | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [createOption, setCreateOption] =
    useState<AsyncSearchSelectOption | null>(null)
  const [invalidAsyncValue, setInvalidAsyncValue] = useState('')
  const [invalidAsyncOption, setInvalidAsyncOption] =
    useState<AsyncSearchSelectOption | null>(null)

  const [multiValue, setMultiValue] = useState<SelectOption[]>([])

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] bg-bg text-fg"
      onPointerDownCapture={alignSelectTrigger}
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
        <header className="space-y-2">
          <p className="text-xs font-medium text-muted">مرجع تطويري</p>
          <h1 className="text-xl font-semibold">مكتبة مكونات البرنامج</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            كل مكون مستخدم في الشاشات، بامثلته المباشرة وخصائصه. البيانات هنا
            تجريبية ولا تُحفظ. نبدا بحقول الاختيار، ثم نضيف بقية الحقول والجداول
            والازرار تدريجيا.
          </p>
          <p className="flex items-start gap-2 text-[11px] leading-5 text-muted">
            <Badge tone="info">جوال</Badge>
            <span>
              في هذه الصفحة فقط: قائمة الاختيار تبقى داخل المساحة المرئية وفوق
              الكيبورد، ويُمرَّر الحقل الى وسط الشاشة قبل فتحه. لا يعدّل هذا
              السلوك اي مكوّن مشترك في التطبيق.
            </span>
          </p>
          <nav className="flex flex-wrap gap-2 pt-1">
            {ANCHORS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-surface-hover"
              >
                {label}
              </a>
            ))}
          </nav>
        </header>

        {/* ============================ 1) ui/Select ============================ */}
        <Section
          id="select"
          title="حقل اختيار — Select"
          note="الحقل المعياري للاختيار من قيمة واحدة على Radix. ارتفاع 40 بكسل على الجوال و36 من 768 فما فوق، وخط شعاعه 16 على الجوال لمنع تكبير iOS. يدعم سطرا ثانويا تحت العنوان (وصف) وخيارا معطلا داخل القائمة وحالة غير صالحة."
          source="src/components/ui/Select.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Demo
              label="بلا قيمة (النص التوضيحي)"
              note="حين لا توجد قيمة يظهر النص التوضيحي بلون placeholder نفسه في كل الحقول."
            >
              <Select
                options={EQUIPMENT_OPTIONS}
                value={emptyValue}
                onValueChange={setEmptyValue}
                placeholder="اختر معدة"
              />
            </Demo>

            <Demo label="بقيمة محددة" note="القيمة المختارة تظهر كاملة، وتُقص الاخيرة بسطر واحد عند الضيق.">
              <Select
                options={EQUIPMENT_OPTIONS}
                value={equipmentValue}
                onValueChange={setEquipmentValue}
              />
            </Demo>

            <Demo
              label="خيار معطل داخل القائمة"
              note="B113 معطل. يبقى ظاهرا للسياق لكن لا يمكن اختياره."
            >
              <Select
                options={EQUIPMENT_OPTIONS}
                value={equipmentValue}
                onValueChange={setEquipmentValue}
              />
            </Demo>

            <Demo
              label="بوصف ثانوي"
              note="السطر الثاني يظهر في القائمة فقط ولا يُنسخ الى الحقل، ليبقى الحقل بسطر واحد."
            >
              <Select
                options={DRIVER_OPTIONS}
                value={driverValue}
                onValueChange={setDriverValue}
                placeholder="اختر سائقا"
              />
            </Demo>

            <Demo
              label="داخل Field مع تلميح"
              note="Field يربط العنوان والحقل والتلميح لقارئ الشاشة."
            >
              <Field label="نوع المعدة" hint="اختر من القائمة المعتمدة.">
                {(control) => (
                  <Select
                    {...control}
                    options={EQUIPMENT_OPTIONS}
                    value={fieldValue}
                    onValueChange={setFieldValue}
                    placeholder="اختر"
                  />
                )}
              </Field>
            </Demo>

            <Demo
              label="حالة غير صالحة"
              note="Field يمرر invalid تلقائيا حين يوجد خطا، فيتلون الحد بالاحمر."
            >
              <Field
                label="المشروع"
                error="اختيار المشروع مطلوب."
                required
              >
                {(control) => (
                  <Select
                    {...control}
                    options={PROJECT_OPTIONS}
                    value={invalidValue}
                    onValueChange={setInvalidValue}
                    placeholder="اختر المشروع"
                  />
                )}
              </Field>
            </Demo>

            <Demo
              label="الحجم الصغير (28 بكسل)"
              note="للجداول واشرطة الادوات، مثل Button وMultiSelect."
            >
              <Select
                size="sm"
                options={EQUIPMENT_OPTIONS}
                value={smallValue}
                onValueChange={setSmallValue}
              />
            </Demo>

            <Demo label="معطل" note="disabled يوقف الفتح ويخفض الشفافية.">
              <Select
                options={EQUIPMENT_OPTIONS}
                value="a282"
                disabled
                onValueChange={() => undefined}
              />
            </Demo>
          </div>

          <Props
            rows={[
              ['options', 'SelectOption[]', 'value غير فارغة، مع label ووصف اختياري وخيار معطل.'],
              ['value / defaultValue', 'string', 'استخدم value مع onValueChange للتحكم الكامل.'],
              ['placeholder', 'string', 'يظهر حين لا توجد قيمة، بلون واحد في كل الحقول.'],
              ['size', "'md' | 'sm'", 'sm = 28 بكسل للجداول.'],
              ['invalid', 'boolean', 'Field يمرره تلقائيا عند وجود خطا.'],
              ['disabled', 'boolean', 'يمنع التفاعل بالكامل.'],
            ]}
          />
        </Section>

        {/* ============================ 2) ui/MultiSelect ============================ */}
        <Section
          id="multi-select"
          title="اختيار متعدد — MultiSelect"
          note="تصفية بعدة قيم: قائمة مربعات اختيار حقيقية داخل لوحة Radix Popover، فتعمل بلوحة المفاتيح ويعلن قارئ الشاشة حالة كل خيار. لا يزيد ارتفاع الحقل مهما زاد المحدد: يسمي خيارا او خيارين ثم يلخص العدد."
          source="src/components/ui/MultiSelect.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Demo
              label="لا شيء محدد = الكل"
              note="الاختيار الفارغ يعني «بلا تصفية»، وهو سلوك كل الفلاتر في النظام."
            >
              <MultiSelect
                options={OWNER_OPTIONS}
                value={ownersNone}
                onValueChange={setOwnersNone}
              />
            </Demo>

            <Demo
              label="ثلاثة محددة (بالعدد)"
              note="اكثر من خيارين يلخص العدد بدلا من سرد الاسماء."
            >
              <MultiSelect
                options={OWNER_OPTIONS}
                value={ownersThree}
                onValueChange={setOwnersThree}
                summaryLabel={(count) => `${count} ملاك`}
              />
            </Demo>

            <Demo
              label="بشرائح قابلة للازالة"
              note="chips يعرض المحدد تحت الحقل، وكل شريحة تُزال بضغطة."
            >
              <MultiSelect
                options={OWNER_OPTIONS}
                value={ownersChips}
                onValueChange={setOwnersChips}
                chips
                summaryLabel={(count) => `${count} ملاك`}
              />
            </Demo>

            <Demo label="الحجم الصغير" note="نفس مقاس الحقل المعياري في الجداول.">
              <MultiSelect
                size="sm"
                options={OWNER_OPTIONS}
                value={ownersSmall}
                onValueChange={setOwnersSmall}
                summaryLabel={(count) => `${count} ملاك`}
              />
            </Demo>

            <Demo label="معطل">
              <MultiSelect
                options={OWNER_OPTIONS}
                value={['takween']}
                onValueChange={() => undefined}
                disabled
              />
            </Demo>
          </div>

          <Props
            rows={[
              ['options', 'MultiSelectOption[]', 'label نص ووصف اختياري لكل خيار.'],
              ['value', 'string[]', 'مصفوفة فارغة تعني الكل، لا «لا شيء».'],
              ['summaryLabel', '(count) => string', 'صياغة الملخص، مثل «3 ملاك».'],
              ['summaryAfter', 'number', 'عدد الخيارات الذي يبدا بعده التلخيص (افتراضي 2).'],
              ['chips', 'boolean', 'عرض المحدد كشرائح قابلة للازالة تحت الحقل.'],
              ['size / disabled / invalid', '—', 'مثل الحقل المعياري.'],
            ]}
          />
        </Section>

        {/* ============================ 3) Legacy Select ============================ */}
        <Section
          id="legacy-select"
          title="الحقل القديم — components/Select"
          note="الحقل المستخدم في الشاشات القائمة قبل نقلها الى نظام ui. قائمته تُرسم في portal وتقبل البحث المحلي، لكنه لا يدعم الوصف الثانوي ولا الحالة غير الصالحة ولا الحجم الصغير. لا تستخدمه في شاشات جديدة."
          source="src/components/Select.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Demo label="عادي" note="value وonChange بنمط قديم (لا onValueChange).">
              <LegacySelect
                options={LEGACY_OPTIONS}
                value={legacyValue}
                onChange={setLegacyValue}
              />
            </Demo>

            <Demo label="قابل للبحث" note="بحث محلي داخل القائمة، بلا نداء للخادم.">
              <LegacySelect
                options={LEGACY_OPTIONS}
                value={legacySearchValue}
                onChange={setLegacySearchValue}
                placeholder="اختر موقعا"
                searchable
              />
            </Demo>
          </div>

          <Props
            rows={[
              ['value', 'string', 'القيمة الحالية، والنص الفارغ يعني بلا اختيار.'],
              ['onChange', '(value: string) => void', 'يستقبل القيمة وحدها.'],
              ['options', 'SelectOption[]', 'قيمة وعنوان فقط.'],
              ['searchable', 'boolean', 'بحث محلي في القائمة.'],
              ['placeholder', 'string', 'يظهر حين لا توجد قيمة.'],
            ]}
          />
        </Section>

        {/* ============================ 4) AsyncSearchSelect ============================ */}
        <Section
          id="async-select"
          title="بحث غير متزامن — AsyncSearchSelect"
          note="للعلاقات الكبيرة (سائق، معدة، مورد): البحث على الخادم، اول 20 نتيجة، تاخير 300 مللي ثانية، بلا تحميل تابع. هنا يُحاكى الخادم ببيانات ثابتة و180 مللي ثانية. يدعم شارة حالة بجانب العنوان وسطرا ثانويا وزر انشاء."
          source="src/components/AsyncSearchSelect.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Demo
              label="بحث على الخادم"
              note="اكتب حرفا او اكثر: النتائج تُصفى بعد التاخير، والقائمة تُقفل عند 20 نتيجة."
            >
              <AsyncSearchSelect
                value={asyncValue}
                selectedOption={asyncOption}
                onChange={(value, option) => {
                  setAsyncValue(value)
                  setAsyncOption(option)
                }}
                loadOptions={loadEquipmentOptions}
                placeholder="ابحث برقم المعدة او نوعها"
              />
            </Demo>

            <Demo
              label="بشارة حالة"
              note="A282 «داخل موقع»، وF76 «في الورشة»: الشارة للمعلومة لا للاختيار."
            >
              <AsyncSearchSelect
                value={asyncValue}
                selectedOption={asyncOption}
                onChange={(value, option) => {
                  setAsyncValue(value)
                  setAsyncOption(option)
                }}
                loadOptions={loadEquipmentOptions}
                placeholder="جرب A282 او F76"
              />
            </Demo>

            <Demo
              label="مع زر انشاء"
              note="يظهر حين يكتب المستخدم نصا لا يوجد في القائمة."
            >
              <AsyncSearchSelect
                value={createValue}
                selectedOption={createOption}
                onChange={(value, option) => {
                  setCreateValue(value)
                  setCreateOption(option)
                }}
                loadOptions={loadEquipmentOptions}
                onCreate={() => undefined}
                createLabel="اضافة معدة جديدة"
                placeholder="ابحث او اضف"
              />
            </Demo>

            <Demo label="حالة غير صالحة" note="حد احمر ورسالة تحت الحقل.">
              <Field label="المعدة" error="المعدة مطلوبة." required>
                {(control) => (
                  <AsyncSearchSelect
                    {...control}
                    value={invalidAsyncValue}
                    selectedOption={invalidAsyncOption}
                    onChange={(value, option) => {
                      setInvalidAsyncValue(value)
                      setInvalidAsyncOption(option)
                    }}
                    loadOptions={loadEquipmentOptions}
                    placeholder="اختر معدة"
                  />
                )}
              </Field>
            </Demo>

            <Demo label="معطل">
              <AsyncSearchSelect
                value=""
                onChange={() => undefined}
                loadOptions={loadEquipmentOptions}
                disabled
                placeholder="غير متاح"
              />
            </Demo>
          </div>

          <Props
            rows={[
              ['loadOptions', '(query) => Promise<Option[]>', 'البحث على الخادم. اجعل الدالة ثابتة (خارج العنصر) لتجنب اعادة النداء.'],
              ['value', 'string', 'معرف الخيار المحدد.'],
              ['selectedOption', 'Option | null', 'العنوان المعروض حين لا تكون القائمة مفتوحة.'],
              ['onChange', '(value, option) => void', 'يمرر الخيار كاملا مع الشارة والوصف.'],
              ['onCreate / createLabel', '—', 'زر انشاء حين لا توجد نتيجة مطابقة.'],
              ['invalid / disabled', 'boolean', 'Field يمرر invalid تلقائيا.'],
            ]}
          />
        </Section>

        {/* ============================ 5) AsyncMultiSelect ============================ */}
        <Section
          id="async-multi"
          title="متعدد غير متزامن — AsyncMultiSelect"
          note="اختيار عدة قيم من مصدر كبير. يدعم loadAllOptions لزر «تحديد الكل» بدلا من جلب كل السجلات فور الفتح."
          source="src/components/AsyncMultiSelect.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Demo
              label="اختيار متعدد مع «تحديد الكل»"
              note="المحدد يظهر كشرائح والازالة بضغطة."
            >
              <AsyncMultiSelect
                value={multiValue}
                onChange={setMultiValue}
                loadOptions={loadProjectOptions}
                loadAllOptions={loadAllProjectOptions}
                placeholder="اختر المواقع"
              />
            </Demo>

            <Demo label="معطل">
              <AsyncMultiSelect
                value={[]}
                onChange={() => undefined}
                loadOptions={loadProjectOptions}
                disabled
                placeholder="غير متاح"
              />
            </Demo>
          </div>

          <Props
            rows={[
              ['loadOptions', '(query) => Promise<Option[]>', 'بحث على الخادم، 300 مللي ثانية تاخير.'],
              ['loadAllOptions', '() => Promise<Option[]>', 'يمكّن زر تحديد الكل (لا يُنفذ فور الفتح).'],
              ['value', 'SelectOption[]', 'الخيارات المحددة كاملة، لا المعرفات فقط.'],
              ['onChange', '(value: SelectOption[]) => void', 'يستقبل المصفوفة الجديدة.'],
              ['disabled', 'boolean', 'يمنع التفاعل.'],
            ]}
          />
        </Section>

        {/* ============================ 6) المقارنة ============================ */}
        <Section
          id="compare"
          title="اي حقل تستخدم؟"
          note="القاعدة العملية: القائمة الثابتة القصيرة تبقى في الواجهة، والعلاقة الكبيرة تُبحث على الخادم."
          source="—"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="text-start font-medium">الحقل</th>
                  <th className="text-start font-medium">استخدمه حين</th>
                  <th className="text-start font-medium">تجنبه حين</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'ui/Select',
                    'قائمة ثابتة قصيرة داخل نموذج، او قيمة واحدة معلومة المصدر.',
                    'اكثر من 50 خيارا او مصدر يتغير كثيرا.',
                  ],
                  [
                    'ui/MultiSelect',
                    'تصفية بعدة قيم في شريط ادوات او تقرير.',
                    'اختيار قيمة واحدة، او مصدر كبير.',
                  ],
                  [
                    'components/Select',
                    'شاشات قائمة لم تُنقل بعد.',
                    'اي شاشة جديدة.',
                  ],
                  [
                    'AsyncSearchSelect',
                    'علاقة كبيرة: سائق، معدة، مورد، مشروع.',
                    'قائمة ثابتة من عنصرين او ثلاثة.',
                  ],
                  [
                    'AsyncMultiSelect',
                    'علاقة كبيرة بقيم متعددة مع «تحديد الكل».',
                    'حين لا يلزم الا خيار واحد.',
                  ],
                ].map(([name, when, avoid]) => (
                  <tr key={name} className="border-t">
                    <td className="py-2 pe-3">
                      <bdi className="font-mono text-[11px]">{name}</bdi>
                    </td>
                    <td className="py-2 pe-3">{when}</td>
                    <td className="py-2 text-muted">{avoid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-[11px] text-muted">
            <Badge tone="info">قيد التوسعة</Badge>
            <span>
              الاقسام التالية: حقول النصوص والتاريخ، الازرار، الشرائح، الجداول،
              الحوارات. ولمراجعة النظام البصري كاملا يوجد مسار
            </span>
            <bdi className="font-mono">/ui-kit</bdi>
          </div>
        </Section>
      </div>
    </div>
  )
}
