import { NextResponse } from 'next/server'
import { AFAQY_UNIT_ID_PATTERN } from '@/lib/afaqy'
import { getUnitPosition, isAfaqyConfigured } from '@/lib/server/afaqy'
import { requireAdmin } from '@/lib/server/adminRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * wave 17 — the last position of an equipment's linked Afaqy unit, for the
 * admin's equipment detail and inquiry pages.
 *
 * Request:  GET /api/afaqy/position?equipmentId=<uuid>
 *           with `Authorization: Bearer <token>`.
 * Response: 200 { unit: { unitId, name, imei?, position: { lat, lng,
 *                 speedKmh, heading, ignitionOn, deviceTime, serverTime,
 *                 satellites?, odometer? } | null } }
 *           400 { error: 'invalid_request' }
 *           401 { error: 'unauthorized' }      403 { error: 'forbidden' }
 *           404 { error: 'equipment_not_found' | 'not_linked'
 *                        | 'unit_not_found' }
 *           503 { error: 'not_configured' }
 *           502 { error: 'provider_unavailable' }
 *           500 { error: 'failed' }
 *
 * Admin only (`requireAdmin`), checked before anything else. The link is
 * read with the caller's token, so RLS decides what the caller may see. Each
 * unit's position is cached in server memory for a minute.
 */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request)
    if (!admin.ok) {
      return reply(
        { error: admin.error },
        admin.error === 'unauthorized' ? 401 : 403,
      )
    }

    const equipmentId = new URL(request.url).searchParams.get('equipmentId')
    if (!equipmentId || !UUID_PATTERN.test(equipmentId)) {
      return reply({ error: 'invalid_request' }, 400)
    }

    const { data, error } = await admin.supabase
      .from('equipment')
      .select('id,tracker_unit_id')
      .eq('id', equipmentId)
      .maybeSingle()
    if (error) {
      console.error('Afaqy position request failed', {
        code: 'equipment_read_failed',
      })
      return reply({ error: 'failed' }, 500)
    }
    if (!data) return reply({ error: 'equipment_not_found' }, 404)
    const unitId = (data as { tracker_unit_id: string | null }).tracker_unit_id
    if (!unitId || !AFAQY_UNIT_ID_PATTERN.test(unitId)) {
      return reply({ error: 'not_linked' }, 404)
    }

    if (!isAfaqyConfigured()) return reply({ error: 'not_configured' }, 503)
    const result = await getUnitPosition(unitId)
    if (!result.ok) {
      console.error('Afaqy position request failed', { code: result.error })
      return result.error === 'not_configured'
        ? reply({ error: 'not_configured' }, 503)
        : reply({ error: 'provider_unavailable' }, 502)
    }
    if (!result.value) return reply({ error: 'unit_not_found' }, 404)
    return reply({ unit: result.value }, 200)
  } catch {
    console.error('Afaqy position request failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
