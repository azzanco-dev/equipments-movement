import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runInstallmentReminder } from '@/lib/server/installmentReminder'

// The daily WhatsApp reminder of installment due dates (migration 0205),
// called by Vercel Cron (`vercel.json`, 06:00 UTC = 09:00 Saudi time). Vercel
// sends `Authorization: Bearer <CRON_SECRET>`; anything else gets 401. The
// same secret is passed to the database functions, which check its hash.
// Only the count summary is returned: no phone number, no message text.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || secret.length < 16) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  }
  if (!secretMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const summary = await runInstallmentReminder(secret)
  const status = summary.ok
    ? 200
    : summary.error === 'key_invalid'
      ? 401
      : summary.error === 'not_configured'
        ? 503
        : 500
  return NextResponse.json(summary, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
