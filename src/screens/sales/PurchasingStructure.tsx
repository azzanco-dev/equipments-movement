import { Fragment } from 'react'
import { ArrowLeft, Check, Minus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { AuthScreen } from '@/screens/AuthScreen'
import { FullPageSpinner } from '@/components/Spinner'
import {
  Badge,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  cn,
  type BadgeTone,
  type DataTableColumn,
} from '@/components/ui'
import {
  DECISIONS,
  ENTITIES,
  LIFECYCLE,
  OPEN_QUESTIONS,
  PERMISSIONS,
  PHASES,
  RELATIONS,
  SAMPLE_PO,
  WORKFLOW,
  type Entity,
  type EntityField,
  type EntityKind,
  type PermissionRow,
  type Phase,
  type Relation,
  type SampleLine,
} from './purchasingModel'

// REVIEW PAGE of the purchasing module structure («PO الموردين») on /sales.
// Like /ui-kit it is open in development and admin-only in production. It
// renders the proposed phases, entities, relations and the PO lifecycle from
// purchasingModel.ts; nothing here reads or writes the database.
const OPEN_WITHOUT_SESSION = process.env.NODE_ENV !== 'production'

export function PurchasingStructure() {
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
  return <PurchasingStructureContent />
}

const SECTIONS = [
  { id: 'phases', title: 'المراحل' },
  { id: 'diagram', title: 'مخطط العلاقات' },
  { id: 'entities', title: 'الجداول والحقول' },
  { id: 'lifecycle', title: 'دورة حياة الـ PO' },
  { id: 'flow', title: 'دورة العمل في المرحلة 1' },
  { id: 'permissions', title: 'الصلاحيات والادوار' },
  { id: 'sample', title: 'نموذج PO' },
  { id: 'decisions', title: 'القرارات والاسئلة' },
]

function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <Badge tone={phase === 1 ? 'info' : 'neutral'} size="sm">
      المرحلة {phase}
    </Badge>
  )
}

function PurchasingStructureContent() {
  return (
    <div className="min-h-[100dvh] bg-bg text-fg">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
        <PageHeader
          title="هيكلة المشتريات"
          description="نموذج للمراجعة: «PO الموردين» على اربع مراحل، بكياناته وعلاقاته ودورة حياته كما اتفقنا حتى 17 اكتوبر 2026. كل ما هنا بيانات تجريبية ولا شيء يُحفظ."
          actions={<Badge tone="neutral">قيد المراجعة</Badge>}
        />

        <nav aria-label="اقسام الصفحة" className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <ol className="flex flex-wrap gap-2">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex h-7 items-center rounded-full border bg-surface px-3 text-xs text-fg hover:bg-surface-hover"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="phases" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="المراحل"
            description="كل مرحلة تُسلم وتُجرب وحدها. المرحلة 1 تكفي لاصدار POs رسمية مرقمة ومعتمدة؛ تحميلها وارسالها في المرحلة 3."
          />
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PHASES.map((phase) => (
              <li key={phase.phase}>
                <Card
                  className={cn(
                    'h-full space-y-3',
                    phase.phase === 1 && 'border-info',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-contrast"
                    >
                      {phase.phase}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{phase.title}</h3>
                      <p className="text-xs text-muted">{phase.summary}</p>
                    </div>
                  </div>
                  <ul className="list-disc space-y-1 ps-5 text-sm">
                    {phase.includes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <dl className="space-y-1 border-t pt-2 text-xs">
                    <div>
                      <dt className="inline text-muted">الجداول: </dt>
                      <dd className="inline">
                        <bdi dir="ltr" className="font-mono">
                          {phase.tables}
                        </bdi>
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-muted">الحالات: </dt>
                      <dd className="inline">{phase.statuses}</dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section id="diagram" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="مخطط العلاقات"
            description="الصف العلوي جداول موجودة اليوم، والصفان الاوسط والسفلي جداول جديدة مع رقم مرحلتها. الخط بين صندوقين يعني ان الثاني يشير الى الاول."
          />
          <Card padded={false} className="overflow-x-auto p-3 sm:p-4">
            <RelationDiagram />
          </Card>
          <Legend />
          <Card padded={false}>
            <DataTable<Relation>
              size="sm"
              rows={RELATIONS}
              rowKey={(row) => `${row.from}-${row.to}`}
              columns={RELATION_COLUMNS}
            />
          </Card>
        </section>

        <section id="entities" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="الجداول والحقول"
            description="اسماء الجداول والحقول مقترحة وقابلة للتغيير. السهم → يعني مرجعا الى جدول اخر."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {ENTITIES.map((entity) => (
              <EntityCard key={entity.id} entity={entity} />
            ))}
          </div>
        </section>

        <section id="lifecycle" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="دورة حياة الـ PO"
            description="الحالة تتحرك عبر دوال القاعدة فقط، وكل حركة تُسجل في سجل الاحداث. المرحلة 1 اربع حالات؛ «ملغي» في المرحلة 2 و«مرسل» في المرحلة 3."
          />
          <Card className="space-y-4">
            <ol className="flex flex-wrap items-center gap-2">
              {LIFECYCLE.filter((step) => step.phase === 1).map(
                (step, index, all) => (
                  <Fragment key={step.key}>
                    <li>
                      <Badge tone={step.tone}>{step.label}</Badge>
                    </li>
                    {index < all.length - 1 && (
                      <li aria-hidden="true" className="text-muted">
                        <ArrowLeft size={14} className="rtl-flip" />
                      </li>
                    )}
                  </Fragment>
                ),
              )}
              <li className="ms-2 text-xs text-muted">
                لاحقا: <Badge tone="danger">ملغي</Badge> (م2)،{' '}
                <Badge tone="info">مرسل</Badge> (م3)
              </li>
            </ol>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs text-muted">
                    <th className="py-2 pe-3 text-start font-medium">الحالة</th>
                    <th className="py-2 pe-3 text-start font-medium">
                      المرحلة
                    </th>
                    <th className="py-2 pe-3 text-start font-medium">
                      من يحركها
                    </th>
                    <th className="py-2 text-start font-medium">ماذا يحدث</th>
                  </tr>
                </thead>
                <tbody>
                  {LIFECYCLE.map((step) => (
                    <tr key={step.key} className="border-b last:border-b-0">
                      <td className="py-2 pe-3 align-top">
                        <Badge tone={step.tone} size="sm">
                          {step.label}
                        </Badge>
                      </td>
                      <td className="py-2 pe-3 align-top text-muted">
                        {step.phase}
                      </td>
                      <td className="py-2 pe-3 align-top text-muted">
                        {step.who}
                      </td>
                      <td className="py-2 align-top">{step.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section id="flow" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="دورة العمل في المرحلة 1"
            description="انشاء يدوي بالكامل من قسم المشتريات. البوابة لا تنشئ شيئا، وطريقة اضافة الـ POs تُناقش بعد اكتمال المرحلة."
          />
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {WORKFLOW.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-contrast"
                    >
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                  </div>
                  <p className="text-sm">{step.detail}</p>
                  <p className="text-xs text-muted">{step.actor}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section id="permissions" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="الصلاحيات والادوار"
            description="مفاتيح جديدة في كتالوج الصلاحيات الحالي، ودوران جديدان يُنشاان من صفحة الادوار. الادمن يملك الكل."
          />
          <Card padded={false}>
            <DataTable<PermissionRow>
              size="sm"
              rows={PERMISSIONS}
              rowKey={(row) => row.key}
              columns={PERMISSION_COLUMNS}
            />
          </Card>
        </section>

        <section id="sample" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="نموذج PO كما سيظهر"
            description="مثال معتمد لمورد خارجي: ثلاث معدات لنفس العميل والمشروع، احداها انتهت يدويا. الاسعار غير شاملة الضريبة. شكل المستند المرسل يُحدد في المرحلة 3."
          />
          <SamplePoCard />
        </section>

        <section id="decisions" className="scroll-mt-16 space-y-3">
          <SectionHeader
            as="h2"
            title="القرارات المعتمدة والاسئلة المفتوحة"
            description="القرارات من نقاش 15 و17 اكتوبر 2026. الاسئلة تحتاج جوابك قبل كتابة ترحيل المرحلة 1."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2">
              <h3 className="text-sm font-semibold">القرارات المعتمدة</h3>
              <ul className="space-y-2 text-sm">
                {DECISIONS.map((decision) => (
                  <li key={decision.text} className="flex gap-2">
                    <Check
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                    />
                    <span>
                      <span className="text-xs text-muted">
                        {decision.date} ·{' '}
                      </span>
                      {decision.text}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="space-y-2">
              <h3 className="text-sm font-semibold">الاسئلة المفتوحة</h3>
              <ol className="list-decimal space-y-2 ps-5 text-sm">
                {OPEN_QUESTIONS.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
            </Card>
          </div>
        </section>
      </div>
    </div>
  )
}

// ---- Relations diagram ----

type DiagramBox = {
  id: string
  label: string
  sub: string
  kind: EntityKind
  x: number
  y: number
  w: number
  h: number
}

type DiagramLink = {
  from: [number, number]
  to: [number, number]
  label?: string
}

// Reading order is right-to-left, so the primary entities sit at the right.
const BOXES: DiagramBox[] = [
  {
    id: 'lessors',
    label: 'المورد',
    sub: 'lessors · يُوسّع',
    kind: 'extended',
    x: 800,
    y: 20,
    w: 160,
    h: 50,
  },
  {
    id: 'companies',
    label: 'العميل',
    sub: 'companies',
    kind: 'existing',
    x: 580,
    y: 20,
    w: 160,
    h: 50,
  },
  {
    id: 'projects',
    label: 'المشروع',
    sub: 'projects',
    kind: 'existing',
    x: 360,
    y: 20,
    w: 160,
    h: 50,
  },
  {
    id: 'equipment',
    label: 'المعدة',
    sub: 'equipment',
    kind: 'existing',
    x: 140,
    y: 20,
    w: 160,
    h: 50,
  },
  {
    id: 'po',
    label: 'PO المورد',
    sub: 'supplier_pos · م1',
    kind: 'new',
    x: 600,
    y: 180,
    w: 280,
    h: 70,
  },
  {
    id: 'po-equipment',
    label: 'معدات الـ PO',
    sub: 'supplier_po_equipment · م1',
    kind: 'new',
    x: 180,
    y: 180,
    w: 280,
    h: 70,
  },
  {
    id: 'events',
    label: 'سجل الاحداث',
    sub: 'supplier_po_events · م1',
    kind: 'new',
    x: 800,
    y: 330,
    w: 170,
    h: 60,
  },
  {
    id: 'amend',
    label: 'تعديل معتمد',
    sub: 'supplier_po_amendments · م2',
    kind: 'new',
    x: 600,
    y: 330,
    w: 180,
    h: 60,
  },
  {
    id: 'sends',
    label: 'الارسال',
    sub: 'supplier_po_sends · م3',
    kind: 'new',
    x: 410,
    y: 330,
    w: 170,
    h: 60,
  },
]

const LINKS: DiagramLink[] = [
  { from: [880, 70], to: [820, 180], label: 'مورد واحد' },
  { from: [660, 70], to: [730, 180], label: 'عميل واحد' },
  { from: [440, 70], to: [650, 180], label: 'مشروع واحد' },
  { from: [220, 70], to: [300, 180], label: 'معدة بعينها' },
  { from: [600, 215], to: [460, 215], label: 'PO واحد · عدة معدات' },
  { from: [690, 250], to: [690, 330] },
  { from: [830, 250], to: [885, 330] },
  { from: [630, 250], to: [510, 330] },
]

const KIND_STYLE: Record<EntityKind, { fill: string; stroke: string }> = {
  existing: { fill: 'var(--surface)', stroke: 'var(--border)' },
  extended: { fill: 'var(--warning-soft)', stroke: 'var(--warning)' },
  new: { fill: 'var(--info-soft)', stroke: 'var(--info)' },
}

function RelationDiagram() {
  return (
    <svg
      viewBox="0 0 1000 410"
      role="img"
      aria-label="مخطط علاقات جداول المشتريات"
      className="mx-auto block min-w-[640px] max-w-[1000px] w-full"
      style={{ fontFamily: 'inherit' }}
    >
      <defs>
        <marker
          id="po-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
        </marker>
      </defs>
      {LINKS.map((link, index) => {
        const [x1, y1] = link.from
        const [x2, y2] = link.to
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        return (
          <g key={index}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--muted)"
              strokeWidth={1.5}
              markerEnd="url(#po-arrow)"
            />
            {link.label && (
              <text
                x={midX}
                y={midY - 6}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted)"
                direction="rtl"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--bg)',
                  strokeWidth: 4,
                }}
              >
                {link.label}
              </text>
            )}
          </g>
        )
      })}
      {BOXES.map((box) => {
        const style = KIND_STYLE[box.kind]
        return (
          <g key={box.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={10}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={box.kind === 'new' ? 1.5 : 1}
            />
            <text
              x={box.x + box.w / 2}
              y={box.y + (box.h >= 70 ? 30 : 22)}
              textAnchor="middle"
              fontSize={box.h >= 70 ? 15 : 13}
              fontWeight={600}
              fill="var(--fg)"
              direction="rtl"
            >
              {box.label}
            </text>
            <text
              x={box.x + box.w / 2}
              y={box.y + (box.h >= 70 ? 52 : 40)}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
              direction="ltr"
            >
              {box.sub}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Legend() {
  const items: { kind: EntityKind; label: string }[] = [
    { kind: 'existing', label: 'جدول موجود، لا يتغير' },
    { kind: 'extended', label: 'جدول موجود، تُضاف له حقول' },
    { kind: 'new', label: 'جدول جديد (م = المرحلة)' },
  ]
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted">
      {items.map((item) => (
        <li key={item.kind} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded border"
            style={{
              backgroundColor: KIND_STYLE[item.kind].fill,
              borderColor: KIND_STYLE[item.kind].stroke,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

const RELATION_COLUMNS: DataTableColumn<Relation>[] = [
  { key: 'from', header: 'من', cell: (row) => row.from, width: '11rem' },
  { key: 'to', header: 'الى', cell: (row) => row.to, width: '11rem' },
  {
    key: 'cardinality',
    header: 'العدد',
    cell: (row) => <bdi dir="ltr">{row.cardinality}</bdi>,
    width: '6rem',
    align: 'center',
  },
  {
    key: 'phase',
    header: 'المرحلة',
    cell: (row) => row.phase,
    width: '5rem',
    align: 'center',
  },
  {
    key: 'rule',
    header: 'القاعدة',
    cell: (row) => <span className="whitespace-normal">{row.rule}</span>,
  },
]

// ---- Entities ----

const KIND_BADGE: Record<EntityKind, { tone: BadgeTone; label: string }> = {
  existing: { tone: 'neutral', label: 'موجود' },
  extended: { tone: 'warning', label: 'يُوسّع' },
  new: { tone: 'info', label: 'جديد' },
}

const FIELD_COLUMNS: DataTableColumn<EntityField>[] = [
  {
    key: 'name',
    header: 'الحقل',
    cell: (row) => (
      <bdi dir="ltr" className="font-mono text-xs">
        {row.name}
      </bdi>
    ),
    width: '11rem',
  },
  {
    key: 'type',
    header: 'النوع',
    cell: (row) => (
      <bdi dir="ltr" className="text-xs text-muted">
        {row.type}
      </bdi>
    ),
    width: '12rem',
  },
  {
    key: 'note',
    header: 'ملاحظة',
    cell: (row) => <span className="whitespace-normal">{row.note}</span>,
  },
]

function EntityCard({ entity }: { entity: Entity }) {
  const badge = KIND_BADGE[entity.kind]
  return (
    <Card padded={false} className="flex flex-col">
      <div className="space-y-1 p-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{entity.title}</h3>
          <Badge tone={badge.tone} size="sm">
            {badge.label}
          </Badge>
          <PhaseBadge phase={entity.phase} />
          <bdi dir="ltr" className="font-mono text-xs text-muted">
            {entity.table}
          </bdi>
        </div>
        <p className="text-xs text-muted">{entity.purpose}</p>
      </div>
      <div className="border-t">
        <DataTable<EntityField>
          size="sm"
          rows={entity.fields}
          rowKey={(row) => row.name}
          columns={FIELD_COLUMNS}
        />
      </div>
    </Card>
  )
}

// ---- Permissions ----

function Mark({ on }: { on: boolean }) {
  return on ? (
    <Check size={16} aria-label="نعم" className="mx-auto text-success" />
  ) : (
    <Minus size={16} aria-label="لا" className="mx-auto text-muted" />
  )
}

const PERMISSION_COLUMNS: DataTableColumn<PermissionRow>[] = [
  {
    key: 'name',
    header: 'الصلاحية',
    cell: (row) => (
      <span className="block whitespace-normal">
        <span className="block">{row.name}</span>
        <bdi dir="ltr" className="block font-mono text-[11px] text-muted">
          {row.key}
        </bdi>
      </span>
    ),
    width: '14rem',
  },
  {
    key: 'phase',
    header: 'المرحلة',
    cell: (row) => row.phase,
    align: 'center',
    width: '5rem',
  },
  {
    key: 'officer',
    header: 'موظف مشتريات',
    cell: (row) => <Mark on={row.officer} />,
    align: 'center',
    width: '8rem',
  },
  {
    key: 'manager',
    header: 'مدير مشتريات',
    cell: (row) => <Mark on={row.manager} />,
    align: 'center',
    width: '8rem',
  },
  {
    key: 'note',
    header: 'تشمل',
    cell: (row) => <span className="whitespace-normal">{row.note}</span>,
  },
]

// ---- Sample PO ----

const SAMPLE_LINE_COLUMNS: DataTableColumn<SampleLine>[] = [
  {
    key: 'code',
    header: 'المعدة',
    cell: (row) => (
      <span>
        <bdi dir="ltr" className="font-semibold">
          {row.code}
        </bdi>
        <span className="ms-2 text-muted">{row.type}</span>
      </span>
    ),
  },
  {
    key: 'start',
    header: 'من',
    cell: (row) => <bdi dir="ltr">{row.start}</bdi>,
  },
  {
    key: 'end',
    header: 'الى',
    cell: (row) =>
      row.end ? (
        <bdi dir="ltr">{row.end}</bdi>
      ) : (
        <Badge tone="entry" size="sm">
          مفتوح
        </Badge>
      ),
  },
  { key: 'unit', header: 'الوحدة', cell: (row) => row.unit },
  {
    key: 'price',
    header: 'السعر (بدون ضريبة)',
    cell: (row) => <bdi dir="ltr">{row.price}</bdi>,
    align: 'end',
  },
]

function SamplePoCard() {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">
              <bdi dir="ltr">{SAMPLE_PO.number}</bdi>
            </h3>
            <Badge tone="success">معتمد</Badge>
          </div>
          <p className="text-sm">{SAMPLE_PO.supplier}</p>
          <p className="text-xs text-muted">
            {SAMPLE_PO.client} · {SAMPLE_PO.project}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted">بداية الفترة</dt>
            <dd>
              <bdi dir="ltr">{SAMPLE_PO.periodFrom}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted">جهزه</dt>
            <dd>{SAMPLE_PO.preparedBy}</dd>
          </div>
          <div>
            <dt className="text-muted">اعتمده</dt>
            <dd>{SAMPLE_PO.approvedBy}</dd>
          </div>
        </dl>
      </div>
      <div className="border-t">
        <DataTable<SampleLine>
          size="sm"
          rows={SAMPLE_PO.lines}
          rowKey={(row) => row.code}
          columns={SAMPLE_LINE_COLUMNS}
        />
      </div>
      <p className={cn('border-t p-3 text-xs text-muted')}>
        المعدة الثالثة انهاها موظف المشتريات يدويا بعد خروجها من المشروع؛
        المعدتان الاخريان مفتوحتان وتستمران على نفس الـ PO.
      </p>
    </Card>
  )
}
