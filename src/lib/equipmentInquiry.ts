import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'
import { sanitizeSearchTerm } from '@/lib/search'
import type {
  EquipmentPresence,
  MovementContext,
  WorkshopPurpose,
} from '@/lib/visitTimeline'

/**
 * Pure helpers for the `/inquiry` equipment inquiry screen: the search
 * suggestion filter, the URL `?equipment=` param, and the current-state
 * derivation from `get_last_movement()`. Kept free of React/Supabase so the
 * search/state rules stay unit-testable without a browser.
 */

// ---------------------------------------------------------------------------
// Suggestion search
// ---------------------------------------------------------------------------

/**
 * Builds the PostgREST `or(...)` filter for the equipment suggestion search:
 * code, type, plate (raw and normalized digits), and chassis number. The term
 * is sanitized and Arabic-Indic digits are converted first, and it is never
 * split into plate letters (see `plateDigitsSearchTerm`). Returns `null` when
 * the term is empty after sanitizing, so the caller can skip the request.
 */
export function buildEquipmentSuggestFilter(rawTerm: string): string | null {
  const term = toLatinDigits(sanitizeSearchTerm(rawTerm))
  if (!term) return null

  const parts = [
    `code.ilike.%${term}%`,
    `type.ilike.%${term}%`,
    `plate_number.ilike.%${term}%`,
    `chassis_number.ilike.%${term}%`,
  ]
  const digits = plateDigitsSearchTerm(term)
  if (digits) parts.push(`plate_digits.ilike.%${digits}%`)
  return parts.join(',')
}

// ---------------------------------------------------------------------------
// `?equipment=` URL param
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reads the `equipment` query param into a usable equipment id, or `null`
 * when absent or not shaped like a uuid. Guards against passing arbitrary
 * query-string junk into a `.eq('id', ...)` filter.
 */
export function parseEquipmentIdParam(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return UUID_RE.test(trimmed) ? trimmed : null
}

// ---------------------------------------------------------------------------
// Current-state derivation from get_last_movement()
// ---------------------------------------------------------------------------

/**
 * The columns `get_last_movement(equipment_id, 'site')` returns that the
 * header's current-state needs. The RPC returns the latest movement across
 * BOTH contexts regardless of the `p_movement_context` argument (see its own
 * comment in migration 0091), and it is the reviewed SECURITY DEFINER
 * function granted to every authenticated role, so it stays correct even
 * when `entry_exit_logs` RLS would hide the row from a plain select (e.g. a
 * foreman looking up equipment currently in the workshop).
 */
export interface InquiryLastMovement {
  movement_type: string | null
  movement_context: MovementContext | null
  workshop_purpose: WorkshopPurpose | null
  recorded_at: string | null
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  supervisor_name: string | null
}

export interface InquiryEquipmentState {
  presence: EquipmentPresence
  companyNameAr: string | null
  companyNameEn: string | null
  projectNameAr: string | null
  projectNameEn: string | null
  supervisorName: string | null
  workshopPurpose: WorkshopPurpose | null
  /** ISO timestamp of the movement the state was derived from, if any. */
  since: string | null
}

const OUTSIDE_STATE: InquiryEquipmentState = {
  presence: 'outside',
  companyNameAr: null,
  companyNameEn: null,
  projectNameAr: null,
  projectNameEn: null,
  supervisorName: null,
  workshopPurpose: null,
  since: null,
}

/**
 * Current state of one equipment from its latest movement (any context).
 * A missing row, or a latest movement that is an EXIT, both mean "outside":
 * `entry_exit_logs` never allows two open visits back to back, so the latest
 * movement alone is enough to tell inside from outside.
 */
export function deriveEquipmentState(
  last: InquiryLastMovement | null | undefined,
): InquiryEquipmentState {
  if (!last || last.movement_type !== 'entry') return OUTSIDE_STATE

  if (last.movement_context === 'workshop')
    return {
      ...OUTSIDE_STATE,
      presence: 'inside_workshop',
      supervisorName: last.supervisor_name ?? null,
      workshopPurpose: last.workshop_purpose ?? null,
      since: last.recorded_at ?? null,
    }

  return {
    ...OUTSIDE_STATE,
    presence: 'inside_site',
    companyNameAr: last.company_name_ar ?? null,
    companyNameEn: last.company_name_en ?? null,
    projectNameAr: last.project_name_ar ?? null,
    projectNameEn: last.project_name_en ?? null,
    supervisorName: last.supervisor_name ?? null,
    since: last.recorded_at ?? null,
  }
}
