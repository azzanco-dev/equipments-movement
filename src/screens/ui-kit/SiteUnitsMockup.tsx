import { useMemo, useState, type ReactNode } from 'react'
import { FileText, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
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
  /** «ترقيم الشركة»: the client company's own number for the unit on the
   *  open site entry (`contractor_equipment_code`), when the foreman set it. */
  contractorCode?: string
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
    contractorCode: 'MB-1042',
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
    contractorCode: 'MB-0877',
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
    contractorCode: 'MB-0215',
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
    contractorCode: 'MB-0390',
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
    contractorCode: 'SA-17',
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
    contractorCode: 'SA-22',
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
    contractorCode: 'BY-305',
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
    contractorCode: 'BY-311',
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

/* ── shared card pieces for designs 4–9 ───────────────────────────── */

/** «ترقيم الشركة» line, only when the foreman set the company's number. */
function CompanyNumber({ unit }: { unit: Unit }) {
  if (!unit.contractorCode) return null
  return (
    <p className="text-xs text-muted">
      ترقيم الشركة{' '}
      <bdi dir="ltr" className="font-medium text-fg">
        {unit.contractorCode}
      </bdi>
    </p>
  )
}

/** One unit as the to-do card the owner liked, for every unit. */
function UnitCard({
  unit,
  context = 'owner-project',
  leading,
  muted = false,
}: {
  unit: Unit
  /** What the second line names besides the unit. */
  context?: 'owner-project' | 'project' | 'owner'
  leading?: ReactNode
  muted?: boolean
}) {
  const second =
    context === 'project'
      ? unit.project
      : context === 'owner'
        ? ownerLine(unit)
        : `${ownerLine(unit)} · ${unit.project}`
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border p-3 text-[13px] ${muted ? 'bg-surface' : 'bg-bg'}`}
    >
      {leading}
      <div className="min-w-0 flex-1 space-y-1">
        <UnitCell unit={unit} />
        <p className="truncate text-xs text-muted">{second}</p>
        <CompanyNumber unit={unit} />
      </div>
      <PoCell unit={unit} />
    </li>
  )
}

function SectionTitle({
  title,
  count,
  tone,
}: {
  title: string
  count: number
  tone?: 'warning' | 'success'
}) {
  return (
    <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      {title}
      <Badge tone={tone} size="sm">
        {count}
      </Badge>
    </h4>
  )
}

function groupBy(units: Unit[], keyOf: (unit: Unit) => string) {
  const map = new Map<string, Unit[]>()
  for (const unit of units)
    map.set(keyOf(unit), [...(map.get(keyOf(unit)) ?? []), unit])
  return [...map.entries()]
}

/** Missing first, then covered, inside any list. */
function missingFirst(units: Unit[]) {
  return [...units.filter((u) => !u.spo), ...units.filter((u) => u.spo)]
}

/* ── 4 · the owner's idea: every unit as a card ──────────────────── */

function AllCardsDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const units = useFiltered(owners)
  const missing = units.filter((u) => !u.spo)
  const covered = units.filter((u) => u.spo)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          فكرتك: قائمة الشغل، بس كل المعدات بنفس البطاقة، مع ترقيم الشركة لو
          موجود.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <section className="space-y-2">
        <SectionTitle
          title="بلا امر شراء"
          count={missing.length}
          tone="warning"
        />
        <ul className="grid gap-2 md:grid-cols-2">
          {missing.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <SectionTitle
          title="عليها امر شراء"
          count={covered.length}
          tone="success"
        />
        <ul className="grid gap-2 md:grid-cols-2">
          {covered.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ── 5 · cards grouped by project ───────────────────────────────── */

function ProjectCardsDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const groups = groupBy(
    useFiltered(owners),
    (u) => `${u.company}|${u.project}`,
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          نفس البطاقات مقسمة حسب المشروع، والناقص فوق داخل كل مشروع. يناسب لما
          تشتغل مشروع مشروع.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      {groups.map(([key, rows]) => {
        const [company, project] = key.split('|')
        const covered = rows.filter((u) => u.spo).length
        return (
          <section key={key} className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{project}</p>
                <p className="truncate text-xs text-muted">{company}</p>
              </div>
              <span className="text-xs text-muted">
                {covered} من {rows.length} عليها امر
              </span>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {missingFirst(rows).map((unit) => (
                <UnitCard key={unit.id} unit={unit} context="owner" />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ── 6 · cards grouped by supplier ──────────────────────────────── */

function SupplierCardsDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const groups = groupBy(useFiltered(owners), ownerLine)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          مقسمة حسب المورد، لان امر الشراء يكون لمورد واحد: تشوف وش ناقص لكل
          مورد وتسوي امره مرة وحدة.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      {groups.map(([supplier, rows]) => {
        const missing = rows.filter((u) => !u.spo).length
        return (
          <section key={supplier} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5">
              <p className="min-w-0 truncate text-sm font-semibold">
                {supplier}
              </p>
              <span className="flex items-center gap-2 text-xs text-muted">
                {rows.length} معدة
                {missing > 0 && (
                  <Badge tone="warning" size="sm">
                    {missing} بلا امر
                  </Badge>
                )}
              </span>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {missingFirst(rows).map((unit) => (
                <UnitCard key={unit.id} unit={unit} context="project" />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ── 7 · two columns side by side ───────────────────────────────── */

function TwoColumnsDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const units = useFiltered(owners)
  const missing = units.filter((u) => !u.spo)
  const covered = units.filter((u) => u.spo)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          عمودين جنب بعض على الشاشة العريضة: الناقص يمين والمغطى يسار. على
          الجوال ينزلون تحت بعض.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="space-y-2 rounded-xl border bg-surface p-3">
          <SectionTitle
            title="بلا امر شراء"
            count={missing.length}
            tone="warning"
          />
          <ul className="space-y-2">
            {missing.map((unit) => (
              <UnitCard key={unit.id} unit={unit} />
            ))}
          </ul>
        </section>
        <section className="space-y-2 rounded-xl border bg-surface p-3">
          <SectionTitle
            title="عليها امر شراء"
            count={covered.length}
            tone="success"
          />
          <ul className="space-y-2">
            {covered.map((unit) => (
              <UnitCard key={unit.id} unit={unit} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/* ── 8 · pick several, add them in one go ───────────────────────── */

function BulkDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const units = useFiltered(owners)
  const missing = units.filter((u) => !u.spo)
  const covered = units.filter((u) => u.spo)
  // One PO = one party + company + project: the first pick fixes the group.
  const groupOf = (u: Unit) => `${ownerLine(u)}|${u.company}|${u.project}`
  const first = UNITS.find((u) => u.id === picked[0])
  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          تحدد اكثر من معدة بلا امر وتضيفها مرة وحدة. امر الشراء لمورد وشركة
          ومشروع واحد، فاول تحديد يقفل الباقي على نفس المجموعة.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <section className="space-y-2">
        <SectionTitle
          title="بلا امر شراء"
          count={missing.length}
          tone="warning"
        />
        <ul className="grid gap-2 md:grid-cols-2">
          {missing.map((unit) => {
            const blocked =
              first !== undefined && groupOf(unit) !== groupOf(first)
            return (
              <UnitCard
                key={unit.id}
                unit={unit}
                muted={blocked}
                leading={
                  <Checkbox
                    aria-label={`تحديد ${unit.code}`}
                    checked={picked.includes(unit.id)}
                    disabled={blocked}
                    onCheckedChange={() => toggle(unit.id)}
                  />
                }
              />
            )
          })}
        </ul>
      </section>
      <section className="space-y-2">
        <SectionTitle
          title="عليها امر شراء"
          count={covered.length}
          tone="success"
        />
        <ul className="grid gap-2 md:grid-cols-2">
          {covered.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </ul>
      </section>
      {picked.length > 0 && first && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-bg p-3">
          <p className="text-[13px]">
            <span className="font-semibold">
              {picked.length === 1
                ? 'معدة واحدة محددة'
                : `${picked.length} معدات محددة`}
            </span>
            <span className="text-muted">
              {' '}
              · {ownerLine(first)} · {first.project}
            </span>
          </p>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              الغاء التحديد
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={13} aria-hidden="true" />}
            >
              اضافة الى امر شراء
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}

/* ── 9 · small tiles, more on screen ────────────────────────────── */

function TilesDesign() {
  const [owners, setOwners] = useState<string[]>([])
  const units = missingFirst(useFiltered(owners))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          مربعات صغيرة، اكثر عدد على الشاشة. حالة الامر فوق كل مربع، والناقص
          اول.
        </p>
        <OwnerFilter value={owners} onChange={setOwners} />
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {units.map((unit) => (
          <li
            key={unit.id}
            className="flex flex-col gap-2 rounded-xl border bg-bg p-3 text-[13px]"
          >
            <div className="flex items-start justify-between gap-2">
              <bdi dir="ltr" className="text-base font-semibold">
                {unit.code}
              </bdi>
              {unit.spo ? (
                <Badge tone="success" size="sm">
                  عليها امر
                </Badge>
              ) : (
                <Badge tone="warning" size="sm">
                  بلا امر
                </Badge>
              )}
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-xs">{unit.type}</p>
              <p className="truncate text-xs text-muted">{ownerLine(unit)}</p>
              <p className="truncate text-xs text-muted">{unit.project}</p>
              <CompanyNumber unit={unit} />
            </div>
            <div className="mt-auto border-t pt-2">
              <PoCell unit={unit} compact />
            </div>
          </li>
        ))}
      </ul>
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
          الى امر شراء» لو مالها. النموذج 4 فكرتك (قائمة الشغل بكل المعدات
          كبطاقات مع ترقيم الشركة)، و5 الى 9 افكار مبنية عليه. ببيانات عينة.
        </p>
      </div>
      <Tabs defaultValue="all-cards">
        <TabsList variant="segmented" className="flex-wrap">
          <TabsTrigger value="grouped">1 · حسب المشروع</TabsTrigger>
          <TabsTrigger value="todo">2 · قائمة شغل</TabsTrigger>
          <TabsTrigger value="table">3 · جدول بفلاتر سريعة</TabsTrigger>
          <TabsTrigger value="all-cards">
            4 · فكرتك: كل المعدات بطاقات
          </TabsTrigger>
          <TabsTrigger value="project-cards">
            5 · بطاقات حسب المشروع
          </TabsTrigger>
          <TabsTrigger value="supplier-cards">
            6 · بطاقات حسب المورد
          </TabsTrigger>
          <TabsTrigger value="two-columns">7 · عمودين</TabsTrigger>
          <TabsTrigger value="bulk">8 · تحديد واضافة جماعية</TabsTrigger>
          <TabsTrigger value="tiles">9 · مربعات صغيرة</TabsTrigger>
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
        <TabsContent value="all-cards" className="pt-3">
          <AllCardsDesign />
        </TabsContent>
        <TabsContent value="project-cards" className="pt-3">
          <ProjectCardsDesign />
        </TabsContent>
        <TabsContent value="supplier-cards" className="pt-3">
          <SupplierCardsDesign />
        </TabsContent>
        <TabsContent value="two-columns" className="pt-3">
          <TwoColumnsDesign />
        </TabsContent>
        <TabsContent value="bulk" className="pt-3">
          <BulkDesign />
        </TabsContent>
        <TabsContent value="tiles" className="pt-3">
          <TilesDesign />
        </TabsContent>
      </Tabs>
    </section>
  )
}
