/**
 * Shapes and pure helpers for the admin home page (migrations 0094 / 0095).
 *
 * Everything here is free of React and Supabase so the counting and bucketing
 * rules can be unit tested, and so a malformed payload can never reach a
 * component as `any`. The screen calls `src/lib/adminHomeData.ts`, which calls
 * the database functions and hands the raw rows to the parsers below.
 */
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  parseDateKey,
} from '@/lib/calendar'
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

function isAdminHomeOwner(value: string): value is AdminHomeOwner {
  return (ADMIN_HOME_OWNERS as readonly string[]).includes(value)
}

/**
 * Reads the `?owners=a,b` filter.
 *
 * An empty result means "every owner", exactly as it does in the database
 * functions, so an unknown or hand-edited value degrades to the unfiltered
 * page instead of an error. Duplicates are dropped and the result is put back
 * into the canonical `ADMIN_HOME_OWNERS` order, so the same selection always
 * produces the same URL and the same request signature.
 */
export function normalizeOwnerFilters(
  value: string | string[] | null | undefined,
): AdminHomeOwner[] {
  const parts = Array.isArray(value) ? value : (value ?? '').split(',')
  const chosen = new Set(
    parts.map((part) => part.trim()).filter((part) => isAdminHomeOwner(part)),
  )
  return ADMIN_HOME_OWNERS.filter((owner) => chosen.has(owner))
}

/** The URL value for a selection; `null` clears the parameter entirely. */
export function serializeOwnerFilters(owners: AdminHomeOwner[]): string | null {
  const normalized = normalizeOwnerFilters(owners)
  return normalized.length ? normalized.join(',') : null
}

/**
 * The argument the database functions take: `null` for "every owner", never
 * an empty array, so the two representations can never diverge.
 */
export function ownerFilterArgument(
  owners: AdminHomeOwner[],
): AdminHomeOwner[] | null {
  return owners.length ? owners : null
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

function movementType(source: unknown, key: string): 'entry' | 'exit' | null {
  const value = optionalText(source, key)
  return value === 'entry' || value === 'exit' ? value : null
}

function movementContext(
  source: unknown,
  key: string,
): 'site' | 'workshop' | null {
  const value = optionalText(source, key)
  return value === 'site' || value === 'workshop' ? value : null
}

export function parseNoMovementRows(source: unknown): NoMovementRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): NoMovementRow => {
      const days = (row as Record<string, unknown> | null)?.days_since
      return {
        id: text(row, 'id'),
        code: text(row, 'code'),
        type: text(row, 'type'),
        owner: text(row, 'ownership_status'),
        lastMovementAt: optionalText(row, 'last_movement_at'),
        lastMovementType: movementType(row, 'last_movement_type'),
        lastMovementContext: movementContext(row, 'last_movement_context'),
        daysSince:
          typeof days === 'number' && Number.isFinite(days) && days >= 0
            ? Math.trunc(days)
            : null,
      }
    })
    .filter((row) => row.id !== '')
}

// --- 3. Availability by type ----------------------------------------------

/**
 * One equipment type's current availability.
 *
 * The owned / rented split migration 0094 returned is gone (owner request,
 * 2026-09-22): the multi-select owner filter above the page answers that
 * question directly, so the sub-lines were removing room from the numbers that
 * matter without adding anything the filter cannot say.
 */
export interface AvailabilityRow extends FleetStateCounts {
  type: string
}

export function parseAvailabilityRows(source: unknown): AvailabilityRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row) => ({
      type: text(row, 'type'),
      insideSites: num(row, 'inside_sites'),
      inWorkshop: num(row, 'in_workshop'),
      available: num(row, 'available'),
      total: num(row, 'total'),
    }))
    .filter((row) => row.type !== '')
}

/** How many types the section shows before "عرض الكل" is used. */
export const AVAILABILITY_TOP_TYPES = 10

/**
 * The rows the availability table renders.
 *
 * A search always looks at every type the database returned, so a type outside
 * the top ten is still findable by name; without a search the list is capped at
 * the top ten until the caller expands it. The database already ordered the
 * rows by total, so "top ten" is a slice and never a re-sort in the browser.
 */
export function visibleAvailabilityRows(
  all: AvailabilityRow[],
  query: string,
  expanded: boolean,
): AvailabilityRow[] {
  const needle = query.trim().toLowerCase()
  if (needle)
    return all.filter((row) => row.type.toLowerCase().includes(needle))
  return expanded ? all : all.slice(0, AVAILABILITY_TOP_TYPES)
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

/** One Saudi calendar year of movement counts (migration 0095). */
export interface YearlyMovementCount {
  year: number
  entries: number
  exits: number
}

export function parseYearlySeries(source: unknown): YearlyMovementCount[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row) => ({
      year: num(row, 'year'),
      entries: num(row, 'entries'),
      exits: num(row, 'exits'),
    }))
    .filter((row) => row.year > 0)
    .sort((a, b) => a.year - b.year)
}

export interface SeriesPoint {
  key: string
  entries: number
  exits: number
}

/**
 * Folds daily counts into the chart buckets the client picked (day or month).
 * The database always returns days, so switching granularity never costs a
 * request and a bucket clamped to the edge of the period only ever sums the
 * days it actually covers.
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

/**
 * Fills the yearly view's x axis.
 *
 * The database only returns years that actually have movements, so a gap year
 * in the middle would otherwise disappear and make the line lie about the
 * distance between two points. The axis starts at the earliest year that has
 * data (capped at `maxYears` back) and always ends at the current Saudi year,
 * so "as far back as data exists" never stretches past the requested window
 * and the current year is always the last point even before it has movements.
 */
export function buildYearlySeries(
  yearly: YearlyMovementCount[],
  maxYears: number,
  today: string = saudiDateKey(),
): SeriesPoint[] {
  const currentYear = parseDateKey(today)?.year ?? new Date().getUTCFullYear()
  const span = Math.max(1, Math.trunc(maxYears))
  const floor = currentYear - span + 1
  const withData = yearly.filter(
    (row) => row.year >= floor && row.year <= currentYear,
  )
  const first = withData.length
    ? Math.min(...withData.map((row) => row.year))
    : currentYear
  const counts = new Map(withData.map((row) => [row.year, row]))
  const points: SeriesPoint[] = []
  for (let year = first; year <= currentYear; year += 1) {
    const row = counts.get(year)
    points.push({
      key: String(year),
      entries: row?.entries ?? 0,
      exits: row?.exits ?? 0,
    })
  }
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

// --- 6. Foreman recent movements ------------------------------------------

export interface ForemanMovement {
  id: string
  equipmentId: string
  equipmentCode: string
  type: 'entry' | 'exit' | null
  context: 'site' | 'workshop' | null
  recordedAt: string | null
}

export interface ForemanRecentGroup {
  supervisorId: string
  name: string
  /** Every movement this foreman ever recorded, not only the ones listed. */
  totalMovements: number
  /** Newest first, capped by the database at `p_limit_per_foreman`. */
  movements: ForemanMovement[]
}

/**
 * Groups the flat rows of `get_admin_foreman_recent_movements` into one entry
 * per foreman.
 *
 * The database already ordered the rows (busiest foreman first, then newest
 * movement first inside each foreman), so the grouping preserves insertion
 * order and never re-sorts: two foremen with the same total keep the
 * deterministic order the database gave them.
 */
export function parseForemanRecentMovements(
  source: unknown,
): ForemanRecentGroup[] {
  if (!Array.isArray(source)) return []
  // The array is built alongside the index rather than spread out of it at the
  // end, so the order is the database's insertion order by construction.
  const order: ForemanRecentGroup[] = []
  const groups = new Map<string, ForemanRecentGroup>()
  source.forEach((row) => {
    const supervisorId = text(row, 'supervisor_id')
    const id = text(row, 'movement_id')
    if (!supervisorId) return
    let group = groups.get(supervisorId)
    if (!group) {
      group = {
        supervisorId,
        name: text(row, 'foreman_name'),
        totalMovements: num(row, 'total_movements'),
        movements: [],
      }
      groups.set(supervisorId, group)
      order.push(group)
    }
    if (!id) return
    group.movements.push({
      id,
      equipmentId: text(row, 'equipment_id'),
      equipmentCode: text(row, 'equipment_code'),
      type: movementType(row, 'movement_type'),
      context: movementContext(row, 'movement_context'),
      recordedAt: optionalText(row, 'recorded_at'),
    })
  })
  return order
}

// --- Chart granularity -----------------------------------------------------

/**
 * The entries chart's granularity (owner request, 2026-09-22): يوم shows the
 * last 30 days day by day, شهر the last 12 months month by month, and سنة the
 * last 5 years year by year.
 */
export const ADMIN_HOME_GRANULARITIES = ['day', 'month', 'year'] as const
export type AdminHomeGranularity = (typeof ADMIN_HOME_GRANULARITIES)[number]

/** Days shown by the يوم view. */
export const GRANULARITY_DAYS = 30
/** Months shown by the شهر view, including the current one. */
export const GRANULARITY_MONTHS = 12
/** Years the سنة view asks for; fewer are drawn when data starts later. */
export const GRANULARITY_YEARS = 5

/** Fails closed on an unknown value: an edited URL falls back to the month
 *  view rather than asking the database for something it would reject. */
export function normalizeGranularity(
  value: string | null | undefined,
): AdminHomeGranularity {
  return (ADMIN_HOME_GRANULARITIES as readonly string[]).includes(value ?? '')
    ? (value as AdminHomeGranularity)
    : 'month'
}

/**
 * The Saudi date range the daily series is requested for.
 *
 * Only the يوم and شهر views use it; سنة has its own database function because
 * five years of days is past the 400-day cap `get_admin_entries_series`
 * enforces. Both ranges below stay comfortably inside that cap: 30 days, and
 * at most 366 days for twelve whole months.
 */
export function adminHomeFlowRange(
  granularity: Exclude<AdminHomeGranularity, 'year'>,
  today: string = saudiDateKey(),
): { from: string; to: string } {
  if (granularity === 'day')
    return {
      from: addDaysToDateKey(today, -(GRANULARITY_DAYS - 1)) ?? today,
      to: today,
    }
  // The first day of the month GRANULARITY_MONTHS - 1 back, so the chart shows
  // twelve whole months ending with the current (partial) one.
  const firstOfThisMonth = `${today.slice(0, 7)}-01`
  return {
    from:
      addMonthsToDateKey(firstOfThisMonth, -(GRANULARITY_MONTHS - 1)) ??
      firstOfThisMonth,
    to: today,
  }
}
