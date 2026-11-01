import { useState, type ReactNode } from 'react'
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  FileWarning,
  HardHat,
  PowerOff,
  Radio,
  Truck,
  WifiOff,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Card,
  DataTable,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type BadgeTone,
  type DataTableColumn,
} from '@/components/ui'
import { deepTint } from '@/components/charts'
import {
  EntriesLineChart,
  FleetDonut,
  SoftAreaChart,
  SoftBarChart,
  SoftDonut,
} from '@/components/charts/lazy'
import { workshopPurposeTone, type WorkshopPurpose } from '@/lib/equipmentState'
import {
  AFAQY,
  AVAILABLE,
  DAYS_30,
  ENTRIES_30_TOTAL,
  EXITS_30_TOTAL,
  FLEET_TOTAL,
  IN_PROJECTS,
  IN_WORKSHOP,
  OWNERS,
  PURCHASING,
  REST_STATES,
  SUPPLIERS_IN_PROJECTS,
  TOP_TYPES,
  WORKSHOP_ROWS,
  shareOf,
  type WorkshopRow,
} from './denseDashboardData'

// Owner request 2026-11-01 (EM-252, «الارقام الحالية ماخذه كامل الصفحة»): the
// admin home's information again, laid out densely in the look of the
// dashboard board he sent — a row of small KPI tiles, a trend chart beside a
// donut, three compact cards, then two mini tables — so the whole home fits in
// about two laptop screens instead of five. Two variants to compare:
// «مربعات» (the board's tile-and-card grid) and «اكثر كثافة» (smaller tiles,
// denser tables). Sample data only; nothing here reads or writes Supabase.

type Variant = 'tiles' | 'denser'

// Owner 2026-11-01, after the first review («ايش بدائل مكتب rechart لانها
// ماعجبتني حقهم» → «اعادة تنسيق recharts»): the same Recharts, restyled in
// the board's look — a smooth line over a flat pale fill without dots, a wide
// rounded donut with nothing written on the slices, rounded bars. «الحالية»
// keeps the home's current charts beside it for the comparison.
type ChartLook = 'soft' | 'current'

const CHART_LOOKS: { id: ChartLook; label: string }[] = [
  { id: 'soft', label: 'الجديدة' },
  { id: 'current', label: 'الحالية' },
]

const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'tiles', label: 'مربعات' },
  { id: 'denser', label: 'اكثر كثافة' },
]

/** Every spacing / size the two variants disagree on, in one place. */
type Density = {
  gap: string
  cardPad: string
  tilePad: string
  tileIcon: number
  tileValue: string
  chartHeight: number
  donutHeight: number
  workshopRows: number
  tableSize: 'sm' | 'md'
  rowGap: string
  /** The chip sits beside the number instead of under it (one row less). */
  inlineChip: boolean
}

const DENSITY: Record<Variant, Density> = {
  tiles: {
    gap: 'gap-3',
    cardPad: 'p-4',
    tilePad: 'p-3',
    tileIcon: 32,
    tileValue: 'text-xl',
    chartHeight: 220,
    donutHeight: 200,
    workshopRows: 7,
    tableSize: 'md',
    rowGap: 'space-y-2',
    inlineChip: false,
  },
  denser: {
    gap: 'gap-2',
    cardPad: 'p-3',
    tilePad: 'p-2.5',
    tileIcon: 26,
    tileValue: 'text-lg',
    chartHeight: 180,
    donutHeight: 170,
    workshopRows: 10,
    tableSize: 'sm',
    rowGap: 'space-y-1.5',
    inlineChip: true,
  },
}

/** The strong / soft token pair behind a tile icon or a chip. */
type Accent =
  | { kind: 'tone'; tone: Exclude<BadgeTone, 'neutral'> }
  | { kind: 'chart'; shade: number }
  | { kind: 'neutral' }

function accentColors(accent: Accent): { strong: string; soft: string } {
  if (accent.kind === 'tone')
    return {
      strong: `var(--${accent.tone})`,
      soft: `var(--${accent.tone}-soft)`,
    }
  if (accent.kind === 'chart')
    return {
      strong: `var(--chart-stroke-${accent.shade})`,
      soft: `var(--chart-${accent.shade})`,
    }
  return { strong: 'var(--muted)', soft: 'var(--surface-hover)' }
}

// --- (a) the greeting ------------------------------------------------------

function GreetingLine() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
      <p className="text-sm">
        <span className="font-semibold">صباح الخير، مبارك</span>
        <span className="text-muted"> · الاحد 1 نوفمبر 2026</span>
      </p>
      <p className="text-xs text-muted">
        الارقام حتى الان · حركة اليوم: 9 دخول و7 خروج
      </p>
    </div>
  )
}

// --- (b) the KPI tiles -----------------------------------------------------

type Kpi = {
  id: string
  label: string
  value: number
  chip: string
  chipTone: BadgeTone
  icon: ReactNode
  accent: Accent
}

const KPIS: Kpi[] = [
  {
    id: 'fleet',
    label: 'الاسطول',
    value: FLEET_TOTAL,
    chip: '+4 هذا الشهر',
    chipTone: 'success',
    icon: <Truck size={15} />,
    accent: { kind: 'chart', shade: 1 },
  },
  {
    id: 'projects',
    label: 'في المشاريع',
    value: IN_PROJECTS,
    chip: shareOf(IN_PROJECTS, FLEET_TOTAL),
    chipTone: 'neutral',
    icon: <HardHat size={15} />,
    accent: { kind: 'chart', shade: 3 },
  },
  {
    id: 'workshop',
    label: 'في الورشة',
    value: IN_WORKSHOP,
    chip: shareOf(IN_WORKSHOP, FLEET_TOTAL),
    chipTone: 'neutral',
    icon: <Wrench size={15} />,
    accent: { kind: 'chart', shade: 2 },
  },
  {
    id: 'available',
    label: 'متاحة',
    value: AVAILABLE,
    chip: shareOf(AVAILABLE, FLEET_TOTAL),
    chipTone: 'neutral',
    icon: <CheckCircle2 size={15} />,
    accent: { kind: 'chart', shade: 6 },
  },
  {
    id: 'no_po',
    label: 'بدون PO',
    value: PURCHASING.noPo,
    chip: `من ${IN_PROJECTS}`,
    chipTone: 'warning',
    icon: <FileWarning size={15} />,
    accent: { kind: 'tone', tone: 'warning' },
  },
  {
    id: 'awaiting',
    label: 'بانتظار الاعتماد',
    value: PURCHASING.awaitingApproval,
    chip: 'مسعرة',
    chipTone: 'info',
    icon: <BadgeCheck size={15} />,
    accent: { kind: 'tone', tone: 'info' },
  },
  {
    id: 'afaqy_off',
    label: 'افاقي غير متصلة',
    value: AFAQY.notConnected,
    chip: `من ${AFAQY.linked}`,
    chipTone: 'danger',
    icon: <WifiOff size={15} />,
    accent: { kind: 'tone', tone: 'danger' },
  },
  {
    id: 'no_signal',
    label: 'بدون اشارة',
    value: AFAQY.noSignal,
    chip: 'لم ترسل',
    chipTone: 'neutral',
    icon: <Radio size={15} />,
    accent: { kind: 'neutral' },
  },
]

function KpiTile({ kpi, density }: { kpi: Kpi; density: Density }) {
  const colors = accentColors(kpi.accent)
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2.5 rounded-2xl border bg-bg',
        density.tilePad,
      )}
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: density.tileIcon,
          height: density.tileIcon,
          color: colors.strong,
          backgroundColor: colors.soft,
        }}
      >
        {kpi.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] leading-4 text-muted">
          {kpi.label}
        </span>
        <span
          className={cn(
            'flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5',
            !density.inlineChip && 'flex-col items-start',
          )}
        >
          <span
            className={cn(
              'block font-bold leading-tight tabular-nums',
              density.tileValue,
            )}
          >
            {kpi.value}
          </span>
          <Badge
            size="sm"
            tone={kpi.chipTone}
            className={density.inlineChip ? undefined : 'mt-0.5'}
          >
            {kpi.chip}
          </Badge>
        </span>
      </span>
    </div>
  )
}

// --- the shared dense card -------------------------------------------------

function DenseCard({
  title,
  meta,
  density,
  className,
  bodyClassName,
  children,
}: {
  title: string
  /** A short muted fact at the end of the title row. */
  meta?: ReactNode
  density: Density
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <Card
      className={cn(
        'flex min-w-0 flex-col rounded-2xl',
        density.cardPad,
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {meta && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted">
            {meta}
          </span>
        )}
      </div>
      <div className={cn('min-w-0 flex-1', bodyClassName)}>{children}</div>
    </Card>
  )
}

// --- (c) the trend chart and the owners' donut -----------------------------

function EntriesCard({ density, look }: { density: Density; look: ChartLook }) {
  const Chart = look === 'soft' ? SoftAreaChart : EntriesLineChart
  return (
    <DenseCard
      title="الدخوليات اخر 30 يوم"
      meta={`${ENTRIES_30_TOTAL} دخول · ${EXITS_30_TOTAL} خروج`}
      density={density}
      className="xl:col-span-2"
    >
      <Chart
        ariaLabel="الدخول والخروج في اخر 30 يوم"
        points={DAYS_30}
        entriesLabel="دخول"
        exitsLabel="خروج"
        showExits
        height={density.chartHeight}
      />
    </DenseCard>
  )
}

function OwnersDonutCard({
  density,
  look,
}: {
  density: Density
  look: ChartLook
}) {
  const slices = OWNERS.map((owner) => ({
    id: owner.id,
    label: owner.label,
    value: owner.fleet,
    color: `var(--chart-${owner.shade})`,
    strokeColor: `var(--chart-stroke-${owner.shade})`,
  }))
  return (
    <DenseCard
      title="الاسطول حسب المالك"
      meta={`${FLEET_TOTAL} معدة`}
      density={density}
    >
      {look === 'soft' ? (
        <SoftDonut
          ariaLabel="الاسطول حسب المالك"
          centerLabel="معدة"
          height={density.donutHeight}
          slices={slices}
        />
      ) : (
        <FleetDonut
          ariaLabel="الاسطول حسب المالك"
          centerLabel="معدة"
          height={density.donutHeight}
          innerRadius="58%"
          outerRadius="88%"
          slices={slices}
        />
      )}
    </DenseCard>
  )
}

// --- (d) the three compact cards -------------------------------------------

/** One labelled bar: label at the start, the bar, the count and its share. */
function BarRow({
  label,
  value,
  total,
  max,
  fill,
  stroke,
  labelDir,
}: {
  label: string
  value: number
  total: number
  max: number
  fill: string
  stroke: string
  labelDir?: 'ltr'
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="truncate-safe w-24 shrink-0 text-start" dir={labelDir}>
        {label}
      </span>
      <span
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-hover"
        aria-hidden="true"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${max > 0 ? (value / max) * 100 : 0}%`,
            backgroundColor: deepTint(fill, stroke),
          }}
        />
      </span>
      <span className="w-7 shrink-0 text-end font-semibold tabular-nums">
        {value}
      </span>
      <span className="w-8 shrink-0 text-end tabular-nums text-muted">
        {shareOf(value, total)}
      </span>
    </li>
  )
}

function RestStatesCard({ density }: { density: Density }) {
  const total = REST_STATES.reduce((sum, state) => sum + state.count, 0)
  const max = Math.max(...REST_STATES.map((state) => state.count))
  return (
    <DenseCard
      title="حالات المتبقي"
      meta={`${total} خارج المشاريع`}
      density={density}
    >
      {/* One stacked strip of the states, then a bar per state. */}
      <div
        className="mb-2.5 flex h-2 overflow-hidden rounded-full"
        aria-hidden="true"
      >
        {REST_STATES.map((state) => (
          <span
            key={state.id}
            style={{
              width: `${(state.count / total) * 100}%`,
              backgroundColor: state.stroke,
            }}
          />
        ))}
      </div>
      <ul className={density.rowGap}>
        {REST_STATES.map((state) => (
          <BarRow
            key={state.id}
            label={state.label}
            value={state.count}
            total={total}
            max={max}
            fill={state.fill}
            stroke={state.stroke}
          />
        ))}
      </ul>
    </DenseCard>
  )
}

function SuppliersCard({ density }: { density: Density }) {
  const total = SUPPLIERS_IN_PROJECTS.reduce((sum, row) => sum + row.count, 0)
  const max = Math.max(...SUPPLIERS_IN_PROJECTS.map((row) => row.count))
  return (
    <DenseCard
      title="الموردون في المشاريع"
      meta={`${total} معدة مالك اخر`}
      density={density}
    >
      <ul className={density.rowGap}>
        {SUPPLIERS_IN_PROJECTS.map((row) => (
          <BarRow
            key={row.id}
            label={row.name}
            value={row.count}
            total={total}
            max={max}
            fill="var(--chart-4)"
            stroke="var(--chart-stroke-4)"
          />
        ))}
      </ul>
    </DenseCard>
  )
}

function TopTypesCard({
  density,
  look,
}: {
  density: Density
  look: ChartLook
}) {
  const max = Math.max(...TOP_TYPES.map((row) => row.count))
  const plot = density.workshopRows > 7 ? 'h-24' : 'h-28'
  if (look === 'soft')
    return (
      <DenseCard
        title="الاكثر طلبا حسب النوع"
        meta="في المشاريع الان"
        density={density}
        bodyClassName="flex flex-col justify-end"
      >
        <SoftBarChart
          ariaLabel="المعدات في المشاريع حسب النوع"
          height={density.workshopRows > 7 ? 140 : 156}
          labelDir="ltr"
          singleColor="var(--chart-3)"
          singleStroke="var(--chart-stroke-3)"
          items={TOP_TYPES.map((row) => ({
            id: row.id,
            label: row.label,
            value: row.count,
          }))}
        />
      </DenseCard>
    )
  return (
    <DenseCard
      title="الاكثر طلبا حسب النوع"
      meta="في المشاريع الان"
      density={density}
      bodyClassName="flex flex-col justify-end"
    >
      <ul
        className={cn('flex items-end gap-1.5', plot)}
        aria-label="المعدات في المشاريع حسب النوع"
      >
        {TOP_TYPES.map((row) => (
          <li
            key={row.id}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[11px] font-semibold leading-none tabular-nums">
              {row.count}
            </span>
            <span
              className="w-full rounded-t-md"
              style={{
                height: `${(row.count / max) * 100}%`,
                backgroundColor: 'var(--chart-3)',
                borderTop: '2px solid var(--chart-stroke-3)',
              }}
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
      <ul className="mt-1.5 flex gap-1.5 border-t pt-1.5" aria-hidden="true">
        {TOP_TYPES.map((row) => (
          <li
            key={row.id}
            className="h-6 min-w-0 flex-1 overflow-hidden break-words text-center text-[10px] leading-3 text-muted"
            dir="ltr"
          >
            {row.label}
          </li>
        ))}
      </ul>
    </DenseCard>
  )
}

// --- (e) the two mini tables -----------------------------------------------

// Arabic like the rest of the mockup (the real page reads `t()`).
const PURPOSE_LABEL: Record<WorkshopPurpose, string> = {
  maintenance: 'صيانة',
  parking: 'انتظار',
  out_of_service: 'خارج الخدمة',
}

function WorkshopTableCard({ density }: { density: Density }) {
  const columns: DataTableColumn<WorkshopRow>[] = [
    {
      key: 'code',
      header: 'المعدة',
      cell: (row) => (
        <span className="block">
          <span className="font-semibold" dir="ltr">
            {row.code}
          </span>
          <span className="block text-[11px] leading-4 text-muted" dir="ltr">
            {row.type}
          </span>
        </span>
      ),
    },
    {
      key: 'purpose',
      header: 'الغرض',
      cell: (row) =>
        row.purpose ? (
          <Badge size="sm" tone={workshopPurposeTone(row.purpose)}>
            {PURPOSE_LABEL[row.purpose]}
          </Badge>
        ) : (
          <Badge size="sm" tone="neutral">
            غير مصنفة
          </Badge>
        ),
    },
    {
      key: 'since',
      header: 'منذ',
      align: 'end',
      cell: (row) => (
        <span className="text-[11px] tabular-nums text-muted">{row.since}</span>
      ),
    },
  ]
  return (
    <DenseCard
      title="في الورشة"
      meta={`${IN_WORKSHOP} معدة · عرض الكل`}
      density={density}
    >
      <DataTable
        size={density.tableSize}
        columns={columns}
        rows={WORKSHOP_ROWS.slice(0, density.workshopRows)}
        rowKey={(row) => row.code}
        caption="في الورشة"
        stickyHeader={false}
        cellTextClassName="text-[13px]"
        cellClassName={density.tableSize === 'sm' ? 'py-1' : 'py-1.5'}
        onRowClick={() => undefined}
      />
    </DenseCard>
  )
}

type AttentionItem = {
  id: string
  label: string
  count: number
  tone: Exclude<BadgeTone, 'neutral'>
  icon: ReactNode
}

const ATTENTION: AttentionItem[] = [
  {
    id: 'unclassified',
    label: 'في الورشة بدون تصنيف',
    count: 4,
    tone: 'warning',
    icon: <Wrench size={14} />,
  },
  {
    id: 'out_of_service_long',
    label: 'خارج الخدمة اكثر من 30 يوم',
    count: 2,
    tone: 'danger',
    icon: <PowerOff size={14} />,
  },
  {
    id: 'no_po',
    label: 'في المشاريع بدون PO',
    count: PURCHASING.noPo,
    tone: 'warning',
    icon: <FileWarning size={14} />,
  },
  {
    id: 'awaiting',
    label: 'اوامر شراء بانتظار الاعتماد',
    count: PURCHASING.awaitingApproval,
    tone: 'info',
    icon: <BadgeCheck size={14} />,
  },
  {
    id: 'unpriced',
    label: 'اوامر شراء تحتاج اسعار',
    count: PURCHASING.unpriced,
    tone: 'warning',
    icon: <CircleDollarSign size={14} />,
  },
  {
    id: 'afaqy_off',
    label: 'انقطعت اشارتها في افاقي منذ 24 ساعة',
    count: AFAQY.notConnected,
    tone: 'danger',
    icon: <Ban size={14} />,
  },
]

function AttentionCard({ density }: { density: Density }) {
  const total = ATTENTION.reduce((sum, item) => sum + item.count, 0)
  return (
    <DenseCard title="يحتاج انتباهك" meta={`${total} بندا`} density={density}>
      <ul className="divide-y">
        {ATTENTION.map((item) => {
          const colors = accentColors({ kind: 'tone', tone: item.tone })
          return (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2.5 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                  density.tableSize === 'sm' ? 'py-1.5' : 'py-2',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{
                    color: colors.strong,
                    backgroundColor: colors.soft,
                  }}
                >
                  {item.icon}
                </span>
                <span className="truncate-safe min-w-0 flex-1 text-[13px]">
                  {item.label}
                </span>
                <Badge size="sm" tone={item.tone} className="tabular-nums">
                  {item.count}
                </Badge>
              </button>
            </li>
          )
        })}
      </ul>
      <AfaqyStrip />
    </DenseCard>
  )
}

/** The four Afaqy numbers of the home, as one small row. */
function AfaqyStrip() {
  const cells: { label: string; value: number; tone?: BadgeTone }[] = [
    { label: 'مربوطة', value: AFAQY.linked },
    { label: 'متصلة', value: AFAQY.connected, tone: 'success' },
    { label: 'غير متصلة', value: AFAQY.notConnected, tone: 'warning' },
    { label: 'بدون اشارة', value: AFAQY.noSignal, tone: 'danger' },
  ]
  return (
    <div className="mt-3 border-t pt-2.5">
      <p className="mb-1.5 text-[11px] text-muted">
        التتبع في افاقي · اخر 24 ساعة
      </p>
      <ul className="grid grid-cols-4 gap-1.5">
        {cells.map((cell) => (
          <li
            key={cell.label}
            className="rounded-lg bg-surface px-2 py-1.5 text-center"
          >
            <span
              className="block text-base font-bold leading-tight tabular-nums"
              style={cell.tone ? { color: `var(--${cell.tone})` } : undefined}
            >
              {cell.value}
            </span>
            <span className="block text-[10px] leading-3 text-muted">
              {cell.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- the page --------------------------------------------------------------

function DenseDashboard({
  variant,
  look,
}: {
  variant: Variant
  look: ChartLook
}) {
  const density = DENSITY[variant]
  return (
    <div
      className={cn(
        'rounded-2xl bg-surface p-3 sm:p-4',
        density.gap,
        'space-y-3',
      )}
    >
      <GreetingLine />
      <div
        className={cn(
          'grid grid-cols-2 sm:grid-cols-4',
          variant === 'tiles' ? 'xl:grid-cols-8' : 'lg:grid-cols-8',
          density.gap,
        )}
      >
        {KPIS.map((kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} density={density} />
        ))}
      </div>
      <div className={cn('grid xl:grid-cols-3', density.gap)}>
        <EntriesCard density={density} look={look} />
        <OwnersDonutCard density={density} look={look} />
      </div>
      <div className={cn('grid md:grid-cols-2 xl:grid-cols-3', density.gap)}>
        <RestStatesCard density={density} />
        <SuppliersCard density={density} />
        <TopTypesCard density={density} look={look} />
      </div>
      <div className={cn('grid md:grid-cols-2', density.gap)}>
        <WorkshopTableCard density={density} />
        <AttentionCard density={density} />
      </div>
    </div>
  )
}

export function DenseDashboardMockup() {
  const [variant, setVariant] = useState<Variant>('tiles')
  const [look, setLook] = useState<ChartLook>('soft')
  return (
    <div className="space-y-4">
      {/* Mockup controls, not part of the page. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted">النسخة:</span>
        <Tabs
          value={variant}
          onValueChange={(value) => setVariant(value as Variant)}
        >
          <TabsList variant="segmented" aria-label="نسخة لوحة التحكم">
            {VARIANTS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted">
          {variant === 'tiles'
            ? 'شبكة المربعات والكروت كما في اللوحة المرجعية.'
            : 'نفس المحتوى بمربعات اصغر وجداول اكثف.'}
        </span>
        <span className="ms-auto text-muted">الرسوم:</span>
        <Tabs
          value={look}
          onValueChange={(value) => setLook(value as ChartLook)}
        >
          <TabsList variant="segmented" aria-label="شكل الرسوم">
            {CHART_LOOKS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <DenseDashboard variant={variant} look={look} />
    </div>
  )
}
