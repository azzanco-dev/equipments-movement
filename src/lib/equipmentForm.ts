import type { BadgeTone } from '@/components/ui/Badge'
import type { TranslationKey } from '@/i18n/translations'
import type {
  Equipment,
  OperationalStatus,
  OwnershipStatus,
  RegistrationType,
} from '@/lib/types'
import {
  inferOwnershipFromCode,
  usesExternalSupplier,
} from '@/lib/equipmentOwnership'

/** Values held by the equipment add/edit dialog. Everything is a string so the
 *  form stays controlled; `buildEquipmentPayload` converts to database types. */
export interface EquipmentFormValues {
  code: string
  type: string
  plate_number: string
  numbering_status: 'numbered' | 'unnumbered'
  operational_status: OperationalStatus
  ownership_status: OwnershipStatus
  project_id: string
  lessor_id: string
  brand: string
  model: string
  manufacture_year: string
  chassis_number: string
  registration_type: string
  qr_value: string
  last_maintenance_date: string
  registration_expiry: string
  insurance_expiry: string
}

export const EMPTY_EQUIPMENT_FORM: EquipmentFormValues = {
  code: '',
  type: '',
  plate_number: '',
  numbering_status: 'numbered',
  operational_status: 'operational',
  ownership_status: 'alazani',
  project_id: '',
  lessor_id: '',
  brand: '',
  model: '',
  manufacture_year: '',
  chassis_number: '',
  registration_type: '',
  qr_value: '',
  last_maintenance_date: '',
  registration_expiry: '',
  insurance_expiry: '',
}

/** Generated QR payload for a new equipment record. */
export function genQrValue(): string {
  return `EQ-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`
}

/** Maps an existing record onto the form values. */
export function equipmentFormValues(equipment: Equipment): EquipmentFormValues {
  return {
    code: equipment.code,
    type: equipment.type,
    plate_number: equipment.plate_number ?? '',
    numbering_status: equipment.numbering_status ?? 'numbered',
    operational_status: equipment.operational_status,
    ownership_status: equipment.ownership_status,
    project_id: equipment.project_id ?? '',
    lessor_id: equipment.lessor_id ?? '',
    brand: equipment.brand ?? '',
    model: equipment.model ?? '',
    manufacture_year: equipment.manufacture_year?.toString() ?? '',
    chassis_number: equipment.chassis_number ?? '',
    registration_type: equipment.registration_type ?? '',
    qr_value: equipment.qr_value,
    last_maintenance_date: equipment.last_maintenance_date ?? '',
    registration_expiry: equipment.registration_expiry ?? '',
    insurance_expiry: equipment.insurance_expiry ?? '',
  }
}

/**
 * The code prefix only *suggests* the owner (A, TK, F, B, otherwise external
 * supplier); the database fields stay the source of truth. Any owner other
 * than "Other Owner" clears `lessor_id`.
 */
export function applyEquipmentCode(
  form: EquipmentFormValues,
  code: string,
): EquipmentFormValues {
  const inferred = inferOwnershipFromCode(code)
  if (!inferred) return { ...form, code }
  return {
    ...form,
    code,
    ownership_status: inferred,
    lessor_id: usesExternalSupplier(inferred) ? form.lessor_id : '',
  }
}

/** Owner selected by hand; same lessor rule as `applyEquipmentCode`. */
export function applyOwnershipStatus(
  form: EquipmentFormValues,
  ownership_status: OwnershipStatus,
): EquipmentFormValues {
  return {
    ...form,
    ownership_status,
    lessor_id: usesExternalSupplier(ownership_status) ? form.lessor_id : '',
  }
}

/** Returns the translation key of the first problem, or null when valid. */
export function validateEquipmentForm(
  form: EquipmentFormValues,
): TranslationKey | null {
  if (form.numbering_status === 'numbered' && !/[0-9]/.test(form.plate_number))
    return 'plateRequired'
  return null
}

/** Insert/update payload for the `equipment` table. */
export function buildEquipmentPayload(form: EquipmentFormValues) {
  return {
    code: form.code,
    type: form.type,
    plate_number:
      form.numbering_status === 'numbered' ? form.plate_number || null : null,
    numbering_status: form.numbering_status,
    operational_status: form.operational_status,
    ownership_status: form.ownership_status,
    project_id: form.project_id || null,
    lessor_id: usesExternalSupplier(form.ownership_status)
      ? form.lessor_id || null
      : null,
    brand: form.brand || null,
    model: form.model || null,
    manufacture_year: form.manufacture_year
      ? parseInt(form.manufacture_year)
      : null,
    chassis_number: form.chassis_number || null,
    registration_type: (form.registration_type ||
      null) as RegistrationType | null,
    qr_value: form.qr_value,
    last_maintenance_date: form.last_maintenance_date || null,
    registration_expiry: form.registration_expiry || null,
    insurance_expiry: form.insurance_expiry || null,
    master_data_complete: true,
  }
}

/** Badge tone plus the translation key of its label. */
export interface BadgeDescriptor {
  tone: BadgeTone
  key: TranslationKey
}

/**
 * Single mapping from an equipment flag to a shared `Badge`. Keeping it here
 * (instead of ad hoc colors in the table) is what AGENTS.md asks for: green
 * for success, amber for warnings, red only for errors.
 */
export function operationalStatusBadge(
  status: OperationalStatus,
): BadgeDescriptor {
  if (status === 'operational') return { tone: 'success', key: 'operational' }
  if (status === 'maintenance') return { tone: 'warning', key: 'maintenance' }
  return { tone: 'neutral', key: 'stopped' }
}

export function ownershipBadge(status: OwnershipStatus): BadgeDescriptor {
  if (status === 'alazani') return { tone: 'neutral', key: 'ownershipAlazani' }
  if (status === 'takween') return { tone: 'neutral', key: 'ownershipTakween' }
  if (status === 'third_party_f')
    return { tone: 'neutral', key: 'ownershipThirdPartyF' }
  if (status === 'third_party_partnership_b')
    return { tone: 'neutral', key: 'ownershipThirdPartyPartnershipB' }
  return { tone: 'neutral', key: 'ownershipExternalSupplier' }
}

export function activeBadge(isActive: boolean): BadgeDescriptor {
  return isActive
    ? { tone: 'neutral', key: 'active' }
    : { tone: 'warning', key: 'inactive' }
}

/** Quick-created equipment stays flagged until an admin reviews it. */
export function masterDataBadge(
  complete: boolean | null | undefined,
): BadgeDescriptor | null {
  return complete === false ? { tone: 'warning', key: 'incompleteData' } : null
}
