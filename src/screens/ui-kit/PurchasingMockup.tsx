import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Coins,
  Edit2,
  FileText,
  Lock,
  MapPin,
  Plus,
  ShoppingCart,
  StickyNote,
  Truck,
  User,
} from 'lucide-react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import type { FilterBarAsyncField } from '@/components/data-list/FilterBar'
import type { ListFilter } from '@/components/data-list/types'
import {
  BackButton,
  Badge,
  Button,
  Card,
  DataTable,
  DatePicker,
  DescriptionList,
  DetailHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  InfoGridSection,
  Input,
  Notice,
  SectionHeader,
  Select,
  Skeleton,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  useConfirm,
  type DataTableColumn,
  type DataTableSort,
  type DescriptionListItem,
  type InfoGridItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoFormSchema,
  supplierPoLineFormSchema,
  supplierPoPriceFormSchema,
  validateWithSchema,
  type FieldErrors,
  type PostgresLikeError,
} from '@/lib/formValidation'
import { supplierPosListConfig } from '@/lib/listConfigs'
import { localizedName } from '@/lib/localizedName'
import {
  SUPPLIER_PO_CREATE_FIELD_RULES,
  SUPPLIER_PO_ERROR_TOKENS,
  SUPPLIER_PO_EVENTS_LIMIT,
  SUPPLIER_PO_EVENT_LABEL_KEYS,
  SUPPLIER_PO_FIELD_ORDER,
  SUPPLIER_PO_FORM_MESSAGES,
  SUPPLIER_PO_LINE_FIELD_ORDER,
  SUPPLIER_PO_LINE_FIELD_RULES,
  SUPPLIER_PO_PRICE_FIELD_RULES,
  SUPPLIER_PO_STATUS_BADGE,
  formatSupplierPoPrice,
  supplierPoErrorOutcome,
  supplierPoSupplierLabel,
  type SupplierPoFormValues,
  type SupplierPoLineFormValues,
  type SupplierPoPriceFormValues,
} from '@/lib/purchasing'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  ACTOR_NAME,
  CARD_EQUIPMENT_ID,
  COMPANIES,
  EQUIPMENT,
  EVENTS,
  LESSORS,
  LINES,
  POS,
  PROJECTS,
  companyById,
  equipmentById,
  lessorById,
  projectById,
  type MockEquipment,
  type MockEvent,
  type MockLine,
  type MockPo,
} from './purchasingMockupData'

// purchasing-screens — MOCKUPS of the first three purchasing screens on
// /ui-kit (owner decision 2026-10-19: approve here first, move to the real
// routes `/purchasing`, `/purchasing/:id` and the equipment page later).
//
// Everything is in-memory sample data (purchasingMockupData.ts): nothing
// reads or writes the database and no RPC of migration 0136 is called. The
// mockups render the SAME shared components the real screens will use
// (DataListToolbar + the real `supplierPosListConfig`, DataTable, Dialog,
// AsyncSearchSelect, DetailHeader + InfoGrid, the shared Badge) and the same
// pure logic (the Zod schemas of src/lib/formValidation.ts and the token →
// field mapping of src/lib/purchasing.ts), so moving them later is wiring
// the RPCs only. The database answer is SIMULATED through a small «محاكاة»
// select in each dialog so the owner can see every mapped token message.
//
// /ui-kit is admin-only in production, so no permission gate lives here; a
// note above each mockup says which key will govern it.

type DemoState = 'data' | 'loading' | 'empty' | 'error'

const SAMPLE_DELAY_MS = 200

/** A sample server-side search: the first 20 matches after a short delay. */
function sampleSearch(
  list: AsyncSearchSelectOption[],
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  return (query) => {
    const text = query.trim().toLowerCase()
    const matches = text
      ? list.filter((option) =>
          [option.label, option.description ?? '']
            .join(' ')
            .toLowerCase()
            .includes(text),
        )
      : list
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(matches.slice(0, 20)), SAMPLE_DELAY_MS)
    })
  }
}

function sampleField(list: AsyncSearchSelectOption[]): FilterBarAsyncField {
  return {
    loadOptions: sampleSearch(list),
    resolveOptions: async (values) =>
      list.filter((option) => values.includes(option.value)),
  }
}

/** The simulated database answer of a dialog's submit. */
type Simulated = 'success' | (typeof SUPPLIER_PO_ERROR_TOKENS)[number]

const SQLSTATE: Readonly<Record<string, string>> = {
  purchasing_manage_required: '42501',
  po_closed: '55000',
  card_overlap: '23P01',
  equipment_already_on_open_po: '23505',
}

/** The error PostgREST would hand the client for a raised 0136 token. */
function simulatedError(token: string): PostgresLikeError {
  return { code: SQLSTATE[token] ?? '22023', message: token }
}

function SimulationField({
  value,
  onChange,
  tokens,
}: {
  value: Simulated
  onChange: (value: Simulated) => void
  tokens: readonly string[]
}) {
  return (
    <Field
      label="محاكاة رد القاعدة (للمعاينة فقط)"
      hint="يختار ما تعيده الدالة عند الحفظ ليظهر كيف تُعرض كل رسالة."
      className="rounded-lg border border-dashed p-3"
    >
      {(control) => (
        <Select
          {...control}
          size="sm"
          value={value}
          onValueChange={(next) => onChange(next as Simulated)}
          options={[
            { value: 'success', label: 'نجاح' },
            ...tokens.map((token) => ({ value: token, label: token })),
          ]}
        />
      )}
    </Field>
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

function StateTabs({
  value,
  onChange,
  options,
}: {
  value: DemoState
  onChange: (value: DemoState) => void
  options: readonly DemoState[]
}) {
  const label: Record<DemoState, string> = {
    data: 'بيانات',
    loading: 'تحميل',
    empty: 'فارغ',
    error: 'خطا',
  }
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as DemoState)}>
      <TabsList variant="segmented" aria-label="حالة المعاينة">
        {options.map((option) => (
          <TabsTrigger key={option} value={option}>
            {label[option]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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

// --- Shared cells -----------------------------------------------------------------

function StatusBadge({ status }: { status: MockPo['status'] }) {
  const { t } = useI18n()
  const badge = SUPPLIER_PO_STATUS_BADGE[status]
  return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
}

/** `supplier_pos` with the embedded lessor, company and project names. */
function poRow(po: MockPo) {
  const company = companyById(po.company_id)
  const project = projectById(po.project_id)
  return {
    ...po,
    lessor: lessorById(po.lessor_id),
    company_name_ar: company?.name_ar ?? null,
    company_name_en: company?.name_en ?? null,
    project_name_ar: project?.name_ar ?? null,
    project_name_en: project?.name_en ?? null,
  }
}

type PoRow = ReturnType<typeof poRow> & { equipment_count: number }

function EquipmentCell({ unit }: { unit: MockEquipment | null }) {
  if (!unit) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-col text-start">
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
  )
}

function Price({ value }: { value: number }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {formatSupplierPoPrice(value)}
    </bdi>
  )
}

// --- 1. The list ---------------------------------------------------------------------

const LESSOR_OPTIONS: AsyncSearchSelectOption[] = LESSORS.map((lessor) => ({
  value: lessor.id,
  label: lessor.name,
}))
const namedOptions = (
  list: { id: string; name_ar: string; name_en: string }[],
  lang: 'ar' | 'en',
): AsyncSearchSelectOption[] =>
  list.map((item) => ({
    value: item.id,
    label: localizedName(lang, item.name_ar, item.name_en),
  }))

function filterPos(
  pos: PoRow[],
  search: string,
  filters: ListFilter[],
): PoRow[] {
  const term = search.trim().toLowerCase()
  return pos.filter((po) => {
    if (term && !po.po_number.toLowerCase().includes(term)) return false
    for (const filter of filters) {
      const value = (po as unknown as Record<string, unknown>)[filter.field]
      const list = filter.value.split(',').filter(Boolean)
      if (filter.operator === 'eq' && value !== filter.value) return false
      if (filter.operator === 'neq' && value === filter.value) return false
      if (filter.operator === 'in' && list.length && !list.includes(String(value)))
        return false
    }
    return true
  })
}

function PoListMockup({
  pos,
  lines,
  onOpen,
  onCreate,
}: {
  pos: MockPo[]
  lines: MockLine[]
  onOpen: (id: string) => void
  onCreate: (values: SupplierPoFormValues) => string
}) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<DemoState>('data')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(supplierPosListConfig.defaultSort)
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [filters, setFilters] = useState<ListFilter[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)

  const asyncFields = useMemo(
    () => ({
      lessor_id: sampleField(LESSOR_OPTIONS),
      company_id: sampleField(namedOptions(COMPANIES, lang)),
      project_id: sampleField(namedOptions(PROJECTS, lang)),
    }),
    [lang],
  )

  const rows = useMemo(() => {
    const all: PoRow[] = pos.map((po) => ({
      ...poRow(po),
      equipment_count: lines.filter((line) => line.supplier_po_id === po.id)
        .length,
    }))
    const filtered = filterPos(all, search, filters)
    const sign = direction === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const left = String((a as unknown as Record<string, unknown>)[sort] ?? '')
      const right = String((b as unknown as Record<string, unknown>)[sort] ?? '')
      return left.localeCompare(right) * sign || a.id.localeCompare(b.id)
    })
    return filtered
  }, [pos, lines, search, filters, sort, direction])

  const visible = state === 'empty' ? [] : rows
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize)
  const filtered = Boolean(search.trim()) || filters.length > 0

  const columns: DataTableColumn<PoRow>[] = [
    {
      key: 'po_number',
      header: t('supplierPoNumber'),
      sortable: true,
      cell: (row) => (
        <bdi dir="ltr" className="font-semibold">
          {row.po_number}
        </bdi>
      ),
    },
    {
      key: 'lessor',
      header: t('supplierPoSupplier'),
      cell: (row) => supplierPoSupplierLabel(row, t),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'start_date',
      header: t('supplierPoStartDate'),
      sortable: true,
      className: 'tabular-nums',
      cell: (row) => formatDate(row.start_date),
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
      key: 'status',
      header: t('status'),
      sortable: true,
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ]

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => setCreateOpen(true)}
    >
      {t('supplierPoNew')}
    </Button>
  )

  return (
    <Mockup
      title="1. قائمة اوامر الشراء — /purchasing"
      permission="purchasing.view يعرض القائمة · purchasing.manage يظهر زر «امر شراء جديد»"
      controls={
        <StateTabs
          value={state}
          onChange={setState}
          options={['data', 'loading', 'empty', 'error']}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{t('supplierPos')}</h2>
            <p className="text-sm text-muted">{t('supplierPosDesc')}</p>
          </div>
          {addButton}
        </div>
        <DataListToolbar
          config={supplierPosListConfig}
          search={search}
          onSearch={(value) => {
            setSearch(value)
            setPage(1)
          }}
          sort={sort}
          direction={direction}
          onSort={(field, next) => {
            setSort(field)
            setDirection(next)
          }}
          filterFields={supplierPosListConfig.filterFields}
          filters={filters}
          onFilters={(next) => {
            setFilters(next)
            setPage(1)
          }}
          asyncFields={asyncFields}
        />
        {state === 'error' ? (
          <ErrorState
            description={t('supplierPoListLoadError')}
            onRetry={() => setState('data')}
          />
        ) : state !== 'loading' && visible.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={28} aria-hidden="true" />}
            title={filtered ? t('supplierPoEmptyFiltered') : t('supplierPoEmpty')}
            action={filtered ? undefined : addButton}
          />
        ) : (
          <DataTable
            size="md"
            columns={columns}
            rows={pageRows}
            rowKey={(row) => row.id}
            loading={state === 'loading'}
            loadingRows={6}
            caption={t('supplierPos')}
            sort={{ key: sort, direction }}
            onSortChange={(field, next) => {
              setSort(field)
              setDirection(next)
            }}
            onRowClick={(row) => onOpen(row.id)}
          />
        )}
        {state === 'data' && visible.length > 0 && (
          <DataListPagination
            page={page}
            pageSize={pageSize}
            total={visible.length}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        )}
      </div>
      <CreatePoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(values) => {
          const id = onCreate(values)
          setCreateOpen(false)
          onOpen(id)
        }}
      />
    </Mockup>
  )
}

// --- The create dialog -----------------------------------------------------------

const EMPTY_PO_FORM: SupplierPoFormValues = {
  lessor_id: '',
  company_id: '',
  project_id: '',
  start_date: '',
  notes: '',
}

function CreatePoDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (values: SupplierPoFormValues) => void
}) {
  const { t, lang } = useI18n()
  const [form, setForm] = useState<SupplierPoFormValues>(EMPTY_PO_FORM)
  const [options, setOptions] = useState<
    Record<'lessor' | 'company' | 'project', AsyncSearchSelectOption | null>
  >({ lessor: null, company: null, project: null })
  const [errors, setErrors] = useState<FieldErrors<SupplierPoFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [simulate, setSimulate] = useState<Simulated>('success')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // The start date defaults to today (Saudi time).
    setForm({ ...EMPTY_PO_FORM, start_date: saudiDateKey() })
    setOptions({ lessor: null, company: null, project: null })
    setErrors({})
    setMessage(null)
    setSimulate('success')
  }, [open])

  const update = (patch: Partial<SupplierPoFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoFormValues)[],
      ),
    )
  }

  const loadLessors = useMemo(() => sampleSearch(LESSOR_OPTIONS), [])
  const loadCompanies = useMemo(
    () => sampleSearch(namedOptions(COMPANIES, lang)),
    [lang],
  )
  const loadProjects = useMemo(
    () => sampleSearch(namedOptions(PROJECTS, lang)),
    [lang],
  )

  const save = () => {
    const invalid = validateWithSchema(supplierPoFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    // In the real screen this is `supabase.rpc('create_supplier_po', …)`.
    window.setTimeout(() => {
      setSaving(false)
      if (simulate === 'success') {
        onCreate(form)
        return
      }
      const outcome = supplierPoErrorOutcome(simulatedError(simulate), (error) =>
        mapDatabaseErrorToField(error, SUPPLIER_PO_CREATE_FIELD_RULES),
      )
      if ('fieldErrors' in outcome) {
        setErrors(outcome.fieldErrors)
        focusFirstError(outcome.fieldErrors, SUPPLIER_PO_FIELD_ORDER, {
          root: bodyRef.current,
        })
      } else setMessage(outcome.message)
    }, SAMPLE_DELAY_MS)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoNew')}
      description={t('supplierPoCreateDesc')}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('supplierPoCreate')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('supplierPoSupplier')}
          name="lessor_id"
          hint={t('supplierPoSupplierHint')}
          error={errors.lessor_id && t(errors.lessor_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.lessor_id}
              selectedOption={options.lessor}
              placeholder={t('supplierPoSupplierPlaceholder')}
              loadOptions={loadLessors}
              onChange={(value, option) => {
                update({ lessor_id: value })
                setOptions((current) => ({ ...current, lessor: option }))
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('company')}
            name="company_id"
            required
            error={errors.company_id && t(errors.company_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.company_id}
                selectedOption={options.company}
                placeholder={t('selectCompany')}
                loadOptions={loadCompanies}
                onChange={(value, option) => {
                  update({ company_id: value })
                  setOptions((current) => ({ ...current, company: option }))
                }}
              />
            )}
          </Field>
          <Field
            label={t('project')}
            name="project_id"
            required
            error={errors.project_id && t(errors.project_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.project_id}
                selectedOption={options.project}
                placeholder={t('selectProject')}
                loadOptions={loadProjects}
                onChange={(value, option) => {
                  update({ project_id: value })
                  setOptions((current) => ({ ...current, project: option }))
                }}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('supplierPoStartDate')}
          name="start_date"
          required
          error={errors.start_date && t(errors.start_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={form.start_date}
              onChange={(value) => update({ start_date: value })}
            />
          )}
        </Field>
        <Field
          label={t('notes')}
          name="notes"
          error={errors.notes && t(errors.notes)}
        >
          {(control) => (
            <Textarea
              {...control}
              value={form.notes}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
        <SimulationField
          value={simulate}
          onChange={setSimulate}
          tokens={[
            'invalid_company',
            'invalid_project',
            'invalid_lessor',
            'invalid_start_date',
            'purchasing_manage_required',
          ]}
        />
      </div>
    </Dialog>
  )
}

// --- 2. The PO page ------------------------------------------------------------------

const EQUIPMENT_OPTIONS: AsyncSearchSelectOption[] = EQUIPMENT.map((unit) => ({
  value: unit.id,
  label: unit.code,
  description: [unit.type, unit.plate_number ?? unit.chassis_number]
    .filter(Boolean)
    .join(' · '),
}))

const EMPTY_LINE_FORM: SupplierPoLineFormValues = {
  equipment_id: '',
  price: '',
  note: '',
}

function AddEquipmentDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (unit: MockEquipment, price: number, note: string) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoLineFormValues>(EMPTY_LINE_FORM)
  const [option, setOption] = useState<AsyncSearchSelectOption | null>(null)
  const [errors, setErrors] = useState<FieldErrors<SupplierPoLineFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [simulate, setSimulate] = useState<Simulated>('success')
  const bodyRef = useRef<HTMLDivElement>(null)
  const unit = form.equipment_id ? equipmentById(form.equipment_id) : null
  // `is_internal_equipment(id)`: the real dialog reads it with the unit (or
  // from `ownership_status = 'alazani'`), locking the price at 0.
  const internal = Boolean(unit?.internal)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_LINE_FORM)
    setOption(null)
    setErrors({})
    setMessage(null)
    setSimulate('success')
  }, [open])

  const update = (patch: Partial<SupplierPoLineFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoLineFormValues)[],
      ),
    )
  }

  const loadEquipment = useMemo(() => sampleSearch(EQUIPMENT_OPTIONS), [])

  const save = () => {
    const invalid = validateWithSchema(supplierPoLineFormSchema(internal), form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_LINE_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    // In the real screen this is `supabase.rpc('add_supplier_po_equipment', …)`.
    window.setTimeout(() => {
      setSaving(false)
      if (simulate === 'success' && unit) {
        onAdd(unit, Number(form.price), form.note.trim())
        return
      }
      const outcome = supplierPoErrorOutcome(simulatedError(simulate), (error) =>
        mapDatabaseErrorToField(error, SUPPLIER_PO_LINE_FIELD_RULES),
      )
      if ('fieldErrors' in outcome) {
        setErrors(outcome.fieldErrors)
        focusFirstError(outcome.fieldErrors, SUPPLIER_PO_LINE_FIELD_ORDER, {
          root: bodyRef.current,
        })
      } else setMessage(outcome.message)
    }, SAMPLE_DELAY_MS)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoAddEquipment')}
      description={t('supplierPoAddEquipmentDesc')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('supplierPoAddEquipment')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('supplierPoEquipmentField')}
          name="equipment_id"
          required
          error={errors.equipment_id && t(errors.equipment_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.equipment_id}
              selectedOption={option}
              placeholder={t('supplierPoEquipmentPlaceholder')}
              loadOptions={loadEquipment}
              onChange={(value, next) => {
                const picked = value ? equipmentById(value) : null
                // An internal unit locks the price at 0 the moment it is
                // picked; another unit gets the field back empty.
                update({ equipment_id: value, price: picked?.internal ? '0' : '' })
                setOption(next)
              }}
            />
          )}
        </Field>
        <Field
          label={t('supplierPoPrice')}
          name="price"
          required
          hint={internal ? t('supplierPoPriceInternalLocked') : undefined}
          error={errors.price && t(errors.price)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              placeholder="0.00"
              value={form.price}
              disabled={internal}
              readOnly={internal}
              startIcon={
                internal ? <Lock size={14} aria-hidden="true" /> : undefined
              }
              onChange={(event) => update({ price: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('supplierPoLineNote')}
          name="note"
          error={errors.note && t(errors.note)}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={form.note}
              onChange={(event) => update({ note: event.target.value })}
            />
          )}
        </Field>
        <SimulationField
          value={simulate}
          onChange={setSimulate}
          tokens={[
            'internal_price_must_be_zero',
            'card_overlap',
            'equipment_already_on_open_po',
            'po_closed',
            'invalid_equipment',
            'invalid_price',
            'purchasing_manage_required',
          ]}
        />
      </div>
    </Dialog>
  )
}

function EditPriceDialog({
  line,
  onOpenChange,
  onSave,
}: {
  /** The line being edited; null closes the dialog. */
  line: (MockLine & { unit: MockEquipment | null }) | null
  onOpenChange: (open: boolean) => void
  onSave: (line: MockLine, price: number) => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<SupplierPoPriceFormValues>({ price: '' })
  const [errors, setErrors] = useState<FieldErrors<SupplierPoPriceFormValues>>(
    {},
  )
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [simulate, setSimulate] = useState<Simulated>('success')
  const bodyRef = useRef<HTMLDivElement>(null)
  const internal = Boolean(line?.unit?.internal)
  const lineId = line?.id ?? null

  useEffect(() => {
    if (!lineId) return
    setForm({ price: line ? String(line.price) : '' })
    setErrors({})
    setMessage(null)
    setSimulate('success')
    // The line's own price is the only value the dialog opens with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId])

  const save = () => {
    if (!line) return
    const invalid = validateWithSchema(supplierPoPriceFormSchema(internal), form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, ['price'], { root: bodyRef.current })
      return
    }
    setSaving(true)
    setMessage(null)
    // In the real screen: `supabase.rpc('update_supplier_po_equipment_price', …)`.
    window.setTimeout(() => {
      setSaving(false)
      if (simulate === 'success') {
        onSave(line, Number(form.price))
        return
      }
      const outcome = supplierPoErrorOutcome(simulatedError(simulate), (error) =>
        mapDatabaseErrorToField(error, SUPPLIER_PO_PRICE_FIELD_RULES),
      )
      if ('fieldErrors' in outcome) setErrors(outcome.fieldErrors)
      else setMessage(outcome.message)
    }, SAMPLE_DELAY_MS)
  }

  return (
    <Dialog
      open={line !== null}
      onOpenChange={onOpenChange}
      title={t('supplierPoEditPrice')}
      description={t('supplierPoEditPriceDesc')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        {line && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-sm">
            <EquipmentCell unit={line.unit} />
            <span className="text-muted">
              {t('supplierPoCurrentPrice')}: <Price value={line.price} />
            </span>
          </div>
        )}
        <Field
          label={t('supplierPoPrice')}
          name="price"
          required
          hint={internal ? t('supplierPoPriceInternalLocked') : undefined}
          error={errors.price && t(errors.price)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              value={form.price}
              disabled={internal}
              readOnly={internal}
              onChange={(event) => {
                setForm({ price: event.target.value })
                setErrors({})
              }}
            />
          )}
        </Field>
        <SimulationField
          value={simulate}
          onChange={setSimulate}
          tokens={[
            'internal_price_must_be_zero',
            'invalid_price',
            'po_closed',
            'invalid_line',
            'purchasing_manage_required',
          ]}
        />
      </div>
    </Dialog>
  )
}

function EventsList({ events }: { events: MockEvent[] }) {
  const { t } = useI18n()
  const latest = [...events]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, SUPPLIER_PO_EVENTS_LIMIT)
  return (
    <Card className="space-y-3 p-4">
      <SectionHeader
        title={t('supplierPoEvents')}
        description={t('supplierPoEventsDesc')}
      />
      {latest.length === 0 ? (
        <p className="text-sm text-muted">{t('supplierPoNoEvents')}</p>
      ) : (
        <ol className="divide-y text-sm">
          {latest.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-medium">
                  {t(SUPPLIER_PO_EVENT_LABEL_KEYS[event.event_type])}
                </span>
                {event.detail && (
                  <bdi dir="ltr" className="text-muted">
                    {event.detail}
                  </bdi>
                )}
              </span>
              <span className="text-xs text-muted">
                {t('supplierPoEventActor')} {event.actor_name} ·{' '}
                <bdi dir="ltr">{formatDateTime(event.created_at, false)}</bdi>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function PoPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <div className="card space-y-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-[26px] w-16 rounded-full" />
        </div>
        <InfoGridSkeleton count={6} withIcon />
      </div>
      <div className="card space-y-3 p-4">
        <Skeleton variant="text" className="w-28" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}

function PoPageMockup({
  pos,
  lines,
  events,
  selectedId,
  onSelect,
  onAddLine,
  onChangePrice,
  onClose,
}: {
  pos: MockPo[]
  lines: MockLine[]
  events: MockEvent[]
  selectedId: string
  onSelect: (id: string) => void
  onAddLine: (poId: string, unit: MockEquipment, price: number, note: string) => void
  onChangePrice: (line: MockLine, price: number) => void
  onClose: (poId: string) => void
}) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<DemoState>('data')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<
    (MockLine & { unit: MockEquipment | null }) | null
  >(null)
  const { confirm, confirmDialog } = useConfirm()

  const po = pos.find((item) => item.id === selectedId) ?? pos[0]
  const row = poRow(po)
  const poLines = lines
    .filter((line) => line.supplier_po_id === po.id)
    .map((line) => ({ ...line, unit: equipmentById(line.equipment_id) }))
  const poEvents = events.filter((event) => event.supplier_po_id === po.id)
  const open = po.status === 'open'

  const closePo = async () => {
    if (
      !(await confirm({
        title: t('supplierPoCloseConfirmTitle'),
        description: t('supplierPoCloseConfirmDesc'),
        confirmLabel: t('supplierPoClose'),
        tone: 'danger',
      }))
    )
      return
    // In the real screen: `supabase.rpc('close_supplier_po', …)`.
    onClose(po.id)
  }

  const company = companyById(po.company_id)
  const project = projectById(po.project_id)
  const items: InfoGridItem[] = [
    {
      key: 'supplier',
      label: t('supplierPoSupplier'),
      value: supplierPoSupplierLabel(row, t),
    },
    {
      key: 'company',
      label: t('company'),
      value: company ? localizedName(lang, company.name_ar, company.name_en) : null,
    },
    {
      key: 'project',
      label: t('project'),
      value: project ? localizedName(lang, project.name_ar, project.name_en) : null,
    },
    {
      key: 'start',
      label: t('supplierPoStartDate'),
      value: formatDate(po.start_date),
      numeric: true,
    },
    {
      key: 'createdBy',
      label: t('supplierPoCreatedBy'),
      value: po.created_by_name,
    },
    {
      key: 'createdAt',
      label: t('supplierPoCreatedAt'),
      value: formatDateTime(po.created_at),
      numeric: true,
    },
    ...(po.closed_at
      ? [
          {
            key: 'closedAt',
            label: t('supplierPoClosedAt'),
            value: formatDateTime(po.closed_at),
            numeric: true,
          },
        ]
      : []),
    {
      key: 'notes',
      label: t('notes'),
      value: po.notes,
      cellClassName: 'sm:col-span-2 lg:col-span-3',
    },
  ]

  type LineRow = (typeof poLines)[number]
  const columns: DataTableColumn<LineRow>[] = [
    {
      key: 'equipment',
      header: t('supplierPoEquipmentField'),
      cell: (line) => <EquipmentCell unit={line.unit} />,
    },
    {
      key: 'price',
      header: t('supplierPoPrice'),
      align: 'end',
      cell: (line) => <Price value={line.price} />,
    },
    {
      key: 'note',
      header: t('supplierPoLineNote'),
      className: 'text-muted',
      hideBelow: 'sm',
      cell: (line) => line.note ?? '—',
    },
    ...(open
      ? [
          {
            key: 'actions',
            header: t('actions'),
            cell: (line: LineRow) => (
              <IconButton
                size="sm"
                label={t('supplierPoEditPrice')}
                icon={<Edit2 size={15} />}
                onClick={() => setEditing(line)}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <Mockup
      title="2. صفحة امر الشراء — /purchasing/:id"
      permission="purchasing.view يعرض الصفحة · purchasing.manage يظهر «اضافة معدة» و«تعديل السعر» و«اغلاق الامر» على الامر المفتوح"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="امر الشراء المعروض"
            className="w-[200px]"
            value={po.id}
            onValueChange={onSelect}
            options={pos.map((item) => ({
              value: item.id,
              label: `${item.po_number} · ${t(SUPPLIER_PO_STATUS_BADGE[item.status].key)}`,
            }))}
          />
          <StateTabs
            value={state}
            onChange={setState}
            options={['data', 'loading', 'empty', 'error']}
          />
        </div>
      }
    >
      {state === 'loading' ? (
        <PoPageSkeleton />
      ) : state === 'error' || state === 'empty' ? (
        <div className="space-y-4">
          <BackButton onClick={() => undefined} label={t('supplierPoBackToList')} />
          {state === 'error' ? (
            <ErrorState
              description={t('supplierPoLoadError')}
              onRetry={() => setState('data')}
            />
          ) : (
            <EmptyState
              icon={<FileText size={28} aria-hidden="true" />}
              title={t('supplierPoNotFound')}
            />
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <BackButton onClick={() => undefined} label={t('supplierPoBackToList')} />
          {!open && (
            <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
              {t('supplierPoClosedNotice')}
            </Notice>
          )}
          <div className="card space-y-5 p-4">
            <DetailHeader
              as="h2"
              identifier={po.po_number}
              identifierLtr
              subtitle={supplierPoSupplierLabel(row, t)}
              badges={<StatusBadge status={po.status} />}
              actions={
                open ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={14} aria-hidden="true" />}
                      onClick={() => setAddOpen(true)}
                    >
                      {t('supplierPoAddEquipment')}
                    </Button>
                    <Button variant="danger" size="sm" onClick={closePo}>
                      {t('supplierPoClose')}
                    </Button>
                  </>
                ) : undefined
              }
            />
            <InfoGridSection title={t('supplierPoDetails')} items={items} />
          </div>

          <Card padded={false} className="flex min-w-0 flex-col">
            <div className="p-4 pb-0">
              <SectionHeader
                title={t('supplierPoEquipment')}
                description={t('supplierPoEquipmentDesc')}
                action={
                  open ? (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Plus size={14} aria-hidden="true" />}
                      onClick={() => setAddOpen(true)}
                    >
                      {t('supplierPoAddEquipment')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
            <div className="p-4">
              {poLines.length === 0 ? (
                <EmptyState
                  title={t('supplierPoNoEquipment')}
                  className="p-6"
                  action={
                    open ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => setAddOpen(true)}
                      >
                        {t('supplierPoAddEquipment')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <DataTable
                  size="md"
                  columns={columns}
                  rows={poLines}
                  rowKey={(line) => line.id}
                  caption={t('supplierPoEquipment')}
                />
              )}
            </div>
          </Card>

          <EventsList events={poEvents} />
        </div>
      )}
      <AddEquipmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={(unit, price, note) => {
          onAddLine(po.id, unit, price, note)
          setAddOpen(false)
        }}
      />
      <EditPriceDialog
        line={editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        onSave={(line, price) => {
          onChangePrice(line, price)
          setEditing(null)
        }}
      />
      {confirmDialog}
    </Mockup>
  )
}

// --- 2b. The PO page, the PROPOSED detail-page pattern ----------------------------
//
// Owner request 2026-10-19 («ابغى اعيد اشتغل على صفحات التفاصيل ابتدا من
// تفاصيل الSPO»): ONE pattern for every detail page, shown here on the SPO
// page next to the current one so it can be approved on /ui-kit first and
// then applied to the equipment, driver, movement and user pages:
//   1. a header card: the identifier with its status, one line of context
//      (supplier · company · project), a small meta line (start, created
//      by, closed at) and the actions at the end on desktop;
//   2. a summary strip of two to four numbers (StatCard) that answers the
//      first questions before any table;
//   3. a two-column body from `xl`: the main record list (the PO equipment
//      with a total line) takes two thirds; the facts («بيانات الامر», a
//      labelled list with icons) and the activity timeline sit beside it.
//      On mobile everything stacks in that order;
//   4. the record list becomes a card list below `md`: no sideways scroll;
//   5. on mobile the primary actions sit in a bar at the bottom of the
//      screen (44 px targets, safe-area padding); desktop keeps them in the
//      header. Destructive actions keep their confirmation dialog.
// Same sample data, same dialogs and the same tokens as the current page.

/** The unit's own supplier or owner, short: the lessor name for «مالك اخر»,
 *  else the owner («العزاني», «تكوين», «الغير F», «شراكة B»). */
function unitSupplierLabel(
  unit: MockEquipment | null,
  t: (key: TranslationKey) => string,
): string {
  if (!unit) return '—'
  switch (unit.ownership) {
    case 'alazani':
      return t('supplierPoInternalSupplier')
    case 'takween':
      return t('supplierPoUnitOwnerTakween')
    case 'third_party_f':
      return t('supplierPoUnitOwnerF')
    case 'third_party_partnership_b':
      return t('supplierPoUnitOwnerB')
    default:
      return unit.lessor_name?.trim() || t('ownershipExternalSupplier')
  }
}

/** The card period behind a line: «from – to», or «from – مفتوح». */
function periodLabel(
  line: MockLine,
  t: (key: TranslationKey) => string,
): string {
  const to = line.period_to
    ? formatDate(line.period_to)
    : t('equipmentPurchasingOpenEnd')
  return `${formatDate(line.period_from)} – ${to}`
}

type PoLineRow = MockLine & { unit: MockEquipment | null }
/** A table row: a line, or the closing total row (aligned under the price
 *  column, so the total never drifts from the numbers above it). */
type PoTableRow = { kind: 'line'; line: PoLineRow } | { kind: 'total'; price: number }

function daysSince(dateKey: string): number {
  const start = Date.parse(`${dateKey}T00:00:00+03:00`)
  const today = Date.parse(`${saudiDateKey()}T00:00:00+03:00`)
  if (Number.isNaN(start) || Number.isNaN(today)) return 0
  return Math.max(0, Math.round((today - start) / 86_400_000))
}

function HeaderMeta({
  icon,
  label,
  value,
  ltr,
}: {
  icon: ReactNode
  label: string
  value: string
  ltr?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <dt>{label}</dt>
      <dd className="m-0 font-medium text-fg">
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </dd>
    </div>
  )
}

function EventTimeline({ events }: { events: MockEvent[] }) {
  const { t } = useI18n()
  const latest = [...events]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, SUPPLIER_PO_EVENTS_LIMIT)
  if (latest.length === 0)
    return <p className="text-sm text-muted">{t('supplierPoNoEvents')}</p>
  return (
    <ol className="relative ms-1.5 space-y-4 border-s ps-4">
      {latest.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-muted"
          />
          <p className="text-sm font-medium">
            {t(SUPPLIER_PO_EVENT_LABEL_KEYS[event.event_type])}
          </p>
          {event.detail && (
            <p className="text-sm text-muted">
              <bdi dir="ltr">{event.detail}</bdi>
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

function PoPageMockupV2({
  pos,
  lines,
  events,
  selectedId,
  onSelect,
  onAddLine,
  onChangePrice,
  onClose,
}: {
  pos: MockPo[]
  lines: MockLine[]
  events: MockEvent[]
  selectedId: string
  onSelect: (id: string) => void
  onAddLine: (poId: string, unit: MockEquipment, price: number, note: string) => void
  onChangePrice: (line: MockLine, price: number) => void
  onClose: (poId: string) => void
}) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<DemoState>('data')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<
    (MockLine & { unit: MockEquipment | null }) | null
  >(null)
  const { confirm, confirmDialog } = useConfirm()

  const po = pos.find((item) => item.id === selectedId) ?? pos[0]
  const row = poRow(po)
  const poLines = lines
    .filter((line) => line.supplier_po_id === po.id)
    .map((line) => ({ ...line, unit: equipmentById(line.equipment_id) }))
  const poEvents = events.filter((event) => event.supplier_po_id === po.id)
  const open = po.status === 'open'
  const total = poLines.reduce((sum, line) => sum + line.price, 0)
  const [sort, setSort] = useState<DataTableSort>({
    key: 'equipment',
    direction: 'asc',
  })
  const company = companyById(po.company_id)
  const project = projectById(po.project_id)
  const companyName = company
    ? localizedName(lang, company.name_ar, company.name_en)
    : '—'
  const projectName = project
    ? localizedName(lang, project.name_ar, project.name_en)
    : '—'
  const supplier = supplierPoSupplierLabel(row, t)

  const closePo = async () => {
    if (
      !(await confirm({
        title: t('supplierPoCloseConfirmTitle'),
        description: t('supplierPoCloseConfirmDesc'),
        confirmLabel: t('supplierPoClose'),
        tone: 'danger',
      }))
    )
      return
    // In the real screen: `supabase.rpc('close_supplier_po', …)`.
    onClose(po.id)
  }

  const facts: DescriptionListItem[] = [
    {
      key: 'supplier',
      icon: <Building2 size={16} />,
      label: t('supplierPoSupplier'),
      value: supplier,
    },
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: t('company'),
      value: companyName,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: projectName,
    },
    {
      key: 'start',
      icon: <Calendar size={16} />,
      label: t('supplierPoStartDate'),
      value: formatDate(po.start_date),
      dir: 'ltr',
    },
    {
      key: 'createdBy',
      icon: <User size={16} />,
      label: t('supplierPoCreatedBy'),
      value: po.created_by_name,
    },
    {
      key: 'createdAt',
      icon: <Clock size={16} />,
      label: t('supplierPoCreatedAt'),
      value: formatDateTime(po.created_at),
      dir: 'ltr',
    },
    ...(po.closed_at
      ? [
          {
            key: 'closedAt',
            icon: <Lock size={16} />,
            label: t('supplierPoClosedAt'),
            value: formatDateTime(po.closed_at),
            dir: 'ltr' as const,
          },
        ]
      : []),
    {
      key: 'notes',
      icon: <StickyNote size={16} />,
      label: t('notes'),
      value: po.notes,
    },
  ]

  // Sorting stays in the browser: one PO holds a handful of lines (it is
  // not a major list), so the real page sorts the loaded rows the same way.
  const sortValue = (line: PoLineRow, key: string): string | number => {
    switch (key) {
      case 'supplier':
        return unitSupplierLabel(line.unit, t)
      case 'period':
        return line.period_from
      case 'price':
        return line.price
      default:
        return line.unit?.code ?? ''
    }
  }
  const sortedLines = [...poLines].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), lang)
    return sort.direction === 'asc' ? cmp : -cmp
  })
  const tableRows: PoTableRow[] = [
    ...sortedLines.map((line): PoTableRow => ({ kind: 'line', line })),
    { kind: 'total', price: total },
  ]
  const lineCell = (render: (line: PoLineRow) => ReactNode) => (row: PoTableRow) =>
    row.kind === 'line' ? render(row.line) : null
  const columns: DataTableColumn<PoTableRow>[] = [
    {
      key: 'equipment',
      header: t('supplierPoEquipmentField'),
      sortable: true,
      // The type sits under the code (no column of its own): the table stays
      // narrow enough for the two-thirds column without sideways scroll.
      cell: (row) =>
        row.kind === 'line' ? (
          <div className="min-w-0">
            <EquipmentCell unit={row.line.unit} />
            <p className="text-xs text-muted">{row.line.unit?.type ?? '—'}</p>
          </div>
        ) : (
          <span className="text-muted">{t('supplierPoSummaryTotal')}</span>
        ),
    },
    {
      key: 'supplier',
      header: t('supplierPoSupplier'),
      sortable: true,
      cell: lineCell((line) => (
        <span className="block whitespace-normal">
          {unitSupplierLabel(line.unit, t)}
        </span>
      )),
    },
    {
      key: 'period',
      header: t('equipmentPurchasingPeriod'),
      sortable: true,
      hideBelow: 'lg',
      cell: lineCell((line) => <bdi dir="ltr">{periodLabel(line, t)}</bdi>),
    },
    {
      key: 'note',
      header: t('supplierPoLineNote'),
      hideBelow: 'lg',
      className: 'text-muted',
      cell: lineCell((line) => (
        <span className="block max-w-[14rem] whitespace-normal">
          {line.note ?? '—'}
        </span>
      )),
    },
    {
      key: 'price',
      header: t('supplierPoPrice'),
      sortable: true,
      align: 'end',
      cell: (row) => (
        <Price value={row.kind === 'line' ? row.line.price : row.price} />
      ),
    },
    ...(open
      ? [
          {
            key: 'actions',
            header: t('actions'),
            align: 'end' as const,
            width: '4rem',
            cell: lineCell((line) => (
              <IconButton
                size="sm"
                label={t('supplierPoEditPrice')}
                icon={<Edit2 size={15} />}
                onClick={() => setEditing(line)}
              />
            )),
          },
        ]
      : []),
  ]

  const addButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<Plus size={14} aria-hidden="true" />}
      onClick={() => setAddOpen(true)}
    >
      {t('supplierPoAddEquipment')}
    </Button>
  )

  return (
    <Mockup
      title="2ب. صفحة امر الشراء — النمط المقترح لصفحات التفاصيل"
      permission="purchasing.view يعرض الصفحة · purchasing.manage يظهر «اضافة معدة» و«تعديل السعر» و«اغلاق الامر» على الامر المفتوح"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="امر الشراء المعروض"
            className="w-[200px]"
            value={po.id}
            onValueChange={onSelect}
            options={pos.map((item) => ({
              value: item.id,
              label: `${item.po_number} · ${t(SUPPLIER_PO_STATUS_BADGE[item.status].key)}`,
            }))}
          />
          <StateTabs
            value={state}
            onChange={setState}
            options={['data', 'loading', 'empty', 'error']}
          />
        </div>
      }
    >
      {state === 'loading' ? (
        <PoPageSkeleton />
      ) : state === 'error' || state === 'empty' ? (
        <div className="space-y-4">
          <BackButton onClick={() => undefined} label={t('supplierPoBackToList')} />
          {state === 'error' ? (
            <ErrorState
              description={t('supplierPoLoadError')}
              onRetry={() => setState('data')}
            />
          ) : (
            <EmptyState
              icon={<FileText size={28} aria-hidden="true" />}
              title={t('supplierPoNotFound')}
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <BackButton onClick={() => undefined} label={t('supplierPoBackToList')} />

          {/* 1. Header card: identity, context, meta, actions, summary. */}
          <div className="card space-y-4 p-4">
            <DetailHeader
              as="h2"
              identifier={po.po_number}
              identifierLtr
              subtitle={`${supplier} · ${companyName} · ${projectName}`}
              badges={<StatusBadge status={po.status} />}
              actions={
                open ? (
                  <div className="hidden gap-2 sm:flex">
                    {addButton}
                    <Button variant="danger" size="sm" onClick={closePo}>
                      {t('supplierPoClose')}
                    </Button>
                  </div>
                ) : undefined
              }
            />
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
              <HeaderMeta
                icon={<Calendar size={14} />}
                label={t('supplierPoStartDate')}
                value={formatDate(po.start_date)}
                ltr
              />
              <HeaderMeta
                icon={<User size={14} />}
                label={t('supplierPoCreatedBy')}
                value={po.created_by_name}
              />
              {po.closed_at && (
                <HeaderMeta
                  icon={<Lock size={14} />}
                  label={t('supplierPoClosedAt')}
                  value={formatDateTime(po.closed_at)}
                  ltr
                />
              )}
            </dl>
            {/* 2. Summary strip (owner 2026-10-19: three numbers, no
                «last activity» card). */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                className="col-span-2 sm:col-span-1"
                label={t('supplierPoSummaryTotal')}
                value={<bdi dir="ltr">{formatSupplierPoPrice(total)}</bdi>}
                icon={<Coins size={18} />}
              />
              <StatCard
                label={t('supplierPoEquipmentCount')}
                value={poLines.length}
                icon={<Truck size={18} />}
              />
              <StatCard
                label={t('supplierPoSummaryAge')}
                value={daysSince(po.start_date)}
                hint={t('supplierPoDaysUnit')}
                icon={<CalendarDays size={18} />}
              />
            </div>
          </div>

          {!open && (
            <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
              {t('supplierPoClosedNotice')}
            </Notice>
          )}

          {/* 3. Body: the record list, then the facts and the timeline beside it. */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card padded={false} className="flex min-w-0 flex-col xl:col-span-2">
              <div className="p-4 pb-0">
                <SectionHeader
                  title={
                    <span className="flex items-center gap-2">
                      {t('supplierPoEquipment')}
                      <Badge size="sm">{poLines.length}</Badge>
                    </span>
                  }
                  description={t('supplierPoEquipmentDesc')}
                  action={
                    open ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => setAddOpen(true)}
                      >
                        {t('supplierPoAddEquipment')}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
              {poLines.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={t('supplierPoNoEquipment')}
                    className="p-6"
                    action={open ? addButton : undefined}
                  />
                </div>
              ) : (
                <>
                  {/* 4. Card list on narrow screens, sortable table from `md`
                      with the total as its last row. */}
                  <div className="md:hidden">
                    <ul className="divide-y px-4 pt-2">
                      {sortedLines.map((line) => (
                        <li
                          key={line.id}
                          className="flex items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            <EquipmentCell unit={line.unit} />
                            <p className="mt-0.5 text-xs text-muted">
                              {line.unit?.type ?? '—'} ·{' '}
                              {unitSupplierLabel(line.unit, t)} ·{' '}
                              <bdi dir="ltr">{periodLabel(line, t)}</bdi>
                            </p>
                            {line.note && (
                              <p className="mt-0.5 text-xs text-muted">{line.note}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Price value={line.price} />
                            {open && (
                              <IconButton
                                label={t('supplierPoEditPrice')}
                                icon={<Edit2 size={16} />}
                                onClick={() => setEditing(line)}
                              />
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                      <span className="text-muted">{t('supplierPoSummaryTotal')}</span>
                      <span className="font-semibold">
                        <Price value={total} />
                      </span>
                    </div>
                  </div>
                  <div className="hidden p-4 md:block">
                    <DataTable
                      size="md"
                      columns={columns}
                      rows={tableRows}
                      rowKey={(row) => (row.kind === 'line' ? row.line.id : 'total')}
                      sort={sort}
                      onSortChange={(key, direction) => setSort({ key, direction })}
                      rowClassName={(row) =>
                        row.kind === 'total' ? 'bg-surface font-semibold' : undefined
                      }
                      caption={t('supplierPoEquipment')}
                      stickyHeader={false}
                    />
                  </div>
                </>
              )}
            </Card>

            <div className="space-y-4">
              <Card className="space-y-3 p-4">
                <SectionHeader title={t('supplierPoDetails')} />
                <DescriptionList items={facts} className="-my-2" />
              </Card>
              <Card className="space-y-3 p-4">
                <SectionHeader
                  title={t('supplierPoEvents')}
                  description={t('supplierPoEventsDesc')}
                />
                <EventTimeline events={poEvents} />
              </Card>
            </div>
          </div>

          {/* 5. Mobile action bar (fixed to the viewport in the real page). */}
          {open && (
            <div
              className="sticky bottom-0 z-10 -mx-3 -mb-3 flex gap-2 border-t bg-bg p-3 sm:hidden"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <Button
                variant="primary"
                className="h-11 flex-1"
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setAddOpen(true)}
              >
                {t('supplierPoAddEquipment')}
              </Button>
              <Button variant="danger" className="h-11" onClick={closePo}>
                {t('supplierPoClose')}
              </Button>
            </div>
          )}
        </div>
      )}
      <AddEquipmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={(unit, price, note) => {
          onAddLine(po.id, unit, price, note)
          setAddOpen(false)
        }}
      />
      <EditPriceDialog
        line={editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        onSave={(line, price) => {
          onChangePrice(line, price)
          setEditing(null)
        }}
      />
      {confirmDialog}
    </Mockup>
  )
}

// --- 3. The equipment page card ---------------------------------------------------

function EquipmentPurchasingCardMockup({
  pos,
  lines,
  onOpenPo,
}: {
  pos: MockPo[]
  lines: MockLine[]
  onOpenPo: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<DemoState>('data')
  const unit = equipmentById(CARD_EQUIPMENT_ID)
  // `supplier_po_equipment` joined through `equipment_cards.equipment_id`,
  // with the PO (number, status, supplier, company, project) embedded; the
  // open card first.
  const rows = lines
    .filter((line) => line.equipment_id === CARD_EQUIPMENT_ID)
    .map((line) => {
      const po = pos.find((item) => item.id === line.supplier_po_id)
      return po ? { ...line, po: poRow(po) } : null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) =>
      a.period_to === b.period_to
        ? b.period_from.localeCompare(a.period_from)
        : a.period_to === null
          ? -1
          : 1,
    )
  type CardRow = (typeof rows)[number]

  const columns: DataTableColumn<CardRow>[] = [
    {
      key: 'po',
      header: t('supplierPoNumber'),
      cell: (row) => (
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => onOpenPo(row.po.id)}
        >
          <bdi dir="ltr">{row.po.po_number}</bdi>
        </button>
      ),
    },
    {
      key: 'supplier',
      header: t('supplierPoSupplier'),
      hideBelow: 'sm',
      cell: (row) => supplierPoSupplierLabel(row.po, t),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      cell: (row) => <CompanyProjectCell row={row.po} />,
    },
    {
      key: 'period',
      header: t('equipmentPurchasingPeriod'),
      className: 'tabular-nums',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {formatDate(row.period_from)}
          {' – '}
          {row.period_to
            ? formatDate(row.period_to)
            : t('equipmentPurchasingOpenEnd')}
        </span>
      ),
    },
    {
      key: 'price',
      header: t('supplierPoPrice'),
      align: 'end',
      cell: (row) => <Price value={row.price} />,
    },
  ]

  return (
    <Mockup
      title="3. كرت «المشتريات» في صفحة المعدة — /equipment/:id"
      permission="يظهر فقط مع purchasing.view · للقراءة فقط، بلا وحدة ولا ساعات معيارية"
      controls={
        <StateTabs
          value={state}
          onChange={setState}
          options={['data', 'loading', 'empty', 'error']}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          موضع الكرت: تحت كرت بيانات المعدة وقبل جدول سجل الحركات. المعدة في
          المثال: <bdi dir="ltr">{unit?.code}</bdi> · {unit?.type}
          {lang === 'en' ? '' : ''}
        </p>
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-0">
            <SectionHeader
              title={t('equipmentPurchasingCard')}
              description={t('equipmentPurchasingCardDesc')}
            />
          </div>
          <div className="p-4">
            {state === 'error' ? (
              <ErrorState
                description={t('equipmentPurchasingLoadError')}
                onRetry={() => setState('data')}
                className="p-6"
              />
            ) : state === 'empty' ? (
              <EmptyState title={t('equipmentPurchasingNone')} className="p-6" />
            ) : (
              <DataTable
                size="md"
                columns={columns}
                rows={state === 'loading' ? [] : rows}
                rowKey={(row) => row.id}
                loading={state === 'loading'}
                loadingRows={2}
                caption={t('equipmentPurchasingCard')}
              />
            )}
          </div>
        </Card>
      </div>
    </Mockup>
  )
}

// --- The token table ---------------------------------------------------------------

function TokenTable() {
  const { t } = useI18n()
  const fieldRules = [
    ...SUPPLIER_PO_CREATE_FIELD_RULES,
    ...SUPPLIER_PO_LINE_FIELD_RULES,
  ]
  const rows = SUPPLIER_PO_ERROR_TOKENS.map((token) => {
    const rule = fieldRules.find((item) => item.match === token)
    const formKey = SUPPLIER_PO_FORM_MESSAGES[token]
    return {
      token,
      where: rule ? `حقل ${String(rule.field)}` : 'رسالة النموذج',
      message: t(rule ? rule.key : (formKey ?? 'supplierPoSaveFailed')),
    }
  })
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">رسائل توكنات القاعدة (0136)</h3>
        <p className="text-xs text-muted">
          كل توكن ثابت ترفعه دوال المشتريات وما يراه المستخدم بدلا منه؛ لا يظهر
          نص القاعدة الخام ابدا.
        </p>
      </div>
      <div className="rounded-xl border bg-surface p-3 sm:p-4">
        <DataTable
          size="sm"
          columns={[
            {
              key: 'token',
              header: 'التوكن',
              cell: (row) => (
                <bdi dir="ltr" className="font-mono text-xs">
                  {row.token}
                </bdi>
              ),
            },
            { key: 'where', header: 'الموضع', cell: (row) => row.where },
            {
              key: 'message',
              header: 'الرسالة المعروضة',
              cell: (row) => (
                <span className="whitespace-normal">{row.message}</span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.token}
          caption="رسائل التوكنات"
        />
      </div>
    </section>
  )
}

// --- The section ---------------------------------------------------------------------

let nextId = 100
const newId = (prefix: string) => `${prefix}${nextId++}`
const nowIso = () => new Date().toISOString()

export function PurchasingMockup() {
  const [pos, setPos] = useState<MockPo[]>(POS)
  const [lines, setLines] = useState<MockLine[]>(LINES)
  const [events, setEvents] = useState<MockEvent[]>(EVENTS)
  const [selectedId, setSelectedId] = useState('po1')
  // Owner request 2026-10-19: the proposed detail-page pattern next to the
  // current page, to be approved here before it reaches the real routes.
  const [pageVariant, setPageVariant] = useState<'proposed' | 'current'>(
    'proposed',
  )
  const pageRef = useRef<HTMLDivElement>(null)

  const addEvent = useCallback(
    (poId: string, event_type: MockEvent['event_type'], detail: string | null) =>
      setEvents((current) => [
        ...current,
        {
          id: newId('ev'),
          supplier_po_id: poId,
          event_type,
          actor_name: ACTOR_NAME,
          created_at: nowIso(),
          detail,
        },
      ]),
    [],
  )

  const openPo = (id: string) => {
    setSelectedId(id)
    pageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const createPo = (values: SupplierPoFormValues): string => {
    const id = newId('po')
    const lessor = lessorById(values.lessor_id || null)
    const sequence = pos.length + 1
    const po: MockPo = {
      id,
      po_number: `SPO26${String(sequence).padStart(4, '0')}`,
      lessor_id: lessor?.id ?? null,
      is_internal: !lessor || lessor.is_internal,
      company_id: values.company_id,
      project_id: values.project_id,
      start_date: values.start_date,
      status: 'open',
      closed_at: null,
      notes: values.notes.trim() || null,
      created_by_name: ACTOR_NAME,
      created_at: nowIso(),
    }
    setPos((current) => [po, ...current])
    addEvent(id, 'created', po.po_number)
    return id
  }

  const addLine = (
    poId: string,
    unit: MockEquipment,
    price: number,
    note: string,
  ) => {
    const po = pos.find((item) => item.id === poId)
    setLines((current) => [
      ...current,
      {
        id: newId('ln'),
        supplier_po_id: poId,
        equipment_id: unit.id,
        price,
        note: note || null,
        period_from: po?.start_date ?? saudiDateKey(),
        period_to: null,
      },
    ])
    addEvent(poId, 'equipment_added', `${unit.code} · ${formatSupplierPoPrice(price)}`)
  }

  const changePrice = (line: MockLine, price: number) => {
    if (price === line.price) return
    setLines((current) =>
      current.map((item) => (item.id === line.id ? { ...item, price } : item)),
    )
    const unit = equipmentById(line.equipment_id)
    addEvent(
      line.supplier_po_id,
      'price_changed',
      `${unit?.code ?? '—'} · ${formatSupplierPoPrice(line.price)} → ${formatSupplierPoPrice(price)}`,
    )
  }

  const closePo = (poId: string) => {
    const closed_at = nowIso()
    setPos((current) =>
      current.map((item) =>
        item.id === poId ? { ...item, status: 'closed', closed_at } : item,
      ),
    )
    setLines((current) =>
      current.map((item) =>
        item.supplier_po_id === poId && !item.period_to
          ? { ...item, period_to: saudiDateKey(closed_at) }
          : item,
      ),
    )
    addEvent(poId, 'closed', null)
  }

  return (
    <div className="space-y-6">
      <Notice tone="info" size="compact">
        نماذج للاعتماد ببيانات عينة في الذاكرة: لا قراءة ولا كتابة على القاعدة،
        ولا استدعاء لدوال 0136. ما تنشئه او تعدله هنا يبقى في الصفحة فقط.
        الشاشات تستخدم المكونات المشتركة نفسها ومخططات Zod وخريطة التوكنات التي
        ستنتقل كما هي الى المسارات الحقيقية.
      </Notice>
      <PoListMockup
        pos={pos}
        lines={lines}
        onOpen={openPo}
        onCreate={createPo}
      />
      <div ref={pageRef} className="scroll-mt-16 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            نمط صفحة التفاصيل: قارن المقترح بالحالي، ثم يُعتمد النمط ويُطبق
            على بقية صفحات التفاصيل.
          </p>
          <Tabs
            value={pageVariant}
            onValueChange={(next) =>
              setPageVariant(next as 'proposed' | 'current')
            }
          >
            <TabsList variant="segmented" aria-label="نسخة صفحة الامر">
              <TabsTrigger value="proposed">المقترح</TabsTrigger>
              <TabsTrigger value="current">الحالي</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {pageVariant === 'proposed' ? (
          <PoPageMockupV2
            pos={pos}
            lines={lines}
            events={events}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAddLine={addLine}
            onChangePrice={changePrice}
            onClose={closePo}
          />
        ) : (
          <PoPageMockup
            pos={pos}
            lines={lines}
            events={events}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAddLine={addLine}
            onChangePrice={changePrice}
            onClose={closePo}
          />
        )}
      </div>
      <EquipmentPurchasingCardMockup pos={pos} lines={lines} onOpenPo={openPo} />
      <TokenTable />
    </div>
  )
}
