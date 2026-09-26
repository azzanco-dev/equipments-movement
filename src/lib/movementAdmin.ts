import type { TranslationKey } from '@/i18n/translations'
import { fieldErrors, required, type FieldErrors } from '@/lib/formValidation'

// wave6-J3/J4 — client helpers for the admin actions on a movement detail
// page: the single correction dialog and the delete.
//
// The database is authoritative (migration 0105, `public.admin_update_movement`,
// and migrations 0104/0105, `public.admin_delete_movement`). These helpers only
// mirror its rules so the dialog can refuse obviously invalid input before the
// round trip, choose the right driver path, and map the API's stable error
// codes onto translation keys. Raw PostgreSQL or Supabase text must never
// reach the user.

/** Must stay in sync with the 1000-character check in migration 0105. */
export const MOVEMENT_NOTES_MAX_LENGTH = 1000

/** Must stay in sync with the 50-character check in migrations 0093/0105. */
export const MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH = 50

/** Trimmed note, or `null` when the admin cleared the field. */
export function normalizeMovementNotes(value: string): string | null {
  return value.trim() || null
}

/** `true` when the value is accepted by the database check. */
export function isValidMovementNotes(value: string): boolean {
  const notes = normalizeMovementNotes(value)
  return notes === null || notes.length <= MOVEMENT_NOTES_MAX_LENGTH
}

/** The values the admin correction dialog edits. Ids are '' when empty. */
export interface MovementEditValues {
  equipment_id: string
  supervisor_id: string
  /** Local calendar day, `YYYY-MM-DD`. */
  movement_date: string
  company_id: string
  project_id: string
  contractor_code: string
  driver_id: string
  notes: string
}

/** Visual order of the dialog, used to focus the first invalid field. */
export const MOVEMENT_EDIT_FIELD_ORDER = [
  'equipment_id',
  'supervisor_id',
  'movement_date',
  'company_id',
  'project_id',
  'contractor_code',
  'driver_id',
  'notes',
] as const satisfies readonly (keyof MovementEditValues)[]

/** `YYYY-MM-DD` of an instant in the browser's local time. */
export function localDateKey(instant: Date | string): string {
  const date = new Date(instant)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

/**
 * Per-field validation on submit (wave-6 pattern). No rule is new: every one
 * mirrors a check of `admin_update_movement` (migration 0105).
 */
export function validateMovementEdit(
  values: MovementEditValues,
  context: 'site' | 'workshop',
  now: Date = new Date(),
): FieldErrors<MovementEditValues> {
  const site = context === 'site'
  const date = values.movement_date.trim()
  return fieldErrors<MovementEditValues>({
    equipment_id: required(
      values.equipment_id,
      'movementEditEquipmentRequired',
    ),
    supervisor_id: required(
      values.supervisor_id,
      'movementEditSupervisorRequired',
    ),
    movement_date: !date
      ? 'movementDateRequired'
      : date > localDateKey(now)
        ? 'movementEditFutureTime'
        : undefined,
    company_id: site
      ? required(values.company_id, 'movementEditCompanyRequired')
      : undefined,
    project_id: site
      ? required(values.project_id, 'movementEditProjectRequired')
      : undefined,
    contractor_code:
      site &&
      values.contractor_code.trim().length > MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH
        ? 'contractorCodeTooLong'
        : undefined,
    notes: isValidMovementNotes(values.notes)
      ? undefined
      : 'movementNotesTooLong',
  })
}

/**
 * The instant sent as `recorded_at`. The dialog edits the DAY only, like the
 * movement form: an unchanged day sends the stored instant untouched, and a
 * new day keeps the movement's original local time of day, so the relative
 * order of movements recorded that day is preserved. A result later than
 * `now` (today, but a later hour) is capped at `now`, since the database
 * rejects a future instant.
 */
export function movementEditRecordedAt(
  dateKey: string,
  originalRecordedAt: string,
  now: Date = new Date(),
): string {
  if (dateKey === localDateKey(originalRecordedAt)) return originalRecordedAt
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(originalRecordedAt)
  next.setFullYear(year, month - 1, day)
  return (next.getTime() > now.getTime() ? now : next).toISOString()
}

/**
 * Normalized comparison of the dialog against the stored movement, so Save
 * stays disabled instead of writing an audit-free no-op. A cleared driver
 * counts as "no change": the database never removes a driver.
 */
export function movementEditUnchanged(
  values: MovementEditValues,
  initial: MovementEditValues,
): boolean {
  const same = (key: keyof MovementEditValues) =>
    values[key].trim() === initial[key].trim()
  return (
    same('equipment_id') &&
    same('supervisor_id') &&
    same('movement_date') &&
    same('company_id') &&
    same('project_id') &&
    same('contractor_code') &&
    (!values.driver_id || same('driver_id')) &&
    normalizeMovementNotes(values.notes) ===
      normalizeMovementNotes(initial.notes)
  )
}

export type MovementDriverEditMode = 'unsupported' | 'driver_change' | 'admin'

/**
 * Which path a driver change must take, mirroring migration 0105:
 *   * `unsupported` — workshop movements are recorded without a driver;
 *   * `driver_change` — a site ENTRY whose visit is still open keeps its
 *     immutable entry driver, so the append-only
 *     `change_active_movement_driver` (migrations 0040/0067) is the only path;
 *   * `admin` — a closed visit or an EXIT row, corrected in place by
 *     `admin_update_movement`.
 */
export function movementDriverEditMode(params: {
  movementType: string
  movementContext: string | null | undefined
  hasLaterMovement: boolean
}): MovementDriverEditMode {
  if ((params.movementContext ?? 'site') !== 'site') return 'unsupported'
  if (params.movementType === 'entry' && !params.hasLaterMovement)
    return 'driver_change'
  return 'admin'
}

/** Body of `PATCH /api/movements/:id` — the one admin correction call. */
export interface MovementEditPayload {
  equipment_id: string
  supervisor_id: string
  recorded_at: string
  company_id: string | null
  project_id: string | null
  contractor_equipment_code: string | null
  /** In-place driver correction only; null keeps the stored driver. */
  driver_id: string | null
  /** Always the full note: '' clears it (the database stores NULL). */
  notes: string
}

/**
 * Builds the API body. A driver change on an open visit is NEVER sent here:
 * it goes through `change_active_movement_driver` so the entry driver stays
 * immutable and the change is appended.
 */
export function buildMovementEditPayload(
  values: MovementEditValues,
  params: {
    context: 'site' | 'workshop'
    originalRecordedAt: string
    currentDriverId: string | null | undefined
    driverMode: MovementDriverEditMode
    now?: Date
  },
): MovementEditPayload {
  const site = params.context === 'site'
  const driverChanged =
    Boolean(values.driver_id) &&
    values.driver_id !== (params.currentDriverId ?? '')
  return {
    equipment_id: values.equipment_id,
    supervisor_id: values.supervisor_id,
    recorded_at: movementEditRecordedAt(
      values.movement_date,
      params.originalRecordedAt,
      params.now,
    ),
    company_id: site ? values.company_id || null : null,
    project_id: site ? values.project_id || null : null,
    contractor_equipment_code: site
      ? values.contractor_code.trim() || null
      : null,
    driver_id:
      site && driverChanged && params.driverMode === 'admin'
        ? values.driver_id
        : null,
    notes: normalizeMovementNotes(values.notes) ?? '',
  }
}

const MOVEMENT_ADMIN_ERROR_KEYS: Record<string, TranslationKey> = {
  unauthorized: 'authError',
  access_denied: 'movementAdminAccessDenied',
  movement_not_found: 'movementNotFound',
  invalid_movement_payload: 'movementEditInvalidPayload',
  future_time: 'movementEditFutureTime',
  invalid_sequence: 'movementEditSequenceError',
  invalid_driver: 'movementAdminInvalidDriver',
  driver_not_supported: 'movementAdminDriverNotSupported',
  open_visit_driver_change: 'movementAdminOpenVisitDriver',
  contractor_code_too_long: 'contractorCodeTooLong',
  movement_notes_too_long: 'movementNotesTooLong',
  entry_has_later_exit: 'movementDeleteEntryHasExit',
  movement_not_last: 'movementDeleteNotLast',
  movement_update_failed: 'movementEditFailed',
  movement_delete_failed: 'movementDeleteFailed',
}

/**
 * Translation key for a failed admin edit or delete. `operation` picks the
 * generic fallback so an unknown code never shows the wrong message.
 */
export function movementAdminErrorKey(
  code: string | null | undefined,
  operation: 'update' | 'delete' = 'update',
): TranslationKey {
  const fallback: TranslationKey =
    operation === 'delete' ? 'movementDeleteFailed' : 'movementEditFailed'
  if (!code) return fallback
  return MOVEMENT_ADMIN_ERROR_KEYS[code] ?? fallback
}
