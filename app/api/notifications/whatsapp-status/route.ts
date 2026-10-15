import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/server/adminRequest'
import { getWhatsAppGatewayStatus } from '@/lib/server/ultramsg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * wave 12 — the WhatsApp gateway connection status.
 *
 * Request:  GET with `Authorization: Bearer <token>`.
 * Response: 200 { state, checkedAt }
 *             state  'connected' | 'disconnected' | 'qr' | 'loading'
 *                    | 'not_configured' | 'unknown'
 *           401 { error: 'unauthorized' }  403 { error: 'forbidden' }
 *           500 { error: 'failed' }
 *
 * Needs the permission `settings.integrations` (wave 24): decided by
 * `public.has_permission()` called with the caller's own token
 * (`requirePermission`), so the database stays authoritative; anything but
 * `true` (no permission, no profile, an error) is a 403. While the roles
 * system is inactive that is the admin only, as before. The gateway is asked
 * server-side and at most once a minute per server instance; only the mapped
 * state leaves the server, never the token, the instance id, a number or the
 * provider's text.
 */
export async function GET(request: Request) {
  try {
    const access = await requirePermission(request, 'settings.integrations')
    if (!access.ok) {
      return reply(
        { error: access.error },
        access.error === 'unauthorized' ? 401 : 403,
      )
    }

    const status = await getWhatsAppGatewayStatus()
    return reply({ state: status.state, checkedAt: status.checkedAt }, 200)
  } catch {
    console.error('WhatsApp status request failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
