// wave 17 — the auto-link plan of `POST /api/afaqy/sync`. Pure: the route
// reads the Afaqy units and the equipment rows, this decides what to write,
// and the route writes it with the admin's own token (RLS stays
// authoritative). Unit-tested in tests/wave17Afaqy.test.cjs.
//
// Matching rules:
//   1. The unit's code is the text of the FIRST parentheses of its name
//      (`parseUnitName`), compared as `upper(btrim())`.
//   2. A unit matches the equipment whose CURRENT code equals it; only when no
//      current code does, a PREVIOUS code (`equipment_code_changes.old_code`)
//      maps it to that equipment (the unit is still labelled with the old
//      code).
//   3. A code that matches several equipment, or several units that match the
//      same equipment, is a conflict: nothing is linked for it.
//   4. An existing link is never overwritten by the sync unless `force`:
//      an equipment linked to a DIFFERENT unit, or a unit already linked to a
//      DIFFERENT equipment, is reported as a conflict. With `force`, those old
//      links are cleared first and the matched link is written.

import {
  normalizeTrackerCode,
  parseUnitName,
  type TrackerSyncConflict,
  type TrackerSyncEquipmentRef,
  type TrackerSyncReport,
} from '@/lib/afaqy'

export interface SyncUnit {
  unitId: string
  name: string
}

export interface SyncEquipmentRow {
  id: string
  code: string
  tracker_unit_id: string | null
  tracker_unit_name: string | null
  is_active: boolean | null
}

export interface SyncCodeChangeRow {
  equipment_id: string
  old_code: string
}

export interface TrackerSyncSet {
  equipmentId: string
  unitId: string
  unitName: string
  /** True when it replaces another link (force only). */
  replacing: boolean
}

export interface TrackerSyncPlan {
  /** Equipment whose current link is removed BEFORE the sets (force only),
   *  so the unique index never sees one unit on two rows. */
  clears: string[]
  sets: TrackerSyncSet[]
  /** Already linked to the same unit, but Afaqy shows a new name. */
  renames: { equipmentId: string; unitName: string }[]
  alreadyLinked: number
  unmatchedUnits: TrackerSyncReport['unmatchedUnits']
  conflicts: TrackerSyncConflict[]
}

/** The most rows a report list carries; the totals stay exact. */
export const TRACKER_SYNC_LIST_LIMIT = 1000

function ref(row: SyncEquipmentRow): TrackerSyncEquipmentRef {
  return { id: row.id, code: row.code }
}

export function planTrackerSync(input: {
  units: readonly SyncUnit[]
  equipment: readonly SyncEquipmentRow[]
  codeChanges: readonly SyncCodeChangeRow[]
  force?: boolean
}): TrackerSyncPlan {
  const force = input.force === true
  const byId = new Map<string, SyncEquipmentRow>()
  const byCurrentCode = new Map<string, SyncEquipmentRow[]>()
  const holderOfUnit = new Map<string, SyncEquipmentRow>()
  for (const row of input.equipment) {
    byId.set(row.id, row)
    const code = normalizeTrackerCode(row.code)
    if (code) byCurrentCode.set(code, [...(byCurrentCode.get(code) ?? []), row])
    if (row.tracker_unit_id) holderOfUnit.set(row.tracker_unit_id, row)
  }
  const byPreviousCode = new Map<string, Set<string>>()
  for (const change of input.codeChanges) {
    const code = normalizeTrackerCode(change.old_code)
    if (!code || !byId.has(change.equipment_id)) continue
    const ids = byPreviousCode.get(code) ?? new Set<string>()
    ids.add(change.equipment_id)
    byPreviousCode.set(code, ids)
  }

  const plan: TrackerSyncPlan = {
    clears: [],
    sets: [],
    renames: [],
    alreadyLinked: 0,
    unmatchedUnits: [],
    conflicts: [],
  }

  // 1-3: one candidate equipment per unit.
  const unitsByEquipment = new Map<string, { unit: SyncUnit; code: string }[]>()
  const seen = new Set<string>()
  for (const unit of input.units) {
    if (seen.has(unit.unitId)) continue
    seen.add(unit.unitId)
    const { code } = parseUnitName(unit.name)
    if (!code) {
      plan.unmatchedUnits.push({ unitId: unit.unitId, name: unit.name, code })
      continue
    }
    const current = byCurrentCode.get(code)
    const candidates = current?.length
      ? current
      : [...(byPreviousCode.get(code) ?? [])]
          .map((id) => byId.get(id))
          .filter((row): row is SyncEquipmentRow => row !== undefined)
    if (candidates.length === 0) {
      plan.unmatchedUnits.push({ unitId: unit.unitId, name: unit.name, code })
      continue
    }
    if (candidates.length > 1) {
      plan.conflicts.push({
        reason: 'ambiguous_code',
        unitId: unit.unitId,
        unitName: unit.name,
        code,
        equipment: candidates.map(ref),
      })
      continue
    }
    const target = candidates[0]
    unitsByEquipment.set(target.id, [
      ...(unitsByEquipment.get(target.id) ?? []),
      { unit, code },
    ])
  }

  const cleared = new Set<string>()
  const clear = (id: string) => {
    if (!cleared.has(id)) {
      cleared.add(id)
      plan.clears.push(id)
    }
  }

  for (const [equipmentId, matches] of unitsByEquipment) {
    const target = byId.get(equipmentId) as SyncEquipmentRow
    let match = matches[0]
    if (matches.length > 1) {
      // Several units name this equipment. The one it is already linked to
      // stays; the others (or all, when none is linked) are conflicts.
      const kept = matches.find(
        (entry) => entry.unit.unitId === target.tracker_unit_id,
      )
      for (const entry of matches) {
        if (entry === kept) continue
        plan.conflicts.push({
          reason: 'several_units',
          unitId: entry.unit.unitId,
          unitName: entry.unit.name,
          code: entry.code,
          equipment: [ref(target)],
        })
      }
      if (!kept) continue
      match = kept
    }

    const { unit, code } = match
    if (target.tracker_unit_id === unit.unitId) {
      plan.alreadyLinked += 1
      if (unit.name && unit.name !== target.tracker_unit_name)
        plan.renames.push({ equipmentId, unitName: unit.name })
      continue
    }

    const holder = holderOfUnit.get(unit.unitId)
    const targetLinkedElsewhere = target.tracker_unit_id !== null
    if (!force && targetLinkedElsewhere) {
      plan.conflicts.push({
        reason: 'equipment_linked_to_other_unit',
        unitId: unit.unitId,
        unitName: unit.name,
        code,
        equipment: [ref(target)],
      })
      continue
    }
    if (!force && holder) {
      plan.conflicts.push({
        reason: 'unit_linked_elsewhere',
        unitId: unit.unitId,
        unitName: unit.name,
        code,
        equipment: [ref(holder), ref(target)],
      })
      continue
    }
    if (targetLinkedElsewhere) clear(target.id)
    if (holder) clear(holder.id)
    plan.sets.push({
      equipmentId,
      unitId: unit.unitId,
      unitName: unit.name,
      replacing: targetLinkedElsewhere || Boolean(holder),
    })
  }

  plan.sets.sort((a, b) => a.equipmentId.localeCompare(b.equipmentId))
  return plan
}

/**
 * The report after the writes. `failedClears` / `failedSets` are the
 * equipment ids whose update did not go through (an RLS denial, a unique
 * violation, a network error); they are counted and listed as conflicts.
 */
export function summarizeTrackerSync(input: {
  plan: TrackerSyncPlan
  equipment: readonly SyncEquipmentRow[]
  unitsTotal: number
  failedClears: ReadonlySet<string>
  failedSets: ReadonlySet<string>
}): TrackerSyncReport {
  const { plan, equipment, failedClears, failedSets } = input
  const linkOf = new Map<string, string | null>()
  for (const row of equipment) linkOf.set(row.id, row.tracker_unit_id)
  for (const id of plan.clears) if (!failedClears.has(id)) linkOf.set(id, null)

  const conflicts = [...plan.conflicts]
  const byId = new Map(equipment.map((row) => [row.id, row]))
  let linked = 0
  let relinked = 0
  for (const set of plan.sets) {
    if (failedSets.has(set.equipmentId)) {
      const row = byId.get(set.equipmentId)
      conflicts.push({
        reason: 'update_failed',
        unitId: set.unitId,
        unitName: set.unitName,
        code: parseUnitName(set.unitName).code,
        equipment: row ? [ref(row)] : [],
      })
      continue
    }
    linkOf.set(set.equipmentId, set.unitId)
    linked += 1
    if (set.replacing) relinked += 1
  }

  const without = equipment
    .filter((row) => row.is_active !== false && !linkOf.get(row.id))
    .map(ref)
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))

  return {
    unitsTotal: input.unitsTotal,
    linked,
    relinked,
    alreadyLinked: plan.alreadyLinked,
    failed: failedSets.size + failedClears.size,
    unmatchedUnits: plan.unmatchedUnits.slice(0, TRACKER_SYNC_LIST_LIMIT),
    equipmentWithoutUnit: without.slice(0, TRACKER_SYNC_LIST_LIMIT),
    equipmentWithoutUnitTotal: without.length,
    conflicts: conflicts.slice(0, TRACKER_SYNC_LIST_LIMIT),
  }
}
