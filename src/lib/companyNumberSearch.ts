import type { SupabaseClient } from '@supabase/supabase-js'

// «ترقيم الشركة» in the inquiry search (owner 2026-10-27: «نقدر نضيف
// البحث بترقيم الشركة؟», then «خليه ترقيم اخر حركة مشروع»): the company
// number (`contractor_equipment_code`) lives on the movements, not on the
// unit, and a unit may carry another number in every project; a unit
// matches only when the number of its LATEST project movement matches the
// term. RLS decides which movements a reader sees, as everywhere.

/** Candidates read per search (newest matching project movements first). */
const MATCH_ROWS_LIMIT = 60
/** Units checked per search; past the cap the lookup is best-effort. */
const CANDIDATE_LIMIT = 20
/** Later project movements read to confirm the candidates. */
const LATER_ROWS_LIMIT = 200

export interface CompanyNumberRow {
  equipment_id: string
  contractor_equipment_code: string | null
  recorded_at: string
  id: string
}

function contains(code: string | null, term: string): boolean {
  return Boolean(code) && code!.toLowerCase().includes(term.toLowerCase())
}

/**
 * The newest matching project movement of each unit, newest units first,
 * at most `CANDIDATE_LIMIT`. `rows` come newest first.
 */
export function companyNumberCandidates(
  rows: readonly CompanyNumberRow[],
): CompanyNumberRow[] {
  const seen = new Set<string>()
  const candidates: CompanyNumberRow[] = []
  for (const row of rows) {
    if (seen.has(row.equipment_id)) continue
    seen.add(row.equipment_id)
    candidates.push(row)
    if (candidates.length === CANDIDATE_LIMIT) break
  }
  return candidates
}

/**
 * The units whose latest project movement carries a matching number, with
 * that number. `later` holds project movements recorded after each
 * candidate's match (newest first): a unit whose newest later movement
 * carries another number moved on and no longer matches.
 */
export function confirmLatestCompanyNumbers(
  candidates: readonly CompanyNumberRow[],
  later: readonly CompanyNumberRow[],
  term: string,
): Map<string, string> {
  const newestLater = new Map<string, CompanyNumberRow>()
  for (const row of later)
    if (!newestLater.has(row.equipment_id)) newestLater.set(row.equipment_id, row)
  const matches = new Map<string, string>()
  for (const candidate of candidates) {
    const latest = newestLater.get(candidate.equipment_id) ?? candidate
    if (contains(latest.contractor_equipment_code, term))
      matches.set(candidate.equipment_id, latest.contractor_equipment_code!)
  }
  return matches
}

const SELECT = 'equipment_id,contractor_equipment_code,recorded_at,id'

/**
 * Unit id → its latest project movement's company number, for the units
 * whose number contains `term` (already sanitised). Two bounded reads of
 * `movement_log_search`; the first uses the trigram index of
 * `entry_exit_logs.contractor_equipment_code` (migration 0035).
 */
export async function fetchCompanyNumberMatches(
  client: SupabaseClient,
  term: string,
  signal?: AbortSignal,
): Promise<{ matches: Map<string, string>; error: boolean }> {
  if (!term) return { matches: new Map(), error: false }
  let first = client
    .from('movement_log_search')
    .select(SELECT)
    .eq('movement_context', 'site')
    .ilike('contractor_equipment_code', `%${term}%`)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MATCH_ROWS_LIMIT)
  if (signal) first = first.abortSignal(signal)
  const matched = await first
  if (matched.error) return { matches: new Map(), error: true }
  const candidates = companyNumberCandidates(
    (matched.data as CompanyNumberRow[] | null) ?? [],
  )
  if (candidates.length === 0) return { matches: new Map(), error: false }

  // Each candidate's project movements after its match, in one read.
  let second = client
    .from('movement_log_search')
    .select(SELECT)
    .eq('movement_context', 'site')
    .or(
      candidates
        .map(
          (candidate) =>
            `and(equipment_id.eq.${candidate.equipment_id},recorded_at.gt."${candidate.recorded_at}")`,
        )
        .join(','),
    )
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LATER_ROWS_LIMIT)
  if (signal) second = second.abortSignal(signal)
  const later = await second
  if (later.error) return { matches: new Map(), error: true }
  return {
    matches: confirmLatestCompanyNumbers(
      candidates,
      (later.data as CompanyNumberRow[] | null) ?? [],
      term,
    ),
    error: false,
  }
}
