import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  noticeRequestErrorCode,
  noticeRequestErrorStatus,
} from '@/lib/movementNoticeErrors'
import {
  deliverMovementNotice,
  parseMovementNoticeRow,
} from '@/lib/server/movementNotices'

export const runtime = 'nodejs'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function authenticatedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * wave 9 — "Notify the foreman": a workshop role (or an admin) reports that a
 * unit recorded inside a site has arrived at the workshop.
 *
 * Request:  POST { equipmentId: string }  with `Authorization: Bearer <token>`.
 * Response: 200 { status, recipientName, fallbackUrl }
 *             status       'sent' | 'failed' | 'not_configured' | 'no_mobile'
 *             fallbackUrl  wa.me link with the same text, when the foreman has
 *                          a usable number and the status is not 'sent'
 *           4xx/5xx { error }
 *             401 unauthorized   400 invalid     403 forbidden
 *             409 not_on_site    429 recently_sent   500 failed
 *
 * `request_workshop_arrival_notice` (migration 0110) is authoritative: it
 * re-checks the role fail-closed, resolves the recipient from the unit's open
 * site entry (the client never supplies one) and enforces the 10-minute rule.
 * The message text is a fixed server-side template. A failed send is a 200
 * with `status: 'failed'`: the request was logged and may be retried.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const accessToken = authorization.slice(7)
    const supabase = authenticatedClient(accessToken)
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims(accessToken)
    if (authError || !claimsData?.claims.sub) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    let body: unknown = null
    try {
      body = await request.json()
    } catch {
      body = null
    }
    const equipmentId =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).equipmentId
        : null
    if (typeof equipmentId !== 'string' || !UUID_PATTERN.test(equipmentId)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc(
      'request_workshop_arrival_notice',
      { p_equipment_id: equipmentId },
    )
    if (error) {
      const code = noticeRequestErrorCode(error.message)
      if (code === 'failed') {
        console.error('Workshop arrival notice request failed', {
          code: 'request_failed',
        })
      }
      return NextResponse.json(
        { error: code },
        { status: noticeRequestErrorStatus(code) },
      )
    }

    const row = parseMovementNoticeRow(data)
    if (!row) {
      console.error('Workshop arrival notice request failed', {
        code: 'empty_result',
      })
      return NextResponse.json({ error: 'failed' }, { status: 500 })
    }

    const delivery = await deliverMovementNotice(supabase, row)
    return NextResponse.json(delivery, { status: 200 })
  } catch {
    console.error('Workshop arrival notice request failed', {
      code: 'route_threw',
    })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
