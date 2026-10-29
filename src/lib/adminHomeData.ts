/**
 * The only place the admin home talks to PostgreSQL.
 *
 * Every section calls one database function (migrations 0094 / 0095 / 0101 /
 * 0107), or one narrow read of a security_invoker view or table, and gets a
 * parsed, typed result back, so no component ever sees a raw
 * PostgREST row and no raw PostgreSQL error text can reach the interface: each
 * loader throws a plain `Error` and the section renders its own translated
 * failure with a retry.
 *
 * The paginated tables (the fleet mini tables, availability by type) take a
 * page descriptor rather than a limit: pages are 1-based here and in
 * the pagination control, and `pageOffset` is the single place that turns one
 * into the database's 0-based OFFSET.
 */
import { saudiDayEnd, saudiDayStart } from '@/lib/saudiTime'
import { supabase } from '@/lib/supabase'
import {
  fleetEquipmentRpcArgs,
  homeOwnerArgument,
  pageOffset,
  parseAvailabilityPage,
  parseDailySeries,
  parseFleetState,
  parseFleetEquipmentPage,
  parseOwnerStateMatrix,
  parseSupplierSiteCounts,
  parseYearlySeries,
  type AdminHomeOwner,
  type AdminHomePage,
  type AvailabilityRow,
  type DailyMovementCount,
  type FleetEquipmentRow,
  type FleetListState,
  type FleetSortKey,
  type FleetState,
  type OwnerStateMatrix,
  type SupplierSiteCounts,
  type WorkshopPurposeFilter,
  type YearlyMovementCount,
} from '@/lib/adminHomeStats'

/** What a paginated section asks for. `owners` that is `null` or empty means
 *  the three home owners (`homeOwnerArgument`); it never means every owner. */
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
    .rpc('get_admin_fleet_state', { p_owners: homeOwnerArgument(owners) })
    .abortSignal(signal)
  if (error) fail('fleetState', error)
  return parseFleetState(data)
}

/**
 * One page of the active equipment in one fleet state (migration 0107):
 * inside a site, in the workshop (optionally one purpose chip), or available
 * (the latest movement is an exit, or it never moved). The total is the
 * database's `count(*) OVER ()`, so the page count is right even on the last
 * page. `sort` (wave 16, migration 0121) is sent as `p_sort` only when it is
 * an allowlisted, non-default order.
 */
export async function fetchFleetEquipment(
  params: AdminHomePageRequest & {
    state: FleetListState
    /** Only with `workshop`; `all` sends no purpose filter. */
    purpose?: WorkshopPurposeFilter
    /** `null` or absent: the default order (latest movement first). */
    sort?: FleetSortKey | null
  },
  signal: AbortSignal,
): Promise<AdminHomePage<FleetEquipmentRow>> {
  const { data, error } = await supabase
    .rpc('get_admin_fleet_equipment', fleetEquipmentRpcArgs(params))
    .abortSignal(signal)
  if (error) fail('fleetEquipment', error)
  return parseFleetEquipmentPage(data)
}

/**
 * The recorder name of a handful of movements (the foreman of an available
 * unit's last site exit), from `movement_log_search` (security_invoker, so RLS
 * decides). One request limited to the given ids, selecting only id and name.
 * Never throws: a failed lookup returns an empty map and the caller shows "—".
 */
export async function fetchMovementRecorderNames(
  movementIds: ReadonlyArray<string>,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const ids = Array.from(new Set(movementIds.filter(Boolean)))
  if (ids.length === 0) return names
  try {
    const { data, error } = await supabase
      .from('movement_log_search')
      .select('id, supervisor_name')
      .in('id', ids)
      .abortSignal(signal)
    if (error) return names
    for (const row of (data ?? []) as Array<{
      id?: string | null
      supervisor_name?: string | null
    }>) {
      if (row.id && row.supervisor_name) names.set(row.id, row.supervisor_name)
    }
  } catch {
    // The foreman column is secondary; the table must still render.
  }
  return names
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
      p_owners: homeOwnerArgument(params.owners),
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
      p_owners: homeOwnerArgument(owners),
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
      p_owners: homeOwnerArgument(owners),
      p_context: context,
    })
    .abortSignal(signal)
  if (error) fail('entriesYearly', error)
  return parseYearlySeries(data)
}

/** The same snapshot over EVERY owner (`p_owners` NULL), for the owner
 *  totals cards (owner 2026-10-29), not limited to the home's three. */
export async function fetchAllOwnersStateMatrix(
  signal: AbortSignal,
): Promise<OwnerStateMatrix> {
  const { data, error } = await supabase
    .rpc('get_admin_owner_state_matrix', { p_owners: null })
    .abortSignal(signal)
  if (error) fail('ownerStateMatrix', error)
  return parseOwnerStateMatrix(data)
}

/** The suppliers inside projects (migration 0161). */
export async function fetchSupplierSiteCounts(
  signal: AbortSignal,
): Promise<SupplierSiteCounts> {
  const { data, error } = await supabase
    .rpc('get_admin_supplier_site_counts')
    .abortSignal(signal)
  if (error) fail('supplierSiteCounts', error)
  return parseSupplierSiteCounts(data)
}

export async function fetchOwnerStateMatrix(
  owners: AdminHomeOwner[],
  signal: AbortSignal,
): Promise<OwnerStateMatrix> {
  const { data, error } = await supabase
    .rpc('get_admin_owner_state_matrix', {
      p_owners: homeOwnerArgument(owners),
    })
    .abortSignal(signal)
  if (error) fail('ownerStateMatrix', error)
  return parseOwnerStateMatrix(data)
}
