import { useMemo, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  DataTable,
  MultiSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@/components/ui'

// «المعدات في المشاريع» (owner request 2026-10-24): a purchasing sub-page
// listing every unit inside a project now, with its open SPO at the end of
// the row, or an «اضافة الى امر شراء» button when it has none. Three
// candidate designs on sample data; nothing here reads or writes Supabase.

type Owner =
  | 'alazani'
  | 'takween'
  | 'third_party_f'
  | 'third_party_partnership_b'
  | 'external_supplier'

type Unit = {
  id: string
  code: string
  plate: string
  type: string
  owner: Owner
  /** The supplier's name for «مالك اخر» units. */
  lessor?: string
  company: string
  project: string
  /** dd/mm/yyyy of the open site entry. */
  since: string
  /** The open SPO the unit's card sits on, if any. */
  spo?: string
}

const OWNER_LABEL: Record<Owner, string> = {
  alazani: 'العزاني',
  takween: 'تكوين',
  third_party_f: 'طرف ثالث F',
  third_party_partnership_b: 'طرف ثالث B',
  external_supplier: 'مالك اخر',
}

const UNITS: Unit[] = [
  {
    id: '1',
    code: 'U243',
    plate: '1223-UTA',
    type: 'BOOM TRUCK 15 TON',
    owner: 'external_supplier',
    lessor: 'شركة الابراج المتحدة العربية',
    company: 'شركة المباني مقاولون عامون',
    project: 'مشروع طريق الملك خالد - KKR',
    since: '05/08/2026',
    spo: 'SPO260044',
  },
  {
    id: '2',
    code: 'U245',
    plate: '16504464',
    type: 'WALK BEHIND ROLLER',
    owner: 'external_supplier',
    lessor: 'شركة اركاس العالمية',
    company: 'شركة المباني مقاولون عامون',
    project: 'مشروع طريق الملك خالد - KKR',
    since: '05/08/2026',
    spo: 'SPO260041',
  },
  {
    id: '3',
    code: 'U251',
    plate: '7712-KSA',
    type: 'WATER TANKER',
    owner: 'external_supplier',
    lessor: 'مؤسسة ناصر سليمان الناصر',
    company: 'شركة المباني مقاولون عامون',
    project: 'مشروع طريق الملك خالد - KKR',
    since: '12/10/2026',
  },
  {
    id: '4',
    code: 'A063',
    plate: '7533-JAA',
    type: 'CRANE 55 TON',
    owner: 'alazani',
    company: 'شركة المباني مقاولون عامون',
    project: 'مشروع طريق الملك خالد - KKR',
    since: '19/04/2026',
    spo: 'SPO260022',
  },
  {
    id: '5',
    code: 'A341',
    plate: '7154-YVV',
    type: 'CRANE 500 TON',
    owner: 'alazani',
    company: 'شركة المباني مقاولون عامون',
    project: 'الدرعية',
    since: '04/08/2026',
  },
  {
    id: '6',
    code: 'TK-TH-04',
    plate: '5904-SXA',
    type: 'TRUCK HEAD',
    owner: 'takween',
    company: 'شركة المباني مقاولون عامون',
    project: 'الدرعية',
    since: '09/09/2025',
    spo: 'SPO260035',
  },
  {
    id: '7',
    code: 'B113',
    plate: '4996-MAA',
    type: 'CRANE 220 TON',
    owner: 'third_party_partnership_b',
    company: 'شركة المباني مقاولون عامون',
    project: 'الدرعية',
    since: '16/10/2025',
  },
  {
    id: '8',
    code: 'U032',
    plate: '—',
    type: 'WALK BEHIND ROLLER',
    owner: 'external_supplier',
    lessor: 'شركة اركاس العالمية',
    company: 'شركة سالبني العربية السعودية',
    project: 'الدرعية',
    since: '09/09/2025',
    spo: 'SPO260040',
  },
  {
    id: '9',
    code: 'U254',
    plate: '3301-RHA',
    type: 'SKID STEER',
    owner: 'external_supplier',
    lessor: 'مؤسسة ناصر سليمان الناصر',
    company: 'شركة سالبني العربية السعودية',
    project: 'الدرعية',
    since: '01/10/2026',
  },
  {
    id: '10',
    code: 'F120',
    plate: '8810-DHW',
    type: 'DUMP TRUCK',
    owner: 'third_party_f',
    company: 'شركة سالبني العربية السعودية',
    project: 'الدرعية',
    since: '21/10/2026',
  },
  {
    id: '11',
    code: 'TK-DT-16',
    plate: '3833-YRA',
    type: 'SIX DUMP TRUCK',
    owner: 'takween',
    company: 'تضامن فرع شركة بويج',
    project: 'مركز التنس القدية',
    since: '21/10/2026',
    spo: 'SPO260034',
  },
  {
    id: '12',
    code: 'U284',
    plate: '6640-KLM',
    type: 'WHEEL LOADER',
    owner: 'external_supplier',
    lessor: 'شركة دينسون ايست تريدنج',
    company: 'تضامن فرع شركة بويج',
    project: 'مركز التنس القدية',
    since: '17/07/2026',
    spo: 'SPO260037',
  },
  {
    id: '13',
    code: 'U290',
    plate: '2277-NHY',
    type: 'FORKLIFT 5 TON',
    owner: 'external_supplier',
    lessor: 'شركة دينسون ايست تريدنج',
    company: 'تضامن فرع شركة بويج',
    project: 'مركز التنس القدية',
    since: '22/10/2026',
  },
]

const OWNER_OPTIONS = (Object.keys(OWNER_LABEL) as Owner[]).map((value) => ({
  value,
  label: OWNER_LABEL[value],
}))

function ownerLine(unit: Unit) {
  return unit.owner === 'external_supplier' && unit.lessor
    ? unit.lessor
    : OWNER_LABEL[unit.owner]
}

function UnitCell({
  unit,
  withType = true,
}: {
  unit: Unit
  withType?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-baseline gap-1.5">
        <bdi dir="ltr" className="font-semibold">
          {unit.code}
        </bdi>
        <bdi dir="ltr" className="text-[11px] text-muted">
          {unit.plate}
        </bdi>
      </span>
      {withType && <span className="text-xs text-muted">{unit.type}</span>}
    </span>
  )
}

/** The end of every row: the SPO as a link-like chip, or the add button. */
function PoCell({ unit, compact = false }: { unit: Unit; compact?: boolean }) {
  if (unit.spo)
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-semibold underline-offset-2 hover:bg-surface-hover hover:underline"
      >
        <FileText
          size={13}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-muted"
        />
        <bdi dir="ltr">{unit.spo}</bdi>
      </button>
    )
  return (
    <Button
      size="sm"
      variant={compact ? 'outline' : 'primary'}
      icon={<Plus size={13} aria-hidden="true" />}
    >
      اضافة الى امر شراء
    </Button>
  )
}

function useFiltered(owners: string[]) {
  return useMemo(
    () =>
      owners.length === 0
        ? UNITS
        : UNITS.filter((u) => owners.includes(u.owner)),
    [owners],
  )
}

function OwnerFilter({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <MultiSelect
      size="sm"
      className="w-48"
      options={OWNER_OPTIONS}
      value={value}
      onValueChange={onChange}
      allLabel="كل الملاك"
      summaryLabel={(count) => `${count} ملاك`}
    />
  )
}

/* ── 1 · grouped by company · project ─────────────────────────────── */

function GroupedDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const units = useFiltered(owners)
  const groups = useMemo(() => {
    const map = new Map<string, Unit[]>()
    for (const unit of units) {
      const key = `${unit.company}|${unit.project}`
      map.set(key, [...(map.get(key) ?? []), unit])
    }
    return [...map.entries()]
  }, [units])
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          كل مشروع قسم لحاله، وجنبه كم معدة عليها امر من الكل.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      {groups.map(([key, rows]) => {
        const covered = rows.filter((u) => u.spo).length
        const [company, project] = key.split('|')
        return (
          <section
            key={key}
            className="overflow-hidden rounded-xl border bg-bg"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-surface px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{project}</p>
                <p className="truncate text-xs text-muted">{company}</p>
              </div>
              <Badge tone={covered === rows.length ? 'success' : 'warning'}>
                {covered} من {rows.length} عليها امر
              </Badge>
            </header>
            <ul className="divide-y">
              {rows.map((unit) => (
                <li
                  key={unit.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]"
                >
                  <div className="min-w-[9rem] flex-1">
                    <UnitCell unit={unit} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {ownerLine(unit)}
                  </span>
                  <span className="hidden w-24 text-xs text-muted sm:block">
                    منذ <bdi dir="ltr">{unit.since}</bdi>
                  </span>
                  <span className="flex w-full justify-end sm:w-auto">
                    <PoCell unit={unit} compact />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ── 2 · a to-do list: missing first ──────────────────────────────── */

function TodoDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const units = useFiltered(owners)
  const missing = units.filter((u) => !u.spo)
  const covered = units.filter((u) => u.spo)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          الصفحة قائمة شغل: اللي بلا امر فوق وبارزة، واللي عليها امر تحت بهدوء.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          بلا امر شراء
          <Badge tone="warning" size="sm">
            {missing.length}
          </Badge>
        </h4>
        {missing.length === 0 ? (
          <p className="rounded-xl border bg-surface px-4 py-6 text-center text-sm text-muted">
            كل المعدات عليها امر شراء.
          </p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {missing.map((unit) => (
              <li
                key={unit.id}
                className="flex items-center gap-3 rounded-xl border bg-bg p-3 text-[13px]"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <UnitCell unit={unit} />
                  <p className="truncate text-xs text-muted">
                    {ownerLine(unit)} · {unit.project}
                  </p>
                </div>
                <PoCell unit={unit} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-muted">
          عليها امر شراء
          <Badge size="sm">{covered.length}</Badge>
        </h4>
        <ul className="divide-y rounded-xl border bg-bg">
          {covered.map((unit) => (
            <li
              key={unit.id}
              className="flex items-center gap-3 px-3 py-2 text-[13px] text-muted"
            >
              <bdi dir="ltr" className="w-20 shrink-0 font-semibold text-fg">
                {unit.code}
              </bdi>
              <span className="min-w-0 flex-1 truncate">
                {ownerLine(unit)} · {unit.project}
              </span>
              <PoCell unit={unit} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ── 3 · one table with quick filters ─────────────────────────────── */

type Quick = 'all' | 'missing' | 'covered'

function TableDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const [quick, setQuick] = useState<Quick>('all')
  const units = useFiltered(owners)
  const counts = {
    all: units.length,
    missing: units.filter((u) => !u.spo).length,
    covered: units.filter((u) => u.spo).length,
  }
  const rows = units.filter((u) =>
    quick === 'all' ? true : quick === 'missing' ? !u.spo : Boolean(u.spo),
  )
  const columns: DataTableColumn<Unit>[] = [
    { key: 'unit', header: 'المعدة', cell: (u) => <UnitCell unit={u} /> },
    {
      key: 'owner',
      header: 'المالك · المورد',
      hideBelow: 'md',
      cell: (u) => (
        <span className="block max-w-[12rem] truncate">{ownerLine(u)}</span>
      ),
    },
    {
      key: 'project',
      header: 'الشركة · المشروع',
      hideBelow: 'sm',
      cell: (u) => (
        <span className="flex max-w-[14rem] flex-col">
          <span className="truncate">{u.company}</span>
          <span className="truncate text-xs text-muted">{u.project}</span>
        </span>
      ),
    },
    {
      key: 'since',
      header: 'تاريخ الدخول',
      hideBelow: 'lg',
      cell: (u) => <bdi dir="ltr">{u.since}</bdi>,
    },
    {
      key: 'po',
      header: 'امر الشراء',
      align: 'end',
      cell: (u) => <PoCell unit={u} compact />,
    },
  ]
  const QUICK: { value: Quick; label: string }[] = [
    { value: 'all', label: 'الكل' },
    { value: 'missing', label: 'بلا امر' },
    { value: 'covered', label: 'عليها امر' },
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={quick === item.value ? 'primary' : 'outline'}
              onClick={() => setQuick(item.value)}
            >
              {item.label}
              <span className="ms-1 tabular-nums opacity-70">
                {counts[item.value]}
              </span>
            </Button>
          ))}
        </div>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        cellTextClassName="text-[13px]"
        cellClassName="py-2"
        rowClassName={(u) => (u.spo ? undefined : 'bg-warning-soft')}
        caption="المعدات في المشاريع"
      />
    </div>
  )
}

export function SiteUnitsMockup() {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">المعدات في المشاريع</h3>
        <p className="text-xs text-muted">
          قسم جديد تحت «المشتريات»: كل معدة داخل مشروع الحين (دخول مفتوح)، بكل
          الملاك مع فلتر المالك. آخر الصف رقم امر الشراء المفتوح، او زر «اضافة
          الى امر شراء» لو مالها. ثلاث نماذج ببيانات عينة، اختر واحد.
        </p>
      </div>
      <Tabs defaultValue="grouped">
        <TabsList variant="segmented">
          <TabsTrigger value="grouped">1 · حسب المشروع</TabsTrigger>
          <TabsTrigger value="todo">2 · قائمة شغل</TabsTrigger>
          <TabsTrigger value="table">3 · جدول بفلاتر سريعة</TabsTrigger>
        </TabsList>
        <TabsContent value="grouped" className="pt-3">
          <GroupedDesign />
        </TabsContent>
        <TabsContent value="todo" className="pt-3">
          <TodoDesign />
        </TabsContent>
        <TabsContent value="table" className="pt-3">
          <TableDesign />
        </TabsContent>
      </Tabs>
    </section>
  )
}
