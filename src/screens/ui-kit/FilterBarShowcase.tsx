import { useMemo, useState } from 'react'
import type { Language } from '@/i18n/translations'
import { Card } from '@/components/ui'
import { FilterBar } from '@/components/data-list/FilterBar'
import { FilterBuilder } from '@/components/data-list/FilterBuilder'
import type { ListFilter } from '@/components/data-list/types'
import { logsListConfig } from '@/lib/listConfigs'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'

// Review of FilterBar on /ui-kit. Nothing here is wired into a real screen:
// the owner approves the component here first. The config is the real
// `/logs` one, so the fields, the allowlist and the emitted filters are
// exactly what the list system would produce.

type DemoLang = Language

const COPY: Record<
  DemoLang,
  {
    heading: string
    description: string
    barTitle: string
    barNote: string
    builderTitle: string
    builderNote: string
    outputTitle: string
    outputEmpty: string
    notesTitle: string
    notes: string[]
  }
> = {
  ar: {
    heading: 'FilterBar',
    description:
      'صف فلاتر مضغوط يبنى من حقول الفلترة المسموح بها في اعدادات القائمة: قائمة اختيار لكل حقل خيارات، ومدى تاريخ لكل حقل تاريخ، ومربع نص للبحث الحر، وقائمة علائقية بحث فوري للحقول المرتبطة.',
    barTitle: 'الشكل الجديد: صف فلاتر',
    barNote:
      'شبكة من ثلاثة الى اربعة حقول في الصف على الشاشات الكبيرة، وتتحول تحت 768 بكسل الى زر «الفلاتر» مع عدد الفلاتر النشطة.',
    builderTitle: 'الشكل الحالي: باني الفلاتر',
    builderNote:
      'للمقارنة فقط: ثلاث قوائم لكل فلتر (الحقل، المعامل، القيمة) وزر اضافة.',
    outputTitle: 'الناتج المرسل للقائمة (ListFilter[])',
    outputEmpty: 'لا توجد فلاتر نشطة',
    notesTitle: 'ملاحظات المراجعة',
    notes: [
      'الناتج هو نفس شكل ListFilter الذي تستهلكه القوائم اليوم، فلا تتغير الاستعلامات عند التبديل.',
      'حقل التاريخ يرسل between بقيمتي من/الى، والنص يرسل like، وقائمة الخيارات ترسل eq.',
      'حقل الفورمان يعرض هنا بحثا علائقيا (AsyncSearchSelect) باول 20 نتيجة وبحث من الخادم.',
      'اسماء الحقول تقتطع بامان مع تلميح كامل عند الطول، ولا يظهر تمرير افقي.',
      'جرب الوضع الداكن والفاتح من شريط الصفحة، وقلص العرض تحت 768 بكسل لرؤية وضع الجوال.',
    ],
  },
  en: {
    heading: 'FilterBar',
    description:
      'A compact filter row built from a list config’s allowlisted filter fields: a select for option fields, a date range for date fields, a text box for free text, and a relational search for linked fields.',
    barTitle: 'New: filter row',
    barNote:
      'A 3–4 column grid on desktop; below 768 px it collapses behind a "Filters" button with the active count.',
    builderTitle: 'Today: filter builder',
    builderNote:
      'For comparison: three selects per filter (field, operator, value) plus an add button.',
    outputTitle: 'What the list receives (ListFilter[])',
    outputEmpty: 'No active filters',
    notesTitle: 'Review notes',
    notes: [
      'The output is the same ListFilter shape the lists consume today, so queries do not change when a screen swaps.',
      'A date field emits between (from/to), text emits like, an option field emits eq.',
      'The foreman field is shown as a relational search (AsyncSearchSelect): first 20 results, server-side search.',
      'Field labels truncate safely with a full title tooltip; nothing scrolls sideways.',
      'Try light and dark from the page bar, and narrow the window below 768 px for the mobile layout.',
    ],
  },
}

/** Sample foreman list for the relational field; real screens load it from
 *  the profiles table. */
const FOREMEN: AsyncSearchSelectOption[] = [
  { value: 'f1', label: 'سالم العمري', description: 'فورمين — موقع الرياض' },
  { value: 'f2', label: 'ماجد الحربي', description: 'فورمين — موقع جدة' },
  { value: 'f3', label: 'عبدالله الدوسري', description: 'فورمين — الورشة' },
  { value: 'f4', label: 'فهد القحطاني', description: 'فورمين — موقع الدمام' },
]

function loadForemen(query: string): Promise<AsyncSearchSelectOption[]> {
  const text = query.trim()
  const matches = text
    ? FOREMEN.filter((option) => option.label.includes(text))
    : FOREMEN
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(matches.slice(0, 20)), 200)
  })
}

function DemoPanel({ lang }: { lang: DemoLang }) {
  const copy = COPY[lang]
  const [barFilters, setBarFilters] = useState<ListFilter[]>([])
  const [builderFilters, setBuilderFilters] = useState<ListFilter[]>([])
  const asyncFields = useMemo(
    () => ({ supervisor_id: { loadOptions: loadForemen } }),
    [],
  )

  // Only the sample copy below switches language; the shared controls keep
  // following the app's own language toggle, as in the other showcases.
  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      className="space-y-4 rounded-xl border bg-bg p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">{copy.barTitle}</h3>
        <p className="mt-1 text-xs text-muted">{copy.barNote}</p>
      </div>
      <FilterBar
        fields={logsListConfig.filterFields}
        filters={barFilters}
        onChange={setBarFilters}
        asyncFields={asyncFields}
      />

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">{copy.outputTitle}</h3>
        <pre
          dir="ltr"
          className="mt-2 max-h-48 overflow-auto rounded-lg border bg-surface p-3 text-start text-xs text-muted"
        >
          {barFilters.length
            ? JSON.stringify(
                barFilters.map(({ field, operator, value, valueTo }) => ({
                  field,
                  operator,
                  value,
                  ...(valueTo ? { valueTo } : {}),
                })),
                null,
                2,
              )
            : copy.outputEmpty}
        </pre>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">{copy.builderTitle}</h3>
        <p className="mb-3 mt-1 text-xs text-muted">{copy.builderNote}</p>
        <FilterBuilder
          fields={logsListConfig.filterFields}
          filters={builderFilters}
          onChange={setBuilderFilters}
          compact
        />
      </div>
    </div>
  )
}

export function FilterBarShowcase() {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold">{COPY.ar.heading}</h2>
        <p className="mt-1 text-sm text-muted">{COPY.ar.description}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DemoPanel lang="ar" />
        <DemoPanel lang="en" />
      </div>
      <div className="rounded-xl border bg-surface p-4">
        <h3 className="text-sm font-semibold">{COPY.ar.notesTitle}</h3>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-muted">
          {COPY.ar.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
