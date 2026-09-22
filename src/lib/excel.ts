import * as XLSX from 'xlsx'
import type { TranslationKey } from '@/i18n/translations'
import type {
  EntryExitLog,
  EquipmentVisit,
  OperationalStatus,
  OwnershipStatus,
  RegistrationType,
} from '@/lib/types'
import { normalizePlateNumber } from '@/lib/plate'

export interface CompanyImportRow {
  name_ar: string
  name_en: string
  _rowNumber: number
  _errors: string[]
}

export interface ProjectImportRow {
  name_ar: string
  name_en: string
  _rowNumber: number
  _errors: string[]
}

export interface EquipmentImportRow {
  code: string
  type: string
  plate_number: string | null
  operational_status: OperationalStatus
  ownership_status: OwnershipStatus
  brand: string | null
  model: string | null
  manufacture_year: number | null
  chassis_number: string | null
  registration_type: RegistrationType | null
  project_name: string | null
  lessor_name: string | null
  last_maintenance_date: string | null
  registration_expiry: string | null
  insurance_expiry: string | null
  _rowNumber: number
  _errors: string[]
}

const OP_STATUS_MAP: Record<string, OperationalStatus> = {
  operational: 'operational',
  تعمل: 'operational',
  maintenance: 'maintenance',
  تحت_الصيانة: 'maintenance',
  صيانة: 'maintenance',
  stopped: 'stopped',
  متوقفة: 'stopped',
  متوقف: 'stopped',
}

const OWN_STATUS_MAP: Record<string, OwnershipStatus> = {
  alazani: 'alazani',
  al_azani: 'alazani',
  al_azzani: 'alazani',
  alazni: 'alazani',
  عزاني: 'alazani',
  العزاني: 'alazani',
  عبدالله_العزاني: 'alazani',
  شركة_عبدالله_العزاني_للمقاولات: 'alazani',
  'abdullah_al_azani_contracting_co.': 'alazani',
  takween: 'takween',
  تكوين: 'takween',
  شركة_تكوين_المعدات_للمقاولات: 'takween',
  'takween_equipment_contracting_co.': 'takween',
  third_party_f: 'third_party_f',
  مملوكة_للغير_f: 'third_party_f',
  غير_f: 'third_party_f',
  third_party_partnership_b: 'third_party_partnership_b',
  مملوكة_للغير_b: 'third_party_partnership_b',
  مملوكة_للغير_شراكة_b: 'third_party_partnership_b',
  شراكة_b: 'third_party_partnership_b',
  external_supplier: 'external_supplier',
  مورد_خارجي: 'external_supplier',
  مورّد_خارجي: 'external_supplier',
  مالك_آخر: 'external_supplier',
  مورد: 'external_supplier',
}

const REG_TYPE_MAP: Record<string, RegistrationType> = {
  private_transport: 'private_transport',
  نقل_خاص: 'private_transport',
  public_transport: 'public_transport',
  نقل_عام: 'public_transport',
  heavy_equipment: 'heavy_equipment',
  معدات_ثقيلة: 'heavy_equipment',
}

function normalizeKey(key: string): string {
  return key
    .toString()
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
}

function parseDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  if (!str) return null
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return null
}

export function parseEquipmentExcel(
  data: ArrayBuffer,
  t: (key: TranslationKey) => string,
): EquipmentImportRow[] {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
    defval: '',
  })

  const keyMap: Record<string, string> = {}
  for (const k of Object.keys(json[0] ?? {})) {
    const nk = normalizeKey(k)
    if (nk === normalizeKey(t('equipmentCode'))) keyMap['code'] = k
    else if (nk === normalizeKey(t('equipmentType'))) keyMap['type'] = k
    else if (nk === normalizeKey(t('plateNumber'))) keyMap['plate_number'] = k
    else if (nk === normalizeKey(t('operationalStatus')))
      keyMap['operational_status'] = k
    else if (nk === normalizeKey(t('ownershipStatus')))
      keyMap['ownership_status'] = k
    else if (nk === normalizeKey(t('brand'))) keyMap['brand'] = k
    else if (nk === normalizeKey(t('model'))) keyMap['model'] = k
    else if (nk === normalizeKey(t('manufactureYear')))
      keyMap['manufacture_year'] = k
    else if (nk === normalizeKey(t('chassisNumber')))
      keyMap['chassis_number'] = k
    else if (nk === normalizeKey(t('registrationType')))
      keyMap['registration_type'] = k
    else if (nk === normalizeKey(t('project'))) keyMap['project_name'] = k
    else if (nk === normalizeKey(t('lessor'))) keyMap['lessor_name'] = k
    else if (nk === normalizeKey(t('lastMaintenanceDate')))
      keyMap['last_maintenance_date'] = k
    else if (nk === normalizeKey(t('registrationExpiry')))
      keyMap['registration_expiry'] = k
    else if (nk === normalizeKey(t('insuranceExpiry')))
      keyMap['insurance_expiry'] = k
  }

  return json.map((row, idx) => {
    const errors: string[] = []
    const get = (field: string) => {
      const k = keyMap[field]
      return k ? String(row[k] ?? '').trim() : ''
    }

    const code = get('code')
    if (!code) errors.push(t('equipmentCode'))

    const type = get('type')
    if (!type) errors.push(t('equipmentType'))

    const opRaw = normalizeKey(get('operational_status'))
    const opStatus =
      OP_STATUS_MAP[opRaw] ?? (opRaw === '' ? 'operational' : undefined)
    if (!opStatus) errors.push(t('operationalStatus'))

    const ownRaw = normalizeKey(get('ownership_status'))
    const ownStatus =
      OWN_STATUS_MAP[ownRaw] ?? (ownRaw === '' ? 'alazani' : undefined)
    if (!ownStatus) errors.push(t('ownershipStatus'))

    const regRaw = normalizeKey(get('registration_type'))
    const regType = regRaw ? (REG_TYPE_MAP[regRaw] ?? null) : null
    if (regRaw && !regType) errors.push(t('registrationType'))

    const yearRaw = get('manufacture_year')
    const year = yearRaw ? parseInt(yearRaw, 10) : null
    if (year !== null && (isNaN(year) || year < 1900 || year > 2100))
      errors.push(t('manufactureYear'))

    const rawPlateNumber = get('plate_number')
    const plateNumber = rawPlateNumber
      ? normalizePlateNumber(rawPlateNumber)
      : null
    if (plateNumber && !/^[0-9]{1,4}(?:-[A-Z]{1,3})?$/.test(plateNumber))
      errors.push(t('plateNumber'))

    return {
      code,
      type,
      plate_number: plateNumber,
      operational_status: opStatus ?? 'operational',
      ownership_status: ownStatus ?? 'alazani',
      brand: get('brand') || null,
      model: get('model') || null,
      manufacture_year: year,
      chassis_number: get('chassis_number') || null,
      registration_type: regType,
      project_name: get('project_name') || null,
      lessor_name: get('lessor_name') || null,
      last_maintenance_date: parseDate(
        row[keyMap['last_maintenance_date'] ?? ''],
      ),
      registration_expiry: parseDate(row[keyMap['registration_expiry'] ?? '']),
      insurance_expiry: parseDate(row[keyMap['insurance_expiry'] ?? '']),
      _rowNumber: idx + 2,
      _errors: errors,
    }
  })
}

export function downloadEquipmentTemplate(t: (key: TranslationKey) => string) {
  const sample = [
    {
      [t('equipmentCode')]: 'A001',
      [t('equipmentType')]: 'Crane 50 Ton',
      [t('plateNumber')]: '1234-ABC',
      [t('operationalStatus')]: t('operational'),
      [t('ownershipStatus')]: t('ownershipAlazani'),
      [t('brand')]: 'XCMG',
      [t('model')]: 'QY50K',
      [t('manufactureYear')]: 2022,
      [t('chassisNumber')]: 'LZXG50K12345',
      [t('registrationType')]: t('heavyEquipment'),
      [t('project')]: '',
      [t('lessor')]: '',
      [t('lastMaintenanceDate')]: '',
      [t('registrationExpiry')]: '',
      [t('insuranceExpiry')]: '',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(sample)
  ws['!cols'] = [
    { wch: 15 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Equipment')
  XLSX.writeFile(wb, 'equipment-template.xlsx')
}

// ============ FORMATTED EXPORTS ============
//
// One shared way to write an export sheet, so every exported file in the app
// opens the same way: Arabic headers from the translation system, a frozen
// header row with an autofilter on it, readable column widths, a right-to-left
// sheet for the Arabic interface, and timestamps that read as Saudi time
// wherever the file is opened.

/** Excel's own date format code; `hh` is 24-hour in a workbook number format. */
export const EXCEL_DATETIME_FORMAT = 'dd/mm/yyyy hh:mm'

/** Days between Excel's epoch (1899-12-30) and the Unix epoch. */
const EXCEL_EPOCH_DAYS = 25569
const MINUTES_PER_DAY = 24 * 60
/** Saudi Arabia is UTC+03:00 all year, exactly as `@/lib/saudiTime` assumes. */
const SAUDI_OFFSET_MINUTES = 3 * 60

/**
 * An instant as an Excel date serial in Saudi time, or `null` when it is
 * missing or unparseable.
 *
 * A real date cell is written rather than pre-formatted text so the column
 * still sorts and filters as a date in Excel. The serial is computed from the
 * UTC instant plus a fixed +03:00, never from the machine's timezone, so the
 * file shows the same Saudi wall-clock time on every device — the same rule
 * the reports and the dashboard already follow. Whole minutes are used because
 * the display format stops at minutes, and a rounded serial avoids a value
 * like 23:59:59.9995 rendering as the next minute.
 */
export function saudiExcelSerial(
  value: string | null | undefined,
): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  const minutes = Math.round(ms / 60000) + SAUDI_OFFSET_MINUTES
  return EXCEL_EPOCH_DAYS + minutes / MINUTES_PER_DAY
}

export type ExcelCellValue = string | number | null

/**
 * One exported column.
 *
 * `type: 'date'` means `value` returns an ISO timestamp, which the writer
 * converts to a Saudi-time date cell; everything else is written as given.
 * Badges and enums are converted to plain text by `value` (دخول / خروج), never
 * exported as a code the reader would have to decode.
 */
export interface ExcelColumn<T> {
  header: string
  /** Column width in characters; a sensible default is used when omitted. */
  width?: number
  type?: 'text' | 'date'
  value: (row: T) => ExcelCellValue
}

export interface ExportRowsOptions {
  /** File name, with or without the `.xlsx` suffix. */
  fileName: string
  /** Right-to-left sheet layout; pass `lang === 'ar'`. */
  rtl?: boolean
}

const DEFAULT_COLUMN_WIDTH = 16

/** `0 -> A`, `26 -> AA`; the autofilter needs the last column's letter. */
export function excelColumnLetter(index: number): string {
  let rest = Math.max(0, Math.trunc(index))
  let letter = ''
  for (;;) {
    letter = String.fromCharCode(65 + (rest % 26)) + letter
    if (rest < 26) return letter
    rest = Math.floor(rest / 26) - 1
  }
}

/**
 * The sheet's cells, headers first.
 *
 * Kept pure and separate from the workbook so the headers, the column order
 * and the Saudi-time conversion can be unit-tested without a spreadsheet
 * library. A `null` cell is written as an empty cell rather than the string
 * "null"; an em dash is never written, because in a spreadsheet a placeholder
 * character blocks filtering and aggregation.
 */
export function sheetAoa<T>(
  columns: ExcelColumn<T>[],
  rows: T[],
): ExcelCellValue[][] {
  return [
    columns.map((column) => column.header),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = column.value(row)
        if (column.type === 'date')
          return typeof value === 'string' ? saudiExcelSerial(value) : null
        return value ?? null
      }),
    ),
  ]
}

/**
 * Builds and downloads one formatted sheet.
 *
 * Shared by the movement log export, the visit export and — once the report
 * screens adopt it — the report exports, so a new export only has to describe
 * its columns.
 */
export function exportRowsToExcel<T>(
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[],
  options: ExportRowsOptions,
) {
  const aoa = sheetAoa(columns, rows)
  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  sheet['!cols'] = columns.map((column) => ({
    wch: column.width ?? DEFAULT_COLUMN_WIDTH,
  }))
  // The header row stays visible while the reader scrolls a long export.
  sheet['!freeze'] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: 'A2',
    activePane: 'bottomLeft',
    state: 'frozen',
  }
  const lastColumn = excelColumnLetter(Math.max(0, columns.length - 1))
  sheet['!autofilter'] = { ref: `A1:${lastColumn}${aoa.length}` }
  sheet['!rtl'] = Boolean(options.rtl)

  // Date cells carry the display format; `aoa_to_sheet` wrote them as plain
  // numbers, which would otherwise show as a five-digit serial.
  columns.forEach((column, columnIndex) => {
    if (column.type !== 'date') return
    for (let rowIndex = 1; rowIndex < aoa.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })
      const cell = sheet[address] as XLSX.CellObject | undefined
      if (!cell || typeof cell.v !== 'number') continue
      cell.t = 'n'
      cell.z = EXCEL_DATETIME_FORMAT
    }
  })

  const workbook = XLSX.utils.book_new()
  // Excel rejects a sheet name longer than 31 characters or containing []:*?/\
  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1',
  )
  XLSX.writeFile(
    workbook,
    options.fileName.endsWith('.xlsx')
      ? options.fileName
      : `${options.fileName}.xlsx`,
  )
}

export function exportLogsToExcel(
  logs: EntryExitLog[],
  fileName: string,
  t: (key: TranslationKey) => string,
  lang: 'ar' | 'en' = 'ar',
) {
  const columns: ExcelColumn<EntryExitLog>[] = [
    {
      header: t('contractorEquipmentCode'),
      width: 16,
      value: (log) => log.contractor_equipment_code ?? '',
    },
    {
      header: t('equipmentNameLabel'),
      width: 26,
      value: (log) =>
        log.equipment ? `${log.equipment.code} ${log.equipment.type}` : '',
    },
    {
      header: t('plateNumber'),
      width: 14,
      value: (log) => log.equipment?.plate_number ?? '',
    },
    {
      header: t('movementType'),
      width: 10,
      value: (log) => (log.movement_type === 'entry' ? t('entry') : t('exit')),
    },
    {
      header: t('driverName'),
      width: 22,
      // The driver is optional on a site entry since 2026-09-23.
      value: (log) => log.current_driver_name ?? log.driver_name ?? '',
    },
    {
      header: t('odometerReading'),
      width: 12,
      value: (log) => log.odometer_reading ?? '',
    },
    { header: t('notes'), width: 30, value: (log) => log.notes ?? '' },
    {
      header: t('supervisorName'),
      width: 22,
      value: (log) => log.supervisor?.full_name ?? '',
    },
    {
      header: t('recordedAt'),
      width: 18,
      type: 'date',
      value: (log) => log.recorded_at ?? null,
    },
  ]
  exportRowsToExcel(t('logs'), columns, logs, {
    fileName,
    rtl: lang === 'ar',
  })
}

export function exportVisitsToExcel(
  visits: EquipmentVisit[],
  fileName: string,
  t: (key: TranslationKey) => string,
  lang: 'ar' | 'en' = 'ar',
) {
  const columns: ExcelColumn<EquipmentVisit>[] = [
    {
      header: t('contractorEquipmentCode'),
      width: 16,
      value: (v) => v.contractor_equipment_code ?? '',
    },
    {
      header: t('equipmentNameLabel'),
      width: 26,
      value: (v) => `${v.equipment_code} ${v.equipment_type}`,
    },
    { header: t('plateNumber'), width: 14, value: (v) => v.plate_number ?? '' },
    { header: t('project'), width: 22, value: (v) => v.project_name_ar ?? '' },
    { header: t('company'), width: 22, value: (v) => v.company_name_ar ?? '' },
    {
      header: t('driverName'),
      width: 22,
      value: (v) =>
        v.last_driver_name ?? v.exit_driver_name ?? v.driver_name ?? '',
    },
    {
      header: t('entryTime'),
      width: 18,
      type: 'date',
      value: (v) => v.entry_recorded_at ?? null,
    },
    {
      header: t('entryBy'),
      width: 22,
      value: (v) => v.entry_supervisor_name ?? '',
    },
    {
      header: t('exitTime'),
      width: 18,
      type: 'date',
      value: (v) => v.exit_recorded_at ?? null,
    },
    {
      header: t('exitBy'),
      width: 22,
      value: (v) => v.exit_supervisor_name ?? '',
    },
    {
      header: t('odometerReading'),
      width: 12,
      value: (v) => v.odometer_reading ?? '',
    },
    {
      header: t('exportColExitOdometer'),
      width: 12,
      value: (v) => v.exit_odometer ?? '',
    },
    { header: t('notes'), width: 30, value: (v) => v.notes ?? '' },
    {
      header: t('exportColExitNotes'),
      width: 30,
      value: (v) => v.exit_notes ?? '',
    },
  ]
  exportRowsToExcel(t('exportSheetVisits'), columns, visits, {
    fileName,
    rtl: lang === 'ar',
  })
}

// ============ COMPANIES ============

export function parseCompaniesExcel(
  data: ArrayBuffer,
  t: (key: TranslationKey) => string,
): CompanyImportRow[] {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
    defval: '',
  })

  const keyMap: Record<string, string> = {}
  for (const k of Object.keys(json[0] ?? {})) {
    const nk = normalizeKey(k)
    if (nk === normalizeKey(t('companyNameAr'))) keyMap['name_ar'] = k
    else if (nk === normalizeKey(t('companyNameEn'))) keyMap['name_en'] = k
  }

  return json.map((row, idx) => {
    const errors: string[] = []
    const get = (field: string) => {
      const k = keyMap[field]
      return k ? String(row[k] ?? '').trim() : ''
    }

    const name_ar = get('name_ar')
    if (!name_ar) errors.push(t('companyNameAr'))

    const name_en = get('name_en')
    if (!name_en) errors.push(t('companyNameEn'))

    return {
      name_ar,
      name_en,
      _rowNumber: idx + 2,
      _errors: errors,
    }
  })
}

export function downloadCompanyTemplate(t: (key: TranslationKey) => string) {
  const sample = [
    {
      [t('companyNameAr')]: 'شركة المقاولات الحديثة',
      [t('companyNameEn')]: 'Modern Contracting Co.',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(sample)
  ws['!cols'] = [{ wch: 30 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Companies')
  XLSX.writeFile(wb, 'companies-template.xlsx')
}

// ============ PROJECTS ============

export function parseProjectsExcel(
  data: ArrayBuffer,
  t: (key: TranslationKey) => string,
): ProjectImportRow[] {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
    defval: '',
  })

  const keyMap: Record<string, string> = {}
  for (const k of Object.keys(json[0] ?? {})) {
    const nk = normalizeKey(k)
    if (nk === normalizeKey(t('projectNameAr'))) keyMap['name_ar'] = k
    else if (nk === normalizeKey(t('projectNameEn'))) keyMap['name_en'] = k
  }

  return json.map((row, idx) => {
    const errors: string[] = []
    const get = (field: string) => {
      const k = keyMap[field]
      return k ? String(row[k] ?? '').trim() : ''
    }

    const name_ar = get('name_ar')
    if (!name_ar) errors.push(t('projectNameAr'))

    const name_en = get('name_en')
    if (!name_en) errors.push(t('projectNameEn'))

    return {
      name_ar,
      name_en,
      _rowNumber: idx + 2,
      _errors: errors,
    }
  })
}

export function downloadProjectTemplate(t: (key: TranslationKey) => string) {
  const sample = [
    {
      [t('projectNameAr')]: 'مشروع الألفا',
      [t('projectNameEn')]: 'Project Alpha',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(sample)
  ws['!cols'] = [{ wch: 30 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Projects')
  XLSX.writeFile(wb, 'projects-template.xlsx')
}
