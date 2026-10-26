import { NextResponse } from 'next/server'
import { AFAQY_UNIT_ID_PATTERN } from '@/lib/afaqy'
import {
  buildAfaqyStats,
  type FleetEquipment,
  type ProgramEquipmentState,
} from '@/lib/afaqyStats'
import { isAfaqyConfigured, listUnits } from '@/lib/server/afaqy'
import { requirePermission } from '@/lib/server/adminRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
/** Rows per read of the fleet (PostgREST answers at most 1000). */
const FLEET_PAGE = 1000
/** Pages of the fleet at most: far above any real fleet. */
const FLEET_MAX_PAGES = 20
/** The owners the figures cover (owner 2026-10-26: «خلنا على معدات العزاني
 *  ومعدات F»). */
const AFAQY_STATS_OWNERS = ['alazani', 'third_party_f']

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

type FleetRow = {
  id: string
  code: string | null
  type: string | null
  tracker_unit_id: string | null
  equipment_state: ProgramEquipmentState | null
}

/**
 * «افاقي» on the admin home (owner 2026-10-26): Afaqy figures for the
 * program's fleet — the active equipment (`is_active AND status = 'active'`)
 * of Al-Azani and third-party F only.
 *
 * Request:  GET /api/afaqy/stats with `Authorization: Bearer <token>`.
 * Response: 200 { stats: AfaqyStats } (src/lib/afaqyStats.ts)
 *           401 { error: 'unauthorized' }      403 { error: 'forbidden' }
 *           503 { error: 'not_configured' }
 *           502 { error: 'provider_unavailable' }
 *           500 { error: 'failed' }
 *
 * Needs `equipment.location.view`, the key of the «الموقع الحالي» card,
 * checked first. The fleet is read with the caller's token (RLS decides);
 * the Afaqy units come from the five-minute server cache of `listUnits`.
 * Only counts and equipment codes leave the server.
 */
export async function GET(request: Request) {
  try {
    const access = await requirePermission(request, 'equipment.location.view')
    if (!access.ok) {
      return reply(
        { error: access.error },
        access.error === 'unauthorized' ? 401 : 403,
      )
    }

    const fleet: FleetEquipment[] = []
    for (let page = 0; page < FLEET_MAX_PAGES; page += 1) {
      const { data, error } = await access.supabase
        .from('equipment')
        .select('id,code,type,tracker_unit_id,equipment_state')
        .eq('is_active', true)
        .eq('status', 'active')
        .in('ownership_status', AFAQY_STATS_OWNERS)
        .order('id', { ascending: true })
        .range(page * FLEET_PAGE, (page + 1) * FLEET_PAGE - 1)
      if (error) {
        console.error('Afaqy stats request failed', {
          code: 'fleet_read_failed',
        })
        return reply({ error: 'failed' }, 500)
      }
      const rows = (data ?? []) as unknown as FleetRow[]
      for (const row of rows) {
        fleet.push({
          id: row.id,
          code: row.code ?? '—',
          type: row.type,
          trackerUnitId:
            row.tracker_unit_id &&
            AFAQY_UNIT_ID_PATTERN.test(row.tracker_unit_id)
              ? row.tracker_unit_id
              : null,
          state: row.equipment_state,
        })
      }
      if (rows.length < FLEET_PAGE) break
    }

    if (!isAfaqyConfigured()) return reply({ error: 'not_configured' }, 503)
    const units = await listUnits()
    if (!units.ok) {
      console.error('Afaqy stats request failed', { code: units.error })
      return units.error === 'not_configured'
        ? reply({ error: 'not_configured' }, 503)
        : reply({ error: 'provider_unavailable' }, 502)
    }
    return reply({ stats: buildAfaqyStats(fleet, units.value) }, 200)
  } catch {
    console.error('Afaqy stats request failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
