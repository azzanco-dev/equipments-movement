import { useMemo, useState, type ReactNode } from 'react'
import { Button, DataTable, MovementBadge } from '@/components/ui'
import type { DataTableColumn, DataTableSort } from '@/components/ui'

// Review of the shared DataTable on /ui-kit. All data below is sample data.
// The component itself never sorts: it receives `sort` and reports the next
// sort through `onSortChange`. This preview sorts locally only so the product
// owner can see the header interaction; real screens sort on the server.

type DemoLang = 'ar' | 'en'

type DemoRow = {
  id: string
  code: string
  type: Record<DemoLang, string>
  plate: string
  owner: Record<DemoLang, string>
  /** ISO date, sorted as text and shown as dd/mm/yyyy. */
  lastMovement: string
  movement: 'entry' | 'exit'
}

const DEMO_ROWS: DemoRow[] = [
  {
    id: '1',
    code: 'A-1024',
    type: { ar: 'حفار', en: 'Excavator' },
    plate: '1234 ا ب ج',
    owner: { ar: 'العزاني', en: 'Al-Azani' },
    lastMovement: '2026-09-15',
    movement: 'entry',
  },
  {
    id: '2',
    code: 'TK-208',
    type: { ar: 'رافعة شوكية', en: 'Forklift' },
    plate: '5521 ر س ع',
    owner: { ar: 'تكوين', en: 'Takween' },
    lastMovement: '2026-09-14',
    movement: 'exit',
  },
  {
    id: '3',
    code: 'F-77',
    type: { ar: 'قلاب', en: 'Dump truck' },
    plate: '8810 د ه و',
    owner: { ar: 'طرف ثالث F', en: 'Third party F' },
    lastMovement: '2026-09-12',
    movement: 'entry',
  },
  {
    id: '4',
    code: 'B-19',
    type: { ar: 'بوكلين', en: 'Backhoe' },
    plate: '3092 ز ح ط',
    owner: { ar: 'طرف ثالث B', en: 'Third party B' },
    lastMovement: '2026-09-11',
    movement: 'exit',
  },
  {
    id: '5',
    code: 'A-311',
    type: { ar: 'شيول', en: 'Loader' },
    plate: '6640 ك ل م',
    owner: { ar: 'العزاني', en: 'Al-Azani' },
    lastMovement: '2026-09-10',
    movement: 'entry',
  },
  {
    id: '6',
    code: 'U001',
    type: { ar: 'صهريج ماء', en: 'Water tanker' },
    plate: '2277 ن ه ي',
    owner: { ar: 'مالك اخر', en: 'Other owner' },
    lastMovement: '2026-09-09',
    movement: 'exit',
  },
  {
    id: '7',
    code: 'TK-140',
    type: { ar: 'ونش', en: 'Boom truck' },
    plate: '4501 ص ق ر',
    owner: { ar: 'تكوين', en: 'Takween' },
    lastMovement: '2026-09-08',
    movement: 'entry',
  },
  {
    id: '8',
    code: 'A-905',
    type: { ar: 'كومبريسر', en: 'Compressor' },
    plate: '9933 ت ث خ',
    owner: { ar: 'العزاني', en: 'Al-Azani' },
    lastMovement: '2026-09-06',
    movement: 'exit',
  },
]

const HEADERS: Record<DemoLang, Record<string, string>> = {
  ar: {
    code: 'الكود',
    type: 'النوع',
    plate: 'اللوحة',
    owner: 'المالك',
    lastMovement: 'اخر حركة',
    status: 'الحالة',
  },
  en: {
    code: 'Code',
    type: 'Type',
    plate: 'Plate',
    owner: 'Owner',
    lastMovement: 'Last movement',
    status: 'Status',
  },
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function sortValue(row: DemoRow, key: string, lang: DemoLang) {
  switch (key) {
    case 'code':
      return row.code
    case 'type':
      return row.type[lang]
    case 'plate':
      return row.plate
    case 'owner':
      return row.owner[lang]
    case 'lastMovement':
      return row.lastMovement
    default:
      return ''
  }
}

function buildColumns(lang: DemoLang): DataTableColumn<DemoRow>[] {
  const label = HEADERS[lang]
  return [
    {
      key: 'code',
      header: label.code,
      sortable: true,
      width: '8rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'type',
      header: label.type,
      sortable: true,
      cell: (row) => row.type[lang],
    },
    {
      key: 'plate',
      header: label.plate,
      hideBelow: 'sm',
      cell: (row) => <span dir="ltr">{row.plate}</span>,
    },
    {
      key: 'owner',
      header: label.owner,
      sortable: true,
      hideBelow: 'md',
      cell: (row) => row.owner[lang],
    },
    {
      key: 'lastMovement',
      header: label.lastMovement,
      sortable: true,
      cell: (row) => (
        <span className="text-muted">{formatDate(row.lastMovement)}</span>
      ),
    },
    {
      key: 'status',
      header: label.status,
      align: 'end',
      cell: (row) => <MovementBadge type={row.movement} />,
    },
  ]
}

export function DataTableShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [sort, setSort] = useState<DataTableSort>({
    key: 'lastMovement',
    direction: 'desc',
  })
  const [clicked, setClicked] = useState<string | null>(null)

  const columns = useMemo(() => buildColumns(lang), [lang])
  const rows = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...DEMO_ROWS].sort(
      (a, b) =>
        factor *
        sortValue(a, sort.key, lang).localeCompare(
          sortValue(b, sort.key, lang),
          lang,
          { numeric: true },
        ),
    )
  }, [sort, lang])

  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">الجداول</h3>
          <p className="text-xs text-muted">
            DataTable: الترتيب داخل عنوان العمود نفسه. الضغطة الاولى ترتب
            تصاعدي، والضغطة على نفس العمود تقلبه تنازلي، والتالية ترجع تصاعدي.
            عمود واحد فقط يكون نشط. المكون لا يرتب البيانات بنفسه؛ يستقبل
            الترتيب الحالي ويبلغ عن الترتيب المطلوب حتى يبقى الترتيب من السيرفر.
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

      <Block label="الحجم العادي (صف قابل للضغط)">
        <div dir={direction} lang={lang}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={(key, nextDirection) =>
              setSort({ key, direction: nextDirection })
            }
            onRowClick={(row) => setClicked(row.code)}
            caption={lang === 'ar' ? 'المعدات' : 'Equipment'}
          />
        </div>
        <p className="text-xs text-muted">
          الترتيب الحالي: <span dir="ltr">{sort.key}</span> ·{' '}
          {sort.direction === 'asc' ? 'تصاعدي' : 'تنازلي'}
          {clicked && ` · اخر صف تم اختياره: ${clicked}`}
        </p>
      </Block>

      <Block label="الحجم الصغير (28 بكسل)">
        <div dir={direction} lang={lang}>
          <DataTable
            size="sm"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={(key, nextDirection) =>
              setSort({ key, direction: nextDirection })
            }
          />
        </div>
      </Block>

      <div className="grid gap-4 lg:grid-cols-3">
        <Block label="اثناء التحميل">
          <DataTable
            columns={columns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            loading
            loadingRows={4}
          />
        </Block>
        <Block label="لا توجد نتائج">
          <DataTable
            columns={columns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            empty={
              <span className="space-y-2">
                <span className="block">لا توجد معدات مطابقة للبحث</span>
                <Button size="sm" variant="outline">
                  مسح الفلاتر
                </Button>
              </span>
            }
          />
        </Block>
        <Block label="خطا في التحميل">
          <DataTable
            columns={columns.slice(0, 3)}
            rows={[]}
            rowKey={(row) => row.id}
            error
          />
        </Block>
      </div>
    </section>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  )
}
