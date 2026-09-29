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
  homeOwnerArgument,
  pageOffset,
  parseAvailabilityPage,
  parseDailySeries,
  parseFleetState,
  pageTotal,
  parseFleetEquipmentPage,
  parseForemanRecentMovements,
  parseLatestEntryRows,
  parseLatestEquipmentRows,
  parseOwnerStateMatrix,
  parseYearlySeries,
  type AdminHomeOwner,
  type AdminHomePage,
  type AvailabilityRow,
  type DailyMovementCount,
  type FleetEquipmentRow,
  type FleetListState,
  type FleetState,
  type ForemanRecentGroup,
  type LatestEntryRow,
  type LatestEquipmentRow,
  type OwnerStateMatrix,
  type WorkshopPurposeFilter,
  type YearlyMovementCount,
  workshopPurposeArgument,
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
 * page.
 */
export async function fetchFleetEquipment(
  params: AdminHomePageRequest & {
    state: FleetListState
    /** Only with `workshop`; `all` sends no purpose filter. */
    purpose?: WorkshopPurposeFilter
  },
  signal: AbortSignal,
): Promise<AdminHomePage<FleetEquipmentRow>> {
  const { data, error } = await supabase
    .rpc('get_admin_fleet_equipment', {
      p_state: params.state,
      p_owners: homeOwnerArgument(params.owners),
      p_purpose:
        params.state === 'workshop'
          ? workshopPurposeArgument(params.purpose ?? 'all')
          : null,
      p_limit: params.pageSize,
      p_offset: pageOffset(params.page, params.pageSize),
    })
    .abortSignal(signal)
  if (error) fail('fleetEquipment', error)
  return parseFleetEquipmentPage(data)
}

/** A mini table's page request; `count` asks PostgREST for the exact total,
 *  which only the expanded, paginated form needs. */
export interface AdminHomeListRequest extends AdminHomePageRequest {
  count: boolean
}

/** Page bounds for PostgREST's inclusive `range`. */
function pageRange(page: number, pageSize: number): [number, number] {
  const size = Math.max(1, Math.min(500, Math.trunc(pageSize) || 1))
  const from = pageOffset(page, size)
  return [from, from + size - 1]
}

/**
 * "اخر الدخوليات": the latest ENTRY movements in both contexts, newest first.
 *
 * Read from `movement_log_search` directly: it is security_invoker, so
 * `entry_exit_logs` RLS decides what is returned (admin and monitor read every
 * movement), and the order is the movement log's deterministic
 * `(recorded_at DESC, id DESC)`. The owner filter is the equipment owner the
 * view already carries.
 */
export async function fetchLatestEntries(
  params: AdminHomeListRequest,
  signal: AbortSignal,
): Promise<AdminHomePage<LatestEntryRow>> {
  const [from, to] = pageRange(params.page, params.pageSize)
  const { data, error, count } = await supabase
    .from('movement_log_search')
    .select(
      'id, equipment_id, equipment_code, equipment_type, equipment_ownership_status, movement_context, company_name_ar, company_name_en, project_name_ar, project_name_en, supervisor_name, recorded_at',
      params.count ? { count: 'exact' } : undefined,
    )
    .eq('movement_type', 'entry')
    .in('equipment_ownership_status', homeOwnerArgument(params.owners))
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
    .abortSignal(signal)
  if (error) fail('latestEntries', error)
  const rows = parseLatestEntryRows(data)
  return { rows, total: pageTotal(count, rows.length) }
}

/**
 * "اخر المعدات المضافة": the latest active equipment by `created_at`, read
 * from `equipment` directly (RLS applies). "Active" is the fleet predicate
 * every card counts with (`is_active AND status = 'active'`), so the total
 * card that jumps here and this list agree.
 */
export async function fetchLatestEquipment(
  params: AdminHomeListRequest,
  signal: AbortSignal,
): Promise<AdminHomePage<LatestEquipmentRow>> {
  const [from, to] = pageRange(params.page, params.pageSize)
  const { data, error, count } = await supabase
    .from('equipment')
    .select(
      'id, code, type, ownership_status, created_at',
      params.count ? { count: 'exact' } : undefined,
    )
    .eq('is_active', true)
    .eq('status', 'active')
    .in('ownership_status', homeOwnerArgument(params.owners))
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
    .abortSignal(signal)
  if (error) fail('latestEquipment', error)
  const rows = parseLatestEquipmentRows(data)
  return { rows, total: pageTotal(count, rows.length) }
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
