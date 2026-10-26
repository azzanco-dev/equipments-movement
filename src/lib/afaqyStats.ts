// «افاقي» on the admin home (owner 2026-10-26: «في الرئيسية حق الادمن ابغى
// استعرض بيانات احصائية للمعدات في افاقي … خلينا على المعدات الي في البرنامج
// مضافة»). Pure: the server route joins the program's fleet with the Afaqy
// units and hands the result here; the card only draws it.
//
// Afaqy gives the LAST signal of each unit only (position, speed, ignition,
// time), so every figure is a snapshot of now, not a history.

import {
  AFAQY_STALE_AFTER_MS,
  lastSignalTime,
  type AfaqyUnit,
} from '@/lib/afaqy'

/** A signal older than this is «قديمة» (the location card's stale mark). */
export const AFAQY_RECENT_MS = AFAQY_STALE_AFTER_MS
/** A signal older than this is «منقطعة». */
export const AFAQY_SILENT_MS = 24 * 60 * 60 * 1000
/** Above this speed (km/h) a unit is moving. */
export const AFAQY_MOVING_KMH = 5
/** Each list carries at most this many units. */
export const AFAQY_STATS_LIST_MAX = 30

/** The program's equipment state (`equipment_state()`, migration 0125). */
export type ProgramEquipmentState =
  | 'working'
  | 'available'
  | 'maintenance'
  | 'parking'
  | 'out_of_service'
  | 'unclassified'

const WORKSHOP_STATES: ReadonlySet<string> = new Set([
  'maintenance',
  'parking',
  'out_of_service',
  'unclassified',
])

/** One active unit of the fleet (is_active AND status = 'active'). */
export interface FleetEquipment {
  id: string
  code: string
  trackerUnitId: string | null
  state: ProgramEquipmentState | null
}

export interface AfaqyStatsUnit {
  id: string
  code: string
}

export interface AfaqyStats {
  /** The fleet: active equipment of the program. */
  fleet: number
  /** Linked to an Afaqy unit. */
  linked: number
  /** Of the linked, by the age of the last signal. A linked unit Afaqy no
   *  longer knows, or one that never sent a position, is `none`. */
  signal: { recent: number; stale: number; silent: number; none: number }
  /** Of the units with a RECENT signal: what they do now. */
  now: { moving: number; idling: number; off: number }
  lists: {
    /** In the workshop in the program, but the engine runs (moving or not). */
    workshopRunning: AfaqyStatsUnit[]
    /** Out (available) in the program, but moving. */
    availableMoving: AfaqyStatsUnit[]
    /** Engine on, standing still. */
    idling: AfaqyStatsUnit[]
    /** No signal for more than a day. */
    silent: AfaqyStatsUnit[]
    /** Linked, but no position at all (or Afaqy no longer knows the unit). */
    noSignal: AfaqyStatsUnit[]
  }
  /** The full count of each list (a list shows at most
   *  AFAQY_STATS_LIST_MAX units). */
  listTotals: Record<keyof AfaqyStats['lists'], number>
  /** When the figures were made (ISO). */
  generatedAt: string
}

type Activity = 'moving' | 'idling' | 'off'

function activityOf(unit: AfaqyUnit): Activity {
  const position = unit.position
  if (!position) return 'off'
  if ((position.speedKmh ?? 0) > AFAQY_MOVING_KMH) return 'moving'
  return position.ignitionOn === true ? 'idling' : 'off'
}

const byCode = (a: AfaqyStatsUnit, b: AfaqyStatsUnit) =>
  a.code.localeCompare(b.code, 'en', { numeric: true })

function finish(list: AfaqyStatsUnit[]): AfaqyStatsUnit[] {
  return list.sort(byCode).slice(0, AFAQY_STATS_LIST_MAX)
}

export function buildAfaqyStats(
  fleet: readonly FleetEquipment[],
  units: readonly AfaqyUnit[],
  nowMs: number = Date.now(),
): AfaqyStats {
  const unitsById = new Map(units.map((unit) => [unit.unitId, unit]))
  const signal = { recent: 0, stale: 0, silent: 0, none: 0 }
  const now = { moving: 0, idling: 0, off: 0 }
  const workshopRunning: AfaqyStatsUnit[] = []
  const availableMoving: AfaqyStatsUnit[] = []
  const idling: AfaqyStatsUnit[] = []
  const silent: AfaqyStatsUnit[] = []
  const noSignal: AfaqyStatsUnit[] = []
  let linked = 0

  for (const equipment of fleet) {
    if (!equipment.trackerUnitId) continue
    linked += 1
    const unit = unitsById.get(equipment.trackerUnitId)
    const seen = unit ? lastSignalTime(unit.position) : null
    const seenMs = seen ? Date.parse(seen) : Number.NaN
    const entry = { id: equipment.id, code: equipment.code }
    if (!unit || !Number.isFinite(seenMs)) {
      signal.none += 1
      noSignal.push(entry)
      continue
    }
    const age = nowMs - seenMs
    if (age > AFAQY_SILENT_MS) {
      signal.silent += 1
      silent.push(entry)
      continue
    }
    if (age > AFAQY_RECENT_MS) {
      signal.stale += 1
      continue
    }
    signal.recent += 1
    const activity = activityOf(unit)
    now[activity] += 1
    if (activity === 'idling') idling.push(entry)
    if (
      equipment.state &&
      WORKSHOP_STATES.has(equipment.state) &&
      activity !== 'off'
    )
      workshopRunning.push(entry)
    if (equipment.state === 'available' && activity === 'moving')
      availableMoving.push(entry)
  }

  return {
    fleet: fleet.length,
    linked,
    signal,
    now,
    listTotals: {
      workshopRunning: workshopRunning.length,
      availableMoving: availableMoving.length,
      idling: idling.length,
      silent: silent.length,
      noSignal: noSignal.length,
    },
    lists: {
      workshopRunning: finish(workshopRunning),
      availableMoving: finish(availableMoving),
      idling: finish(idling),
      silent: finish(silent),
      noSignal: finish(noSignal),
    },
    generatedAt: new Date(nowMs).toISOString(),
  }
}
