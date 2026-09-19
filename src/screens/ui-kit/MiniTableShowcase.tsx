import { useMemo, useState } from 'react'
import { Button, DataTable, WorkshopPurposeBadge } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
// Imported directly: MiniTable is not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { MiniTable, MiniTableGrid } from '@/components/ui/MiniTable'

// Review of MiniTable on /ui-kit. All data below is sample data. The demo
// language toggle only swaps the sample rows/headers below; shared chrome
// such as the "View all" action keeps following the app's real language.

type DemoLang = 'ar' | 'en'

type CompanyRow = { id: string; name: Record<DemoLang, string>; count: number }
type ForemanRow = {
  id: string
  name: string
  company: Record<DemoLang, string>
  active: number
}
type WorkshopRow = {
  id: string
  code: string
  type: Record<DemoLang, string>
  purpose: 'maintenance' | 'parking'
  days: number
}

const COMPANY_ROWS: CompanyRow[] = [
  {
    id: '1',
    name: { ar: 'شركة البناء الحديث', en: 'Modern Build Co.' },
    count: 42,
  },
  {
    id: '2',
    name: { ar: 'مؤسسة الطرق والجسور', en: 'Roads & Bridges Est.' },
    count: 35,
  },
  {
    id: '3',
    name: { ar: 'شركة الاعمار المتحدة', en: 'United Development Co.' },
    count: 29,
  },
  {
    id: '4',
    name: { ar: 'مجموعة الرياض للمقاولات', en: 'Riyadh Contracting Group' },
    count: 21,
  },
  {
    id: '5',
    name: { ar: 'شركة الخليج للانشاءات', en: 'Gulf Construction Co.' },
    count: 17,
  },
]

const FOREMAN_ROWS: ForemanRow[] = [
  {
    id: '1',
    name: 'خالد العتيبي',
    company: { ar: 'شركة البناء الحديث', en: 'Modern Build Co.' },
    active: 9,
  },
  {
    id: '2',
    name: 'سعد القحطاني',
    company: { ar: 'مؤسسة الطرق والجسور', en: 'Roads & Bridges Est.' },
    active: 7,
  },
  {
    id: '3',
    name: 'فهد الحربي',
    company: { ar: 'شركة الاعمار المتحدة', en: 'United Development Co.' },
    active: 6,
  },
  {
    id: '4',
    name: 'ماجد الدوسري',
    company: { ar: 'مجموعة الرياض للمقاولات', en: 'Riyadh Contracting Group' },
    active: 5,
  },
  {
    id: '5',
    name: 'ياسر الشهري',
    company: { ar: 'شركة الخليج للانشاءات', en: 'Gulf Construction Co.' },
    active: 4,
  },
  {
    id: '6',
    name: 'عبدالله المطيري',
    company: { ar: 'شركة البناء الحديث', en: 'Modern Build Co.' },
    active: 3,
  },
]

const WORKSHOP_ROWS: WorkshopRow[] = [
  {
    id: '1',
    code: 'A-1024',
    type: { ar: 'حفار', en: 'Excavator' },
    purpose: 'maintenance',
    days: 21,
  },
  {
    id: '2',
    code: 'TK-208',
    type: { ar: 'رافعة شوكية', en: 'Forklift' },
    purpose: 'parking',
    days: 14,
  },
  {
    id: '3',
    code: 'F-77',
    type: { ar: 'قلاب', en: 'Dump truck' },
    purpose: 'maintenance',
    days: 9,
  },
  {
    id: '4',
    code: 'B-19',
    type: { ar: 'بوكلين', en: 'Backhoe' },
    purpose: 'parking',
    days: 6,
  },
  {
    id: '5',
    code: 'A-311',
    type: { ar: 'شيول', en: 'Loader' },
    purpose: 'maintenance',
    days: 3,
  },
]

const LABELS: Record<
  DemoLang,
  {
    companiesTitle: string
    companiesDescription: string
    company: string
    count: string
    foremenTitle: string
    foremenDescription: string
    name: string
    activeEquipment: string
    workshopTitle: string
    workshopDescription: string
    code: string
    type: string
    days: string
    dayUnit: string
    demoLoading: string
    demoEmpty: string
    demoEmptyMessage: string
    demoError: string
    sizesTitle: string
    sizesDescription: string
  }
> = {
  ar: {
    companiesTitle: 'اعلى الشركات نشاطا',
    companiesDescription: 'حسب عدد المعدات النشطة',
    company: 'الشركة',
    count: 'العدد',
    foremenTitle: 'الفورمين',
    foremenDescription: 'حسب عدد المعدات المفتوحة',
    name: 'الاسم',
    activeEquipment: 'معدات نشطة',
    workshopTitle: 'اطول بقاء بالورشة',
    workshopDescription: 'المعدات المتوقفة حاليا بالورشة',
    code: 'الكود',
    type: 'النوع',
    days: 'المدة',
    dayUnit: 'يوم',
    demoLoading: 'اثناء التحميل',
    demoEmpty: 'لا توجد بيانات',
    demoEmptyMessage: 'لا توجد معدات بالورشة حاليا',
    demoError: 'خطا في التحميل',
    sizesTitle: 'مقارنة احجام الجدول',
    sizesDescription:
      'sm للوحات التحكم المزدحمة، md الافتراضي، lg لصفحة الرئيسية',
  },
  en: {
    companiesTitle: 'Top companies',
    companiesDescription: 'By active equipment count',
    company: 'Company',
    count: 'Count',
    foremenTitle: 'Foremen',
    foremenDescription: 'By open equipment count',
    name: 'Name',
    activeEquipment: 'Active equipment',
    workshopTitle: 'Longest in workshop',
    workshopDescription: 'Equipment currently parked in the workshop',
    code: 'Code',
    type: 'Type',
    days: 'Duration',
    dayUnit: 'days',
    demoLoading: 'Loading',
    demoEmpty: 'No data',
    demoEmptyMessage: 'No equipment is in the workshop right now',
    demoError: 'Load error',
    sizesTitle: 'Row size comparison',
    sizesDescription:
      'sm for dense panels, md is the default, lg for the home page',
  },
}

function buildCompanyColumns(lang: DemoLang): DataTableColumn<CompanyRow>[] {
  const label = LABELS[lang]
  return [
    { key: 'name', header: label.company, cell: (row) => row.name[lang] },
    {
      key: 'count',
      header: label.count,
      align: 'end',
      width: '5rem',
      cell: (row) => <span className="font-semibold">{row.count}</span>,
    },
  ]
}

function buildForemanColumns(lang: DemoLang): DataTableColumn<ForemanRow>[] {
  const label = LABELS[lang]
  return [
    { key: 'name', header: label.name, cell: (row) => row.name },
    { key: 'company', header: label.company, cell: (row) => row.company[lang] },
    {
      key: 'active',
      header: label.activeEquipment,
      align: 'end',
      width: '5rem',
      cell: (row) => <span className="font-semibold">{row.active}</span>,
    },
  ]
}

function buildWorkshopColumns(lang: DemoLang): DataTableColumn<WorkshopRow>[] {
  const label = LABELS[lang]
  return [
    {
      key: 'code',
      header: label.code,
      width: '6rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    { key: 'type', header: label.type, cell: (row) => row.type[lang] },
    {
      key: 'purpose',
      header: '',
      cell: (row) => <WorkshopPurposeBadge purpose={row.purpose} />,
    },
    {
      key: 'days',
      header: label.days,
      align: 'end',
      width: '5rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {row.days} {label.dayUnit}
        </span>
      ),
    },
  ]
}

export function MiniTableShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [clicked, setClicked] = useState<string | null>(null)
  const label = LABELS[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  const companyColumns = useMemo(() => buildCompanyColumns(lang), [lang])
  const foremanColumns = useMemo(() => buildForemanColumns(lang), [lang])
  const workshopColumns = useMemo(() => buildWorkshopColumns(lang), [lang])

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">MiniTable</h3>
          <p className="text-xs text-muted">
            جدول مصغر داخل بطاقة، بحد اقصى للصفوف مع رابط عرض الكل. مصمم ليتكرر
            ثلاثة بجانب بعض بسطح المكتب (MiniTableGrid) ويرصف عموديا بالجوال.
          </p>
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

      <div dir={direction} lang={lang} className="space-y-6">
        <MiniTableGrid>
          <MiniTable
            title={label.companiesTitle}
            description={label.companiesDescription}
            columns={companyColumns}
            rows={COMPANY_ROWS}
            rowKey={(row) => row.id}
            viewAllHref="#mini-table-companies"
          />
          <MiniTable
            title={label.foremenTitle}
            description={label.foremenDescription}
            columns={foremanColumns}
            rows={FOREMAN_ROWS}
            rowKey={(row) => row.id}
            maxRows={5}
            onViewAll={() => setClicked('foremen')}
            onRowClick={(row) => setClicked(row.name)}
          />
          <MiniTable
            title={label.workshopTitle}
            description={label.workshopDescription}
            columns={workshopColumns}
            rows={WORKSHOP_ROWS}
            rowKey={(row) => row.id}
            viewAllHref="#mini-table-workshop"
          />
        </MiniTableGrid>
        {clicked && (
          <p className="text-xs text-muted">
            {lang === 'ar' ? 'اخر تفاعل: ' : 'Last interaction: '}
            {clicked}
          </p>
        )}

        <div className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold text-fg">
              {label.sizesTitle}
            </h4>
            <p className="text-xs text-muted">{label.sizesDescription}</p>
          </div>
          <div className="space-y-3">
            <DataTable
              size="sm"
              columns={companyColumns}
              rows={COMPANY_ROWS}
              rowKey={(row) => row.id}
            />
            <DataTable
              size="md"
              columns={companyColumns}
              rows={COMPANY_ROWS}
              rowKey={(row) => row.id}
            />
            <DataTable
              size="lg"
              columns={companyColumns}
              rows={COMPANY_ROWS}
              rowKey={(row) => row.id}
            />
          </div>
        </div>

        <MiniTableGrid>
          <MiniTable
            title={label.workshopTitle}
            description={label.demoLoading}
            columns={workshopColumns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            loading
          />
          <MiniTable
            title={label.workshopTitle}
            description={label.demoEmpty}
            columns={workshopColumns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            empty={label.demoEmptyMessage}
          />
          <MiniTable
            title={label.workshopTitle}
            description={label.demoError}
            columns={workshopColumns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            error
          />
        </MiniTableGrid>
      </div>
    </section>
  )
}
