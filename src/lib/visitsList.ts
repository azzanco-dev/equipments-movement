import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'
import { sanitizeSearchTerm } from '@/lib/search'
import type { Language } from '@/i18n/translations'
import type { DataListConfig } from '@/components/data-list/types'

/**
 * `equipment_visits` (migration 0096) is a `security_invoker` view with one
 * row per visit: each ENTRY paired with the EXIT that follows it in the same
 * (equipment, movement_context) sequence, ordered by `(recorded_at, id)`.
 * Searching, counting, sorting and pagination therefore all run in PostgreSQL,
 * exactly like the movement log does through `movement_log_search`.
 *
 * Everything in this file is pure so `tests/visits-list.test.cjs` can exercise
 * it without React or a bundler; the only imports are other pure helpers and
 * types (erased at compile time).
 */
export const EQUIPMENT_VISITS_VIEW = 'equipment_visits'

/** Only the columns the home visits tab renders or searches. */
export const EQUIPMENT_VISITS_SELECT =
  'entry_id,exit_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,movement_context,workshop_purpose,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en,entry_supervisor_id,entry_supervisor_name,exit_supervisor_id,driver_id,driver_name,entry_at,exit_at,is_open,duration_minutes'

export interface EquipmentVisitRow {
  entry_id: string
  exit_id: string | null
  equipment_id: string
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number?: string | null
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | null
  company_id: string | null
  company_name_ar: string | null
  company_name_en: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  entry_supervisor_id: string | null
  entry_supervisor_name: string | null
  exit_supervisor_id: string | null
  driver_id: string | null
  driver_name: string | null
  entry_at: string
  exit_at: string | null
  is_open: boolean
  duration_minutes: number | null
}

/** Sort keys the visits tab may ask the server for; anything else is ignored. */
export const VISIT_SORT_FIELDS = ['entry_at', 'exit_at'] as const
export type VisitSortField = (typeof VISIT_SORT_FIELDS)[number]

export function visitSortField(
  value: string | null | undefined,
): VisitSortField {
  return VISIT_SORT_FIELDS.includes(value as VisitSortField)
    ? (value as VisitSortField)
    : 'entry_at'
}

export const visitsListConfig: DataListConfig = {
  id: 'visits',
  searchPlaceholder: {
    ar: 'البحث بالمعدة (كود او نوع او لوحة) او السائق',
    en: 'Search by equipment (code, type or plate) or driver',
  },
  searchFields: ['equipment_code', 'equipment_plate_digits', 'driver_name'],
  // Newest visit first; `entry_id` breaks ties so paging is deterministic.
  defaultSort: 'entry_at',
  defaultDirection: 'desc',
  // The home tab deliberately exposes no filter builder: the context is fixed
  // by the role and the state toggle is the only other axis the owner asked
  // for. Filter fields stay an allowlist for whoever adds one later.
  filterFields: [],
  sortableFields: [
    { key: 'entry_at', label: { ar: 'وقت الدخول', en: 'Entry time' } },
    { key: 'exit_at', label: { ar: 'وقت الخروج', en: 'Exit time' } },
  ],
}

/**
 * Builds the PostgREST `or(...)` filter for a visit search term.
 *
 * The term is sanitized first (`sanitizeSearchTerm` trims, caps the length and
 * strips the characters that are structural inside `or=(...)`, including the
 * `%` / `_` / `*` wildcards), so nothing here can break out of its pattern.
 *
 * The term is matched as plain text. Arabic-Indic digits become ASCII first,
 * and a digits-only term additionally probes the normalized `plate_digits`.
 * The term is never split into plate letters — that made "a341" match every
 * plate containing an A (see `buildMovementSearchFilter`).
 *
 * Returns `null` when the term is empty after sanitizing.
 */
export function buildVisitSearchFilter(rawTerm: string): string | null {
  const term = toLatinDigits(sanitizeSearchTerm(rawTerm))
  if (!term) return null

  const parts = [
    `equipment_code.ilike.%${term}%`,
    `equipment_type.ilike.%${term}%`,
    `equipment_plate_number.ilike.%${term}%`,
    `driver_name.ilike.%${term}%`,
  ]

  const plateDigits = plateDigitsSearchTerm(term)
  if (plateDigits) parts.push(`equipment_plate_digits.ilike.%${plateDigits}%`)

  return parts.join(',')
}

export type VisitState = 'open' | 'closed'

export interface VisitStateView {
  state: VisitState
  /** Green while the equipment is still inside, neutral once it has left. */
  tone: 'success' | 'neutral'
  /** Translation key for the badge label. */
  labelKey: 'visitOpen' | 'visitClosed'
}

/**
 * Maps a visit row to its state badge.
 *
 * `is_open` is computed in SQL, but a row is treated as open whenever the exit
 * side is missing for any reason (the EXIT is hidden from this caller by RLS,
 * or a legacy row never got one). The two signals can only disagree if the
 * view and the client drift apart, and "still inside" is the safe reading.
 */
export function visitStateView(
  visit: Pick<EquipmentVisitRow, 'is_open' | 'exit_id' | 'exit_at'>,
): VisitStateView {
  const open = visit.is_open || !visit.exit_id || !visit.exit_at
  return open
    ? { state: 'open', tone: 'success', labelKey: 'visitOpen' }
    : { state: 'closed', tone: 'neutral', labelKey: 'visitClosed' }
}

const ARABIC_UNITS = {
  minute: ['دقيقة', 'دقيقتان', 'دقائق', 'دقيقة'],
  hour: ['ساعة', 'ساعتان', 'ساعات', 'ساعة'],
  day: ['يوم', 'يومان', 'ايام', 'يوما'],
} as const

type DurationUnit = keyof typeof ARABIC_UNITS

const ENGLISH_UNITS: Record<DurationUnit, string> = {
  minute: 'minute',
  hour: 'hour',
  day: 'day',
}

/**
 * Arabic number agreement: 1 is the bare singular, 2 is the dual, 3–10 take
 * the plural, and 11 and up return to the singular. Only the last two forms
 * are printed with the digits, which is how "3 ايام" and "11 يوما" read
 * naturally while "يوم" and "يومان" carry the count in the word itself.
 */
function arabicUnit(count: number, unit: DurationUnit): string {
  const forms = ARABIC_UNITS[unit]
  if (count === 0) return `${count} ${forms[3]}`
  if (count === 1) return forms[0]
  if (count === 2) return forms[1]
  if (count <= 10) return `${count} ${forms[2]}`
  return `${count} ${forms[3]}`
}

function englishUnit(count: number, unit: DurationUnit): string {
  return `${count} ${ENGLISH_UNITS[unit]}${count === 1 ? '' : 's'}`
}

/**
 * Humanises a visit duration that the database already reduced to whole
 * minutes: minutes below an hour, hours below a day, whole days above that.
 * The largest unit alone is enough for the list column — the movement detail
 * is where an exact instant belongs.
 *
 * Returns `null` for a missing or negative duration so the caller renders its
 * own placeholder instead of "0 دقيقة".
 */
export function formatVisitDuration(
  minutes: number | null | undefined,
  lang: Language,
): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0)
    return null

  const whole = Math.floor(minutes)
  const unit: DurationUnit =
    whole < 60 ? 'minute' : whole < 60 * 24 ? 'hour' : 'day'
  const count =
    unit === 'minute'
      ? whole
      : unit === 'hour'
        ? Math.floor(whole / 60)
        : Math.floor(whole / (60 * 24))

  return lang === 'ar' ? arabicUnit(count, unit) : englishUnit(count, unit)
}
