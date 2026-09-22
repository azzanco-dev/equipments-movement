/**
 * Shapes and pure helpers for the admin home page (migrations 0094 / 0095 /
 * 0101).
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
 * Normalizes an owner selection.
 *
 * An empty result means "every owner", exactly as it does in the database
 * functions, so an unknown value degrades to the unfiltered section instead of
 * an error. Duplicates are dropped and the result is put back into the
 * canonical `ADMIN_HOME_OWNERS` order, so the same selection always produces
 * the same request signature whatever order the boxes were ticked in.
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

/**
 * The argument the database functions take: `null` for "every owner", never
 * an empty array, so the two representations can never diverge.
 *
 * Unknown values are dropped rather than sent to a function that would reject
 * the whole request, and a selection that contained nothing but unknown values
 * therefore degrades to "every owner" — the same fail-safe the filter itself
 * applies. `null` in means "every owner" in.
 */
export function ownerFilterArgument(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): AdminHomeOwner[] | null {
  if (!owners || owners.length === 0) return null
  const normalized = normalizeOwnerFilters(owners as string[])
  return normalized.length ? normalized : null
}

// --- Server-side pagination ------------------------------------------------

/** Rows per page for the admin home's paginated tables (owner request,
 *  2026-09-22). It is the shared list system's default page size. */
export const ADMIN_HOME_PAGE_SIZE = 20

/**
 * The `OFFSET` for a 1-based page.
 *
 * Pages are 1-based everywhere in the interface (the pagination control shows
 * "1 / 4") and 0-based in SQL, so the conversion lives in exactly one place. A
 * page below 1 — a stale state after a filter change, a hand-edited value —
 * reads as the first page instead of a negative offset the database would
 * clamp silently.
 */
export function pageOffset(page: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const safePage = Math.max(1, Math.trunc(page) || 1)
  return (safePage - 1) * size
}

/** How many pages a total spans; always at least one, so an empty table still
 *  reads "1 / 1" rather than "1 / 0". */
export function pageCount(total: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const count = Math.max(0, Math.trunc(total) || 0)
  return Math.max(1, Math.ceil(count / size))
}

/**
 * Keeps the requested page inside the result.
 *
 * Deleting the last rows of the last page, or narrowing a filter while a later
 * page is open, would otherwise leave the table on a page the database has no
 * rows for, which reads as "there is nothing here".
 */
export function clampPage(
  page: number,
  total: number,
  pageSize: number,
): number {
  return Math.min(
    Math.max(1, Math.trunc(page) || 1),
    pageCount(total, pageSize),
  )
}

/**
 * One page of rows plus the size of the whole filtered set.
 *
 * `total` comes from the database (`count(*) OVER ()`, repeated on every row),
 * never from `rows.length`, so the page count is right on every page.
 */
export interface AdminHomePage<T> {
  rows: T[]
  total: number
}

/**
 * Reads `total_count` out of a paginated payload.
 *
 * Every row carries the same value, so the first row is enough; an empty page
 * legitimately has no row to read it from and is a total of zero.
 */
export function parseTotalCount(source: unknown): number {
  if (!Array.isArray(source) || source.length === 0) return 0
  return num(source[0], 'total_count')
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

/**
 * The fleet's state right now.
 *
 * The idle_30 / idle_60 / idle_90 / never_moved members `get_admin_fleet_state`
 * still returns are deliberately not parsed (owner review, 2026-09-22): a long
 * idle time is normal for this fleet, so the page no longer shows ages
 * anywhere. Leaving them unparsed rather than dropping them from the database
 * function keeps that a UI decision, reversible without a migration.
 */
export interface FleetState extends FleetStateCounts {
  workshopMaintenance: number
  workshopParking: number
  workshopUnclassified: number
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
    byOwner: parseGroups(source, 'by_owner', 'owner'),
    byType: parseGroups(source, 'by_type', 'type'),
  }
}

// --- 2. Equipment that is outside right now --------------------------------

/**
 * One unit that is outside right now (migration 0101).
 *
 * "Outside" is the `available` state of `admin_equipment_state`: the latest
 * movement across both contexts is not an ENTRY, or there is no movement at
 * all. Owner review (2026-09-22): the idle-days threshold and the days column
 * are gone, because a long idle time is normal here and says nothing on its
 * own — what the exit date answers is "since when".
 */
export interface OutsideEquipmentRow {
  id: string
  code: string
  type: string
  owner: string
  /** `null` for equipment that has never moved at all. */
  lastMovementAt: string | null
  lastMovementType: 'entry' | 'exit' | null
  lastMovementContext: 'site' | 'workshop' | null
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

export function parseOutsideEquipmentRows(
  source: unknown,
): OutsideEquipmentRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): OutsideEquipmentRow => ({
      id: text(row, 'id'),
      code: text(row, 'code'),
      type: text(row, 'type'),
      owner: text(row, 'ownership_status'),
      lastMovementAt: optionalText(row, 'last_movement_at'),
      lastMovementType: movementType(row, 'last_movement_type'),
      lastMovementContext: movementContext(row, 'last_movement_context'),
    }))
    .filter((row) => row.id !== '')
}

/** One page of the outside-equipment table, with the size of the whole
 *  filtered set the database counted. */
export function parseOutsideEquipmentPage(
  source: unknown,
): AdminHomePage<OutsideEquipmentRow> {
  return {
    rows: parseOutsideEquipmentRows(source),
    total: parseTotalCount(source),
  }
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

/**
 * One page of the availability table.
 *
 * Owner review (2026-09-22): the "top 10 / عرض الكل" slice is gone. Paging and
 * the type search are the database's (migration 0101), so the browser never
 * holds every type to filter or re-sort it, and a search reaches types on
 * pages that were never downloaded.
 */
export function parseAvailabilityPage(
  source: unknown,
): AdminHomePage<AvailabilityRow> {
  return {
    rows: parseAvailabilityRows(source),
    total: parseTotalCount(source),
  }
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
