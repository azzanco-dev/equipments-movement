// The place of a unit across both movement contexts, as `get_equipment_presence`
// answers it (nested workshop stays, 2026-11-14).
//
// A project (`site`) visit stays open until work is completed; a workshop
// entry / exit is a stop NESTED inside it. So "where is the unit" is two
// facts, not the latest movement: is a project visit open, and is a workshop
// visit open. The database trigger decides every rule; this module only
// mirrors it so the form can say so before the save.

import type { TranslationKey } from '@/i18n/translations'
import type { MovementType } from '@/lib/types'
import { parseEquipmentState, type EquipmentState } from '@/lib/equipmentState'

export interface EquipmentPresence {
  state: EquipmentState | null
  siteOpen: boolean
  workshopOpen: boolean
  siteEntryId: string | null
  siteEntryAt: string | null
  siteSupervisorId: string | null
  siteSupervisorName: string | null
  siteCompanyId: string | null
  siteCompanyNameAr: string | null
  siteCompanyNameEn: string | null
  siteProjectId: string | null
  siteProjectNameAr: string | null
  siteProjectNameEn: string | null
  siteContractorEquipmentCode: string | null
  siteDriverId: string | null
  siteDriverName: string | null
  siteDriverMobileNumber: string | null
  workshopEntryId: string | null
  workshopEntryAt: string | null
  workshopPurpose: string | null
  workshopSupervisorId: string | null
  workshopSupervisorName: string | null
  lastMovementId: string | null
  lastMovementType: string | null
  lastMovementContext: string | null
  lastMovementAt: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * Reads the RPC result (one row, or an array holding it). A malformed row —
 * not an object, or `site_open` / `workshop_open` that are not booleans — is
 * `null`: the caller shows its load error, never a guess about the place.
 */
export function parseEquipmentPresence(data: unknown): EquipmentPresence | null {
  const row: unknown = Array.isArray(data) ? data[0] : data
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.site_open !== 'boolean' || typeof r.workshop_open !== 'boolean')
    return null
  return {
    state: parseEquipmentState(r.state),
    siteOpen: r.site_open,
    workshopOpen: r.workshop_open,
    siteEntryId: text(r.site_entry_id),
    siteEntryAt: text(r.site_entry_at),
    siteSupervisorId: text(r.site_supervisor_id),
    siteSupervisorName: text(r.site_supervisor_name),
    siteCompanyId: text(r.site_company_id),
    siteCompanyNameAr: text(r.site_company_name_ar),
    siteCompanyNameEn: text(r.site_company_name_en),
    siteProjectId: text(r.site_project_id),
    siteProjectNameAr: text(r.site_project_name_ar),
    siteProjectNameEn: text(r.site_project_name_en),
    siteContractorEquipmentCode: text(r.site_contractor_equipment_code),
    siteDriverId: text(r.site_driver_id),
    siteDriverName: text(r.site_driver_name),
    siteDriverMobileNumber: text(r.site_driver_mobile_number),
    workshopEntryId: text(r.workshop_entry_id),
    workshopEntryAt: text(r.workshop_entry_at),
    workshopPurpose: text(r.workshop_purpose),
    workshopSupervisorId: text(r.workshop_supervisor_id),
    workshopSupervisorName: text(r.workshop_supervisor_name),
    lastMovementId: text(r.last_movement_id),
    lastMovementType: text(r.last_movement_type),
    lastMovementContext: text(r.last_movement_context),
    lastMovementAt: text(r.last_movement_at),
  }
}

export type PresenceMode =
  | 'site_entry'
  | 'site_exit'
  | 'workshop_entry'
  | 'workshop_exit'

/** The mode of the form: its context (workshop or project) and its type. */
export function presenceMode(
  workshopMode: boolean,
  movementType: MovementType,
): PresenceMode {
  if (workshopMode) return movementType === 'entry' ? 'workshop_entry' : 'workshop_exit'
  return movementType === 'entry' ? 'site_entry' : 'site_exit'
}

export type MovementDecision =
  | { allowed: true }
  | { allowed: false; messageKey: TranslationKey }

const ALLOWED: MovementDecision = { allowed: true }

/**
 * What the form may record for a unit in this place (mirror of the database
 * rule, contract section 1):
 * - project ENTRY: refused while a project visit is open, or while the unit is
 *   inside the workshop;
 * - project EXIT: needs an open project visit, whether or not the unit is
 *   inside the workshop;
 * - workshop ENTRY: refused only while the unit is already inside the workshop
 *   (an open project visit does not matter);
 * - workshop EXIT: needs the unit inside the workshop.
 * With no open visit to close, a unit that never moved gets the «no previous
 * movement» message and any other gets the «not inside» one.
 */
export function decideMovement(
  presence: Pick<EquipmentPresence, 'siteOpen' | 'workshopOpen' | 'lastMovementId'>,
  mode: PresenceMode,
): MovementDecision {
  const neverMoved = !presence.lastMovementId
  switch (mode) {
    case 'site_entry':
      if (presence.siteOpen)
        return { allowed: false, messageKey: 'entryBlockedMsg' }
      if (presence.workshopOpen)
        return { allowed: false, messageKey: 'entryBlockedInWorkshopMsg' }
      return ALLOWED
    case 'site_exit':
      if (presence.siteOpen) return ALLOWED
      return {
        allowed: false,
        messageKey: neverMoved ? 'exitNoPreviousMsg' : 'exitBlockedMsg',
      }
    case 'workshop_entry':
      if (presence.workshopOpen)
        return { allowed: false, messageKey: 'workshopEntryBlockedMsg' }
      return ALLOWED
    case 'workshop_exit':
      if (presence.workshopOpen) return ALLOWED
      return {
        allowed: false,
        messageKey: neverMoved ? 'exitNoPreviousMsg' : 'workshopExitBlockedMsg',
      }
  }
}
