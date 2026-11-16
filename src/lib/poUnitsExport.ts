/**
 * The Excel columns of «اوامر الشراء · حسب المعدات» (owner 2026-11-16,
 * «تصدير po المشتريات»): one row per unit on a supplier PO, as the list
 * shows it, plus the fields the narrow table folds away (the chassis, the
 * price unit, the line's note). Pure: no spreadsheet library, no client.
 */
import type { Language, TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import type { ExcelColumn } from '@/lib/excelSheet'
import {
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  supplierPoApprovalListBadge,
  supplierPoSupplierLabel,
} from '@/lib/purchasing'
import type { PoUnitRow } from '@/lib/purchasingData'

type Translate = (key: TranslationKey) => string

/** The name in the file's language, the other one when it is missing. */
function named(ar: string | null, en: string | null, lang: Language): string {
  const first = lang === 'ar' ? ar : en
  const second = lang === 'ar' ? en : ar
  return first?.trim() || second?.trim() || ''
}

export const PO_UNITS_EXPORT_FILE_NAME = 'supplier-po-units'

export function poUnitsExportColumns(
  t: Translate,
  lang: Language,
): ExcelColumn<PoUnitRow>[] {
  const po = t('supplierPos')
  const equipment = t('exportGroupEquipment')
  return [
    {
      key: 'po_number',
      mandatory: true,
      group: po,
      header: t('siteUnitsPoNumber'),
      width: 18,
      value: (row) => row.po_number,
    },
    {
      key: 'approval_status',
      group: po,
      header: t('supplierPoApproval'),
      width: 18,
      value: (row) => t(supplierPoApprovalListBadge(row).key),
    },
    {
      key: 'start_date',
      group: po,
      header: t('supplierPoStartDate'),
      width: 14,
      align: 'center',
      value: (row) => (row.start_date ? formatDate(row.start_date) : ''),
    },
    {
      key: 'party',
      group: po,
      header: t('supplierPoParty'),
      width: 28,
      value: (row) =>
        supplierPoSupplierLabel(
          {
            is_internal: false,
            owner_class: row.owner_class,
            lessor: { name: row.lessor_name },
          },
          t,
        ),
    },
    {
      key: 'company',
      group: po,
      header: t('company'),
      width: 26,
      value: (row) => named(row.company_name_ar, row.company_name_en, lang),
    },
    {
      key: 'project',
      group: po,
      header: t('project'),
      width: 26,
      value: (row) => named(row.project_name_ar, row.project_name_en, lang),
    },
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
      group: equipment,
      header: t('equipmentType'),
      width: 24,
      value: (row) => row.equipment_type ?? '',
    },
    {
      key: 'plate_number',
      group: equipment,
      header: t('plateNumber'),
      width: 14,
      value: (row) => row.equipment_plate_number ?? '',
    },
    {
      key: 'chassis_number',
      group: equipment,
      header: t('chassisNumber'),
      width: 22,
      value: (row) => row.equipment_chassis_number ?? '',
    },
    {
      // A number cell, so the column sums and filters; empty = «تحتاج سعر».
      key: 'price',
      group: equipment,
      header: t('supplierPoPrice'),
      width: 14,
      value: (row) => row.price,
    },
    {
      key: 'rate_unit',
      group: equipment,
      header: t('supplierPoRateUnit'),
      width: 12,
      value: (row) => {
        const key = SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[row.rate_unit]
        return key ? t(key) : (row.rate_unit ?? '')
      },
    },
    {
      key: 'line_note',
      group: equipment,
      header: t('supplierPoLineNote'),
      width: 30,
      value: (row) => row.line_note?.trim() ?? '',
    },
    {
      key: 'updated_at',
      group: equipment,
      header: t('updatedAt'),
      width: 18,
      type: 'date',
      value: (row) => row.updated_at,
    },
  ]
}
