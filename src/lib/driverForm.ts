import type { Driver } from '@/lib/types'
import {
  driverFormSchema,
  mapDatabaseErrorToField,
  MOBILE_NUMBER_PATTERN,
  PERSON_NAME_MAX,
  PERSON_NAME_MIN,
  quickDriverFormSchema,
  validateWithSchema,
  type DatabaseFieldRule,
  type FieldErrors,
  type PostgresLikeError,
} from '@/lib/formValidation'

/** Values held by the driver add/edit dialog. */
export interface DriverFormValues {
  full_name: string
  name_en: string
  id_number: string
  mobile_number: string
  nationality: string
  employment_type: string
  job_title: string
}

export const EMPTY_DRIVER_FORM: DriverFormValues = {
  full_name: '',
  name_en: '',
  id_number: '',
  mobile_number: '',
  nationality: '',
  employment_type: '',
  job_title: '',
}

/** Maps an existing record onto the form values. */
export function driverFormValues(driver: Driver): DriverFormValues {
  return {
    full_name: driver.full_name,
    name_en: driver.name_en ?? '',
    id_number: driver.id_number ?? '',
    mobile_number: driver.mobile_number ?? '',
    nationality: driver.nationality ?? '',
    employment_type: driver.employment_type ?? '',
    job_title: driver.job_title ?? '',
  }
}

/** Digits only, as the id column stores them. */
export function sanitizeIdNumber(value: string): string {
  return value.replace(/\D/g, '')
}

/** Digits plus a single leading `+`. */
export function sanitizeMobileNumber(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
}

/** Mirrors the `drivers_mobile_number_check` database constraint. */
export const DRIVER_MOBILE_PATTERN = MOBILE_NUMBER_PATTERN

/** `drivers.full_name` and `drivers.name_en`: 2 to 150 characters once
 *  trimmed (migrations 0033 and 0078). */
export const DRIVER_NAME_MIN = PERSON_NAME_MIN
export const DRIVER_NAME_MAX = PERSON_NAME_MAX

/** The order the fields appear in, used to focus the first invalid one. */
export const DRIVER_FIELD_ORDER = [
  'full_name',
  'name_en',
  'id_number',
  'mobile_number',
  'nationality',
  'employment_type',
  'job_title',
] as const

/**
 * Only `full_name` is mandatory for a complete driver record (AGENTS.md);
 * the English name and the id and mobile numbers are validated only when they
 * are filled in. Every rule mirrors a database check: the name lengths
 * (`drivers_full_name_check`, `drivers_name_en_check`) and
 * `drivers_id_number_check` / `drivers_mobile_number_check`.
 */
export function validateDriverForm(
  form: DriverFormValues,
): FieldErrors<DriverFormValues> {
  return validateWithSchema(driverFormSchema, form)
}

/** Values held by the inline quick-create driver panel. */
export interface QuickDriverFormValues {
  fullName: string
  mobile: string
}

export const QUICK_DRIVER_FIELD_ORDER = ['fullName', 'mobile'] as const

/**
 * Quick Create intentionally requires the full name and a valid mobile
 * number (AGENTS.md); `quick_create_driver` rejects anything else.
 */
export function validateQuickDriverForm(
  form: QuickDriverFormValues,
): FieldErrors<QuickDriverFormValues> {
  return validateWithSchema(quickDriverFormSchema, form)
}

/**
 * `quick_create_driver` (migration 0119) raises `invalid_quick_driver` for a
 * blank name or a malformed mobile; the form already refuses a blank name, so
 * it is the mobile. The table checks still apply to the row it inserts.
 */
export const QUICK_DRIVER_DATABASE_RULES: readonly DatabaseFieldRule<QuickDriverFormValues>[] =
  [
    {
      on: 'raised',
      match: 'invalid_quick_driver',
      field: 'mobile',
      key: 'mobileNumberFormatInvalid',
    },
    {
      on: 'check',
      match: 'drivers_full_name',
      field: 'fullName',
      key: 'nameLengthInvalid',
    },
    {
      on: 'check',
      match: 'drivers_mobile_number',
      field: 'mobile',
      key: 'mobileNumberFormatInvalid',
    },
    {
      on: 'unique',
      match: 'mobile_number',
      field: 'mobile',
      key: 'mobileExists',
    },
  ]

export function quickDriverSaveFieldErrors(
  error: PostgresLikeError | null | undefined,
): FieldErrors<QuickDriverFormValues> | null {
  return mapDatabaseErrorToField(error, QUICK_DRIVER_DATABASE_RULES)
}

/**
 * Database rejections of a driver save, by field: `drivers` is unique on the
 * mobile and the id number, and its checks cover the name lengths, both number
 * formats, and the controlled nationality and employment-type lists.
 */
export const DRIVER_DATABASE_RULES: readonly DatabaseFieldRule<DriverFormValues>[] =
  [
    {
      on: 'unique',
      match: 'mobile_number',
      field: 'mobile_number',
      key: 'mobileExists',
    },
    {
      on: 'unique',
      match: 'id_number',
      field: 'id_number',
      key: 'driverIdExists',
    },
    {
      on: 'check',
      match: 'drivers_full_name',
      field: 'full_name',
      key: 'nameLengthInvalid',
    },
    {
      on: 'check',
      match: 'drivers_name_en',
      field: 'name_en',
      key: 'nameLengthInvalid',
    },
    {
      on: 'check',
      match: 'drivers_id_number',
      field: 'id_number',
      key: 'idNumberFormatInvalid',
    },
    {
      on: 'check',
      match: 'drivers_mobile_number',
      field: 'mobile_number',
      key: 'mobileNumberFormatInvalid',
    },
    {
      on: 'check',
      match: 'drivers_nationality',
      field: 'nationality',
      key: 'valueNotInList',
    },
    {
      on: 'check',
      match: 'drivers_employment_type',
      field: 'employment_type',
      key: 'valueNotInList',
    },
    {
      on: 'notNull',
      match: '"full_name"',
      field: 'full_name',
      key: 'fullNameRequired',
    },
  ]

export function driverSaveFieldErrors(
  error: PostgresLikeError | null | undefined,
): FieldErrors<DriverFormValues> | null {
  return mapDatabaseErrorToField(error, DRIVER_DATABASE_RULES)
}

/** Insert/update payload for the `drivers` table. */
export function buildDriverPayload(form: DriverFormValues) {
  return {
    full_name: form.full_name.trim(),
    name_en: form.name_en.trim() || null,
    id_number: form.id_number.trim() || null,
    mobile_number: form.mobile_number.trim() || null,
    nationality: form.nationality || null,
    employment_type: form.employment_type || null,
    job_title: form.job_title.trim() || null,
  }
}
