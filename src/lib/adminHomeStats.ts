/**
 * Shapes and pure helpers for the admin home page (migrations 0094 / 0095 /
 * 0101 / 0107).
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
import { exitPurposeOrNull, type ExitPurpose } from '@/lib/exitPurpose'
import type { OwnershipStatus } from '@/lib/types'

/** Every `ownership_status` value the database check constraint allows. The
 *  reports and `/logs` keep all five; only the admin home narrows them. */
export const ALL_OWNERS = [
  'alazani',
  'takween',
  'third_party_f',
  'third_party_partnership_b',
  'external_supplier',
] as const

export type AdminHomeOwner = (typeof ALL_OWNERS)[number]

/**
 * The owners the admin home knows about (owner decision, 2026-09-29, EM-199):
 * Takween and external suppliers are removed from the home entirely, from the
 * data of every section as well as from the filter. This is the option list of
 * the home's owner filter and the only set the home ever asks the database for.
 */
export const ADMIN_HOME_OWNERS: readonly AdminHomeOwner[] = [
  'alazani',
  'third_party_f',
  'third_party_partnership_b',
]

/**
 * The owners every admin-home section starts on (owner request, 2026-09-30):
 * Al-Azani only. The filter still offers the three home owners, and clearing
 * the selection still means all three (`homeOwnerArgument`), so "the default"
 * and "an empty selection" are now deliberately different.
 */
export const DEFAULT_HOME_OWNERS: AdminHomeOwner[] = ['alazani']

function isKnownOwner(value: string): value is AdminHomeOwner {
  return (ALL_OWNERS as readonly string[]).includes(value)
}

function isAdminHomeOwner(value: string): value is AdminHomeOwner {
  return ADMIN_HOME_OWNERS.includes(value as AdminHomeOwner)
}

function ownerParts(value: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(value) ? value : (value ?? '').split(',')
  return parts.map((part) => part.trim())
}

/**
 * Normalizes an owner selection across all five classifications (the report
 * screens' filter).
 *
 * An empty result means "every owner", exactly as it does in the database
 * functions, so an unknown value degrades to the unfiltered section instead of
 * an error. Duplicates are dropped and the result is put back into the
 * canonical `ALL_OWNERS` order, so the same selection always produces the same
 * request signature whatever order the boxes were ticked in.
 */
export function normalizeOwnerFilters(
  value: string | string[] | null | undefined,
): AdminHomeOwner[] {
  const chosen = new Set(ownerParts(value).filter(isKnownOwner))
  return ALL_OWNERS.filter((owner) => chosen.has(owner))
}

/**
 * The admin home's normalizer: like `normalizeOwnerFilters`, but a value
 * outside the home's three owners (Takween, external supplier, anything
 * unknown) is dropped. An empty result means "the three", never "every owner".
 */
export function normalizeHomeOwnerFilters(
  value: string | string[] | null | undefined,
): AdminHomeOwner[] {
  const chosen = new Set(ownerParts(value).filter(isAdminHomeOwner))
  return ADMIN_HOME_OWNERS.filter((owner) => chosen.has(owner))
}

/**
 * The argument the report functions take: `null` for "every owner", never an
 * empty array, so the two representations can never diverge.
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

/**
 * The `p_owners` argument of every admin-home function. It is never `null` and
 * never empty: an empty selection (or one of only Takween / unknown values)
 * maps to the three home owners, so the database never aggregates the other
 * two.
 */
export function homeOwnerArgument(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): AdminHomeOwner[] {
  const normalized = normalizeHomeOwnerFilters(owners as string[])
  return normalized.length ? normalized : [...ADMIN_HOME_OWNERS]
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

/**
 * Every card of the "الحالة الان" section, in the order it is drawn (owner
 * request, 2026-09-30). These are the ids a card click reports through
 * `FleetStateSection`'s `onSelectState`, and `fleetJumpTarget` maps each one
 * to the mini table (and workshop chip) the card scrolls to: the three
 * workshop purposes are the `FLEET_STATES` values, and `workshop` is their
 * union.
 */
export const FLEET_DRILL_STATES = [
  'total',
  'inside_site',
  'workshop',
  'available',
  'workshop_maintenance',
  'workshop_parking',
  'workshop_unclassified',
] as const

export type FleetDrillState = (typeof FLEET_DRILL_STATES)[number]

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

// --- 2. The fleet mini tables (migration 0107) -----------------------------

/** Rows a mini table shows before "عرض الكل" (owner-approved design,
 *  2026-09-30). */
export const FLEET_MINI_ROWS = 7

/** The `p_state` values `get_admin_fleet_equipment` accepts. */
export const FLEET_LIST_STATES = [
  'inside_site',
  'workshop',
  'available',
] as const
export type FleetListState = (typeof FLEET_LIST_STATES)[number]

/** The chips of the "داخل الورشة" mini table, in drawing order. `all` is no
 *  purpose filter; the other three are `p_purpose`. */
export const WORKSHOP_PURPOSE_FILTERS = [
  'all',
  'maintenance',
  'parking',
  'unclassified',
] as const
export type WorkshopPurposeFilter = (typeof WORKSHOP_PURPOSE_FILTERS)[number]

/** Fails closed on an unknown chip value: it reads as "all". */
export function normalizeWorkshopPurposeFilter(
  value: string | null | undefined,
): WorkshopPurposeFilter {
  return (WORKSHOP_PURPOSE_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as WorkshopPurposeFilter)
    : 'all'
}

/** The `p_purpose` argument for a chip: `null` for "all", never the string. */
export function workshopPurposeArgument(
  filter: WorkshopPurposeFilter,
): Exclude<WorkshopPurposeFilter, 'all'> | null {
  return filter === 'all' ? null : filter
}

/** The five mini tables, in drawing order. */
export const FLEET_MINI_TABLES = [
  'inside',
  'workshop',
  'available',
  'entries',
  'added',
] as const
export type FleetMiniTableId = (typeof FLEET_MINI_TABLES)[number]

/** The DOM id of a mini table, which the state cards point at with
 *  `aria-controls` and scroll to. */
export function fleetMiniTableDomId(table: FleetMiniTableId): string {
  return `admin-home-fleet-${table}`
}

export interface FleetJumpTarget {
  table: FleetMiniTableId
  /** Only for the workshop table: the chip the jump selects. */
  purpose?: WorkshopPurposeFilter
}

/**
 * Where a state card jumps (owner-approved design, 2026-09-30): each card
 * scrolls to the mini table that lists its units, and the four workshop cards
 * also pick the matching chip. The total has no single state, so it jumps to
 * the latest added equipment.
 */
export function fleetJumpTarget(state: FleetDrillState): FleetJumpTarget {
  switch (state) {
    case 'inside_site':
      return { table: 'inside' }
    case 'workshop':
      return { table: 'workshop', purpose: 'all' }
    case 'workshop_maintenance':
      return { table: 'workshop', purpose: 'maintenance' }
    case 'workshop_parking':
      return { table: 'workshop', purpose: 'parking' }
    case 'workshop_unclassified':
      return { table: 'workshop', purpose: 'unclassified' }
    case 'available':
      return { table: 'available' }
    default:
      return { table: 'added' }
  }
}

/**
 * One unit of `get_admin_fleet_equipment` (migration 0107).
 *
 * `since` is the time of the latest movement across both contexts: the entry
 * that took a unit into a site or the workshop, or the exit that made it
 * available. It is `null` for a unit that has never moved, which only the
 * available table can contain.
 */
export interface FleetEquipmentRow {
  id: string
  code: string
  type: string
  owner: string
  state: FleetStateId | null
  since: string | null
  lastMovementId: string | null
  lastMovementType: 'entry' | 'exit' | null
  lastMovementContext: 'site' | 'workshop' | null
  /** The workshop entry's purpose; `null` when unclassified or not in the
   *  workshop. */
  workshopPurpose: 'maintenance' | 'parking' | null
  companyNameAr: string | null
  companyNameEn: string | null
  projectNameAr: string | null
  projectNameEn: string | null
  /**
   * The purpose of the latest movement when it is a site exit
   * (`last_exit_purpose`, migration 0118): why an available unit left its
   * project. `null` for every other row, a workshop exit and an exit recorded
   * before migration 0111.
   */
  exitPurpose: ExitPurpose | null
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

function fleetStateId(source: unknown, key: string): FleetStateId | null {
  const value = optionalText(source, key)
  return (FLEET_STATES as readonly string[]).includes(value ?? '')
    ? (value as FleetStateId)
    : null
}

function workshopPurpose(
  source: unknown,
  key: string,
): 'maintenance' | 'parking' | null {
  const value = optionalText(source, key)
  return value === 'maintenance' || value === 'parking' ? value : null
}

export function parseFleetEquipmentRows(source: unknown): FleetEquipmentRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): FleetEquipmentRow => ({
      id: text(row, 'id'),
      code: text(row, 'code'),
      type: text(row, 'type'),
      owner: text(row, 'ownership_status'),
      state: fleetStateId(row, 'state'),
      since: optionalText(row, 'since'),
      lastMovementId: optionalText(row, 'last_movement_id'),
      lastMovementType: movementType(row, 'last_movement_type'),
      lastMovementContext: movementContext(row, 'last_movement_context'),
      workshopPurpose: workshopPurpose(row, 'workshop_purpose'),
      companyNameAr: optionalText(row, 'company_name_ar'),
      companyNameEn: optionalText(row, 'company_name_en'),
      projectNameAr: optionalText(row, 'project_name_ar'),
      projectNameEn: optionalText(row, 'project_name_en'),
      // An unknown value is dropped rather than rendered as a badge.
      exitPurpose: exitPurposeOrNull(optionalText(row, 'last_exit_purpose')),
    }))
    .filter((row) => row.id !== '')
}

/** One page of a fleet state table, with the size of the whole filtered set
 *  the database counted (`count(*) OVER ()`). */
export function parseFleetEquipmentPage(
  source: unknown,
): AdminHomePage<FleetEquipmentRow> {
  return {
    rows: parseFleetEquipmentRows(source),
    total: parseTotalCount(source),
  }
}

/**
 * One row of "اخر الدخوليات": an ENTRY movement from `movement_log_search`,
 * in either context. The company is `null` for a workshop entry, which the
 * table shows as «ورشة».
 */
export interface LatestEntryRow {
  id: string
  equipmentId: string
  equipmentCode: string
  equipmentType: string
  owner: string
  context: 'site' | 'workshop' | null
  companyNameAr: string | null
  companyNameEn: string | null
  projectNameAr: string | null
  projectNameEn: string | null
  /** The foreman who recorded it (`profile_names`, migration 0099). */
  foreman: string | null
  recordedAt: string | null
}

export function parseLatestEntryRows(source: unknown): LatestEntryRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): LatestEntryRow => ({
      id: text(row, 'id'),
      equipmentId: text(row, 'equipment_id'),
      equipmentCode: text(row, 'equipment_code'),
      equipmentType: text(row, 'equipment_type'),
      owner: text(row, 'equipment_ownership_status'),
      context: movementContext(row, 'movement_context'),
      companyNameAr: optionalText(row, 'company_name_ar'),
      companyNameEn: optionalText(row, 'company_name_en'),
      projectNameAr: optionalText(row, 'project_name_ar'),
      projectNameEn: optionalText(row, 'project_name_en'),
      foreman: optionalText(row, 'supervisor_name'),
      recordedAt: optionalText(row, 'recorded_at'),
    }))
    .filter((row) => row.id !== '')
}

/** One row of "اخر المعدات المضافة", read from `equipment` directly. */
export interface LatestEquipmentRow {
  id: string
  code: string
  type: string
  owner: string
  createdAt: string | null
}

export function parseLatestEquipmentRows(
  source: unknown,
): LatestEquipmentRow[] {
  if (!Array.isArray(source)) return []
  return source
    .map((row): LatestEquipmentRow => ({
      id: text(row, 'id'),
      code: text(row, 'code'),
      type: text(row, 'type'),
      owner: text(row, 'ownership_status'),
      createdAt: optionalText(row, 'created_at'),
    }))
    .filter((row) => row.id !== '')
}

/**
 * The total behind a page read with PostgREST's `count: 'exact'`. A 7-row
 * mini table does not ask for a count (it has no pagination), so a missing
 * count falls back to the rows actually returned rather than to zero.
 */
export function pageTotal(
  count: number | null | undefined,
  rows: number,
): number {
  return typeof count === 'number' && Number.isFinite(count) && count >= 0
    ? Math.trunc(count)
    : rows
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
