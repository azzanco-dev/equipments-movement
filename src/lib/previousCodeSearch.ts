/**
 * wave-15-export: the `/logs` search (both the movement log and the visits
 * view) also finds a unit by a code it used before (`equipment_code_changes`,
 * migration 0114), without a migration.
 *
 * The screen first resolves the ids of the units whose previous code matches
 * the term (`fetchPreviousCodeMatchIds` in `@/lib/equipmentCodeHistory`, the
 * same bounded probe the equipment list uses), then adds them as one more
 * `or` branch over the view's `equipment_id`. The export reuses the ids the
 * list resolved, so the file never disagrees with the screen.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPreviousCodeMatchIds } from '@/lib/equipmentCodeHistory'
import { sanitizeSearchTerm } from '@/lib/search'
import { toLatinDigits } from '@/lib/plate'
import { SupabaseLoadError } from '@/lib/supabaseResult'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The term the previous-code probe searches for, exactly as the list search
 * cleans it (sanitized, Arabic-Indic digits as ASCII); empty means no probe.
 */
export function previousCodeSearchTerm(rawTerm: string): string {
  return toLatinDigits(sanitizeSearchTerm(rawTerm))
}

/**
 * `equipment_id.in.(…)` for the matched units, or `null` when there is none.
 * Only uuids are kept, so nothing can break out of the `or=(...)` tree.
 */
export function previousCodeEquipmentBranch(
  ids: readonly string[],
): string | null {
  const valid = Array.from(
    new Set(ids.filter((id) => UUID_PATTERN.test(id))),
  ).map((id) => id.toLowerCase())
  return valid.length ? `equipment_id.in.(${valid.join(',')})` : null
}

/**
 * The search filter with the previous-code branch appended. An empty search
 * stays `null`: the branch only ever widens a search, it never filters alone.
 */
export function withPreviousCodeBranch(
  searchFilter: string | null,
  ids: readonly string[],
): string | null {
  if (!searchFilter) return null
  const branch = previousCodeEquipmentBranch(ids)
  return branch ? `${searchFilter},${branch}` : searchFilter
}

/** The ids a list resolved for one search term, kept for its export. */
export interface ResolvedPreviousCodes {
  term: string
  ids: string[]
}

/**
 * The ids resolved for `rawTerm`, when the list already resolved that very
 * term; `null` means the caller has to probe again.
 */
export function reusablePreviousCodeIds(
  resolved: ResolvedPreviousCodes | null | undefined,
  rawTerm: string,
): string[] | null {
  const term = previousCodeSearchTerm(rawTerm)
  if (!term) return []
  return resolved && resolved.term === term ? resolved.ids : null
}

/**
 * The ids of the units that once used a code matching `rawTerm`; `[]` for an
 * empty term (no request). Throws `SupabaseLoadError` on a failed probe, so
 * the list shows its load error instead of silently dropping the branch.
 */
export async function resolvePreviousCodeIds(
  client: SupabaseClient,
  rawTerm: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const term = previousCodeSearchTerm(rawTerm)
  if (!term) return []
  const result = await fetchPreviousCodeMatchIds(client, term, signal)
  if (result.error) throw new SupabaseLoadError()
  return result.ids
}
