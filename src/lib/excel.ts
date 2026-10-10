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
import { exportRowsToExcel } from '@/lib/excelExport'
import type { ExcelColumn } from '@/lib/excelSheet'

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

/**
 * wave 18: a row error names its column AND the reason («رقم المعدة: مطلوب»),
 * instead of the bare column name.
 */
function columnError(
  t: (key: TranslationKey) => string,
  column: TranslationKey,
  reason: 'importColumnRequired' | 'importColumnInvalid',
): string {
  return t(reason).replace('{column}', t(column))
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
    if (!code)
      errors.push(columnError(t, 'equipmentCode', 'importColumnRequired'))

    const type = get('type')
    if (!type)
      errors.push(columnError(t, 'equipmentType', 'importColumnRequired'))

    const opRaw = normalizeKey(get('operational_status'))
    const opStatus =
      OP_STATUS_MAP[opRaw] ?? (opRaw === '' ? 'operational' : undefined)
    if (!opStatus)
      errors.push(columnError(t, 'operationalStatus', 'importColumnInvalid'))

    const ownRaw = normalizeKey(get('ownership_status'))
    const ownStatus =
      OWN_STATUS_MAP[ownRaw] ?? (ownRaw === '' ? 'alazani' : undefined)
    if (!ownStatus)
      errors.push(columnError(t, 'ownershipStatus', 'importColumnInvalid'))

    const regRaw = normalizeKey(get('registration_type'))
    const regType = regRaw ? (REG_TYPE_MAP[regRaw] ?? null) : null
    if (regRaw && !regType)
      errors.push(columnError(t, 'registrationType', 'importColumnInvalid'))

    const yearRaw = get('manufacture_year')
    const year = yearRaw ? parseInt(yearRaw, 10) : null
    if (year !== null && (isNaN(year) || year < 1900 || year > 2100))
      errors.push(columnError(t, 'manufactureYear', 'importColumnInvalid'))

    const rawPlateNumber = get('plate_number')
    const plateNumber = rawPlateNumber
      ? normalizePlateNumber(rawPlateNumber)
      : null
    if (plateNumber && !/^[0-9]{1,4}(?:-[A-Z]{1,3})?$/.test(plateNumber))
      errors.push(columnError(t, 'plateNumber', 'importColumnInvalid'))

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
// The shared export writer lives in `@/lib/excelExport` (the one module that
// imports `xlsx-js-style`) and its pure column/cell helpers in
// `@/lib/excelSheet`. They are re-exported here so existing callers keep
// working; new code that only writes a sheet should import `@/lib/excelExport`
// directly, which avoids pulling the import parsers' `xlsx` into the chunk.

export {
  EXCEL_DATETIME_FORMAT,
  excelColumnLetter,
  saudiExcelSerial,
  sheetAoa,
} from '@/lib/excelSheet'
export type {
  ExcelCellValue,
  ExcelColumn,
  ExportRowsOptions,
} from '@/lib/excelSheet'
export { exportRowsToExcel }

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
    if (!name_ar)
      errors.push(columnError(t, 'companyNameAr', 'importColumnRequired'))

    const name_en = get('name_en')
    if (!name_en)
      errors.push(columnError(t, 'companyNameEn', 'importColumnRequired'))

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
    if (!name_ar)
      errors.push(columnError(t, 'projectNameAr', 'importColumnRequired'))

    const name_en = get('name_en')
    if (!name_en)
      errors.push(columnError(t, 'projectNameEn', 'importColumnRequired'))

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
