/**
 * Pure rules of the admin home v2 (owner 2026-11-09, «اعتمد الرئيسية الي في
 * ui-kit», variant «ب بمسافات الحالية»): shares, the projects with the most
 * units inside, the KPI's daily run and the time label of a movement. No
 * Supabase here; `adminHomeData` reads, this module shapes.
 */

import { saudiDateKey } from '@/lib/saudiTime'

/** A whole-number share in percent; 0 for an empty total. */
export function sharePercent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

/** One open project visit, as read for «المشاريع الاكثر معدات». */
export interface OpenProjectVisit {
  projectId: string | null
  nameAr: string | null
  nameEn: string | null
}

export interface ProjectCount {
  id: string
  nameAr: string | null
  nameEn: string | null
  count: number
}

export interface TopProjects {
  top: ProjectCount[]
  /** Units inside the projects beyond the top ones. */
  others: number
  /** Projects beyond the top ones. */
  otherProjects: number
  total: number
}

/** Rows shown by «المشاريع الاكثر معدات». */
export const TOP_PROJECTS_LIMIT = 6

/**
 * The open visits grouped by project, the largest first (ties by name, then
 * id, so the order never flips between loads); the rest summed. A visit
 * without a project (an imported legacy row) is not a project and is left
 * out.
 */
export function topProjects(
  visits: readonly OpenProjectVisit[],
  limit = TOP_PROJECTS_LIMIT,
): TopProjects {
  const byId = new Map<string, ProjectCount>()
  for (const visit of visits) {
    if (!visit.projectId) continue
    const row = byId.get(visit.projectId)
    if (row) row.count += 1
    else
      byId.set(visit.projectId, {
        id: visit.projectId,
        nameAr: visit.nameAr,
        nameEn: visit.nameEn,
        count: 1,
      })
  }
  const sorted = Array.from(byId.values()).sort(
    (a, b) =>
      b.count - a.count ||
      (a.nameAr ?? '').localeCompare(b.nameAr ?? '', 'ar') ||
      a.id.localeCompare(b.id),
  )
  const top = sorted.slice(0, limit)
  const total = sorted.reduce((sum, row) => sum + row.count, 0)
  return {
    top,
    others: total - top.reduce((sum, row) => sum + row.count, 0),
    otherProjects: Math.max(0, sorted.length - top.length),
    total,
  }
}

/** Days of the KPI strip's small run of bars. */
export const KPI_SPARK_DAYS = 14

/**
 * The entries (or exits) of the last `days` Saudi days ending `today`, oldest
 * first, with 0 for a day without a row. `rows` are the daily series of
 * `get_admin_entries_series` (`day` = YYYY-MM-DD).
 */
export function dailyRun(
  rows: readonly { day: string; entries: number; exits: number }[],
  field: 'entries' | 'exits',
  today: string = saudiDateKey(),
  days = KPI_SPARK_DAYS,
): number[] {
  const byDay = new Map(rows.map((row) => [row.day, row[field]]))
  const end = Date.parse(`${today}T00:00:00Z`)
  const run: number[] = []
  for (let back = days - 1; back >= 0; back -= 1) {
    const key = new Date(end - back * 86_400_000).toISOString().slice(0, 10)
    run.push(byDay.get(key) ?? 0)
  }
  return run
}

/**
 * The time a movement shows in «اخر الحركات»: the Saudi clock for a movement
 * of the Saudi today («10:15»), else the Saudi day and month («08/11»).
 */
export function movementTimeLabel(
  recordedAt: string,
  now: Date = new Date(),
): string {
  const at = new Date(recordedAt)
  if (Number.isNaN(at.getTime())) return '—'
  const saudi = new Date(at.getTime() + 3 * 3600_000)
  if (saudiDateKey(at) === saudiDateKey(now)) {
    const hh = String(saudi.getUTCHours()).padStart(2, '0')
    const mm = String(saudi.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  const dd = String(saudi.getUTCDate()).padStart(2, '0')
  const mo = String(saudi.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mo}`
}
