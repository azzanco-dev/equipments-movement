import type { TranslationKey } from '@/i18n/translations'
import type { Driver } from '@/lib/types'

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

/**
 * Only `full_name` is mandatory for a complete driver record (AGENTS.md);
 * the id and mobile numbers are validated only when they are filled in.
 */
export function validateDriverForm(
  form: DriverFormValues,
): TranslationKey | null {
  if (!form.full_name.trim()) return 'driverValidationError'
  if (form.id_number && !/^\d{5,20}$/.test(form.id_number))
    return 'driverValidationError'
  if (form.mobile_number && !/^\+?\d{7,15}$/.test(form.mobile_number))
    return 'driverValidationError'
  return null
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
