// «بيانات التتبع في افاقي» on the admin home (owner 2026-10-26: «في
// الرئيسية حق الادمن ابغى استعرض بيانات احصائية للمعدات في افاقي … خلينا على
// المعدات الي في البرنامج مضافة»). Pure: the server route joins the program's
// fleet with the Afaqy link states and hands the result here; the section
// only draws it.
//
// Aligned with Afaqy's own two states (owner, same day: «في افاقي فيه
// connection state و satellite»), as far as the units list allows (read-only
// probe of the account, 2026-10-26):
//   * connection: Afaqy's live state is not in the data, so it is
//     approximated from the last message («ابنيها بالتقريب من وقت اخر
//     رسالة»): connected when one arrived within the last 30 minutes;
//   * satellite: the last known satellite count (`chPrams.sat`), as Afaqy
//     shows it; «بدون اقمار» when it is 0 or unknown.

import type { AfaqyUnitLink } from '@/lib/afaqy'

/** A unit is «متصلة» when its last message is at most this old. */
export const AFAQY_ONLINE_MS = 30 * 60 * 1000
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

/** One active unit of the fleet (is_active AND status = 'active'). */
export interface FleetEquipment {
  id: string
  code: string
  type: string | null
  trackerUnitId: string | null
  state: ProgramEquipmentState | null
}

/** One row of the section's mini tables. */
export interface AfaqyStatsUnit {
  id: string
  code: string
  type: string | null
  /** The time of the last message (ISO), null when there is none. */
  lastSignal: string | null
}

type ListKey = 'offline' | 'noFix' | 'noSignal'

export interface AfaqyStats {
  /** The fleet the figures cover. */
  fleet: number
  /** Linked to an Afaqy unit. */
  linked: number
  /** Of the linked: connected (a message in the last 30 minutes), not
   *  connected, and none (never sent a message, or Afaqy no longer knows the
   *  unit). */
  connection: { online: number; offline: number; none: number }
  /** Of the linked that sent a message: no satellites (the last known
   *  count is 0 or unknown), as Afaqy shows «no satellite». */
  noFix: number
  lists: Record<ListKey, AfaqyStatsUnit[]>
  /** The full count of each list (a list shows at most
   *  AFAQY_STATS_LIST_MAX units). */
  listTotals: Record<ListKey, number>
  /** When the figures were made (ISO). */
  generatedAt: string
}

const byCode = (a: AfaqyStatsUnit, b: AfaqyStatsUnit) =>
  a.code.localeCompare(b.code, 'en', { numeric: true })

function finish(list: AfaqyStatsUnit[]): AfaqyStatsUnit[] {
  return list.sort(byCode).slice(0, AFAQY_STATS_LIST_MAX)
}

export function buildAfaqyStats(
  fleet: readonly FleetEquipment[],
  links: readonly AfaqyUnitLink[],
  nowMs: number = Date.now(),
): AfaqyStats {
  const linksById = new Map(links.map((link) => [link.unitId, link]))
  const connection = { online: 0, offline: 0, none: 0 }
  const offline: AfaqyStatsUnit[] = []
  const noFix: AfaqyStatsUnit[] = []
  const noSignal: AfaqyStatsUnit[] = []
  let linked = 0

  for (const equipment of fleet) {
    if (!equipment.trackerUnitId) continue
    linked += 1
    const link = linksById.get(equipment.trackerUnitId)
    const lastSignal = link?.lastMessageAt ?? null
    const lastMs = lastSignal ? Date.parse(lastSignal) : Number.NaN
    const entry: AfaqyStatsUnit = {
      id: equipment.id,
      code: equipment.code,
      type: equipment.type,
      lastSignal,
    }
    if (!Number.isFinite(lastMs)) {
      connection.none += 1
      noSignal.push(entry)
      continue
    }
    if (nowMs - lastMs <= AFAQY_ONLINE_MS) connection.online += 1
    else {
      connection.offline += 1
      offline.push(entry)
    }
    if (!link?.satellites) noFix.push(entry)
  }

  return {
    fleet: fleet.length,
    linked,
    connection,
    noFix: noFix.length,
    listTotals: {
      offline: offline.length,
      noFix: noFix.length,
      noSignal: noSignal.length,
    },
    lists: {
      offline: finish(offline),
      noFix: finish(noFix),
      noSignal: finish(noSignal),
    },
    generatedAt: new Date(nowMs).toISOString(),
  }
}
