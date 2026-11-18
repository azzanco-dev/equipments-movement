import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Banknote,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  RotateCcw,
  StickyNote,
  Trash2,
  Truck,
  User,
  Wallet,
} from 'lucide-react'
import {
  BackButton,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DescriptionList,
  DetailHeader,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  MultiSelect,
  Notice,
  RiyalSign,
  SearchInput,
  SectionHeader,
  Select,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  type DataTableColumn,
  type DataTableSort,
  type DescriptionListItem,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  addMonths,
  allocatePayment,
  buildSchedule,
  checkInstallmentTerms,
  financedAmount,
  formatInstallmentAmount,
  installmentErrorMessage,
  installmentState,
  toHalalas,
  INSTALLMENT_CONTRACT_STATUS_BADGE,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  INSTALLMENT_STATE_BADGE,
  type InstallmentFrequency,
  type InstallmentPaymentMethod,
  type InstallmentState,
  type InstallmentTerms,
} from '@/lib/installments'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  cancelContract,
  deleteFinancier,
  duesInView,
  financierStats,
  hasPostedPayment,
  historyOf,
  isRowPaid,
  MOCK_UNITS,
  monthKeyOf,
  monthlyDues,
  openDues,
  overviewOf,
  recordPayment,
  rowRemaining,
  saveContract,
  saveFinancier,
  seedStore,
  sumDues,
  summaryOf,
  unitOf,
  voidPayment,
  type ContractDraft,
  type ContractSummary,
  type DueItem,
  type DuesView,
  type HistoryKind,
  type MockContract,
  type MockFinancier,
  type MockPayment,
  type MockResult,
  type MockStore,
  type MonthBucket,
  type PaymentDraft,
} from './installmentsMockupData'

/**
 * /ui-kit mockup of «الاقساط». The owner compared it with the mockup of the
 * side project `company-installments` and chose (2026-11-18) «the old design
 * on the simplified model» and «one page with tabs + the contract page»: the
 * layout and the visual pieces are that mockup's (the dashboard with its
 * monthly bars and overdue card, the contracts list, the dues with their
 * sub-tabs, the financiers, the contract page with wide schedule and payment
 * cards, the facts with icons and the history), on the model of migration
 * 0203 — a free title, a financier that is a name only, one total amount, a
 * down payment and a final payment, an optional link to units, no VAT /
 * profit / fees, no events table (the history is derived from the store).
 *
 * One page with four tabs — «اللوحة», «العقود», «الاستحقاقات», «الجهات» — and
 * the contract page, moved between in memory. Every action runs the rule of
 * migration 0203 through `installmentsMockupData.ts`; nothing reads or writes
 * the database. No real screen exists until he approves.
 */

// --- The shared sample store ---------------------------------------------------------

type HomeTab = 'dashboard' | 'contracts' | 'dues' | 'financiers'

type View = { page: 'home' } | { page: 'contract'; id: string }

type DialogRequest =
  | { kind: 'contract'; id: string | null }
  | { kind: 'pay'; contractId: string | null; amount?: number }
  | { kind: 'void'; paymentId: string }
  | { kind: 'cancel'; contractId: string }
  | { kind: 'financier'; id: string | null }

interface MockupValue {
  store: MockStore
  today: string
  /** Every unpaid row of the active contracts, the nearest first. */
  dues: DueItem[]
  financierName: (id: string) => string
  openContract: (id: string) => void
  openDialog: (request: DialogRequest) => void
  /** Deletes a financier; the refusal token, or null. */
  removeFinancier: (id: string) => string | null
}

const MockupContext = createContext<MockupValue | null>(null)

function useMockup(): MockupValue {
  const value = useContext(MockupContext)
  if (!value) throw new Error('InstallmentsMockup context is missing')
  return value
}

export function InstallmentsMockup() {
  const today = useMemo(() => saudiDateKey(), [])
  const [store, setStore] = useState<MockStore>(() => seedStore(today))
  const [view, setView] = useState<View>({ page: 'home' })
  const [tab, setTab] = useState<HomeTab>('dashboard')
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const dues = useMemo(() => openDues(store, today), [store, today])

  /** Applies a store action; returns its refusal token, or null. */
  const apply = (result: MockResult, done: string): string | null => {
    if (!result.ok) return result.token
    setStore(result.store)
    setFlash(done)
    return null
  }
  const contractOf = (id: string) =>
    store.contracts.find((contract) => contract.id === id) ?? null
  const close = () => setDialog(null)

  const value: MockupValue = {
    store,
    today,
    dues,
    financierName: (id) =>
      store.financiers.find((item) => item.id === id)?.name ?? '—',
    openContract: (id) => setView({ page: 'contract', id }),
    openDialog: setDialog,
    removeFinancier: (id) => apply(deleteFinancier(store, id), 'تم حذف الجهة.'),
  }
  const shown = view.page === 'contract' ? contractOf(view.id) : null

  return (
    <MockupContext.Provider value={value}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            بيانات تجريبية: جرب تسجيل سداد، الغاء سداد وعقدا جديدا. لا شي ينحفظ.
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={() => {
              setStore(seedStore(today))
              setView({ page: 'home' })
              setFlash(null)
            }}
          >
            اعادة البيانات
          </Button>
        </div>
        {flash && (
          <Notice
            tone="success"
            size="compact"
            onDismiss={() => setFlash(null)}
          >
            {flash}
          </Notice>
        )}
        <div className="rounded-xl border bg-surface p-3 sm:p-4">
          {shown ? (
            <ContractPage
              key={shown.id}
              contract={shown}
              onBack={() => setView({ page: 'home' })}
            />
          ) : (
            <HomePage tab={tab} onTabChange={setTab} />
          )}
        </div>
      </div>

      {dialog?.kind === 'contract' && (
        <ContractDialog
          contract={dialog.id ? contractOf(dialog.id) : null}
          onClose={close}
          onSubmit={(draft) => {
            const result = saveContract(store, dialog.id, draft, today)
            const token = apply(
              result,
              dialog.id ? 'تم حفظ العقد.' : 'تم انشاء العقد وتولدت اقساطه.',
            )
            if (result.ok) {
              setView({ page: 'contract', id: result.id })
              close()
            }
            return token
          }}
        />
      )}
      {dialog?.kind === 'pay' && (
        <PaymentDialog
          initialContractId={dialog.contractId}
          initialAmount={dialog.amount}
          onClose={close}
          onSubmit={(contractId, draft) => {
            const token = apply(
              recordPayment(store, contractId, draft, today),
              'تم تسجيل السداد.',
            )
            if (!token) close()
            return token
          }}
        />
      )}
      {dialog?.kind === 'void' && (
        <VoidPaymentDialog
          payment={
            store.payments.find((item) => item.id === dialog.paymentId) ?? null
          }
          onClose={close}
          onSubmit={(reason) => {
            const token = apply(
              voidPayment(store, dialog.paymentId, reason, today),
              'تم الغاء السداد.',
            )
            if (!token) close()
            return token
          }}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelContractDialog
          contract={contractOf(dialog.contractId)}
          onClose={close}
          onSubmit={(reason) => {
            const token = apply(
              cancelContract(store, dialog.contractId, reason, today),
              'تم الغاء العقد.',
            )
            if (!token) close()
            return token
          }}
        />
      )}
      {dialog?.kind === 'financier' && (
        <FinancierDialog
          financier={
            dialog.id
              ? (store.financiers.find((item) => item.id === dialog.id) ?? null)
              : null
          }
          onClose={close}
          onSubmit={(name) => {
            const token = apply(
              saveFinancier(store, dialog.id, name),
              dialog.id ? 'تم تعديل اسم الجهة.' : 'تمت اضافة الجهة.',
            )
            if (!token) close()
            return token
          }}
        />
      )}
    </MockupContext.Provider>
  )
}

// --- Words -----------------------------------------------------------------------------

/** «يوم», «يومين», «3 ايام», «11 يوم». */
function daysWords(count: number): string {
  if (count === 1) return 'يوم'
  if (count === 2) return 'يومين'
  if (count <= 10) return `${count} ايام`
  return `${count} يوم`
}

/** «قسط واحد», «قسطين», «5 اقساط», «27 قسط». */
function installmentsWords(count: number): string {
  if (count === 0) return 'لا توجد اقساط'
  if (count === 1) return 'قسط واحد'
  if (count === 2) return 'قسطين'
  if (count <= 10) return `${count} اقساط`
  return `${count} قسط`
}

function contractsWords(count: number): string {
  if (count === 0) return 'لا توجد عقود'
  if (count === 1) return 'عقد واحد'
  if (count === 2) return 'عقدين'
  if (count <= 10) return `${count} عقود`
  return `${count} عقد`
}

/** «اليوم», «متاخر 3 ايام», «باقي 7 ايام». */
function whenWords(days: number): string {
  if (days === 0) return 'اليوم'
  return days < 0 ? `متاخر ${daysWords(-days)}` : `باقي ${daysWords(days)}`
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'ابريل',
  'مايو',
  'يونيو',
  'يوليو',
  'اغسطس',
  'سبتمبر',
  'اكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const

/** «نوفمبر 2026», or the month's name alone under a bar. */
function monthLabel(key: string, short = false): string {
  const name = MONTHS_AR[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)
  return short ? name : `${name} ${key.slice(0, 4)}`
}

// --- Shared cells ---------------------------------------------------------------------

/** An amount with the official riyal symbol after it (the purchasing Price). */
function Money({
  value,
  className,
}: {
  value: number | null | undefined
  className?: string
}) {
  return (
    <span
      className={cn(
        // `relative` keeps the absolutely placed sr-only text inside a scrolling
        // table; without it the text escapes the scroll box and widens the page.
        'relative inline-flex items-baseline gap-1 whitespace-nowrap',
        className,
      )}
    >
      <bdi dir="ltr" className="tabular-nums">
        {formatInstallmentAmount(value)}
      </bdi>
      <RiyalSign className="text-muted" size="0.8em" />
      <span className="sr-only">ريال</span>
    </span>
  )
}

function StateBadge({
  state,
  partial,
}: {
  state: InstallmentState
  partial?: boolean
}) {
  const { t } = useI18n()
  const badge = INSTALLMENT_STATE_BADGE[state]
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={badge.tone}>{t(badge.key)}</Badge>
      {partial && state !== 'paid' && <Badge tone="info">مسدد جزئيا</Badge>}
    </span>
  )
}

function ContractStatusBadge({ status }: { status: MockContract['status'] }) {
  const { t } = useI18n()
  const badge = INSTALLMENT_CONTRACT_STATUS_BADGE[status]
  return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
}

function OverdueBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <Badge tone="danger" icon={<AlertTriangle size={12} />}>
      {count} متاخر
    </Badge>
  )
}

function UnitTag({ code }: { code: string }) {
  const unit = unitOf(code)
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-xs">
      <bdi dir="ltr" className="font-semibold">
        {code}
      </bdi>
      {unit && <span className="text-muted">{unit.type}</span>}
    </span>
  )
}

/** The linked units as tags; «بدون» for a contract tied to no unit. */
function UnitTags({
  contract,
  max = 2,
}: {
  contract: MockContract
  max?: number
}) {
  if (contract.equipment.length === 0)
    return <span className="text-muted">بدون</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {contract.equipment.slice(0, max).map((code) => (
        <UnitTag key={code} code={code} />
      ))}
      {contract.equipment.length > max && (
        <span className="text-xs text-muted">
          +{contract.equipment.length - max}
        </span>
      )}
    </span>
  )
}

/** Paid out of financed, as a thin bar with its numbers. */
function PaidProgress({ summary }: { summary: ContractSummary }) {
  return (
    <div className="min-w-[120px] space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuenow={summary.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="المسدد"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${summary.percent}%`,
            backgroundColor: 'var(--success)',
          }}
        />
      </div>
      <p className="flex justify-between gap-2 text-xs text-muted">
        <bdi dir="ltr" className="tabular-nums">
          {summary.paidCount}/{summary.rowCount}
        </bdi>
        <bdi dir="ltr" className="tabular-nums">
          {summary.percent}%
        </bdi>
      </p>
    </div>
  )
}

/** First and last due day as «28/11/2026 الى 28/10/2027»: each date an LTR
 *  run, the word between them in the interface direction. */
function PeriodRange({ from, to }: { from: string; to: string | null }) {
  return (
    <span>
      <bdi dir="ltr">{formatDate(from)}</bdi> الى{' '}
      <bdi dir="ltr">{to ? formatDate(to) : '—'}</bdi>
    </span>
  )
}

/** The message of a store token; the raw token is never shown. */
function useErrorText() {
  const { t } = useI18n()
  return (token: string) => t(installmentErrorMessage({ message: token }))
}

/** A contract in a table cell: the title in bold, the number under it. */
function ContractCell({
  contract,
  withFinancier,
}: {
  contract: MockContract
  withFinancier?: boolean
}) {
  const { financierName } = useMockup()
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span
        className="block max-w-[16rem] truncate-safe font-semibold"
        title={contract.description}
      >
        {contract.description}
      </span>
      <span className="text-xs text-muted">
        <bdi dir="ltr">{contract.number}</bdi>
        {withFinancier && <> · {financierName(contract.financierId)}</>}
      </span>
    </span>
  )
}

/** The due day with how far it is: late in red, today in amber. */
function DueDateCell({ item }: { item: DueItem }) {
  return (
    <span className="flex flex-col items-start">
      <bdi
        dir="ltr"
        className={cn('font-medium', item.days < 0 && 'text-danger')}
      >
        {formatDate(item.row.dueDate)}
      </bdi>
      <span
        className={cn(
          'text-xs',
          item.days < 0
            ? 'text-danger'
            : item.days === 0
              ? 'text-warning'
              : 'text-muted',
        )}
      >
        {whenWords(item.days)}
      </span>
    </span>
  )
}

function PayRowButton({ item }: { item: DueItem }) {
  const { openDialog } = useMockup()
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(event) => {
        event.stopPropagation()
        openDialog({
          kind: 'pay',
          contractId: item.contract.id,
          amount: item.remaining,
        })
      }}
    >
      تسديد
    </Button>
  )
}

// ======================================================================================
// The home page: the header and the four tabs
// ======================================================================================

function HomePage({
  tab,
  onTabChange,
}: {
  tab: HomeTab
  onTabChange: (tab: HomeTab) => void
}) {
  const { store, dues, today, openDialog } = useMockup()
  const overdueCount = duesInView(dues, 'overdue', today).length
  const hidden = 'mt-0 data-[state=inactive]:hidden'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">الاقساط</h2>
          <p className="text-sm text-muted">
            ما يستحق على الشركة من اقساط، وما تاخر منها.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Wallet size={14} aria-hidden="true" />}
            onClick={() => openDialog({ kind: 'pay', contractId: null })}
          >
            تسجيل سداد
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => openDialog({ kind: 'contract', id: null })}
          >
            عقد جديد
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) => onTabChange(next as HomeTab)}
        className="space-y-4"
      >
        <TabsList aria-label="اقسام الاقساط">
          <TabsTrigger value="dashboard">اللوحة</TabsTrigger>
          <TabsTrigger value="contracts">
            العقود
            <span className="ms-1 text-xs text-muted tabular-nums">
              {store.contracts.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="dues">
            الاستحقاقات
            {overdueCount > 0 && (
              <Badge size="sm" tone="danger" className="ms-1.5">
                {overdueCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="financiers">الجهات</TabsTrigger>
        </TabsList>
        {/* Every tab stays mounted, so its search and filters survive a
            switch; the inactive ones are hidden. */}
        <TabsContent value="dashboard" forceMount className={hidden}>
          <DashboardTab onShowDues={() => onTabChange('dues')} />
        </TabsContent>
        <TabsContent value="contracts" forceMount className={hidden}>
          <ContractsTab />
        </TabsContent>
        <TabsContent value="dues" forceMount className={hidden}>
          <DuesTab />
        </TabsContent>
        <TabsContent value="financiers" forceMount className={hidden}>
          <FinanciersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ======================================================================================
// 1. «اللوحة»
// ======================================================================================

function DashboardTab({ onShowDues }: { onShowDues: () => void }) {
  const { store, today, dues, openContract } = useMockup()
  const overview = useMemo(() => overviewOf(dues), [dues])
  const overdue = duesInView(dues, 'overdue', today)
  const next30 = duesInView(dues, 'next30', today)
  const overdueContracts = new Set(overdue.map((item) => item.contract.id)).size
  // The nearest row that is not late yet: what the owner asks about first.
  const nearest = dues.find((item) => item.days >= 0) ?? null
  const months = useMemo(() => monthlyDues(dues, today), [dues, today])
  const hasContracts = store.contracts.some(
    (contract) => contract.status === 'active',
  )

  const dueColumns: DataTableColumn<DueItem>[] = [
    {
      key: 'contract',
      header: 'العقد',
      cell: (item) => <ContractCell contract={item.contract} withFinancier />,
    },
    {
      key: 'due',
      header: 'تاريخ الاستحقاق',
      cell: (item) => <DueDateCell item={item} />,
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      align: 'end',
      cell: (item) => <Money value={item.remaining} className="font-medium" />,
    },
    {
      key: 'action',
      header: <span className="sr-only">تسديد</span>,
      align: 'end',
      cell: (item) => <PayRowButton item={item} />,
    },
  ]

  return (
    <div className="space-y-4">
      {/* The four numbers; overdue is the only red one. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="متاخر"
          value={<Money value={overview.overdueAmount} />}
          hint={
            overdue.length === 0
              ? 'لا توجد اقساط متاخرة.'
              : `${installmentsWords(overdue.length)} في ${contractsWords(overdueContracts)}`
          }
          icon={<AlertTriangle size={18} />}
          accent={overdue.length > 0 ? 'danger' : undefined}
        />
        <StatCard
          label="مستحق خلال 7 ايام"
          value={<Money value={overview.due7Amount} />}
          hint={
            nearest ? (
              <span>
                اقرب قسط <bdi dir="ltr">{formatDate(nearest.row.dueDate)}</bdi>{' '}
                · {whenWords(nearest.days)}
              </span>
            ) : (
              'لا توجد اقساط قادمة.'
            )
          }
          icon={<CalendarClock size={18} />}
          accent="warning"
        />
        <StatCard
          label="خلال 30 يوما"
          value={<Money value={overview.due30Amount} />}
          hint={installmentsWords(overview.due30Count)}
          icon={<Calendar size={18} />}
        />
        <StatCard
          label="المتبقي على العقود"
          value={<Money value={overview.remainingTotal} />}
          hint={`على ${contractsWords(overview.activeContracts)} سارية`}
          icon={<Coins size={18} />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="space-y-3 p-4 xl:col-span-2">
          <SectionHeader
            title="المستحق في الشهور القادمة"
            description="ما بقي للسداد في كل شهر من السنة القادمة، بدون المتاخر."
          />
          {hasContracts ? (
            <CashflowBars months={months} />
          ) : (
            <EmptyState title="لا توجد عقود سارية بعد." className="p-6" />
          )}
        </Card>

        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-2">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  الاقساط المتاخرة
                  {overdue.length > 0 && (
                    <Badge size="sm" tone="danger">
                      {overdue.length}
                    </Badge>
                  )}
                </span>
              }
              description="الاقدم اولا. العنوان يفتح العقد."
            />
          </div>
          {overdue.length > 0 ? (
            // A list, not a table: the card is a third of the page, and a
            // row has to keep its title, its amount and «تسديد» in view.
            <ul className="divide-y border-t">
              {overdue.slice(0, 7).map((item) => (
                <li key={item.key} className="flex items-center gap-3 p-3 ps-4">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onClick={() => openContract(item.contract.id)}
                  >
                    <span
                      className="block truncate-safe text-sm font-semibold"
                      title={item.contract.description}
                    >
                      {item.contract.description}
                    </span>
                    <span className="block truncate-safe text-xs text-muted">
                      <bdi dir="ltr">{item.contract.number}</bdi> ·{' '}
                      {item.financierName}
                    </span>
                    <span className="mt-0.5 block text-xs text-danger">
                      <bdi dir="ltr">{formatDate(item.row.dueDate)}</bdi> ·{' '}
                      {whenWords(item.days)}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Money
                      value={item.remaining}
                      className="text-sm font-semibold"
                    />
                    <PayRowButton item={item} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 pt-0">
              <Notice
                tone="success"
                size="compact"
                icon={<CheckCircle2 size={16} />}
              >
                لا توجد اقساط متاخرة.
              </Notice>
            </div>
          )}
          {overdue.length > 7 && (
            <div className="flex justify-center p-2">
              <Button size="sm" variant="ghost" onClick={onShowDues}>
                كل المتاخر ({overdue.length})
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 pb-2">
          <SectionHeader
            title="القادم خلال 30 يوما"
            description="اقساط تستحق اليوم او خلال الشهر القادم، الاقرب اولا."
            action={
              <Button size="sm" variant="ghost" onClick={onShowDues}>
                كل الاستحقاقات
              </Button>
            }
          />
        </div>
        <DataTable
          columns={[
            ...dueColumns.slice(0, 2),
            {
              key: 'state',
              header: 'الحالة',
              cell: (item: DueItem) => (
                <StateBadge state={item.state} partial={item.isPartial} />
              ),
            },
            ...dueColumns.slice(2),
          ]}
          rows={next30}
          rowKey={(item) => item.key}
          onRowClick={(item) => openContract(item.contract.id)}
          empty={
            <EmptyState title="لا توجد اقساط خلال 30 يوما." className="p-6" />
          }
          className="border-t"
        />
      </Card>
    </div>
  )
}

/**
 * What is still to pay per month, one series in the first chart tint with its
 * outline (owner rule 2026-09-19: pale fills, never saturated). Bars are
 * anchored to the baseline with 4 px rounded tops, a 2 px gap between them,
 * recessive gridlines, the value on hover / focus and on the largest bar.
 */
function CashflowBars({ months }: { months: MonthBucket[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(...months.map((month) => month.total), 1)
  const peak = months.reduce(
    (best, month) => (month.total > best.total ? month : best),
    months[0],
  )
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  // The largest bar carries its own value, so the top line has none.
  const ticks = [0.25, 0.5, 0.75]
  const active = months.find((month) => month.key === hover) ?? null

  return (
    <div className="space-y-2">
      {/* The plot sits 24 px under the top so the largest bar's value
          never touches the card header. */}
      <div className="relative h-60">
        <div className="absolute inset-x-0 bottom-0 top-6">
          {/* Gridlines with their compact values. */}
          {ticks.map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${tick * 100}%`, borderColor: 'var(--border)' }}
            >
              <span className="absolute -top-2.5 end-0 bg-bg px-1 text-[10px] text-muted">
                <bdi dir="ltr">{compact.format(max * tick)}</bdi>
              </span>
            </div>
          ))}
          <div
            className="absolute inset-0 flex items-end gap-[2px] border-b pe-10"
            role="list"
            aria-label="المستحق في الشهور القادمة"
          >
            {months.map((month) => {
              const height = (month.total / max) * 100
              const showValue = month.key === peak.key || month.key === hover
              return (
                <button
                  key={month.key}
                  type="button"
                  role="listitem"
                  className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
                  onMouseEnter={() => setHover(month.key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(month.key)}
                  onBlur={() => setHover(null)}
                  aria-label={`${monthLabel(month.key)}: ${formatInstallmentAmount(month.total)}`}
                >
                  {showValue && month.total > 0 && (
                    <span
                      className="absolute z-10 whitespace-nowrap text-[11px] font-medium"
                      style={{ bottom: `calc(${height}% + 4px)` }}
                    >
                      <bdi dir="ltr">{compact.format(month.total)}</bdi>
                    </span>
                  )}
                  <span
                    className="w-full max-w-10 rounded-t-[4px] border transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)]"
                    style={{
                      height: `${Math.max(height, month.total > 0 ? 1.5 : 0)}%`,
                      backgroundColor: 'var(--chart-1)',
                      borderColor: 'var(--chart-stroke-1)',
                      opacity: hover && hover !== month.key ? 0.55 : 1,
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-[2px] pe-10">
        {months.map((month) => (
          <span
            key={month.key}
            className="flex-1 truncate text-center text-[11px] text-muted"
          >
            {/* A phone has no room for twelve names: the month's number. */}
            <bdi dir="ltr" className="tabular-nums sm:hidden">
              {Number(month.key.slice(5, 7))}
            </bdi>
            <span className="hidden sm:inline">
              {monthLabel(month.key, true)}
            </span>
          </span>
        ))}
      </div>
      {/* The tooltip as a line: readable on touch too. */}
      <p className="min-h-5 text-xs text-muted" aria-live="polite">
        {active ? (
          <>
            <span className="font-medium text-fg">
              {monthLabel(active.key)}
            </span>
            {' · '}
            <Money value={active.total} className="text-fg" />
            {' · '}
            {installmentsWords(active.count)}
          </>
        ) : (
          'مرر على شهر لترى مبلغه وعدد اقساطه.'
        )}
      </p>
    </div>
  )
}

// ======================================================================================
// 2. «العقود»
// ======================================================================================

interface ContractListRow {
  contract: MockContract
  financier: string
  summary: ContractSummary
}

function ContractsTab() {
  const { store, today, financierName, openContract, openDialog } = useMockup()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [financierId, setFinancierId] = useState('all')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [sort, setSort] = useState<DataTableSort>({
    key: 'next',
    direction: 'asc',
  })

  const rows: ContractListRow[] = store.contracts.map((contract) => ({
    contract,
    financier: financierName(contract.financierId),
    summary: summaryOf(contract, today),
  }))

  const text = search.trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (status !== 'all' && row.contract.status !== status) return false
    if (financierId !== 'all' && row.contract.financierId !== financierId)
      return false
    if (onlyOverdue && row.summary.overdueCount === 0) return false
    if (!text) return true
    return [
      row.contract.description,
      row.contract.number,
      row.financier,
      row.contract.equipment.join(' '),
    ]
      .join(' ')
      .toLowerCase()
      .includes(text)
  })
  const value = (row: ContractListRow): string | number => {
    switch (sort.key) {
      case 'contract':
        return row.contract.description
      case 'remaining':
        return row.contract.status === 'cancelled' ? 0 : row.summary.remaining
      default:
        // Closed contracts (no next row to pay) go last.
        return row.contract.status === 'active' && row.summary.next
          ? row.summary.next.dueDate
          : '9999-12-31'
    }
  }
  const sorted = [...filtered].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'ar')
    return sort.direction === 'asc' ? cmp : -cmp
  })

  const columns: DataTableColumn<ContractListRow>[] = [
    {
      key: 'contract',
      header: 'العقد',
      sortable: true,
      cell: (row) => <ContractCell contract={row.contract} />,
    },
    {
      key: 'financier',
      header: 'الجهة',
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <Building2 size={14} aria-hidden="true" className="text-muted" />
          {row.financier}
        </span>
      ),
    },
    {
      key: 'units',
      header: 'المعدات',
      hideBelow: 'md',
      cell: (row) => <UnitTags contract={row.contract} />,
    },
    {
      key: 'paid',
      header: 'المسدد',
      hideBelow: 'lg',
      cell: (row) => <PaidProgress summary={row.summary} />,
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      sortable: true,
      align: 'end',
      cell: (row) => (
        <Money
          value={
            row.contract.status === 'cancelled' ? null : row.summary.remaining
          }
        />
      ),
    },
    {
      key: 'next',
      header: 'القسط القادم',
      sortable: true,
      cell: (row) => {
        const next = row.summary.next
        if (!next || row.contract.status !== 'active')
          return <span className="text-muted">—</span>
        const late = next.dueDate < today
        return (
          <span className="flex flex-col items-start">
            <bdi dir="ltr" className={cn(late && 'font-medium text-danger')}>
              {formatDate(next.dueDate)}
            </bdi>
            <span className="text-xs text-muted">
              <Money value={rowRemaining(next)} />
            </span>
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <ContractStatusBadge status={row.contract.status} />
          <OverdueBadge count={row.summary.overdueCount} />
        </span>
      ),
    },
  ]

  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="عنوان العقد او رقمه او الجهة او رقم المعدة"
          className="w-full sm:w-72"
        />
        <Select
          size="sm"
          aria-label="الحالة"
          className="w-[140px]"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'all', label: 'كل الحالات' },
            ...(['active', 'paid_off', 'cancelled'] as const).map((item) => ({
              value: item,
              label: t(INSTALLMENT_CONTRACT_STATUS_BADGE[item].key),
            })),
          ]}
        />
        <Select
          size="sm"
          aria-label="الجهة"
          className="w-[190px]"
          value={financierId}
          onValueChange={setFinancierId}
          options={[
            { value: 'all', label: 'كل الجهات' },
            ...store.financiers.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
        <Checkbox
          checked={onlyOverdue}
          onCheckedChange={(checked) => setOnlyOverdue(checked === true)}
          label="المتاخرة فقط"
        />
      </div>

      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(row) => row.contract.id}
        onRowClick={(row) => openContract(row.contract.id)}
        sort={sort}
        onSortChange={(key, direction) => setSort({ key, direction })}
        empty={
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title={
              store.contracts.length === 0
                ? 'لا توجد عقود تقسيط بعد.'
                : 'لا توجد عقود مطابقة للبحث.'
            }
            action={
              store.contracts.length === 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => openDialog({ kind: 'contract', id: null })}
                >
                  عقد جديد
                </Button>
              ) : undefined
            }
          />
        }
        className="rounded-xl border bg-bg"
      />
      <p className="text-xs text-muted">{contractsWords(sorted.length)}</p>
    </div>
  )
}

// ======================================================================================
// 3. «الاستحقاقات»
// ======================================================================================

const DUES_PAGE_ROWS = 20

const DUES_VIEWS: readonly [DuesView, string][] = [
  ['overdue', 'متاخر'],
  ['month', 'هذا الشهر'],
  ['next30', 'خلال 30 يوما'],
  ['all', 'كل غير المسدد'],
]

function DuesTab() {
  const { store, today, dues, openContract } = useMockup()
  const overdueCount = duesInView(dues, 'overdue', today).length
  // Opens on what is late; with nothing late, on what is nearest.
  const [view, setView] = useState<DuesView>(
    overdueCount > 0 ? 'overdue' : 'next30',
  )
  const [financierId, setFinancierId] = useState('all')
  // The real list pages on the server; the mockup shows a page at a time.
  const [limit, setLimit] = useState(DUES_PAGE_ROWS)

  const rows = duesInView(dues, view, today).filter(
    (item) =>
      financierId === 'all' || item.contract.financierId === financierId,
  )

  const columns: DataTableColumn<DueItem>[] = [
    {
      key: 'due',
      header: 'تاريخ الاستحقاق',
      cell: (item) => <DueDateCell item={item} />,
    },
    {
      key: 'contract',
      header: 'العقد',
      cell: (item) => <ContractCell contract={item.contract} withFinancier />,
    },
    {
      key: 'units',
      header: 'المعدات',
      hideBelow: 'lg',
      cell: (item) => <UnitTags contract={item.contract} />,
    },
    {
      key: 'seq',
      header: 'القسط',
      hideBelow: 'md',
      cell: (item) => (
        <span className="flex items-center gap-1">
          <bdi dir="ltr" className="tabular-nums">
            {item.row.seq}/{item.contract.terms.installmentCount}
          </bdi>
          {item.row.isBalloon && (
            <Badge size="sm" tone="info">
              دفعة اخيرة
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'الحالة',
      cell: (item) => (
        <StateBadge state={item.state} partial={item.isPartial} />
      ),
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      align: 'end',
      cell: (item) => <Money value={item.remaining} className="font-medium" />,
    },
    {
      key: 'action',
      header: <span className="sr-only">تسديد</span>,
      align: 'end',
      cell: (item) => <PayRowButton item={item} />,
    },
  ]

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        كل الاقساط غير المسددة من كل العقود السارية، الاقدم اولا.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={view}
          onValueChange={(next) => {
            setView(next as DuesView)
            setLimit(DUES_PAGE_ROWS)
          }}
          className="max-w-full"
        >
          <TabsList variant="segmented" aria-label="الاستحقاقات">
            {DUES_VIEWS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
                <span className="ms-1 text-xs text-muted tabular-nums">
                  {duesInView(dues, value, today).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          size="sm"
          aria-label="الجهة"
          className="w-[190px]"
          value={financierId}
          onValueChange={setFinancierId}
          options={[
            { value: 'all', label: 'كل الجهات' },
            ...store.financiers.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows.slice(0, limit)}
        rowKey={(item) => item.key}
        onRowClick={(item) => openContract(item.contract.id)}
        rowClassName={(item) =>
          item.state === 'overdue' ? 'bg-danger-soft' : undefined
        }
        empty={
          <EmptyState
            icon={<CheckCircle2 size={28} aria-hidden="true" />}
            title={
              view === 'overdue'
                ? 'لا توجد اقساط متاخرة.'
                : 'لا توجد اقساط هنا.'
            }
          />
        }
        className="rounded-xl border bg-bg"
      />
      {rows.length > limit && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLimit((current) => current + DUES_PAGE_ROWS)}
          >
            عرض المزيد ({rows.length - limit})
          </Button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-bg p-3 sm:p-4">
          <p className="text-sm font-medium">
            الاجمالي ({installmentsWords(rows.length)})
            {view === 'month' && (
              <span className="text-muted">
                {' '}
                · {monthLabel(monthKeyOf(today))}
              </span>
            )}
          </p>
          <p className="text-lg font-semibold">
            <Money value={sumDues(rows)} />
          </p>
        </div>
      )}
    </div>
  )
}

// ======================================================================================
// 4. «الجهات»
// ======================================================================================

function FinanciersTab() {
  const { store, openDialog, removeFinancier } = useMockup()
  const errorText = useErrorText()
  const [deleting, setDeleting] = useState<MockFinancier | null>(null)
  const [error, setError] = useState<string | null>(null)

  const columns: DataTableColumn<MockFinancier>[] = [
    {
      key: 'name',
      header: 'اسم الجهة',
      cell: (item) => (
        <span className="flex items-center gap-2">
          <Building2 size={14} aria-hidden="true" className="text-muted" />
          <span className="font-medium">{item.name}</span>
        </span>
      ),
    },
    {
      key: 'contracts',
      header: 'العقود السارية',
      align: 'center',
      cell: (item) => (
        <span className="tabular-nums">
          {financierStats(store, item.id).activeContracts}
        </span>
      ),
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      align: 'end',
      cell: (item) => (
        <Money value={financierStats(store, item.id).remaining} />
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">اجراءات</span>,
      align: 'end',
      cell: (item) => {
        const used = financierStats(store, item.id).contracts > 0
        return (
          <span className="inline-flex items-center gap-1">
            <IconButton
              size="sm"
              variant="ghost"
              label={`تعديل اسم ${item.name}`}
              icon={<Pencil size={15} aria-hidden="true" />}
              onClick={(event) => {
                event.stopPropagation()
                openDialog({ kind: 'financier', id: item.id })
              }}
            />
            <IconButton
              size="sm"
              variant="ghost"
              label={
                used ? `لا تحذف ${item.name}: عليها عقود` : `حذف ${item.name}`
              }
              title={used ? 'الجهة التي عليها عقود لا تحذف' : undefined}
              disabled={used}
              icon={
                <Trash2
                  size={15}
                  aria-hidden="true"
                  className={used ? undefined : 'text-danger'}
                />
              }
              onClick={(event) => {
                event.stopPropagation()
                setDeleting(item)
              }}
            />
          </span>
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          البنوك والوكلاء والجهات التي عليها عقود الاقساط. الجهة التي عليها عقود
          لا تحذف.
        </p>
        <Button
          variant="outline"
          size="sm"
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => openDialog({ kind: 'financier', id: null })}
        >
          اضافة جهة
        </Button>
      </div>
      {error && (
        <Notice tone="danger" size="compact" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      <DataTable
        columns={columns}
        rows={store.financiers}
        rowKey={(item) => item.id}
        onRowClick={(item) => openDialog({ kind: 'financier', id: item.id })}
        empty={<EmptyState title="لا توجد جهات بعد." />}
        className="rounded-xl border bg-bg"
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="حذف الجهة"
        description={deleting ? `تحذف «${deleting.name}» من قائمة الجهات.` : ''}
        confirmLabel="حذف"
        cancelLabel="تراجع"
        tone="danger"
        onConfirm={() => {
          if (!deleting) return
          const token = removeFinancier(deleting.id)
          setError(token ? errorText(token) : null)
          setDeleting(null)
        }}
      />
    </div>
  )
}

function FinancierDialog({
  financier,
  onClose,
  onSubmit,
}: {
  financier: MockFinancier | null
  onClose: () => void
  onSubmit: (name: string) => string | null
}) {
  const errorText = useErrorText()
  const [name, setName] = useState(financier?.name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)

  const submit = () => {
    if (!name.trim()) {
      setNameError('اكتب اسم الجهة.')
      return
    }
    const token = onSubmit(name)
    if (token) setNameError(errorText(token))
  }

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(next) => !next && onClose()}
      title={financier ? 'تعديل اسم الجهة' : 'اضافة جهة'}
      description="الاسم فقط: بنك، وكيل، او اي جهة عليها عقد."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button variant="primary" onClick={submit}>
            حفظ
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field label="اسم الجهة" required error={nameError}>
          {(control) => (
            <Input
              {...control}
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}

// ======================================================================================
// 5. The contract page
// ======================================================================================

type ScheduleView = 'open' | 'paid' | 'all'

const SCHEDULE_PREVIEW_ROWS = 12
const PAYMENTS_PREVIEW_ROWS = 10
const EVENTS_PREVIEW_ROWS = 20

const HISTORY_LABEL: Readonly<Record<HistoryKind, string>> = {
  created: 'انشاء العقد',
  payment_recorded: 'تسجيل سداد',
  payment_voided: 'الغاء سداد',
  paid_off: 'سداد كامل العقد',
  cancelled: 'الغاء العقد',
}

function ContractPage({
  contract,
  onBack,
}: {
  contract: MockContract
  onBack: () => void
}) {
  const { t } = useI18n()
  const { store, today, financierName, openDialog } = useMockup()
  const [view, setView] = useState<ScheduleView>(
    contract.status === 'paid_off' ? 'all' : 'open',
  )
  const [showAllRows, setShowAllRows] = useState(false)
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const financier = financierName(contract.financierId)
  const rows = contract.rows
  const summary = summaryOf(contract, today)
  const payments = store.payments
    .filter((item) => item.contractId === contract.id)
    .sort((a, b) =>
      a.paidOn === b.paidOn
        ? b.recordedSeq - a.recordedSeq
        : a.paidOn < b.paidOn
          ? 1
          : -1,
    )
  const locked = hasPostedPayment(store, contract.id)
  const events = historyOf(store, contract.id)
  const active = contract.status === 'active'
  const next = active ? summary.next : null

  const viewRows = rows
    .filter((row) =>
      view === 'all'
        ? true
        : view === 'paid'
          ? isRowPaid(row)
          : !isRowPaid(row),
    )
    .sort((a, b) => (sortDirection === 'asc' ? a.seq - b.seq : b.seq - a.seq))
  const shownRows = showAllRows
    ? viewRows
    : viewRows.slice(0, SCHEDULE_PREVIEW_ROWS)
  const shownPayments = showAllPayments
    ? payments
    : payments.slice(0, PAYMENTS_PREVIEW_ROWS)

  const none = <span className="text-muted">بدون</span>
  const facts: DescriptionListItem[] = [
    {
      key: 'financier',
      icon: <Building2 size={16} />,
      label: 'الجهة',
      value: financier,
    },
    {
      key: 'total',
      icon: <Banknote size={16} />,
      label: 'اجمالي المبلغ',
      value: <Money value={contract.terms.totalAmount} />,
    },
    {
      key: 'down',
      icon: <Wallet size={16} />,
      label: 'المقدم',
      value:
        contract.terms.downPayment > 0 ? (
          <Money value={contract.terms.downPayment} />
        ) : (
          none
        ),
    },
    {
      key: 'balloon',
      icon: <Coins size={16} />,
      label: 'الدفعة الاخيرة',
      value:
        contract.terms.balloonAmount > 0 ? (
          <Money value={contract.terms.balloonAmount} />
        ) : (
          none
        ),
    },
    {
      key: 'plan',
      icon: <Repeat size={16} />,
      label: 'الاقساط',
      value: `${installmentsWords(contract.terms.installmentCount)} · ${t(
        INSTALLMENT_FREQUENCY_LABEL_KEYS[
          contract.terms.frequencyMonths as InstallmentFrequency
        ],
      )}`,
    },
    {
      key: 'period',
      icon: <CalendarClock size={16} />,
      label: 'الفترة',
      value: (
        <PeriodRange from={contract.terms.firstDueDate} to={summary.lastDue} />
      ),
    },
    {
      key: 'units',
      icon: <Truck size={16} />,
      label: 'المعدات المرتبطة',
      value: <UnitTags contract={contract} max={contract.equipment.length} />,
    },
    {
      key: 'notes',
      icon: <StickyNote size={16} />,
      label: 'ملاحظات',
      value: contract.notes ? (
        <span className="whitespace-pre-wrap break-words">
          {contract.notes}
        </span>
      ) : (
        none
      ),
    },
    {
      key: 'by',
      icon: <User size={16} />,
      label: 'انشاه',
      value: contract.createdBy,
    },
    {
      key: 'at',
      icon: <Clock size={16} />,
      label: 'تاريخ الانشاء',
      value: formatDate(contract.createdOn),
      dir: 'ltr',
    },
    ...(contract.closedOn
      ? [
          {
            key: 'closed',
            icon: <Lock size={16} />,
            label:
              contract.status === 'cancelled'
                ? 'تاريخ الالغاء'
                : 'تاريخ السداد الكامل',
            value: formatDate(contract.closedOn),
            dir: 'ltr' as const,
          },
        ]
      : []),
  ]

  const payButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<Wallet size={14} aria-hidden="true" />}
      onClick={() => openDialog({ kind: 'pay', contractId: contract.id })}
    >
      تسجيل سداد
    </Button>
  )

  // Editing stays for a paid-off contract (title, financier, units, notes);
  // cancelling is for an active contract without a posted payment.
  const optionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          icon={<MoreHorizontal size={14} aria-hidden="true" />}
        >
          خيارات
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          icon={<Pencil size={14} />}
          onSelect={() => openDialog({ kind: 'contract', id: contract.id })}
        >
          تعديل العقد
        </DropdownMenuItem>
        {active && (
          <DropdownMenuItem
            icon={<Ban size={14} />}
            tone="danger"
            disabled={locked}
            onSelect={() =>
              openDialog({ kind: 'cancel', contractId: contract.id })
            }
          >
            {locked ? 'الغاء العقد (عليه سدادات)' : 'الغاء العقد'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const canEdit = contract.status !== 'cancelled'

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} label="الاقساط" />

      {/* 1. Header card: the number with its status, the title on its own
          line, the financier, the actions, then the summary strip. */}
      <div className="card space-y-4 p-4">
        <DetailHeader
          as="h2"
          identifier={contract.number}
          identifierLtr
          subtitle={
            <>
              <span className="block whitespace-normal break-words text-base font-semibold text-fg">
                {contract.description}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <Building2 size={14} aria-hidden="true" />
                {financier}
              </span>
            </>
          }
          badges={
            <span className="flex flex-wrap items-center gap-1">
              <ContractStatusBadge status={contract.status} />
              <OverdueBadge count={summary.overdueCount} />
            </span>
          }
          actions={
            <div className="hidden gap-2 sm:flex">
              {active && payButton}
              {canEdit && optionsMenu}
            </div>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="المبلغ المقسط"
            value={<Money value={summary.financed} />}
            hint={
              contract.terms.downPayment > 0 ? (
                <span>
                  بعد مقدم <Money value={contract.terms.downPayment} />
                </span>
              ) : undefined
            }
            icon={<Banknote size={18} />}
          />
          <StatCard
            label="المسدد"
            value={<Money value={summary.paid} />}
            hint={`${summary.paidCount} من ${installmentsWords(summary.rowCount)}`}
            icon={<CheckCircle2 size={18} />}
            accent="success"
          />
          <StatCard
            label="المتبقي"
            value={
              <Money
                value={contract.status === 'cancelled' ? 0 : summary.remaining}
              />
            }
            hint={
              summary.overdueAmount > 0 ? (
                <span className="text-danger">
                  منه متاخر <Money value={summary.overdueAmount} />
                </span>
              ) : undefined
            }
            icon={<Coins size={18} />}
          />
          <StatCard
            label="القسط القادم"
            value={next ? <Money value={rowRemaining(next)} /> : '—'}
            hint={
              next ? (
                <span className="flex flex-wrap items-center gap-1">
                  <bdi dir="ltr">{formatDate(next.dueDate)}</bdi>
                  <StateBadge
                    state={installmentState(
                      next.dueDate,
                      next.amount,
                      next.paidAmount,
                      today,
                    )}
                  />
                </span>
              ) : undefined
            }
            icon={<CalendarClock size={18} />}
          />
        </div>
        <PaidProgress summary={summary} />
      </div>

      {contract.status === 'paid_off' && (
        <Notice tone="success" size="compact" icon={<CheckCircle2 size={16} />}>
          سدد العقد كاملا
          {contract.closedOn && (
            <>
              {' '}
              في <bdi dir="ltr">{formatDate(contract.closedOn)}</bdi>
            </>
          )}
          .
        </Notice>
      )}
      {contract.status === 'cancelled' && (
        <Notice
          tone="neutral"
          size="compact"
          icon={<Ban size={16} />}
          title="العقد ملغي"
        >
          {contract.cancelReason}
        </Notice>
      )}
      {summary.overdueCount > 0 && (
        <Notice
          tone="danger"
          size="compact"
          icon={<AlertTriangle size={16} />}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openDialog({
                  kind: 'pay',
                  contractId: contract.id,
                  amount: summary.overdueAmount,
                })
              }
            >
              سداد المتاخر
            </Button>
          }
        >
          المتاخر على العقد: {installmentsWords(summary.overdueCount)} بمبلغ{' '}
          <Money value={summary.overdueAmount} className="font-semibold" />
        </Notice>
      )}

      {/* 2. Body: the facts above the records below xl; from xl the records
          span two columns beside the facts and the history. */}
      <div className="grid gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-1">
          <SectionHeader title="بيانات العقد" />
          <DescriptionList items={facts} className="-my-2" />
        </Card>

        <div className="min-w-0 space-y-4 xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          {/* The schedule: wide cards, the amount in a fixed end block. */}
          <Card padded={false} className="flex min-w-0 flex-col">
            <div className="space-y-3 p-4 pb-0">
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    جدول الاقساط
                    <Badge size="sm">{rows.length}</Badge>
                  </span>
                }
                description="يتولد من شروط العقد ولا يكتب يدويا."
                action={
                  <div className="flex items-center gap-1.5">
                    <Tabs
                      value={view}
                      onValueChange={(nextView) => {
                        setView(nextView as ScheduleView)
                        setShowAllRows(false)
                      }}
                    >
                      <TabsList variant="segmented" aria-label="جدول الاقساط">
                        <TabsTrigger value="open">غير المسدد</TabsTrigger>
                        <TabsTrigger value="paid">مسدد</TabsTrigger>
                        <TabsTrigger value="all">الكل</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <IconButton
                      size="sm"
                      variant="outline"
                      label={
                        sortDirection === 'asc'
                          ? 'ترتيب تنازلي'
                          : 'ترتيب تصاعدي'
                      }
                      icon={
                        sortDirection === 'asc' ? (
                          <ArrowUp size={14} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={14} aria-hidden="true" />
                        )
                      }
                      onClick={() =>
                        setSortDirection((current) =>
                          current === 'asc' ? 'desc' : 'asc',
                        )
                      }
                    />
                  </div>
                }
              />
            </div>
            {shownRows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={
                    view === 'open'
                      ? 'كل الاقساط مسددة.'
                      : 'لم يسدد اي قسط بعد.'
                  }
                  className="p-6"
                />
              </div>
            ) : (
              <ul className="space-y-2 p-4 pt-3">
                {shownRows.map((row) => {
                  const rowState =
                    contract.status === 'cancelled'
                      ? null
                      : installmentState(
                          row.dueDate,
                          row.amount,
                          row.paidAmount,
                          today,
                        )
                  const remaining = rowRemaining(row)
                  const partial = row.paidAmount > 0 && !isRowPaid(row)
                  return (
                    <li
                      key={row.seq}
                      className={cn(
                        'rounded-xl border bg-bg p-3 sm:p-4',
                        rowState === 'overdue' && 'border-[var(--danger)]',
                      )}
                    >
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:flex-nowrap">
                        <div className="min-w-0 flex-1 sm:basis-2/5">
                          <p className="font-semibold">
                            القسط {row.seq} من {rows.length}
                          </p>
                          {row.isBalloon && (
                            <Badge size="sm" tone="info" className="mt-1">
                              دفعة اخيرة
                            </Badge>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1 sm:basis-3/5">
                          <p className="flex items-center gap-1.5 text-sm">
                            <Calendar
                              size={14}
                              aria-hidden="true"
                              className="shrink-0 text-muted"
                            />
                            <bdi dir="ltr">{formatDate(row.dueDate)}</bdi>
                            {rowState === 'overdue' && (
                              <span className="text-xs text-danger">
                                {whenWords(
                                  Math.round(
                                    (Date.parse(`${row.dueDate}T00:00:00Z`) -
                                      Date.parse(`${today}T00:00:00Z`)) /
                                      86_400_000,
                                  ),
                                )}
                              </span>
                            )}
                          </p>
                          {rowState && (
                            <StateBadge state={rowState} partial={partial} />
                          )}
                        </div>
                        <div className="flex w-full items-center justify-between gap-3 border-t pt-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                          <div className="text-start sm:text-end">
                            <p className="text-xs text-muted">المبلغ</p>
                            <p className="text-lg font-semibold">
                              <Money value={row.amount} />
                            </p>
                            {partial && (
                              <p className="text-xs text-muted">
                                المتبقي <Money value={remaining} />
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
                {viewRows.length > SCHEDULE_PREVIEW_ROWS && (
                  <li className="flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllRows((current) => !current)}
                    >
                      {showAllRows
                        ? 'عرض اقل'
                        : `عرض الكل (${viewRows.length})`}
                    </Button>
                  </li>
                )}
                {/* The total closes the list in the same end block. */}
                <li className="rounded-xl border bg-surface p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                    <p className="text-sm font-medium">المبلغ المقسط</p>
                    <p className="text-lg font-semibold sm:w-44 sm:shrink-0 sm:text-end">
                      <Money value={summary.financed} />
                    </p>
                  </div>
                </li>
              </ul>
            )}
          </Card>

          {/* Payments: the latest ten, voided ones kept and struck out. */}
          <Card padded={false}>
            <div className="p-4 pb-0">
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    السدادات
                    <Badge size="sm">{payments.length}</Badge>
                  </span>
                }
                description="كل سداد ينزل على اقدم قسط غير مسدد. السداد الخاطئ يلغى ولا يحذف."
                action={active ? payButton : undefined}
              />
            </div>
            {payments.length === 0 ? (
              <div className="p-4">
                <EmptyState title="لا توجد سدادات بعد." className="p-6" />
              </div>
            ) : (
              <ul className="space-y-2 p-4 pt-3">
                {shownPayments.map((payment) => (
                  <PaymentCard
                    key={payment.id}
                    payment={payment}
                    canVoid={contract.status !== 'cancelled'}
                    onVoid={() =>
                      openDialog({ kind: 'void', paymentId: payment.id })
                    }
                  />
                ))}
                {payments.length > PAYMENTS_PREVIEW_ROWS && (
                  <li className="flex justify-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllPayments((current) => !current)}
                    >
                      {showAllPayments
                        ? 'عرض اقل'
                        : `كل السدادات (${payments.length})`}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </Card>
        </div>

        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-2">
          <SectionHeader title="سجل العقد" description="الاحدث اولا." />
          <ol className="space-y-3">
            {events.slice(0, EVENTS_PREVIEW_ROWS).map((event) => (
              <li key={event.key} className="relative flex gap-3 ps-1">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      event.kind === 'payment_voided' ||
                      event.kind === 'cancelled'
                        ? 'var(--danger)'
                        : event.kind === 'paid_off'
                          ? 'var(--success)'
                          : 'var(--muted)',
                  }}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">
                    {HISTORY_LABEL[event.kind]}
                    {event.amount !== null && (
                      <>
                        {' · '}
                        <Money value={event.amount} />
                      </>
                    )}
                  </p>
                  {event.detail && (
                    <p className="break-words text-xs text-muted">
                      {event.detail}
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    {event.by}
                    {event.on && (
                      <>
                        {' · '}
                        <bdi dir="ltr">{formatDate(event.on)}</bdi>
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {events.length > EVENTS_PREVIEW_ROWS && (
            <p className="text-xs text-muted">
              يظهر اخر {EVENTS_PREVIEW_ROWS} حدثا من {events.length}.
            </p>
          )}
        </Card>
      </div>

      {/* 3. Mobile action bar (fixed to the viewport in the real page). */}
      {canEdit && (
        <div
          className="sticky bottom-0 z-10 -mx-3 -mb-3 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
        >
          {active && (
            <Button
              variant="primary"
              className="h-11 flex-1"
              icon={<Wallet size={16} aria-hidden="true" />}
              onClick={() =>
                openDialog({ kind: 'pay', contractId: contract.id })
              }
            >
              تسجيل سداد
            </Button>
          )}
          {optionsMenu}
        </div>
      )}
    </div>
  )
}

function PaymentCard({
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
  const seqs = payment.allocations.map((item) => item.seq)
  return (
    <li
      className={cn(
        'rounded-xl border bg-bg p-3 sm:p-4',
        voided && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:flex-nowrap">
        <div className="min-w-0 flex-1 sm:basis-2/5">
          <p className="flex items-center gap-1.5 font-semibold">
            <bdi dir="ltr">{formatDate(payment.paidOn)}</bdi>
            {voided && <Badge tone="neutral">ملغي</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
            {payment.reference ? (
              <>
                {' · '}
                <bdi dir="ltr">{payment.reference}</bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-1 text-xs text-muted sm:basis-3/5">
          {seqs.length > 0 && (
            <p>
              {seqs.length === 1 ? 'غطى القسط' : 'غطى الاقساط'}{' '}
              {seqs.length > 3
                ? `${seqs[0]}–${seqs[seqs.length - 1]}`
                : seqs.join('، ')}
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <User size={12} aria-hidden="true" />
            {payment.by}
          </p>
          {payment.note && <p className="break-words">{payment.note}</p>}
          {voided && payment.voidReason && (
            <p className="break-words text-danger">
              سبب الالغاء: {payment.voidReason}
              {payment.voidedBy && <> · {payment.voidedBy}</>}
            </p>
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-3 border-t pt-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
          <p className={cn('text-lg font-semibold', voided && 'line-through')}>
            <Money value={payment.amount} />
          </p>
          {!voided && canVoid && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Ban size={14} aria-hidden="true" />}
              onClick={onVoid}
            >
              الغاء السداد
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

// ======================================================================================
// 6. Contract and payment dialogs
// ======================================================================================

/** Parses a typed amount: digits with an optional dot and up to two decimals. */
function parseAmount(value: string): number | null {
  const text = value.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Number(text)
}

function AmountHint({ value }: { value: string }) {
  const amount = parseAmount(value)
  if (amount === null || amount === 0) return null
  return <Money value={amount} className="font-semibold text-fg" />
}

function OptionalLabel({ text }: { text: string }) {
  return (
    <span>
      {text} <span className="text-xs font-normal text-muted">(اختياري)</span>
    </span>
  )
}

const AMOUNT_FORMAT_ERROR = 'اكتب المبلغ بالارقام، وبحد اقصى منزلتين عشريتين.'

/** Which form field a store token belongs to. */
const CONTRACT_FIELD: Readonly<Record<string, string>> = {
  invalid_description: 'description',
  invalid_financier: 'financier',
  invalid_amount: 'total',
  invalid_down_payment: 'down',
  invalid_balloon: 'balloon',
  invalid_installment_count: 'count',
  invalid_frequency: 'frequency',
  invalid_first_due_date: 'firstDue',
  invalid_notes: 'notes',
  invalid_equipment: 'equipment',
}

function ContractDialog({
  contract,
  onClose,
  onSubmit,
}: {
  contract: MockContract | null
  onClose: () => void
  onSubmit: (draft: ContractDraft) => string | null
}) {
  const { t } = useI18n()
  const { store, today } = useMockup()
  const errorText = useErrorText()
  // A posted payment locks the money terms (`contract_has_payments`).
  const locked = !!contract && hasPostedPayment(store, contract.id)

  const money = (value: number | undefined) =>
    value === undefined ? '' : String(value)
  const [description, setDescription] = useState(contract?.description ?? '')
  const [financierId, setFinancierId] = useState(contract?.financierId ?? '')
  const [firstDue, setFirstDue] = useState(
    contract?.terms.firstDueDate ?? addMonths(today, 1),
  )
  const [total, setTotal] = useState(money(contract?.terms.totalAmount))
  const [down, setDown] = useState(money(contract?.terms.downPayment ?? 0))
  const [balloon, setBalloon] = useState(
    money(contract?.terms.balloonAmount ?? 0),
  )
  const [count, setCount] = useState(
    contract ? String(contract.terms.installmentCount) : '12',
  )
  const [frequency, setFrequency] = useState(
    String(contract?.terms.frequencyMonths ?? 1),
  )
  const [equipment, setEquipment] = useState<string[]>(
    contract?.equipment ?? [],
  )
  const [notes, setNotes] = useState(contract?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const terms: InstallmentTerms = {
    totalAmount: parseAmount(total) ?? 0,
    downPayment: parseAmount(down) ?? 0,
    balloonAmount: parseAmount(balloon) ?? 0,
    installmentCount: Number(count),
    frequencyMonths: Number(frequency),
    firstDueDate: firstDue,
  }
  const preview = buildSchedule(terms)
  const termsError = total ? checkInstallmentTerms(terms) : null
  const regular = preview.find((row) => !row.isBalloon)

  const clear = (key: string) =>
    setErrors((current) => ({ ...current, [key]: '' }))

  const submit = () => {
    const next: Record<string, string> = {}
    if (!description.trim()) next.description = 'اكتب عنوان العقد.'
    if (!financierId) next.financier = 'اختر الجهة.'
    for (const [key, value] of [
      ['total', total],
      ['down', down],
      ['balloon', balloon],
    ] as const) {
      if (value.trim() && parseAmount(value) === null)
        next[key] = AMOUNT_FORMAT_ERROR
    }
    if (!total.trim()) next.total = 'اكتب اجمالي المبلغ.'
    if (Object.keys(next).length === 0 && !locked) {
      const token = checkInstallmentTerms(terms)
      if (token) next[CONTRACT_FIELD[token] ?? 'form'] = errorText(token)
    }
    setErrors(next)
    setFormError(next.form ?? null)
    if (Object.keys(next).length > 0) return

    const token = onSubmit({
      description,
      financierId,
      // The locked terms go back exactly as they are stored.
      terms: locked && contract ? contract.terms : terms,
      notes,
      equipment,
    })
    if (token) {
      const field = CONTRACT_FIELD[token]
      if (field) setErrors({ [field]: errorText(token) })
      else setFormError(errorText(token))
    }
  }

  const amountField = (
    key: 'total' | 'down' | 'balloon',
    label: ReactNode,
    value: string,
    setValue: (value: string) => void,
    hint?: ReactNode,
  ) => (
    <Field
      label={label}
      required={key === 'total'}
      error={errors[key]}
      hint={
        hint ? (
          <span className="flex flex-col gap-0.5">
            <AmountHint value={value} />
            <span>{hint}</span>
          </span>
        ) : (
          <AmountHint value={value} />
        )
      }
    >
      {(control) => (
        <Input
          {...control}
          dir="ltr"
          inputMode="decimal"
          disabled={locked}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            clear(key)
          }}
        />
      )}
    </Field>
  )

  return (
    <Dialog
      open
      size="lg"
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
      description="جدول الاقساط يتولد من هذه الشروط عند الحفظ."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button variant="primary" onClick={submit}>
            {contract ? 'حفظ' : 'انشاء العقد'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {locked && (
          <Notice tone="info" size="compact" icon={<Lock size={16} />}>
            على العقد سدادات مسجلة: المبالغ وعدد الاقساط والتواريخ مقفلة. يتعدل
            العنوان والجهة والمعدات المرتبطة والملاحظات.
          </Notice>
        )}
        {formError && <Notice tone="danger">{formError}</Notice>}

        <section className="grid gap-4 sm:grid-cols-3">
          <Field
            label="عنوان العقد"
            required
            error={errors.description}
            hint="اي عنوان تختاره: معدة، سيارات، ارض، او غيرها."
            className="sm:col-span-2"
          >
            {(control) => (
              <Input
                {...control}
                maxLength={200}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  clear('description')
                }}
              />
            )}
          </Field>
          <Field label="الجهة" required error={errors.financier}>
            {(control) => (
              <Select
                {...control}
                placeholder="اختر الجهة"
                value={financierId}
                onValueChange={(value) => {
                  setFinancierId(value)
                  clear('financier')
                }}
                options={store.financiers.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            )}
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">المبالغ والاقساط</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {amountField('total', 'اجمالي المبلغ', total, setTotal)}
            {amountField(
              'down',
              <OptionalLabel text="المقدم" />,
              down,
              setDown,
              'يدفع عند العقد ولا يدخل في الاقساط.',
            )}
            {amountField(
              'balloon',
              <OptionalLabel text="الدفعة الاخيرة" />,
              balloon,
              setBalloon,
              'دفعة اكبر في اخر العقد، 0 اذا لا يوجد.',
            )}
            <Field label="عدد الاقساط" required error={errors.count}>
              {(control) => (
                <Input
                  {...control}
                  dir="ltr"
                  inputMode="numeric"
                  disabled={locked}
                  value={count}
                  onChange={(event) => {
                    setCount(event.target.value.replace(/\D/g, ''))
                    clear('count')
                  }}
                />
              )}
            </Field>
            <Field label="الاستحقاق" required error={errors.frequency}>
              {(control) => (
                <Select
                  {...control}
                  disabled={locked}
                  value={frequency}
                  onValueChange={setFrequency}
                  options={INSTALLMENT_FREQUENCIES.map((months) => ({
                    value: String(months),
                    label: t(INSTALLMENT_FREQUENCY_LABEL_KEYS[months]),
                  }))}
                />
              )}
            </Field>
            <Field label="تاريخ اول قسط" required error={errors.firstDue}>
              {(control) => (
                <DatePicker
                  {...control}
                  disabled={locked}
                  value={firstDue}
                  onChange={(value) => {
                    setFirstDue(value)
                    clear('firstDue')
                  }}
                />
              )}
            </Field>
          </div>
        </section>

        {/* The live preview: what generate_installment_schedule will build. */}
        <section className="space-y-2 rounded-xl border bg-surface p-3 sm:p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Receipt size={16} aria-hidden="true" />
            معاينة جدول الاقساط
          </h3>
          {!total || termsError || preview.length === 0 ? (
            <p className="text-sm text-muted">
              {termsError
                ? errorText(termsError)
                : 'اكتب اجمالي المبلغ وعدد الاقساط لتظهر المعاينة.'}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                <Money value={terms.totalAmount} />
                {terms.downPayment > 0 && (
                  <>
                    − <Money value={terms.downPayment} />
                  </>
                )}
                {' = '}
                <span className="font-semibold text-fg">
                  المبلغ المقسط <Money value={financedAmount(terms)} />
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <PreviewStat
                  label={`القسط (${t(
                    INSTALLMENT_FREQUENCY_LABEL_KEYS[
                      terms.frequencyMonths as InstallmentFrequency
                    ],
                  )})`}
                  value={<Money value={regular?.amount} />}
                />
                <PreviewStat
                  label="الفترة"
                  value={
                    <PeriodRange
                      from={preview[0].dueDate}
                      to={preview[preview.length - 1].dueDate}
                    />
                  }
                />
                {terms.balloonAmount > 0 && (
                  <PreviewStat
                    label="الدفعة الاخيرة"
                    value={<Money value={terms.balloonAmount} />}
                  />
                )}
              </div>
              <ol className="divide-y rounded-lg border bg-bg text-sm">
                {(preview.length > 6
                  ? [...preview.slice(0, 3), null, ...preview.slice(-2)]
                  : preview
                ).map((row, index) =>
                  row === null ? (
                    <li
                      key={`gap-${index}`}
                      className="px-3 py-1 text-center text-xs text-muted"
                    >
                      … {preview.length - 5} اخرى
                    </li>
                  ) : (
                    <li
                      key={row.seq}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-muted">
                          {row.seq}
                        </span>
                        <bdi dir="ltr">{formatDate(row.dueDate)}</bdi>
                        {row.isBalloon && (
                          <Badge size="sm" tone="info">
                            دفعة اخيرة
                          </Badge>
                        )}
                      </span>
                      <Money value={row.amount} />
                    </li>
                  ),
                )}
              </ol>
            </>
          )}
        </section>

        {/* The optional link: a contract may be tied to no unit at all. */}
        <Field
          label={<OptionalLabel text="المعدات المرتبطة" />}
          error={errors.equipment}
          hint="اربط العقد بمعدة او اكثر من معدات البرنامج، او اتركه بدون ربط."
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

        <Field label={<OptionalLabel text="ملاحظات" />} error={errors.notes}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)
                clear('notes')
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

function PreviewStat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-bg p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

function PaymentDialog({
  initialContractId,
  initialAmount,
  onClose,
  onSubmit,
}: {
  initialContractId: string | null
  initialAmount?: number
  onClose: () => void
  onSubmit: (contractId: string, draft: PaymentDraft) => string | null
}) {
  const { t } = useI18n()
  const { store, today, financierName } = useMockup()
  const errorText = useErrorText()
  const activeContracts = store.contracts.filter(
    (item) => item.status === 'active',
  )
  const [contractId, setContractId] = useState(initialContractId ?? '')
  const contract =
    store.contracts.find((item) => item.id === contractId) ?? null
  const summary = contract ? summaryOf(contract, today) : null

  const defaultAmount = (target: MockContract | null) => {
    const next = target ? summaryOf(target, today).next : null
    return next ? String(rowRemaining(next)) : ''
  }
  const [amount, setAmount] = useState(
    initialAmount !== undefined
      ? String(initialAmount)
      : defaultAmount(contract),
  )
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState<InstallmentPaymentMethod>('transfer')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const parsed = parseAmount(amount)
  const allocations =
    contract && parsed
      ? allocatePayment(
          contract.rows.map((row) => ({ id: String(row.seq), ...row })),
          parsed,
        )
      : null
  const rowOf = new Map(contract?.rows.map((row) => [String(row.seq), row]))

  const quick: { label: string; value: number }[] = summary
    ? [
        ...(summary.next
          ? [
              {
                label: 'القسط القادم',
                value: rowRemaining(summary.next),
              },
            ]
          : []),
        ...(summary.overdueAmount > 0
          ? [{ label: 'كل المتاخر', value: summary.overdueAmount }]
          : []),
        { label: 'كامل المتبقي', value: summary.remaining },
      ]
    : []

  const submit = () => {
    const next: Record<string, string> = {}
    if (!contract) next.contract = 'اختر العقد.'
    if (parsed === null || parsed <= 0)
      next.amount = errorText('invalid_payment_amount')
    setErrors(next)
    setFormError(null)
    if (!contract || parsed === null || Object.keys(next).length > 0) return
    const token = onSubmit(contract.id, {
      paidOn,
      amount: parsed,
      method,
      reference,
      note,
    })
    if (!token) return
    if (
      token === 'payment_exceeds_balance' ||
      token === 'invalid_payment_amount'
    )
      setErrors({ amount: errorText(token) })
    else if (token === 'invalid_paid_on')
      setErrors({ paidOn: errorText(token) })
    else if (token === 'invalid_reference')
      setErrors({ reference: errorText(token) })
    else setFormError(errorText(token))
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="تسجيل سداد"
      description={
        contract ? (
          <span>
            <bdi dir="ltr">{contract.number}</bdi> · {contract.description} ·{' '}
            {financierName(contract.financierId)}
          </span>
        ) : (
          'اختر العقد ثم المبلغ كما استلمته الجهة.'
        )
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            الغاء
          </Button>
          <Button variant="primary" onClick={submit}>
            حفظ السداد
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        {initialContractId === null && (
          <Field label="العقد" required error={errors.contract}>
            {(control) => (
              <Select
                {...control}
                placeholder="اختر العقد"
                value={contractId}
                onValueChange={(value) => {
                  setContractId(value)
                  setAmount(
                    defaultAmount(
                      store.contracts.find((item) => item.id === value) ?? null,
                    ),
                  )
                  setErrors({})
                }}
                options={activeContracts.map((item) => ({
                  value: item.id,
                  label: `${item.description} · ${item.number}`,
                }))}
              />
            )}
          </Field>
        )}
        {summary && (
          <div className="grid grid-cols-2 gap-2">
            <PreviewStat
              label="المتبقي"
              value={<Money value={summary.remaining} />}
            />
            <PreviewStat
              label="المتاخر"
              value={
                <Money
                  value={summary.overdueAmount}
                  className={
                    summary.overdueAmount > 0 ? 'text-danger' : undefined
                  }
                />
              }
            />
          </div>
        )}
        <Field
          label="مبلغ السداد"
          required
          error={errors.amount}
          hint={<AmountHint value={amount} />}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setErrors((current) => ({ ...current, amount: '' }))
              }}
            />
          )}
        </Field>
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((item) => (
              <Button
                key={item.label}
                size="sm"
                variant="outline"
                onClick={() => {
                  setAmount(String(item.value))
                  setErrors((current) => ({ ...current, amount: '' }))
                }}
              >
                {item.label} <Money value={item.value} />
              </Button>
            ))}
          </div>
        )}
        {/* Which installments the amount covers, the oldest first. */}
        {allocations && allocations.length > 0 && (
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <p className="mb-1 font-medium">يوزع على:</p>
            <ul className="space-y-0.5 text-muted">
              {allocations.slice(0, 6).map((item) => {
                const row = rowOf.get(item.id)
                const full =
                  row && toHalalas(item.amount) === toHalalas(rowRemaining(row))
                return (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      القسط {row?.seq} ·{' '}
                      <bdi dir="ltr">{row ? formatDate(row.dueDate) : ''}</bdi>
                      {full ? '' : ' · مسدد جزئيا'}
                    </span>
                    <Money value={item.amount} />
                  </li>
                )
              })}
              {allocations.length > 6 && (
                <li>… {allocations.length - 6} اخرى</li>
              )}
            </ul>
          </div>
        )}
        {contract && parsed !== null && parsed > 0 && allocations === null && (
          <p className="text-xs text-danger">
            {errorText('payment_exceeds_balance')}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاريخ السداد" required error={errors.paidOn}>
            {(control) => (
              <DatePicker
                {...control}
                value={paidOn}
                max={today}
                onChange={(value) => {
                  setPaidOn(value)
                  setErrors((current) => ({ ...current, paidOn: '' }))
                }}
              />
            )}
          </Field>
          <Field label="طريقة السداد" required>
            {(control) => (
              <Select
                {...control}
                value={method}
                onValueChange={(value) =>
                  setMethod(value as InstallmentPaymentMethod)
                }
                options={INSTALLMENT_PAYMENT_METHODS.map((value) => ({
                  value,
                  label: t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[value]),
                }))}
              />
            )}
          </Field>
        </div>
        <Field
          label={<OptionalLabel text="المرجع" />}
          error={errors.reference}
          hint="رقم الحوالة او الشيك."
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>
        <Field label={<OptionalLabel text="ملاحظة" />}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/** The void-payment and cancel-contract dialogs: what is affected, then a
 *  required reason. */
function ReasonDialog({
  title,
  description,
  summary,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string
  description: string
  summary: ReactNode
  confirmLabel: string
  onClose: () => void
  onSubmit: (reason: string) => string | null
}) {
  const errorText = useErrorText()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const submit = () => {
    if (!reason.trim()) {
      setError('اكتب السبب.')
      return
    }
    const token = onSubmit(reason)
    if (token === 'reason_required') setError(errorText(token))
    else if (token) setFormError(errorText(token))
  }
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button variant="danger" onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="rounded-lg border bg-surface p-3 text-sm">
          {summary}
        </div>
        <Field label="السبب" required error={error}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

function VoidPaymentDialog({
  payment,
  onClose,
  onSubmit,
}: {
  payment: MockPayment | null
  onClose: () => void
  onSubmit: (reason: string) => string | null
}) {
  const { t } = useI18n()
  const { store } = useMockup()
  if (!payment) return null
  const contract = store.contracts.find(
    (item) => item.id === payment.contractId,
  )
  return (
    <ReasonDialog
      title="الغاء سداد"
      description="يرجع المبلغ على الاقساط التي غطاها، ويبقى السداد في السجل ملغيا."
      confirmLabel="الغاء السداد"
      onClose={onClose}
      onSubmit={onSubmit}
      summary={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <bdi dir="ltr">{contract?.number}</bdi> ·{' '}
            <bdi dir="ltr">{formatDate(payment.paidOn)}</bdi> ·{' '}
            {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
          </span>
          <Money value={payment.amount} className="font-semibold" />
        </span>
      }
    />
  )
}

function CancelContractDialog({
  contract,
  onClose,
  onSubmit,
}: {
  contract: MockContract | null
  onClose: () => void
  onSubmit: (reason: string) => string | null
}) {
  if (!contract) return null
  return (
    <ReasonDialog
      title="الغاء العقد"
      description="للعقد المدخل بالخطا فقط. لا يلغى عقد عليه سدادات، والعقد الملغي يبقى في القائمة."
      confirmLabel="الغاء العقد"
      onClose={onClose}
      onSubmit={onSubmit}
      summary={
        <span className="flex flex-col gap-1">
          <span className="font-semibold">{contract.description}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <bdi dir="ltr">{contract.number}</bdi>
            {contract.equipment.length > 0 && <UnitTags contract={contract} />}
          </span>
        </span>
      }
    />
  )
}
