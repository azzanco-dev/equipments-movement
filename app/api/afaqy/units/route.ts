import { NextResponse } from 'next/server'
import { toUnitListItem } from '@/lib/afaqy'
import { isAfaqyConfigured, listUnits } from '@/lib/server/afaqy'
import { requireAdmin } from '@/lib/server/adminRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * wave 17 — the Afaqy units, for the admin's linking UI.
 *
 * Request:  GET with `Authorization: Bearer <token>`.
 * Response: 200 { units: [{ unitId, name, code, plate, imei, hasPosition,
 *                           lastSeen }] }
 *           401 { error: 'unauthorized' }   403 { error: 'forbidden' }
 *           503 { error: 'not_configured' } (the Afaqy variables are missing)
 *           502 { error: 'provider_unavailable' }
 *           500 { error: 'failed' }
 *
 * Admin only (`requireAdmin`: the caller's token, `is_admin()`, fail
 * closed), checked before Afaqy is asked. The list is cached in server
 * memory for five minutes; only the mapped fields leave the server, never
 * the credentials, the token or the provider's text.
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
    if (!isAfaqyConfigured()) return reply({ error: 'not_configured' }, 503)

    const result = await listUnits()
    if (!result.ok) {
      console.error('Afaqy units request failed', { code: result.error })
      return result.error === 'not_configured'
        ? reply({ error: 'not_configured' }, 503)
        : reply({ error: 'provider_unavailable' }, 502)
    }
    const units = result.value
      .map(toUnitListItem)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    return reply({ units }, 200)
  } catch {
    console.error('Afaqy units request failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
