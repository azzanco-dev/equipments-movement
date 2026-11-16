/**
 * The reads behind the day columns of the visits export
 * (`@/lib/visitDayExport`): the visits of the exported units that touch the
 * month, both contexts, and which of those units have an earlier visit.
 *
 * Bounded: the units go in chunks and every chunk is paged, so no request
 * returns more than one page whatever the history. `movement_visits` is a
 * `security_invoker` view, so the reader's own RLS decides the rows. A failed
 * read throws: the export fails rather than writing wrong days.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { monthBounds } from '@/lib/visitDayGrid'
import type { MonthVisitRow } from '@/lib/visitDayExport'

const VISITS_VIEW = 'movement_visits'
export const MONTH_VISIT_SELECT =
  'entry_id,equipment_id,movement_context,workshop_purpose,entry_at,exit_at'
const UNIT_CHUNK = 50
const PAGE_SIZE = 1000

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size))
  return out
}

/** The month's two edges as UTC instants (no `+` to escape in a filter). */
export function monthInstantBounds(monthKey: string): {
  start: string
  end: string
} | null {
  const { start, end } = monthBounds(monthKey)
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  }
}

/** Every visit of these units that touches the month: it started by the
 *  month's end and is open or ended at or after the month's start. */
export async function loadMonthVisits(
  client: SupabaseClient,
  equipmentIds: readonly string[],
  monthKey: string,
): Promise<MonthVisitRow[]> {
  const bounds = monthInstantBounds(monthKey)
  if (!bounds || equipmentIds.length === 0) return []
  const rows: MonthVisitRow[] = []
  for (const chunk of chunks(equipmentIds, UNIT_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from(VISITS_VIEW)
        .select(MONTH_VISIT_SELECT)
        .in('equipment_id', chunk)
        .lte('entry_at', bounds.end)
        .or(`exit_at.gte.${bounds.start},exit_at.is.null`)
        .order('entry_at', { ascending: true })
        .order('entry_id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      const page = (data ?? []) as unknown as MonthVisitRow[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return rows
}

/** Which of these units have a visit that started before the month. */
export async function loadUnitsSeenBefore(
  client: SupabaseClient,
  equipmentIds: readonly string[],
  monthKey: string,
): Promise<Set<string>> {
  const seen = new Set<string>()
  const bounds = monthInstantBounds(monthKey)
  if (!bounds || equipmentIds.length === 0) return seen
  for (const chunk of chunks(equipmentIds, UNIT_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from(VISITS_VIEW)
        .select('equipment_id')
        .in('equipment_id', chunk)
        .lt('entry_at', bounds.start)
        .order('entry_id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      const page = (data ?? []) as unknown as Array<{ equipment_id: string }>
      for (const row of page) seen.add(row.equipment_id)
      if (page.length < PAGE_SIZE) break
    }
  }
  return seen
}
