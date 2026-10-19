import type { TranslationKey } from '@/i18n/translations'
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
 * This file has no runtime imports so the node tests can load it directly.
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

/** `supplier_po_events.event_type` (the 0136 CHECK list). */
export type SupplierPoEventType =
  | 'created'
  | 'equipment_added'
  | 'price_changed'
  | 'card_changed'
  | 'closed'

export const SUPPLIER_PO_EVENT_LABEL_KEYS: Readonly<
  Record<SupplierPoEventType, TranslationKey>
> = {
  created: 'supplierPoEventCreated',
  equipment_added: 'supplierPoEventEquipmentAdded',
  price_changed: 'supplierPoEventPriceChanged',
  card_changed: 'supplierPoEventCardChanged',
  closed: 'supplierPoEventClosed',
}

/** The PO page shows the latest events only, never a full list. */
export const SUPPLIER_PO_EVENTS_LIMIT = 20

// --- Price ----------------------------------------------------------------------

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

/**
 * The supplier shown for a PO: the lessor's name, or «العزاني» for an
 * internal PO without a lessor (`is_internal` with `lessor_id` NULL).
 */
export function supplierPoSupplierLabel(
  po: { is_internal: boolean; lessor?: { name: string | null } | null },
  t: (key: TranslationKey) => string,
): string {
  const name = po.lessor?.name?.trim()
  if (name) return name
  return po.is_internal ? t('supplierPoInternalSupplier') : '—'
}

// --- The 0136 error tokens --------------------------------------------------------

/** The form values of «امر شراء جديد» (create_supplier_po). */
export interface SupplierPoFormValues {
  /** Empty = an internal PO (Al-Azani units). */
  lessor_id: string
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
  /** As typed; validated by `supplierPoLineFormSchema`. */
  price: string
  note: string
}

export const SUPPLIER_PO_LINE_FIELD_ORDER: readonly (keyof SupplierPoLineFormValues)[] =
  ['equipment_id', 'price', 'note']

/** The form values of «تعديل السعر» (update_supplier_po_equipment_price). */
export interface SupplierPoPriceFormValues {
  price: string
}

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
    invalid_po: 'supplierPoNotFound', // add, close
    invalid_line: 'supplierPoErrorInvalidLine', // update price
  }

/** Every stable token of migrations 0136 and 0137 the client maps, for the tests. */
export const SUPPLIER_PO_ERROR_TOKENS: readonly string[] = [
  'purchasing_manage_required',
  'invalid_po',
  'invalid_equipment',
  'equipment_not_at_po_project',
  'invalid_lessor',
  'invalid_company',
  'invalid_project',
  'invalid_start_date',
  'invalid_price',
  'invalid_line',
  'po_closed',
  'internal_price_must_be_zero',
  'card_overlap',
  'equipment_already_on_open_po',
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
