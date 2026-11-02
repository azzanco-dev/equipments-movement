import type { FilterOption } from '@/components/data-list/types'
import type { TranslationKey } from '@/i18n/translations'

// The activity page's filter keys and the equipment fields a reader can
// filter by («الحقل»). Kept apart from `activityLog.ts`, with type imports
// only, so `listConfigs.ts` stays light (its tests load it without a
// bundler).

export const ACTIVITY_KIND_FILTER_KEY = 'kind'
/** The «الحقل» filter: `changed_fields` OVERLAPS the ticked keys — not a
 *  column comparison `applyListFilters` knows, so the screen applies it. */
export const ACTIVITY_FIELD_FILTER_KEY = 'changed_fields'

/** The equipment fields a reader can filter by («الحقل»), in the order the
 *  filter lists them. The key is the column of public.equipment. */
export const EQUIPMENT_AUDIT_FIELDS: readonly {
  key: string
  label: TranslationKey
}[] = [
  { key: 'status', label: 'status' },
  { key: 'ownership_status', label: 'ownershipStatus' },
  { key: 'lessor_id', label: 'lessor' },
  { key: 'code', label: 'equipmentCode' },
  { key: 'type', label: 'equipmentType' },
  { key: 'plate_number', label: 'plateNumber' },
  { key: 'chassis_number', label: 'chassisNumber' },
  { key: 'is_active', label: 'activityFieldIsActive' },
  { key: 'tracker_unit_id', label: 'activityFieldTrackerUnit' },
  { key: 'project_id', label: 'project' },
  { key: 'brand', label: 'brand' },
  { key: 'model', label: 'model' },
  { key: 'manufacture_year', label: 'manufactureYear' },
  { key: 'registration_type', label: 'registrationType' },
  { key: 'registration_expiry', label: 'registrationExpiry' },
  { key: 'insurance_expiry', label: 'insuranceExpiry' },
  { key: 'last_maintenance_date', label: 'lastMaintenanceDate' },
]

/** The static options of the «الحقل» filter. */
export function activityFieldFilterOptions(): FilterOption[] {
  return EQUIPMENT_AUDIT_FIELDS.map((field) => ({
    value: field.key,
    label: field.key,
    labelI18n: field.label,
  }))
}
