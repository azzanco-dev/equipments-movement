import type { Lessor } from '@/lib/types'
import {
  lessorFormSchema,
  mapDatabaseErrorToField,
  validateWithSchema,
  type DatabaseFieldRule,
  type FieldErrors,
  type PostgresLikeError,
} from '@/lib/formValidation'
import {
  normalizeIban,
  optionalTextOrNull,
  partySharedDatabaseRules,
  partySharedFormValues,
  partySharedPayload,
} from '@/lib/partyFields'

/** Values held by the lessor add/edit dialog. */
export interface LessorFormValues {
  name: string
  contact_person: string
  contact_number: string
  /** EM-260 (migration 0175): the official and contact details. */
  tax_number: string
  commercial_register: string
  address: string
  /** 0179: the short national address, «RRRD2929». */
  short_address: string
  city: string
  email: string
  /** The bank details (owner 2026-11-04, «البنك والايبان»). */
  bank_name: string
  iban: string
}

export const EMPTY_LESSOR_FORM: LessorFormValues = {
  name: '',
  contact_person: '',
  contact_number: '',
  tax_number: '',
  commercial_register: '',
  address: '',
  short_address: '',
  city: '',
  email: '',
  bank_name: '',
  iban: '',
}

/** Maps an existing record onto the form values. */
export function lessorFormValues(lessor: Lessor): LessorFormValues {
  return {
    name: lessor.name,
    contact_person: lessor.contact_person ?? '',
    contact_number: lessor.contact_number ?? '',
    ...partySharedFormValues(lessor),
    bank_name: lessor.bank_name ?? '',
    iban: lessor.iban ?? '',
  }
}

/** The order the fields appear in, used to focus the first invalid one:
 *  the name, «بيانات رسمية», then «بيانات الاتصال». */
export const LESSOR_FIELD_ORDER = [
  'name',
  'tax_number',
  'commercial_register',
  'address',
  'short_address',
  'contact_person',
  'contact_number',
  'email',
  'bank_name',
  'iban',
] as const

/**
 * Only the name is mandatory; the contact details stay unvalidated, exactly
 * as before, and the 0175 fields are optional with their shapes.
 */
export function validateLessorForm(
  form: LessorFormValues,
): FieldErrors<LessorFormValues> {
  return validateWithSchema(lessorFormSchema, form)
}

/**
 * Database rejections of a supplier save, by field: the 0175 partial unique
 * indexes and CHECKs of `lessors` (`lessors_tax_number_unique`,
 * `lessors_iban_check`, …).
 */
export const LESSOR_DATABASE_RULES: readonly DatabaseFieldRule<LessorFormValues>[] =
  [
    ...partySharedDatabaseRules<LessorFormValues>('lessors', {
      tax_number: 'taxNumberExistsLessor',
      commercial_register: 'commercialRegisterExistsLessor',
    }),
    {
      on: 'check',
      match: 'lessors_bank_name_check',
      field: 'bank_name',
      key: 'bankNameTooLong',
    },
    // 0177: the bank must be one of the banks list (deleted meanwhile).
    {
      on: 'foreignKey',
      match: 'lessors_bank_name_fkey',
      field: 'bank_name',
      key: 'bankNotInList',
    },
    {
      on: 'check',
      match: 'lessors_iban_check',
      field: 'iban',
      key: 'ibanFormatInvalid',
    },
  ]

/** The field errors of a known database rejection, or `null` (the dialog
 *  then shows its safe top-level message). */
export function lessorSaveFieldErrors(
  error: PostgresLikeError | null | undefined,
): FieldErrors<LessorFormValues> | null {
  return mapDatabaseErrorToField(error, LESSOR_DATABASE_RULES)
}

/** Insert/update payload for the `lessors` table (normalised like the
 *  0175 trigger, so what the form validated is what is stored). */
export function buildLessorPayload(form: LessorFormValues) {
  return {
    name: form.name.trim(),
    contact_person: form.contact_person.trim() || null,
    contact_number: form.contact_number.trim() || null,
    ...partySharedPayload(form),
    bank_name: optionalTextOrNull(form.bank_name),
    iban: normalizeIban(form.iban) || null,
  }
}
