/**
 * «الرقم الوظيفي» of a driver (EM-237, migration 0131). A dependency-free
 * module so the form schema (`formValidation`) and the Excel helpers
 * (`driverExcel`, which `listConfigs` loads) share the rules without the
 * Excel helpers pulling in zod.
 */

/** `drivers.employee_number`: at most 30 characters once trimmed
 *  (`drivers_employee_number_check`). */
export const DRIVER_EMPLOYEE_NUMBER_MAX = 30

/** The comparison of `drivers_employee_number_unique`: upper(btrim(..)). */
export function normalizeEmployeeNumber(value: string): string {
  return value.trim().toUpperCase()
}
