import type { Language, TranslationKey } from '@/i18n/translations'
import type {
  DatabaseFieldRule,
  FieldErrors,
  PostgresLikeError,
} from '@/lib/formValidation'
import { SUPPLIER_PO_PRICE_PATTERN, vatOf, withVat } from '@/lib/purchasing'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * sales-screens — the pure, reusable part of the sales phase-1 screens
 * (migration 0169: client POs «PO العملاء», their lines on the shared
 * «كرت المعدة» and the append-only event log). The screens under
 * `src/screens/sales` and the dialogs under `src/components/sales` bring
 * this module along: the status / event labels, the price unit (month, day
 * or hour on the client side), the per-unit totals, the contract quantity
 * words and the mapping of the 0169 error tokens to form fields and
 * messages. Nothing here calls the database.
 *
 * Phase 2 («كروت التشغيل», migration 0172) adds, at the end of this file,
 * the month keys and labels, the live due rule that mirrors
 * `card_month_due`, the contract-hours rule, the month states, the card
 * event details and the mapping of the 0172 tokens.
 *
 * The only runtime imports are the pure `@/lib/purchasing` (its price
 * pattern and VAT math) and `@/lib/saudiTime` (the Saudi day), so the node
 * tests can still load it directly.
 */

// --- Status and events --------------------------------------------------------

export type ClientPoStatus = 'open' | 'closed'

/** The shared status badge: open = success tone, closed = muted neutral. */
export const CLIENT_PO_STATUS_BADGE: Readonly<
  Record<ClientPoStatus, { key: TranslationKey; tone: 'success' | 'neutral' }>
> = {
  open: { key: 'supplierPoStatusOpen', tone: 'success' },
  closed: { key: 'supplierPoStatusClosed', tone: 'neutral' },
}

/** `client_po_events.event_type` (the CHECK list of 0169). */
export type ClientPoEventType =
  | 'created'
  | 'updated'
  | 'equipment_added'
  | 'line_updated'
  | 'price_changed'
  | 'closed'

export const CLIENT_PO_EVENT_LABEL_KEYS: Readonly<
  Record<ClientPoEventType, TranslationKey>
> = {
  created: 'clientPoEventCreated',
  updated: 'clientPoEventUpdated',
  equipment_added: 'supplierPoEventEquipmentAdded',
  line_updated: 'clientPoEventLineUpdated',
  price_changed: 'supplierPoEventPriceChanged',
  closed: 'clientPoEventClosed',
}

/** The PO page shows the latest events only, never a full list. */
export const CLIENT_PO_EVENTS_LIMIT = 20

/** «كرت المعدة»: open while `period_to` is NULL, else ended. */
export type EquipmentCardStatus = 'open' | 'ended'

export const EQUIPMENT_CARD_STATUS_BADGE: Readonly<
  Record<
    EquipmentCardStatus,
    { key: TranslationKey; tone: 'success' | 'neutral' }
  >
> = {
  open: { key: 'equipmentCardStatusOpen', tone: 'success' },
  ended: { key: 'equipmentCardStatusEnded', tone: 'neutral' },
}

export function equipmentCardStatus(card: {
  is_open?: boolean | null
  period_to?: string | null
}): EquipmentCardStatus {
  if (typeof card.is_open === 'boolean') return card.is_open ? 'open' : 'ended'
  return card.period_to ? 'ended' : 'open'
}

// --- The price unit: month, day or hour (0169) ------------------------------------

/** `client_po_equipment.rate_unit`: the SALE price is per month, per day or
 *  per hour (owner 2026-11-01); the supplier side has no hourly unit. */
export type SaleRateUnit = 'month' | 'day' | 'hour'

export const SALE_RATE_UNITS: readonly SaleRateUnit[] = ['month', 'day', 'hour']

export const SALE_DEFAULT_RATE_UNIT: SaleRateUnit = 'month'

/** The unit's name in a select («شهري» / «يومي» / «بالساعة»). */
export const SALE_RATE_UNIT_LABEL_KEYS: Readonly<
  Record<SaleRateUnit, TranslationKey>
> = {
  month: 'supplierPoRateUnitMonth',
  day: 'supplierPoRateUnitDay',
  hour: 'saleRateUnitHour',
}

/** The suffix after an amount («/ شهر» / «/ يوم» / «/ ساعة»). */
export const SALE_PER_UNIT_KEYS: Readonly<
  Record<SaleRateUnit, TranslationKey>
> = {
  month: 'supplierPoPerMonth',
  day: 'supplierPoPerDay',
  hour: 'salePerHour',
}

export function isSaleRateUnit(
  value: string | null | undefined,
): value is SaleRateUnit {
  return (SALE_RATE_UNITS as readonly string[]).includes(value ?? '')
}

/** A stored unit, or month for anything else. */
export function saleRateUnitOf(value: string | null | undefined): SaleRateUnit {
  return isSaleRateUnit(value) ? value : SALE_DEFAULT_RATE_UNIT
}

/**
 * The PO's totals excluding VAT, one per unit present on its lines, month →
 * day → hour (the purchasing rule: a monthly, a daily and an hourly price
 * are never added together). Unpriced lines count towards their unit's
 * presence but not its total; a PO without lines totals 0 per month.
 */
export function clientPoTotalsByUnit(
  lines: readonly {
    price: number | string | null
    rate_unit?: string | null
  }[],
): { parts: { unit: SaleRateUnit; total: number }[]; unpriced: number } {
  const totals = new Map<SaleRateUnit, number>()
  let unpriced = 0
  for (const line of lines) {
    const unit = saleRateUnitOf(line.rate_unit)
    const price =
      line.price === null || line.price === undefined ? NaN : Number(line.price)
    if (Number.isNaN(price)) unpriced += 1
    totals.set(
      unit,
      (totals.get(unit) ?? 0) + (Number.isNaN(price) ? 0 : price),
    )
  }
  const parts = SALE_RATE_UNITS.filter((unit) => totals.has(unit)).map(
    (unit) => ({
      unit,
      total: Math.round((totals.get(unit) ?? 0) * 100) / 100,
    }),
  )
  return {
    parts: parts.length ? parts : [{ unit: SALE_DEFAULT_RATE_UNIT, total: 0 }],
    unpriced,
  }
}

/** The three figures of one unit's total: before VAT, the VAT, with VAT. */
export function clientPoTotalFigures(total: number) {
  return { exclVat: total, vat: vatOf(total), inclVat: withVat(total) }
}

// --- Standard hours and the contract quantity --------------------------------------

/** `client_pos.standard_hours` default (260 hours a month). */
export const CLIENT_PO_STANDARD_HOURS_DEFAULT = 260

/** A positive whole number of hours (the database checks `> 0`). */
export const CLIENT_PO_STANDARD_HOURS_PATTERN = /^\d{1,5}$/

export function isValidStandardHours(value: string): boolean {
  const trimmed = value.trim()
  return CLIENT_PO_STANDARD_HOURS_PATTERN.test(trimmed) && Number(trimmed) > 0
}

/** The contract quantity: numeric(12, 2) above zero, in the line's unit. */
export function isValidClientPoQuantity(value: string): boolean {
  const trimmed = value.trim()
  return SUPPLIER_PO_PRICE_PATTERN.test(trimmed) && Number(trimmed) > 0
}

/** The sale price as typed: the same bound as the supplier price. */
export function isValidSalePrice(value: string): boolean {
  return SUPPLIER_PO_PRICE_PATTERN.test(value.trim())
}

const ARABIC_QUANTITY_WORDS: Readonly<
  Record<SaleRateUnit, { one: string; two: string; few: string; many: string }>
> = {
  month: { one: 'شهر', two: 'شهرين', few: 'اشهر', many: 'شهرا' },
  day: { one: 'يوم', two: 'يومين', few: 'ايام', many: 'يوما' },
  hour: { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' },
}

const ENGLISH_QUANTITY_WORDS: Readonly<
  Record<SaleRateUnit, { one: string; many: string }>
> = {
  month: { one: 'month', many: 'months' },
  day: { one: 'day', many: 'days' },
  hour: { one: 'hour', many: 'hours' },
}

/**
 * «6 اشهر» / «400 ساعة» / «يومين»: the contract quantity in words, in the
 * LINE's price unit (0169: the quantity is counted in `rate_unit`), or null
 * without a ceiling. Arabic uses the dual and the 3–10 plural; a fraction
 * keeps the singular («2.5 شهر»).
 */
export function quantityLabel(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
  lang: Language,
): string | null {
  const amount = typeof quantity === 'string' ? Number(quantity) : quantity
  if (amount === null || amount === undefined || Number.isNaN(amount))
    return null
  const rateUnit = saleRateUnitOf(unit)
  const whole = Number.isInteger(amount)
  const text = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(amount)
  if (lang === 'en') {
    const words = ENGLISH_QUANTITY_WORDS[rateUnit]
    return `${text} ${amount === 1 ? words.one : words.many}`
  }
  const words = ARABIC_QUANTITY_WORDS[rateUnit]
  if (!whole) return `${text} ${words.one}`
  if (amount === 1) return words.one
  if (amount === 2) return words.two
  if (amount <= 10) return `${text} ${words.few}`
  return `${text} ${words.many}`
}

// --- Form values -------------------------------------------------------------------

/** The form values of «PO عميل جديد» (create_client_po). */
export interface ClientPoFormValues {
  company_id: string
  project_id: string
  /** The client's own PO number, as received. */
  po_number: string
  /** A date key (YYYY-MM-DD). */
  issue_date: string
  /** A date key, or empty for no expiry. */
  expiry_date: string
  /** As typed; the PO's default for its lines (260). */
  standard_hours: string
  notes: string
}

export const CLIENT_PO_FIELD_ORDER: readonly (keyof ClientPoFormValues)[] = [
  'company_id',
  'project_id',
  'po_number',
  'issue_date',
  'expiry_date',
  'standard_hours',
  'notes',
]

/** The form values of «اضافة معدة» (add_client_po_equipment). */
export interface ClientPoLineFormValues {
  equipment_id: string
  /** As typed; optional (empty = «تحتاج سعر»). */
  price: string
  rate_unit: SaleRateUnit
  /** As typed; empty = the PO's default. */
  standard_hours: string
  /** As typed; empty = no ceiling. */
  quantity: string
  note: string
}

export const CLIENT_PO_LINE_FIELD_ORDER: readonly (keyof ClientPoLineFormValues)[] =
  ['equipment_id', 'price', 'rate_unit', 'standard_hours', 'quantity', 'note']

/** One unit ticked in «PO عميل جديد» (created with the PO). */
export interface ClientPoCreateLine {
  equipment_id: string
  price: string
  rate_unit: SaleRateUnit
  standard_hours: string
  quantity: string
  note: string
}

/** The `p_equipment` items of create_client_po. */
export function clientPoEquipmentPayload(
  lines: readonly ClientPoCreateLine[],
): {
  equipment_id: string
  price: number | null
  rate_unit: SaleRateUnit
  standard_hours: number | null
  quantity: number | null
  note: string | null
}[] {
  return lines.map((line) => ({
    equipment_id: line.equipment_id,
    price: line.price.trim() ? Number(line.price.trim()) : null,
    rate_unit: line.rate_unit,
    standard_hours: line.standard_hours.trim()
      ? Number(line.standard_hours.trim())
      : null,
    quantity: line.quantity.trim() ? Number(line.quantity.trim()) : null,
    note: line.note.trim() || null,
  }))
}

/** The form values of «تعديل المعدة» (update_client_po_equipment). */
export interface ClientPoLineEditFormValues {
  price: string
  rate_unit: SaleRateUnit
  standard_hours: string
  quantity: string
  note: string
}

export const CLIENT_PO_LINE_EDIT_FIELD_ORDER: readonly (keyof ClientPoLineEditFormValues)[] =
  ['price', 'rate_unit', 'standard_hours', 'quantity', 'note']

/** The form values of «تعديل PO العميل» (update_client_po): the dates and
 *  the notes; the company, project and number never change. */
export interface ClientPoEditFormValues {
  issue_date: string
  expiry_date: string
  notes: string
}

export const CLIENT_PO_EDIT_FIELD_ORDER: readonly (keyof ClientPoEditFormValues)[] =
  ['issue_date', 'expiry_date', 'notes']

// --- The 0169 error tokens ---------------------------------------------------------

/** Tokens of create_client_po that name one field of the create form. */
export const CLIENT_PO_CREATE_FIELD_RULES: readonly DatabaseFieldRule<ClientPoFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_company',
      field: 'company_id',
      key: 'supplierPoErrorInvalidCompany',
    },
    {
      on: 'raised',
      match: 'invalid_project',
      field: 'project_id',
      key: 'supplierPoErrorInvalidProject',
    },
    {
      on: 'raised',
      match: 'invalid_po_number',
      field: 'po_number',
      key: 'clientPoNumberInvalid',
    },
    {
      on: 'raised',
      match: 'duplicate_po_number',
      field: 'po_number',
      key: 'clientPoErrorDuplicateNumber',
    },
    {
      on: 'raised',
      match: 'invalid_issue_date',
      field: 'issue_date',
      key: 'clientPoIssueDateRequired',
    },
    {
      on: 'raised',
      match: 'invalid_expiry_date',
      field: 'expiry_date',
      key: 'clientPoExpiryBeforeIssue',
    },
    {
      on: 'raised',
      match: 'invalid_standard_hours',
      field: 'standard_hours',
      key: 'clientPoStandardHoursInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_notes',
      field: 'notes',
      key: 'supplierPoNotesTooLong',
    },
  ]

/** Tokens of add_client_po_equipment that name a field of the line form. */
export const CLIENT_PO_LINE_FIELD_RULES: readonly DatabaseFieldRule<ClientPoLineFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_equipment',
      field: 'equipment_id',
      key: 'supplierPoErrorInvalidEquipment',
    },
    {
      on: 'raised',
      match: 'equipment_not_at_po_project',
      field: 'equipment_id',
      key: 'supplierPoErrorNotAtProject',
    },
    {
      on: 'raised',
      match: 'equipment_already_on_open_client_po',
      field: 'equipment_id',
      key: 'clientPoErrorAlreadyOnOpenPo',
    },
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'price',
      key: 'supplierPoPriceInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_rate_unit',
      field: 'rate_unit',
      key: 'saleRateUnitInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_standard_hours',
      field: 'standard_hours',
      key: 'clientPoStandardHoursInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_quantity',
      field: 'quantity',
      key: 'clientPoQuantityInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_note',
      field: 'note',
      key: 'supplierPoLineNoteTooLong',
    },
  ]

/** Tokens of update_client_po_equipment that name a field. */
export const CLIENT_PO_LINE_EDIT_FIELD_RULES: readonly DatabaseFieldRule<ClientPoLineEditFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'price',
      key: 'supplierPoPriceInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_rate_unit',
      field: 'rate_unit',
      key: 'saleRateUnitInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_standard_hours',
      field: 'standard_hours',
      key: 'clientPoStandardHoursInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_quantity',
      field: 'quantity',
      key: 'clientPoQuantityInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_note',
      field: 'note',
      key: 'supplierPoLineNoteTooLong',
    },
  ]

/** Tokens of update_client_po that name a field. */
export const CLIENT_PO_EDIT_FIELD_RULES: readonly DatabaseFieldRule<ClientPoEditFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_issue_date',
      field: 'issue_date',
      key: 'clientPoIssueDateRequired',
    },
    {
      on: 'raised',
      match: 'invalid_expiry_date',
      field: 'expiry_date',
      key: 'clientPoExpiryBeforeIssue',
    },
    {
      on: 'raised',
      match: 'invalid_notes',
      field: 'notes',
      key: 'supplierPoNotesTooLong',
    },
  ]

/**
 * Tokens that belong to no single field: shown as the form-level (or
 * page-level) message. `client_po_closed` and `sales_manage_required` can
 * come from every write; the line tokens reach the create form through its
 * `p_equipment` items, where no single field holds them.
 */
export const CLIENT_PO_FORM_MESSAGES: Readonly<Record<string, TranslationKey>> =
  {
    sales_manage_required: 'clientPoErrorManageRequired',
    invalid_client_po: 'clientPoNotFound',
    invalid_line: 'supplierPoErrorInvalidLine',
    client_po_closed: 'clientPoErrorClosed',
    card_overlap: 'supplierPoErrorCardOverlap',
    equipment_already_on_open_client_po: 'clientPoErrorAlreadyOnOpenPo',
    equipment_not_at_po_project: 'supplierPoErrorNotAtProject',
    invalid_equipment: 'supplierPoErrorInvalidEquipment',
    invalid_price: 'supplierPoPriceInvalid',
    invalid_rate_unit: 'saleRateUnitInvalid',
    invalid_quantity: 'clientPoQuantityInvalid',
    invalid_note: 'supplierPoLineNoteTooLong',
  }

/** Every stable token of migration 0169 the client maps, for the tests. */
export const CLIENT_PO_ERROR_TOKENS: readonly string[] = [
  'sales_manage_required',
  'invalid_client_po',
  'client_po_closed',
  'invalid_equipment',
  'invalid_price',
  'invalid_rate_unit',
  'invalid_standard_hours',
  'invalid_quantity',
  'invalid_note',
  'equipment_not_at_po_project',
  'card_overlap',
  'equipment_already_on_open_client_po',
  'invalid_company',
  'invalid_project',
  'invalid_po_number',
  'duplicate_po_number',
  'invalid_issue_date',
  'invalid_expiry_date',
  'invalid_notes',
  'invalid_line',
]

function errorText(error: PostgresLikeError): string {
  return [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * The safe form-level message for a rejected sales write: the token's
 * message when the error carries one of `CLIENT_PO_FORM_MESSAGES`, else the
 * generic «تعذر الحفظ». The raw database text is never shown.
 */
export function clientPoFormMessage(
  error: PostgresLikeError | null | undefined,
): TranslationKey {
  if (!error) return 'supplierPoSaveFailed'
  const text = errorText(error)
  for (const [token, key] of Object.entries(CLIENT_PO_FORM_MESSAGES))
    if (text.includes(token)) return key
  return 'supplierPoSaveFailed'
}

/**
 * How a dialog reports a database rejection: a field message when a field
 * rule matches (`fieldErrors`), else one form-level message (`message`).
 * `mapField` is `mapDatabaseErrorToField` bound to the dialog's rules.
 */
export function clientPoErrorOutcome<T>(
  error: PostgresLikeError | null | undefined,
  mapField: (error: PostgresLikeError) => FieldErrors<T> | null,
): { fieldErrors: FieldErrors<T> } | { message: TranslationKey } {
  if (error) {
    const fieldErrors = mapField(error)
    if (fieldErrors) return { fieldErrors }
  }
  return { message: clientPoFormMessage(error) }
}

// --- Event details -------------------------------------------------------------------

/**
 * A short rendered detail of a client PO event, from its payload (the code
 * and the price, the old → new price, the changed dates), or null when the
 * payload has none.
 */
export function clientPoEventDetail(
  event: { event_type: string; payload: Record<string, unknown> | null },
  codeOf: (equipmentId: string) => string | null,
  formatPrice: (value: unknown) => string,
  formatDay: (value: string) => string = (value) => value,
  formatUnit: (unit: SaleRateUnit) => string = (unit) => unit,
): string | null {
  const payload = event.payload ?? {}
  const code =
    typeof payload.equipment_id === 'string'
      ? codeOf(payload.equipment_id)
      : null
  const unitChange =
    isSaleRateUnit(payload.old_rate_unit as string | null) &&
    isSaleRateUnit(payload.new_rate_unit as string | null) &&
    payload.old_rate_unit !== payload.new_rate_unit
      ? `${formatUnit(payload.old_rate_unit as SaleRateUnit)} → ${formatUnit(payload.new_rate_unit as SaleRateUnit)}`
      : null
  const hoursChange =
    typeof payload.old_standard_hours === 'number' &&
    typeof payload.new_standard_hours === 'number' &&
    payload.old_standard_hours !== payload.new_standard_hours
      ? `${payload.old_standard_hours} → ${payload.new_standard_hours}`
      : null
  const dateChange = (oldKey: string, newKey: string) => {
    const before = payload[oldKey]
    const after = payload[newKey]
    if (before === after) return null
    if (typeof before !== 'string' && before !== null) return null
    if (typeof after !== 'string' && after !== null) return null
    const show = (value: string | null) => (value ? formatDay(value) : '—')
    return `${show(before as string | null)} → ${show(after as string | null)}`
  }
  switch (event.event_type) {
    case 'created':
      return typeof payload.po_number === 'string' ? payload.po_number : null
    case 'updated':
      return (
        [
          dateChange('old_issue_date', 'new_issue_date'),
          dateChange('old_expiry_date', 'new_expiry_date'),
        ]
          .filter(Boolean)
          .join(' · ') || null
      )
    case 'equipment_added':
      return [
        code,
        payload.price === null || payload.price === undefined
          ? null
          : formatPrice(payload.price),
        isSaleRateUnit(payload.rate_unit as string | null)
          ? formatUnit(payload.rate_unit as SaleRateUnit)
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'price_changed':
      return [
        code,
        `${formatPrice(payload.old_price)} → ${formatPrice(payload.new_price)}`,
        unitChange,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'line_updated':
      return [code, unitChange, hoursChange].filter(Boolean).join(' · ') || null
    default:
      return null
  }
}

// ===================================================================================
// Phase 2 — «كروت التشغيل»: the months of a card (migration 0172)
// ===================================================================================

// --- Month keys and labels ------------------------------------------------------------

/** A Saudi month as `YYYY-MM`; the views store it as its first day. */
export type MonthKey = string

const MONTH_NAMES_AR = [
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

const MONTH_NAMES_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** `YYYY-MM` of a date key or of the view's month date (`YYYY-MM-01`). */
export function monthKeyOf(date: string): MonthKey {
  return date.slice(0, 7)
}

/** The first day of the month: the value `equipment_card_months.month`
 *  stores and the filters compare. */
export function monthStartOf(key: MonthKey): string {
  return `${key}-01`
}

/** The current Saudi month (`now() AT TIME ZONE 'Asia/Riyadh'` of 0172). */
export function currentSaudiMonthKey(today: string = saudiDateKey()): MonthKey {
  return monthKeyOf(today)
}

/** The `YYYY-MM` key `offset` months after `key` (negative goes back). */
export function shiftMonth(key: MonthKey, offset: number): MonthKey {
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + offset, 1))
    .toISOString()
    .slice(0, 7)
}

/** At most this many months in any generated range (ten years). */
export const MONTH_RANGE_LIMIT = 120

/** The month keys from `from` to `to` inclusive, oldest first (bounded). */
export function monthKeysBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const keys: MonthKey[] = []
  for (
    let key = from;
    key <= to && keys.length < MONTH_RANGE_LIMIT;
    key = shiftMonth(key, 1)
  )
    keys.push(key)
  return keys
}

/** «اكتوبر 2026» / «October 2026». */
export function monthLabel(key: MonthKey, lang: Language): string {
  const index = Number(key.slice(5, 7)) - 1
  const names = lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN
  return `${names[index] ?? key.slice(5, 7)} ${key.slice(0, 4)}`
}

/** «اكتوبر (10)» / «Oct (10)»: the month presets' look (owner 2026-10-31,
 *  the English abbreviation with the number), in the UI language. */
export function monthShortLabel(key: MonthKey, lang: Language): string {
  const index = Number(key.slice(5, 7)) - 1
  const name =
    lang === 'ar' ? MONTH_NAMES_AR[index] : MONTH_NAMES_EN[index]?.slice(0, 3)
  return `${name ?? key.slice(5, 7)} (${index + 1})`
}

/** «3 شهور» / «3 months»: the save button and the success toast. */
export function monthsCountLabel(count: number, lang: Language): string {
  if (lang === 'en') return `${count} ${count === 1 ? 'month' : 'months'}`
  if (count === 1) return 'شهر'
  if (count === 2) return 'شهرين'
  if (count <= 10) return `${count} شهور`
  return `${count} شهرا`
}

// --- The hours -------------------------------------------------------------------------

/** `equipment_card_months.hours`: numeric(8, 2) between 0 and 9999. */
export const CARD_MONTH_HOURS_MAX = 9999
export const CARD_MONTH_HOURS_PATTERN = /^\d{1,4}(\.\d{1,2})?$/

/** True for a trimmed hours value the database accepts. */
export function isValidCardMonthHours(value: string): boolean {
  const trimmed = value.trim()
  return (
    CARD_MONTH_HOURS_PATTERN.test(trimmed) &&
    Number(trimmed) <= CARD_MONTH_HOURS_MAX
  )
}

/** The hours typed in a field as a number, or null when empty or invalid. */
export function parseCardMonthHours(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || !isValidCardMonthHours(trimmed)) return null
  return Number(trimmed)
}

/** `equipment_card_months.note`: at most 500 characters. */
export const CARD_MONTH_NOTE_MAX = 500

/** «1,560»: hours with a thousands separator, up to two decimals. */
export function formatHours(hours: number | string): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    Number(hours),
  )
}

/** The hours consumed so far: the sum of the recorded months' hours. */
export function recordedHoursTotal(
  months: readonly { hours: number | string | null }[],
): number {
  return (
    Math.round(
      months.reduce((sum, month) => sum + (Number(month.hours) || 0), 0) * 100,
    ) / 100
  )
}

// --- The due rule: the live preview mirrors card_month_due ------------------------------

const roundMoney = (value: number) => Math.round(value * 100) / 100

/**
 * The ONE amount rule of 0172 (`card_month_due`), for the live preview in the
 * batch screen and the dialog hint only — every stored month's amounts come
 * from the views: a monthly price × hours ÷ the standard hours; an hourly
 * price × hours; a DAILY price has no rule yet (null); no price or no hours
 * → null; rounded to 2 decimals.
 */
export function cardMonthDue(
  price: number | string | null | undefined,
  rateUnit: string | null | undefined,
  hours: number | null | undefined,
  standardHours: number | null | undefined,
): number | null {
  if (
    price === null ||
    price === undefined ||
    hours === null ||
    hours === undefined
  )
    return null
  const amount = Number(price)
  if (Number.isNaN(amount)) return null
  if (rateUnit === 'hour') return roundMoney(amount * hours)
  if (rateUnit === 'month' && standardHours && standardHours > 0)
    return roundMoney((amount * hours) / standardHours)
  return null
}

/**
 * Why one side of a month has no amount: `no_line` (no PO line on that
 * side), `unpriced` (the line has no price yet, «تحتاج سعر»), `daily` (a
 * daily line, whose rule comes later: «—» with the hint), `owned` (the
 * supplier side of an Al-Azani unit), `no_hours` (not recorded yet).
 */
export type CardMonthDueBlocker =
  'no_line' | 'unpriced' | 'daily' | 'owned' | 'no_hours'

export interface CardMonthDue {
  value: number | null
  blocker: CardMonthDueBlocker | null
}

/** One side's due with the reason when there is none. */
export function cardMonthSideDue(side: {
  hasLine: boolean
  price: number | string | null | undefined
  rateUnit: string | null | undefined
  hours: number | null | undefined
  standardHours: number | null | undefined
}): CardMonthDue {
  if (!side.hasLine) return { value: null, blocker: 'no_line' }
  if (side.price === null || side.price === undefined)
    return { value: null, blocker: 'unpriced' }
  if (side.rateUnit === 'day') return { value: null, blocker: 'daily' }
  if (side.hours === null || side.hours === undefined)
    return { value: null, blocker: 'no_hours' }
  const value = cardMonthDue(
    side.price,
    side.rateUnit,
    side.hours,
    side.standardHours,
  )
  return value === null
    ? { value: null, blocker: 'unpriced' }
    : { value, blocker: null }
}

/** The columns of the 0172 views the figures need (both lines, `owned`, the
 *  divisor `due_standard_hours`). */
export interface CardMonthSides {
  client_line_id: string | null
  client_price: number | string | null
  client_rate_unit: string | null
  supplier_line_id: string | null
  supplier_price: number | string | null
  supplier_rate_unit: string | null
  owned: boolean
  due_standard_hours: number | null
}

export interface CardMonthFigures {
  client: CardMonthDue
  supplier: CardMonthDue
  margin: CardMonthDue
}

/**
 * The month's figures of a card for the given hours, exactly as the views
 * compute them: the client due, the supplier due (the SAME hours on the
 * supplier line's price ÷ the client line's standard hours — `due_standard_
 * hours` —; none for an owned unit) and the margin = client − COALESCE(
 * supplier, 0), null without a client due.
 */
export function cardMonthFigures(
  card: CardMonthSides,
  hours: number | null,
): CardMonthFigures {
  const client = cardMonthSideDue({
    hasLine: card.client_line_id !== null,
    price: card.client_price,
    rateUnit: card.client_rate_unit,
    hours,
    standardHours: card.due_standard_hours,
  })
  const supplier: CardMonthDue = card.owned
    ? { value: null, blocker: 'owned' }
    : cardMonthSideDue({
        hasLine: card.supplier_line_id !== null,
        price: card.supplier_price,
        rateUnit: card.supplier_rate_unit,
        hours,
        standardHours: card.due_standard_hours,
      })
  const margin: CardMonthDue =
    client.value === null
      ? { value: null, blocker: client.blocker }
      : {
          value: roundMoney(client.value - (supplier.value ?? 0)),
          blocker: null,
        }
  return { client, supplier, margin }
}

/** The stored figures of a recorded month (the view's columns) in the same
 *  shape, with the reason when a side is empty. */
export function storedCardMonthFigures(
  row: CardMonthSides & {
    hours: number | string | null
    client_due: number | string | null
    supplier_due: number | string | null
    margin: number | string | null
  },
): CardMonthFigures {
  const hours = row.hours === null ? null : Number(row.hours)
  const live = cardMonthFigures(row, hours)
  const stored = (
    value: number | string | null,
    fallback: CardMonthDue,
  ): CardMonthDue =>
    value === null || value === undefined
      ? { value: null, blocker: fallback.blocker ?? 'no_hours' }
      : { value: Number(value), blocker: null }
  return {
    client: stored(row.client_due, live.client),
    supplier: stored(row.supplier_due, live.supplier),
    margin: stored(row.margin, live.margin),
  }
}

/**
 * The totals of the batch screen's filled rows per price unit (a month, a
 * day and an hour are never added): each side's amounts in the unit of its
 * own line; the margin in the client's unit.
 */
export function cardMonthTotalsByUnit(
  amounts: readonly { value: number | null; unit: string | null | undefined }[],
): { unit: SaleRateUnit; total: number }[] {
  const present = amounts.filter((amount) => amount.value !== null)
  if (!present.length) return []
  return clientPoTotalsByUnit(
    present.map((amount) => ({ price: amount.value, rate_unit: amount.unit })),
  ).parts
}

// --- The contract hours (owner 2026-11-04) ------------------------------------------------

/**
 * The TOTAL CONTRACT HOURS of a client PO line (owner 2026-11-04, «كمية
 * الساعات الاجمالية = الكمية × الساعات القياسية»; the staff's Excel: 6
 * months × 260 = 1560 hours as the ceiling). One rule for the PO page and
 * the card page: a MONTHLY line → the quantity (months) × its standard
 * hours; an HOURLY line → the quantity itself; a DAILY line has no rule yet
 * (null, exactly as its dues show «—»); no quantity → null.
 */
export function contractHours(line: {
  quantity: number | string | null | undefined
  rate_unit: string | null | undefined
  standard_hours: number | null | undefined
}): number | null {
  const quantity =
    line.quantity === null || line.quantity === undefined
      ? NaN
      : Number(line.quantity)
  if (Number.isNaN(quantity) || quantity <= 0) return null
  const unit = saleRateUnitOf(line.rate_unit)
  if (unit === 'day') return null
  if (unit === 'hour') return quantity
  if (!line.standard_hours || line.standard_hours <= 0) return null
  return roundMoney(quantity * line.standard_hours)
}

/** The PO's total contract hours: the sum over the lines that have a total,
 *  or null when none has one. */
export function contractHoursTotal(
  lines: readonly {
    quantity: number | string | null | undefined
    rate_unit: string | null | undefined
    standard_hours: number | null | undefined
  }[],
): number | null {
  let total: number | null = null
  for (const line of lines) {
    const hours = contractHours(line)
    if (hours !== null) total = roundMoney((total ?? 0) + hours)
  }
  return total
}

// --- The month states ----------------------------------------------------------------------

/** «مسجل» (recorded), «بانتظار» (an elapsed month without hours) or «جاري»
 *  (the running month of an open card, not recorded yet). */
export type CardMonthState = 'recorded' | 'pending' | 'running'

export const CARD_MONTH_STATE_BADGE: Readonly<
  Record<
    CardMonthState,
    { key: TranslationKey; tone: 'success' | 'warning' | 'info' }
  >
> = {
  recorded: { key: 'cardMonthStateRecorded', tone: 'success' },
  pending: { key: 'cardMonthStatePending', tone: 'warning' },
  running: { key: 'cardMonthStateRunning', tone: 'info' },
}

/** The state of one slot of `sales_card_month_slots`. */
export function cardMonthState(
  slot: { recorded: boolean; month: string; is_open?: boolean | null },
  currentMonth: MonthKey = currentSaudiMonthKey(),
): CardMonthState {
  if (slot.recorded) return 'recorded'
  if (monthKeyOf(slot.month) === currentMonth && slot.is_open !== false)
    return 'running'
  return 'pending'
}

// --- The card events (equipment_card_events) --------------------------------------------------

export type EquipmentCardEventType =
  'month_recorded' | 'month_updated' | 'month_deleted'

export const EQUIPMENT_CARD_EVENT_LABEL_KEYS: Readonly<
  Record<EquipmentCardEventType, TranslationKey>
> = {
  month_recorded: 'cardMonthEventRecorded',
  month_updated: 'cardMonthEventUpdated',
  month_deleted: 'cardMonthEventDeleted',
}

/**
 * The detail of a card event from its payload: «اكتوبر (10): 248 ساعة» for a
 * record or a deletion (the old hours), «سبتمبر (9): 260 ← 240» for a change
 * (the old hours on the start side, the arrow pointing to the new ones, as
 * the activity page writes a change). `hoursText` renders «248 ساعة».
 */
export function equipmentCardEventDetail(
  event: { event_type: string; payload: Record<string, unknown> | null },
  lang: Language,
  hoursText: (hours: number) => string = (hours) => formatHours(hours),
): string | null {
  const payload = event.payload ?? {}
  const month =
    typeof payload.month === 'string'
      ? monthShortLabel(monthKeyOf(payload.month), lang)
      : null
  const number = (value: unknown): number | null =>
    typeof value === 'number'
      ? value
      : typeof value === 'string' &&
          value.trim() &&
          !Number.isNaN(Number(value))
        ? Number(value)
        : null
  const hours = number(payload.hours)
  const oldHours = number(payload.old_hours)
  const arrow = lang === 'ar' ? '←' : '→'
  switch (event.event_type) {
    case 'month_recorded':
      return hours === null
        ? month
        : `${month ? `${month}: ` : ''}${hoursText(hours)}`
    case 'month_updated':
      if (hours === null) return month
      if (oldHours === null || oldHours === hours)
        return `${month ? `${month}: ` : ''}${hoursText(hours)}`
      return `${month ? `${month}: ` : ''}${formatHours(oldHours)} ${arrow} ${formatHours(hours)}`
    case 'month_deleted':
      return oldHours === null
        ? month
        : `${month ? `${month}: ` : ''}${hoursText(oldHours)}`
    default:
      return null
  }
}

// --- The «تسجيل شهر» form and the 0172 tokens -------------------------------------------------

/** The form values of «تسجيل شهر» (record_equipment_card_month). */
export interface CardMonthFormValues {
  /** A month key (YYYY-MM). */
  month: string
  /** As typed. */
  hours: string
  note: string
}

export const CARD_MONTH_FIELD_ORDER: readonly (keyof CardMonthFormValues)[] = [
  'month',
  'hours',
  'note',
]

/** Tokens of the month functions that name a field of the dialog. */
export const CARD_MONTH_FIELD_RULES: readonly DatabaseFieldRule<CardMonthFormValues>[] =
  [
    {
      on: 'raised',
      match: 'month_outside_card',
      field: 'month',
      key: 'cardMonthErrorOutsideCard',
    },
    {
      on: 'raised',
      match: 'month_in_future',
      field: 'month',
      key: 'cardMonthErrorInFuture',
    },
    {
      on: 'raised',
      match: 'invalid_month',
      field: 'month',
      key: 'cardMonthMonthRequired',
    },
    {
      on: 'raised',
      match: 'invalid_hours',
      field: 'hours',
      key: 'cardMonthHoursInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_note',
      field: 'note',
      key: 'cardMonthNoteTooLong',
    },
  ]

/**
 * Every 0172 token as a form-level (or page-level) message: the batch
 * screen has no single field for an item's token, and the dialog falls back
 * to these when no field rule matches.
 */
export const CARD_MONTH_FORM_MESSAGES: Readonly<
  Record<string, TranslationKey>
> = {
  sales_manage_required: 'clientPoErrorManageRequired',
  invalid_card: 'equipmentCardNotFound',
  invalid_month: 'cardMonthMonthRequired',
  invalid_hours: 'cardMonthHoursInvalid',
  invalid_note: 'cardMonthNoteTooLong',
  invalid_items: 'cardMonthErrorInvalidItems',
  month_outside_card: 'cardMonthErrorOutsideCard',
  month_in_future: 'cardMonthErrorInFuture',
  card_month_not_found: 'cardMonthErrorNotFound',
}

/** Every stable token of migration 0172 the client maps, for the tests. */
export const CARD_MONTH_ERROR_TOKENS: readonly string[] = [
  'sales_manage_required',
  'invalid_month',
  'invalid_card',
  'invalid_hours',
  'invalid_note',
  'invalid_items',
  'month_outside_card',
  'month_in_future',
  'card_month_not_found',
]

/** The safe message for a rejected month write; never the raw text. */
export function cardMonthFormMessage(
  error: PostgresLikeError | null | undefined,
): TranslationKey {
  if (!error) return 'supplierPoSaveFailed'
  const text = errorText(error)
  for (const [token, key] of Object.entries(CARD_MONTH_FORM_MESSAGES))
    if (text.includes(token)) return key
  return 'supplierPoSaveFailed'
}

/** The dialog's outcome: a field message when a rule matches, else one
 *  form-level message. */
export function cardMonthErrorOutcome<T>(
  error: PostgresLikeError | null | undefined,
  mapField: (error: PostgresLikeError) => FieldErrors<T> | null,
): { fieldErrors: FieldErrors<T> } | { message: TranslationKey } {
  if (error) {
    const fieldErrors = mapField(error)
    if (fieldErrors) return { fieldErrors }
  }
  return { message: cardMonthFormMessage(error) }
}

/** The `p_items` of record_equipment_card_months: hours as a JSON number. */
export interface CardMonthBatchItem {
  card_id: string
  hours: number
  note: string | null
}
