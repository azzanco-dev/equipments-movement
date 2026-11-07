import type { TranslationKey } from '@/i18n/translations'
import {
  COMMERCIAL_REGISTER_PATTERN,
  EMAIL_SHAPE_PATTERN,
  PARTY_ADDRESS_MAX,
  PARTY_BANK_NAME_MAX,
  PARTY_CONTACT_NUMBER_MAX,
  PARTY_CONTACT_PERSON_MAX,
  PARTY_EMAIL_MAX,
  PARTY_IMPORT_HEADERS,
  SAUDI_IBAN_PATTERN,
  SHORT_ADDRESS_PATTERN,
  TAX_NUMBER_PATTERN,
  normalizeEmail,
  normalizeIban,
  normalizeRegistryNumber,
  normalizeShortAddress,
  type PartyImportField,
} from '@/lib/partyFields'

/**
 * The optional columns of the supplier and client Excel imports (EM-260,
 * migration 0175). Pure helpers: the sheet is read by `src/lib/excel.ts`,
 * the duplicates against the stored rows are read by the dialogs.
 */

/** The optional columns of an import row, normalised like the database
 *  trigger (`null` when the cell is empty). */
export type PartyImportValues = Partial<Record<PartyImportField, string | null>>

/** The client import's optional columns. */
export const COMPANY_IMPORT_PARTY_FIELDS = [
  'contact_person',
  'contact_number',
  'tax_number',
  'commercial_register',
  'address',
  'short_address',
  'email',
] as const satisfies readonly PartyImportField[]

/** The supplier import's optional columns (the contact details of 0001, the
 *  0175 ones and the bank details). */
export const LESSOR_IMPORT_PARTY_FIELDS = [
  'contact_person',
  'contact_number',
  'tax_number',
  'commercial_register',
  'address',
  'short_address',
  'email',
  'bank_name',
  'iban',
] as const satisfies readonly PartyImportField[]

/** The form label of each column, also accepted as its header and used as
 *  the header of the templates. */
export const PARTY_LABEL_KEYS: Record<PartyImportField, TranslationKey> = {
  tax_number: 'taxNumber',
  commercial_register: 'commercialRegister',
  address: 'address',
  short_address: 'shortAddress',
  email: 'email',
  contact_person: 'contactPerson',
  contact_number: 'contactNumber',
  bank_name: 'bankName',
  iban: 'iban',
}

/** The free-text columns with their CHECK lengths. */
const PARTY_TEXT_LIMITS: Partial<
  Record<PartyImportField, readonly [number, TranslationKey]>
> = {
  address: [PARTY_ADDRESS_MAX, 'addressTooLong'],
  contact_person: [PARTY_CONTACT_PERSON_MAX, 'contactPersonTooLong'],
  contact_number: [PARTY_CONTACT_NUMBER_MAX, 'contactNumberTooLong'],
  bank_name: [PARTY_BANK_NAME_MAX, 'bankNameTooLong'],
}

/** Example values of the optional columns in the import templates. */
export const PARTY_TEMPLATE_SAMPLES: Record<PartyImportField, string> = {
  contact_person: 'محمد احمد',
  contact_number: '0500000000',
  tax_number: '300000000000003',
  commercial_register: '7001234567',
  address: 'حي العليا، طريق الملك فهد',
  short_address: 'RRRD2929',
  email: 'info@example.com',
  bank_name: 'مصرف الراجحي',
  iban: 'SA0380000000608010167519',
}

/**
 * The sheet header of each wanted column, matched after `normalizeKey`
 * (the import's header normalisation) by the names of
 * `PARTY_IMPORT_HEADERS` or the form's label.
 */
export function matchPartyHeaders(
  headers: readonly string[],
  fields: readonly PartyImportField[],
  t: (key: TranslationKey) => string,
  normalizeKey: (key: string) => string,
): Partial<Record<PartyImportField, string>> {
  const found: Partial<Record<PartyImportField, string>> = {}
  for (const header of headers) {
    const key = normalizeKey(header)
    const field = fields.find(
      (candidate) =>
        !found[candidate] &&
        [...PARTY_IMPORT_HEADERS[candidate], t(PARTY_LABEL_KEYS[candidate])].some(
          (name) => normalizeKey(name) === key,
        ),
    )
    if (field) found[field] = header
  }
  return found
}

/** One cell normalised as the trigger stores it (`null` when blank). */
export function normalizePartyCell(
  field: PartyImportField,
  raw: string,
): string | null {
  const value = raw.trim()
  if (!value) return null
  if (field === 'tax_number' || field === 'commercial_register')
    return normalizeRegistryNumber(value) || null
  if (field === 'iban') return normalizeIban(value) || null
  if (field === 'short_address') return normalizeShortAddress(value) || null
  if (field === 'email') return normalizeEmail(value) || null
  return value
}

/** The message of a bad shape or length, or `null` when the value is fine. */
export function partyCellError(
  field: PartyImportField,
  value: string | null,
): TranslationKey | null {
  if (!value) return null
  if (field === 'tax_number')
    return TAX_NUMBER_PATTERN.test(value) ? null : 'taxNumberFormatInvalid'
  if (field === 'commercial_register')
    return COMMERCIAL_REGISTER_PATTERN.test(value)
      ? null
      : 'commercialRegisterFormatInvalid'
  if (field === 'iban')
    return SAUDI_IBAN_PATTERN.test(value) ? null : 'ibanFormatInvalid'
  if (field === 'short_address')
    return SHORT_ADDRESS_PATTERN.test(value)
      ? null
      : 'shortAddressFormatInvalid'
  if (field === 'email')
    return value.length <= PARTY_EMAIL_MAX && EMAIL_SHAPE_PATTERN.test(value)
      ? null
      : 'emailFormatInvalid'
  const limit = PARTY_TEXT_LIMITS[field]
  return limit && value.length > limit[0] ? limit[1] : null
}

/** The optional values of one sheet row; each bad cell adds its message. */
export function readPartyValues(
  row: Record<string, unknown>,
  headers: Partial<Record<PartyImportField, string>>,
  fields: readonly PartyImportField[],
  t: (key: TranslationKey) => string,
  errors: string[],
): PartyImportValues {
  const values: PartyImportValues = {}
  for (const field of fields) {
    const header = headers[field]
    const value = normalizePartyCell(
      field,
      header ? String(row[header] ?? '') : '',
    )
    values[field] = value
    const error = partyCellError(field, value)
    if (error) errors.push(t(error))
  }
  return values
}

/** The tax numbers and CRs already stored, read by the import dialogs. */
export interface TakenPartyNumbers {
  tax_number: Set<string>
  commercial_register: Set<string>
}

/**
 * Marks the rows whose tax number or CR repeats another row of the file or
 * a stored record: the 0175 partial unique indexes would refuse them.
 */
export function markPartyDuplicates(
  rows: readonly (PartyImportValues & { _errors: string[] })[],
  taken: TakenPartyNumbers,
  t: (key: TranslationKey) => string,
): void {
  const seen: TakenPartyNumbers = {
    tax_number: new Set(),
    commercial_register: new Set(),
  }
  const messages = {
    tax_number: 'taxNumberDuplicate',
    commercial_register: 'commercialRegisterDuplicate',
  } as const
  for (const row of rows)
    for (const field of ['tax_number', 'commercial_register'] as const) {
      const value = row[field]
      if (!value) continue
      if (taken[field].has(value) || seen[field].has(value))
        row._errors.push(t(messages[field]))
      seen[field].add(value)
    }
}

/** The numbers of the file, for the dialog's read of the stored ones. */
export function partyNumbersOf(
  rows: readonly PartyImportValues[],
): { tax_number: string[]; commercial_register: string[] } {
  const collect = (field: 'tax_number' | 'commercial_register') =>
    Array.from(
      new Set(rows.map((row) => row[field]).filter((v): v is string => !!v)),
    )
  return {
    tax_number: collect('tax_number'),
    commercial_register: collect('commercial_register'),
  }
}

/** The insert payload of the optional columns: only the non-empty ones. */
export function partyImportPayload(
  row: PartyImportValues,
  fields: readonly PartyImportField[],
): PartyImportValues {
  const payload: PartyImportValues = {}
  for (const field of fields) if (row[field]) payload[field] = row[field]
  return payload
}

/** The template's example columns, headed by the form labels. */
export function partyTemplateColumns(
  fields: readonly PartyImportField[],
  t: (key: TranslationKey) => string,
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      t(PARTY_LABEL_KEYS[field]),
      PARTY_TEMPLATE_SAMPLES[field],
    ]),
  )
}
