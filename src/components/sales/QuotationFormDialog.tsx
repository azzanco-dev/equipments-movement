import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { QuotationTermFormDialog } from '@/components/quotations/QuotationTermFormDialog'
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  Notice,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  focusFirstError,
  mapDatabaseErrorToField,
  QUOTATION_COST_NAME_MAX,
  QUOTATION_LINE_NOTE_MAX,
  QUOTATION_NOTES_MAX,
  quotationFormErrors,
  quotationFormHasErrors,
  type QuotationFormErrors,
} from '@/lib/formValidation'
import { localizedName } from '@/lib/localizedName'
import {
  BORNE_BY,
  DEFAULT_QUOTATION_COSTS,
  QUOTATION_BORNE_BY,
  QUOTATION_FIELD_ORDER,
  QUOTATION_FIELD_RULES,
  QUOTATION_TERMS_PERMISSION,
  quotationDefaultValidUntil,
  quotationErrorOutcome,
  quotationFormValuesOf,
  type QuotationBorneBy,
  type QuotationCostInput,
  type QuotationFormValues,
  type QuotationLineInput,
  type QuotationTerm,
  type QuotationTermTemplate,
} from '@/lib/quotations'
import {
  fetchQuotationTermTemplates,
  saveQuotation,
  type QuotationDetailData,
} from '@/lib/quotationsData'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  buildSearchFilter,
  COMPANY_PROJECT_SEARCH_FIELDS,
  NAME_SEARCH_FIELDS,
} from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { unwrapRows } from '@/lib/supabaseResult'

type LineRow = QuotationLineInput & { key: string }
type CostRow = QuotationCostInput & { key: string }

let rowSequence = 0
const nextRowKey = () => `row-${++rowSequence}`

const emptyLine = (): LineRow => ({
  key: nextRowKey(),
  equipment_type: '',
  daily_price: '',
  monthly_price: '',
  mob_demob_price: '',
  note: '',
})

const NO_ERRORS: QuotationFormErrors = { fields: {}, lines: {}, costs: {} }

/** The refusal that means the quotation is gone under the page
 *  (`invalid_quotation`: somebody deleted it). */
const STALE_MESSAGES: ReadonlySet<TranslationKey> = new Set([
  'quotationErrNotFound',
])

const PRICE_FIELDS = [
  ['daily_price', 'quotationDaily'],
  ['monthly_price', 'quotationMonthly'],
  ['mob_demob_price', 'quotationMobDemob'],
] as const

/** A stored copy whose two texts differ from its template row now. */
function termTextDiffers(
  stored: QuotationTerm,
  template: QuotationTermTemplate,
): boolean {
  return (
    stored.body_ar !== template.body_ar || stored.body_en !== template.body_en
  )
}

function FormSection({
  title,
  hint,
  aside,
  error,
  field,
  children,
}: {
  title: ReactNode
  hint: ReactNode
  aside?: ReactNode
  error?: ReactNode
  field: string
  children: ReactNode
}) {
  return (
    <section data-field={field} className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        {aside}
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {children}
    </section>
  )
}

/**
 * The equipment type of one price row: the types list (the loader of the
 * equipment form), without the types another row already uses. The loader
 * keeps its identity while those types stay the same, so an open list is not
 * read again on every render.
 */
function QuotationTypeSelect({
  id,
  value,
  usedTypes,
  invalid,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  usedTypes: readonly string[]
  invalid: boolean
  placeholder: string
  onChange: (value: string) => void
}) {
  const othersKey = JSON.stringify(usedTypes.filter((type) => type !== value))
  const loadTypes = useMemo(() => {
    const others = new Set<string>(JSON.parse(othersKey) as string[])
    return async (query: string) => {
      let request = supabase
        .from('equipment_types')
        .select('name')
        .order('name')
        .limit(20 + others.size)
      const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request)
        .filter((item) => !others.has(item.name))
        .slice(0, 20)
        .map((item) => ({ value: item.name, label: item.name }))
    }
  }, [othersKey])
  return (
    <AsyncSearchSelect
      id={id}
      size="md"
      value={value}
      selectedOption={value ? { value, label: value } : null}
      placeholder={placeholder}
      loadOptions={loadTypes}
      invalid={invalid}
      onChange={(next) => onChange(next)}
    />
  )
}

/**
 * «عرض سعر جديد» / «تعديل العرض» (migration 0199, the Figma design the owner
 * approved on 2026-11-16): the client company and an optional project, the
 * issue date (the Saudi today) and «صالح لغاية» (30 days later, following
 * the issue date until the user changes it), one price row per equipment
 * TYPE (daily, monthly, transport; at least one, each type once; NO quantity
 * or total), the costs with who bears each, the template terms to copy and
 * the notes. A holder of the template's key also adds a NEW term from here
 * (owner 2026-11-17): it is saved to the template at once, apart from the
 * quotation, and ticked. Saved in ONE `save_quotation` call: a new quotation
 * takes its official number then, and ANY saved quotation can be edited
 * (migration 0200: no stages, no lock). A refusal names its field or shows
 * its message, never the raw error.
 */
export function QuotationFormDialog({
  open,
  onOpenChange,
  quotation = null,
  onSaved,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The quotation to edit; null creates a new one. */
  quotation?: QuotationDetailData | null
  onSaved: (id: string) => void
  /** The quotation is gone under the page (deleted): the page closes the
   *  dialog and shows the message itself. */
  onStale?: (message: TranslationKey) => void
}) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  // «اضافة شرط»: a new term of the template, written under the template's
  // own key (RLS re-checks it).
  const canAddTerm = can(QUOTATION_TERMS_PERMISSION)
  const [termDialogOpen, setTermDialogOpen] = useState(false)
  const editing = quotation !== null
  const [companyId, setCompanyId] = useState('')
  const [companyOption, setCompanyOption] =
    useState<AsyncSearchSelectOption | null>(null)
  const [projectId, setProjectId] = useState('')
  const [projectOption, setProjectOption] =
    useState<AsyncSearchSelectOption | null>(null)
  const [issueDate, setIssueDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  // «صالح لغاية» follows the issue date until the user changes it; in edit
  // mode it never moves by itself.
  const [validTouched, setValidTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [costs, setCosts] = useState<CostRow[]>([])
  // The template rows to copy now (create: the ticked terms; edit: the rows
  // the quotation does not hold, or whose copy is refreshed).
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  // Edit only: the stored copies kept exactly as they are (p_keep_term_ids).
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set())
  const [templates, setTemplates] = useState<QuotationTermTemplate[]>([])
  const [templatesState, setTemplatesState] = useState<
    'loading' | 'error' | 'ready'
  >('loading')
  const [errors, setErrors] = useState<QuotationFormErrors>(NO_ERRORS)
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  // A new quotation ticks the template's default terms once, on the first
  // successful load of this opening.
  const defaultsApplied = useRef(false)
  const templatesRequest = useRef(0)

  useEffect(() => {
    if (!open) return
    defaultsApplied.current = false
    setTermDialogOpen(false)
    setErrors(NO_ERRORS)
    setMessage(null)
    setSaving(false)
    if (quotation) {
      const values = quotationFormValuesOf(
        quotation.quotation,
        quotation.lines,
        quotation.costs,
        quotation.terms,
      )
      const row = quotation.quotation
      setCompanyId(values.company_id)
      setCompanyOption({
        value: row.company_id,
        label:
          localizedName(lang, row.company_name_ar, row.company_name_en) ||
          row.company_id,
      })
      setProjectId(values.project_id)
      setProjectOption(
        row.project_id
          ? {
              value: row.project_id,
              label:
                localizedName(lang, row.project_name_ar, row.project_name_en) ||
                row.project_id,
            }
          : null,
      )
      setIssueDate(values.issue_date)
      setValidUntil(values.valid_until)
      setValidTouched(true)
      setNotes(values.notes)
      setLines(
        values.lines.length
          ? values.lines.map((line) => ({ ...line, key: nextRowKey() }))
          : [emptyLine()],
      )
      setCosts(values.costs.map((cost) => ({ ...cost, key: nextRowKey() })))
      setTicked(new Set(values.term_template_ids))
      setKeep(new Set(values.keep_term_ids))
    } else {
      const today = saudiDateKey()
      setCompanyId('')
      setCompanyOption(null)
      setProjectId('')
      setProjectOption(null)
      setIssueDate(today)
      setValidUntil(quotationDefaultValidUntil(today))
      setValidTouched(false)
      setNotes('')
      setLines([emptyLine()])
      setCosts(
        DEFAULT_QUOTATION_COSTS.map((cost) => ({ ...cost, key: nextRowKey() })),
      )
      setTicked(new Set())
      setKeep(new Set())
    }
    // The quotation is read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // `quiet`: the list stays on screen while it is read again (after a term
  // was added from this form).
  const loadTemplates = useCallback(
    async (quiet = false) => {
      const request = ++templatesRequest.current
      if (!quiet) setTemplatesState('loading')
      try {
        const rows = await fetchQuotationTermTemplates()
        if (request !== templatesRequest.current) return
        setTemplates(rows)
        setTemplatesState('ready')
        if (!editing && !defaultsApplied.current) {
          defaultsApplied.current = true
          setTicked(
            new Set(rows.filter((row) => row.is_default).map((row) => row.id)),
          )
        }
      } catch {
        if (request !== templatesRequest.current) return
        setTemplatesState('error')
      }
    },
    [editing],
  )

  // The template is read again on every opening (it may have changed).
  useEffect(() => {
    if (open) void loadTemplates()
  }, [open, loadTemplates])

  const loadNamed = useCallback(
    async (table: 'companies' | 'projects', query: string) => {
      let request = supabase
        .from(table)
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const searchFilter = buildSearchFilter(
        COMPANY_PROJECT_SEARCH_FIELDS,
        query,
      )
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [lang],
  )
  const loadCompanies = useCallback(
    (query: string) => loadNamed('companies', query),
    [loadNamed],
  )
  const loadProjects = useCallback(
    (query: string) => loadNamed('projects', query),
    [loadNamed],
  )

  const usedTypes = useMemo(
    () => lines.map((line) => line.equipment_type).filter(Boolean),
    [lines],
  )

  const clearField = (field: keyof QuotationFormValues) =>
    setErrors((current) =>
      current.fields[field]
        ? { ...current, fields: { ...current.fields, [field]: undefined } }
        : current,
    )

  const changeIssueDate = (value: string) => {
    setIssueDate(value)
    clearField('issue_date')
    if (!validTouched) {
      setValidUntil(quotationDefaultValidUntil(value))
      clearField('valid_until')
    }
  }

  const setLine = (index: number, patch: Partial<QuotationLineInput>) => {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    )
    setErrors((current) => {
      if (!current.lines[index] && !current.fields.lines) return current
      const rows = { ...current.lines }
      delete rows[index]
      return {
        ...current,
        lines: rows,
        fields: { ...current.fields, lines: undefined },
      }
    })
  }
  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, at) => at !== index))
    setErrors((current) => ({ ...current, lines: {} }))
  }
  const addLine = () => {
    setLines((current) => [...current, emptyLine()])
    clearField('lines')
  }

  const setCost = (index: number, patch: Partial<QuotationCostInput>) => {
    setCosts((current) =>
      current.map((cost, at) => (at === index ? { ...cost, ...patch } : cost)),
    )
    setErrors((current) => {
      if (!current.costs[index] && !current.fields.costs) return current
      const rows = { ...current.costs }
      delete rows[index]
      return {
        ...current,
        costs: rows,
        fields: { ...current.fields, costs: undefined },
      }
    })
  }
  const removeCost = (index: number) => {
    setCosts((current) => current.filter((_, at) => at !== index))
    setErrors((current) => ({ ...current, costs: {} }))
  }
  const addCost = () =>
    setCosts((current) => [
      ...current,
      { key: nextRowKey(), name: '', borne_by: 'client' },
    ])

  const setIn = (
    set: (
      update: (current: ReadonlySet<string>) => ReadonlySet<string>,
    ) => void,
    id: string,
    on: boolean,
  ) =>
    set(
      (current) =>
        new Set(
          on ? [...current, id] : [...current].filter((item) => item !== id),
        ),
    )
  /** A template row to copy now (create mode, or a row the quotation does
   *  not hold). */
  const setCopied = (id: string, on: boolean) => {
    setIn(setTicked, id, on)
    clearField('term_template_ids')
  }
  /** A stored copy kept as it is (edit mode). */
  const setKept = (id: string, on: boolean) => {
    setIn(setKeep, id, on)
    clearField('term_template_ids')
  }

  // Edit: the stored copy each template row stands for (the first one) and
  // the copies with no template row any more (listed last, kept by default).
  const storedByTemplate = useMemo(() => {
    const map = new Map<string, QuotationTerm>()
    for (const term of quotation?.terms ?? [])
      if (term.template_id && !map.has(term.template_id))
        map.set(term.template_id, term)
    return map
  }, [quotation])
  const orphanTerms = useMemo(
    () =>
      quotation && templatesState === 'ready'
        ? quotation.terms.filter(
            (term) =>
              !term.template_id ||
              !templates.some((template) => template.id === term.template_id) ||
              storedByTemplate.get(term.template_id)?.id !== term.id,
          )
        : [],
    [quotation, storedByTemplate, templates, templatesState],
  )
  const keptTermIds = (quotation?.terms ?? [])
    .filter((term) => keep.has(term.id))
    .map((term) => term.id)
  // «N من M محددة»: the kept copies plus the template rows ticked now.
  const tickedCount =
    keptTermIds.length +
    templates.filter((template) => ticked.has(template.id)).length
  const termsTotal = templates.length + orphanTerms.length

  const values = (): QuotationFormValues => ({
    company_id: companyId,
    project_id: projectId,
    issue_date: issueDate,
    valid_until: validUntil,
    notes,
    lines: lines.map((line) => ({
      equipment_type: line.equipment_type,
      daily_price: line.daily_price,
      monthly_price: line.monthly_price,
      mob_demob_price: line.mob_demob_price,
      note: line.note,
    })),
    costs: costs.map((cost) => ({ name: cost.name, borne_by: cost.borne_by })),
    term_template_ids: templates
      .filter((template) => ticked.has(template.id))
      .map((template) => template.id),
    keep_term_ids: editing ? keptTermIds : [],
  })

  /** The first field with a message, else the first row with one. */
  const focusProblem = (found: QuotationFormErrors) => {
    const fields = Object.fromEntries(
      Object.entries(found.fields).filter(([, key]) => Boolean(key)),
    ) as QuotationFormErrors['fields']
    if (Object.keys(fields).length) {
      focusFirstError(fields, QUOTATION_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    const row = bodyRef.current?.querySelector<HTMLElement>(
      '[data-row-invalid="true"]',
    )
    const control = row?.querySelector<HTMLElement>('input, button')
    control?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center' })
  }

  const save = async () => {
    if (saving || templatesState !== 'ready') return
    const form = values()
    const found = quotationFormErrors(form)
    if (quotationFormHasErrors(found)) {
      setErrors(found)
      setMessage(null)
      if (typeof window !== 'undefined' && window.requestAnimationFrame)
        window.requestAnimationFrame(() => focusProblem(found))
      else focusProblem(found)
      return
    }
    setErrors(NO_ERRORS)
    setMessage(null)
    setSaving(true)
    const result = await saveQuotation({
      id: quotation?.quotation.id ?? null,
      values: form,
    })
    setSaving(false)
    if (!result.error && result.data) {
      onSaved(result.data)
      return
    }
    const outcome = quotationErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, QUOTATION_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      const next = { ...NO_ERRORS, fields: outcome.fieldErrors }
      setErrors(next)
      focusProblem(next)
      // A term chosen from a template row that is gone: read it again.
      if (outcome.fieldErrors.term_template_ids) void loadTemplates()
      return
    }
    setMessage(outcome.message)
    if (STALE_MESSAGES.has(outcome.message)) onStale?.(outcome.message)
  }

  const fieldError = (field: keyof QuotationFormValues) =>
    errors.fields[field] ? t(errors.fields[field]) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        editing ? (
          <span>
            {t('quotationFormEditTitle')}{' '}
            <bdi dir="ltr">{quotation?.quotation.quote_number}</bdi>
          </span>
        ) : (
          t('quotationNew')
        )
      }
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={templatesState !== 'ready'}
            onClick={save}
          >
            {editing ? t('quotationSaveChanges') : t('quotationSaveNew')}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('quotationCompany')}
            name="company_id"
            required
            error={fieldError('company_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                size="md"
                value={companyId}
                selectedOption={companyOption}
                placeholder={t('quotationCompanyPlaceholder')}
                loadOptions={loadCompanies}
                onChange={(value, option) => {
                  setCompanyId(value)
                  setCompanyOption(option)
                  clearField('company_id')
                }}
              />
            )}
          </Field>
          <Field
            label={t('quotationProject')}
            name="project_id"
            error={fieldError('project_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                size="md"
                value={projectId}
                selectedOption={projectOption}
                placeholder={t('quotationProjectPlaceholder')}
                loadOptions={loadProjects}
                onChange={(value, option) => {
                  setProjectId(value)
                  setProjectOption(option)
                  clearField('project_id')
                }}
              />
            )}
          </Field>
          <Field
            label={t('quotationIssueDate')}
            name="issue_date"
            required
            error={fieldError('issue_date')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={issueDate}
                onChange={changeIssueDate}
              />
            )}
          </Field>
          <Field
            label={t('quotationValidUntil')}
            name="valid_until"
            required
            hint={t('quotationValidUntilHint')}
            error={fieldError('valid_until')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={validUntil}
                onChange={(value) => {
                  setValidUntil(value)
                  setValidTouched(true)
                  clearField('valid_until')
                }}
              />
            )}
          </Field>
        </div>

        {/* The prices, one row per equipment type. */}
        <FormSection
          field="lines"
          title={t('quotationPricesTitle')}
          hint={t('quotationFormPricesHint')}
          error={fieldError('lines')}
        >
          <ul className="space-y-2">
            {lines.map((line, index) => {
              const rowError = errors.lines[index]
              return (
                <li
                  key={line.key}
                  data-row-invalid={rowError ? 'true' : undefined}
                  className="space-y-2 rounded-xl border bg-bg p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-end">
                    <div className="min-w-0 space-y-1">
                      <label
                        htmlFor={`quotation-type-${line.key}`}
                        className="block text-xs text-muted"
                      >
                        {t('quotationEquipmentType')}
                      </label>
                      <QuotationTypeSelect
                        id={`quotation-type-${line.key}`}
                        value={line.equipment_type}
                        usedTypes={usedTypes}
                        invalid={Boolean(rowError)}
                        placeholder={t('quotationTypePlaceholder')}
                        onChange={(value) =>
                          setLine(index, { equipment_type: value })
                        }
                      />
                    </div>
                    {PRICE_FIELDS.map(([field, label]) => (
                      <label key={field} className="block min-w-0 space-y-1">
                        <span className="text-xs text-muted">{t(label)}</span>
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          value={line[field]}
                          invalid={Boolean(rowError)}
                          onChange={(event) =>
                            setLine(index, {
                              [field]: event.target.value,
                            } as Partial<QuotationLineInput>)
                          }
                        />
                      </label>
                    ))}
                    <IconButton
                      label={t('quotationRemoveType')}
                      title={t('quotationRemoveType')}
                      icon={<Trash2 size={15} />}
                      onClick={() => removeLine(index)}
                    />
                  </div>
                  <Input
                    value={line.note}
                    maxLength={QUOTATION_LINE_NOTE_MAX}
                    placeholder={t('quotationLineNotePlaceholder')}
                    aria-label={`${t('quotationLineNotePlaceholder')} ${line.equipment_type}`}
                    onChange={(event) =>
                      setLine(index, { note: event.target.value })
                    }
                  />
                  {rowError && (
                    <p className="text-xs text-danger" role="alert">
                      {t(rowError)}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={addLine}
          >
            {t('quotationAddType')}
          </Button>
        </FormSection>

        {/* The costs, each with who bears it. */}
        <FormSection
          field="costs"
          title={t('quotationCostsTitle')}
          hint={t('quotationFormCostsHint')}
          error={fieldError('costs')}
        >
          {costs.length > 0 && (
            <ul className="space-y-2">
              {costs.map((cost, index) => {
                const rowError = errors.costs[index]
                return (
                  <li
                    key={cost.key}
                    data-row-invalid={rowError ? 'true' : undefined}
                    className="space-y-1"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={cost.name}
                        maxLength={QUOTATION_COST_NAME_MAX}
                        placeholder={t('quotationCostName')}
                        aria-label={t('quotationCostName')}
                        invalid={Boolean(rowError)}
                        className="min-w-40 flex-1"
                        onChange={(event) =>
                          setCost(index, { name: event.target.value })
                        }
                      />
                      <Tabs
                        value={cost.borne_by}
                        onValueChange={(value) =>
                          setCost(index, {
                            borne_by: value as QuotationBorneBy,
                          })
                        }
                      >
                        <TabsList
                          variant="segmented"
                          aria-label={`${t('quotationCostBorneBy')} ${cost.name}`}
                        >
                          {QUOTATION_BORNE_BY.map((value) => (
                            <TabsTrigger key={value} value={value}>
                              {t(BORNE_BY[value].key)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                      <IconButton
                        label={t('quotationRemoveCost')}
                        title={t('quotationRemoveCost')}
                        icon={<Trash2 size={15} />}
                        onClick={() => removeCost(index)}
                      />
                    </div>
                    {rowError && (
                      <p className="text-xs text-danger" role="alert">
                        {t(rowError)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={addCost}
          >
            {t('quotationAddCost')}
          </Button>
        </FormSection>

        {/* The template terms to copy into this quotation. */}
        <FormSection
          field="term_template_ids"
          title={t('quotationTermsTitle')}
          hint={t('quotationFormTermsHint')}
          error={fieldError('term_template_ids')}
          aside={
            templatesState === 'ready' && (termsTotal > 0 || canAddTerm) ? (
              <span className="flex flex-wrap items-center gap-3">
                {termsTotal > 0 && (
                  <span className="text-xs text-muted">
                    {t('quotationTermsSelectedCount')
                      .replace('{count}', String(tickedCount))
                      .replace('{total}', String(termsTotal))}
                  </span>
                )}
                {canAddTerm && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Plus size={14} aria-hidden="true" />}
                    disabled={saving}
                    onClick={() => setTermDialogOpen(true)}
                  >
                    {t('quotationTermAdd')}
                  </Button>
                )}
              </span>
            ) : undefined
          }
        >
          {templatesState === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : templatesState === 'error' ? (
            <ErrorState
              description={t('quotationTermsLoadError')}
              onRetry={() => void loadTemplates()}
              className="p-4"
            />
          ) : (
            <>
              {templates.length === 0 ? (
                <p className="rounded-xl border border-dashed p-3 text-sm text-muted">
                  {t(
                    canAddTerm
                      ? 'quotationTermsTemplateNone'
                      : 'quotationTermsTemplateEmpty',
                  )}
                </p>
              ) : (
                <ul className="space-y-2">
                  {templates.map((template) => {
                    const id = `quotation-term-${template.id}`
                    // Edit: the copy the quotation holds of this row. It is
                    // shown with its STORED text; an edit never refreshes it
                    // unless the user asks.
                    const stored = storedByTemplate.get(template.id)
                    const kept = stored ? keep.has(stored.id) : false
                    const copied = ticked.has(template.id)
                    const shown = stored && !copied ? stored : template
                    const differs = stored
                      ? termTextDiffers(stored, template)
                      : false
                    return (
                      <li
                        key={template.id}
                        className="rounded-xl border bg-bg p-3"
                      >
                        <label
                          htmlFor={id}
                          className="flex cursor-pointer items-start gap-3"
                        >
                          <Checkbox
                            id={id}
                            className="mt-0.5"
                            checked={kept || copied}
                            onCheckedChange={(value) => {
                              const on = value === true
                              if (!stored) {
                                setCopied(template.id, on)
                                return
                              }
                              // Ticked again: the stored copy comes back.
                              setKept(stored.id, on)
                              if (!on) setCopied(template.id, false)
                            }}
                          />
                          <span className="block min-w-0 flex-1 whitespace-pre-wrap break-words text-start text-sm">
                            {shown.body_ar}
                          </span>
                        </label>
                        {stored && differs && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 ps-8">
                            <span className="text-xs text-muted">
                              {t('quotationTermTextDiffers')}
                            </span>
                            {kept && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setKept(stored.id, false)
                                  setCopied(template.id, true)
                                }}
                              >
                                {t('quotationTermRefresh')}
                              </Button>
                            )}
                            {copied && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setCopied(template.id, false)
                                  setKept(stored.id, true)
                                }}
                              >
                                {t('quotationTermKeepStored')}
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {orphanTerms.length > 0 && (
                <ul className="space-y-2">
                  {orphanTerms.map((term) => {
                    const id = `quotation-kept-term-${term.id}`
                    return (
                      <li
                        key={term.id}
                        className="rounded-xl border border-dashed p-3"
                      >
                        <label
                          htmlFor={id}
                          className="flex cursor-pointer items-start gap-3"
                        >
                          <Checkbox
                            id={id}
                            className="mt-0.5"
                            checked={keep.has(term.id)}
                            onCheckedChange={(value) =>
                              setKept(term.id, value === true)
                            }
                          />
                          <span className="min-w-0 flex-1 space-y-0.5 text-start">
                            <span className="block text-xs text-muted">
                              {t('quotationOrphanTerm')}
                            </span>
                            <span className="block whitespace-pre-wrap break-words text-sm">
                              {term.body_ar}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </FormSection>

        <Field
          label={t('notes')}
          name="notes"
          hint={t('quotationNotesHint')}
          error={fieldError('notes')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={QUOTATION_NOTES_MAX}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)
                clearField('notes')
              }}
            />
          )}
        </Field>
      </div>
      {canAddTerm && (
        <QuotationTermFormDialog
          open={termDialogOpen}
          onOpenChange={setTermDialogOpen}
          note={t('quotationTermAddNote')}
          onSaved={(id) => {
            setTermDialogOpen(false)
            // The new term is ticked for this quotation, then the template
            // is read again so it shows in its place.
            setCopied(id, true)
            void loadTemplates(true)
          }}
        />
      )}
    </Dialog>
  )
}
