import type { BadgeTone } from '@/components/ui/Badge'
import type { TranslationKey } from '@/i18n/translations'

/**
 * wave 20 (migration 0125): the one equipment state, derived from the unit's
 * LATEST movement across both contexts, and the three workshop purposes.
 *
 * The database is the source of truth: `equipment_state_from_movement()` is
 * the single SQL definition, served as `admin_equipment_state.equipment_state`
 * and as the `equipment_state(equipment)` computed field.
 * `equipmentStateFromMovement` below mirrors it for the one screen that reads
 * the latest movement through `get_last_movement` (the inquiry, which foremen
 * use and whose RLS would hide part of the chain from a computed field);
 * tests/wave20State.test.cjs keeps the two in step.
 */

/** The workshop entry purposes, in the order every menu and filter lists
 *  them. */
export const WORKSHOP_PURPOSES = [
  'maintenance',
  'parking',
  'out_of_service',
] as const
export type WorkshopPurpose = (typeof WORKSHOP_PURPOSES)[number]

export function isWorkshopPurpose(value: unknown): value is WorkshopPurpose {
  return (
    typeof value === 'string' &&
    (WORKSHOP_PURPOSES as readonly string[]).includes(value)
  )
}

/** An unknown or missing purpose reads as "not classified" (`null`). */
export function workshopPurposeOrNull(value: unknown): WorkshopPurpose | null {
  return isWorkshopPurpose(value) ? value : null
}

export const WORKSHOP_PURPOSE_LABEL_KEYS: Record<
  WorkshopPurpose,
  TranslationKey
> = {
  maintenance: 'maintenancePurpose',
  parking: 'parkingPurpose',
  out_of_service: 'workshopPurposeOutOfService',
}

/** Translation key of a purpose label, or `null` when it is not one. */
export function workshopPurposeLabelKey(value: unknown): TranslationKey | null {
  return isWorkshopPurpose(value) ? WORKSHOP_PURPOSE_LABEL_KEYS[value] : null
}

/** Badge tone of a purpose: maintenance warning, parking info, out of
 *  service danger (light red with dark readable text). */
export function workshopPurposeTone(purpose: WorkshopPurpose): BadgeTone {
  if (purpose === 'maintenance') return 'warning'
  if (purpose === 'parking') return 'info'
  return 'danger'
}

/** The six values of the derived state, in the order filters list them. */
export const EQUIPMENT_STATES = [
  'working',
  'available',
  'maintenance',
  'parking',
  'out_of_service',
  'unclassified',
] as const
export type EquipmentState = (typeof EQUIPMENT_STATES)[number]

export function isEquipmentState(value: unknown): value is EquipmentState {
  return (
    typeof value === 'string' &&
    (EQUIPMENT_STATES as readonly string[]).includes(value)
  )
}

/** An unknown value is dropped (`null`) rather than shown. */
export function parseEquipmentState(value: unknown): EquipmentState | null {
  return isEquipmentState(value) ? value : null
}

/** The three workshop states plus «غير مصنفة»: the unit is in the workshop. */
export function isWorkshopState(state: EquipmentState): boolean {
  return (
    state === 'maintenance' ||
    state === 'parking' ||
    state === 'out_of_service' ||
    state === 'unclassified'
  )
}

/** The movement fields the state depends on. */
export interface StateMovement {
  movement_type?: string | null
  movement_context?: string | null
  workshop_purpose?: string | null
}

/**
 * Mirror of `equipment_state_from_movement()` (0125): site ENTRY = working;
 * any EXIT = available; workshop ENTRY = its purpose, or unclassified; no
 * movement = available.
 */
export function equipmentStateFromMovement(
  latest: StateMovement | null | undefined,
): EquipmentState {
  if (!latest || !latest.movement_type) return 'available'
  if (latest.movement_type !== 'entry') return 'available'
  if (latest.movement_context === 'workshop')
    return workshopPurposeOrNull(latest.workshop_purpose) ?? 'unclassified'
  return 'working'
}

export const EQUIPMENT_STATE_LABEL_KEYS: Record<
  EquipmentState,
  TranslationKey
> = {
  working: 'equipmentStateWorking',
  available: 'equipmentStateAvailable',
  maintenance: 'equipmentStateMaintenance',
  parking: 'equipmentStateParking',
  out_of_service: 'equipmentStateOutOfService',
  unclassified: 'equipmentStateUnclassified',
}

/** Badge tone of a state: green while working, the purpose colors in the
 *  workshop, neutral when available or not classified. */
export function equipmentStateTone(state: EquipmentState): BadgeTone {
  if (state === 'working') return 'success'
  if (isWorkshopPurpose(state)) return workshopPurposeTone(state)
  return 'neutral'
}

/**
 * The one state line: «تعمل», «متاحة», «متاحة · جديدة», «في الورشة · وقوف».
 * `null` (an unknown or missing state) is a dash.
 */
export function equipmentStateText(
  t: (key: TranslationKey) => string,
  state: EquipmentState | null | undefined,
  isNew?: boolean | null,
): string {
  if (!state) return '—'
  const label = t(EQUIPMENT_STATE_LABEL_KEYS[state])
  if (isWorkshopState(state))
    return `${t('equipmentStateInWorkshop')} · ${label}`
  if (state === 'available' && isNew)
    return `${label} · ${t('equipmentStateNew')}`
  return label
}
