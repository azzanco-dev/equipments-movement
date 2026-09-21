/**
 * Shapes and pure helpers for the admin home page (migration 0094).
 *
 * Everything here is free of React and Supabase so the counting and bucketing
 * rules can be unit tested, and so a malformed payload can never reach a
 * component as `any`. The screen calls `src/lib/adminHomeData.ts`, which calls
 * the database functions and hands the raw rows to the parsers below.
 */
import type { ChartBucket } from '@/lib/chartBuckets'
import { saudiDateKey } from '@/lib/saudiTime'
import type { OwnershipStatus } from '@/lib/types'

/** The `ownership_status` values the database check constraint allows. */
export const ADMIN_HOME_OWNERS = [
  'alazani',
  'takween',
  'third_party_f',
  'third_party_partnership_b',
  'external_supplier',
] as const

export type AdminHomeOwner = (typeof ADMIN_HOME_OWNERS)[number]

/** `null` means "every owner"; anything else must be a known owner. */
export function normalizeOwnerFilter(
  value: string | null | undefined,
): AdminHomeOwner | null {
  return ADMIN_HOME_OWNERS.includes(value as AdminHomeOwner)
    ? (value as AdminHomeOwner)
    : null
}

/** Ownership is derived, never stored twice: only Al-Azani is owned. */
export function isOwnedOwner(owner: OwnershipStatus | string): boolean {
  return owner === 'alazani'
}

/** Where one equipment is right now, as migration 0094 classifies it. */
export const FLEET_STATES = [
  'inside_site',
  'workshop_maintenance',
  'workshop_parking',
  'workshop_unclassified',
  'available',
] as const

export type FleetStateId = (typeof FLEET_STATES)[number]

function num(source: unknown, key: string): number {
  if (!source || typeof source !== 'object') return 0
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return 0
  return Math.trunc(value)
}

function text(source: unknown, key: string): string {
  if (!source || typeof source !== 'object') return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function rows(source: unknown, key: string): unknown[] {
  if (!source || typeof source !== 'object') return []
  const value = (source as Record<string, unknown>)[key]
  return Array.isArray(value) ? value : []
}

// --- 1. Fleet state --------------------------------------------------------

/** The four state columns shared by the per-owner and per-type breakdowns. */
export interface FleetStateCounts {
  total: number
  insideSites: number
  inWorkshop: number
  available: number
}

export interface FleetStateGroup extends FleetStateCounts {
  /** `ownership_status` for an owner group, `equipment.type` for a type. */
  key: string
}

export interface FleetState extends FleetStateCounts {
  workshopMaintenance: number
  workshopParking: number
  workshopUnclassified: number
  /** Nested: idle90 ⊆ idle60 ⊆ idle30, and never-moved units are in all. */
  idle30: number
  idle60: number
  idle90: number
  neverMoved: number
  byOwner: FleetStateGroup[]
  byType: FleetStateGroup[]
}

function parseGroups(source: unknown, key: string, idKey: string) {
  return rows(source, key)
    .map((row) => ({
      key: text(row, idKey),
      total: num(row, 'total'),
      insideSites: num(row, 'inside_sites'),
      inWorkshop: num(row, 'in_workshop'),
      available: num(row, 'available'),
    }))
    .filter((row) => row.key !== '')
}

export function parseFleetState(source: unknown): FleetState {
  return {
    total: num(source, 'total'),
    insideSites: num(source, 'inside_sites'),
    inWorkshop: num(source, 'in_workshop'),
    available: num(source, 'available'),
    workshopMaintenance: num(source, 'workshop_maintenance'),
    workshopParking: num(source, 'workshop_parking'),
    workshopUnclassified: num(source, 'workshop_unclassified'),
    idle30: num(source, 'idle_30'),
    idle60: num(source, 'idle_60'),
    idle90: num(source, 'idle_90'),
    neverMoved: num(source, 'never_moved'),
    byOwner: parseGroups(source, 'by_owner', 'owner'),
    byType: parseGroups(source, 'by_type', 'type'),
  }
}

// --- 2. No movement --------------------------------------------------------

export interface NoMovementRow {
  id: string
  code: string
  type: string
  owner: string
  /** `null` for equipment that has never moved at all. */
  lastMovementAt: string | null
  lastMovementType: 'entry' | 'exit' | null
  lastMovementContext: 'site' | 'workshop' | null
  /** Saudi calendar days since the last movement; `null` when never moved. */
  daysSince: number | null
}

function optionalText(source: unknown, key: string): string | null {
  const value = text(source, key)
  return value === '' ? null : value
}

export function parseNoMovementRows(source: unknown): NoMovementRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): NoMovementRow => {
      const days = (row as Record<string, unknown> | null)?.days_since
      const movementType = optionalText(row, 'last_movement_type')
      const movementContext = optionalText(row, 'last_movement_context')
      return {
        id: text(row, 'id'),
        code: text(row, 'code'),
        type: text(row, 'type'),
        owner: text(row, 'ownership_status'),
        lastMovementAt: optionalText(row, 'last_movement_at'),
        lastMovementType:
          movementType === 'entry' || movementType === 'exit'
            ? movementType
            : null,
        lastMovementContext:
          movementContext === 'site' || movementContext === 'workshop'
            ? movementContext
            : null,
        daysSince:
          typeof days === 'number' && Number.isFinite(days) && days >= 0
            ? Math.trunc(days)
            : null,
      }
    })
    .filter((row) => row.id !== '')
}

// --- 3. Availability by type ----------------------------------------------

export interface AvailabilityRow {
  type: string
  all: FleetStateCounts
  owned: FleetStateCounts
  /** Derived, so the owned and rented halves can never drift apart. */
  rented: FleetStateCounts
}

function minusCounts(
  all: FleetStateCounts,
  owned: FleetStateCounts,
): FleetStateCounts {
  return {
    total: Math.max(0, all.total - owned.total),
    insideSites: Math.max(0, all.insideSites - owned.insideSites),
    inWorkshop: Math.max(0, all.inWorkshop - owned.inWorkshop),
    available: Math.max(0, all.available - owned.available),
  }
}

export function parseAvailabilityRows(source: unknown): AvailabilityRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row) => {
      const all: FleetStateCounts = {
        total: num(row, 'total'),
        insideSites: num(row, 'inside_sites'),
        inWorkshop: num(row, 'in_workshop'),
        available: num(row, 'available'),
      }
      const owned: FleetStateCounts = {
        total: num(row, 'owned_total'),
        insideSites: num(row, 'owned_inside_sites'),
        inWorkshop: num(row, 'owned_in_workshop'),
        available: num(row, 'owned_available'),
      }
      return {
        type: text(row, 'type'),
        all,
        owned,
        rented: minusCounts(all, owned),
      }
    })
    .filter((row) => row.type !== '')
}

// --- 4. Entries series -----------------------------------------------------

/** One Saudi calendar day of movement counts. */
export interface DailyMovementCount {
  day: string
  entries: number
  exits: number
}

export function parseDailySeries(source: unknown): DailyMovementCount[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row) => ({
      day: text(row, 'day').slice(0, 10),
      entries: num(row, 'entries'),
      exits: num(row, 'exits'),
    }))
    .filter((row) => row.day.length === 10)
}

export interface SeriesPoint {
  key: string
  entries: number
  exits: number
}

/**
 * Folds daily counts into the chart buckets the client picked (day, week or
 * month). The database always returns days, so switching granularity never
 * costs a request and a bucket clamped to the edge of the period only ever
 * sums the days it actually covers.
 *
 * Days outside every bucket are dropped rather than silently added to the
 * nearest one, and a bucket with no movements is kept at zero so the line
 * chart keeps a continuous x axis.
 */
export function aggregateDailySeries(
  buckets: ChartBucket[],
  daily: DailyMovementCount[],
): SeriesPoint[] {
  // One pass over the buckets, then one pass over the days: a day is matched
  // against the bucket ranges rather than every bucket rescanning every day,
  // so a 400-day period with 400 buckets stays linear.
  const points = buckets.map((bucket) => ({
    key: bucket.key,
    entries: 0,
    exits: 0,
  }))
  // Date keys are ISO, so plain string comparison is calendar order and the
  // buckets (which `buildChartBuckets` emits in order) can be searched.
  const findBucket = (day: string): number => {
    let low = 0
    let high = buckets.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const bucket = buckets[middle]
      if (day < bucket.fromKey) high = middle - 1
      else if (day > bucket.toKey) low = middle + 1
      else return middle
    }
    return -1
  }

  daily.forEach((row) => {
    const position = findBucket(row.day)
    if (position < 0) return
    points[position].entries += row.entries
    points[position].exits += row.exits
  })

  return points
}

// --- 5. Owner x state matrix ----------------------------------------------

export interface OwnerStateMatrix {
  total: number
  /** `count(owner, state)`; missing combinations are 0. */
  count: (owner: string, state: string) => number
  /** Owners that actually have units, in the canonical order. */
  owners: string[]
}

export function parseOwnerStateMatrix(source: unknown): OwnerStateMatrix {
  const cells = new Map<string, number>()
  const owners = new Set<string>()
  rows(source, 'cells').forEach((cell) => {
    const owner = text(cell, 'owner')
    const state = text(cell, 'state')
    if (!owner || !state) return
    owners.add(owner)
    cells.set(`${owner}|${state}`, num(cell, 'count'))
  })
  return {
    total: num(source, 'total'),
    count: (owner, state) => cells.get(`${owner}|${state}`) ?? 0,
    owners: ADMIN_HOME_OWNERS.filter((owner) => owners.has(owner)),
  }
}

// --- 6. Foreman activity ---------------------------------------------------

export interface ForemanActivityRow {
  supervisorId: string
  name: string
  entries: number
  exits: number
  /** Site visits this foreman has open right now, not a period number. */
  openVisits: number
}

export function parseForemanActivity(source: unknown): ForemanActivityRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row) => ({
      supervisorId: text(row, 'supervisor_id'),
      name: text(row, 'foreman_name'),
      entries: num(row, 'entries'),
      exits: num(row, 'exits'),
      openVisits: num(row, 'open_visits'),
    }))
    .filter((row) => row.supervisorId !== '')
}

// --- Period presets --------------------------------------------------------

/**
 * `year` is 1 January of the current Saudi year up to today; `last12` is the
 * 12 months ending today. Both are Saudi calendar date keys, so the chart and
 * the reports start a day at the same instant.
 */
export type AdminHomePeriod = 'year' | 'last12'

export function isAdminHomePeriod(
  value: string | null | undefined,
): value is AdminHomePeriod {
  return value === 'year' || value === 'last12'
}

export function adminHomePeriodKeys(
  period: AdminHomePeriod,
  today: string = saudiDateKey(),
): { from: string; to: string } {
  if (period === 'year')
    return { from: `${today.slice(0, 4)}-01-01`, to: today }
  // 12 months back, inclusive of the current month: the day after the same day
  // one year ago, so the range is never longer than the database's 400-day cap.
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCFullYear(date.getUTCFullYear() - 1)
  date.setUTCDate(date.getUTCDate() + 1)
  return { from: date.toISOString().slice(0, 10), to: today }
}
