import type { Language, TranslationKey } from '@/i18n/translations'
import type {
  DatabaseFieldRule,
  FieldErrors,
  PostgresLikeError,
} from '@/lib/formValidation'
import { SUPPLIER_PO_PRICE_PATTERN, vatOf, withVat } from '@/lib/purchasing'

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
 * The only runtime import is the pure `@/lib/purchasing` (its price pattern
 * and VAT math), so the node tests can still load it directly.
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
