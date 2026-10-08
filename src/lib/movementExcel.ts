import * as XLSX from 'xlsx'
import type { TranslationKey } from '@/i18n/translations'
import type { ExcelColumn } from '@/lib/excel'
import { saudiDateKey } from '@/lib/saudiTime'
import { exitPurposeExportLabel } from '@/lib/exitPurpose'
import {
  distinctIds,
  exportOwnerLabel,
  exportText,
  latestDriverChanges,
  lookupValue,
  type DriverChangeRow,
  type ExportLookups,
} from '@/lib/exportFields'

export type MovementImportMode = 'entry' | 'exit' | 'both'

export interface ParsedMovementImportRow {
  row_number: number
  mode: MovementImportMode
  supervisor_name: string
  company_name: string
  project_name: string
  equipment_code: string
  equipment_name: string
  plate_number: string
  contractor_equipment_code: string
  driver_name: string
  driver_number: string
  entry_date: string
  exit_date: string
  notes: string
}

const aliases = {
  supervisor_name: [
    'الفورمين',
    'المشرف',
    'اسم المشرف',
    'supervisor',
    'foreman',
  ],
  company_name: ['الشركة', 'اسم الشركة', 'company'],
  project_name: ['الموقع', 'المشروع', 'اسم المشروع', 'site', 'project'],
  equipment_code: [
    'رقم المعدة',
    'كود المعدة',
    'equipment code',
    'equipment number',
  ],
  equipment_name: [
    'المعدة',
    'اسم المعدة',
    'نوع المعدة',
    'equipment',
    'equipment name',
  ],
  plate_number: ['رقم اللوحة', 'plate number', 'plate'],
  contractor_equipment_code: [
    'ترقيم الشركة',
    'كود المقاول للمعدة',
    'company number',
    'contractor equipment code',
  ],
  driver_name: ['اسم سائق', 'اسم السائق', 'السائق', 'driver', 'driver name'],
  driver_number: [
    'رقم جوال السائق',
    'رقم السائق',
    'هوية السائق',
    'driver mobile',
    'driver id',
  ],
  entry_date: ['تاريخ الدخول', 'entry date'],
  exit_date: ['تاريخ الخروج', 'exit date'],
  notes: ['ملاحظات', 'الملاحظات', 'notes'],
} as const

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ـ_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function valueFor(row: Record<string, unknown>, names: readonly string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  )
  for (const name of names) {
    const value = normalized.get(normalizeHeader(name))
    if (value !== undefined && value !== null) return value
  }
  return ''
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function localDateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateString(value)
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }
  const raw = text(value)
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (local)
    return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : localDateString(parsed)
}

export async function parseMovementWorkbook(
  file: File,
): Promise<ParsedMovementImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: 'array',
    // Keep Excel dates as serial numbers. Converting them to JavaScript Date
    // objects applies the device timezone and can shift the calendar day.
    cellDates: false,
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('missing_sheet')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })
  return rows
    .map((row, index) => {
      const entryDate = excelDate(valueFor(row, aliases.entry_date))
      const exitDate = excelDate(valueFor(row, aliases.exit_date))
      const mode: MovementImportMode =
        entryDate && exitDate ? 'both' : exitDate ? 'exit' : 'entry'
      return {
        row_number: index + 2,
        mode,
        supervisor_name: text(valueFor(row, aliases.supervisor_name)),
        company_name: text(valueFor(row, aliases.company_name)),
        project_name: text(valueFor(row, aliases.project_name)),
        equipment_code: text(valueFor(row, aliases.equipment_code)),
        equipment_name: text(valueFor(row, aliases.equipment_name)),
        plate_number: text(valueFor(row, aliases.plate_number)),
        contractor_equipment_code: text(
          valueFor(row, aliases.contractor_equipment_code),
        ),
        driver_name: text(valueFor(row, aliases.driver_name)),
        driver_number: text(valueFor(row, aliases.driver_number)),
        entry_date: entryDate,
        exit_date: exitDate,
        notes: text(valueFor(row, aliases.notes)),
      }
    })
    .filter(
      (row) =>
        row.equipment_code ||
        row.plate_number ||
        row.entry_date ||
        row.exit_date,
    )
}

// ============ MOVEMENT LOG EXPORT ============
//
// The columns of the `/logs` export and the file it is written to. Everything
// here is pure so the headers, the fallbacks and the file name can be tested
// without a spreadsheet library; `exportRowsToExcel` in `@/lib/excel` turns
// the columns into the formatted sheet (frozen header, autofilter, widths,
// RTL, Saudi-time date cells). The values `movement_log_search` does not
// carry (the supplier, a changed driver and that driver's mobile) are looked
// up at export time through `@/lib/exportFields`, shared with the visits
// export.

type Translate = (key: TranslationKey) => string

/** Which movements the export covers; mirrors the `/logs` tabs. */
export type MovementExportContext = 'site' | 'workshop' | 'all'

/**
 * The movement fields the export reads.
 *
 * Declared here rather than imported so this file owns the shape it exports
 * and stays independent of the movement list's row type.
 */
export interface MovementExportRow {
  id?: string
  equipment_id?: string | null
  equipment_code?: string | null
  equipment_type?: string | null
  equipment_plate_number?: string | null
  equipment_chassis_number?: string | null
  /** The equipment's owner (`ownership_status`). */
  equipment_ownership_status?: string | null
  movement_type: 'entry' | 'exit'
  movement_context?: 'site' | 'workshop' | null
  workshop_purpose?: 'maintenance' | 'parking' | null
  /** A site exit's purpose (migrations 0111 / 0118); `null` otherwise. */
  exit_purpose?: string | null
  contractor_equipment_code?: string | null
  company_name_ar?: string | null
  company_name_en?: string | null
  project_name_ar?: string | null
  project_name_en?: string | null
  driver_id?: string | null
  /** The driver snapshot stored on the row. */
  driver_name?: string | null
  /** The mobile of `driver_id`, as the view joins it. */
  driver_mobile_number?: string | null
  /**
   * Set by `withCurrentMovementDrivers` on a site entry whose driver was
   * changed during the visit: the latest change's driver. Absent otherwise.
   */
  current_driver_id?: string | null
  current_driver_name?: string | null
  supervisor_name?: string | null
  notes?: string | null
  /** Kept for compatibility; not part of the current movement form. */
  odometer_reading?: number | null
  recorded_at: string
  created_at?: string | null
}

/**
 * The entry ids whose driver can have changed: site entries only (an exit
 * already stores the current driver, and a workshop row carries none).
 */
export function movementDriverChangeEntryIds(
  rows: readonly Pick<
    MovementExportRow,
    'id' | 'movement_type' | 'movement_context'
  >[],
): string[] {
  return rows
    .filter(
      (row) =>
        row.movement_type === 'entry' && row.movement_context !== 'workshop',
    )
    .map((row) => row.id ?? '')
    .filter(Boolean)
}

/**
 * Movements with the CURRENT driver of each site entry: the latest auditable
 * driver change, by `(changed_at, id)`, recorded during the visit it opened.
 * The row's own snapshot is never rewritten (the entry driver is immutable);
 * the export reads `current_driver_name ?? driver_name`.
 */
export function withCurrentMovementDrivers<T extends MovementExportRow>(
  rows: readonly T[],
  changes: readonly DriverChangeRow[],
): (T &
  Pick<MovementExportRow, 'current_driver_id' | 'current_driver_name'>)[] {
  const latest = latestDriverChanges(changes)
  return rows.map((row) => {
    if (row.movement_type !== 'entry' || !row.id) return row
    const change = latest.get(row.id)
    if (!change?.new_driver_name) return row
    return {
      ...row,
      current_driver_id: change.new_driver_id,
      current_driver_name: change.new_driver_name,
    }
  })
}

/** The drivers whose mobile the view does not carry: the changed ones. */
export function changedDriverIds(
  rows: readonly Pick<MovementExportRow, 'current_driver_id'>[],
): string[] {
  return distinctIds(rows.map((row) => row.current_driver_id))
}

/** The workshop purpose in words; empty for a site row or an unclassified one. */
function workshopPurposeLabel(row: MovementExportRow, t: Translate): string {
  if (row.movement_context !== 'workshop') return ''
  if (row.workshop_purpose === 'maintenance') return t('maintenancePurpose')
  if (row.workshop_purpose === 'parking') return t('parkingPurpose')
  return ''
}

/**
 * Every field of a movement, grouped for the export dialog: the equipment
 * (with owner and supplier), the movement (context, type, purposes), the
 * company and project (Arabic and English as separate columns), the driver,
 * then who recorded it and when, the notes and the odometer.
 *
 * Badges become plain text — دخول / خروج for the movement type and the
 * workshop purpose spelled out — because a spreadsheet has no badges and a
 * raw `entry` / `maintenance` code would leave the reader decoding values.
 *
 * @param lookups values resolved at export time: the supplier by equipment
 * and the mobile of a changed driver. Without them those cells export empty,
 * which is how the dialog builds its checklist before any row is read.
 */
export function movementExportColumns(
  t: Translate,
  // Kept for the callers: since every name has its own Arabic and English
  // column, no cell depends on the interface language any more.
  _lang: 'ar' | 'en',
  lookups: ExportLookups = {},
): ExcelColumn<MovementExportRow>[] {
  const equipment = t('exportGroupEquipment')
  const movement = t('exportGroupMovement')
  const companyProject = t('exportGroupCompanyProject')
  const driver = t('exportGroupDriver')
  const recording = t('exportGroupRecording')
  return [
    {
      key: 'equipment_code',
      mandatory: true,
      group: equipment,
      header: t('equipmentCodeLabel'),
      width: 14,
      value: (row) => row.equipment_code ?? '',
    },
    {
      key: 'equipment_type',
      mandatory: true,
      group: equipment,
      header: t('equipmentType'),
      width: 24,
      value: (row) => row.equipment_type ?? '',
    },
    {
      key: 'plate_number',
      mandatory: true,
      group: equipment,
      header: t('plateNumber'),
      width: 14,
      value: (row) => row.equipment_plate_number ?? '',
    },
    {
      key: 'chassis_number',
      group: equipment,
      header: t('chassisNumber'),
      width: 20,
      value: (row) => exportText(row.equipment_chassis_number),
    },
    {
      key: 'owner',
      group: equipment,
      header: t('ownershipStatus'),
      width: 16,
      value: (row) => exportOwnerLabel(row.equipment_ownership_status, t),
    },
    {
      // Looked up at export time, exactly like the visits export.
      key: 'supplier',
      group: equipment,
      header: t('lessor'),
      width: 24,
      value: (row) =>
        lookupValue(lookups.supplierByEquipment, row.equipment_id),
    },
    {
      key: 'contractor_code',
      group: equipment,
      header: t('contractorEquipmentCode'),
      width: 16,
      value: (row) => row.contractor_equipment_code ?? '',
    },
    {
      key: 'context',
      group: movement,
      header: t('logsColContext'),
      width: 14,
      value: (row) => {
        if (row.movement_context !== 'workshop') return t('logsSites')
        return workshopPurposeLabel(row, t) || t('logsWorkshop')
      },
    },
    {
      // The context already names the purpose; this column holds it alone,
      // so the sheet can be filtered on it. Empty for a site row.
      key: 'workshop_purpose',
      group: movement,
      header: t('exportColWorkshopPurpose'),
      width: 14,
      value: (row) => workshopPurposeLabel(row, t),
    },
    {
      key: 'movement_type',
      mandatory: true,
      group: movement,
      header: t('movementType'),
      width: 10,
      value: (row) => (row.movement_type === 'entry' ? t('entry') : t('exit')),
    },
    {
      // wave-12: right after the movement type. Only a site exit recorded
      // since migration 0111 has one; every other row is an empty cell.
      key: 'exit_purpose',
      group: movement,
      header: t('exitPurpose'),
      width: 14,
      value: (row) =>
        row.movement_type === 'exit'
          ? exitPurposeExportLabel(row.exit_purpose, t)
          : '',
    },
    {
      key: 'company_ar',
      group: companyProject,
      header: t('companyNameAr'),
      width: 24,
      value: (row) => exportText(row.company_name_ar),
    },
    {
      key: 'company_en',
      group: companyProject,
      header: t('companyNameEn'),
      width: 24,
      value: (row) => exportText(row.company_name_en),
    },
    {
      key: 'project_ar',
      group: companyProject,
      header: t('projectNameAr'),
      width: 24,
      value: (row) => exportText(row.project_name_ar),
    },
    {
      key: 'project_en',
      group: companyProject,
      header: t('projectNameEn'),
      width: 24,
      value: (row) => exportText(row.project_name_en),
    },
    {
      // The current driver: the latest change of a site entry's visit, else
      // the row's snapshot. A driverless legacy entry is a blank cell.
      key: 'driver_name',
      group: driver,
      header: t('driverName'),
      width: 22,
      value: (row) => row.current_driver_name ?? row.driver_name ?? '',
    },
    {
      // The mobile of that same driver: the view's join for the row's own
      // driver, the looked-up one for a changed driver. Text, so a leading
      // zero survives in the sheet.
      key: 'driver_mobile',
      group: driver,
      header: t('exportColDriverMobile'),
      width: 16,
      value: (row) =>
        row.current_driver_name
          ? lookupValue(lookups.mobileByDriver, row.current_driver_id)
          : exportText(row.driver_mobile_number),
    },
    {
      key: 'foreman',
      group: recording,
      header: t('logsColForeman'),
      width: 22,
      value: (row) => row.supervisor_name ?? '',
    },
    {
      key: 'recorded_at',
      mandatory: true,
      group: recording,
      header: t('recordedAt'),
      width: 18,
      type: 'date',
      value: (row) => row.recorded_at ?? null,
    },
    {
      // When the row was saved, which can differ from the actual movement
      // time (a date picked in the past, the Excel import).
      key: 'created_at',
      group: recording,
      header: t('createdAt'),
      width: 18,
      type: 'date',
      value: (row) => row.created_at ?? null,
    },
    {
      key: 'notes',
      group: recording,
      header: t('notes'),
      width: 30,
      value: (row) => row.notes ?? '',
    },
    {
      // Kept in the database for compatibility; legacy rows may carry it.
      key: 'odometer_reading',
      group: recording,
      header: t('odometerReading'),
      width: 14,
      value: (row) =>
        typeof row.odometer_reading === 'number' &&
        Number.isFinite(row.odometer_reading)
          ? row.odometer_reading
          : null,
    },
  ]
}

/**
 * `movements-<context>-<yyyymmdd>.xlsx`, dated by the Saudi calendar day so a
 * file exported late at night carries the day the operation belongs to.
 */
export function movementExportFileName(
  context: MovementExportContext,
  now: Date | string = new Date(),
): string {
  return `movements-${context}-${saudiDateKey(now).replace(/-/g, '')}.xlsx`
}

export function downloadMovementImportTemplate() {
  const sheet = XLSX.utils.json_to_sheet([
    {
      الفورمين: '',
      الشركة: '',
      المشروع: '',
      'رقم المعدة': '',
      المعدة: '',
      'رقم اللوحة': '',
      'ترقيم الشركة': '',
      'اسم السائق': '',
      'رقم جوال السائق': '',
      'تاريخ الدخول': '',
      'تاريخ الخروج': '',
      ملاحظات: '',
    },
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'الحركات')
  XLSX.writeFile(workbook, 'movement-import-template.xlsx')
}
