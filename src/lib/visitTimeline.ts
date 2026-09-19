// Pairs one equipment's movements into visits (ENTRY + its matching EXIT) for
// the inquiry timeline. Pure and import-free on purpose: the vm-based harness
// in tests/visit-timeline.test.cjs loads this file directly, and the pairing
// rule must be testable without React.
//
// Ordering is deterministic by `(recorded_at, id)`, the same key the movement
// invariants use, so historical insertions and identical timestamps always
// pair the same way.

export type MovementContext = 'site' | 'workshop'
export type MovementType = 'entry' | 'exit'
export type WorkshopPurpose = 'maintenance' | 'parking'

/** One movement row, reduced to what a timeline needs to render. */
export interface TimelineMovement {
  id: string
  movement_context: MovementContext
  movement_type: MovementType
  /** ISO timestamp. */
  recorded_at: string
  company_name?: string | null
  project_name?: string | null
  workshop_purpose?: WorkshopPurpose | null
  supervisor_name?: string | null
  /** Snapshot name; legacy rows carry only this, with no driver record. */
  driver_name?: string | null
  photo_count?: number | null
  /** Optional thumbnails; the timeline falls back to placeholders. */
  photo_urls?: (string | null)[] | null
}

export interface EquipmentVisit {
  /** Stable list key: the entry id, or `exit:<id>` for a lone exit. */
  key: string
  context: MovementContext
  entry: TimelineMovement | null
  exit: TimelineMovement | null
  /** An entry with no exit yet: the equipment is still inside. */
  open: boolean
  /** Legacy data: an exit with no matching entry before it. */
  orphanExit: boolean
  startedAt: string | null
  endedAt: string | null
  /** Newest instant in the visit; the timeline sorts and groups on it. */
  sortAt: string
  photoCount: number
}

export type EquipmentPresence = 'inside_site' | 'inside_workshop' | 'outside'

export interface VisitSummary {
  status: EquipmentPresence
  /** Total visits, including open and lone-exit segments. */
  visitCount: number
  siteDays: number
  workshopDays: number
  /** ISO timestamp of the newest movement, or null when there are none. */
  lastMovementAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function instant(value: string): number {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

/** `(recorded_at, id)` ascending; never falls back to input order. */
function compareMovements(a: TimelineMovement, b: TimelineMovement): number {
  const byTime = instant(a.recorded_at) - instant(b.recorded_at)
  if (byTime !== 0) return byTime
  if (a.recorded_at !== b.recorded_at)
    return a.recorded_at < b.recorded_at ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** Oldest-first copy of the movements, ordered by `(recorded_at, id)`. */
export function sortMovements(
  movements: readonly TimelineMovement[],
): TimelineMovement[] {
  return [...movements].sort(compareMovements)
}

function photoCount(movement: TimelineMovement | null): number {
  const value = movement?.photo_count
  return typeof value === 'number' && value > 0 ? value : 0
}

function openVisit(entry: TimelineMovement): EquipmentVisit {
  return {
    key: entry.id,
    context: entry.movement_context,
    entry,
    exit: null,
    open: true,
    orphanExit: false,
    startedAt: entry.recorded_at,
    endedAt: null,
    sortAt: entry.recorded_at,
    photoCount: photoCount(entry),
  }
}

function loneExit(exit: TimelineMovement): EquipmentVisit {
  return {
    key: `exit:${exit.id}`,
    context: exit.movement_context,
    entry: null,
    exit,
    open: false,
    orphanExit: true,
    startedAt: null,
    endedAt: exit.recorded_at,
    sortAt: exit.recorded_at,
    photoCount: photoCount(exit),
  }
}

/**
 * Groups movements into visits, newest first.
 *
 * - Site and workshop are paired independently, so an open workshop visit
 *   never swallows a site exit.
 * - An ENTRY that follows an unclosed ENTRY in the same context leaves the
 *   earlier one open rather than dropping it; invalid sequences are rejected
 *   in the database, so this only shows what the data actually contains.
 * - An EXIT with no open ENTRY before it (legacy rows) becomes its own
 *   segment instead of being hidden.
 */
export function buildEquipmentVisits(
  movements: readonly TimelineMovement[],
): EquipmentVisit[] {
  const visits: EquipmentVisit[] = []
  const openByContext = new Map<MovementContext, EquipmentVisit>()

  for (const movement of sortMovements(movements)) {
    const context = movement.movement_context
    if (movement.movement_type === 'entry') {
      const visit = openVisit(movement)
      openByContext.set(context, visit)
      visits.push(visit)
      continue
    }
    const pending = openByContext.get(context)
    if (!pending) {
      visits.push(loneExit(movement))
      continue
    }
    pending.exit = movement
    pending.open = false
    pending.endedAt = movement.recorded_at
    pending.sortAt = movement.recorded_at
    pending.photoCount += photoCount(movement)
    openByContext.delete(context)
  }

  // Built oldest-first, so reversing keeps identical timestamps deterministic.
  return visits.reverse()
}

/** Elapsed time of a visit; open visits are measured up to `now`. */
export function visitDurationMs(
  visit: EquipmentVisit,
  now: number = Date.now(),
): number | null {
  if (!visit.startedAt) return null
  const start = instant(visit.startedAt)
  const end = visit.endedAt ? instant(visit.endedAt) : now
  return Math.max(0, end - start)
}

/** Whole days, never rounding a real visit down to zero. */
export function msToDays(ms: number): number {
  if (ms <= 0) return 0
  const days = Math.round(ms / DAY_MS)
  return days === 0 ? 1 : days
}

/** Headline numbers for the summary strip above the timeline. */
export function summarizeVisits(
  visits: readonly EquipmentVisit[],
  now: number = Date.now(),
): VisitSummary {
  let siteMs = 0
  let workshopMs = 0
  let lastMovementAt: string | null = null
  let latestOpen: EquipmentVisit | null = null

  for (const visit of visits) {
    const duration = visitDurationMs(visit, now)
    if (duration !== null) {
      if (visit.context === 'site') siteMs += duration
      else workshopMs += duration
    }
    if (!lastMovementAt || instant(visit.sortAt) > instant(lastMovementAt))
      lastMovementAt = visit.sortAt
    if (
      visit.open &&
      visit.startedAt &&
      (!latestOpen ||
        instant(visit.startedAt) > instant(latestOpen.startedAt ?? ''))
    )
      latestOpen = visit
  }

  const status: EquipmentPresence = !latestOpen
    ? 'outside'
    : latestOpen.context === 'site'
      ? 'inside_site'
      : 'inside_workshop'

  return {
    status,
    visitCount: visits.length,
    siteDays: msToDays(siteMs),
    workshopDays: msToDays(workshopMs),
    lastMovementAt,
  }
}
