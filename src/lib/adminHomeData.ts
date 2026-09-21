/**
 * The only place the admin home talks to PostgreSQL.
 *
 * Every section calls one database function from migration 0094 and gets a
 * parsed, typed result back, so no component ever sees a raw PostgREST row and
 * no raw PostgreSQL error text can reach the interface: each loader throws a
 * plain `Error` and the section renders its own translated failure with a
 * retry.
 */
import { saudiDayEnd, saudiDayStart } from '@/lib/saudiTime'
import { supabase } from '@/lib/supabase'
import {
  parseAvailabilityRows,
  parseDailySeries,
  parseFleetState,
  parseForemanActivity,
  parseNoMovementRows,
  parseOwnerStateMatrix,
  type AdminHomeOwner,
  type AvailabilityRow,
  type DailyMovementCount,
  type FleetState,
  type ForemanActivityRow,
  type NoMovementRow,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'

/**
 * Raw PostgreSQL / PostgREST messages must never reach the user, so the
 * details stay in the console for an admin debugging a page and the caller
 * only learns that the section failed.
 */
function fail(section: string, error: unknown): never {
  console.error(`admin home: ${section} failed`, error)
  throw new Error(section)
}

export async function fetchFleetState(
  owner: AdminHomeOwner | null,
  signal: AbortSignal,
): Promise<FleetState> {
  const { data, error } = await supabase
    .rpc('get_admin_fleet_state', { p_owner: owner })
    .abortSignal(signal)
  if (error) fail('fleetState', error)
  return parseFleetState(data)
}

export async function fetchNoMovementEquipment(
  owner: AdminHomeOwner | null,
  days: number,
  limit: number,
  signal: AbortSignal,
): Promise<NoMovementRow[]> {
  const { data, error } = await supabase
    .rpc('get_admin_no_movement_equipment', {
      p_owner: owner,
      p_days: days,
      p_limit: limit,
    })
    .abortSignal(signal)
  if (error) fail('noMovement', error)
  return parseNoMovementRows(data)
}

export async function fetchAvailabilityByType(
  owner: AdminHomeOwner | null,
  signal: AbortSignal,
): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .rpc('get_admin_availability_by_type', { p_owner: owner })
    .abortSignal(signal)
  if (error) fail('availability', error)
  return parseAvailabilityRows(data)
}

export async function fetchEntriesSeries(
  fromKey: string,
  toKey: string,
  owner: AdminHomeOwner | null,
  context: 'site' | 'workshop' | null,
  signal: AbortSignal,
): Promise<DailyMovementCount[]> {
  const { data, error } = await supabase
    .rpc('get_admin_entries_series', {
      // Saudi day bounds (UTC+03:00), never the browser's midnight.
      p_from: saudiDayStart(fromKey),
      p_to: saudiDayEnd(toKey),
      p_owner: owner,
      p_context: context,
    })
    .abortSignal(signal)
  if (error) fail('entriesSeries', error)
  return parseDailySeries(data)
}

export async function fetchOwnerStateMatrix(
  signal: AbortSignal,
): Promise<OwnerStateMatrix> {
  const { data, error } = await supabase
    .rpc('get_admin_owner_state_matrix')
    .abortSignal(signal)
  if (error) fail('ownerStateMatrix', error)
  return parseOwnerStateMatrix(data)
}

export async function fetchForemanActivity(
  fromKey: string,
  toKey: string,
  signal: AbortSignal,
): Promise<ForemanActivityRow[]> {
  const { data, error } = await supabase
    .rpc('get_admin_foreman_discipline', {
      p_from: saudiDayStart(fromKey),
      p_to: saudiDayEnd(toKey),
    })
    .abortSignal(signal)
  if (error) fail('foremanActivity', error)
  return parseForemanActivity(data)
}
