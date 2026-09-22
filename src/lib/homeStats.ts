import { saudiDateKey } from '@/lib/saudiTime'

/**
 * Pure helpers for the home page: the shapes returned by
 * `get_foreman_home_stats()` / `get_workshop_home_stats()` (migration 0090)
 * and the mapping from the latest movement of one equipment to the state the
 * shared `EquipmentStatusCard` renders.
 *
 * Everything here is deliberately free of React and Supabase so it can be unit
 * tested and so the counting rules stay in one place.
 */

export interface ForemanHomeStats {
  entriesToday: number
  exitsToday: number
  insideNow: number
}

/** One workshop ENTRY that is still open and has no purpose set yet. */
export interface PendingClassificationEntry {
  id: string
  equipmentId: string
  equipmentCode: string
  equipmentType: string
  recordedAt: string
}

export interface WorkshopHomeStats {
  insideNow: number
  maintenance: number
  parking: number
  pendingClassification: number
  /** The same three counts at the start of today (Saudi midnight), or null
   *  when the stats function predates migration 0097. */
  insideYesterday: number | null
  maintenanceYesterday: number | null
  parkingYesterday: number | null
  /** Latest 10 of the `pendingClassification` entries, newest first. */
  pending: PendingClassificationEntry[]
}

/** Reads one non-negative integer out of the jsonb payload, defaulting to 0. */
function statNumber(source: unknown, key: string): number {
  if (!source || typeof source !== 'object') return 0
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return 0
  return Math.trunc(value)
}

/** Like `statNumber`, but a missing key is `null` rather than 0, so a card
 *  can hide a comparison it has no data for instead of claiming "+40". */
function statNumberOrNull(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return null
  return Math.trunc(value)
}

export function parseForemanHomeStats(source: unknown): ForemanHomeStats {
  return {
    entriesToday: statNumber(source, 'entries_today'),
    exitsToday: statNumber(source, 'exits_today'),
    insideNow: statNumber(source, 'inside_now'),
  }
}

function statText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function parsePendingEntries(source: unknown): PendingClassificationEntry[] {
  if (!source || typeof source !== 'object') return []
  const value = (source as Record<string, unknown>).pending
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      id: statText(row, 'id'),
      equipmentId: statText(row, 'equipment_id'),
      equipmentCode: statText(row, 'equipment_code') || '—',
      equipmentType: statText(row, 'equipment_type') || '—',
      recordedAt: statText(row, 'recorded_at'),
    }))
    .filter((row) => row.id !== '')
}

export function parseWorkshopHomeStats(source: unknown): WorkshopHomeStats {
  return {
    insideNow: statNumber(source, 'inside_now'),
    maintenance: statNumber(source, 'maintenance'),
    parking: statNumber(source, 'parking'),
    pendingClassification: statNumber(source, 'pending_classification'),
    insideYesterday: statNumberOrNull(source, 'inside_yesterday'),
    maintenanceYesterday: statNumberOrNull(source, 'maintenance_yesterday'),
    parkingYesterday: statNumberOrNull(source, 'parking_yesterday'),
    pending: parsePendingEntries(source),
  }
}

/**
 * Whole days between two instants counted on Saudi calendar days (UTC+03:00),
 * so "since 1 day" flips at Saudi midnight and never at the browser's.
 */
export function daysSinceSaudi(
  recordedAt: string | null | undefined,
  now: Date | string = new Date(),
): number {
  if (!recordedAt) return 0
  const from = Date.parse(`${saudiDateKey(recordedAt)}T00:00:00Z`)
  const to = Date.parse(`${saudiDateKey(now)}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/**
 * A state card's change since yesterday: today's count minus the count at
 * the start of today. `null` when the yesterday figure is unknown, so the
 * card shows no comparison rather than a false one.
 */
export function changeSinceYesterday(
  now: number,
  yesterday: number | null,
): number | null {
  if (yesterday === null) return null
  return now - yesterday
}

/** "+3", "-2" or "0", with a Latin minus so RTL never flips the sign. */
export function formatSignedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `-${Math.abs(delta)}`
  return '0'
}

export type WorkshopPurpose = 'maintenance' | 'parking'

/** Structurally identical to `EquipmentState` in the shared status card. */
export type HomeEquipmentState =
  | { kind: 'inside_site'; location: string; days: number }
  | { kind: 'inside_workshop'; purpose: WorkshopPurpose | null; days: number }
  | { kind: 'outside' }

/** The columns `get_last_movement()` returns that the state depends on. */
export interface HomeLastMovement {
  movement_type: string | null
  movement_context: string | null
  workshop_purpose: string | null
  recorded_at: string | null
}

function workshopPurpose(value: string | null): WorkshopPurpose | null {
  return value === 'maintenance' || value === 'parking' ? value : null
}

/**
 * Current state of one equipment from its latest movement across both
 * contexts. `undefined` means the equipment has never moved, so the card shows
 * no state pill at all rather than claiming it is outside.
 *
 * `location` is the company / project line the caller already localized; it is
 * only used for the site state.
 */
export function equipmentStateFromLastMovement(
  last: HomeLastMovement | null | undefined,
  location: string,
  now: Date | string = new Date(),
): HomeEquipmentState | undefined {
  if (!last || !last.movement_type) return undefined
  if (last.movement_type !== 'entry') return { kind: 'outside' }
  const days = daysSinceSaudi(last.recorded_at, now)
  if (last.movement_context === 'workshop')
    return {
      kind: 'inside_workshop',
      purpose: workshopPurpose(last.workshop_purpose),
      days,
    }
  return { kind: 'inside_site', location, days }
}
