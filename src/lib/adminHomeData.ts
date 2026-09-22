/**
 * The only place the admin home talks to PostgreSQL.
 *
 * Every section calls one database function (migrations 0094 / 0095 / 0101)
 * and gets a parsed, typed result back, so no component ever sees a raw
 * PostgREST row and no raw PostgreSQL error text can reach the interface: each
 * loader throws a plain `Error` and the section renders its own translated
 * failure with a retry.
 *
 * The two paginated tables (equipment that is outside, availability by type)
 * take a page descriptor rather than a limit: pages are 1-based here and in
 * the pagination control, and `pageOffset` is the single place that turns one
 * into the database's 0-based OFFSET.
 */
import { saudiDayEnd, saudiDayStart } from '@/lib/saudiTime'
import { supabase } from '@/lib/supabase'
import {
  ownerFilterArgument,
  pageOffset,
  parseAvailabilityPage,
  parseDailySeries,
  parseFleetState,
  parseForemanRecentMovements,
  parseOutsideEquipmentPage,
  parseOwnerStateMatrix,
  parseYearlySeries,
  type AdminHomeOwner,
  type AdminHomePage,
  type AvailabilityRow,
  type DailyMovementCount,
  type FleetState,
  type ForemanRecentGroup,
  type OutsideEquipmentRow,
  type OwnerStateMatrix,
  type YearlyMovementCount,
} from '@/lib/adminHomeStats'

/** What a paginated section asks for. `owners` is `null` or an empty array for
 *  "every owner", exactly as the database functions read it. */
export interface AdminHomePageRequest {
  owners: string[] | null
  /** 1-based, like the pagination control. */
  page: number
  pageSize: number
}

/** The database caps a search term itself; this only keeps a pathological
 *  value out of the request and turns "nothing typed" into no search. */
function searchArgument(search: string | null | undefined): string | null {
  const term = (search ?? '').trim().slice(0, 80)
  return term === '' ? null : term
}

/**
 * Raw PostgreSQL / PostgREST messages must never reach the user, so the
 * details stay in the console for an admin debugging a page and the caller
 * only learns that the section failed.
 */
function fail(section: string, error: unknown): never {
  // A request cancelled by its own AbortController (filter change, unmount,
  // React's development double-effect) is not a failure worth logging; the
  // hook already ignores the rejection for an aborted signal.
  if (!isAbortError(error)) {
    console.error(`admin home: ${section} failed`, error)
  }
  throw new Error(section)
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    code?: unknown
    message?: unknown
  }
  return (
    candidate.name === 'AbortError' ||
    candidate.code === 20 ||
    candidate.code === '20' ||
    (typeof candidate.message === 'string' &&
      candidate.message.startsWith('AbortError'))
  )
}

export async function fetchFleetState(
  owners: AdminHomeOwner[],
  signal: AbortSignal,
): Promise<FleetState> {
  const { data, error } = await supabase
    .rpc('get_admin_fleet_state', { p_owners: ownerFilterArgument(owners) })
    .abortSignal(signal)
  if (error) fail('fleetState', error)
  return parseFleetState(data)
}

/**
 * One page of the equipment that is outside right now: the latest movement
 * across both contexts is not an ENTRY, or the unit has never moved
 * (migration 0101). The total is the database's `count(*) OVER ()`, so the
 * page count is right even on the last page.
 */
export async function fetchOutsideEquipment(
  params: AdminHomePageRequest,
  signal: AbortSignal,
): Promise<AdminHomePage<OutsideEquipmentRow>> {
  const { data, error } = await supabase
    .rpc('get_admin_outside_equipment', {
      p_owners: ownerFilterArgument(params.owners),
      p_limit: params.pageSize,
      p_offset: pageOffset(params.page, params.pageSize),
    })
    .abortSignal(signal)
  if (error) fail('outsideEquipment', error)
  return parseOutsideEquipmentPage(data)
}

/**
 * One page of the per-type availability. The search is the database's too, so
 * it reaches types that live on pages the browser never downloaded.
 */
export async function fetchAvailabilityByType(
  params: AdminHomePageRequest & { search: string | null },
  signal: AbortSignal,
): Promise<AdminHomePage<AvailabilityRow>> {
  const { data, error } = await supabase
    .rpc('get_admin_availability_by_type', {
      p_owners: ownerFilterArgument(params.owners),
      p_search: searchArgument(params.search),
      p_limit: params.pageSize,
      p_offset: pageOffset(params.page, params.pageSize),
    })
    .abortSignal(signal)
  if (error) fail('availability', error)
  return parseAvailabilityPage(data)
}

export async function fetchEntriesSeries(
  fromKey: string,
  toKey: string,
  owners: AdminHomeOwner[],
  context: 'site' | 'workshop' | null,
  signal: AbortSignal,
): Promise<DailyMovementCount[]> {
  const { data, error } = await supabase
    .rpc('get_admin_entries_series', {
      // Saudi day bounds (UTC+03:00), never the browser's midnight.
      p_from: saudiDayStart(fromKey),
      p_to: saudiDayEnd(toKey),
      p_owners: ownerFilterArgument(owners),
      p_context: context,
    })
    .abortSignal(signal)
  if (error) fail('entriesSeries', error)
  return parseDailySeries(data)
}

/**
 * The سنة view. It is a separate database function rather than a longer daily
 * range because five years of days is far past the 400-day cap
 * `get_admin_entries_series` enforces, and raising that cap would hand every
 * caller an unbounded payload.
 */
export async function fetchEntriesYearly(
  years: number,
  owners: AdminHomeOwner[],
  context: 'site' | 'workshop' | null,
  signal: AbortSignal,
): Promise<YearlyMovementCount[]> {
  const { data, error } = await supabase
    .rpc('get_admin_entries_yearly', {
      p_years: years,
      p_owners: ownerFilterArgument(owners),
      p_context: context,
    })
    .abortSignal(signal)
  if (error) fail('entriesYearly', error)
  return parseYearlySeries(data)
}

export async function fetchOwnerStateMatrix(
  owners: AdminHomeOwner[],
  signal: AbortSignal,
): Promise<OwnerStateMatrix> {
  const { data, error } = await supabase
    .rpc('get_admin_owner_state_matrix', {
      p_owners: ownerFilterArgument(owners),
    })
    .abortSignal(signal)
  if (error) fail('ownerStateMatrix', error)
  return parseOwnerStateMatrix(data)
}

export async function fetchForemanRecentMovements(
  limitPerForeman: number,
  signal: AbortSignal,
): Promise<ForemanRecentGroup[]> {
  const { data, error } = await supabase
    .rpc('get_admin_foreman_recent_movements', {
      p_limit_per_foreman: limitPerForeman,
    })
    .abortSignal(signal)
  if (error) fail('foremanRecent', error)
  return parseForemanRecentMovements(data)
}
