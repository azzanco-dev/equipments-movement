import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Filter,
  Lock,
} from 'lucide-react'
import {
  AppLink,
  Badge,
  Button,
  Card,
  DataTable,
  DateRangeFilter,
  Dialog,
  Field,
  IconButton,
  MiniTable,
  MultiSelect,
  PageHeader,
  SearchInput,
  SectionHeader,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type BadgeTone,
  type DataTableColumn,
  type DataTableSort,
  type DateRangeValue,
} from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { saudiDateKey, saudiMonthKeys } from '@/lib/saudiTime'
import {
  ACTIVITY_NOW,
  ACTIVITY_ROWS,
  ACTORS,
  CARD_UNIT,
  EQUIPMENT_FIELDS,
  cardUnitChanges,
  type ActivityAction,
  type ActivityChange,
  type ActivityKind,
  type ActivityRow,
} from './activityMockupData'

// Owner 2026-11-02: a unit (A028) was set to «مباعة» the day before and nobody
// could tell who did it. «خلنا نسوي سجل تعديلات المعدات، يكون ضمن النشاط،
// وصفحة النشاط يبغالها اعادة بناء برضه». This is the rebuilt activity page as
// a mockup: ONE list over both audit logs — the movements (create / update /
// delete, driver changes) and the equipment changes of migration 0168 with
// their field-level before / after — in the approved main-list table look,
// with a toolbar (search, the kind switch, the filter dialog, the sort), an
// expandable row with every changed field, a card layout on phones, and the
// small «سجل التعديلات» card as it would sit on the equipment page. Sample
// data only; nothing here reads or writes Supabase.

const PAGE_SIZE = 10
const CHIPS_SHOWN = 3
/** The review's today, for the date filter's month presets. */
const TODAY = saudiDateKey(new Date(ACTIVITY_NOW))
const SYSTEM_ACTOR = '__system__'
// The mockup is Arabic whatever the app's interface language (the /ui-kit page
// is rtl / ar); the real screen follows useI18n().
const MOCKUP_LANG = 'ar' as const

type KindFilter = 'all' | ActivityKind
type ActionFilter = 'all' | ActivityAction

const KIND_LABEL: Record<ActivityKind, string> = {
  movement: 'حركة',
  equipment: 'معدة',
}

const KIND_TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'movement', label: 'الحركات' },
  { id: 'equipment', label: 'المعدات' },
]

const ACTION_LABEL: Record<ActivityAction, string> = {
  create: 'اضافة',
  update: 'تعديل',
  delete: 'حذف',
}

// Green for a creation, neutral for an edit, red only for a deletion
// (AGENTS.md: red is for errors and destructive actions).
const ACTION_TONE: Record<ActivityAction, BadgeTone> = {
  create: 'success',
  update: 'neutral',
  delete: 'danger',
}

const ACTION_OPTIONS: { value: ActionFilter; label: string }[] = [
  { value: 'all', label: 'كل الاجراءات' },
  { value: 'create', label: ACTION_LABEL.create },
  { value: 'update', label: ACTION_LABEL.update },
  { value: 'delete', label: ACTION_LABEL.delete },
]

const SORT_OPTIONS = [
  { value: 'at', label: 'الوقت' },
  { value: 'code', label: 'رقم المعدة' },
]

const ACTOR_OPTIONS = [
  ...ACTORS.map((name) => ({ value: name, label: name })),
  {
    value: SYSTEM_ACTOR,
    label: 'النظام',
    description: 'بدون مستخدم: ترحيل او خدمة',
  },
]

const FIELD_OPTIONS = EQUIPMENT_FIELDS.map((field) => ({
  value: field.key,
  label: field.label,
}))

/** The Arabic count of changed fields for the identity line. */
function fieldsCount(count: number): string {
  if (count === 1) return 'حقل واحد'
  if (count === 2) return 'حقلان'
  if (count <= 10) return `${count} حقول`
  return `${count} حقلا`
}

function movementLine(row: ActivityRow): string {
  if (!row.movement) return ''
  const type = row.movement.type === 'entry' ? 'دخول' : 'خروج'
  const context = row.movement.context === 'site' ? 'مشروع' : 'الورشة'
  return `${type} · ${context}`
}

/** The muted line under the code: the movement, or what changed on the unit. */
function recordLine(row: ActivityRow): string {
  if (row.kind === 'movement') return movementLine(row)
  if (row.action === 'create') return 'معدة جديدة'
  if (row.action === 'delete') return 'حذفت المعدة'
  return fieldsCount(row.changes.length)
}

function actorLabel(actor: string | null): string {
  return actor ?? 'النظام'
}

/** A stored value as the reader sees it: a timestamp in the Saudi format,
 *  an empty value as a dash. */
function displayValue(value: string | null): string {
  if (value === null || value === '') return '—'
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value)
  return value
}

function sinceWords(at: string, lang: 'ar' | 'en'): string {
  const words = elapsedInWords(at, lang, ACTIVITY_NOW)
  if (!words) return ''
  return lang === 'ar' ? `منذ ${words}` : `${words} ago`
}

/** «الحالة: نشطة ← مباعة» — the arrow points at the new value in the
 *  reading direction; a creation shows the value alone, a deletion the old
 *  value alone. */
function Chip({ change, lang }: { change: ActivityChange; lang: 'ar' | 'en' }) {
  const arrow = lang === 'ar' ? '←' : '→'
  const hasBefore = change.before !== null
  const hasAfter = change.after !== null
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-xs leading-4">
      <span className="text-muted">{change.label}:</span>
      {hasBefore && (
        <span className={cn('truncate', hasAfter && 'text-muted')} dir="auto">
          {displayValue(change.before)}
        </span>
      )}
      {hasBefore && hasAfter && (
        <span aria-hidden="true" className="text-muted">
          {arrow}
        </span>
      )}
      {hasAfter && (
        <span className="truncate font-medium" dir="auto">
          {displayValue(change.after)}
        </span>
      )}
    </span>
  )
}

function Chips({
  changes,
  lang,
  max = CHIPS_SHOWN,
}: {
  changes: ActivityChange[]
  lang: 'ar' | 'en'
  max?: number
}) {
  const shown = changes.slice(0, max)
  const rest = changes.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((change) => (
        <Chip key={change.key} change={change} lang={lang} />
      ))}
      {rest > 0 && (
        <span className="rounded-md border px-1.5 py-0.5 text-xs leading-4 text-muted">
          +{rest}
        </span>
      )}
    </span>
  )
}

function TimeCell({ at, lang }: { at: string; lang: 'ar' | 'en' }) {
  return (
    <span className="flex flex-col">
      <span className="tabular-nums">{formatDateTime(at)}</span>
      <span className="text-xs text-muted">{sinceWords(at, lang)}</span>
    </span>
  )
}

function KindCell({ row }: { row: ActivityRow }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge size="sm" tone={ACTION_TONE[row.action]}>
        {KIND_LABEL[row.kind]}
      </Badge>
      <span className="text-xs text-muted">{ACTION_LABEL[row.action]}</span>
    </span>
  )
}

/** The identity cell: the code in bold as a real link to the movement or the
 *  unit, the movement or the field count under it. */
function RecordCell({ row }: { row: ActivityRow }) {
  return (
    <span className="flex flex-col">
      <AppLink
        href={row.href}
        className="w-fit font-semibold hover:underline"
        dir="ltr"
      >
        {row.equipmentCode}
      </AppLink>
      <span className="text-xs text-muted">{recordLine(row)}</span>
    </span>
  )
}

/** Every changed field, before and after, under the expanded row and in the
 *  phone card's details. */
function ChangesPanel({ row, lang }: { row: ActivityRow; lang: 'ar' | 'en' }) {
  const arrow = lang === 'ar' ? '←' : '→'
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {KIND_LABEL[row.kind]} · {ACTION_LABEL[row.action]} ·{' '}
          {actorLabel(row.actor)} · {formatDateTime(row.at)}
        </span>
        <AppLink
          href={row.href}
          className="font-medium text-fg hover:underline"
        >
          {row.kind === 'movement' ? 'انتقل للحركة' : 'صفحة المعدة'}
        </AppLink>
      </div>
      <div className="overflow-hidden rounded-lg border bg-bg">
        <div className="grid grid-cols-[1fr_1.3fr_auto_1.3fr] items-center gap-2 border-b bg-surface px-3 py-1.5 text-xs text-muted">
          <span>الحقل</span>
          <span>قبل</span>
          <span aria-hidden="true" />
          <span>بعد</span>
        </div>
        {row.changes.map((change) => (
          <div
            key={change.key}
            className="grid grid-cols-[1fr_1.3fr_auto_1.3fr] items-center gap-2 border-b px-3 py-2 last:border-0"
          >
            <span className="font-medium">{change.label}</span>
            <span className="break-words text-muted" dir="auto">
              {displayValue(change.before)}
            </span>
            <span aria-hidden="true" className="text-muted">
              {arrow}
            </span>
            <span className="break-words font-medium" dir="auto">
              {displayValue(change.after)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The phone layout: one card per row, the details folded under it. */
function ActivityCard({ row, lang }: { row: ActivityRow; lang: 'ar' | 'en' }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="space-y-2 rounded-lg border bg-bg p-3 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <RecordCell row={row} />
        <KindCell row={row} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>{actorLabel(row.actor)}</span>
        <span className="tabular-nums">{formatDateTime(row.at)}</span>
        <span>{sinceWords(row.at, lang)}</span>
      </div>
      <Chips changes={row.changes} lang={lang} />
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        icon={
          open ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )
        }
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'اخفاء التفاصيل' : 'كل التغييرات'}
      </Button>
      {open && <ChangesPanel row={row} lang={lang} />}
    </article>
  )
}

interface Filters {
  kind: KindFilter
  action: ActionFilter
  actors: string[]
  fields: string[]
  date: DateRangeValue | null
}

const EMPTY_FILTERS: Filters = {
  kind: 'all',
  action: 'all',
  actors: [],
  fields: [],
  date: null,
}

function defaultDateRange(): DateRangeValue {
  return { preset: 'month', ...saudiMonthKeys(0, TODAY) }
}

function activeFilterCount(filters: Filters): number {
  return (
    (filters.action !== 'all' ? 1 : 0) +
    (filters.actors.length ? 1 : 0) +
    (filters.fields.length ? 1 : 0) +
    (filters.date ? 1 : 0)
  )
}

function matches(row: ActivityRow, filters: Filters, search: string): boolean {
  if (filters.kind !== 'all' && row.kind !== filters.kind) return false
  if (filters.action !== 'all' && row.action !== filters.action) return false
  if (filters.actors.length) {
    const actor = row.actor ?? SYSTEM_ACTOR
    if (!filters.actors.includes(actor)) return false
  }
  if (filters.fields.length) {
    if (row.kind !== 'equipment') return false
    if (!row.changes.some((change) => filters.fields.includes(change.key)))
      return false
  }
  if (filters.date) {
    const day = saudiDateKey(row.at)
    if (day < filters.date.from || day > filters.date.to) return false
  }
  const term = search.trim().toLowerCase()
  if (term) {
    const haystack = `${row.equipmentCode} ${row.actor ?? ''}`.toLowerCase()
    if (!haystack.includes(term)) return false
  }
  return true
}

function sortRows(rows: ActivityRow[], sort: DataTableSort): ActivityRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const cmp =
      sort.key === 'code'
        ? a.equipmentCode.localeCompare(b.equipmentCode, 'en')
        : a.at.localeCompare(b.at)
    return cmp * sign || b.id - a.id
  })
}

/** The filter dialog: one small control per filter, «مسح الكل» and «تم» in
 *  the footer, as the unified lists' dialog. */
function FiltersDialog({
  open,
  onOpenChange,
  filters,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: Filters
  onChange: (next: Filters) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="الفلاتر"
      description="كل تغيير يطبق مباشرة على القائمة ويحفظ في الرابط."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_FILTERS, kind: filters.kind })}
          >
            مسح الكل
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            تم
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاجراء">
          {(control) => (
            <Select
              {...control}
              value={filters.action}
              onValueChange={(value) =>
                onChange({ ...filters, action: value as ActionFilter })
              }
              options={ACTION_OPTIONS}
            />
          )}
        </Field>
        <Field label="المستخدم">
          {(control) => (
            <MultiSelect
              {...control}
              options={ACTOR_OPTIONS}
              value={filters.actors}
              onValueChange={(actors) => onChange({ ...filters, actors })}
              allLabel="كل المستخدمين"
              summaryLabel={(count) => `${count} مستخدمين`}
            />
          )}
        </Field>
        {/* Offered only while the kind allows equipment changes; dropped
            from the state when the kind becomes «الحركات». */}
        {filters.kind !== 'movement' && (
          <Field
            label="الحقل"
            hint="لتعديلات المعدات: الصفوف التي غيرت احد هذه الحقول."
          >
            {(control) => (
              <MultiSelect
                {...control}
                options={FIELD_OPTIONS}
                value={filters.fields}
                onValueChange={(fields) => onChange({ ...filters, fields })}
                allLabel="كل الحقول"
                summaryLabel={(count) => `${count} حقول`}
              />
            )}
          </Field>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">التاريخ</span>
            {filters.date ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...filters, date: null })}
              >
                مسح التاريخ
              </Button>
            ) : (
              <span className="text-xs text-muted">كل الفترات</span>
            )}
          </div>
          <DateRangeFilter
            lang={MOCKUP_LANG}
            value={filters.date ?? defaultDateRange()}
            onChange={(date) => onChange({ ...filters, date })}
          />
          {!filters.date && (
            <p className="text-xs text-muted">
              اختر شهرا او فترة مخصصة لتفعيل الفلتر.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** The rebuilt activity page. */
function ActivityPageMockup() {
  const lang = MOCKUP_LANG
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState<DataTableSort>({
    key: 'at',
    direction: 'desc',
  })
  const [page, setPage] = useState(1)

  const apply = (next: Filters) => {
    // The «الحقل» filter has no meaning for movement rows: it leaves the
    // state (and the URL) when the kind stops offering it.
    setFilters(
      next.kind === 'movement' && next.fields.length
        ? { ...next, fields: [] }
        : next,
    )
    setPage(1)
  }

  const rows = useMemo(
    () =>
      sortRows(
        ACTIVITY_ROWS.filter((row) => matches(row, filters, search)),
        sort,
      ),
    [filters, search, sort],
  )
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filterCount = activeFilterCount(filters)

  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: 'at',
      header: 'الوقت',
      sortable: true,
      width: '11rem',
      cell: (row) => <TimeCell at={row.at} lang={lang} />,
    },
    {
      key: 'actor',
      header: 'المستخدم',
      width: '10rem',
      cell: (row) => (
        <span className={cn(!row.actor && 'text-muted')}>
          {actorLabel(row.actor)}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      width: '6rem',
      cell: (row) => <KindCell row={row} />,
    },
    {
      key: 'code',
      header: 'السجل',
      sortable: true,
      width: '10rem',
      cell: (row) => <RecordCell row={row} />,
    },
    {
      key: 'changes',
      header: 'التغييرات',
      cell: (row) => <Chips changes={row.changes} lang={lang} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="سجل النشاط"
        description="كل اضافة وتعديل وحذف على الحركات وبيانات المعدات: من، متى، وما الذي تغير."
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={(next) => {
            setSearch(next)
            setPage(1)
          }}
          placeholder="بحث برقم المعدة او اسم المستخدم"
          className="w-full sm:w-72"
        />
        <Tabs
          value={filters.kind}
          onValueChange={(value) =>
            apply({ ...filters, kind: value as KindFilter })
          }
        >
          <TabsList variant="segmented" aria-label="النوع">
            {KIND_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          icon={<Filter size={15} aria-hidden="true" />}
          onClick={() => setFiltersOpen(true)}
        >
          الفلاتر
          {filterCount > 0 && (
            <Badge size="sm" tone="neutral" className="tabular-nums">
              {filterCount}
            </Badge>
          )}
        </Button>
        <div className="ms-auto flex items-center gap-1.5">
          <Select
            aria-label="الترتيب"
            className="w-[150px]"
            value={sort.key}
            onValueChange={(key) => setSort({ ...sort, key })}
            options={SORT_OPTIONS}
          />
          <IconButton
            variant="outline"
            label={sort.direction === 'asc' ? 'ترتيب تنازلي' : 'ترتيب تصاعدي'}
            icon={
              sort.direction === 'asc' ? (
                <ArrowUp size={15} aria-hidden="true" />
              ) : (
                <ArrowDown size={15} aria-hidden="true" />
              )
            }
            onClick={() =>
              setSort({
                ...sort,
                direction: sort.direction === 'asc' ? 'desc' : 'asc',
              })
            }
          />
        </div>
      </div>

      <FiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onChange={apply}
      />

      {/* From md up: the approved main-list table, a row expands to every
          changed field. */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={(key, direction) => setSort({ key, direction })}
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
          caption="سجل النشاط"
          expandable={{
            render: (row) => <ChangesPanel row={row} lang={lang} />,
          }}
          empty="لا يوجد نشاط يطابق البحث او الفلاتر"
        />
      </div>

      {/* Phones: one card per row. */}
      <div className="space-y-2 md:hidden">
        {pageRows.length === 0 ? (
          <p className="rounded-lg border p-4 text-center text-sm text-muted">
            لا يوجد نشاط يطابق البحث او الفلاتر
          </p>
        ) : (
          pageRows.map((row) => (
            <ActivityCard key={row.id} row={row} lang={lang} />
          ))
        )}
      </div>

      <DataListPagination
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.length}
        onPage={setPage}
      />
    </div>
  )
}

/** «سجل التعديلات» as it would sit on the equipment page, under the
 *  purchasing card: the last five changes of the unit and «عرض الكل» to the
 *  activity page filtered to it. Rendered for movements.activity holders. */
function EquipmentChangesCardMockup() {
  const lang = MOCKUP_LANG
  const rows = cardUnitChanges(5)
  const allHref = `/activity?kind=equipment&q=${CARD_UNIT.code}`
  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: 'at',
      header: 'الوقت',
      width: '11rem',
      cell: (row) => <TimeCell at={row.at} lang={lang} />,
    },
    {
      key: 'actor',
      header: 'المستخدم',
      width: '9rem',
      cell: (row) => actorLabel(row.actor),
    },
    {
      key: 'changes',
      header: 'التغييرات',
      cell: (row) => <Chips changes={row.changes} lang={lang} max={2} />,
    },
  ]
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-xl font-semibold" dir="ltr">
          {CARD_UNIT.code}
        </span>
        <span className="text-sm text-muted">{CARD_UNIT.type}</span>
        <Badge tone="danger">مباعة</Badge>
        <span className="ms-auto text-xs text-muted">
          راس صفحة المعدة (مختصر) — الكرت تحته
        </span>
      </div>
      <MiniTable
        title="سجل التعديلات"
        description="اخر 5 تغييرات على بيانات المعدة: من، متى، وما الذي تغير."
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        maxRows={5}
        viewAllHref={allHref}
        viewAllFilled
        actionBesideText
        empty="لم تعدل بيانات هذه المعدة بعد"
      />
    </div>
  )
}

const NOTES: { title: string; detail: string }[] = [
  {
    title: 'قائمة واحدة لسجلين',
    detail:
      'الصفحة تقرا الحركات (movement_audit_logs) وتعديلات المعدات (equipment_audit_logs، الترحيل 0168) من view موحد واحد، بالنظام الموحد للقوائم: البحث والفلاتر والترتيب والصفحات من الخادم، والحالة محفوظة في الرابط.',
  },
  {
    title: 'الصلاحية',
    detail:
      'نفس مفتاح سجل النشاط الحالي movements.activity للسجلين؛ مفتاح مستقل لتعديلات المعدات ممكن لاحقا بتغيير سياسة واحدة.',
  },
  {
    title: 'ما يسجل عن المعدة',
    detail:
      'كل اضافة وتعديل وحذف من اي مسار (النموذج، تحديث Excel، الاضافة السريعة، تغيير الرقم، الحالة التلقائية للموردين)، بالحقول التي تغيرت فقط قبل وبعد؛ الحقول المشتقة (اجزاء اللوحة، البحث، وقت التعديل) لا تظهر.',
  },
  {
    title: 'فلتر «الحقل»',
    detail:
      'لتعديلات المعدات فقط، ويختفي من الحالة والرابط عند اختيار «الحركات»؛ على الخادم يطابق changed_fields.',
  },
  {
    title: 'كرت صفحة المعدة',
    detail:
      'اخر 5 تغييرات تحت كرت المشتريات وقبل سجل الحركات، و«عرض الكل» يفتح النشاط مفلترا على المعدة. يظهر لحامل movements.activity فقط.',
  },
  {
    title: 'الصفوف قبل التفعيل',
    detail:
      'لا يوجد backfill: سجل المعدات يبدا من يوم تطبيق الترحيل، والحركات تبقى كما هي منذ 0069.',
  },
]

function NotesBlock() {
  return (
    <Card className="space-y-3 p-4">
      <SectionHeader
        title="ما سيبنى عند الاعتماد"
        description="النموذج ببيانات عينة؛ ما يتغير هنا يتغير في الشاشة."
      />
      <ol className="grid gap-2 sm:grid-cols-2">
        {NOTES.map((note, index) => (
          <li
            key={note.title}
            className="flex gap-3 rounded-lg border bg-bg p-3"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-semibold">{note.title}</span>
              <span className="block text-xs leading-5 text-muted">
                {note.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
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
  children,
}: {
  title: string
  permission: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <PermissionNote>{permission}</PermissionNote>
      </div>
      <div className="rounded-xl border bg-surface p-3 sm:p-4">{children}</div>
    </section>
  )
}

export function ActivityMockup() {
  return (
    <div className="space-y-6">
      <Mockup
        title="صفحة النشاط — /activity"
        permission="movements.activity (مفتاح سجل النشاط الحالي)"
      >
        <ActivityPageMockup />
      </Mockup>
      <Mockup
        title="كرت «سجل التعديلات» في صفحة المعدة"
        permission="movements.activity؛ لا يظهر الكرت لغيره"
      >
        <EquipmentChangesCardMockup />
      </Mockup>
      <NotesBlock />
    </div>
  )
}
