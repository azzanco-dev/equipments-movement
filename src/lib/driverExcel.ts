import * as XLSX from 'xlsx'
import { readWorkbookSafely } from '@/lib/safeWorkbook'
import {
  DRIVER_EMPLOYEE_NUMBER_MAX,
  normalizeEmployeeNumber,
} from '@/lib/driverEmployeeNumber'

export { normalizeEmployeeNumber }

export const DRIVER_NATIONALITIES = [
  'اليمن',
  'مصر',
  'باكستان',
  'الهند',
  'نيبال',
  'بنجلاديش',
  'السودان',
] as const
/**
 * wave-13-drivers: drivers of external-supplier equipment. Quick Create in the
 * movement form gives it to a NEW driver when the selected equipment's owner
 * is the external supplier (decided in `quick_create_driver`, migration 0119),
 * and the drivers list hides these drivers by default.
 */
export const EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE = 'مورد خارجي'

/**
 * Must match the `drivers.employment_type` CHECK constraint exactly (0033,
 * widened by 0119). The extracting module keeps its own list.
 */
export const DRIVER_EMPLOYMENT_TYPES = [
  'العزاني',
  'تكوين',
  'البناء',
  'البدراني',
  'امدادات العربة',
  'نقدي',
  EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE,
] as const

export type DriverImportRow = {
  rowNumber: number
  full_name: string
  name_en: string | null
  id_number: string | null
  mobile_number: string | null
  nationality: string | null
  employment_type: string | null
  job_title: string | null
  /** «الرقم الوظيفي» (EM-237), trimmed; null when the column is empty. */
  employee_number: string | null
  errors: string[]
  /** The id or mobile number is repeated in the file or already recorded. */
  duplicate: boolean
  /**
   * The employee number is repeated in the file or already recorded, compared
   * as upper(trim) like `drivers_employee_number_unique` (migration 0131).
   * Reported on its own so the row carries a clear note.
   */
  duplicateEmployeeNumber: boolean
}

type DriverColumn =
  | 'full_name'
  | 'name_en'
  | 'id_number'
  | 'mobile_number'
  | 'nationality'
  | 'employment_type'
  | 'job_title'
  | 'employee_number'

/** The Arabic header of the import column is accepted next to its key. */
export const DRIVER_EMPLOYEE_NUMBER_HEADER_AR = 'الرقم الوظيفي'

/** Validation error of an over-long employee number in the import preview. */
export const DRIVER_EMPLOYEE_NUMBER_IMPORT_ERROR = 'employee_number غير صالح'

export async function parseDriverWorkbook(
  file: File,
): Promise<DriverImportRow[]> {
  const workbook = readWorkbookSafely(XLSX, await file.arrayBuffer(), {
    type: 'array',
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  })
  return parseDriverRows(rows)
}

/** The parsing of `parseDriverWorkbook` on the sheet's rows (testable). */
export function parseDriverRows(
  rows: readonly Record<string, unknown>[],
): DriverImportRow[] {
  const seenIds = new Set<string>()
  const seenMobiles = new Set<string>()
  const seenEmployeeNumbers = new Set<string>()
  return rows.map((raw, index) => {
    const value = (key: DriverColumn) => String(raw[key] ?? '').trim()
    const full_name = value('full_name')
    const id_number = value('id_number') || null
    const mobile_number = value('mobile_number') || null
    const nationality = value('nationality') || null
    const employment_type = value('employment_type') || null
    const employee_number =
      value('employee_number') ||
      String(raw[DRIVER_EMPLOYEE_NUMBER_HEADER_AR] ?? '').trim() ||
      null
    const errors: string[] = []
    if (!full_name) errors.push('full_name مطلوب')
    if (id_number && !/^\d{5,20}$/.test(id_number))
      errors.push('id_number غير صالح')
    if (mobile_number && !/^\+?\d{7,15}$/.test(mobile_number))
      errors.push('mobile_number غير صالح')
    if (
      nationality &&
      !DRIVER_NATIONALITIES.includes(
        nationality as (typeof DRIVER_NATIONALITIES)[number],
      )
    )
      errors.push('nationality غير معتمدة')
    if (
      employment_type &&
      !DRIVER_EMPLOYMENT_TYPES.includes(
        employment_type as (typeof DRIVER_EMPLOYMENT_TYPES)[number],
      )
    )
      errors.push('employment_type غير معتمد')
    if (employee_number && employee_number.length > DRIVER_EMPLOYEE_NUMBER_MAX)
      errors.push(DRIVER_EMPLOYEE_NUMBER_IMPORT_ERROR)
    const duplicate = Boolean(
      (id_number && seenIds.has(id_number)) ||
      (mobile_number && seenMobiles.has(mobile_number)),
    )
    const employeeKey = employee_number
      ? normalizeEmployeeNumber(employee_number)
      : null
    const duplicateEmployeeNumber = Boolean(
      employeeKey && seenEmployeeNumbers.has(employeeKey),
    )
    if (id_number) seenIds.add(id_number)
    if (mobile_number) seenMobiles.add(mobile_number)
    if (employeeKey) seenEmployeeNumbers.add(employeeKey)
    return {
      rowNumber: index + 2,
      full_name,
      name_en: value('name_en') || null,
      id_number,
      mobile_number,
      nationality,
      employment_type,
      job_title: value('job_title') || null,
      employee_number,
      errors,
      duplicate,
      duplicateEmployeeNumber,
    }
  })
}

/** An employee number PostgREST accepts unquoted and ILIKE reads literally. */
const PLAIN_EMPLOYEE_NUMBER = /^[A-Za-z0-9-]+$/

/**
 * The `.or()` filter that finds the stored employee numbers equal to any of
 * `values` the way `drivers_employee_number_unique` compares them (case- and
 * space-insensitive): `ilike` without a wildcard is a case-insensitive
 * equality. A value with characters ILIKE or PostgREST would read as syntax
 * (`%`, `_`, `*`, `,`, `.`, quotes, spaces...) falls back to an exact,
 * double-quoted `eq`, so the lookup never breaks on it. Null when there is
 * nothing to look up.
 */
export function employeeNumberLookupFilter(
  values: readonly string[],
): string | null {
  const parts = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    if (PLAIN_EMPLOYEE_NUMBER.test(value))
      parts.add(`employee_number.ilike.${value}`)
    else
      parts.add(
        `employee_number.eq."${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      )
  }
  return parts.size ? [...parts].join(',') : null
}

export function downloadDriverTemplate() {
  const sheet = XLSX.utils.json_to_sheet([
    {
      full_name: 'محمد أحمد',
      name_en: 'Mohammed Ahmed',
      id_number: '1234567890',
      mobile_number: '0500000000',
      nationality: 'اليمن',
      employment_type: 'العزاني',
      job_title: 'سائق',
      employee_number: 'E-1001',
    },
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Drivers')
  XLSX.writeFile(workbook, 'drivers-import-template.xlsx')
}
