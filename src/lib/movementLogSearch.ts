import { buildSearchFilter } from '@/lib/search'
import type { ExitPurpose } from '@/lib/exitPurpose'
import type {
  EntryExitLog,
  MovementType,
  RegistrationMethod,
} from '@/lib/types'

/**
 * `movement_log_search` (migration 0086) is a `security_invoker` view that
 * flattens the equipment / company / project / foreman / driver fields the
 * movement lists display and search onto each movement row, so filtering,
 * counting, sorting, and pagination all happen in PostgreSQL.
 */
export const MOVEMENT_LOG_SEARCH_VIEW = 'movement_log_search'

const LOG_FIELDS =
  'id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,recorded_at,created_at'

/** Admin movement log and movement reports tabs (also feeds the Excel export). */
export const MOVEMENT_LOG_ADMIN_SELECT = `${LOG_FIELDS},odometer_reading,notes,contractor_equipment_code,company_id,project_id,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,company_name_ar,company_name_en,project_name_ar,project_name_en,supervisor_name,driver_mobile_number`

/** Workshop report cards. */
export const MOVEMENT_LOG_WORKSHOP_SELECT = `${LOG_FIELDS},workshop_purpose,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,supervisor_name,driver_mobile_number`

/**
 * Foreman / workshop dashboard list. `exit_purpose` is the site exit purpose
 * appended to the view by migration 0118 (wave 12).
 */
export const MOVEMENT_LOG_SUPERVISOR_SELECT = `${LOG_FIELDS},workshop_purpose,contractor_equipment_code,equipment_code,equipment_type,supervisor_name,exit_purpose`

/** Home page equipment card: the short timeline under one equipment. */
export const MOVEMENT_LOG_HOME_TIMELINE_SELECT =
  'id,movement_type,movement_context,workshop_purpose,recorded_at,company_name_ar,company_name_en,project_name_ar,project_name_en'

export interface MovementLogSearchRow {
  id: string
  equipment_id: string
  supervisor_id: string
  movement_type: MovementType
  movement_context?: 'site' | 'workshop'
  workshop_purpose?: 'maintenance' | 'parking' | null
  registration_method?: RegistrationMethod
  driver_id?: string | null
  driver_name: string | null
  odometer_reading?: number | null
  notes?: string | null
  photo_url?: string | null
  company_id?: string | null
  project_id?: string | null
  contractor_equipment_code?: string | null
  recorded_at: string
  created_at: string
  equipment_code?: string | null
  equipment_type?: string | null
  equipment_plate_number?: string | null
  equipment_chassis_number?: string | null
  company_name_ar?: string | null
  company_name_en?: string | null
  project_name_ar?: string | null
  project_name_en?: string | null
  supervisor_name?: string | null
  driver_mobile_number?: string | null
  /** The row's own site exit purpose (migration 0118); `null` otherwise. */
  exit_purpose?: ExitPurpose | null
}

/**
 * Rebuilds the nested shape the movement components already expect from the
 * flat view row, so no card or export had to change.
 */
export function mapMovementLogRow(row: MovementLogSearchRow): EntryExitLog {
  const mapped = {
    id: row.id,
    equipment_id: row.equipment_id,
    supervisor_id: row.supervisor_id,
    movement_type: row.movement_type,
    movement_context: row.movement_context,
    workshop_purpose: row.workshop_purpose,
    exit_purpose: row.exit_purpose ?? null,
    registration_method: row.registration_method,
    driver_id: row.driver_id ?? null,
    driver_name: row.driver_name ?? null,
    odometer_reading: row.odometer_reading ?? null,
    notes: row.notes ?? null,
    photo_url: row.photo_url ?? null,
    company_id: row.company_id ?? null,
    project_id: row.project_id ?? null,
    contractor_equipment_code: row.contractor_equipment_code ?? null,
    recorded_at: row.recorded_at,
    created_at: row.created_at,
    equipment: {
      id: row.equipment_id,
      code: row.equipment_code ?? '',
      type: row.equipment_type ?? '',
      plate_number: row.equipment_plate_number ?? null,
      chassis_number: row.equipment_chassis_number ?? null,
    },
    supervisor: { id: row.supervisor_id, full_name: row.supervisor_name ?? '' },
    company: row.company_id
      ? {
          id: row.company_id,
          name_ar: row.company_name_ar ?? '',
          name_en: row.company_name_en ?? '',
        }
      : null,
    project: row.project_id
      ? {
          id: row.project_id,
          name_ar: row.project_name_ar ?? '',
          name_en: row.project_name_en ?? '',
        }
      : null,
    driver: row.driver_id
      ? { id: row.driver_id, mobile_number: row.driver_mobile_number ?? null }
      : null,
  }
  // The lists only ever read the fields selected above; the nested records are
  // deliberately partial, exactly as the previous PostgREST embeds were.
  return mapped as unknown as EntryExitLog
}

export function mapMovementLogRows(
  rows: MovementLogSearchRow[] | null,
): EntryExitLog[] {
  return (rows ?? []).map(mapMovementLogRow)
}

/**
 * The `movement_log_search` columns a movement search matches: the equipment
 * (code, type, plate, normalized plate digits, chassis), the driver snapshot
 * and the contractor code (company number). Movement notes and the foreman
 * name are intentionally not searched. The Arabic text is matched through the
 * `*_search` columns of migration 0116 (`normalize_search_text`).
 */
export const MOVEMENT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'equipment_chassis_number',
  'driver_name_search',
  'contractor_equipment_code',
  'equipment_plate_digits',
] as const

/** The company and project names, searched by the lists that show them. */
export const MOVEMENT_COMPANY_PROJECT_SEARCH_FIELDS = [
  'company_name_ar_search',
  'company_name_en',
  'project_name_ar_search',
  'project_name_en',
] as const

/**
 * Builds the PostgREST `or(...)` filter for a movement search term over
 * `MOVEMENT_SEARCH_FIELDS` (plus the company and project names on request)
 * through the shared `buildSearchFilter`: the term is sanitized, Arabic-Indic
 * digits become ASCII, the `*_search` columns get the normalized term, and a
 * digits-only term also probes the plate digits. The term is never split into
 * plate letters (that made "a341" match every plate with an A).
 *
 * Returns `null` when the term is empty after sanitizing.
 */
export function buildMovementSearchFilter(
  rawTerm: string,
  options: { includeCompanyProject?: boolean } = {},
): string | null {
  return buildSearchFilter(
    options.includeCompanyProject
      ? [...MOVEMENT_SEARCH_FIELDS, ...MOVEMENT_COMPANY_PROJECT_SEARCH_FIELDS]
      : MOVEMENT_SEARCH_FIELDS,
    rawTerm,
  )
}
