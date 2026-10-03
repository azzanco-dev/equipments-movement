import type { SupabaseClient } from '@supabase/supabase-js'
import type { OwnershipStatus } from '@/lib/types'
import { inferOwnershipFromCode } from '@/lib/equipmentOwnership'
import { formatDate } from '@/lib/dateFormat'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * Equipment code change history (EM-196, migration 0114). A code change keeps
 * the same equipment id; the previous code is recorded by a database trigger
 * in `equipment_code_changes`, so searching an old code still reaches the
 * same unit. Pure helpers, plus one bounded lookup that takes the client as an
 * argument so this module stays testable without a browser.
 */

export interface EquipmentCodeChange {
  id: string
  equipment_id: string
  old_code: string
  new_code: string
  changed_at: string
  reason: string | null
}

export const EQUIPMENT_CODE_CHANGE_SELECT =
  'id,equipment_id,old_code,new_code,changed_at,reason'

/** Mirrors the `equipment_code_changes_reason_length` check. */
export const CODE_CHANGE_REASON_MAX = 500

/** History rows read per equipment on the detail and inquiry pages. */
export const EQUIPMENT_CODE_CHANGES_LIMIT = 20

/** Bound on the previous-code probe added to a list/suggestion search. */
export const PREVIOUS_CODE_MATCH_LIMIT = 50

/** Same normalisation as the database duplicate checks: upper(btrim(code)). */
export function normalizeEquipmentCode(code: string | null | undefined) {
  return (code ?? '').trim().toUpperCase()
}

/** True when `next` is a real code change from `original` (not only case or
 *  surrounding spaces, which the database does not record either). */
export function isEquipmentCodeChanged(
  original: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const to = normalizeEquipmentCode(next)
  return to !== '' && to !== normalizeEquipmentCode(original)
}

/**
 * The owner the new code's prefix suggests, when it differs from the owner the
 * record had before the edit; `null` when the suggestion is the same. Reuses
 * the form's prefix rule (A, TK, F, B, otherwise external supplier).
 */
export function ownerSuggestedByNewCode(
  originalOwner: OwnershipStatus,
  newCode: string,
): OwnershipStatus | null {
  const inferred = inferOwnershipFromCode(newCode)
  return inferred && inferred !== originalOwner ? inferred : null
}

export interface PreviousCodeEntry {
  code: string
  /** Saudi calendar day the unit stopped using the code, dd/mm/yyyy. */
  until: string
}

/**
 * «ارقام سابقة: A115 (حتى 20/09/2026)». One entry per distinct previous code,
 * newest first; a code used twice shows the latest day it was left. The
 * current code is never listed, so a unit given back its own previous code
 * does not show it as "previous".
 */
export function previousCodeEntries(
  changes: readonly EquipmentCodeChange[],
  currentCode: string | null | undefined,
): PreviousCodeEntry[] {
  const current = normalizeEquipmentCode(currentCode)
  const sorted = [...changes].sort((a, b) => {
    const byTime = Date.parse(b.changed_at) - Date.parse(a.changed_at)
    if (byTime) return byTime
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
  const seen = new Set<string>()
  const entries: PreviousCodeEntry[] = []
  for (const change of sorted) {
    const key = normalizeEquipmentCode(change.old_code)
    if (!key || key === current || seen.has(key)) continue
    seen.add(key)
    let until = ''
    try {
      until = formatDate(saudiDateKey(change.changed_at))
    } catch {
      until = ''
    }
    entries.push({ code: change.old_code.trim(), until })
  }
  return entries
}

/** `matched_previous_code` from the movement-form search functions (0114). */
export function matchedPreviousCode(row: unknown): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    (row as { matched_previous_code?: unknown }).matched_previous_code === true
  )
}

/** Case-insensitive substring test, the client-side twin of `ILIKE %term%`
 *  for an already sanitized term. */
export function codeMatchesTerm(code: string | null | undefined, term: string) {
  const needle = term.trim().toLowerCase()
  return needle !== '' && (code ?? '').toLowerCase().includes(needle)
}

/** Distinct equipment ids from the previous-code probe. */
export function distinctEquipmentIds(
  rows: readonly { equipment_id: string }[] | null | undefined,
): string[] {
  return Array.from(new Set((rows ?? []).map((row) => row.equipment_id)))
}

/**
 * The extra PostgREST `or(...)` part for equipment whose previous code
 * matched, or `null` when none did. Ids are uuids from the database, so they
 * cannot break out of the filter.
 */
export function previousCodeOrPart(ids: readonly string[]): string | null {
  return ids.length ? `id.in.(${ids.join(',')})` : null
}

/**
 * Ids of equipment that once used a code matching `term` (already sanitized
 * and converted to Latin digits by the caller). Bounded; the
 * `equipment_code_changes` RLS read policy mirrors `equipment`.
 */
export async function fetchPreviousCodeMatchIds(
  client: SupabaseClient,
  term: string,
  signal?: AbortSignal,
): Promise<{ ids: string[]; error: boolean }> {
  let request = client
    .from('equipment_code_changes')
    .select('equipment_id')
    .ilike('old_code', `%${term}%`)
    // Newest changes first, so the bounded set is deterministic. Past the
    // cap the previous-code part of a search is best-effort.
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PREVIOUS_CODE_MATCH_LIMIT)
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) return { ids: [], error: true }
  return {
    ids: distinctEquipmentIds(data as { equipment_id: string }[] | null),
    error: false,
  }
}

/** The reuse guard of 0114 (`equipment_code_previously_used`). */
export function isPreviousCodeError(
  error:
    { message?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (!error) return false
  return `${error.message ?? ''} ${error.details ?? ''}`.includes(
    'equipment_code_previously_used',
  )
}
