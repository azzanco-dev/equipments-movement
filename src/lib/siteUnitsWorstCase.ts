import type { SiteUnitRow } from '@/lib/purchasingData'

/**
 * Dev-only worst-case data for «المعدات في المشاريع» (Break UI, owner
 * 2026-11-18). Every value is realistic or a stored limit: a code of 30
 * characters (the 0135 limit), a company number of 50 (the movement limit),
 * a 17-character chassis, an Arabic and a Latin foreman name that are long,
 * a one-letter project, a missing company, a PO number that has grown a
 * digit. The data enters through the same boundary as the live rows.
 */

export type DevDataMode = 'demo' | 'worst' | 'empty' | 'one' | 'many'

export const DEV_DATA_MODES: readonly DevDataMode[] = [
  'demo',
  'worst',
  'empty',
  'one',
  'many',
]

export const DEV_DATA_MODE_LABELS: Record<DevDataMode, string> = {
  demo: 'Demo data',
  worst: 'Worst case',
  empty: 'Empty',
  one: 'One',
  many: '500 rows',
}

const NOW = Date.now()
const hoursAgo = (hours: number) =>
  new Date(NOW - hours * 3_600_000).toISOString()

function base(index: number): SiteUnitRow {
  return {
    entry_id: `worst-${index}`,
    equipment_id: `worst-eq-${index}`,
    equipment_code: `A${100 + index}`,
    equipment_type: 'حفارة',
    equipment_plate_number: '1128XVV',
    equipment_chassis_number: null,
    equipment_ownership_status: 'alazani',
    equipment_lessor_id: null,
    equipment_lessor_name: null,
    company_id: 'c1',
    company_name_ar: 'شركة البناء',
    company_name_en: 'Building Co',
    project_id: 'p1',
    project_name_ar: 'مشروع القدية',
    project_name_en: 'Qiddiya',
    entry_supervisor_id: 'f1',
    entry_supervisor_name: 'محمد',
    entry_at: hoursAgo(72),
    contractor_equipment_code: 'K-12',
    supplier_po_id: null,
    po_number: null,
    has_po: false,
    visit_state: 'inside',
    exit_at: null,
    exit_purpose: null,
    entry_created_at: hoursAgo(70),
    in_workshop: false,
  }
}

const WORST_ROWS: SiteUnitRow[] = [
  {
    ...base(1),
    equipment_code: 'EXCAVATOR-CAT-336-UNIT-0042-X1',
    equipment_type: 'حفارة هيدروليكية زاحفة ثقيلة بذراع طويل ومطرقة هيدروليكية',
    equipment_plate_number: null,
    equipment_chassis_number: 'JHMCM56557C404453',
    equipment_ownership_status: 'external_supplier',
    equipment_lessor_id: 'l1',
    equipment_lessor_name:
      'شركة الراجحي للمقاولات العامة والتجارة والخدمات اللوجستية القابضة',
    contractor_equipment_code: 'NWH-CONTRACTOR-EQUIPMENT-CODE-2026-00042-A-REV-03',
    entry_supervisor_name: 'Aleksandra Wiśniewska-Kowalczyk',
    supplier_po_id: 'po1',
    po_number: 'PO-20261210001',
    has_po: true,
    in_workshop: true,
  },
  {
    ...base(2),
    company_name_ar: null,
    company_name_en: null,
    project_name_ar: null,
    project_name_en: null,
    equipment_plate_number: null,
    equipment_chassis_number: null,
    contractor_equipment_code: null,
    entry_supervisor_name: null,
    entry_created_at: null,
  },
  {
    ...base(3),
    equipment_code: 'U001',
    equipment_type: 'ونش',
    project_name_ar: 'ب',
    project_name_en: 'B',
    entry_supervisor_name: 'Jo',
    visit_state: 'exited',
    exit_at: hoursAgo(5),
    exit_purpose: 'maintenance',
    supplier_po_id: 'po2',
    po_number: 'DRAFT-0558',
    has_po: true,
  },
  {
    ...base(4),
    company_name_ar:
      'شركة عبدالله احمد العزاني للمقاولات والتجارة والمشاريع الانشائية المحدودة',
    company_name_en:
      'Abdullah Ahmed Al Azani Contracting, Trading and Construction Projects Co. Ltd.',
    project_name_ar:
      'مشروع تطوير وتوسعة البنية التحتية للمرحلة الثانية - الحزمة الشمالية',
    project_name_en:
      'Infrastructure Development and Expansion Project Phase 2 - North Package',
    entry_supervisor_name: 'عبدالرحمن بن محمد بن عبدالله الغامدي الزهراني',
    entry_created_at: hoursAgo(24 * 400),
    equipment_ownership_status: 'third_party_partnership_b',
  },
  { ...base(5), equipment_ownership_status: null },
  { ...base(6), visit_state: 'exited', exit_at: hoursAgo(1), exit_purpose: null },
]

/** The rows and the total for a mode; `null` for the live data. */
export function devSiteUnits(
  mode: DevDataMode,
): { rows: SiteUnitRow[]; total: number } | null {
  switch (mode) {
    case 'demo':
      return null
    case 'worst':
      return { rows: WORST_ROWS, total: WORST_ROWS.length }
    case 'empty':
      return { rows: [], total: 0 }
    case 'one':
      return { rows: [WORST_ROWS[0]], total: 1 }
    case 'many': {
      const rows = Array.from({ length: 500 }, (_, i) =>
        i % 5 === 0 ? { ...WORST_ROWS[i % WORST_ROWS.length], entry_id: `m-${i}` } : { ...base(i), entry_id: `m-${i}` },
      )
      return { rows, total: 500 }
    }
  }
}

export function parseDevDataMode(value: string | null | undefined): DevDataMode {
  return DEV_DATA_MODES.includes(value as DevDataMode)
    ? (value as DevDataMode)
    : 'demo'
}
