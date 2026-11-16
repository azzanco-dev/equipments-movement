import type { ListFilter } from '@/components/data-list/types'
import type { BadgeTone } from '@/components/ui/Badge'
import type { Language, TranslationKey } from '@/i18n/translations'
import type {
  DatabaseFieldRule,
  FieldErrors,
  PostgresLikeError,
} from '@/lib/formValidation'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * quotations (0199) — the pure part of «عروض الاسعار» (owner decisions
 * 2026-11-16): a price list for a CLIENT (a company, an optional project),
 * one line per equipment TYPE with three optional prices excluding VAT
 * (daily, monthly, transport «النقل mob/demob»), a list of costs with who
 * bears each, and the terms copied from the Settings template. No
 * quantities, no totals. A draft carries the reference `QD-####`; the first
 * approval issues the official number `QT-YYYYMM####`.
 *
 * The labels, the badge tones, the days-left words, the form → RPC payloads
 * and the mapping of every 0199 error token live here. Nothing here calls
 * the database (the data side is `src/lib/quotationsData.ts`), so the node
 * tests can load it directly.
 */

// --- States --------------------------------------------------------------------

/** `quotations.status` (the stored state). */
export type QuotationStatus = 'draft' | 'approved'

/** The client's answer of an approved quotation. */
export type QuotationOutcome = 'accepted' | 'rejected'

/** `quotation_list.state`: the stored state with the answer and «منتهي»
 *  (approved, no answer, `valid_until` before the Saudi today). */
export type QuotationState =
  'draft' | 'approved' | 'accepted' | 'rejected' | 'expired'

export const QUOTATION_STATES: readonly QuotationState[] = [
  'draft',
  'approved',
  'accepted',
  'rejected',
  'expired',
]

/** The shared badge of each state: مسودة neutral, معتمد info, مقبول
 *  success, مرفوض danger, منتهي warning. */
export const QUOTATION_STATE_BADGE: Readonly<
  Record<QuotationState, { key: TranslationKey; tone: BadgeTone }>
> = {
  draft: { key: 'quotationStateDraft', tone: 'neutral' },
  approved: { key: 'quotationStateApproved', tone: 'info' },
  accepted: { key: 'quotationStateAccepted', tone: 'success' },
  rejected: { key: 'quotationStateRejected', tone: 'danger' },
  expired: { key: 'quotationStateExpired', tone: 'warning' },
}

/** The English state of the PDF corner («Status: Draft»). */
export const QUOTATION_PRINT_STATE_KEYS: Readonly<
  Record<QuotationState, TranslationKey>
> = {
  draft: 'quotationStateDraft',
  approved: 'quotationStateApproved',
  accepted: 'quotationStateAccepted',
  rejected: 'quotationStateRejected',
  // The sheet prints the stored state; an expired quotation is approved.
  expired: 'quotationStateApproved',
}

function isQuotationState(value: unknown): value is QuotationState {
  return (
    typeof value === 'string' &&
    (QUOTATION_STATES as readonly string[]).includes(value)
  )
}

/**
 * The state of a quotation: the view's `state` when it carries one, else the
 * same rule computed from the row (accepted / rejected win, then expired).
 */
export function quotationStateOf(
  row: Pick<QuotationRow, 'status' | 'outcome' | 'valid_until'> & {
    state?: string | null
  },
  today: string = saudiDateKey(),
): QuotationState {
  if (isQuotationState(row.state)) return row.state
  if (row.status !== 'approved') return 'draft'
  if (row.outcome === 'accepted' || row.outcome === 'rejected')
    return row.outcome
  return row.valid_until < today ? 'expired' : 'approved'
}

/** The days-left words are shown while the quotation waits for the
 *  client's answer: approved without one, or expired. */
export function showsDaysLeft(state: QuotationState): boolean {
  return state === 'approved' || state === 'expired'
}

// --- Numbers -------------------------------------------------------------------

/** A draft reference `QD-####` (mirrors the 0199 CHECK). */
export const QUOTATION_DRAFT_REF_PATTERN = /^QD-[0-9]{4,}$/

/** An issued number `QT-YYYYMM####` (mirrors the 0199 CHECK). */
export const QUOTATION_NUMBER_PATTERN = /^QT-[0-9]{10,}$/

export function isQuotationDraftRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && QUOTATION_DRAFT_REF_PATTERN.test(value)
}

// --- Rows ----------------------------------------------------------------------

/** A row of the security_invoker view `quotation_list`. */
export interface QuotationRow {
  id: string
  company_id: string
  project_id: string | null
  quote_number: string
  status: QuotationStatus
  issue_date: string
  valid_until: string
  notes: string | null
  approved_at: string | null
  approved_by: string | null
  outcome: QuotationOutcome | null
  outcome_at: string | null
  outcome_by: string | null
  outcome_note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  created_by_name: string | null
  approved_by_name: string | null
  state: QuotationState
  line_count: number | null
  /** The lines' types joined with «، » in position order. */
  type_names: string | null
}

/** A `quotation_lines` row. Prices come back as numeric text or numbers. */
export interface QuotationLine {
  id: string
  quotation_id: string
  equipment_type: string
  daily_price: number | string | null
  monthly_price: number | string | null
  mob_demob_price: number | string | null
  note: string | null
  position: number
}

/** Who bears a cost: the client, or Al-Azani (`lessor`). */
export type QuotationBorneBy = 'client' | 'lessor'

export interface QuotationCost {
  id: string
  quotation_id: string
  name: string
  borne_by: QuotationBorneBy
  position: number
}

/** A term COPIED into a quotation (later template edits never change it). */
export interface QuotationTerm {
  id: string
  quotation_id: string
  /** The template row it was copied from; null once that row is gone. */
  template_id: string | null
  title_ar: string
  title_en: string
  body_ar: string
  body_en: string
  position: number
}

/** A row of the Settings template `quotation_term_templates`. */
export interface QuotationTermTemplate {
  id: string
  title_ar: string
  title_en: string
  body_ar: string
  body_en: string
  position: number
  /** «محدد تلقائيا في العرض الجديد». */
  is_default: boolean
  created_at: string
  updated_at: string
}

// --- Costs ---------------------------------------------------------------------

export const QUOTATION_BORNE_BY: readonly QuotationBorneBy[] = [
  'client',
  'lessor',
]

/** «على العميل» / «على العزاني» (English «Client» / «Al-Azani»). */
export const BORNE_BY: Readonly<
  Record<QuotationBorneBy, { key: TranslationKey; tone: BadgeTone }>
> = {
  client: { key: 'quotationBorneByClient', tone: 'info' },
  lessor: { key: 'quotationBorneByLessor', tone: 'neutral' },
}

/** The PDF's «العميل / Client», «العزاني / Al-Azani». */
export const BORNE_BY_PRINT_KEYS: Readonly<
  Record<QuotationBorneBy, TranslationKey>
> = {
  client: 'quotationPrintBorneClient',
  lessor: 'quotationPrintBorneLessor',
}

/** The costs a NEW quotation starts with (owner 2026-11-16). They are data
 *  the user may rename or remove, so they stay as stored text. */
export const DEFAULT_QUOTATION_COSTS: readonly QuotationCostInput[] = [
  { name: 'الديزل', borne_by: 'client' },
  { name: 'المعيشة (الاكل والسكن)', borne_by: 'lessor' },
]

// --- Form → RPC ----------------------------------------------------------------

/** One price row of the form (the inputs as typed). */
export interface QuotationLineInput {
  equipment_type: string
  daily_price: string
  monthly_price: string
  mob_demob_price: string
  note: string
}

export interface QuotationCostInput {
  name: string
  borne_by: QuotationBorneBy
}

/** The values of the quotation form (create and edit of a draft). */
export interface QuotationFormValues {
  company_id: string
  /** Empty = no project. */
  project_id: string
  issue_date: string
  valid_until: string
  notes: string
  lines: QuotationLineInput[]
  costs: QuotationCostInput[]
  /** The template rows to copy NOW: in create mode the ticked terms; in
   *  edit mode only the template rows the quotation does not hold (or whose
   *  copy the user refreshes from the template). */
  term_template_ids: string[]
  /** Edit only: the stored `quotation_terms` rows kept exactly as they are
   *  (`p_keep_term_ids`); an edit never refreshes a term by itself. */
  keep_term_ids: string[]
}

export const QUOTATION_FIELD_ORDER: readonly (keyof QuotationFormValues)[] = [
  'company_id',
  'project_id',
  'issue_date',
  'valid_until',
  'lines',
  'costs',
  'term_template_ids',
  'notes',
]

/** Arabic-Indic digits and separators read as Latin. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٬,]/g, '')
    .replace(/٫/g, '.')
}

/** A typed price: empty = no price (null); otherwise its number (NaN when
 *  it is not one, which the schema reports before saving). */
export function parseQuotationPrice(value: string): number | null {
  const text = latinDigits(value).trim()
  if (!text) return null
  return Number(text)
}

/** The form's lines as `save_quotation`'s `p_lines` (array order =
 *  position). */
export function quotationLinesPayload(lines: readonly QuotationLineInput[]): {
  equipment_type: string
  daily_price: number | null
  monthly_price: number | null
  mob_demob_price: number | null
  note: string | null
}[] {
  return lines.map((line) => ({
    equipment_type: line.equipment_type.trim(),
    daily_price: parseQuotationPrice(line.daily_price),
    monthly_price: parseQuotationPrice(line.monthly_price),
    mob_demob_price: parseQuotationPrice(line.mob_demob_price),
    note: line.note.trim() || null,
  }))
}

/** The form's costs as `save_quotation`'s `p_costs` (array order =
 *  position). */
export function quotationCostsPayload(
  costs: readonly QuotationCostInput[],
): { name: string; borne_by: QuotationBorneBy }[] {
  return costs.map((cost) => ({
    name: cost.name.trim(),
    borne_by: cost.borne_by,
  }))
}

/** A stored price as the form's text ('' = no price). */
export function quotationPriceInput(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  const amount = Number(value)
  return Number.isFinite(amount) ? String(amount) : ''
}

/** A saved quotation as the edit form's starting values. */
export function quotationFormValuesOf(
  row: Pick<
    QuotationRow,
    'company_id' | 'project_id' | 'issue_date' | 'valid_until' | 'notes'
  >,
  lines: readonly QuotationLine[],
  costs: readonly QuotationCost[],
  terms: readonly QuotationTerm[],
): QuotationFormValues {
  return {
    company_id: row.company_id,
    project_id: row.project_id ?? '',
    issue_date: row.issue_date,
    valid_until: row.valid_until,
    notes: row.notes ?? '',
    lines: lines.map((line) => ({
      equipment_type: line.equipment_type,
      daily_price: quotationPriceInput(line.daily_price),
      monthly_price: quotationPriceInput(line.monthly_price),
      mob_demob_price: quotationPriceInput(line.mob_demob_price),
      note: line.note ?? '',
    })),
    costs: costs.map((cost) => ({ name: cost.name, borne_by: cost.borne_by })),
    // Every stored copy is kept as it is; nothing is copied anew until the
    // user ticks a template row the quotation does not hold.
    term_template_ids: [],
    keep_term_ids: terms.map((term) => term.id),
  }
}

/** The values of the Settings template dialog. */
export interface QuotationTermTemplateFormValues {
  title_ar: string
  title_en: string
  body_ar: string
  body_en: string
  /** Empty = at the end (the database places it). */
  position: string
  is_default: boolean
}

/** The template row the dialog writes (a position of 0 = at the end). */
export function quotationTermTemplatePayload(
  values: QuotationTermTemplateFormValues,
): {
  title_ar: string
  title_en: string
  body_ar: string
  body_en: string
  position: number
  is_default: boolean
} {
  const position = Number(latinDigits(values.position).trim())
  return {
    title_ar: values.title_ar.trim(),
    title_en: values.title_en.trim(),
    body_ar: values.body_ar.trim(),
    body_en: values.body_en.trim(),
    position: Number.isInteger(position) && position > 0 ? position : 0,
    is_default: values.is_default,
  }
}

// --- Words ---------------------------------------------------------------------

const DAY_MS = 86_400_000

/** Whole days from `from` to `to` (two `YYYY-MM-DD` keys). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  )
}

/** A new quotation is valid for 30 days from its issue date (B2). */
export const QUOTATION_VALIDITY_DAYS = 30

/** `YYYY-MM-DD` plus `days` (a calendar day key, no time zone). */
export function addDaysToKey(key: string, days: number): string {
  const time = Date.parse(`${key}T00:00:00Z`)
  if (Number.isNaN(time)) return ''
  return new Date(time + days * DAY_MS).toISOString().slice(0, 10)
}

/** «صالح لغاية» of the form while the user has not changed it. */
export function quotationDefaultValidUntil(issueDate: string): string {
  return issueDate ? addDaysToKey(issueDate, QUOTATION_VALIDITY_DAYS) : ''
}

/** «يوم», «يومين», «5 ايام», «27 يوم»; «1 day», «5 days». */
export function dayCountWords(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'day' : 'days'}`
  if (count === 1) return 'يوم'
  if (count === 2) return 'يومين'
  if (count >= 3 && count <= 10) return `${count} ايام`
  return `${count} يوم`
}

/**
 * The days left of a quotation (owner 2026-11-16): «باقي 27 يوم», «ينتهي
 * اليوم», «انتهى قبل 5 ايام»; «27 days left», «Ends today», «Ended 5 days
 * ago». `today` is the Saudi today.
 */
export function daysLeftLabel(
  validUntil: string,
  today: string = saudiDateKey(),
  lang: Language = 'ar',
): string {
  const days = daysBetween(today, validUntil)
  if (days === 0) return lang === 'en' ? 'Ends today' : 'ينتهي اليوم'
  if (days > 0)
    return lang === 'en'
      ? `${dayCountWords(days, lang)} left`
      : `باقي ${dayCountWords(days, lang)}`
  return lang === 'en'
    ? `Ended ${dayCountWords(-days, lang)} ago`
    : `انتهى قبل ${dayCountWords(-days, lang)}`
}

/** «نوع واحد», «نوعين», «3 انواع», «12 نوع»; «1 type», «3 types». */
export function quotationTypeCountLabel(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'type' : 'types'}`
  if (count === 1) return 'نوع واحد'
  if (count === 2) return 'نوعين'
  if (count >= 3 && count <= 10) return `${count} انواع`
  return `${count} نوع`
}

// --- Rules of the page ---------------------------------------------------------

/** Why «اعتماد» cannot run now (a quotation without lines), or null. */
export function quotationApprovalBlocker(
  lineCount: number,
): TranslationKey | null {
  return lineCount > 0 ? null : 'quotationErrNoLines'
}

/** Only a draft that still carries its draft reference is deleted
 *  (`delete_quotation`: an issued number is never given back). */
export function canDeleteQuotation(
  row: Pick<QuotationRow, 'status' | 'quote_number'>,
): boolean {
  return row.status === 'draft' && isQuotationDraftRef(row.quote_number)
}

// --- List filters --------------------------------------------------------------

/** The `date` columns of `quotation_list` the list filters by range. */
export const QUOTATION_DATE_FILTER_FIELDS: ReadonlySet<string> = new Set([
  'issue_date',
  'valid_until',
])

/** A Saudi-day bound of the date range control as the day it names. */
function asDayKey(value: string | undefined): string | undefined {
  if (!value) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : saudiDateKey(new Date(time))
}

/**
 * The date range control sends Saudi-day INSTANTS (the start of the first
 * day, the last instant of the last); `issue_date` and `valid_until` are
 * plain `date` columns, where PostgreSQL would read the start instant as
 * the day before. The two filters are turned into the days they name.
 */
export function quotationDateFilters(
  filters: readonly ListFilter[],
): ListFilter[] {
  return filters.map((filter) =>
    QUOTATION_DATE_FILTER_FIELDS.has(filter.field)
      ? {
          ...filter,
          value: asDayKey(filter.value) ?? filter.value,
          valueTo: asDayKey(filter.valueTo),
        }
      : filter,
  )
}

/** The id of the quick state filter of the list's segmented tabs. */
export const QUOTATION_QUICK_STATE_FILTER_ID = 'quick-state'

/** The quick tab a filter list selects: «الكل» without a state filter, the
 *  state when exactly one state is filtered, else null (a mixed filter). */
export function quotationQuickState(
  filters: readonly ListFilter[],
): QuotationState | 'all' | null {
  const stateFilters = filters.filter((filter) => filter.field === 'state')
  if (stateFilters.length === 0) return 'all'
  if (stateFilters.length > 1) return null
  const [only] = stateFilters
  if (only.operator !== 'in' && only.operator !== 'eq') return null
  const values = only.value.split(',').filter(Boolean)
  return values.length === 1 && isQuotationState(values[0]) ? values[0] : null
}

/** The filters after a quick tab: the state filters replaced by the one
 *  state, or removed for «الكل». */
export function withQuickState(
  filters: readonly ListFilter[],
  state: QuotationState | 'all',
): ListFilter[] {
  const rest = filters.filter((filter) => filter.field !== 'state')
  if (state === 'all') return rest
  return [
    ...rest,
    {
      id: QUOTATION_QUICK_STATE_FILTER_ID,
      field: 'state',
      operator: 'in',
      value: state,
    },
  ]
}

// --- The 0199 error tokens -----------------------------------------------------

/** Tokens of `save_quotation` that name one field of the form. `invalid_notes`
 *  comes before `invalid_note`: the shorter token is part of the longer. */
export const QUOTATION_FIELD_RULES: readonly DatabaseFieldRule<QuotationFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_company',
      field: 'company_id',
      key: 'quotationErrInvalidCompany',
    },
    {
      on: 'raised',
      match: 'invalid_project',
      field: 'project_id',
      key: 'quotationErrInvalidProject',
    },
    {
      on: 'raised',
      match: 'invalid_dates',
      field: 'valid_until',
      key: 'quotationErrInvalidDates',
    },
    {
      on: 'raised',
      match: 'invalid_notes',
      field: 'notes',
      key: 'quotationErrNotesTooLong',
    },
    {
      on: 'raised',
      match: 'quotation_has_no_lines',
      field: 'lines',
      key: 'quotationErrNoLines',
    },
    {
      on: 'raised',
      match: 'invalid_lines',
      field: 'lines',
      key: 'quotationErrInvalidLines',
    },
    {
      on: 'raised',
      match: 'invalid_equipment_type',
      field: 'lines',
      key: 'quotationErrInvalidType',
    },
    {
      on: 'raised',
      match: 'duplicate_equipment_type',
      field: 'lines',
      key: 'quotationErrDuplicateType',
    },
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'lines',
      key: 'quotationErrInvalidPrice',
    },
    {
      on: 'raised',
      match: 'line_has_no_price',
      field: 'lines',
      key: 'quotationErrLineNoPrice',
    },
    {
      on: 'raised',
      match: 'invalid_note',
      field: 'lines',
      key: 'quotationErrLineNoteTooLong',
    },
    {
      on: 'raised',
      match: 'invalid_costs',
      field: 'costs',
      key: 'quotationErrInvalidCosts',
    },
    {
      on: 'raised',
      match: 'invalid_cost_name',
      field: 'costs',
      key: 'quotationErrCostName',
    },
    {
      on: 'raised',
      match: 'invalid_borne_by',
      field: 'costs',
      key: 'quotationErrBorneBy',
    },
    {
      on: 'raised',
      match: 'invalid_terms',
      field: 'term_template_ids',
      key: 'quotationErrInvalidTerms',
    },
  ]

/** Every token of migration 0199 → its safe message. */
export const QUOTATION_FORM_MESSAGES: Readonly<Record<string, TranslationKey>> =
  {
    sales_manage_required: 'quotationErrManageRequired',
    quotation_approve_required: 'quotationErrApproveRequired',
    invalid_quotation: 'quotationErrNotFound',
    quotation_approved_locked: 'quotationErrApprovedLocked',
    quotation_not_draft: 'quotationErrNotDraft',
    quotation_not_approved: 'quotationErrNotApproved',
    quotation_number_issued: 'quotationErrNumberIssued',
    quotation_has_no_lines: 'quotationErrNoLines',
    invalid_company: 'quotationErrInvalidCompany',
    invalid_project: 'quotationErrInvalidProject',
    invalid_dates: 'quotationErrInvalidDates',
    invalid_notes: 'quotationErrNotesTooLong',
    invalid_lines: 'quotationErrInvalidLines',
    invalid_equipment_type: 'quotationErrInvalidType',
    duplicate_equipment_type: 'quotationErrDuplicateType',
    invalid_price: 'quotationErrInvalidPrice',
    line_has_no_price: 'quotationErrLineNoPrice',
    // The line note of save_quotation, the note of the return and of the
    // client's answer: one length rule.
    invalid_note: 'quotationErrNoteTooLong',
    invalid_costs: 'quotationErrInvalidCosts',
    invalid_cost_name: 'quotationErrCostName',
    invalid_borne_by: 'quotationErrBorneBy',
    invalid_terms: 'quotationErrInvalidTerms',
    invalid_outcome: 'quotationErrInvalidOutcome',
  }

/** Every stable token of migration 0199, for the tests. */
export const QUOTATION_ERROR_TOKENS: readonly string[] = Object.keys(
  QUOTATION_FORM_MESSAGES,
)

function errorText(error: PostgresLikeError): string {
  return [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** The tokens, the longest first, so `invalid_note` never answers for
 *  `invalid_notes`. */
const TOKENS_LONGEST_FIRST = Object.entries(QUOTATION_FORM_MESSAGES).sort(
  ([a], [b]) => b.length - a.length,
)

/**
 * The safe message of a rejected quotation write: the token's message, else
 * the generic «تعذر الحفظ». The raw database text is never shown.
 */
export function quotationErrorMessage(
  error: PostgresLikeError | null | undefined,
): TranslationKey {
  if (!error) return 'quotationSaveFailed'
  const text = errorText(error)
  for (const [token, key] of TOKENS_LONGEST_FIRST)
    if (text.includes(token)) return key
  return 'quotationSaveFailed'
}

/**
 * How the form reports a rejection: a field message when a field rule
 * matches, else one form-level message. `mapField` is
 * `mapDatabaseErrorToField` bound to `QUOTATION_FIELD_RULES`.
 */
export function quotationErrorOutcome(
  error: PostgresLikeError | null | undefined,
  mapField: (
    error: PostgresLikeError,
  ) => FieldErrors<QuotationFormValues> | null,
):
  | { fieldErrors: FieldErrors<QuotationFormValues> }
  | { message: TranslationKey } {
  if (error) {
    const fieldErrors = mapField(error)
    if (fieldErrors) return { fieldErrors }
  }
  return { message: quotationErrorMessage(error) }
}
