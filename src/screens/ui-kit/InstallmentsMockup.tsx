import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Ban,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  FileText,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Truck,
  UserRound,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  DatePicker,
  DescriptionList,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  MultiSelect,
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
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  allocatePayment,
  buildSchedule,
  checkInstallmentTerms,
  financedAmount,
  formatInstallmentAmount,
  installmentErrorMessage,
  installmentState,
  INSTALLMENT_CONTRACT_STATUS_BADGE,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  INSTALLMENT_STATE_BADGE,
  type InstallmentPaymentMethod,
  type InstallmentState,
  type InstallmentTerms,
} from '@/lib/installments'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  cancelContract,
  deleteFinancier,
  hasPostedPayment,
  isRowPaid,
  MOCK_UNITS,
  nextRowOf,
  openDues,
  overviewOf,
  paidOf,
  recordPayment,
  remainingOf,
  saveContract,
  saveFinancier,
  seedStore,
  voidPayment,
  type DueItem,
  type MockContract,
  type MockPayment,
  type MockResult,
  type MockRow,
  type MockStore,
} from './installmentsMockupData'

/**
 * /ui-kit mockup of «الاقساط» (owner 2026-11-18: «ارسمها في فيقما اول», then
 * «سويها في ui-kit»). The two pages — the home with «الاقساط القادمة» and
 * «العقود», and the contract page — with their dialogs, on sample data whose
 * dates follow today's Saudi day. Every action runs the rule of migration
 * 0203 through `installmentsMockupData.ts`; nothing reads or writes the
 * database. No real screen exists until he approves.
 */

// --- Small pieces ----------------------------------------------------------------

function Money({
  value,
  className,
}: {
  value: number | null | undefined
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 whitespace-nowrap ${className ?? ''}`}
    >
      <bdi dir="ltr" className="tabular-nums">
        {formatInstallmentAmount(value)}
      </bdi>
      <RiyalSign className="text-muted" size="0.8em" />
      <span className="sr-only">ريال</span>
    </span>
  )
}

/** «يوم», «يومين», «3 ايام», «11 يوم». */
function daysWords(count: number): string {
  if (count === 1) return 'يوم'
  if (count === 2) return 'يومين'
  if (count <= 10) return `${count} ايام`
  return `${count} يوم`
}

/** «قسط واحد», «قسطين», «5 اقساط», «27 قسط». */
function installmentsWords(count: number): string {
  if (count === 0) return 'لا يوجد'
  if (count === 1) return 'قسط واحد'
  if (count === 2) return 'قسطين'
  if (count <= 10) return `${count} اقساط`
  return `${count} قسط`
}

function contractsWords(count: number): string {
  if (count === 0) return 'بدون عقود'
  if (count === 1) return 'عقد واحد'
  if (count === 2) return 'عقدين'
  if (count <= 10) return `${count} عقود`
  return `${count} عقد`
}

function whenWords(days: number): string {
  if (days === 0) return 'اليوم'
  return days < 0 ? `متاخر ${daysWords(-days)}` : `باقي ${daysWords(days)}`
}

function DateText({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={`tabular-nums ${className ?? ''}`}>
      {formatDate(value)}
    </bdi>
  )
}

function StateBadge({ state }: { state: InstallmentState }) {
  const { t } = useI18n()
  const badge = INSTALLMENT_STATE_BADGE[state]
  return (
    <Badge tone={badge.tone} size="sm">
      {t(badge.key)}
    </Badge>
  )
}

const parseAmount = (text: string): number =>
  text.trim() === '' ? 0 : Number(text.replace(/,/g, '').trim())

const LIST_TEXT = 'text-[13px]'
const LIST_CELL = 'py-2'

// --- The mockup ------------------------------------------------------------------

type View = { page: 'home' } | { page: 'contract'; id: string }

type Open =
  | { kind: 'contract'; id: string | null }
  | { kind: 'payment'; contractId: string }
  | { kind: 'void'; paymentId: string }
  | { kind: 'cancel'; contractId: string }
  | { kind: 'financiers' }
  | null

export function InstallmentsMockup() {
  const today = useMemo(() => saudiDateKey(), [])
  const [store, setStore] = useState<MockStore>(() => seedStore(today))
  const [view, setView] = useState<View>({ page: 'home' })
  const [open, setOpen] = useState<Open>(null)
  const [flash, setFlash] = useState<string | null>(null)

  /** Applies a store action; returns its refusal token, or null. */
  const apply = (result: MockResult, done: string): string | null => {
    if (!result.ok) return result.token
    setStore(result.store)
    setFlash(done)
    return null
  }
  const contractOf = (id: string) =>
    store.contracts.find((contract) => contract.id === id) ?? null
  const shown = view.page === 'contract' ? contractOf(view.id) : null

  return (
    <div className="space-y-4">
      <Notice tone="info" size="compact">
        نموذج للمراجعة ببيانات تجريبية: جرب تسجيل سداد، الغاء سداد، وعقد جديد.
        لا شي ينحفظ، وتحديث الصفحة يرجع البيانات كما كانت. في البرنامج تنفتح
        الصفحة بالرابط فقط وما تظهر في القائمة الجانبية.
      </Notice>
      {flash && (
        <Notice tone="success" size="compact" onDismiss={() => setFlash(null)}>
          {flash}
        </Notice>
      )}
      <div className="rounded-xl border border-border bg-bg p-4 sm:p-6">
        {shown ? (
          <ContractPage
            store={store}
            contract={shown}
            today={today}
            onBack={() => setView({ page: 'home' })}
            onPay={() => setOpen({ kind: 'payment', contractId: shown.id })}
            onEdit={() => setOpen({ kind: 'contract', id: shown.id })}
            onCancel={() => setOpen({ kind: 'cancel', contractId: shown.id })}
            onVoid={(paymentId) => setOpen({ kind: 'void', paymentId })}
          />
        ) : (
          <HomePage
            store={store}
            today={today}
            onOpenContract={(id) => setView({ page: 'contract', id })}
            onPay={(contractId) => setOpen({ kind: 'payment', contractId })}
            onNew={() => setOpen({ kind: 'contract', id: null })}
            onFinanciers={() => setOpen({ kind: 'financiers' })}
          />
        )}
      </div>

      {open?.kind === 'contract' && (
        <ContractDialog
          store={store}
          contract={open.id ? contractOf(open.id) : null}
          onClose={() => setOpen(null)}
          onSave={(draft) => {
            const result = saveContract(store, open.id, draft, today)
            const token = apply(
              result,
              open.id ? 'تم حفظ العقد.' : 'تم انشاء العقد وتولدت اقساطه.',
            )
            if (!token && result.ok) {
              setView({ page: 'contract', id: result.id })
              setOpen(null)
            }
            return token
          }}
        />
      )}
      {open?.kind === 'payment' && contractOf(open.contractId) && (
        <PaymentDialog
          contract={contractOf(open.contractId) as MockContract}
          today={today}
          onClose={() => setOpen(null)}
          onSave={(draft) => {
            const token = apply(
              recordPayment(store, open.contractId, draft, today),
              'تم تسجيل السداد.',
            )
            if (!token) setOpen(null)
            return token
          }}
        />
      )}
      {open?.kind === 'void' && (
        <ReasonDialog
          title="الغاء السداد"
          description={(() => {
            const payment = store.payments.find(
              (item) => item.id === open.paymentId,
            )
            return payment ? (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <Money value={payment.amount} />
                <span>بتاريخ</span>
                <DateText value={payment.paidOn} />
              </span>
            ) : null
          })()}
          warning="يرجع المبلغ على الاقساط كغير مسدد، ويبقى السداد في السجل بحالة «ملغي»."
          label="سبب الالغاء"
          confirm="الغاء السداد"
          onClose={() => setOpen(null)}
          onConfirm={(reason) => {
            const token = apply(
              voidPayment(store, open.paymentId, reason),
              'تم الغاء السداد.',
            )
            if (!token) setOpen(null)
            return token
          }}
        />
      )}
      {open?.kind === 'cancel' && (
        <ReasonDialog
          title="الغاء العقد"
          description={contractOf(open.contractId)?.description}
          warning="العقد الملغي يبقى في القائمة بحالة «ملغي» وما يتعدل بعدها. يتاح الالغاء فقط اذا ما عليه سداد مسجل."
          label="سبب الالغاء"
          confirm="الغاء العقد"
          onClose={() => setOpen(null)}
          onConfirm={(reason) => {
            const token = apply(
              cancelContract(store, open.contractId, reason),
              'تم الغاء العقد.',
            )
            if (!token) setOpen(null)
            return token
          }}
        />
      )}
      {open?.kind === 'financiers' && (
        <FinanciersDialog
          store={store}
          onClose={() => setOpen(null)}
          onSave={(id, name) =>
            apply(
              saveFinancier(store, id, name),
              id ? 'تم تعديل اسم الجهة.' : 'تمت اضافة الجهة.',
            )
          }
          onDelete={(id) => apply(deleteFinancier(store, id), 'تم حذف الجهة.')}
        />
      )}
    </div>
  )
}

// --- The home page ---------------------------------------------------------------

const DUES_PAGE = 10

function HomePage({
  store,
  today,
  onOpenContract,
  onPay,
  onNew,
  onFinanciers,
}: {
  store: MockStore
  today: string
  onOpenContract: (id: string) => void
  onPay: (contractId: string) => void
  onNew: () => void
  onFinanciers: () => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'dues' | 'contracts'>('dues')
  const [search, setSearch] = useState('')
  const [financier, setFinancier] = useState('all')
  const [limit, setLimit] = useState(DUES_PAGE)

  const dues = useMemo(() => openDues(store, today), [store, today])
  const overview = useMemo(() => overviewOf(dues), [dues])
  const names = useMemo(
    () => new Map(store.financiers.map((item) => [item.id, item.name])),
    [store.financiers],
  )
  const needle = search.trim().toLowerCase()
  const matches = (contract: MockContract) =>
    (financier === 'all' || contract.financierId === financier) &&
    (!needle ||
      contract.description.toLowerCase().includes(needle) ||
      contract.number.toLowerCase().includes(needle) ||
      (names.get(contract.financierId) ?? '').toLowerCase().includes(needle))

  const dueRows = dues.filter((item) => matches(item.contract))
  const contractRows = store.contracts
    .filter(matches)
    .sort((a, b) => b.touched - a.touched)

  const dueColumns: DataTableColumn<DueItem>[] = [
    {
      key: 'due',
      header: 'تاريخ الاستحقاق',
      width: '150px',
      cell: (item) => (
        <div>
          <DateText
            value={item.row.dueDate}
            className={`font-medium ${item.days < 0 ? 'text-danger' : ''}`}
          />
          <div
            className={`text-xs ${item.days < 0 ? 'text-danger' : item.days === 0 ? 'text-warning' : 'text-muted'}`}
          >
            {whenWords(item.days)}
          </div>
        </div>
      ),
    },
    {
      key: 'contract',
      header: 'العقد',
      cell: (item) => (
        <div className="min-w-0">
          <div className="font-bold">{item.contract.description}</div>
          <bdi dir="ltr" className="text-xs text-muted">
            {item.contract.number}
          </bdi>
        </div>
      ),
    },
    {
      key: 'financier',
      header: 'الجهة',
      hideBelow: 'md',
      cell: (item) => item.financierName,
    },
    {
      key: 'seq',
      header: 'القسط',
      hideBelow: 'lg',
      cell: (item) => (
        <span className="tabular-nums">
          {item.row.seq} من {item.contract.terms.installmentCount}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'المتبقي من القسط',
      cell: (item) => (
        <div>
          <Money value={item.remaining} className="font-medium" />
          {item.isPartial && (
            <div className="text-xs text-muted">
              مسدد <Money value={item.row.paidAmount} /> من{' '}
              <Money value={item.row.amount} />
            </div>
          )}
          {item.row.isBalloon && (
            <div className="text-xs text-muted">الدفعة الاخيرة</div>
          )}
        </div>
      ),
    },
    {
      key: 'state',
      header: 'الحالة',
      cell: (item) => <StateBadge state={item.state} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (item) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            onPay(item.contract.id)
          }}
        >
          تسديد
        </Button>
      ),
    },
  ]

  const contractColumns: DataTableColumn<MockContract>[] = [
    {
      key: 'contract',
      header: 'العقد',
      cell: (contract) => (
        <div className="min-w-0">
          <div className="font-bold">{contract.description}</div>
          <bdi dir="ltr" className="text-xs text-muted">
            {contract.number}
          </bdi>
        </div>
      ),
    },
    {
      key: 'financier',
      header: 'الجهة',
      hideBelow: 'md',
      cell: (contract) => names.get(contract.financierId) ?? '—',
    },
    {
      key: 'financed',
      header: 'المبلغ المقسط',
      hideBelow: 'lg',
      cell: (contract) => <Money value={financedAmount(contract.terms)} />,
    },
    {
      key: 'paid',
      header: 'المسدد',
      hideBelow: 'md',
      cell: (contract) => (
        <div>
          <Money value={paidOf(contract)} />
          <div className="text-xs text-muted tabular-nums">
            {contract.rows.filter(isRowPaid).length} من {contract.rows.length}{' '}
            قسط
          </div>
        </div>
      ),
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      cell: (contract) => (
        <Money value={remainingOf(contract)} className="font-medium" />
      ),
    },
    {
      key: 'next',
      header: 'القسط القادم',
      cell: (contract) => {
        const next = contract.status === 'active' ? nextRowOf(contract) : null
        if (!next) return <span className="text-muted">—</span>
        return (
          <div>
            <DateText value={next.dueDate} className="font-medium" />
            <div className="text-xs text-muted">
              <Money value={next.amount - next.paidAmount} />
            </div>
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (contract) => {
        const badge = INSTALLMENT_CONTRACT_STATUS_BADGE[contract.status]
        const overdue =
          contract.status === 'active'
            ? contract.rows.filter(
                (row) => !isRowPaid(row) && row.dueDate < today,
              ).length
            : 0
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={badge.tone} size="sm">
              {t(badge.key)}
            </Badge>
            {overdue > 0 && (
              <Badge tone="danger" size="sm">
                متاخر {overdue}
              </Badge>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
        <div>
          <h2 className="font-serif text-[28px] font-bold leading-tight">
            الاقساط
          </h2>
          <p className="mt-1.5 text-[13px] text-muted">
            مواعيد الاقساط القادمة وعقودها
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            icon={<Building2 size={16} aria-hidden="true" />}
            onClick={onFinanciers}
          >
            الجهات
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={onNew}
          >
            عقد جديد
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="متاخر"
          tone={overview.overdueCount > 0 ? 'danger' : undefined}
          value={<Money value={overview.overdueAmount} />}
          hint={installmentsWords(overview.overdueCount)}
        />
        <StatCard
          label="مستحق خلال 7 ايام"
          value={<Money value={overview.due7Amount} />}
          hint={installmentsWords(overview.due7Count)}
        />
        <StatCard
          label="مستحق خلال 30 يوم"
          value={<Money value={overview.due30Amount} />}
          hint={installmentsWords(overview.due30Count)}
        />
        <StatCard
          label="اجمالي المتبقي"
          value={<Money value={overview.remainingTotal} />}
          hint={`${contractsWords(overview.activeContracts)} سارية`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as 'dues' | 'contracts')}
        >
          <TabsList variant="segmented" aria-label="عرض الاقساط">
            <TabsTrigger value="dues" className={PRIMARY_ACTIVE_TRIGGER}>
              الاقساط القادمة
            </TabsTrigger>
            <TabsTrigger value="contracts" className={PRIMARY_ACTIVE_TRIGGER}>
              العقود
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={(value) => {
              setSearch(value)
              setLimit(DUES_PAGE)
            }}
            placeholder="ابحث بعنوان العقد او رقمه او الجهة"
            aria-label="بحث"
            className="w-full sm:w-80"
          />
          <Select
            value={financier}
            onValueChange={(value) => {
              setFinancier(value)
              setLimit(DUES_PAGE)
            }}
            aria-label="الجهة"
            className="w-44"
            options={[
              { value: 'all', label: 'كل الجهات' },
              ...store.financiers.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
          />
        </div>
      </div>

      {tab === 'dues' ? (
        <div className="space-y-3">
          <DataTable
            caption="الاقساط القادمة"
            columns={dueColumns}
            rows={dueRows.slice(0, limit)}
            rowKey={(item) => item.key}
            onRowClick={(item) => onOpenContract(item.contract.id)}
            cellTextClassName={LIST_TEXT}
            cellClassName={LIST_CELL}
            empty="لا توجد اقساط غير مسددة."
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span className="tabular-nums">
              {Math.min(limit, dueRows.length)} من {dueRows.length} قسط غير مسدد
            </span>
            {dueRows.length > limit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit(limit + DUES_PAGE)}
              >
                عرض المزيد
              </Button>
            )}
          </div>
        </div>
      ) : (
        <DataTable
          caption="العقود"
          columns={contractColumns}
          rows={contractRows}
          rowKey={(contract) => contract.id}
          onRowClick={(contract) => onOpenContract(contract.id)}
          cellTextClassName={LIST_TEXT}
          cellClassName={LIST_CELL}
          empty="لا توجد عقود."
        />
      )}
    </div>
  )
}

// --- The contract page -----------------------------------------------------------

const SCHEDULE_PAGE = 8

function ContractPage({
  store,
  contract,
  today,
  onBack,
  onPay,
  onEdit,
  onCancel,
  onVoid,
}: {
  store: MockStore
  contract: MockContract
  today: string
  onBack: () => void
  onPay: () => void
  onEdit: () => void
  onCancel: () => void
  onVoid: (paymentId: string) => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'open' | 'paid' | 'all'>('open')
  const [all, setAll] = useState(false)
  const [allPayments, setAllPayments] = useState(false)

  const financier =
    store.financiers.find((item) => item.id === contract.financierId)?.name ??
    '—'
  const status = INSTALLMENT_CONTRACT_STATUS_BADGE[contract.status]
  const paidRows = contract.rows.filter(isRowPaid)
  const openRows = contract.rows.filter((row) => !isRowPaid(row))
  const next = contract.status === 'active' ? nextRowOf(contract) : null
  const rows =
    tab === 'open' ? openRows : tab === 'paid' ? paidRows : contract.rows
  const payments = store.payments
    .filter((payment) => payment.contractId === contract.id)
    .sort((a, b) =>
      a.paidOn === b.paidOn
        ? b.id.localeCompare(a.id, undefined, { numeric: true })
        : a.paidOn < b.paidOn
          ? 1
          : -1,
    )
  const posted = payments.filter((payment) => payment.status === 'posted')
  const active = contract.status === 'active'
  const cancellable = active && !hasPostedPayment(store, contract.id)
  const nextDays = next
    ? Math.round(
        (Date.parse(`${next.dueDate}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      )
    : 0

  const scheduleColumns: DataTableColumn<MockRow>[] = [
    {
      key: 'seq',
      header: 'القسط',
      width: '72px',
      cell: (row) => (
        <span className="font-medium tabular-nums">{row.seq}</span>
      ),
    },
    {
      key: 'due',
      header: 'تاريخ الاستحقاق',
      cell: (row) => {
        const state = installmentState(
          row.dueDate,
          row.amount,
          row.paidAmount,
          today,
        )
        const days = Math.round(
          (Date.parse(`${row.dueDate}T00:00:00Z`) -
            Date.parse(`${today}T00:00:00Z`)) /
            86_400_000,
        )
        const near = state !== 'paid' && state !== 'upcoming'
        return (
          <div>
            <DateText
              value={row.dueDate}
              className={`font-medium ${state === 'overdue' ? 'text-danger' : ''}`}
            />
            {near && (
              <div
                className={`text-xs ${state === 'overdue' ? 'text-danger' : 'text-muted'}`}
              >
                {whenWords(days)}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (row) => (
        <div>
          <Money value={row.amount} className="font-medium" />
          {row.isBalloon && (
            <div className="text-xs text-muted">الدفعة الاخيرة</div>
          )}
        </div>
      ),
    },
    {
      key: 'paid',
      header: 'المسدد',
      cell: (row) =>
        row.paidAmount > 0 ? (
          <Money value={row.paidAmount} />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'state',
      header: 'الحالة',
      cell: (row) => (
        <StateBadge
          state={
            contract.status === 'cancelled'
              ? 'upcoming'
              : installmentState(row.dueDate, row.amount, row.paidAmount, today)
          }
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <IconButton
          label="رجوع الى الاقساط"
          variant="outline"
          size="sm"
          icon={<ArrowRight size={15} aria-hidden="true" />}
          onClick={onBack}
        />
        <button type="button" onClick={onBack} className="hover:text-fg">
          الاقساط
        </button>
        <span aria-hidden="true" className="text-placeholder">
          ‹
        </span>
        <bdi dir="ltr" className="font-medium text-fg">
          {contract.number}
        </bdi>
      </div>

      <Card className="space-y-4 !p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <bdi dir="ltr" className="text-xl font-bold">
                {contract.number}
              </bdi>
              <Badge tone={status.tone}>{t(status.key)}</Badge>
            </div>
            <div className="text-base font-semibold">
              {contract.description}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted">
              <Building2 size={16} aria-hidden="true" />
              {financier}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {contract.status !== 'cancelled' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                  >
                    خيارات
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    icon={<Pencil size={15} aria-hidden="true" />}
                    onSelect={onEdit}
                  >
                    تعديل العقد
                  </DropdownMenuItem>
                  {active && (
                    <DropdownMenuItem
                      tone="danger"
                      icon={<Ban size={15} aria-hidden="true" />}
                      disabled={!cancellable}
                      onSelect={onCancel}
                    >
                      الغاء العقد
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {active && (
              <Button
                variant="primary"
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={onPay}
              >
                تسجيل سداد
              </Button>
            )}
          </div>
        </div>
        {contract.status === 'cancelled' && (
          <Notice tone="neutral" size="compact">
            العقد ملغي: {contract.cancelReason}
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="المبلغ المقسط"
            value={<Money value={financedAmount(contract.terms)} />}
            hint={`${installmentsWords(contract.rows.length)} · ${t(INSTALLMENT_FREQUENCY_LABEL_KEYS[contract.terms.frequencyMonths as 1 | 2 | 3 | 6 | 12])}`}
          />
          <StatCard
            label="المسدد"
            value={<Money value={paidOf(contract)} />}
            hint={`${paidRows.length} من ${contract.rows.length} قسط`}
          />
          <StatCard
            label="المتبقي"
            value={<Money value={remainingOf(contract)} />}
            hint={installmentsWords(openRows.length)}
          />
          <StatCard
            label="القسط القادم"
            tone={next && nextDays < 0 ? 'danger' : undefined}
            value={
              next ? (
                <Money value={next.amount - next.paidAmount} />
              ) : (
                <span className="text-muted">—</span>
              )
            }
            hint={
              next ? (
                <span>
                  <DateText value={next.dueDate} /> · {whenWords(nextDays)}
                </span>
              ) : contract.status === 'paid_off' ? (
                'انسدد العقد كاملا'
              ) : undefined
            }
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="space-y-3 !p-4 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              title="جدول الاقساط"
              description="يتولد تلقائيا من شروط العقد"
            />
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value as 'open' | 'paid' | 'all')
                setAll(false)
              }}
            >
              <TabsList variant="segmented" aria-label="الاقساط">
                <TabsTrigger value="open">
                  غير المسددة ({openRows.length})
                </TabsTrigger>
                <TabsTrigger value="paid">
                  المسددة ({paidRows.length})
                </TabsTrigger>
                <TabsTrigger value="all">
                  الكل ({contract.rows.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DataTable
            caption="جدول الاقساط"
            columns={scheduleColumns}
            rows={all ? rows : rows.slice(0, SCHEDULE_PAGE)}
            rowKey={(row) => row.seq}
            cellTextClassName={LIST_TEXT}
            cellClassName={LIST_CELL}
            empty={
              tab === 'paid'
                ? 'لا توجد اقساط مسددة بعد.'
                : 'لا توجد اقساط غير مسددة.'
            }
          />
          {!all && rows.length > SCHEDULE_PAGE && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
                عرض باقي الاقساط ({rows.length - SCHEDULE_PAGE})
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2 !p-4">
            <SectionHeader title="بيانات العقد" />
            <DescriptionList
              items={[
                {
                  icon: <Building2 size={16} aria-hidden="true" />,
                  label: 'الجهة',
                  value: financier,
                },
                {
                  icon: <CircleDollarSign size={16} aria-hidden="true" />,
                  label: 'اجمالي المبلغ',
                  value: <Money value={contract.terms.totalAmount} />,
                },
                {
                  icon: <CircleDollarSign size={16} aria-hidden="true" />,
                  label: 'المقدم',
                  value:
                    contract.terms.downPayment > 0 ? (
                      <Money value={contract.terms.downPayment} />
                    ) : (
                      'بدون'
                    ),
                },
                {
                  icon: <CircleDollarSign size={16} aria-hidden="true" />,
                  label: 'الدفعة الاخيرة',
                  value:
                    contract.terms.balloonAmount > 0 ? (
                      <Money value={contract.terms.balloonAmount} />
                    ) : (
                      'بدون'
                    ),
                },
                {
                  icon: <ListOrdered size={16} aria-hidden="true" />,
                  label: 'الاقساط',
                  value: `${installmentsWords(contract.rows.length)} · ${t(INSTALLMENT_FREQUENCY_LABEL_KEYS[contract.terms.frequencyMonths as 1 | 2 | 3 | 6 | 12])}`,
                },
                {
                  icon: <CalendarDays size={16} aria-hidden="true" />,
                  label: 'اول قسط واخر قسط',
                  value: (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <DateText value={contract.rows[0]?.dueDate ?? ''} />
                      <span aria-hidden="true" className="text-muted">
                        ←
                      </span>
                      <DateText
                        value={
                          contract.rows[contract.rows.length - 1]?.dueDate ?? ''
                        }
                      />
                    </span>
                  ),
                },
                {
                  icon: <Truck size={16} aria-hidden="true" />,
                  label: 'المعدات المرتبطة',
                  value: contract.equipment.length ? (
                    <bdi dir="ltr">{contract.equipment.join(' · ')}</bdi>
                  ) : (
                    'بدون'
                  ),
                },
                ...(contract.notes
                  ? [
                      {
                        icon: <StickyNote size={16} aria-hidden="true" />,
                        label: 'ملاحظات',
                        value: contract.notes,
                      },
                    ]
                  : []),
                {
                  icon: <UserRound size={16} aria-hidden="true" />,
                  label: 'انشاه',
                  value: (
                    <span>
                      {contract.createdBy} ·{' '}
                      <DateText value={contract.createdOn} />
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          <Card className="space-y-1 !p-4">
            <SectionHeader
              title="السدادات"
              description={
                posted.length
                  ? `${posted.length} مسجلة`
                  : 'لا توجد سدادات مسجلة'
              }
              action={
                payments.length > 4 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAllPayments(!allPayments)}
                  >
                    {allPayments ? 'عرض اقل' : 'عرض الكل'}
                  </Button>
                ) : undefined
              }
            />
            <ul className="divide-y divide-border">
              {(allPayments ? payments : payments.slice(0, 4)).map(
                (payment) => (
                  <PaymentItem
                    key={payment.id}
                    payment={payment}
                    canVoid={contract.status !== 'cancelled'}
                    onVoid={() => onVoid(payment.id)}
                  />
                ),
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function PaymentItem({
  payment,
  canVoid,
  onVoid,
}: {
  payment: MockPayment
  canVoid: boolean
  onVoid: () => void
}) {
  const { t } = useI18n()
  const voided = payment.status === 'voided'
  return (
    <li className="flex items-start justify-between gap-2 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Money
            value={payment.amount}
            className={`text-sm font-medium ${voided ? 'text-muted line-through' : ''}`}
          />
          {voided && (
            <Badge tone="neutral" size="sm">
              ملغي
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <DateText value={payment.paidOn} />
          <span aria-hidden="true">·</span>
          <span>
            {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
          </span>
          {payment.reference && (
            <>
              <span aria-hidden="true">·</span>
              <bdi dir="ltr">{payment.reference}</bdi>
            </>
          )}
        </div>
        <div className="text-xs text-muted">
          {voided
            ? `الغاه ${payment.by}: ${payment.voidReason}`
            : `سجله ${payment.by}`}
        </div>
      </div>
      {!voided && canVoid && (
        <Button variant="ghost" size="sm" onClick={onVoid}>
          الغاء
        </Button>
      )}
    </li>
  )
}

// --- The dialogs -----------------------------------------------------------------

function ErrorNotice({ token }: { token: string | null }) {
  const { t } = useI18n()
  if (!token) return null
  return (
    <Notice tone="danger" size="compact">
      {t(installmentErrorMessage({ message: token }))}
    </Notice>
  )
}

function ContractDialog({
  store,
  contract,
  onClose,
  onSave,
}: {
  store: MockStore
  contract: MockContract | null
  onClose: () => void
  onSave: (draft: {
    description: string
    financierId: string
    terms: InstallmentTerms
    notes: string
    equipment: string[]
  }) => string | null
}) {
  const { t } = useI18n()
  const [description, setDescription] = useState(contract?.description ?? '')
  const [financierId, setFinancierId] = useState(contract?.financierId ?? '')
  const [total, setTotal] = useState(
    contract ? String(contract.terms.totalAmount) : '',
  )
  const [down, setDown] = useState(
    contract?.terms.downPayment ? String(contract.terms.downPayment) : '',
  )
  const [balloon, setBalloon] = useState(
    contract?.terms.balloonAmount ? String(contract.terms.balloonAmount) : '',
  )
  const [count, setCount] = useState(
    contract ? String(contract.terms.installmentCount) : '',
  )
  const [frequency, setFrequency] = useState(
    String(contract?.terms.frequencyMonths ?? 1),
  )
  const [firstDue, setFirstDue] = useState(contract?.terms.firstDueDate ?? '')
  const [equipment, setEquipment] = useState<string[]>(
    contract?.equipment ?? [],
  )
  const [notes, setNotes] = useState(contract?.notes ?? '')
  const [token, setToken] = useState<string | null>(null)

  const locked = contract ? hasPostedPayment(store, contract.id) : false
  const terms: InstallmentTerms = {
    totalAmount: parseAmount(total),
    downPayment: parseAmount(down),
    balloonAmount: parseAmount(balloon),
    installmentCount: Number(count),
    frequencyMonths: Number(frequency),
    firstDueDate: firstDue,
  }
  const termsError = checkInstallmentTerms(terms)
  const preview = termsError ? [] : buildSchedule(terms)
  const regular = preview.find((row) => !row.isBalloon)
  const last = preview[preview.length - 1]

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={
        contract ? (
          <span>
            تعديل العقد <bdi dir="ltr">{contract.number}</bdi>
          </span>
        ) : (
          'عقد جديد'
        )
      }
      description="تتولد الاقساط تلقائيا من هذه البيانات."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              setToken(
                onSave({ description, financierId, terms, notes, equipment }),
              )
            }
          >
            حفظ العقد
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice token={token} />
        {locked && (
          <Notice tone="warning" size="compact">
            على العقد سدادات مسجلة، فالمبالغ وعدد الاقساط والتواريخ مقفلة.
            العنوان والجهة والمعدات والملاحظات تتعدل.
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="عنوان العقد"
            required
            hint="اي عنوان تختاره: معدة، سيارات، ارض، او اي شي ثاني."
          >
            {(control) => (
              <Input
                {...control}
                value={description}
                maxLength={200}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="الجهة"
            required
            hint="البنك او الوكيل. تضاف الجهات من زر «الجهات»."
          >
            {(control) => (
              <Select
                {...control}
                value={financierId}
                onValueChange={setFinancierId}
                placeholder="اختر الجهة"
                options={store.financiers.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="اجمالي المبلغ" required>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="decimal"
                disabled={locked}
                value={total}
                onChange={(event) => setTotal(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={<OptionalLabel text="المقدم" />}
            hint="مدفوع عند العقد وما يدخل في الاقساط."
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="decimal"
                placeholder="0.00"
                disabled={locked}
                value={down}
                onChange={(event) => setDown(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={<OptionalLabel text="الدفعة الاخيرة" />}
            hint="اذا اخر قسط اكبر من الباقي."
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="decimal"
                placeholder="0.00"
                disabled={locked}
                value={balloon}
                onChange={(event) => setBalloon(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="عدد الاقساط" required>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="numeric"
                disabled={locked}
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            )}
          </Field>
          <Field label="الاستحقاق" required>
            {(control) => (
              <Select
                {...control}
                value={frequency}
                onValueChange={setFrequency}
                disabled={locked}
                options={INSTALLMENT_FREQUENCIES.map((months) => ({
                  value: String(months),
                  label: t(INSTALLMENT_FREQUENCY_LABEL_KEYS[months]),
                }))}
              />
            )}
          </Field>
          <Field label="تاريخ اول قسط" required>
            {(control) => (
              <DatePicker
                {...control}
                disabled={locked}
                value={firstDue}
                onChange={setFirstDue}
              />
            )}
          </Field>
        </div>
        <Field
          label={<OptionalLabel text="المعدات المرتبطة" />}
          hint="اربط العقد بمعدة او اكثر من المعدات الموجودة، او اتركه بدون ربط."
        >
          {(control) => (
            <MultiSelect
              {...control}
              chips
              value={equipment}
              onValueChange={setEquipment}
              allLabel="بدون ربط"
              options={MOCK_UNITS.map((unit) => ({
                value: unit.code,
                label: `${unit.code} ${unit.type}`,
              }))}
            />
          )}
        </Field>
        <Field label={<OptionalLabel text="ملاحظات" />}>
          {(control) => (
            <Textarea
              {...control}
              value={notes}
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>

        <div className="space-y-3 rounded-xl border border-border bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">معاينة الاقساط</h3>
            {last && (
              <span className="text-xs text-muted">
                {installmentsWords(preview.length)} · من{' '}
                <DateText value={preview[0].dueDate} /> الى{' '}
                <DateText value={last.dueDate} />
              </span>
            )}
          </div>
          {preview.length === 0 ? (
            <p className="text-xs text-muted">
              {termsError && (total || count || firstDue)
                ? t(installmentErrorMessage({ message: termsError }))
                : 'اكتب المبلغ وعدد الاقساط وتاريخ اول قسط لتظهر الاقساط.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <PreviewFigure label="المبلغ المقسط">
                  <Money value={financedAmount(terms)} />
                </PreviewFigure>
                <PreviewFigure label="القسط">
                  <Money value={regular?.amount} />
                </PreviewFigure>
                <PreviewFigure label="الدفعة الاخيرة">
                  {terms.balloonAmount > 0 ? (
                    <Money value={terms.balloonAmount} />
                  ) : (
                    'بدون'
                  )}
                </PreviewFigure>
              </div>
              <DataTable
                caption="معاينة الاقساط"
                size="sm"
                columns={[
                  {
                    key: 'seq',
                    header: 'القسط',
                    width: '64px',
                    cell: (row) => (
                      <span className="tabular-nums">{row.seq}</span>
                    ),
                  },
                  {
                    key: 'due',
                    header: 'تاريخ الاستحقاق',
                    cell: (row) => <DateText value={row.dueDate} />,
                  },
                  {
                    key: 'amount',
                    header: 'المبلغ',
                    cell: (row) => (
                      <span className="inline-flex flex-wrap items-baseline gap-2">
                        <Money value={row.amount} />
                        {row.isBalloon && (
                          <span className="text-xs text-muted">
                            الدفعة الاخيرة
                          </span>
                        )}
                      </span>
                    ),
                  },
                ]}
                rows={
                  preview.length > 4
                    ? [...preview.slice(0, 3), last as (typeof preview)[number]]
                    : preview
                }
                rowKey={(row) => row.seq}
              />
              {preview.length > 4 && (
                <p className="text-xs text-muted">
                  يظهر اول ثلاثة اقساط واخر قسط من {preview.length}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function OptionalLabel({ text }: { text: string }) {
  return (
    <span>
      {text} <span className="text-xs font-normal text-muted">(اختياري)</span>
    </span>
  )
}

function PreviewFigure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-semibold">{children}</div>
    </div>
  )
}

function PaymentDialog({
  contract,
  today,
  onClose,
  onSave,
}: {
  contract: MockContract
  today: string
  onClose: () => void
  onSave: (draft: {
    paidOn: string
    amount: number
    method: InstallmentPaymentMethod
    reference: string
    note: string
  }) => string | null
}) {
  const { t } = useI18n()
  const next = nextRowOf(contract)
  const remaining = remainingOf(contract)
  const [paidOn, setPaidOn] = useState(today)
  const [amount, setAmount] = useState(
    next ? String(Math.round((next.amount - next.paidAmount) * 100) / 100) : '',
  )
  const [method, setMethod] = useState<InstallmentPaymentMethod>('transfer')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [token, setToken] = useState<string | null>(null)

  const value = parseAmount(amount)
  const allocations =
    Number.isFinite(value) && value > 0
      ? allocatePayment(
          contract.rows.map((row) => ({ id: String(row.seq), ...row })),
          value,
        )
      : null
  const covers = allocations
    ? allocations
        .map((item) => {
          const row = contract.rows.find((r) => String(r.seq) === item.id)
          const full =
            row !== undefined &&
            Math.round((row.paidAmount + item.amount) * 100) >=
              Math.round(row.amount * 100)
          return full
            ? `القسط ${item.id} كاملا`
            : `${formatInstallmentAmount(item.amount)} من القسط ${item.id}`
        })
        .join('، و')
    : null
  const nextDays = next
    ? Math.round(
        (Date.parse(`${next.dueDate}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      )
    : 0

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="تسجيل سداد"
      description={
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <bdi dir="ltr">{contract.number}</bdi>
          <span aria-hidden="true">·</span>
          <span>{contract.description}</span>
        </span>
      }
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              setToken(
                onSave({ paidOn, amount: value, method, reference, note }),
              )
            }
          >
            تسجيل السداد
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice token={token} />
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-[var(--surface)] p-3">
          <PreviewFigure label="المتبقي على العقد">
            <Money value={remaining} />
          </PreviewFigure>
          <div className="min-w-0">
            <PreviewFigure label="القسط القادم">
              <Money value={next ? next.amount - next.paidAmount : null} />
            </PreviewFigure>
            {next && (
              <div className="text-xs text-muted">
                <DateText value={next.dueDate} /> · {whenWords(nextDays)}
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاريخ السداد" required>
            {(control) => (
              <DatePicker
                {...control}
                value={paidOn}
                max={today}
                onChange={setPaidOn}
              />
            )}
          </Field>
          <Field label="المبلغ" required>
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
        </div>
        {covers ? (
          <Notice tone="info" size="compact">
            يغطي هذا المبلغ {covers}.
          </Notice>
        ) : (
          value > remaining && (
            <Notice tone="warning" size="compact">
              المبلغ اكبر من المتبقي على العقد.
            </Notice>
          )
        )}
        <Field label="طريقة السداد" required>
          {(control) => (
            <Select
              {...control}
              value={method}
              onValueChange={(next) =>
                setMethod(next as InstallmentPaymentMethod)
              }
              options={INSTALLMENT_PAYMENT_METHODS.map((item) => ({
                value: item,
                label: t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[item]),
              }))}
            />
          )}
        </Field>
        <Field label={<OptionalLabel text="المرجع" />}>
          {(control) => (
            <Input
              {...control}
              value={reference}
              maxLength={80}
              placeholder="رقم الحوالة او الشيك"
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>
        <Field label={<OptionalLabel text="ملاحظة" />}>
          {(control) => (
            <Textarea
              {...control}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/** The void-payment and cancel-contract dialogs: a warning and a reason. */
function ReasonDialog({
  title,
  description,
  warning,
  label,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string
  description?: ReactNode
  warning: string
  label: string
  confirm: string
  onClose: () => void
  onConfirm: (reason: string) => string | null
}) {
  const [reason, setReason] = useState('')
  const [token, setToken] = useState<string | null>(null)
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button variant="danger" onClick={() => setToken(onConfirm(reason))}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNotice token={token} />
        <Notice tone="warning" size="compact">
          {warning}
        </Notice>
        <Field label={label} required>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              maxLength={500}
              placeholder="اكتب السبب"
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

function FinanciersDialog({
  store,
  onClose,
  onSave,
  onDelete,
}: {
  store: MockStore
  onClose: () => void
  onSave: (id: string | null, name: string) => string | null
  onDelete: (id: string) => string | null
}) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [token, setToken] = useState<string | null>(null)
  const counts = new Map<string, number>()
  for (const contract of store.contracts)
    counts.set(
      contract.financierId,
      (counts.get(contract.financierId) ?? 0) + 1,
    )

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="الجهات"
      description="البنوك والوكلاء الي عليهم عقود الاقساط."
      size="md"
      footer={
        <Button variant="outline" onClick={onClose}>
          اغلاق
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorNotice token={token} />
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const refused = onSave(null, name)
            setToken(refused)
            if (!refused) setName('')
          }}
        >
          <Input
            value={name}
            maxLength={120}
            placeholder="اسم الجهة"
            aria-label="اسم الجهة"
            onChange={(event) => setName(event.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim()}
            icon={<Plus size={16} aria-hidden="true" />}
          >
            اضافة
          </Button>
        </form>
        <ul className="divide-y divide-border">
          {store.financiers.map((financier) => {
            const count = counts.get(financier.id) ?? 0
            const isEditing = editing?.id === financier.id
            return (
              <li
                key={financier.id}
                className="flex items-center justify-between gap-2 py-2.5"
              >
                {isEditing ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const refused = onSave(financier.id, editing.name)
                      setToken(refused)
                      if (!refused) setEditing(null)
                    }}
                  >
                    <Input
                      value={editing.name}
                      maxLength={120}
                      aria-label="اسم الجهة"
                      autoFocus
                      onChange={(event) =>
                        setEditing({
                          id: financier.id,
                          name: event.target.value,
                        })
                      }
                      className="flex-1"
                    />
                    <Button type="submit" variant="primary" size="sm">
                      حفظ
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(null)}
                    >
                      تراجع
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {financier.name}
                      </div>
                      <div className="text-xs text-muted">
                        {contractsWords(count)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label={`تعديل ${financier.name}`}
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={15} aria-hidden="true" />}
                        onClick={() =>
                          setEditing({ id: financier.id, name: financier.name })
                        }
                      />
                      <IconButton
                        label={
                          count > 0
                            ? `لا تحذف ${financier.name}: عليها عقود`
                            : `حذف ${financier.name}`
                        }
                        variant="ghost"
                        size="sm"
                        disabled={count > 0}
                        icon={
                          <Trash2
                            size={15}
                            aria-hidden="true"
                            className={count > 0 ? '' : 'text-danger'}
                          />
                        }
                        onClick={() => setToken(onDelete(financier.id))}
                      />
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <FileText size={13} aria-hidden="true" />
          الجهة الي عليها عقود ما تنحذف.
        </p>
      </div>
    </Dialog>
  )
}
