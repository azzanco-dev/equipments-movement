import type { TranslationKey } from '@/i18n/translations'
import type { ListFilter } from '@/components/data-list/types'
import { logicTreeValue } from '@/lib/applyListFilters'
import type {
  DatabaseFieldRule,
  FieldErrors,
  PostgresLikeError,
} from '@/lib/formValidation'

/**
 * purchasing-screens — the pure, reusable part of the first purchasing
 * screens (migration 0136: supplier POs, their equipment lines and the
 * «كرت المعدة» behind the scenes). The screens themselves are MOCKUPS on
 * /ui-kit for now (owner decision 2026-10-19); when they move to their real
 * routes, this module is what they bring along: the status / event labels,
 * the price formatting and the mapping of the 0136 error tokens to form
 * fields and messages. Nothing here calls the database.
 *
 * The only runtime import is the pure `@/lib/applyListFilters`, so the node
 * tests can still load it directly.
 */

// --- Status and events --------------------------------------------------------

export type SupplierPoStatus = 'open' | 'closed'

/** The shared status badge: open = success tone, closed = muted neutral. */
export const SUPPLIER_PO_STATUS_BADGE: Readonly<
  Record<SupplierPoStatus, { key: TranslationKey; tone: 'success' | 'neutral' }>
> = {
  open: { key: 'supplierPoStatusOpen', tone: 'success' },
  closed: { key: 'supplierPoStatusClosed', tone: 'neutral' },
}

/** `supplier_po_events.event_type` (the CHECK list as 0149 re-created it). */
export type SupplierPoEventType =
  | 'created'
  | 'updated'
  | 'equipment_added'
  | 'price_changed'
  | 'line_updated'
  | 'card_changed'
  | 'equipment_removed'
  | 'closed'
  | 'reopened'

export const SUPPLIER_PO_EVENT_LABEL_KEYS: Readonly<
  Record<SupplierPoEventType, TranslationKey>
> = {
  created: 'supplierPoEventCreated',
  updated: 'supplierPoEventUpdated',
  equipment_added: 'supplierPoEventEquipmentAdded',
  price_changed: 'supplierPoEventPriceChanged',
  line_updated: 'supplierPoEventLineUpdated',
  card_changed: 'supplierPoEventCardChanged',
  // 0149: the one-off reopening of SPO260001 / SPO260002 (owner 2026-10-25).
  equipment_removed: 'supplierPoEventEquipmentRemoved',
  closed: 'supplierPoEventClosed',
  reopened: 'supplierPoEventReopened',
}

/** The PO page shows the latest events only, never a full list. */
export const SUPPLIER_PO_EVENTS_LIMIT = 20

// --- Price ----------------------------------------------------------------------

/** Saudi VAT, shown for information only under the totals (owner
 *  2026-10-21); invoices are issued elsewhere. */
export const SUPPLIER_PO_VAT_RATE = 0.15

/** The VAT on an amount excluding VAT, rounded to halalas. */
export function vatOf(amountExclVat: number): number {
  return Math.round(amountExclVat * SUPPLIER_PO_VAT_RATE * 100) / 100
}

/** An amount excluding VAT with the VAT added (the two summary cards always
 *  add up: total + vatOf(total)). */
export function withVat(amountExclVat: number): number {
  return Math.round((amountExclVat + vatOf(amountExclVat)) * 100) / 100
}

/**
 * `supplier_po_equipment.price` is numeric(12, 2) >= 0, so the form accepts
 * up to ten integer digits and at most two decimals (the same bound the
 * functions check, 9999999999.99).
 */
export const SUPPLIER_PO_PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/

/** True for a trimmed price the database accepts. */
export function isValidSupplierPoPrice(value: string): boolean {
  return SUPPLIER_PO_PRICE_PATTERN.test(value.trim())
}

/**
 * A price excluding VAT, always with two decimals and Latin digits
 * (`1,250.00`), whatever the interface language: the amount sits next to the
 * PO number and the equipment code, which are Latin too.
 */
export function formatSupplierPoPrice(
  value: number | string | null | undefined,
): string {
  const amount = typeof value === 'string' ? Number(value) : value
  if (amount === null || amount === undefined || Number.isNaN(amount))
    return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// --- The price unit (0157) ---------------------------------------------------------

/** `supplier_po_equipment.rate_unit`: the line's price is per month or per
 *  day with this supplier (owner 2026-10-28; no hourly unit, no standard
 *  hours, no quantity on the supplier side). */
export type SupplierPoRateUnit = 'month' | 'day'

export const SUPPLIER_PO_RATE_UNITS: readonly SupplierPoRateUnit[] = ['month', 'day']

export const SUPPLIER_PO_DEFAULT_RATE_UNIT: SupplierPoRateUnit = 'month'

/** The unit's name in a select («شهري» / «يومي»). */
export const SUPPLIER_PO_RATE_UNIT_LABEL_KEYS: Readonly<
  Record<SupplierPoRateUnit, TranslationKey>
> = {
  month: 'supplierPoRateUnitMonth',
  day: 'supplierPoRateUnitDay',
}

/** The suffix after an amount («/ شهر» / «/ يوم»). */
export const SUPPLIER_PO_PER_UNIT_KEYS: Readonly<
  Record<SupplierPoRateUnit, TranslationKey>
> = {
  month: 'supplierPoPerMonth',
  day: 'supplierPoPerDay',
}

export function isSupplierPoRateUnit(
  value: string | null | undefined,
): value is SupplierPoRateUnit {
  return (SUPPLIER_PO_RATE_UNITS as readonly string[]).includes(value ?? '')
}

/** A stored unit, or month for anything else (every pre-0157 line is month). */
export function supplierPoRateUnitOf(
  value: string | null | undefined,
): SupplierPoRateUnit {
  return isSupplierPoRateUnit(value) ? value : SUPPLIER_PO_DEFAULT_RATE_UNIT
}

/**
 * The PO's totals excluding VAT, one per unit present on its lines, month
 * first (owner 2026-10-28: a monthly and a daily price are never added
 * together). Unpriced lines count towards their unit's presence but not its
 * total; a PO without lines totals 0 per month.
 */
export function supplierPoTotalsByUnit(
  lines: readonly { price: number | string | null; rate_unit?: string | null }[],
): { parts: { unit: SupplierPoRateUnit; total: number }[]; unpriced: number } {
  const totals = new Map<SupplierPoRateUnit, number>()
  let unpriced = 0
  for (const line of lines) {
    const unit = supplierPoRateUnitOf(line.rate_unit)
    const price =
      line.price === null || line.price === undefined ? NaN : Number(line.price)
    if (Number.isNaN(price)) unpriced += 1
    totals.set(unit, (totals.get(unit) ?? 0) + (Number.isNaN(price) ? 0 : price))
  }
  const parts = SUPPLIER_PO_RATE_UNITS.filter((unit) => totals.has(unit)).map(
    (unit) => ({ unit, total: Math.round((totals.get(unit) ?? 0) * 100) / 100 }),
  )
  return {
    parts: parts.length ? parts : [{ unit: SUPPLIER_PO_DEFAULT_RATE_UNIT, total: 0 }],
    unpriced,
  }
}

// --- The party: a lessor or an owner class (0138) ----------------------------------

/** `supplier_pos.owner_class`: the owner classes a PO can be addressed to
 *  without a lessor row (owner 2026-10-20: no new supplier rows). */
export type SupplierPoOwnerClass =
  | 'alazani'
  | 'takween'
  | 'third_party_f'
  | 'third_party_partnership_b'

export const SUPPLIER_PO_OWNER_CLASSES: readonly SupplierPoOwnerClass[] = [
  'alazani',
  'takween',
  'third_party_f',
  'third_party_partnership_b',
]

/** Short labels of the owner classes, as the party picker and the PO show them. */
export const SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS: Readonly<
  Record<SupplierPoOwnerClass, TranslationKey>
> = {
  alazani: 'supplierPoOwnerAlazani',
  takween: 'supplierPoOwnerTakween',
  third_party_f: 'supplierPoOwnerF',
  third_party_partnership_b: 'supplierPoOwnerB',
}

export function isSupplierPoOwnerClass(
  value: string | null | undefined,
): value is SupplierPoOwnerClass {
  return (SUPPLIER_PO_OWNER_CLASSES as readonly string[]).includes(value ?? '')
}

/** The party picker's option value for an owner class (`class:<key>`); a
 *  lessor option's value is the lessor id itself. */
export const SUPPLIER_PO_CLASS_OPTION_PREFIX = 'class:'

export function partyOptionValue(party: {
  lessor_id: string | null
  owner_class: string | null
}): string {
  if (party.owner_class) return `${SUPPLIER_PO_CLASS_OPTION_PREFIX}${party.owner_class}`
  return party.lessor_id ?? ''
}

/** The form's `lessor_id` / `owner_class` pair for a picked option value. */
export function partyFromOptionValue(value: string): {
  lessor_id: string
  owner_class: string
} {
  if (value.startsWith(SUPPLIER_PO_CLASS_OPTION_PREFIX))
    return {
      lessor_id: '',
      owner_class: value.slice(SUPPLIER_PO_CLASS_OPTION_PREFIX.length),
    }
  return { lessor_id: value, owner_class: '' }
}

/**
 * The party shown for a PO: the owner class's short label, else the
 * lessor's name, else «العزاني» for a pre-0138 internal PO.
 */
export function supplierPoSupplierLabel(
  po: {
    is_internal: boolean
    owner_class?: string | null
    lessor?: { name: string | null } | null
  },
  t: (key: TranslationKey) => string,
): string {
  if (isSupplierPoOwnerClass(po.owner_class))
    return t(SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS[po.owner_class])
  const name = po.lessor?.name?.trim()
  if (name) return name
  return po.is_internal ? t('supplierPoInternalSupplier') : '—'
}

// --- The 0136 error tokens --------------------------------------------------------

/** The form values of «امر شراء جديد» (create_supplier_po). The party is
 *  one of `lessor_id` / `owner_class` (0138); the picker fills the pair. */
export interface SupplierPoFormValues {
  lessor_id: string
  owner_class: string
  company_id: string
  project_id: string
  /** A date key (YYYY-MM-DD). */
  start_date: string
  notes: string
}

export const SUPPLIER_PO_FIELD_ORDER: readonly (keyof SupplierPoFormValues)[] =
  ['lessor_id', 'company_id', 'project_id', 'start_date', 'notes']

/** The form values of «اضافة معدة» (add_supplier_po_equipment). */
export interface SupplierPoLineFormValues {
  equipment_id: string
  /** As typed; optional since 0138 (empty = «تحتاج سعر»). */
  price: string
  /** 0157: per month or per day. */
  rate_unit: SupplierPoRateUnit
  note: string
}

/** One unit picked in «امر شراء جديد» (0138: created with the PO). */
export interface SupplierPoCreateLine {
  equipment_id: string
  /** As typed; optional. */
  price: string
  /** 0157: per month or per day. */
  rate_unit: SupplierPoRateUnit
  note: string
}

/** The `p_equipment` items of create_supplier_po. */
export function supplierPoEquipmentPayload(
  lines: readonly SupplierPoCreateLine[],
): {
  equipment_id: string
  price: number | null
  note: string | null
  rate_unit: SupplierPoRateUnit
}[] {
  return lines.map((line) => ({
    equipment_id: line.equipment_id,
    price: line.price.trim() ? Number(line.price.trim()) : null,
    note: line.note.trim() || null,
    rate_unit: line.rate_unit,
  }))
}

export const SUPPLIER_PO_LINE_FIELD_ORDER: readonly (keyof SupplierPoLineFormValues)[] =
  ['equipment_id', 'price', 'rate_unit', 'note']

/** The form values of «تعديل السعر» (update_supplier_po_equipment_price). */
export interface SupplierPoPriceFormValues {
  price: string
}

/** The form values of «تعديل المعدة» (update_supplier_po_equipment, 0142):
 *  the price (empty = «تحتاج تسعير») and the note together. */
export interface SupplierPoLineEditFormValues {
  price: string
  /** 0157: per month or per day. */
  rate_unit: SupplierPoRateUnit
  note: string
}

export const SUPPLIER_PO_LINE_EDIT_FIELD_ORDER: readonly (keyof SupplierPoLineEditFormValues)[] =
  ['price', 'rate_unit', 'note']

/** The form values of «تعديل الامر» (update_supplier_po, 0142): the start
 *  date and the notes; the party, company and project never change. */
export interface SupplierPoEditFormValues {
  start_date: string
  notes: string
}

export const SUPPLIER_PO_EDIT_FIELD_ORDER: readonly (keyof SupplierPoEditFormValues)[] =
  ['start_date', 'notes']

/**
 * Tokens of create_supplier_po that name one field of the create form. The
 * stable token is raised as the message (`RAISE EXCEPTION '<token>'`), so
 * `mapDatabaseErrorToField` matches it whatever SQLSTATE it carries.
 */
export const SUPPLIER_PO_CREATE_FIELD_RULES: readonly DatabaseFieldRule<SupplierPoFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_lessor',
      field: 'lessor_id',
      key: 'supplierPoErrorInvalidSupplier',
    },
    // 0138: the party (the picker's field is lessor_id).
    {
      on: 'raised',
      match: 'party_required',
      field: 'lessor_id',
      key: 'supplierPoPartyRequired',
    },
    {
      on: 'raised',
      match: 'invalid_party',
      field: 'lessor_id',
      key: 'supplierPoPartyRequired',
    },
    {
      on: 'raised',
      match: 'invalid_owner_class',
      field: 'lessor_id',
      key: 'supplierPoPartyRequired',
    },
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
      match: 'invalid_start_date',
      field: 'start_date',
      key: 'supplierPoStartDateRequired',
    },
    // 0148: every unit of one PO entered on its start date (a Saudi day).
    {
      on: 'raised',
      match: 'entry_date_mismatch',
      field: 'start_date',
      key: 'supplierPoErrorEntryDateMismatch',
    },
  ]

/** Tokens of add_supplier_po_equipment that name a field of the line form. */
export const SUPPLIER_PO_LINE_FIELD_RULES: readonly DatabaseFieldRule<SupplierPoLineFormValues>[] =
  [
    {
      on: 'raised',
      match: 'internal_price_must_be_zero',
      field: 'price',
      key: 'supplierPoPriceInternalMustBeZero',
    },
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'price',
      key: 'supplierPoPriceInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_equipment',
      field: 'equipment_id',
      key: 'supplierPoErrorInvalidEquipment',
    },
    // 0137: the unit must be inside the PO's company and project right now.
    {
      on: 'raised',
      match: 'equipment_not_at_po_project',
      field: 'equipment_id',
      key: 'supplierPoErrorNotAtProject',
    },
    // 0138: the unit must belong to the PO's party.
    {
      on: 'raised',
      match: 'equipment_not_of_po_supplier',
      field: 'equipment_id',
      key: 'supplierPoErrorNotOfSupplier',
    },
    // 0148: the unit must have entered on the PO's start date.
    {
      on: 'raised',
      match: 'entry_date_mismatch',
      field: 'equipment_id',
      key: 'supplierPoErrorEntryDateMismatch',
    },
    // 0157: the price unit is month or day.
    {
      on: 'raised',
      match: 'invalid_rate_unit',
      field: 'rate_unit',
      key: 'supplierPoRateUnitInvalid',
    },
  ]

/** Tokens of update_supplier_po_equipment_price that name the price field. */
export const SUPPLIER_PO_PRICE_FIELD_RULES: readonly DatabaseFieldRule<SupplierPoPriceFormValues>[] =
  [
    {
      on: 'raised',
      match: 'internal_price_must_be_zero',
      field: 'price',
      key: 'supplierPoPriceInternalMustBeZero',
    },
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'price',
      key: 'supplierPoPriceInvalid',
    },
  ]

/** Tokens of update_supplier_po_equipment (0142) that name a field. */
export const SUPPLIER_PO_LINE_EDIT_FIELD_RULES: readonly DatabaseFieldRule<SupplierPoLineEditFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_price',
      field: 'price',
      key: 'supplierPoPriceInvalid',
    },
    {
      on: 'raised',
      match: 'invalid_note',
      field: 'note',
      key: 'supplierPoLineNoteTooLong',
    },
    // 0157: the price unit is month or day.
    {
      on: 'raised',
      match: 'invalid_rate_unit',
      field: 'rate_unit',
      key: 'supplierPoRateUnitInvalid',
    },
  ]

/** Tokens of update_supplier_po (0142) that name a field. */
export const SUPPLIER_PO_EDIT_FIELD_RULES: readonly DatabaseFieldRule<SupplierPoEditFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_start_date',
      field: 'start_date',
      key: 'supplierPoStartDateRequired',
    },
    {
      on: 'raised',
      match: 'invalid_notes',
      field: 'notes',
      key: 'supplierPoNotesTooLong',
    },
    // 0148: while the PO has lines, its start date is their entry day.
    {
      on: 'raised',
      match: 'po_start_date_locked',
      field: 'start_date',
      key: 'supplierPoErrorStartDateLocked',
    },
  ]

/**
 * Tokens that belong to no single field: shown as the form-level (or
 * page-level) message. `po_closed` and `purchasing_manage_required` can come
 * from every write; the rest from the function named in the comment.
 */
export const SUPPLIER_PO_FORM_MESSAGES: Readonly<Record<string, TranslationKey>> =
  {
    card_overlap: 'supplierPoErrorCardOverlap', // add_supplier_po_equipment
    equipment_already_on_open_po: 'supplierPoErrorAlreadyOnOpenPo', // add
    po_closed: 'supplierPoErrorClosed',
    purchasing_manage_required: 'supplierPoErrorManageRequired',
    invalid_po: 'supplierPoNotFound', // add, close, update (0142)
    invalid_line: 'supplierPoErrorInvalidLine', // update price / line (0142)
    invalid_rate_unit: 'supplierPoRateUnitInvalid', // create (0157)
  }

/** Every stable token of migrations 0136–0157 the client maps, for the tests. */
export const SUPPLIER_PO_ERROR_TOKENS: readonly string[] = [
  'purchasing_manage_required',
  'invalid_po',
  'invalid_equipment',
  'equipment_not_at_po_project',
  'equipment_not_of_po_supplier',
  'party_required',
  'invalid_party',
  'invalid_owner_class',
  'invalid_lessor',
  'invalid_company',
  'invalid_project',
  'invalid_start_date',
  'invalid_price',
  'invalid_line',
  'invalid_notes', // 0142 update_supplier_po
  'invalid_note', // 0142 update_supplier_po_equipment
  'po_closed',
  'internal_price_must_be_zero',
  'card_overlap',
  'equipment_already_on_open_po',
  'entry_date_mismatch', // 0148 add_supplier_po_equipment (and create)
  'po_start_date_locked', // 0148 update_supplier_po
  'invalid_rate_unit', // 0157 add / create / update a line
]

function errorText(error: PostgresLikeError): string {
  return [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * The safe form-level message for a rejected purchasing write: the token's
 * message when the error carries one of `SUPPLIER_PO_FORM_MESSAGES`, else
 * the generic «تعذر الحفظ». The raw database text is never shown.
 */
export function supplierPoFormMessage(
  error: PostgresLikeError | null | undefined,
): TranslationKey {
  if (!error) return 'supplierPoSaveFailed'
  const text = errorText(error)
  for (const [token, key] of Object.entries(SUPPLIER_PO_FORM_MESSAGES))
    if (text.includes(token)) return key
  return 'supplierPoSaveFailed'
}

/**
 * How a dialog reports a database rejection: a field message when a field
 * rule matches (`fieldErrors`), else one form-level message (`message`).
 * `mapField` is `mapDatabaseErrorToField` bound to the dialog's rules; it is
 * passed in so this module keeps no runtime import.
 */
export function supplierPoErrorOutcome<T>(
  error: PostgresLikeError | null | undefined,
  mapField: (error: PostgresLikeError) => FieldErrors<T> | null,
): { fieldErrors: FieldErrors<T> } | { message: TranslationKey } {
  if (error) {
    const fieldErrors = mapField(error)
    if (fieldErrors) return { fieldErrors }
  }
  return { message: supplierPoFormMessage(error) }
}

// --- The PO list's party filters ---------------------------------------------

/**
 * Owner 2026-10-22: in the PO list the owner filter and the supplier filter
 * are OR-ed, not AND-ed — «تكوين + مالك اخر» and then a supplier means every
 * Takween PO OR an external PO of that supplier (an AND would drop the
 * Takween POs, which have no lessor). Returns the PostgREST `or` clause and
 * the filters left for the generic pass, or null while the two filters are
 * not both set with ticked values (then the generic pass applies them).
 */
export function supplierPoPartyOrFilter(
  filters: readonly ListFilter[],
): { clause: string; rest: ListFilter[] } | null {
  const party = filters.find(
    (filter) =>
      filter.field === 'party_class' &&
      (filter.operator === 'in' || filter.operator === 'eq'),
  )
  const lessor = filters.find(
    (filter) => filter.field === 'lessor_id' && filter.operator === 'in',
  )
  if (!party || !lessor) return null
  const split = (value: string) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  const owners = split(party.value).filter(
    (value) => value !== 'external_supplier',
  )
  const lessors = split(lessor.value)
  if (!split(party.value).length || !lessors.length) return null
  const parts: string[] = []
  if (owners.length)
    parts.push(`party_class.in.(${owners.map(logicTreeValue).join(',')})`)
  parts.push(`lessor_id.in.(${lessors.map(logicTreeValue).join(',')})`)
  return {
    clause: parts.join(','),
    rest: filters.filter((filter) => filter !== party && filter !== lessor),
  }
}
