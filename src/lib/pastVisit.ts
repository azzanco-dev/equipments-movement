import type { TranslationKey } from '@/i18n/translations'
import type { FieldErrors, PostgresLikeError } from '@/lib/formValidation'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * «اضافة زيارة كاملة» (owner 2026-11-15; migration 0197): the pure part of the
 * dialog that records a whole PAST project visit — entry and exit together —
 * in the name of a foreman through `add_past_site_visit`. Nothing here calls
 * the database (the RPC wrapper is `pastVisitData.ts`), so the node tests load
 * it directly.
 */

/** The key that shows the button and that the database re-checks. */
export const PAST_VISIT_PERMISSION = 'movements.site.add_past_visit'

/** Same limits as `admin_update_movement` (`src/lib/movementAdmin.ts`). */
export const PAST_VISIT_NOTES_MAX_LENGTH = 1000
export const PAST_VISIT_CONTRACTOR_CODE_MAX_LENGTH = 50

/** The dialog's values: ids and `YYYY-MM-DD` dates, '' while empty. */
export interface PastVisitValues {
  equipment_id: string
  supervisor_id: string
  company_id: string
  project_id: string
  entry_date: string
  exit_date: string
  driver_id: string
  contractor_code: string
  notes: string
}

export const EMPTY_PAST_VISIT_VALUES: PastVisitValues = {
  equipment_id: '',
  supervisor_id: '',
  company_id: '',
  project_id: '',
  entry_date: '',
  exit_date: '',
  driver_id: '',
  contractor_code: '',
  notes: '',
}

/** The visual order of the fields, for focusing the first invalid one. */
export const PAST_VISIT_FIELD_ORDER: readonly (keyof PastVisitValues)[] = [
  'equipment_id',
  'supervisor_id',
  'company_id',
  'project_id',
  'entry_date',
  'exit_date',
  'driver_id',
  'contractor_code',
  'notes',
]

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Today as a `YYYY-MM-DD` key on this device, as the edit dialog counts it. */
export function pastVisitTodayKey(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function dayNumber(key: string): number | null {
  if (!DATE_KEY.test(key)) return null
  const time = Date.parse(`${key}T00:00:00Z`)
  return Number.isNaN(time) ? null : time / 86_400_000
}

/**
 * Whole days from the entry day to the exit day, or null while either date is
 * missing or invalid or the exit is before the entry.
 */
export function pastVisitDays(
  entryDate: string,
  exitDate: string,
): number | null {
  const from = dayNumber(entryDate)
  const to = dayNumber(exitDate)
  if (from === null || to === null || to < from) return null
  return to - from
}

/**
 * The payload of `add_past_site_visit`: blank optional fields go as `null`,
 * text is trimmed, dates stay `YYYY-MM-DD`.
 */
export function buildPastVisitPayload(values: PastVisitValues) {
  const blank = (value: string) => value.trim() || null
  return {
    p_equipment_id: values.equipment_id,
    p_supervisor_id: values.supervisor_id,
    p_company_id: values.company_id,
    p_project_id: values.project_id,
    p_entry_date: values.entry_date,
    p_exit_date: values.exit_date,
    p_driver_id: blank(values.driver_id),
    p_contractor_equipment_code: blank(values.contractor_code),
    p_notes: blank(values.notes),
  }
}

/** The two ids `add_past_site_visit` returns (one row, or a one-row array). */
export function parsePastVisitResult(
  data: unknown,
): { entryId: string; exitId: string } | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const { entry_id: entryId, exit_id: exitId } = row as Record<string, unknown>
  if (typeof entryId !== 'string' || !UUID.test(entryId)) return null
  if (typeof exitId !== 'string' || !UUID.test(exitId)) return null
  return { entryId, exitId }
}

// --- The overlap conflict (`visit_overlap`, DETAIL = a JSON object) ---------

export interface PastVisitConflict {
  entryId: string
  entryAt: string
  /** null = the conflicting visit is still open. */
  exitAt: string | null
  projectNameAr: string | null
  projectNameEn: string | null
}

const isoDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

const nameOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

/**
 * Reads and VALIDATES the JSON the database puts in the DETAIL of
 * `visit_overlap`. Anything that is not exactly the documented shape (a bad
 * uuid or date, a name that is not text, malformed JSON) returns null, and the
 * screen then shows the conflict without details.
 */
export function parsePastVisitConflict(
  details: string | null | undefined,
): PastVisitConflict | null {
  if (!details) return null
  let value: unknown
  try {
    value = JSON.parse(details)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.entry_id !== 'string' || !UUID.test(raw.entry_id)) return null
  if (!isoDate(raw.entry_at)) return null
  if (raw.exit_at !== null && !isoDate(raw.exit_at)) return null
  if (!nameOrNull(raw.project_name_ar) || !nameOrNull(raw.project_name_en))
    return null
  return {
    entryId: raw.entry_id,
    entryAt: raw.entry_at,
    exitAt: (raw.exit_at as string | null) ?? null,
    projectNameAr: raw.project_name_ar,
    projectNameEn: raw.project_name_en,
  }
}

/** The Saudi day keys of the conflicting visit (`to` null = still open). */
export function pastVisitConflictDays(conflict: PastVisitConflict): {
  from: string
  to: string | null
} {
  return {
    from: saudiDateKey(conflict.entryAt),
    to: conflict.exitAt ? saudiDateKey(conflict.exitAt) : null,
  }
}

/** The conflicting project's name in the UI language (the other as fallback). */
export function pastVisitConflictProject(
  conflict: PastVisitConflict,
  lang: 'ar' | 'en',
): string | null {
  const ar = conflict.projectNameAr?.trim() || null
  const en = conflict.projectNameEn?.trim() || null
  return (lang === 'ar' ? (ar ?? en) : (en ?? ar)) || null
}

// --- Tokens → fields and messages -------------------------------------------

type FieldKey = keyof PastVisitValues

/** Stable tokens of 0197 that belong to fields. */
const FIELD_TOKENS: ReadonlyArray<
  readonly [string, Partial<Record<FieldKey, TranslationKey>>]
> = [
  ['invalid_equipment', { equipment_id: 'pastVisitErrorEquipment' }],
  ['invalid_supervisor', { supervisor_id: 'pastVisitErrorSupervisor' }],
  ['invalid_company', { company_id: 'pastVisitErrorCompany' }],
  ['invalid_project', { project_id: 'pastVisitErrorProject' }],
  ['invalid_driver', { driver_id: 'pastVisitErrorDriver' }],
  [
    'invalid_contractor_code',
    { contractor_code: 'pastVisitContractorCodeTooLong' },
  ],
  ['invalid_notes', { notes: 'pastVisitNotesTooLong' }],
  ['exit_before_entry', { exit_date: 'pastVisitExitBeforeEntry' }],
  ['visit_in_future', { exit_date: 'pastVisitExitInFuture' }],
  [
    'invalid_dates',
    {
      entry_date: 'pastVisitDatesInvalid',
      exit_date: 'pastVisitDatesInvalid',
    },
  ],
  ['equipment_in_workshop', { entry_date: 'pastVisitErrorInWorkshop' }],
]

/** Refusals of the movement sequence trigger (0043 / 0155 / 0195). */
const SEQUENCE_MARKERS = [
  'sequence would be invalid',
  'no prior entry found',
  'exit_equipment_in_workshop',
  'exit_equipment_on_site',
] as const

/** Every token the client maps, for the tests. */
export const PAST_VISIT_ERROR_TOKENS: readonly string[] = [
  'past_visit_required',
  'visit_overlap',
  'visit_no_gap',
  ...FIELD_TOKENS.map(([token]) => token),
]

export type PastVisitOutcome =
  | { kind: 'fields'; fields: FieldErrors<PastVisitValues> }
  | { kind: 'form'; message: TranslationKey }
  | {
      kind: 'conflict'
      conflict: PastVisitConflict | null
      fields: FieldErrors<PastVisitValues>
    }

/**
 * How a refused save is shown. The token is `error.message`; `visit_overlap`
 * also carries the conflicting visit as JSON in `error.details`. Raw database
 * text is never returned: an unknown or locked refusal is the generic message.
 */
export function pastVisitErrorOutcome(
  error: PostgresLikeError | null | undefined,
): PastVisitOutcome {
  const text = (error?.message ?? '').toLowerCase()

  if (text.includes('visit_overlap'))
    return {
      kind: 'conflict',
      conflict: parsePastVisitConflict(error?.details),
      fields: {
        entry_date: 'pastVisitConflictDateHint',
        exit_date: 'pastVisitConflictDateHint',
      },
    }
  if (text.includes('past_visit_required'))
    return { kind: 'form', message: 'pastVisitErrorNotAllowed' }
  // No room between the unit's other movements on a boundary day.
  if (text.includes('visit_no_gap'))
    return { kind: 'form', message: 'pastVisitErrorNoGap' }
  // The sequence markers first: `exit_equipment_in_workshop` contains the
  // field token `equipment_in_workshop`.
  if (SEQUENCE_MARKERS.some((marker) => text.includes(marker)))
    return { kind: 'form', message: 'pastVisitErrorSequence' }

  for (const [token, fields] of FIELD_TOKENS)
    if (text.includes(token)) return { kind: 'fields', fields }
  return { kind: 'form', message: 'saveFailed' }
}
