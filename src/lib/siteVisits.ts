import type { DataListConfig, ListFilter } from '@/components/data-list/types'
import { addDaysToDateKey } from '@/lib/calendar'
import { saudiDateKey, saudiDayStart } from '@/lib/saudiTime'

/**
 * Migration 0188 (owner 2026-11-09, «60 يوم خليها»): «المعدات في المشاريع»
 * lists the site VISITS, open and closed (`purchasing_site_visits`), and a
 * closed visit can join a PO. By default the page shows the visits inside a
 * project now OR exited within the last 60 Saudi days; the PO and client PO
 * pickers read the same window. Pure, so the configs and tests import it
 * without React.
 */
export const SITE_VISITS_RECENT_DAYS = 60

/** The «الحالة» filter of a visit (`purchasing_site_visits.visit_state`). */
export const SITE_VISIT_STATES = ['inside', 'exited'] as const
export type SiteVisitState = (typeof SITE_VISIT_STATES)[number]

/** The visible, removable default filter key of the page: not a column. */
export const SITE_UNITS_RECENT_FILTER_KEY = 'recent_exit'

/** The default filter: inside now, or exited within the last 60 days. */
export const SITE_UNITS_RECENT_DEFAULT_FILTER: ListFilter = {
  id: 'default-recent-exit',
  field: SITE_UNITS_RECENT_FILTER_KEY,
  operator: 'eq',
  value: String(SITE_VISITS_RECENT_DAYS),
}

/** The first instant of the Saudi day `days` days before today. */
export function recentVisitsSince(
  days: number = SITE_VISITS_RECENT_DAYS,
  now: Date = new Date(),
): string {
  const today = saudiDateKey(now)
  // saudiDateKey always gives a valid key, so the fallback never applies.
  return saudiDayStart(addDaysToDateKey(today, -days) ?? today)
}

/**
 * The PostgREST `or` of «inside now or exited since `since`»: an open visit
 * has no exit (`exit_id` NULL), a closed one its `exit_at`. `since` is an ISO
 * instant computed here, never user text.
 */
export function recentVisitOrClause(
  since: string = recentVisitsSince(),
): string {
  return `exit_id.is.null,exit_at.gte.${since}`
}

/**
 * Pulls the default «خرجت خلال 60 يوما او داخل الان» filter out of the list
 * filters (the `visitPeriodOrFilter` pattern): returns its `or` clause (null
 * when the filter is absent or its value is not a whole number of days) and
 * the filters left for `applyListFilters`, which never hold it.
 */
export function siteUnitsRecentOrFilter(
  filters: readonly ListFilter[],
  now: Date = new Date(),
): { clause: string | null; rest: ListFilter[] } {
  const rest = filters.filter(
    (filter) => filter.field !== SITE_UNITS_RECENT_FILTER_KEY,
  )
  const recent = filters.find(
    (filter) => filter.field === SITE_UNITS_RECENT_FILTER_KEY,
  )
  if (!recent || recent.operator !== 'eq') return { clause: null, rest }
  const days = Number(recent.value)
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    return { clause: null, rest }
  return { clause: recentVisitOrClause(recentVisitsSince(days, now)), rest }
}

/** The config's filter keys that are columns: the allowlist minus the window. */
export function siteUnitsColumnFilterKeys(config: DataListConfig): Set<string> {
  return new Set(
    config.filterFields
      .map((field) => field.key)
      .filter((key) => key !== SITE_UNITS_RECENT_FILTER_KEY),
  )
}

/** One visit as the pickers read it: open when it has no exit. */
export interface VisitLike {
  equipment_id: string
  company_id: string
  project_id: string
  entry_at: string
  exit_at: string | null
}

/**
 * One visit per unit and project (owner 2026-11-09): the open visit first,
 * else the latest entry — the visit `add_client_po_equipment` (0188) picks.
 * Keeps the input order of the kept rows.
 */
export function latestVisitPerUnit<T extends VisitLike>(
  visits: readonly T[],
): T[] {
  const best = new Map<string, T>()
  for (const visit of visits) {
    const key = `${visit.equipment_id}|${visit.company_id}|${visit.project_id}`
    const current = best.get(key)
    if (!current || visitRank(visit) > visitRank(current)) best.set(key, visit)
  }
  const kept = new Set(best.values())
  return visits.filter((visit) => kept.has(visit))
}

/**
 * One visit per unit, project and Saudi entry day (the supplier side, 0148:
 * a unit joins one PO through the visit of its start date): the open one
 * first, else the latest entry of that day.
 */
export function latestVisitPerUnitDay<T extends VisitLike>(
  visits: readonly T[],
): T[] {
  const best = new Map<string, T>()
  for (const visit of visits) {
    const key = `${visit.equipment_id}|${visit.company_id}|${visit.project_id}|${saudiDateKey(visit.entry_at)}`
    const current = best.get(key)
    if (!current || visitRank(visit) > visitRank(current)) best.set(key, visit)
  }
  const kept = new Set(best.values())
  return visits.filter((visit) => kept.has(visit))
}

function visitRank(visit: VisitLike): number {
  // An open visit outranks every closed one; then the later entry.
  return (visit.exit_at ? 0 : 1e15) + Date.parse(visit.entry_at)
}

/** Whether a visit has left its project. */
export function visitExited(visit: { exit_at: string | null }): boolean {
  return Boolean(visit.exit_at)
}
