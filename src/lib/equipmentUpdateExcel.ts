import * as XLSX from 'xlsx'
import type { TranslationKey } from '@/i18n/translations'
import type { Equipment, EquipmentStatus } from '@/lib/types'
import { parseEquipmentExcel, type EquipmentImportRow } from '@/lib/excel'

export interface EquipmentUpdateRow extends EquipmentImportRow {
  record_id: string
  record_version: string
  project_id: string | null
  lessor_id: string | null
  /** Lifecycle status (migration 0102). `null` means the sheet left the column
   *  out or the cell blank, and the record keeps the status it has, so an
   *  older exported workbook still uploads unchanged. */
  status: EquipmentStatus | null
  _changedFields: string[]
  _status: 'ready' | 'unchanged' | 'error' | 'conflict'
}

/** The accepted spellings of each status, Arabic and English, matched after
 *  trimming and lower-casing. The labels are the ones the export writes. */
const STATUS_ALIASES: Record<string, EquipmentStatus> = {
  نشطة: 'active',
  نشط: 'active',
  active: 'active',
  مباعة: 'sold',
  مباع: 'sold',
  sold: 'sold',
  مشطوبة: 'scrapped',
  مشطوب: 'scrapped',
  scrapped: 'scrapped',
  'مؤجرة للغير': 'rented_out',
  مؤجرة: 'rented_out',
  'rented out': 'rented_out',
  rented_out: 'rented_out',
}

/** Parses one status cell: blank keeps the current value (`null`), an unknown
 *  spelling is `undefined` so the caller can report it per row. */
export function parseEquipmentStatusCell(
  value: unknown,
): EquipmentStatus | null | undefined {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  return STATUS_ALIASES[raw]
}

export function parseEquipmentUpdateExcel(
  data: ArrayBuffer,
  t: (key: TranslationKey) => string,
): EquipmentUpdateRow[] {
  const parsed = parseEquipmentExcel(data, t)
  const workbook = XLSX.read(data, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('missing_sheet')
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })
  return parsed.map((row, index) => {
    const recordId = String(rawRows[index]?.record_id ?? '').trim()
    const recordVersion = String(rawRows[index]?.record_version ?? '').trim()
    const errors = [...row._errors]
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        recordId,
      )
    )
      errors.push(t('invalidRecordId'))
    if (!recordVersion || Number.isNaN(Date.parse(recordVersion)))
      errors.push(t('invalidRecordVersion'))
    // The status column is optional and is read by its translated header, so a
    // sheet exported before it existed still parses.
    const statusCell =
      rawRows[index]?.[t('equipmentStatus')] ?? rawRows[index]?.status
    const status = parseEquipmentStatusCell(statusCell)
    if (status === undefined) errors.push(t('invalidEquipmentStatus'))
    return {
      ...row,
      record_id: recordId,
      record_version: recordVersion,
      project_id: null,
      lessor_id: null,
      status: status ?? null,
      _errors: errors,
      _changedFields: [],
      _status: errors.length ? 'error' : 'unchanged',
    }
  })
}

export function downloadEquipmentUpdateWorkbook(
  equipment: Equipment[],
  t: (key: TranslationKey) => string,
) {
  const rows = equipment.map((item) => ({
    record_id: item.id,
    record_version: item.updated_at,
    [t('equipmentCode')]: item.code,
    [t('equipmentType')]: item.type,
    [t('plateNumber')]: item.plate_number ?? '',
    [t('operationalStatus')]: t(item.operational_status),
    [t('equipmentStatus')]: t(
      item.status === 'sold'
        ? 'equipmentStatusSold'
        : item.status === 'scrapped'
          ? 'equipmentStatusScrapped'
          : item.status === 'rented_out'
            ? 'equipmentStatusRentedOut'
            : 'equipmentStatusActive',
    ),
    [t('ownershipStatus')]:
      item.ownership_status === 'alazani'
        ? t('ownershipAlazani')
        : item.ownership_status === 'takween'
          ? t('ownershipTakween')
          : item.ownership_status === 'third_party_f'
            ? t('ownershipThirdPartyF')
            : item.ownership_status === 'third_party_partnership_b'
              ? t('ownershipThirdPartyPartnershipB')
              : t('ownershipExternalSupplier'),
    [t('brand')]: item.brand ?? '',
    [t('model')]: item.model ?? '',
    [t('manufactureYear')]: item.manufacture_year ?? '',
    [t('chassisNumber')]: item.chassis_number ?? '',
    [t('registrationType')]: item.registration_type
      ? t(
          item.registration_type === 'private_transport'
            ? 'privateTransport'
            : item.registration_type === 'public_transport'
              ? 'publicTransport'
              : 'heavyEquipment',
        )
      : '',
    [t('project')]: item.project
      ? item.project.name_ar || item.project.name_en
      : '',
    [t('lessor')]: item.lessor?.name ?? '',
    [t('lastMaintenanceDate')]: item.last_maintenance_date ?? '',
    [t('registrationExpiry')]: item.registration_expiry ?? '',
    [t('insuranceExpiry')]: item.insurance_expiry ?? '',
  }))
  const dataSheet = XLSX.utils.json_to_sheet(rows)
  dataSheet['!cols'] = [
    { hidden: true },
    { hidden: true },
    ...Array.from({ length: 16 }, () => ({ wch: 20 })),
  ]
  const instructions = XLSX.utils.aoa_to_sheet([
    [t('equipmentUpdateInstructions')],
    [t('equipmentUpdateInstructionIds')],
    [t('equipmentUpdateInstructionPlate')],
    [t('equipmentUpdateInstructionPreview')],
  ])
  instructions['!cols'] = [{ wch: 90 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Equipment')
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions')
  XLSX.writeFile(workbook, 'equipment-update.xlsx')
}
