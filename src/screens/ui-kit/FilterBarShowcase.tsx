import { useMemo, useState } from 'react'
import type { Language } from '@/i18n/translations'
import { Card } from '@/components/ui'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import type { FilterBarAsyncField } from '@/components/data-list/FilterBar'
import type { ListFilter } from '@/components/data-list/types'
import { logsListConfig } from '@/lib/listConfigs'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'

// Review of the filter dialog on /ui-kit (owner review, 2026-09-29). The
// toolbar and the dialog are the real shared components wired to the real
// `/logs` config, so the fields, the allowlist and the emitted filters are
// exactly what the list produces; only the relational searches use sample
// data instead of the database.

type DemoLang = Language

const COPY: Record<
  DemoLang,
  {
    heading: string
    description: string
    barTitle: string
    barNote: string
    outputTitle: string
    outputEmpty: string
    notesTitle: string
    notes: string[]
  }
> = {
  ar: {
    heading: 'نافذة الفلاتر',
    description:
      'الفلاتر خلف زر «الفلاتر» في شريط القائمة: نافذة بعنوان ووصف، فيها حقل صغير لكل فلتر مسموح به في اعدادات القائمة، وفي اسفلها «مسح الكل» و«تم».',
    barTitle: 'شريط القائمة مع زر الفلاتر',
    barNote:
      'يظهر عدد الفلاتر النشطة على الزر. القوائم التي ليس لها حقول فلترة (الشركات والمشاريع والملاك) لا تعرض الزر.',
    outputTitle: 'الناتج المرسل للقائمة (ListFilter[])',
    outputEmpty: 'لا توجد فلاتر نشطة',
    notesTitle: 'ملاحظات المراجعة',
    notes: [
      'التطبيق فوري: كل تغيير يصل للقائمة مباشرة ويحفظ في الرابط، والنص ينتظر 300 ms قبل الارسال.',
      'وقت الحركة حقل واحد: اليوم او هذا الاسبوع او هذا الشهر او فترة مخصصة من/الى، ويرسل between او gte او lte بحدود اليوم بتوقيت السعودية.',
      'الشركة والمشروع اختيار متعدد ببحث من الخادم (اول 20 نتيجة) ويرسلان in بالمعرفات.',
      'كل الحقول بالحجم الصغير 28 بكسل، والنافذة تعمل على الجوال بعمود واحد.',
      'جرب الوضع الداكن والفاتح من شريط الصفحة، وقلص العرض لرؤية وضع الجوال.',
    ],
  },
  en: {
    heading: 'Filter dialog',
    description:
      'Filters sit behind the toolbar’s "Filters" button: a dialog with a title and description, one small control per allowlisted field, and "Clear all" / "Done" in the footer.',
    barTitle: 'List toolbar with the filters button',
    barNote:
      'The button shows the active count. Lists with no filter fields (companies, projects, lessors) hide it.',
    outputTitle: 'What the list receives (ListFilter[])',
    outputEmpty: 'No active filters',
    notesTitle: 'Review notes',
    notes: [
      'Changes apply immediately and persist in the URL; text waits 300 ms first.',
      'Movement time is one range field (today, this week, this month or a custom from/to) emitting between, gte or lte on Saudi-day boundaries.',
      'Company and project are multi-selects with server-side search (first 20) emitting in with ids.',
      'Every control is the small 28 px size; on a phone the dialog is one column.',
      'Try light and dark from the page bar, and narrow the window for the mobile layout.',
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

/** Sample companies and projects for the multi-select fields. */
const COMPANIES: AsyncSearchSelectOption[] = [
  { value: 'c1', label: 'شركة عبدالله العزاني للمقاولات' },
  { value: 'c2', label: 'شركة تكوين المعدات' },
  { value: 'c3', label: 'مؤسسة البناء الحديث' },
]
const PROJECTS: AsyncSearchSelectOption[] = [
  { value: 'p1', label: 'مشروع طريق الملك فهد' },
  { value: 'p2', label: 'مشروع حي الياسمين' },
  { value: 'p3', label: 'مشروع جسر الدمام' },
]

function sampleSearch(
  list: AsyncSearchSelectOption[],
): FilterBarAsyncField['loadOptions'] {
  return (query) => {
    const text = query.trim()
    const matches = text
      ? list.filter((option) => option.label.includes(text))
      : list
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(matches.slice(0, 20)), 200)
    })
  }
}

function sampleField(list: AsyncSearchSelectOption[]): FilterBarAsyncField {
  return {
    loadOptions: sampleSearch(list),
    resolveOptions: async (values) =>
      list.filter((option) => values.includes(option.value)),
  }
}

function DemoPanel({ lang }: { lang: DemoLang }) {
  const copy = COPY[lang]
  const [filters, setFilters] = useState<ListFilter[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(logsListConfig.defaultSort)
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const asyncFields = useMemo(
    () => ({
      supervisor_id: { loadOptions: sampleSearch(FOREMEN) },
      company_id: sampleField(COMPANIES),
      project_id: sampleField(PROJECTS),
    }),
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
      <DataListToolbar
        config={logsListConfig}
        search={search}
        onSearch={setSearch}
        sort={sort}
        direction={direction}
        onSort={(field, dir) => {
          setSort(field)
          setDirection(dir)
        }}
        filterFields={logsListConfig.filterFields}
        filters={filters}
        onFilters={setFilters}
        asyncFields={asyncFields}
      />

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">{copy.outputTitle}</h3>
        <pre
          dir="ltr"
          className="mt-2 max-h-48 overflow-auto rounded-lg border bg-surface p-3 text-start text-xs text-muted"
        >
          {filters.length
            ? JSON.stringify(
                filters.map(({ field, operator, value, valueTo }) => ({
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
