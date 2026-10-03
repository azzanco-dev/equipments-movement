import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'

/**
 * Strips characters that are structural in a PostgREST filter string
 * (`,` `.` `(` `)` `:` `"` `\` and `%` / `_` LIKE wildcards) so a search
 * term can never break out of the pattern it is embedded in.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[,.()"\\:*%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

// ---------------------------------------------------------------------------
// Arabic search normalisation (EM-113, migration 0116)
// ---------------------------------------------------------------------------

/**
 * Character folds of `public.normalize_search_text()` (migration 0116), by
 * code point so no combining mark is hidden in the source:
 * alif with hamza above / below, alif with madda and alif wasla become a
 * plain alif; alif maqsura becomes yeh; teh marbuta becomes heh.
 */
const SEARCH_FOLDS: Readonly<Record<string, string>> = {
  '\u0623': '\u0627',
  '\u0625': '\u0627',
  '\u0622': '\u0627',
  '\u0671': '\u0627',
  '\u0649': '\u064a',
  '\u0629': '\u0647',
}

/**
 * Removed code points: tatweel (U+0640), the harakat (U+064B..U+0652) and
 * the superscript alif (U+0670). Tested by code point rather than with a
 * regular expression character class, which would hold combining marks.
 */
function isRemovedSearchMark(code: number): boolean {
  return (
    code === 0x0640 || (code >= 0x064b && code <= 0x0652) || code === 0x0670
  )
}

/**
 * The browser-side mirror of `public.normalize_search_text()`:
 * hamza/madda alif -> alif, alif maqsura -> yeh, teh marbuta -> heh,
 * Arabic-Indic (and extended Arabic-Indic) digits -> ASCII, tatweel and
 * harakat removed, lower case, whitespace collapsed and trimmed.
 *
 * Only ever compare its result with a `*_search` column, which holds the
 * same normalisation of the stored text; both sides must use it.
 * `tests/search-normalisation.test.cjs` checks it against the migration.
 */
export function normalizeSearchText(value: string): string {
  let folded = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (isRemovedSearchMark(code)) continue
    if (code >= 0x0660 && code <= 0x0669) folded += String(code - 0x0660)
    else if (code >= 0x06f0 && code <= 0x06f9) folded += String(code - 0x06f0)
    else folded += SEARCH_FOLDS[character] ?? character
  }
  return folded.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * A searched column holding `normalize_search_text(...)` of its source
 * (migration 0116): `drivers.full_name_search`, `companies.name_ar_search`,
 * `movement_log_search.driver_name_search`, and so on.
 */
export function isNormalizedSearchField(field: string): boolean {
  return field.endsWith('_search')
}

/** `equipment.plate_digits` or a view column such as `equipment_plate_digits`. */
function isPlateDigitsField(field: string): boolean {
  return field === 'plate_digits' || field.endsWith('_plate_digits')
}

/**
 * Builds the PostgREST `or(...)` filter for a search box over exactly
 * `fields`, so a list's `searchFields` IS its search (EM-119):
 *
 * - the term is sanitised first (`sanitizeSearchTerm`), so nothing can break
 *   out of `or=(...)`, and Arabic-Indic digits become ASCII;
 * - a `*_search` field gets the normalised term (`normalizeSearchText`);
 * - a plate-digits field is probed only for a digits-only term, with the
 *   compact digits (a term is never split into plate letters: "a341" used to
 *   match every plate with an A);
 * - every other field gets the sanitised term as written.
 *
 * Returns `null` when nothing is left to search, so the caller adds no filter.
 */
export function buildSearchFilter(
  fields: readonly string[],
  rawTerm: string,
): string | null {
  const term = toLatinDigits(sanitizeSearchTerm(rawTerm))
  if (!term) return null
  const normalized = normalizeSearchText(term)
  const plateDigits = plateDigitsSearchTerm(term)

  const parts: string[] = []
  for (const field of fields) {
    if (isPlateDigitsField(field)) {
      if (plateDigits) parts.push(`${field}.ilike.%${plateDigits}%`)
    } else if (isNormalizedSearchField(field)) {
      if (normalized) parts.push(`${field}.ilike.%${normalized}%`)
    } else {
      parts.push(`${field}.ilike.%${term}%`)
    }
  }
  return parts.length ? parts.join(',') : null
}

// ---------------------------------------------------------------------------
// Shared search field sets (each is a real column list of its table or view)
// ---------------------------------------------------------------------------

/** `drivers`: the driver list and every driver selector. */
export const DRIVER_SEARCH_FIELDS = [
  'full_name_search',
  'name_en',
  'id_number',
  'mobile_number',
] as const

/** `companies` / `projects`: both names. */
export const COMPANY_PROJECT_SEARCH_FIELDS = [
  'name_ar_search',
  'name_en',
] as const

/** `lessors`: the supplier list. */
export const LESSOR_SEARCH_FIELDS = [
  'name_search',
  'contact_person_search',
  'contact_number',
] as const

/** `lessors` selectors and `equipment_types` (one name column each). */
export const NAME_SEARCH_FIELDS = ['name_search'] as const

/** `equipment`: the equipment list, the inquiry suggestions and selectors. */
export const EQUIPMENT_SEARCH_FIELDS = [
  'code',
  'type_search',
  'plate_number',
  'chassis_number',
  'plate_digits',
] as const

/** `equipment` pickers that show code and type only. */
export const EQUIPMENT_CODE_TYPE_SEARCH_FIELDS = [
  'code',
  'type_search',
] as const
