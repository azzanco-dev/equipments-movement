import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getWhatsAppGatewayStatus } from '@/lib/server/ultramsg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function authenticatedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * wave 12 — the WhatsApp gateway connection status, for the admin only.
 *
 * Request:  GET with `Authorization: Bearer <token>`.
 * Response: 200 { state, checkedAt }
 *             state  'connected' | 'disconnected' | 'qr' | 'loading'
 *                    | 'not_configured' | 'unknown'
 *           401 { error: 'unauthorized' }  403 { error: 'forbidden' }
 *           500 { error: 'failed' }
 *
 * The role is decided by `public.is_admin()` called with the caller's own
 * token, so the database stays authoritative; anything but `true` (an unknown
 * role, no profile, an error) is a 403. The gateway is asked server-side and
 * at most once a minute per server instance; only the mapped state leaves the
 * server, never the token, the instance id, a number or the provider's text.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return reply({ error: 'unauthorized' }, 401)
  }

  try {
    const accessToken = authorization.slice(7)
    const supabase = authenticatedClient(accessToken)
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims(accessToken)
    if (authError || !claimsData?.claims.sub) {
      return reply({ error: 'unauthorized' }, 401)
    }

    const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin')
    if (roleError || isAdmin !== true) {
      return reply({ error: 'forbidden' }, 403)
    }

    const status = await getWhatsAppGatewayStatus()
    return reply({ state: status.state, checkedAt: status.checkedAt }, 200)
  } catch {
    console.error('WhatsApp status request failed', { code: 'route_threw' })
    return reply({ error: 'failed' }, 500)
  }
}
