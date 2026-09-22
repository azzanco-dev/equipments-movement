import type { Driver } from '@/lib/types'
import {
  digitsRange,
  duplicateFieldErrors,
  fieldErrors,
  pattern,
  required,
  type FieldErrors,
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
export const DRIVER_MOBILE_PATTERN = /^\+?\d{7,15}$/

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
 * the id and mobile numbers are validated only when they are filled in, and
 * their formats mirror the `drivers_id_number_check` and
 * `drivers_mobile_number_check` database constraints.
 */
export function validateDriverForm(
  form: DriverFormValues,
): FieldErrors<DriverFormValues> {
  return fieldErrors<DriverFormValues>({
    full_name: required(form.full_name, 'fullNameRequired'),
    id_number: digitsRange(form.id_number, 5, 20, 'idNumberFormatInvalid'),
    mobile_number: pattern(
      form.mobile_number,
      DRIVER_MOBILE_PATTERN,
      'mobileNumberFormatInvalid',
    ),
  })
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
  return fieldErrors<QuickDriverFormValues>({
    fullName: required(form.fullName, 'fullNameRequired'),
    mobile:
      required(form.mobile, 'mobileNumberRequired') ??
      pattern(form.mobile, DRIVER_MOBILE_PATTERN, 'mobileNumberFormatInvalid'),
  })
}

/** `drivers` is unique on the mobile number and on the id number. */
export function driverSaveFieldErrors(
  error: { code?: string | null; message?: string | null } | null | undefined,
): FieldErrors<DriverFormValues> | null {
  return duplicateFieldErrors<DriverFormValues>(error, [
    { match: 'mobile_number', field: 'mobile_number', key: 'mobileExists' },
    { match: 'id_number', field: 'id_number', key: 'driverIdExists' },
  ])
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
