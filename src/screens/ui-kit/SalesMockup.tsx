import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Coins,
  Edit2,
  Eye,
  FileText,
  Filter,
  Hourglass,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Percent,
  Plus,
  Receipt,
  Save,
  StickyNote,
  Timer,
  Trash2,
  Truck,
  User,
} from 'lucide-react'
import { RelativeTime } from '@/components/RelativeTime'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import {
  BackButton,
  Badge,
  Button,
  Card,
  DataTable,
  DescriptionList,
  DetailHeader,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Notice,
  PRIMARY_ACTIVE_TRIGGER,
  RiyalSign,
  SearchInput,
  SectionHeader,
  Select,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  type DataTableColumn,
  type DataTableSort,
  type DescriptionListItem,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { splitPlateForDisplay } from '@/lib/plate'
import { formatSupplierPoPrice } from '@/lib/purchasing'
import { MONTH_PRESETS, MONTH_PRESET_BACK, monthPresetLabel } from '@/lib/saudiTime'
import {
  CARDS,
  CARD_EVENTS,
  CARD_EVENT_LABEL,
  CARD_MONTH_STATE_LABEL,
  CARD_PAGE_SAMPLES,
  CLIENT_POS,
  CLIENT_PO_EVENTS,
  CLIENT_PO_EVENT_LABEL,
  CLIENT_PO_LINES,
  COMPANIES,
  PROJECTS,
  SALES_ACTOR_NAME,
  SALES_CARD_EQUIPMENT_ID,
  SALES_DECISIONS,
  SALES_PHASE2_DECISIONS,
  SALE_PER_UNIT_LABEL,
  SALE_RATE_UNIT_LABEL,
  SAMPLE_TODAY,
  TICKETS,
  cardById,
  cardCoversMonth,
  cardMonthFigures,
  cardMonthRows,
  clientPoById,
  clientPoTotalFigures,
  clientPoTotalsByUnit,
  companyById,
  equipmentById,
  hoursRecordedDetail,
  hoursUpdatedDetail,
  latestRecordedMonth,
  linesOfClientPo,
  monthLabel,
  monthShortLabel,
  monthsCountLabel,
  projectById,
  quantityLabel,
  remainingShare,
  shiftMonth,
  type CardMonthRow,
  type CardMonthState,
  type CardStatus,
  type ClientPoStatus,
  type MockCard,
  type MockCardEvent,
  type MockCardMonth,
  type MockClientPo,
  type MockClientPoLine,
  type MockEquipment,
  type MockTicket,
  type MonthDue,
  type SaleRateUnit,
} from './salesMockupData'

// sales-screens — REVIEW MOCKUPS of the sales phase-1 screens («PO العملاء»,
// owner 2026-11-01) on /ui-kit, in the purchasing look the owner approved:
// the list with its two views, the client PO page in the approved
// detail-page pattern (PurchasingMockup's `PoPageMockupV2` is the model),
// the «المبيعات» card of the equipment page and the «المعدات في المشاريع»
// ticket with a second stub for the client PO. Everything is in-memory
// sample data (salesMockupData.ts): nothing reads or writes the database,
// no route exists yet, and the shared components are the ones the real
// screens will render. Arabic copy uses plain alif (no hamza / madda).

// --- Small shared pieces -----------------------------------------------------------

/** The green pill of a PO number (the SPO pill of «المعدات في المشاريع»). */
const PO_PILL_STYLE: CSSProperties = {
  color: 'var(--success)',
  backgroundColor: 'var(--success-soft)',
}

/** The «+» of a missing PO: solid amber, fully round, the page colour for
 *  the sign (the ticket's add button). Tokens only. */
const ADD_BUTTON_STYLE: CSSProperties = {
  color: 'var(--bg)',
  borderColor: 'var(--warning)',
  backgroundColor: 'var(--warning)',
}

const STATUS_LABEL: Readonly<Record<ClientPoStatus, string>> = {
  open: 'مفتوح',
  closed: 'مغلق',
}

function StatusBadge({
  status,
  size,
}: {
  status: ClientPoStatus
  size?: 'sm' | 'md'
}) {
  return (
    <Badge tone={status === 'open' ? 'success' : 'neutral'} size={size}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/** An amount excluding VAT with the riyal symbol after it and the price
 *  unit after that («/ شهر», «/ ساعة»); the digits stay an LTR run. */
function SalePrice({
  value,
  unit,
  className,
}: {
  value: number
  unit?: SaleRateUnit
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-1 ${className ?? ''}`}
    >
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <bdi dir="ltr" className="tabular-nums">
          {formatSupplierPoPrice(value)}
        </bdi>
        <RiyalSign className="text-muted" size="0.8em" />
        <span className="sr-only">{t('currencySar')}</span>
      </span>
      {unit && (
        <span className="whitespace-nowrap text-[0.75em] font-normal text-muted">
          {SALE_PER_UNIT_LABEL[unit]}
        </span>
      )}
    </span>
  )
}

/** The totals stacked, one per price unit (a month, a day and an hour are
 *  never added together); `amount` turns a part into the figure shown. */
function TotalsByUnit({
  parts,
  amount = (total) => total,
  alignEnd = false,
  className,
}: {
  parts: readonly { unit: SaleRateUnit; total: number }[]
  amount?: (total: number) => number
  alignEnd?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex flex-col gap-0.5 ${alignEnd ? 'items-end' : 'items-start'}`}
    >
      {parts.map((part) => (
        <SalePrice
          key={part.unit}
          value={amount(part.total)}
          unit={part.unit}
          className={className}
        />
      ))}
    </span>
  )
}

/** The identity cell of the purchasing lists: the bold code with the plate
 *  or the chassis beside it, the type under them. */
function UnitCell({
  unit,
  withType = true,
}: {
  unit: MockEquipment | null
  withType?: boolean
}) {
  if (!unit) return <span className="text-muted">—</span>
  return (
    <span className="flex min-w-0 flex-col text-start">
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <bdi dir="ltr" className="font-semibold">
          {unit.code}
        </bdi>
        <EquipmentIdentifierTag
          row={{
            equipment_plate_number: unit.plate_number,
            equipment_chassis_number: unit.chassis_number,
          }}
        />
      </span>
      {withType && <span className="text-xs text-muted">{unit.type}</span>}
    </span>
  )
}

function PoPill({ number, onClick }: { number: string; onClick?: () => void }) {
  const className =
    'inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold'
  if (!onClick)
    return (
      <span className={className} style={PO_PILL_STYLE}>
        <bdi dir="ltr">{number}</bdi>
      </span>
    )
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
      style={PO_PILL_STYLE}
    >
      <bdi dir="ltr">{number}</bdi>
    </button>
  )
}

/** «6 اشهر» with the thin remaining bar under it (a placeholder for phase
 *  4's remaining-quantity tracking), or a dash without a ceiling. */
function QuantityCell({
  line,
  compact = false,
}: {
  line: Pick<MockClientPoLine, 'quantity' | 'quantity_unit' | 'consumed'>
  compact?: boolean
}) {
  const label = quantityLabel(line.quantity, line.quantity_unit)
  const share = remainingShare(line)
  if (!label || share === null)
    return <span className="text-xs text-muted">بدون سقف</span>
  const remaining =
    line.quantity === null ? null : Math.max(0, line.quantity - line.consumed)
  return (
    <span className={`flex min-w-0 flex-col gap-1 ${compact ? 'w-28' : 'w-full'}`}>
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-muted">
          متبقي{' '}
          <bdi dir="ltr" className="tabular-nums">
            {remaining}
          </bdi>
        </span>
      </span>
      <span
        aria-hidden="true"
        className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.round(share * 100)}%`,
            backgroundColor:
              share > 0.25 ? 'var(--chart-stroke-2)' : 'var(--warning)',
          }}
        />
      </span>
    </span>
  )
}

function PermissionNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <Lock size={12} aria-hidden="true" />
      {children}
    </p>
  )
}

function Mockup({
  title,
  permission,
  controls,
  children,
}: {
  title: string
  permission: string
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <PermissionNote>{permission}</PermissionNote>
        </div>
        {controls}
      </div>
      <div className="rounded-xl border bg-surface p-3 sm:p-4">{children}</div>
    </section>
  )
}

/** The unified list toolbar's look (search, «الفلاتر», the sort select and
 *  its direction); the search and the filters are inert in the mockup. */
function ToolbarLookalike({
  sortOptions,
  sort,
  onSort,
  placeholder = 'بحث برقم المعدة او اللوحة او رقم PO',
}: {
  sortOptions: { value: string; label: string }[]
  sort: DataTableSort
  onSort: (sort: DataTableSort) => void
  placeholder?: string
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={search}
        onValueChange={setSearch}
        placeholder={placeholder}
        className="w-full sm:w-72"
      />
      <Button variant="outline" icon={<Filter size={15} aria-hidden="true" />}>
        {t('filters')}
      </Button>
      <div className="ms-auto flex items-center gap-1.5">
        <Select
          aria-label={t('sortBy')}
          className="w-[170px]"
          value={sort.key}
          onValueChange={(key) => onSort({ ...sort, key })}
          options={sortOptions}
        />
        <IconButton
          variant="outline"
          label={sort.direction === 'asc' ? t('sortDescending') : t('sortAscending')}
          icon={
            sort.direction === 'asc' ? (
              <ArrowUp size={15} aria-hidden="true" />
            ) : (
              <ArrowDown size={15} aria-hidden="true" />
            )
          }
          onClick={() =>
            onSort({
              ...sort,
              direction: sort.direction === 'asc' ? 'desc' : 'asc',
            })
          }
        />
      </div>
    </div>
  )
}

function sortRows<Row>(
  rows: Row[],
  sort: DataTableSort,
  valueOf: (row: Row, key: string) => string | number,
  lang: string,
): Row[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key)
    const vb = valueOf(b, sort.key)
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), lang)
    return cmp * sign
  })
}

/** A client PO with its company and project names embedded. */
function poRow(po: MockClientPo) {
  const company = companyById(po.company_id)
  const project = projectById(po.project_id)
  return {
    ...po,
    company_name_ar: company?.name_ar ?? null,
    company_name_en: company?.name_en ?? null,
    project_name_ar: project?.name_ar ?? null,
    project_name_en: project?.name_en ?? null,
  }
}

// --- 1. The list with its two views ---------------------------------------------

type ListView = 'units' | 'orders'

type UnitRow = MockClientPoLine & {
  unit: MockEquipment | null
  po: ReturnType<typeof poRow>
}

type OrderRow = ReturnType<typeof poRow> & {
  equipment_count: number
  totals: { unit: SaleRateUnit; total: number }[]
}

function ClientPoListMockup({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<ListView>('units')
  const [unitSort, setUnitSort] = useState<DataTableSort>({
    key: 'equipment',
    direction: 'asc',
  })
  const [orderSort, setOrderSort] = useState<DataTableSort>({
    key: 'issue_date',
    direction: 'desc',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const unitRows = useMemo(() => {
    const rows: UnitRow[] = CLIENT_PO_LINES.map((line) => {
      const po = clientPoById(line.client_po_id) ?? CLIENT_POS[0]
      return { ...line, unit: equipmentById(line.equipment_id), po: poRow(po) }
    })
    return sortRows(
      rows,
      unitSort,
      (row, key) => {
        switch (key) {
          case 'po_number':
            return row.po.po_number
          case 'period_from':
            return row.period_from
          case 'price':
            return row.price
          case 'updated_at':
            return row.updated_at
          default:
            return row.unit?.code ?? ''
        }
      },
      lang,
    )
  }, [unitSort, lang])

  const orderRows = useMemo(() => {
    const rows: OrderRow[] = CLIENT_POS.map((po) => {
      const lines = linesOfClientPo(po.id)
      return {
        ...poRow(po),
        equipment_count: lines.length,
        totals: clientPoTotalsByUnit(lines),
      }
    })
    return sortRows(
      rows,
      orderSort,
      (row, key) => {
        switch (key) {
          case 'po_number':
            return row.po_number
          case 'expiry_date':
            return row.expiry_date ?? ''
          case 'status':
            return row.status
          case 'updated_at':
            return row.updated_at
          default:
            return row.issue_date
        }
      },
      lang,
    )
  }, [orderSort, lang])

  const unitColumns: DataTableColumn<UnitRow>[] = [
    {
      key: 'equipment',
      header: 'المعدة',
      sortable: true,
      cell: (row) => <UnitCell unit={row.unit} />,
    },
    {
      key: 'po_number',
      header: 'PO العميل',
      sortable: true,
      cell: (row) => <PoPill number={row.po.po_number} />,
    },
    {
      key: 'company_project',
      header: 'الشركة · المشروع',
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row.po} />,
    },
    {
      key: 'period_from',
      header: 'تاريخ البداية',
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) => formatDate(row.period_from),
    },
    {
      key: 'price',
      header: 'السعر',
      sortable: true,
      cell: (row) => <SalePrice value={row.price} unit={row.rate_unit} />,
    },
    {
      key: 'quantity',
      header: 'الكمية · المتبقي',
      hideBelow: 'sm',
      cell: (row) => <QuantityCell line={row} compact />,
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      hideBelow: 'md',
      className: 'text-muted',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  const orderColumns: DataTableColumn<OrderRow>[] = [
    {
      key: 'po_number',
      header: 'رقم PO العميل',
      sortable: true,
      cell: (row) => (
        <bdi dir="ltr" className="font-semibold">
          {row.po_number}
        </bdi>
      ),
    },
    {
      key: 'company',
      header: 'الشركة',
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="font-medium">
            {localizedName(lang, row.company_name_ar, row.company_name_en)}
          </span>
          <span className="text-xs text-muted">
            {localizedName(lang, row.project_name_ar, row.project_name_en)}
          </span>
        </span>
      ),
    },
    {
      key: 'issue_date',
      header: 'تاريخ الاصدار',
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) => formatDate(row.issue_date),
    },
    {
      key: 'expiry_date',
      header: 'تاريخ الانتهاء',
      sortable: true,
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) =>
        row.expiry_date ? (
          formatDate(row.expiry_date)
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'equipment_count',
      header: t('supplierPoEquipmentCount'),
      align: 'center',
      hideBelow: 'sm',
      className: 'tabular-nums',
      cell: (row) => row.equipment_count,
    },
    {
      key: 'total',
      header: t('supplierPoSummaryTotal'),
      align: 'end',
      cell: (row) => <TotalsByUnit parts={row.totals} alignEnd />,
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      cell: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      hideBelow: 'md',
      className: 'text-muted',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  const unitSortOptions = [
    { value: 'equipment', label: 'المعدة' },
    { value: 'po_number', label: 'رقم PO العميل' },
    { value: 'period_from', label: 'تاريخ البداية' },
    { value: 'price', label: 'السعر' },
    { value: 'updated_at', label: t('updatedAt') },
  ]
  const orderSortOptions = [
    { value: 'issue_date', label: 'تاريخ الاصدار' },
    { value: 'po_number', label: 'رقم PO العميل' },
    { value: 'expiry_date', label: 'تاريخ الانتهاء' },
    { value: 'status', label: t('status') },
    { value: 'updated_at', label: t('updatedAt') },
  ]

  const total = view === 'units' ? unitRows.length : orderRows.length

  return (
    <Mockup
      title="1. قائمة PO العملاء — /sales/orders"
      permission="sales.view يعرض القائمة · sales.manage يظهر زر «PO عميل جديد» (لاحقا)"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">PO العملاء</h2>
            <p className="text-sm text-muted">
              اوامر الشراء الواردة من العملاء ومعداتها واسعار البيع.
            </p>
          </div>
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
            PO عميل جديد
          </Button>
        </div>
        {/* The PO list's view switch (owner 2026-10-31): the selected tab is
            black like a primary button on this page only. */}
        <Tabs
          value={view}
          onValueChange={(next) => {
            setView(next as ListView)
            setPage(1)
          }}
        >
          <TabsList variant="segmented" aria-label="طريقة العرض">
            <TabsTrigger value="units" className={PRIMARY_ACTIVE_TRIGGER}>
              {t('poUnitsViewUnits')}
            </TabsTrigger>
            <TabsTrigger value="orders" className={PRIMARY_ACTIVE_TRIGGER}>
              {t('poUnitsViewOrders')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {view === 'units' ? (
          <>
            <ToolbarLookalike
              sortOptions={unitSortOptions}
              sort={unitSort}
              onSort={setUnitSort}
            />
            <DataTable
              size="md"
              cellTextClassName="text-[13px]"
              cellClassName="py-2"
              columns={unitColumns}
              rows={unitRows}
              rowKey={(row) => row.id}
              caption="PO العملاء حسب المعدات"
              sort={unitSort}
              onSortChange={(key, direction) => setUnitSort({ key, direction })}
              onRowClick={(row) => onOpen(row.po.id)}
            />
          </>
        ) : (
          <>
            <ToolbarLookalike
              sortOptions={orderSortOptions}
              sort={orderSort}
              onSort={setOrderSort}
            />
            <DataTable
              size="md"
              cellTextClassName="text-[13px]"
              cellClassName="py-2"
              columns={orderColumns}
              rows={orderRows}
              rowKey={(row) => row.id}
              caption="PO العملاء حسب الاوامر"
              sort={orderSort}
              onSortChange={(key, direction) => setOrderSort({ key, direction })}
              onRowClick={(row) => onOpen(row.id)}
            />
          </>
        )}
        <DataListPagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      </div>
    </Mockup>
  )
}

// --- 2. The client PO page --------------------------------------------------------

/** The detail-page pattern's timeline, shared by the PO page and the card
 *  page: each event already carries its label. */
interface TimelineEvent {
  id: string
  label: string
  detail: string | null
  actor_name: string
  created_at: string
}

function EventTimeline({ events }: { events: TimelineEvent[] }) {
  const latest = [...events].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )
  if (latest.length === 0)
    return <p className="text-sm text-muted">لا احداث بعد.</p>
  return (
    <ol className="relative ms-1.5 space-y-4 border-s ps-4">
      {latest.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-muted"
          />
          <p className="text-sm font-medium">{event.label}</p>
          {event.detail && (
            <p className="text-sm text-muted">
              {/* A detail that starts with a code or a number runs LTR; one
                  that starts with Arabic («اكتوبر (10): 248 ساعة») runs RTL. */}
              <bdi dir="auto">{event.detail}</bdi>
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {event.actor_name} ·{' '}
            <bdi dir="ltr">{formatDateTime(event.created_at, false)}</bdi>
          </p>
        </li>
      ))}
    </ol>
  )
}

/** The card period behind a line: «from – to», or «from – مفتوح». */
function periodLabel(line: MockClientPoLine, openEnd: string): string {
  const to = line.period_to ? formatDate(line.period_to) : openEnd
  return `${formatDate(line.period_from)} – ${to}`
}

function ClientPoPageMockup({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const po = clientPoById(selectedId) ?? CLIENT_POS[0]
  const row = poRow(po)
  const lines = linesOfClientPo(po.id).map((line) => ({
    ...line,
    unit: equipmentById(line.equipment_id),
  }))
  const events = CLIENT_PO_EVENTS.filter(
    (event) => event.client_po_id === po.id,
  ).map((event) => ({ ...event, label: CLIENT_PO_EVENT_LABEL[event.event_type] }))
  const open = po.status === 'open'
  const totals = clientPoTotalsByUnit(lines)
  const [sort, setSort] = useState<DataTableSort>({
    key: 'equipment',
    direction: 'asc',
  })
  const companyName = localizedName(lang, row.company_name_ar, row.company_name_en)
  const projectName = localizedName(lang, row.project_name_ar, row.project_name_en)

  const facts: DescriptionListItem[] = [
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: 'الشركة (العميل)',
      value: companyName,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: projectName,
    },
    {
      key: 'issue',
      icon: <Calendar size={16} />,
      label: 'تاريخ الاصدار',
      value: formatDate(po.issue_date),
      dir: 'ltr',
    },
    {
      key: 'expiry',
      icon: <CalendarDays size={16} />,
      label: 'تاريخ الانتهاء',
      value: po.expiry_date ? formatDate(po.expiry_date) : 'بدون تاريخ انتهاء',
      dir: po.expiry_date ? 'ltr' : undefined,
    },
    {
      key: 'hours',
      icon: <Timer size={16} />,
      label: 'الساعات القياسية',
      value: (
        <>
          <bdi dir="ltr" className="tabular-nums">
            {po.standard_hours}
          </bdi>{' '}
          ساعة / شهر
        </>
      ),
    },
    {
      key: 'createdBy',
      icon: <User size={16} />,
      label: 'انشئ بواسطة',
      value: po.created_by_name,
    },
    {
      key: 'createdAt',
      icon: <Clock size={16} />,
      label: 'تاريخ الانشاء',
      value: formatDateTime(po.created_at),
      dir: 'ltr',
    },
    ...(po.closed_at
      ? [
          {
            key: 'closedAt',
            icon: <Lock size={16} />,
            label: 'اقفل في',
            value: formatDateTime(po.closed_at),
            dir: 'ltr' as const,
          },
        ]
      : []),
    {
      key: 'notes',
      icon: <StickyNote size={16} />,
      label: t('notes'),
      value: po.notes ?? '—',
    },
  ]

  const sortedLines = sortRows(
    lines,
    sort,
    (line, key) => {
      switch (key) {
        case 'period':
          return line.period_from
        case 'price':
          return line.price
        default:
          return line.unit?.code ?? ''
      }
    },
    lang,
  )
  const sortOptions = [
    { value: 'equipment', label: 'المعدة' },
    { value: 'period', label: 'الفترة' },
    { value: 'price', label: 'السعر' },
  ]
  const sortControls = (
    <div className="flex items-center gap-1.5">
      <Select
        size="sm"
        aria-label={t('sortBy')}
        className="w-[130px]"
        value={sort.key}
        onValueChange={(key) => setSort((current) => ({ ...current, key }))}
        options={sortOptions}
      />
      <IconButton
        size="sm"
        variant="outline"
        label={sort.direction === 'asc' ? t('sortDescending') : t('sortAscending')}
        icon={
          sort.direction === 'asc' ? (
            <ArrowUp size={14} aria-hidden="true" />
          ) : (
            <ArrowDown size={14} aria-hidden="true" />
          )
        }
        onClick={() =>
          setSort((current) => ({
            ...current,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          }))
        }
      />
    </div>
  )

  const editButton = (size: 'sm' | 'md') => (
    <Button
      variant="outline"
      size={size}
      className={size === 'md' ? 'h-11 flex-1' : undefined}
      icon={<Edit2 size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
    >
      تعديل
    </Button>
  )
  const closeButton = (size: 'sm' | 'md') => (
    <Button
      variant="danger"
      size={size}
      className={size === 'md' ? 'h-11' : undefined}
    >
      اقفال
    </Button>
  )

  return (
    <Mockup
      title="2. صفحة PO العميل — /sales/orders/:id (نمط صفحات التفاصيل المعتمد)"
      permission="sales.view يعرض الصفحة · sales.manage يظهر «اضافة معدة» و«تعديل» و«اقفال» على الامر المفتوح · بلا اعتماد وبلا PDF"
      controls={
        <Select
          size="sm"
          aria-label="PO العميل المعروض"
          className="w-[230px]"
          value={po.id}
          onValueChange={onSelect}
          options={CLIENT_POS.map((item) => ({
            value: item.id,
            label: `${item.po_number} · ${STATUS_LABEL[item.status]}`,
          }))}
        />
      }
    >
      <div className="space-y-4">
        <BackButton onClick={() => undefined} label="العودة الى PO العملاء" />

        {/* 1. The header card (owner 2026-10-24: no meta line): the client's
            number with its status, the CLIENT on its own line, the project
            under it, the actions at the end, then the summary strip. */}
        <div className="card space-y-4 p-4">
          <DetailHeader
            as="h2"
            identifier={po.po_number}
            identifierLtr
            subtitle={
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
                  <Building2 size={16} aria-hidden="true" className="text-muted" />
                  {companyName}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <MapPin size={14} aria-hidden="true" />
                  {projectName}
                </span>
              </span>
            }
            badges={<StatusBadge status={po.status} />}
            actions={
              open ? (
                <div className="hidden gap-2 sm:flex">
                  {editButton('sm')}
                  {closeButton('sm')}
                </div>
              ) : undefined
            }
          />
          {/* 2. The summary strip: four cards, one amount per price unit
              (a month, a day and an hour are never added together). */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label={t('supplierPoSummaryTotal')}
              value={<TotalsByUnit parts={totals} />}
              icon={<Coins size={18} />}
            />
            <StatCard
              label={t('supplierPoSummaryVat')}
              hint="15%"
              value={
                <TotalsByUnit
                  parts={totals}
                  amount={(total) => clientPoTotalFigures(total).vat}
                />
              }
              icon={<Receipt size={18} />}
            />
            <StatCard
              label={t('supplierPoSummaryTotalWithVat')}
              value={
                <TotalsByUnit
                  parts={totals}
                  amount={(total) => clientPoTotalFigures(total).inclVat}
                />
              }
              icon={<Coins size={18} />}
            />
            <StatCard
              label={t('supplierPoEquipmentCount')}
              value={lines.length}
              icon={<Truck size={18} />}
            />
          </div>
        </div>

        {!open && (
          <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
            PO مغلق: للقراءة فقط، لا اضافة ولا تعديل.
          </Notice>
        )}

        {/* 3. The body (owner 2026-10-24): below xl the facts sit ABOVE the
            lines, then the timeline; from xl the lines span two columns
            beside the facts and the timeline. */}
        <div className="grid gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
          <Card className="order-1 space-y-3 p-4 xl:order-none xl:col-start-3">
            <SectionHeader title="بيانات PO العميل" />
            <DescriptionList items={facts} className="-my-2" />
          </Card>

          <Card
            padded={false}
            className="order-2 flex min-w-0 flex-col xl:order-none xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1"
          >
            <div className="p-4 pb-0">
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    معدات الـ PO
                    <Badge size="sm">{lines.length}</Badge>
                  </span>
                }
                description="كل معدة بسعر بيعها بدون ضريبة ووحدته وساعاتها القياسية وكميتها التعاقدية."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    {lines.length > 1 && sortControls}
                    {open && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Plus size={14} aria-hidden="true" />}
                      >
                        اضافة معدة
                      </Button>
                    )}
                  </div>
                }
              />
            </div>
            {lines.length === 0 ? (
              <div className="p-4">
                <EmptyState title="لا معدات على هذا الـ PO بعد" className="p-6" />
              </div>
            ) : (
              <ul className="space-y-2 p-4 pt-3">
                {/* 4. One wide card per line: identity at the start, the
                    period, hours and note in the middle, and at the end a
                    fixed-width block with the price, the quantity and the
                    remaining bar (a phase-4 placeholder). */}
                {sortedLines.map((line) => (
                  <li key={line.id} className="rounded-xl border bg-bg p-3 sm:p-4">
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:flex-nowrap">
                      <div className="min-w-0 flex-1 sm:basis-2/5">
                        <UnitCell unit={line.unit} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1 sm:basis-3/5">
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          <Calendar size={12} aria-hidden="true" className="shrink-0" />
                          <bdi dir="ltr">
                            {periodLabel(line, t('equipmentPurchasingOpenEnd'))}
                          </bdi>
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          <Timer size={12} aria-hidden="true" className="shrink-0" />
                          <span>
                            الساعات القياسية{' '}
                            <bdi dir="ltr" className="font-medium text-fg">
                              {line.standard_hours}
                            </bdi>{' '}
                            · {SALE_RATE_UNIT_LABEL[line.rate_unit]}
                          </span>
                        </p>
                        {line.note && (
                          <p className="flex items-start gap-1.5 text-xs text-muted">
                            <StickyNote
                              size={12}
                              aria-hidden="true"
                              className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0 break-words">{line.note}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex w-full flex-col gap-2 border-t pt-3 sm:w-48 sm:shrink-0 sm:items-end sm:border-t-0 sm:pt-0">
                        <div className="flex w-full items-start justify-between gap-3 sm:flex-col sm:items-end">
                          <div className="text-start sm:text-end">
                            <p className="text-xs text-muted">سعر البيع</p>
                            <p className="text-lg font-semibold">
                              <SalePrice value={line.price} unit={line.rate_unit} />
                            </p>
                          </div>
                          {open && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<Edit2 size={14} aria-hidden="true" />}
                            >
                              تعديل
                            </Button>
                          )}
                        </div>
                        <QuantityCell line={line} />
                      </div>
                    </div>
                  </li>
                ))}
                <li className="rounded-xl border bg-surface p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                    <p className="text-sm font-medium">{t('supplierPoSummaryTotal')}</p>
                    <p className="text-lg font-semibold sm:w-48 sm:shrink-0">
                      <TotalsByUnit parts={totals} alignEnd />
                    </p>
                  </div>
                </li>
              </ul>
            )}
          </Card>

          <Card className="order-3 space-y-3 p-4 xl:order-none xl:col-start-3">
            <SectionHeader
              title="سجل الاحداث"
              description="الانشاء واضافة المعدات وتعديل الاسعار والاقفال."
            />
            <EventTimeline events={events} />
          </Card>
        </div>

        {/* 5. The mobile action bar (fixed to the viewport in the real page). */}
        {open && (
          <div
            className="sticky bottom-0 z-10 -mx-3 -mb-3 flex gap-2 border-t bg-bg p-3 sm:hidden"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <Button
              variant="primary"
              className="h-11 flex-1"
              icon={<Plus size={16} aria-hidden="true" />}
            >
              اضافة معدة
            </Button>
            {editButton('md')}
            {closeButton('md')}
          </div>
        )}
      </div>
    </Mockup>
  )
}

// --- 3. The «المبيعات» card of the equipment page -----------------------------------

function EquipmentSalesCardMockup({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n()
  const [withPo, setWithPo] = useState<'with' | 'without'>('with')
  const unit = equipmentById(SALES_CARD_EQUIPMENT_ID)
  const rows = CLIENT_PO_LINES.filter(
    (line) => line.equipment_id === SALES_CARD_EQUIPMENT_ID,
  )
    .map((line) => {
      const po = clientPoById(line.client_po_id)
      return po ? { ...line, po: poRow(po) } : null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
  type CardRow = (typeof rows)[number]

  const columns: DataTableColumn<CardRow>[] = [
    {
      key: 'po',
      header: 'PO العميل',
      cell: (row) => <PoPill number={row.po.po_number} onClick={() => onOpen(row.po.id)} />,
    },
    {
      key: 'company_project',
      header: 'الشركة · المشروع',
      cell: (row) => <CompanyProjectCell row={row.po} />,
    },
    {
      key: 'since',
      header: 'منذ',
      className: 'tabular-nums',
      hideBelow: 'sm',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {formatDate(row.period_from)}
          {' – '}
          {row.period_to ? formatDate(row.period_to) : t('equipmentPurchasingOpenEnd')}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'سعر البيع',
      align: 'end',
      cell: (row) => <SalePrice value={row.price} unit={row.rate_unit} />,
    },
    {
      key: 'quantity',
      header: 'الكمية',
      hideBelow: 'md',
      cell: (row) => quantityLabel(row.quantity, row.quantity_unit) ?? '—',
    },
  ]

  return (
    <Mockup
      title="3. كرت «المبيعات» في صفحة المعدة — /equipment/:id"
      permission="يظهر فقط مع sales.view · للقراءة فقط، تحت كرت «المشتريات»"
      controls={
        <Tabs value={withPo} onValueChange={(next) => setWithPo(next as 'with' | 'without')}>
          <TabsList variant="segmented" aria-label="حالة الكرت">
            <TabsTrigger value="with">مع PO عميل</TabsTrigger>
            <TabsTrigger value="without">بدون PO عميل</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          موضع الكرت: بعد كرت «المشتريات» وقبل سجل الحركات. المعدة في المثال:{' '}
          <bdi dir="ltr">{unit?.code}</bdi> · {unit?.type}
        </p>
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-0">
            <SectionHeader
              title="المبيعات"
              description="PO العملاء التي تقف عليها المعدة، الحالي اولا."
            />
          </div>
          <div className="p-4">
            {withPo === 'without' ? (
              <EmptyState
                icon={<FileText size={24} aria-hidden="true" />}
                title="بدون PO عميل"
                description="المعدة ليست على اي PO عميل الان."
                className="p-6"
              />
            ) : (
              <DataTable
                size="md"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                caption="المبيعات"
              />
            )}
          </div>
        </Card>
      </div>
    </Mockup>
  )
}

// --- 4. The ticket with two stubs -------------------------------------------------

/** The plate's digits, then its letters spaced by letter-spacing, or the
 *  chassis as it is (the ticket's identity line). */
function PlateOrChassis({
  plate,
  chassis,
}: {
  plate: string | null
  chassis: string | null
}) {
  const parts = plate ? splitPlateForDisplay(plate) : null
  const text = plate?.trim() || chassis?.trim()
  if (!parts) return text ? <>{text}</> : null
  return (
    <>
      {parts.digits}{' '}
      <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
    </>
  )
}

/** One stub under the perforation: who it is for (المورد / العميل), the
 *  state, and the PO pill or the round amber «+» that says what it will do. */
function Stub({
  side,
  poNumber,
  targetPoNumber,
  noPoLabel,
  first,
}: {
  side: string
  poNumber: string | null
  targetPoNumber: string | null
  noPoLabel: string
  first: boolean
}) {
  const tone = poNumber ? 'success' : 'warning'
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 px-3 py-2.5 ${
        first ? 'rounded-es-xl' : 'rounded-ee-xl border-s border-dashed'
      }`}
      style={{ backgroundColor: `var(--${tone}-soft)` }}
    >
      <span className="text-[11px] leading-4 text-muted">{side}</span>
      {/* Half the ticket's width per stub: with a PO the pill speaks alone
          (the stub's own label above says whose PO it is). */}
      <div className="flex items-center justify-between gap-2">
        {!poNumber && (
          <span
            className="text-xs font-medium"
            style={{ color: `var(--${tone})` }}
          >
            {noPoLabel}
          </span>
        )}
        {poNumber ? (
          <PoPill number={poNumber} onClick={() => undefined} />
        ) : (
          <button
            type="button"
            className="group/add inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            style={ADD_BUTTON_STYLE}
          >
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-normal opacity-0 group-hover/add:max-w-40 group-hover/add:pe-1 group-hover/add:ps-2 group-hover/add:opacity-100 group-focus-visible/add:max-w-40 group-focus-visible/add:pe-1 group-focus-visible/add:ps-2 group-focus-visible/add:opacity-100 motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out">
              {targetPoNumber ? (
                <>
                  اضافة الى <bdi dir="ltr">{targetPoNumber}</bdi>
                </>
              ) : (
                'PO جديد'
              )}
            </span>
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
          </button>
        )}
      </div>
    </div>
  )
}

function Ticket({ ticket }: { ticket: MockTicket }) {
  const { lang } = useI18n()
  const unit = equipmentById(ticket.equipment_id)
  const company = companyById(ticket.company_id)
  const project = projectById(ticket.project_id)
  const ownerLine = unit
    ? unit.ownership === 'external_supplier'
      ? (unit.lessor_name ?? 'مالك اخر')
      : unit.ownership === 'alazani'
        ? 'العزاني'
        : unit.ownership === 'takween'
          ? 'تكوين'
          : unit.ownership === 'third_party_f'
            ? 'طرف ثالث F'
            : 'طرف ثالث B'
    : '—'
  return (
    <div className="flex flex-1 flex-col rounded-xl border bg-bg text-[13px]">
      <div className="space-y-2 p-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold leading-6">
              <bdi dir="ltr">{unit?.code ?? '—'}</bdi>
            </p>
            <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-surface-hover px-1.5 text-fg">
              <ArrowUpRight size={16} aria-hidden="true" className="rtl:-scale-x-100" />
            </span>
          </div>
          <p className="break-words leading-5">{unit?.type ?? '—'}</p>
          <p className="text-xs leading-5 text-muted">
            {(unit?.plate_number || unit?.chassis_number) && (
              <>
                <bdi dir="ltr">
                  <PlateOrChassis
                    plate={unit?.plate_number ?? null}
                    chassis={unit?.chassis_number ?? null}
                  />
                </bdi>
                {' · '}
              </>
            )}
            {ticket.contractor_code ? (
              <bdi dir="ltr" className="font-medium text-fg">
                {ticket.contractor_code}
              </bdi>
            ) : (
              '—'
            )}
          </p>
        </div>
        <div className="border-t" />
        <div className="min-w-0 space-y-1">
          <p className="break-words text-xs leading-5 text-muted">{ownerLine}</p>
          <p className="break-words text-xs leading-5 text-muted">
            {company ? localizedName(lang, company.name_ar, company.name_en) : '—'} ·{' '}
            {project ? localizedName(lang, project.name_ar, project.name_en) : '—'}
          </p>
          <p className="break-words text-xs leading-5 text-muted">
            الفورمان <span className="font-medium text-fg">{ticket.foreman}</span>
          </p>
          <p className="break-words text-xs leading-5 text-muted">
            تاريخ الدخول{' '}
            <bdi dir="ltr" className="font-medium text-fg">
              {formatDate(ticket.entry_date)}
            </bdi>
          </p>
        </div>
      </div>
      {/* The perforation (no side notches), then TWO stubs side by side:
          the supplier PO as today and the client PO beside it. */}
      <div className="mx-3 mt-auto border-t border-dashed" />
      <div className="grid grid-cols-2">
        <Stub
          side="PO المورد"
          poNumber={ticket.supplier_po_number}
          targetPoNumber={ticket.supplier_party_po_number}
          noPoLabel="بدون PO"
          first
        />
        <Stub
          side="PO العميل"
          poNumber={ticket.client_po_number}
          targetPoNumber={ticket.client_project_po_number}
          noPoLabel="بدون PO عميل"
          first={false}
        />
      </div>
    </div>
  )
}

const TICKET_CASES = [
  'الحالتان مكتملتان',
  'PO مورد فقط',
  'PO عميل فقط',
  'بدون الاثنين',
]

function TicketsMockup() {
  return (
    <Mockup
      title="4. تذكرة المعدة في «المعدات في المشاريع» — /purchasing/units"
      permission="كعب المورد يحتاج purchasing.view (والاضافة purchasing.manage) · كعب العميل يحتاج sales.view (والاضافة sales.manage) · من لا يملك احدهما يرى كعبا واحدا كما اليوم"
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          التذكرة المعتمدة كما هي فوق الخط المنقط، وتحته كعبان متجاوران بدل
          واحد: المورد في البداية والعميل في النهاية، كل كعب بلون حالته
          (كهرماني بدون PO مع زر «+» يقول ماذا سيفعل، اخضر مع رقم الـ PO).
          الحالات الاربع:
        </p>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TICKETS.map((ticket, index) => (
            <li key={ticket.id} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">{TICKET_CASES[index]}</span>
              <Ticket ticket={ticket} />
            </li>
          ))}
        </ul>
      </div>
    </Mockup>
  )
}

// --- 5. The equipment card page -----------------------------------------------------

const CARD_STATUS_LABEL: Readonly<Record<CardStatus, string>> = {
  open: 'مفتوح',
  ended: 'منتهي',
}

function CardStatusBadge({
  status,
  size,
}: {
  status: CardStatus
  size?: 'sm' | 'md'
}) {
  return (
    <Badge tone={status === 'open' ? 'success' : 'neutral'} size={size}>
      {CARD_STATUS_LABEL[status]}
    </Badge>
  )
}

/** «من 15/07/2026 · مفتوح» / «15/07/2026 – 30/09/2026». */
function cardPeriodLabel(card: Pick<MockCard, 'period_from' | 'period_to'>) {
  return card.period_to
    ? `${formatDate(card.period_from)} – ${formatDate(card.period_to)}`
    : `${formatDate(card.period_from)} · مفتوح`
}

/** An amount or a muted dash. */
function AmountOrDash({ value, unit }: { value: number | null; unit?: SaleRateUnit }) {
  if (value === null) return <span className="text-muted">—</span>
  return <SalePrice value={value} unit={unit} />
}

// --- Phase 2 («كروت التشغيل»): the monthly hours of a card -------------------------

type DueSide = 'client' | 'supplier' | 'margin'

const NO_LINE_LABEL: Readonly<Record<DueSide, string>> = {
  client: 'بدون PO عميل',
  supplier: 'بدون PO مورد',
  margin: '—',
}

/** A month's amount of one side, or why there is none: «تحتاج سعر» for an
 *  unpriced line, «—» with its hint for a daily line (no rule yet), a muted
 *  dash otherwise (no hours, an owned unit's supplier side, no line). */
function DueCell({
  due,
  side,
  alignEnd = true,
}: {
  due: MonthDue
  side: DueSide
  alignEnd?: boolean
}) {
  if (due.value !== null) return <AmountOrDash value={due.value} />
  const align = alignEnd ? 'items-end text-end' : 'items-start text-start'
  switch (due.blocker) {
    case 'unpriced':
      return <span className="text-xs font-medium text-warning">تحتاج سعر</span>
    case 'no_line':
      return <span className="text-xs text-muted">{NO_LINE_LABEL[side]}</span>
    case 'daily':
      // The hint sits under the side that is daily; the margin's dash is
      // explained by the side beside it.
      if (side === 'margin') return <span className="text-muted">—</span>
      return (
        <span className={`inline-flex flex-col ${align}`}>
          <span className="text-muted">—</span>
          <span className="text-[11px] leading-4 text-muted">سطر يومي: الحساب لاحقا</span>
        </span>
      )
    default:
      return <span className="text-muted">—</span>
  }
}

/** «مسجل» (green) / «بانتظار» (amber: an elapsed month of an open card
 *  without hours) / «جاري» (the running month). */
function MonthStateBadge({ state, size = 'sm' }: { state: CardMonthState; size?: 'sm' | 'md' }) {
  const tone = state === 'recorded' ? 'success' : state === 'pending' ? 'warning' : 'info'
  return (
    <Badge tone={tone} size={size}>
      {CARD_MONTH_STATE_LABEL[state]}
    </Badge>
  )
}

/** The in-memory store of the phase-2 mockups: the recorded months of every
 *  card and the events the screens add, shared by the batch screen, the
 *  months list and the card page so a save shows everywhere. */
interface MonthsStore {
  recordsOf: (card: MockCard) => MockCardMonth[]
  eventsOf: (cardId: string) => MockCardEvent[]
  saveMany: (
    items: { card: MockCard; month: string; hours: number; note: string | null }[],
  ) => void
  remove: (card: MockCard, month: string) => void
}

const byMonth = (a: MockCardMonth, b: MockCardMonth) => a.month.localeCompare(b.month)

function useMonthsStore(): MonthsStore {
  const [overrides, setOverrides] = useState<Record<string, MockCardMonth[]>>({})
  const [extraEvents, setExtraEvents] = useState<MockCardEvent[]>([])
  const recordsOf = (card: MockCard) => overrides[card.id] ?? card.months
  const eventsOf = (cardId: string) => [
    ...CARD_EVENTS.filter((event) => event.card_id === cardId),
    ...extraEvents.filter((event) => event.card_id === cardId),
  ]
  const addEvents = (events: Omit<MockCardEvent, 'id' | 'actor_name' | 'created_at'>[]) => {
    const now = new Date().toISOString()
    setExtraEvents((prev) => [
      ...prev,
      ...events.map((event, index) => ({
        ...event,
        id: `local-${prev.length + index + 1}`,
        actor_name: SALES_ACTOR_NAME,
        created_at: now,
      })),
    ])
  }
  const saveMany: MonthsStore['saveMany'] = (items) => {
    const now = new Date().toISOString()
    const events: Omit<MockCardEvent, 'id' | 'actor_name' | 'created_at'>[] = []
    setOverrides((prev) => {
      const next = { ...prev }
      for (const item of items) {
        const current = next[item.card.id] ?? item.card.months
        const existing = current.find((record) => record.month === item.month) ?? null
        const record: MockCardMonth = {
          month: item.month,
          hours: item.hours,
          note: item.note,
          recorded_by_name: SALES_ACTOR_NAME,
          recorded_at: now,
        }
        next[item.card.id] = [
          ...current.filter((entry) => entry.month !== item.month),
          record,
        ].sort(byMonth)
        events.push({
          card_id: item.card.id,
          event_type: existing ? 'hours_updated' : 'hours_recorded',
          detail: existing
            ? existing.hours === item.hours
              ? `${monthShortLabel(item.month)}: تعديل الملاحظة`
              : hoursUpdatedDetail(item.month, existing.hours, item.hours)
            : hoursRecordedDetail(item.month, item.hours),
        })
      }
      return next
    })
    addEvents(events)
  }
  const remove: MonthsStore['remove'] = (card, month) => {
    const existing = recordsOf(card).find((record) => record.month === month)
    setOverrides((prev) => ({
      ...prev,
      [card.id]: (prev[card.id] ?? card.months).filter((record) => record.month !== month),
    }))
    if (existing)
      addEvents([
        {
          card_id: card.id,
          event_type: 'hours_deleted',
          detail: hoursRecordedDetail(month, existing.hours),
        },
      ])
  }
  return { recordsOf, eventsOf, saveMany, remove }
}

/** The hours typed in a field as a number, or null when empty or invalid. */
function parseHours(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const hours = Number(trimmed)
  return Number.isFinite(hours) && hours >= 0 ? hours : null
}

/** The dialog «تسجيل شهر» of the card page: a month without a record (or
 *  the recorded month being edited, locked), the hours with the live client
 *  due under them, a note; «حذف» for a recorded month. */
function MonthRecordDialog({
  card,
  rows,
  month: initialMonth,
  onClose,
  onSave,
  onDelete,
}: {
  card: MockCard
  rows: CardMonthRow[]
  /** The month to record or edit; null picks the newest month without a record. */
  month: string | null
  onClose: () => void
  onSave: (month: string, hours: number, note: string | null) => void
  onDelete: (month: string) => void
}) {
  const initialRow = initialMonth ? rows.find((row) => row.month === initialMonth) ?? null : null
  const editing = initialRow?.record ?? null
  const openMonths = editing
    ? [initialRow as CardMonthRow]
    : [...rows].reverse().filter((row) => row.state !== 'recorded')
  const [month, setMonth] = useState(initialMonth ?? openMonths[0]?.month ?? '')
  const [hours, setHours] = useState(editing ? String(editing.hours) : '')
  const [note, setNote] = useState(editing?.note ?? '')
  const parsed = parseHours(hours)
  const figures = cardMonthFigures(card, parsed)
  const valid = month !== '' && parsed !== null
  const dueHint =
    parsed === null ? (
      'مستحق العميل يحسب من الساعات مباشرة.'
    ) : figures.client.value !== null ? (
      <span className="inline-flex items-baseline gap-1">
        مستحق العميل: <SalePrice value={figures.client.value} className="text-fg" />
      </span>
    ) : figures.client.blocker === 'daily' ? (
      'سطر يومي: الحساب لاحقا.'
    ) : figures.client.blocker === 'unpriced' ? (
      'سطر العميل بلا سعر بعد: الساعات تسجل والمستحق يحسب عند تسعيره.'
    ) : (
      'بدون PO عميل: الساعات تسجل فقط.'
    )
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={editing ? `تعديل ساعات ${monthShortLabel(month)}` : 'تسجيل شهر'}
      description={
        <>
          <bdi dir="ltr">{equipmentById(card.equipment_id)?.code}</bdi> · الساعات من كرت
          التشغيل (التايم شيت الشهري للعميل).
        </>
      }
      footer={
        <>
          {editing && (
            <Button
              variant="ghost"
              className="me-auto text-danger hover:text-danger"
              icon={<Trash2 size={16} aria-hidden="true" />}
              onClick={() => {
                onDelete(month)
                onClose()
              }}
            >
              حذف
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            icon={<Save size={16} aria-hidden="true" />}
            onClick={() => {
              if (parsed === null) return
              onSave(month, parsed, note.trim() || null)
              onClose()
            }}
          >
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="الشهر"
          required
          hint={
            editing
              ? 'الشهر المسجل لا يتغير؛ عدل ساعاته او احذفه.'
              : openMonths.length === 0
                ? 'كل شهور الكرت مسجلة.'
                : undefined
          }
        >
          {(control) => (
            <Select
              {...control}
              value={month}
              onValueChange={setMonth}
              disabled={!!editing || openMonths.length === 0}
              placeholder="اختر الشهر"
              options={openMonths.map((row) => ({
                value: row.month,
                label: monthLabel(row.month),
                description: row.state === 'running' ? 'الشهر الجاري' : undefined,
              }))}
            />
          )}
        </Field>
        <Field label="الساعات" required hint={dueHint}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              placeholder={`الساعات القياسية ${card.standard_hours}`}
              className="tabular-nums"
              autoFocus
            />
          )}
        </Field>
        <Field label="ملاحظة">
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="اختياري"
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

type CardSample = keyof typeof CARD_PAGE_SAMPLES

const CARD_SAMPLE_LABEL: Readonly<Record<CardSample, string>> = {
  rented: 'معدة مستاجرة (الجانبان)',
  owned: 'معدة العزاني (العميل فقط)',
  daily: 'سطر يومي',
}

/** The sample whose card is open, if the open card is one of them. */
function sampleOfCard(cardId: string): CardSample | undefined {
  return (Object.keys(CARD_PAGE_SAMPLES) as CardSample[]).find(
    (key) => CARD_PAGE_SAMPLES[key] === cardId,
  )
}

function CardPageMockup({
  cardId,
  onSelectCard,
  store,
}: {
  cardId: string
  onSelectCard: (id: string) => void
  store: MonthsStore
}) {
  const { lang } = useI18n()
  const card = cardById(cardId) ?? CARDS[0]
  const unit = equipmentById(card.equipment_id)
  const company = companyById(card.company_id)
  const project = projectById(card.project_id)
  const companyName = company ? localizedName(lang, company.name_ar, company.name_en) : '—'
  const projectName = project ? localizedName(lang, project.name_ar, project.name_en) : '—'
  const open = card.status === 'open'
  const records = store.recordsOf(card)
  const monthRows = cardMonthRows(card, records)
  const latest = latestRecordedMonth(records)
  const figures = cardMonthFigures(card, latest?.hours ?? null)
  const pendingCount = monthRows.filter((row) => row.state !== 'recorded').length
  const [dialog, setDialog] = useState<{ month: string | null } | null>(null)
  const events = store
    .eventsOf(card.id)
    .map((event) => ({ ...event, label: CARD_EVENT_LABEL[event.event_type] }))

  const movementFacts: DescriptionListItem[] = [
    {
      key: 'entry',
      icon: <LogIn size={16} />,
      label: 'تاريخ الدخول',
      value: formatDate(card.entry_date),
      dir: 'ltr',
    },
    {
      key: 'exit',
      icon: <LogOut size={16} />,
      label: 'تاريخ الخروج',
      value: card.exit_date ? formatDate(card.exit_date) : 'ما زالت داخل',
      dir: card.exit_date ? 'ltr' : undefined,
    },
    {
      key: 'foreman',
      icon: <User size={16} />,
      label: 'الفورمان',
      value: card.foreman,
    },
    {
      key: 'driver',
      icon: <User size={16} />,
      label: 'السائق الحالي',
      value: card.driver,
    },
  ]

  const salesFacts: DescriptionListItem[] = card.client_po_number
    ? [
        {
          key: 'po',
          icon: <FileText size={16} />,
          label: 'PO العميل',
          value: <PoPill number={card.client_po_number} onClick={() => undefined} />,
        },
        {
          key: 'price',
          icon: <Coins size={16} />,
          label: 'سعر البيع',
          value: <AmountOrDash value={card.sale_price} unit={card.rate_unit} />,
        },
        {
          key: 'hours',
          icon: <Timer size={16} />,
          label: 'الساعات القياسية',
          value: (
            <>
              <bdi dir="ltr" className="tabular-nums">
                {card.standard_hours}
              </bdi>{' '}
              ساعة / شهر
            </>
          ),
        },
        {
          key: 'quantity',
          icon: <Hourglass size={16} />,
          label: 'الكمية التعاقدية',
          value: (
            <QuantityCell
              line={{
                quantity: card.quantity,
                quantity_unit: card.quantity_unit,
                consumed: card.consumed,
              }}
            />
          ),
        },
      ]
    : []

  const purchasingFacts: DescriptionListItem[] =
    card.owned || !card.supplier_po_number
      ? []
      : [
          {
            key: 'po',
            icon: <FileText size={16} />,
            label: 'PO المورد',
            value: <PoPill number={card.supplier_po_number} onClick={() => undefined} />,
          },
          {
            key: 'supplier',
            icon: <Building2 size={16} />,
            label: 'المورد',
            value: card.supplier_name ?? '—',
          },
          {
            key: 'price',
            icon: <Coins size={16} />,
            label: 'سعر الشراء',
            value: (
              <AmountOrDash value={card.purchase_price} unit={card.purchase_rate_unit} />
            ),
          },
        ]

  const monthColumns: DataTableColumn<CardMonthRow>[] = [
    {
      key: 'month',
      header: 'الشهر',
      cell: (row) => <span className="font-medium">{monthLabel(row.month)}</span>,
    },
    {
      key: 'hours',
      header: 'الساعات',
      align: 'center',
      className: 'tabular-nums',
      cell: (row) =>
        row.record ? row.record.hours : <span className="text-muted">—</span>,
    },
    {
      key: 'client',
      header: 'مستحق العميل',
      align: 'end',
      cell: (row) => (
        <DueCell due={cardMonthFigures(card, row.record?.hours ?? null).client} side="client" />
      ),
    },
    {
      key: 'supplier',
      header: 'مستحق المورد',
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <DueCell
          due={cardMonthFigures(card, row.record?.hours ?? null).supplier}
          side="supplier"
        />
      ),
    },
    {
      key: 'margin',
      header: 'الهامش',
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <DueCell due={cardMonthFigures(card, row.record?.hours ?? null).margin} side="margin" />
      ),
    },
    {
      key: 'state',
      header: 'الحالة',
      cell: (row) => <MonthStateBadge state={row.state} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">الاجراءات</span>,
      align: 'end',
      cell: (row) =>
        !open ? null : row.record ? (
          <IconButton
            size="sm"
            variant="ghost"
            label={`تعديل ساعات ${monthLabel(row.month)}`}
            icon={<Edit2 size={14} aria-hidden="true" />}
            onClick={() => setDialog({ month: row.month })}
          />
        ) : (
          <IconButton
            size="sm"
            variant="ghost"
            label={`تسجيل ساعات ${monthLabel(row.month)}`}
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setDialog({ month: row.month })}
          />
        ),
    },
  ]

  const endButton = (size: 'sm' | 'md') => (
    <Button
      variant="danger"
      size={size}
      className={size === 'md' ? 'h-11' : undefined}
      icon={<Lock size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
    >
      انهاء الكرت
    </Button>
  )
  const recordButton = (size: 'sm' | 'md') => (
    <Button
      variant="primary"
      size={size}
      className={size === 'md' ? 'h-11 flex-1' : undefined}
      icon={<Plus size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
      disabled={pendingCount === 0}
      onClick={() => setDialog({ month: null })}
    >
      تسجيل شهر
    </Button>
  )
  const latestHint = latest ? `${monthLabel(latest.month)} · اخر شهر مسجل` : 'لا شهر مسجل بعد'
  const sample = sampleOfCard(card.id)

  return (
    <Mockup
      title="5. صفحة كرت المعدة — /sales/cards/:id (نمط صفحات التفاصيل المعتمد)"
      permission="sales.view او purchasing.view يعرض الصفحة كاملة (قرار 2026-10-15: لا اخفاء بين الجانبين) · «تسجيل شهر» والتعديل والحذف لحاملي sales.manage · «انهاء الكرت» للادمن على الكرت المفتوح"
      controls={
        <Tabs
          value={sample ?? ''}
          onValueChange={(next) => onSelectCard(CARD_PAGE_SAMPLES[next as CardSample])}
        >
          <TabsList variant="segmented" aria-label="عينة الكرت">
            {(Object.keys(CARD_PAGE_SAMPLES) as CardSample[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {CARD_SAMPLE_LABEL[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className="space-y-4">
        <BackButton onClick={() => undefined} label="العودة الى كروت المعدات" />

        {/* 1. The header card: the unit with its plate and type, the company
            and project on their own line, the period, the status, the one
            action, then the summary strip. */}
        <div className="card space-y-4 p-4">
          <DetailHeader
            as="h2"
            identifier={unit?.code ?? '—'}
            identifierLtr
            subtitle={
              <span className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
                  {unit && (
                    <EquipmentIdentifierTag
                      row={{
                        equipment_plate_number: unit.plate_number,
                        equipment_chassis_number: unit.chassis_number,
                      }}
                    />
                  )}
                  <span>{unit?.type ?? '—'}</span>
                </span>
                <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
                  <Building2 size={16} aria-hidden="true" className="text-muted" />
                  {companyName} · {projectName}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <Calendar size={14} aria-hidden="true" />
                  <bdi dir="ltr">{cardPeriodLabel(card)}</bdi>
                </span>
              </span>
            }
            badges={<CardStatusBadge status={card.status} />}
            actions={
              open ? (
                <div className="hidden gap-2 sm:flex">
                  {recordButton('sm')}
                  {endButton('sm')}
                </div>
              ) : undefined
            }
          />
          {/* 2. The summary strip: the LATEST RECORDED month's figures
              (phase 2); the month is the hint. */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label="مستحق العميل"
              value={<DueCell due={figures.client} side="client" alignEnd={false} />}
              hint={latestHint}
              icon={<Coins size={18} />}
            />
            <StatCard
              label="مستحق المورد"
              value={<DueCell due={figures.supplier} side="supplier" alignEnd={false} />}
              hint={card.owned ? 'معدة مملوكة' : latestHint}
              icon={<Receipt size={18} />}
            />
            <StatCard
              label="الهامش"
              value={<DueCell due={figures.margin} side="margin" alignEnd={false} />}
              hint={card.owned ? 'مستحق العميل كاملا' : 'العميل − المورد'}
              icon={<Percent size={18} />}
            />
            <StatCard
              label="الساعات"
              value={latest?.hours ?? '—'}
              hint={
                latest
                  ? `${monthShortLabel(latest.month)} · من ${card.standard_hours} ساعة قياسية`
                  : `من ${card.standard_hours} ساعة قياسية`
              }
              icon={<Timer size={18} />}
            />
          </div>
        </div>

        {!open && (
          <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
            كرت منتهي: للقراءة فقط.
          </Notice>
        )}

        {/* The visibility rule (owner 2026-10-15): nothing is hidden. */}
        <Notice tone="info" size="compact" icon={<Eye size={16} />}>
          المبيعات ترى سعر الشراء والمشتريات ترى سعر البيع (قرار 2026-10-15): لا
          اخفاء بين الجانبين في هذه الصفحة.
        </Notice>

        {/* 3. The three sides of the card, side by side; stacked on a phone. */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-3 p-4">
            <SectionHeader
              title="الحركة"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  icon={<ArrowUpRight size={14} aria-hidden="true" className="rtl:-scale-x-100" />}
                >
                  انتقل للحركة
                </Button>
              }
              actionBesideText
            />
            <DescriptionList items={movementFacts} className="-my-2" />
          </Card>
          <Card className="space-y-3 p-4">
            <SectionHeader
              title="المبيعات"
              description={card.client_po_number ? undefined : 'لا سطر PO عميل بعد'}
            />
            {salesFacts.length > 0 ? (
              <DescriptionList items={salesFacts} className="-my-2" />
            ) : (
              <EmptyState title="بدون PO عميل" className="p-4" />
            )}
          </Card>
          <Card className="space-y-3 p-4">
            <SectionHeader title="المشتريات" />
            {card.owned ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Truck size={16} aria-hidden="true" />
                معدة مملوكة · بدون PO مورد
              </p>
            ) : purchasingFacts.length > 0 ? (
              <DescriptionList items={purchasingFacts} className="-my-2" />
            ) : (
              <EmptyState title="بدون PO مورد" className="p-4" />
            )}
          </Card>
        </div>

        {/* 4. The months («كروت التشغيل», phase 2): one row per month of the
            card's period, newest first — the recorded hours with their
            amounts, or the awaited month. */}
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-0">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  الشهور
                  <Badge size="sm">{monthRows.length}</Badge>
                  {pendingCount > 0 && (
                    <Badge tone="warning" size="sm">
                      {pendingCount} بانتظار
                    </Badge>
                  )}
                </span>
              }
              description="سطر لكل شهر: الساعات من كروت التشغيل (التايم شيت الشهري للعميل)، ومنها مستحق العميل ومستحق المورد."
              action={open ? recordButton('sm') : undefined}
            />
          </div>
          <div className="p-4 pt-3">
            {monthRows.length === 0 ? (
              <EmptyState title="لا شهور بعد" className="p-6" />
            ) : (
              <DataTable
                size="md"
                cellTextClassName="text-[13px]"
                cellClassName="py-2"
                columns={monthColumns}
                rows={[...monthRows].reverse()}
                rowKey={(row) => row.month}
                caption="الشهور"
              />
            )}
            <p className="mt-3 text-xs text-muted">
              الساعات دائما كما سجلت. المستحق = السعر الشهري × الساعات ÷ الساعات
              القياسية، وبالساعة = السعر × الساعات؛ السطر اليومي بلا قاعدة بعد.
              مرفق التايم شيت لاحقا. ارقام هذه الصفحة عينة.
            </p>
          </div>
        </Card>

        {/* 5. The event timeline. */}
        <Card className="space-y-3 p-4">
          <SectionHeader
            title="سجل الاحداث"
            description="انشاء الكرت مع الدخول، ربط سطري المورد والعميل، تسجيل الساعات وتعديلها وحذفها، الانهاء."
          />
          <EventTimeline events={events} />
        </Card>

        {/* 6. The mobile action bar. */}
        {open && (
          <div
            className="sticky bottom-0 z-10 -mx-3 -mb-3 flex gap-2 border-t bg-bg p-3 sm:hidden"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {recordButton('md')}
            {endButton('md')}
          </div>
        )}

        {dialog && (
          <MonthRecordDialog
            card={card}
            rows={monthRows}
            month={dialog.month}
            onClose={() => setDialog(null)}
            onSave={(month, hours, note) => store.saveMany([{ card, month, hours, note }])}
            onDelete={(month) => store.remove(card, month)}
          />
        )}
      </div>
    </Mockup>
  )
}

// --- 6. The equipment cards list -----------------------------------------------------

type CardRow = MockCard & {
  unit: MockEquipment | null
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
}

/** A card with its unit and its company and project names embedded. */
function cardRow(card: MockCard): CardRow {
  const company = companyById(card.company_id)
  const project = projectById(card.project_id)
  return {
    ...card,
    unit: equipmentById(card.equipment_id),
    company_name_ar: company?.name_ar ?? null,
    company_name_en: company?.name_en ?? null,
    project_name_ar: project?.name_ar ?? null,
    project_name_en: project?.name_en ?? null,
  }
}

const CARD_FILTER_FIELDS: { key: string; label: string; options: string[] }[] = [
  { key: 'company', label: 'الشركة', options: COMPANIES.map((item) => item.name_ar) },
  { key: 'project', label: 'المشروع', options: PROJECTS.map((item) => item.name_ar) },
  { key: 'status', label: 'الحالة', options: ['مفتوح', 'منتهي'] },
  { key: 'missing', label: 'بدون PO', options: ['بدون PO عميل', 'بدون PO مورد'] },
]

function CardsListMockup({ onOpen }: { onOpen: (card: MockCard) => void }) {
  const { t, lang } = useI18n()
  const [sort, setSort] = useState<DataTableSort>({
    key: 'open_first',
    direction: 'desc',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const rows = useMemo(() => {
    const all: CardRow[] = CARDS.map(cardRow)
    return sortRows(
      all,
      sort,
      (row, key) => {
        switch (key) {
          case 'equipment':
            return row.unit?.code ?? ''
          case 'period_from':
            return row.period_from
          case 'updated_at':
            return row.updated_at
          default:
            // Open cards first (owner: the default), then the newest period.
            return `${row.status === 'open' ? '1' : '0'}-${row.period_from}`
        }
      },
      lang,
    )
  }, [sort, lang])

  const columns: DataTableColumn<CardRow>[] = [
    {
      key: 'equipment',
      header: 'المعدة',
      sortable: true,
      cell: (row) => <UnitCell unit={row.unit} />,
    },
    {
      key: 'company_project',
      header: 'الشركة · المشروع',
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'period_from',
      header: 'الفترة',
      sortable: true,
      className: 'tabular-nums',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {formatDate(row.period_from)}
          {' → '}
          {row.period_to ? formatDate(row.period_to) : 'مفتوح'}
        </span>
      ),
    },
    {
      key: 'client_po',
      header: 'PO العميل',
      cell: (row) =>
        row.client_po_number ? (
          <PoPill number={row.client_po_number} />
        ) : (
          <Badge tone="warning" size="sm">
            بدون
          </Badge>
        ),
    },
    {
      key: 'supplier_po',
      header: 'PO المورد',
      hideBelow: 'sm',
      cell: (row) =>
        row.owned ? (
          <span className="text-xs text-muted">مملوكة</span>
        ) : row.supplier_po_number ? (
          <PoPill number={row.supplier_po_number} />
        ) : (
          <Badge tone="warning" size="sm">
            بدون
          </Badge>
        ),
    },
    {
      key: 'sale_price',
      header: 'سعر البيع',
      hideBelow: 'md',
      cell: (row) => <AmountOrDash value={row.sale_price} unit={row.rate_unit} />,
    },
    {
      key: 'purchase_price',
      header: 'سعر الشراء',
      hideBelow: 'md',
      cell: (row) =>
        row.owned ? (
          <span className="text-muted">—</span>
        ) : (
          <AmountOrDash value={row.purchase_price} unit={row.purchase_rate_unit} />
        ),
    },
    {
      key: 'status',
      header: t('status'),
      cell: (row) => <CardStatusBadge status={row.status} size="sm" />,
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      hideBelow: 'lg',
      className: 'text-muted',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  const sortOptions = [
    { value: 'open_first', label: 'المفتوحة اولا' },
    { value: 'equipment', label: 'المعدة' },
    { value: 'period_from', label: 'الفترة' },
    { value: 'updated_at', label: t('updatedAt') },
  ]

  return (
    <Mockup
      title="6. قائمة كروت المعدات — /cards"
      permission="sales.view او purchasing.view يعرض القائمة · الفلاتر والبحث هنا شكل فقط"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">كروت المعدات</h2>
          <p className="text-sm text-muted">
            كل معدة في شركة ومشروع خلال فترة، مع سطر PO العميل وسطر PO المورد.
          </p>
        </div>
        <ToolbarLookalike sortOptions={sortOptions} sort={sort} onSort={setSort} />
        {/* The filter fields (the FilterBar look): inert in the mockup. */}
        <div className="flex flex-wrap items-center gap-2">
          {CARD_FILTER_FIELDS.map((field) => (
            <Select
              key={field.key}
              size="sm"
              aria-label={field.label}
              placeholder={field.label}
              className="w-[150px]"
              options={field.options.map((option) => ({ value: option, label: option }))}
            />
          ))}
        </div>
        <DataTable
          size="md"
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          caption="كروت المعدات"
          sort={sort}
          onSortChange={(key, direction) => setSort({ key, direction })}
          onRowClick={(row) => onOpen(row)}
        />
        <DataListPagination
          page={page}
          pageSize={pageSize}
          total={rows.length}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      </div>
    </Mockup>
  )
}

// --- 7. «كروت التشغيل»: the batch entry of one project's month ---------------------

const THIS_MONTH = SAMPLE_TODAY.slice(0, 7)

/** The three month presets of the list filters (owner 2026-10-31), oldest
 *  first, as `YYYY-MM` keys of the mockups' today. */
const PRESET_MONTHS = MONTH_PRESETS.map((preset) =>
  shiftMonth(THIS_MONTH, -MONTH_PRESET_BACK[preset]),
)

/** The months before the presets, offered in a select. */
const OLDER_MONTHS = [3, 4, 5].map((back) => shiftMonth(THIS_MONTH, -back))

/** The month filter: the three presets («Sep (9) · Oct (10) · Nov (11)») as
 *  primary tabs, then «شهر اقدم» with a select of older months. */
function MonthPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (month: string) => void
}) {
  const tab = PRESET_MONTHS.includes(value) ? value : 'older'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={tab}
        onValueChange={(next) => onChange(next === 'older' ? OLDER_MONTHS[0] : next)}
      >
        <TabsList variant="segmented" aria-label="الشهر">
          {PRESET_MONTHS.map((month, index) => (
            <TabsTrigger key={month} value={month} className={PRIMARY_ACTIVE_TRIGGER}>
              <bdi dir="ltr">
                {monthPresetLabel(MONTH_PRESET_BACK[MONTH_PRESETS[index]], SAMPLE_TODAY)}
              </bdi>
            </TabsTrigger>
          ))}
          <TabsTrigger value="older" className={PRIMARY_ACTIVE_TRIGGER}>
            شهر اقدم
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'older' && (
        <Select
          aria-label="شهر اقدم"
          className="w-[160px]"
          value={value}
          onValueChange={onChange}
          options={OLDER_MONTHS.map((month) => ({ value: month, label: monthLabel(month) }))}
        />
      )}
    </div>
  )
}

/** The projects a company has cards in. */
function projectsOfCompany(companyId: string) {
  const ids = new Set(
    CARDS.filter((card) => card.company_id === companyId).map((card) => card.project_id),
  )
  return PROJECTS.filter((project) => ids.has(project.id))
}

/** A total per price unit in the bottom bar: the unit's name before the
 *  amount only when the rows mix units (a month and an hour are never added). */
function DueTotal({
  label,
  parts,
  className,
}: {
  label: string
  parts: readonly { unit: SaleRateUnit; total: number }[]
  className?: string
}) {
  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <span className="text-[11px] leading-4 text-muted">{label}</span>
      <span className="flex flex-col text-sm font-semibold">
        {parts.map((part) => (
          <span key={part.unit} className="inline-flex items-baseline gap-1.5">
            {parts.length > 1 && (
              <span className="text-[11px] font-normal text-muted">
                {SALE_RATE_UNIT_LABEL[part.unit]}
              </span>
            )}
            <SalePrice value={part.total} />
          </span>
        ))}
      </span>
    </div>
  )
}

interface BatchRow {
  card: MockCard
  unit: MockEquipment | null
  month: CardMonthRow
}

interface Draft {
  hours: string
  note: string
}

const draftKey = (cardId: string, month: string) => `${cardId}:${month}`

function BatchEntryMockup({
  store,
  onOpenCard,
}: {
  store: MonthsStore
  onOpenCard: (card: MockCard) => void
}) {
  const { lang } = useI18n()
  const [companyId, setCompanyId] = useState('c2')
  const [projectId, setProjectId] = useState('p1')
  const [month, setMonth] = useState(PRESET_MONTHS[1])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saved, setSaved] = useState<number | null>(null)

  const projects = companyId ? projectsOfCompany(companyId) : []
  const selected = companyId !== '' && projectId !== ''
  const rows: BatchRow[] = selected
    ? CARDS.filter(
        (card) =>
          card.company_id === companyId &&
          card.project_id === projectId &&
          cardCoversMonth(card, month),
      )
        .map((card) => ({
          card,
          unit: equipmentById(card.equipment_id),
          month:
            cardMonthRows(card, store.recordsOf(card)).find((row) => row.month === month) ?? {
              month,
              state: 'pending' as const,
              record: null,
            },
        }))
        .sort((a, b) => (a.unit?.code ?? '').localeCompare(b.unit?.code ?? '', 'en'))
    : []

  const draftOf = (row: BatchRow): Draft =>
    drafts[draftKey(row.card.id, month)] ?? {
      hours: row.month.record ? String(row.month.record.hours) : '',
      note: row.month.record?.note ?? '',
    }
  const setDraft = (row: BatchRow, patch: Partial<Draft>) => {
    setSaved(null)
    setDrafts((prev) => ({
      ...prev,
      [draftKey(row.card.id, month)]: { ...draftOf(row), ...patch },
    }))
  }

  /** The rows with hours, and among them the ones the save would write:
   *  a new record, or a changed one; rows left empty are never saved. */
  const filled = rows
    .map((row) => ({ row, draft: draftOf(row), hours: parseHours(draftOf(row).hours) }))
    .filter((item): item is typeof item & { hours: number } => item.hours !== null)
  const changed = filled.filter(({ row, draft, hours }) => {
    const record = row.month.record
    return !record || record.hours !== hours || (record.note ?? '') !== draft.note.trim()
  })
  const figuresOf = filled.map(({ row, hours }) => ({
    row,
    figures: cardMonthFigures(row.card, hours),
  }))
  const totals = (
    side: DueSide,
    unitOf: (card: MockCard) => SaleRateUnit,
  ) =>
    clientPoTotalsByUnit(
      figuresOf
        .filter(({ figures }) => figures[side].value !== null)
        .map(({ row, figures }) => ({
          price: figures[side].value ?? 0,
          rate_unit: unitOf(row.card),
        })),
    )

  const save = () => {
    store.saveMany(
      changed.map(({ row, draft, hours }) => ({
        card: row.card,
        month,
        hours,
        note: draft.note.trim() || null,
      })),
    )
    setDrafts((prev) => {
      const next = { ...prev }
      for (const { row } of changed) delete next[draftKey(row.card.id, month)]
      return next
    })
    setSaved(changed.length)
  }
  const clear = () => {
    setSaved(null)
    setDrafts((prev) => {
      const next = { ...prev }
      for (const row of rows) next[draftKey(row.card.id, month)] = { hours: '', note: '' }
      return next
    })
  }

  const columns: DataTableColumn<BatchRow>[] = [
    {
      key: 'equipment',
      header: 'المعدة',
      cell: (row) => (
        <button
          type="button"
          className="text-start underline-offset-2 hover:underline"
          onClick={() => onOpenCard(row.card)}
        >
          <UnitCell unit={row.unit} />
        </button>
      ),
    },
    {
      key: 'client_po',
      header: 'PO العميل',
      hideBelow: 'md',
      cell: (row) =>
        row.card.client_po_number ? (
          <PoPill number={row.card.client_po_number} />
        ) : (
          <span className="text-xs text-muted">بدون PO عميل</span>
        ),
    },
    {
      key: 'supplier_po',
      header: 'PO المورد',
      hideBelow: 'md',
      cell: (row) =>
        row.card.owned ? (
          <span className="text-xs text-muted">مملوكة</span>
        ) : row.card.supplier_po_number ? (
          <PoPill number={row.card.supplier_po_number} />
        ) : (
          <span className="text-xs text-muted">بدون PO مورد</span>
        ),
    },
    {
      key: 'hours',
      header: 'الساعات',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            aria-label={`ساعات ${row.unit?.code ?? ''} في ${monthLabel(month)}`}
            value={draftOf(row).hours}
            onChange={(event) => setDraft(row, { hours: event.target.value })}
            placeholder={row.month.record ? String(row.month.record.hours) : '0'}
            className="w-24 tabular-nums"
          />
          {row.month.record && <MonthStateBadge state="recorded" />}
        </span>
      ),
    },
    {
      key: 'client',
      header: 'مستحق العميل',
      align: 'end',
      cell: (row) => (
        <DueCell
          due={cardMonthFigures(row.card, parseHours(draftOf(row).hours)).client}
          side="client"
        />
      ),
    },
    {
      key: 'supplier',
      header: 'مستحق المورد',
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <DueCell
          due={cardMonthFigures(row.card, parseHours(draftOf(row).hours)).supplier}
          side="supplier"
        />
      ),
    },
    {
      key: 'margin',
      header: 'الهامش',
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <DueCell
          due={cardMonthFigures(row.card, parseHours(draftOf(row).hours)).margin}
          side="margin"
        />
      ),
    },
    {
      key: 'note',
      header: 'ملاحظة',
      hideBelow: 'lg',
      cell: (row) => (
        <Input
          aria-label={`ملاحظة ${row.unit?.code ?? ''}`}
          value={draftOf(row).note}
          onChange={(event) => setDraft(row, { note: event.target.value })}
          placeholder="اختياري"
          maxLength={120}
          className="w-44"
        />
      ),
    },
  ]

  const companyName = (id: string) => {
    const company = companyById(id)
    return company ? localizedName(lang, company.name_ar, company.name_en) : id
  }
  const projectName = (id: string) => {
    const project = projectById(id)
    return project ? localizedName(lang, project.name_ar, project.name_en) : id
  }

  return (
    <Mockup
      title="7. كروت التشغيل — ادخال ساعات شهر لمشروع كامل — /sales/timesheets"
      permission="sales.manage يفتح الشاشة ويحفظ · تايم شيت العميل الشهري = شركة + مشروع + شهر = جدول واحد وحفظ واحد"
      controls={
        selected ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCompanyId('')
              setProjectId('')
            }}
          >
            مسح الاختيار (الحالة الفارغة)
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">كروت التشغيل</h2>
          <p className="text-sm text-muted">
            ساعات كل معدة في الشهر من التايم شيت الشهري للعميل؛ مستحق العميل
            ومستحق المورد يحسبان مباشرة.
          </p>
        </div>

        {/* The three selections: company → its projects → the month. */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <Field label="الشركة" required>
            {(control) => (
              <Select
                {...control}
                value={companyId}
                onValueChange={(next) => {
                  setCompanyId(next)
                  setProjectId('')
                  setSaved(null)
                }}
                placeholder="اختر الشركة"
                options={COMPANIES.map((company) => ({
                  value: company.id,
                  label: localizedName(lang, company.name_ar, company.name_en),
                }))}
              />
            )}
          </Field>
          <Field
            label="المشروع"
            required
            hint={companyId && projects.length === 0 ? 'لا مشاريع لهذه الشركة بكروت.' : undefined}
          >
            {(control) => (
              <Select
                {...control}
                value={projectId}
                onValueChange={(next) => {
                  setProjectId(next)
                  setSaved(null)
                }}
                disabled={!companyId || projects.length === 0}
                placeholder="اختر المشروع"
                options={projects.map((project) => ({
                  value: project.id,
                  label: localizedName(lang, project.name_ar, project.name_en),
                }))}
              />
            )}
          </Field>
          <Field label="الشهر" required>
            {() => (
              <MonthPicker
                value={month}
                onChange={(next) => {
                  setMonth(next)
                  setSaved(null)
                }}
              />
            )}
          </Field>
        </div>

        {!selected ? (
          <EmptyState
            icon={<CalendarDays size={24} aria-hidden="true" />}
            title="اختر الشركة والمشروع والشهر"
            description="يظهر جدول كل الكروت المفتوحة في ذلك المشروع خلال الشهر."
            className="p-8"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Truck size={24} aria-hidden="true" />}
            title={`لا كروت في ${projectName(projectId)} خلال ${monthLabel(month)}`}
            description={`${companyName(companyId)}: لا معدة كانت داخل هذا المشروع في هذا الشهر.`}
            className="p-8"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-semibold">{companyName(companyId)}</span>
                <span className="text-muted"> · {projectName(projectId)} · </span>
                <span className="font-semibold">{monthLabel(month)}</span>
              </p>
              <p className="text-xs text-muted">
                {rows.length} كرت · {rows.filter((row) => row.month.record).length} مسجل ·{' '}
                {rows.filter((row) => !row.month.record).length} بانتظار
              </p>
            </div>
            {saved !== null && saved > 0 && (
              <Notice tone="success" size="compact">
                تم حفظ {monthsCountLabel(saved)} لشهر {monthLabel(month)}.
              </Notice>
            )}
            <DataTable
              size="md"
              cellTextClassName="text-[13px]"
              cellClassName="py-2"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.card.id}
              caption={`ساعات ${monthLabel(month)}`}
            />
            <p className="text-xs text-muted">
              الصفوف الفارغة لا تحفظ. المستحق = السعر الشهري × الساعات ÷ الساعات
              القياسية (260)، وبالساعة = السعر × الساعات؛ السطر اليومي بلا قاعدة
              بعد؛ معدة العزاني بلا مستحق مورد وهامشها مستحق العميل كاملا.
            </p>
          </>
        )}

        {/* The sticky bottom bar: the save with its count, the totals of the
            filled rows per price unit, and «تفريغ». */}
        {selected && rows.length > 0 && (
          <div
            className="sticky bottom-0 z-10 -mx-3 -mb-3 flex flex-wrap items-center gap-3 border-t bg-bg px-3 pt-3 sm:-mx-4 sm:-mb-4 sm:px-4"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <Button
              variant="primary"
              className="h-11"
              icon={<Save size={16} aria-hidden="true" />}
              disabled={changed.length === 0}
              onClick={save}
            >
              {changed.length === 0 ? 'حفظ' : `حفظ ${monthsCountLabel(changed.length)}`}
            </Button>
            <Button variant="ghost" className="h-11" onClick={clear}>
              تفريغ
            </Button>
            <div className="ms-auto flex flex-wrap items-end gap-x-5 gap-y-2">
              <DueTotal
                label="مستحق العميل"
                parts={totals('client', (card) => card.rate_unit)}
              />
              <DueTotal
                label="مستحق المورد"
                parts={totals('supplier', (card) => card.purchase_rate_unit)}
                className="hidden sm:flex"
              />
              <DueTotal
                label="الهامش"
                parts={totals('margin', (card) => card.rate_unit)}
                className="hidden sm:flex"
              />
            </div>
          </div>
        )}
      </div>
    </Mockup>
  )
}

// --- 8. «الشهور»: the months of every card as a list ---------------------------------

const ALL = 'all'

/** The months the list filter offers: this month and the five before it. */
const LIST_MONTHS = [0, 1, 2, 3, 4, 5].map((back) => shiftMonth(THIS_MONTH, -back))

const MONTH_STATE_RANK: Readonly<Record<CardMonthState, string>> = {
  pending: '0',
  running: '1',
  recorded: '2',
}

type MonthListRow = CardRow & {
  row_id: string
  monthRow: CardMonthRow
  figures: ReturnType<typeof cardMonthFigures>
}

function MonthsListMockup({
  store,
  onOpen,
}: {
  store: MonthsStore
  onOpen: (card: MockCard) => void
}) {
  const { t, lang } = useI18n()
  const [month, setMonth] = useState(PRESET_MONTHS[1])
  const [companyId, setCompanyId] = useState(ALL)
  const [projectId, setProjectId] = useState(ALL)
  const [state, setState] = useState(ALL)
  const [sort, setSort] = useState<DataTableSort>({ key: 'state', direction: 'asc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const rows = sortRows(
    CARDS.filter(
      (card) =>
        cardCoversMonth(card, month) &&
        (companyId === ALL || card.company_id === companyId) &&
        (projectId === ALL || card.project_id === projectId),
    )
      .map((card): MonthListRow => {
        const monthRow =
          cardMonthRows(card, store.recordsOf(card)).find((row) => row.month === month) ?? {
            month,
            state: 'pending' as const,
            record: null,
          }
        return {
          ...cardRow(card),
          row_id: `${card.id}:${month}`,
          monthRow,
          figures: cardMonthFigures(card, monthRow.record?.hours ?? null),
        }
      })
      .filter((row) => state === ALL || row.monthRow.state === state),
    sort,
    (row, key) => {
      switch (key) {
        case 'equipment':
          return row.unit?.code ?? ''
        case 'hours':
          return row.monthRow.record?.hours ?? -1
        case 'client':
          return row.figures.client.value ?? -1
        case 'margin':
          return row.figures.margin.value ?? -1
        default:
          // «بانتظار» first (the default), then the running month, then the
          // recorded ones; the unit code inside each group.
          return `${MONTH_STATE_RANK[row.monthRow.state]}-${row.unit?.code ?? ''}`
      }
    },
    lang,
  )

  const columns: DataTableColumn<MonthListRow>[] = [
    {
      key: 'month',
      header: 'الشهر',
      className: 'whitespace-nowrap font-medium',
      cell: (row) => monthLabel(row.monthRow.month),
    },
    {
      key: 'equipment',
      header: 'المعدة',
      sortable: true,
      cell: (row) => <UnitCell unit={row.unit} />,
    },
    {
      key: 'company_project',
      header: 'الشركة · المشروع',
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'hours',
      header: 'الساعات',
      sortable: true,
      align: 'center',
      className: 'tabular-nums',
      cell: (row) =>
        row.monthRow.record ? row.monthRow.record.hours : <span className="text-muted">—</span>,
    },
    {
      key: 'client',
      header: 'مستحق العميل',
      sortable: true,
      align: 'end',
      cell: (row) => <DueCell due={row.figures.client} side="client" />,
    },
    {
      key: 'supplier',
      header: 'مستحق المورد',
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => <DueCell due={row.figures.supplier} side="supplier" />,
    },
    {
      key: 'margin',
      header: 'الهامش',
      sortable: true,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => <DueCell due={row.figures.margin} side="margin" />,
    },
    {
      key: 'state',
      header: t('status'),
      sortable: true,
      cell: (row) => <MonthStateBadge state={row.monthRow.state} />,
    },
  ]

  const sortOptions = [
    { value: 'state', label: 'بانتظار اولا' },
    { value: 'equipment', label: 'المعدة' },
    { value: 'hours', label: 'الساعات' },
    { value: 'client', label: 'مستحق العميل' },
    { value: 'margin', label: 'الهامش' },
  ]
  const projects = companyId === ALL ? PROJECTS : projectsOfCompany(companyId)

  return (
    <Mockup
      title="8. الشهور — كل شهر لكل كرت — /sales/months"
      permission="sales.view يعرض القائمة · الصف يفتح صفحة الكرت · الفلتر الافتراضي: الشهر الماضي، «بانتظار» اولا"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">الشهور</h2>
          <p className="text-sm text-muted">
            شهر لكل كرت: الساعات المسجلة ومستحقاتها، او ما زال بانتظار كرت
            التشغيل.
          </p>
        </div>
        <ToolbarLookalike
          sortOptions={sortOptions}
          sort={sort}
          onSort={setSort}
          placeholder="بحث برقم المعدة او اللوحة"
        />
        {/* The filter fields (the FilterBar look); these four work on the
            sample rows. */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="الشهر"
            className="w-[150px]"
            value={month}
            onValueChange={(next) => {
              setMonth(next)
              setPage(1)
            }}
            options={LIST_MONTHS.map((key) => ({ value: key, label: monthLabel(key) }))}
          />
          <Select
            size="sm"
            aria-label="الشركة"
            className="w-[190px]"
            value={companyId}
            onValueChange={(next) => {
              setCompanyId(next)
              setProjectId(ALL)
              setPage(1)
            }}
            options={[
              { value: ALL, label: 'كل الشركات' },
              ...COMPANIES.map((company) => ({
                value: company.id,
                label: localizedName(lang, company.name_ar, company.name_en),
              })),
            ]}
          />
          <Select
            size="sm"
            aria-label="المشروع"
            className="w-[190px]"
            value={projectId}
            onValueChange={(next) => {
              setProjectId(next)
              setPage(1)
            }}
            options={[
              { value: ALL, label: 'كل المشاريع' },
              ...projects.map((project) => ({
                value: project.id,
                label: localizedName(lang, project.name_ar, project.name_en),
              })),
            ]}
          />
          <Select
            size="sm"
            aria-label={t('status')}
            className="w-[150px]"
            value={state}
            onValueChange={(next) => {
              setState(next)
              setPage(1)
            }}
            options={[
              { value: ALL, label: 'كل الحالات' },
              { value: 'recorded', label: CARD_MONTH_STATE_LABEL.recorded },
              { value: 'pending', label: CARD_MONTH_STATE_LABEL.pending },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={`لا شهور تطابق الفلاتر في ${monthLabel(month)}`}
            className="p-8"
          />
        ) : (
          <DataTable
            size="md"
            cellTextClassName="text-[13px]"
            cellClassName="py-2"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.row_id}
            caption="الشهور"
            sort={sort}
            onSortChange={(key, direction) => setSort({ key, direction })}
            onRowClick={(row) => onOpen(row)}
          />
        )}
        <DataListPagination
          page={page}
          pageSize={pageSize}
          total={rows.length}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      </div>
    </Mockup>
  )
}

// --- The decisions and the section ------------------------------------------------

function DecisionsBlock({
  title = 'القرارات — المرحلة الاولى من المبيعات (2026-11-01)',
  description = 'النموذج والشاشات يراجعان معا؛ ما يتغير هنا يتغير في الشاشات.',
  items = SALES_DECISIONS,
}: {
  title?: string
  description?: string
  items?: readonly { title: string; detail: string }[]
}) {
  return (
    <Card className="space-y-3 p-4">
      <SectionHeader title={title} description={description} />
      <ol className="grid gap-2 sm:grid-cols-2">
        {items.map((decision, index) => (
          <li key={decision.title} className="flex gap-3 rounded-lg border bg-bg p-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-semibold">{decision.title}</span>
              <span className="block text-xs leading-5 text-muted">{decision.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

type SalesTab =
  | 'list'
  | 'page'
  | 'card'
  | 'ticket'
  | 'cardPage'
  | 'cards'
  | 'batch'
  | 'months'

const SALES_TABS: { id: SalesTab; label: string }[] = [
  { id: 'list', label: 'قائمة PO العملاء' },
  { id: 'page', label: 'صفحة PO العميل' },
  { id: 'card', label: 'كرت المبيعات في صفحة المعدة' },
  { id: 'ticket', label: 'تذكرة المعدة' },
  { id: 'cardPage', label: 'صفحة كرت المعدة' },
  { id: 'cards', label: 'قائمة كروت المعدات' },
  { id: 'batch', label: 'كروت التشغيل' },
  { id: 'months', label: 'الشهور' },
]

/** The phase-2 tabs (owner 2026-11-03), shown with the phase-2 decisions. */
const PHASE2_TABS: readonly SalesTab[] = ['batch', 'months']

export function SalesMockup() {
  const [tab, setTab] = useState<SalesTab>('list')
  const [selectedId, setSelectedId] = useState(CLIENT_POS[0].id)
  const [cardId, setCardId] = useState<string>(CARD_PAGE_SAMPLES.rented)
  // The recorded months and the events the phase-2 screens add, shared so a
  // save in the batch screen shows on the card page and in the months list.
  const store = useMonthsStore()

  const openPo = (id: string) => {
    setSelectedId(id)
    setTab('page')
  }
  const openCard = (card: MockCard) => {
    setCardId(card.id)
    setTab('cardPage')
  }

  return (
    <div className="space-y-6">
      <Notice tone="info" size="compact">
        نماذج للمراجعة ببيانات عينة في الذاكرة: لا جداول ولا قراءة ولا كتابة
        على القاعدة ولا مسارات بعد. قسم «المبيعات» في الشريط الجانبي يحمل «PO
        العملاء»، والشاشات بنفس مكونات المشتريات المعتمدة. المرحلة الثانية
        («كروت التشغيل» و«الشهور» وتعديلات صفحة الكرت) تحفظ في الذاكرة فقط
        حتى يراجعها المالك.
      </Notice>
      {PHASE2_TABS.includes(tab) ? (
        <DecisionsBlock
          title="القرارات — المرحلة الثانية: كروت التشغيل (2026-11-03)"
          description="ساعات كل كرت لكل شهر سعودي من التايم شيت الشهري للعميل؛ القواعد هنا هي ما تحسبه الشاشات."
          items={SALES_PHASE2_DECISIONS}
        />
      ) : (
        <DecisionsBlock />
      )}
      <Tabs value={tab} onValueChange={(next) => setTab(next as SalesTab)}>
        <TabsList variant="segmented" aria-label="شاشات المبيعات" className="flex-wrap">
          {SALES_TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'list' && <ClientPoListMockup onOpen={openPo} />}
      {tab === 'page' && (
        <ClientPoPageMockup selectedId={selectedId} onSelect={setSelectedId} />
      )}
      {tab === 'card' && <EquipmentSalesCardMockup onOpen={openPo} />}
      {tab === 'ticket' && <TicketsMockup />}
      {tab === 'cardPage' && (
        <CardPageMockup cardId={cardId} onSelectCard={setCardId} store={store} />
      )}
      {tab === 'cards' && <CardsListMockup onOpen={openCard} />}
      {tab === 'batch' && <BatchEntryMockup store={store} onOpenCard={openCard} />}
      {tab === 'months' && <MonthsListMockup store={store} onOpen={openCard} />}
    </div>
  )
}
