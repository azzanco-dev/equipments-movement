import type { TranslationKey } from '@/i18n/translations'
import type { DatabaseFieldRule } from '@/lib/formValidation'

/**
 * The extra master-data fields of suppliers (`lessors`) and clients
 * (`companies`), migration 0175 (EM-260, owner 2026-11-03 / 2026-11-04):
 * the tax number, the commercial register, the address, the city and the
 * email on both tables; the contact person and number joined `companies`
 * (the lessors had them since 0001) and the IBAN is the suppliers' alone.
 *
 * Pure helpers only (no runtime import): the normalisation the database
 * trigger applies, mirrored so the form validates what will be stored; the
 * limits of the CHECKs; the database rules that map a refused save back to
 * its field; and the Excel import headers.
 */

/** The 0175 fields both forms carry. */
export const PARTY_SHARED_FIELDS = [
  'tax_number',
  'commercial_register',
  'address',
  'city',
  'email',
] as const
export type PartySharedField = (typeof PARTY_SHARED_FIELDS)[number]

export const PARTY_TAX_NUMBER_LENGTH = 15
export const PARTY_COMMERCIAL_REGISTER_MIN = 4
export const PARTY_COMMERCIAL_REGISTER_MAX = 20
export const PARTY_ADDRESS_MAX = 200
export const PARTY_CITY_MAX = 60
export const PARTY_EMAIL_MAX = 120
export const PARTY_CONTACT_PERSON_MAX = 120
export const PARTY_CONTACT_NUMBER_MAX = 30
/** The supplier's bank name (owner 2026-11-04, «البنك والايبان»). */
export const PARTY_BANK_NAME_MAX = 100
/** A Saudi IBAN: «SA», 2 check digits, 2 bank digits, 18 account characters. */
export const SAUDI_IBAN_LENGTH = 24

/** The shapes of the 0175 CHECKs (`lessors_tax_number_check`, …). */
export const TAX_NUMBER_PATTERN = /^\d{15}$/
export const COMMERCIAL_REGISTER_PATTERN = /^\d{4,20}$/
export const SAUDI_IBAN_PATTERN = /^SA\d{4}[0-9A-Z]{18}$/
export const EMAIL_SHAPE_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Latin digits for the Arabic-Indic and Persian ones a keyboard may send. */
function latinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) =>
    String(
      digit.charCodeAt(0) -
        (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660),
    ),
  )
}

/** The tax number and the CR as the trigger stores them: no spaces, no dashes. */
export function normalizeRegistryNumber(value: string): string {
  return latinDigits(value).replace(/[\s-]/g, '')
}

/** The IBAN as the trigger stores it: no spaces or dashes, upper-case. */
export function normalizeIban(value: string): string {
  return latinDigits(value).replace(/[\s-]/g, '').toUpperCase()
}

/** The email as the trigger stores it: trimmed, lower-case. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** A trimmed optional text, `null` when blank (the trigger does the same). */
export function optionalTextOrNull(value: string): string | null {
  return value.trim() || null
}

/** The payload of the five shared fields, normalised like the trigger. */
export function partySharedPayload(
  form: Record<PartySharedField, string>,
): Record<PartySharedField, string | null> {
  return {
    tax_number: normalizeRegistryNumber(form.tax_number) || null,
    commercial_register: normalizeRegistryNumber(form.commercial_register) || null,
    address: optionalTextOrNull(form.address),
    city: optionalTextOrNull(form.city),
    email: normalizeEmail(form.email) || null,
  }
}

/** The five shared fields of a record as form values (`null` → ''). */
export function partySharedFormValues(
  record: Partial<Record<PartySharedField, string | null>>,
): Record<PartySharedField, string> {
  return {
    tax_number: record.tax_number ?? '',
    commercial_register: record.commercial_register ?? '',
    address: record.address ?? '',
    city: record.city ?? '',
    email: record.email ?? '',
  }
}

/** The IBAN for display: «SA00 0000 0000 0000 0000 0000». */
export function formatIban(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ')
}

export interface PartyDuplicateKeys {
  tax_number: TranslationKey
  commercial_register: TranslationKey
}

/**
 * The database rules of the five shared fields for one table: the partial
 * unique indexes (`<table>_tax_number_unique`,
 * `<table>_commercial_register_unique`) with the table's own duplicate
 * messages, and the CHECKs (`<table>_<column>_check`) with the shape and
 * length messages. The IBAN and the client contact fields are added by the
 * owning form.
 */
export function partySharedDatabaseRules<T extends Record<PartySharedField, string>>(
  table: 'lessors' | 'companies',
  duplicates: PartyDuplicateKeys,
): readonly DatabaseFieldRule<T>[] {
  return [
    {
      on: 'unique',
      match: `${table}_tax_number_unique`,
      field: 'tax_number',
      key: duplicates.tax_number,
    },
    {
      on: 'unique',
      match: `${table}_commercial_register_unique`,
      field: 'commercial_register',
      key: duplicates.commercial_register,
    },
    {
      on: 'check',
      match: `${table}_tax_number_check`,
      field: 'tax_number',
      key: 'taxNumberFormatInvalid',
    },
    {
      on: 'check',
      match: `${table}_commercial_register_check`,
      field: 'commercial_register',
      key: 'commercialRegisterFormatInvalid',
    },
    {
      on: 'check',
      match: `${table}_address_check`,
      field: 'address',
      key: 'addressTooLong',
    },
    { on: 'check', match: `${table}_city_check`, field: 'city', key: 'cityTooLong' },
    {
      on: 'check',
      match: `${table}_email_check`,
      field: 'email',
      key: 'emailFormatInvalid',
    },
  ]
}

/**
 * The Excel import headers of the 0175 columns, by field: the raw key and
 * the Arabic and English names (compared after the import's header
 * normalisation — lower-case, spaces and dashes as underscores — so «Tax
 * Number» and `tax_number` are the same header).
 */
export const PARTY_IMPORT_HEADERS = {
  tax_number: ['tax_number', 'الرقم الضريبي', 'tax number', 'vat number'],
  commercial_register: [
    'commercial_register',
    'السجل التجاري',
    'commercial register',
    'cr number',
    'cr',
  ],
  address: ['address', 'العنوان'],
  city: ['city', 'المدينة'],
  email: ['email', 'البريد', 'البريد الالكتروني', 'البريد الإلكتروني', 'e-mail'],
  bank_name: ['bank_name', 'البنك', 'اسم البنك', 'bank', 'bank name'],
  iban: ['iban', 'الايبان', 'الآيبان'],
  contact_person: [
    'contact_person',
    'جهة الاتصال',
    'الشخص المسؤول',
    'contact person',
  ],
  contact_number: [
    'contact_number',
    'الجوال',
    'رقم التواصل',
    'contact number',
    'mobile',
  ],
} as const
export type PartyImportField = keyof typeof PARTY_IMPORT_HEADERS
