import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { AFAQY_UNIT_NAME_MAX } from '@/lib/afaqy'
import {
  planTrackerSync,
  summarizeTrackerSync,
  type SyncCodeChangeRow,
  type SyncEquipmentRow,
} from '@/lib/afaqySync'
import { isAfaqyConfigured, listUnits } from '@/lib/server/afaqy'
import { requireAdmin } from '@/lib/server/adminRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }
/** PostgREST answers at most 1000 rows per request by default. */
const READ_PAGE = 1000
/** 50 000 equipment rows: far above the fleet; refuse rather than truncate. */
const MAX_READ_PAGES = 50
/** Updates in flight at once. */
const WRITE_CONCURRENCY = 10

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** Every row of a read, page by page, ordered by `id` so paging is stable. */
async function readAll<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null
    error: unknown
  }>,
): Promise<T[] | null> {
  const rows: T[] = []
  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const from = page * READ_PAGE
    const { data, error } = await read(from, from + READ_PAGE - 1)
    if (error || !data) return null
    rows.push(...(data as T[]))
    if (data.length < READ_PAGE) return rows
  }
  return null
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function runBounded<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < items.length; start += limit) {
    await Promise.all(items.slice(start, start + limit).map(task))
  }
}

/** One equipment update with the caller's token. True only when exactly
 *  that row was written (an RLS denial updates nothing and is a failure). */
async function updateEquipment(
  supabase: SupabaseClient,
  id: string,
  values: Record<string, string | null>,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('equipment')
      .update(values)
      .eq('id', id)
      .select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

async function readForce(request: Request): Promise<boolean | null> {
  try {
    const text = await request.text()
    if (!text.trim()) return false
    const body = JSON.parse(text) as unknown
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      return null
    const force = (body as Record<string, unknown>).force
    if (force === undefined) return false
    return typeof force === 'boolean' ? force : null
  } catch {
    return null
  }
}

/**
 * wave 17 — auto-link equipment to their Afaqy units by code.
 *
 * Request:  POST with `Authorization: Bearer <token>` and an optional JSON
 *           body `{ force?: boolean }`.
 * Response: 200 { report: { unitsTotal, linked, relinked, alreadyLinked,
 *                 failed, unmatchedUnits, equipmentWithoutUnit,
 *                 equipmentWithoutUnitTotal, conflicts } }
 *           400 { error: 'invalid_request' }
 *           401 { error: 'unauthorized' }   403 { error: 'forbidden' }
 *           503 { error: 'not_configured' }
 *           502 { error: 'provider_unavailable' }
 *           500 { error: 'failed' }
 *
 * Admin only (`requireAdmin`), checked before Afaqy is asked. The matching
 * rules are in src/lib/afaqySync.ts. Every write is a plain update of one
 * equipment row WITH THE CALLER'S TOKEN, so the admin-only
 * `update_equipment` RLS policy and the 0122 constraints (one unit per
 * equipment) stay authoritative; a refused write is reported, never hidden.
 * Without `force` an existing different link is never overwritten.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request)
    if (!admin.ok) {
      return reply(
        { error: admin.error },
        admin.error === 'unauthorized' ? 401 : 403,
      )
    }
    const force = await readForce(request)
    if (force === null) return reply({ error: 'invalid_request' }, 400)
    if (!isAfaqyConfigured()) return reply({ error: 'not_configured' }, 503)

    const units = await listUnits({ fresh: true })
    if (!units.ok) {
      console.error('Afaqy sync failed', { code: units.error })
      return units.error === 'not_configured'
        ? reply({ error: 'not_configured' }, 503)
        : reply({ error: 'provider_unavailable' }, 502)
    }

    const supabase = admin.supabase
    const [equipment, codeChanges] = await Promise.all([
      readAll<SyncEquipmentRow>((from, to) =>
        supabase
          .from('equipment')
          .select('id,code,tracker_unit_id,tracker_unit_name,is_active')
          .order('id')
          .range(from, to),
      ),
      readAll<SyncCodeChangeRow>((from, to) =>
        supabase
          .from('equipment_code_changes')
          .select('equipment_id,old_code')
          .order('id')
          .range(from, to),
      ),
    ])
    if (!equipment || !codeChanges) {
      console.error('Afaqy sync failed', { code: 'database_read_failed' })
      return reply({ error: 'failed' }, 500)
    }

    const plan = planTrackerSync({
      units: units.value.map((unit) => ({
        unitId: unit.unitId,
        name: unit.name,
      })),
      equipment,
      codeChanges,
      force,
    })

    // Old links first (force only), so the unique index never sees one unit
    // on two rows while the new links are written.
    const failedClears = new Set<string>()
    await runBounded(plan.clears, WRITE_CONCURRENCY, async (id) => {
      const ok = await updateEquipment(supabase, id, {
        tracker_unit_id: null,
        tracker_unit_name: null,
        tracker_linked_at: null,
      })
      if (!ok) failedClears.add(id)
    })

    const failedSets = new Set<string>()
    const linkedAt = new Date().toISOString()
    await runBounded(plan.sets, WRITE_CONCURRENCY, async (set) => {
      const ok = await updateEquipment(supabase, set.equipmentId, {
        tracker_unit_id: set.unitId,
        tracker_unit_name: set.unitName.slice(0, AFAQY_UNIT_NAME_MAX) || null,
        tracker_linked_at: linkedAt,
      })
      if (!ok) failedSets.add(set.equipmentId)
    })

    // A new display name for an unchanged link; best effort.
    await runBounded(plan.renames, WRITE_CONCURRENCY, async (rename) => {
      await updateEquipment(supabase, rename.equipmentId, {
        tracker_unit_name: rename.unitName.slice(0, AFAQY_UNIT_NAME_MAX),
      })
    })

    const report = summarizeTrackerSync({
      plan,
      equipment,
      unitsTotal: units.value.length,
      failedClears,
      failedSets,
    })
    return reply({ report }, 200)
  } catch {
    console.error('Afaqy sync failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
