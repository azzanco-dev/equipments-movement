// SERVER ONLY. wave 17: the admin check shared by the Afaqy routes. Same rule
// as app/api/notifications/whatsapp-status/route.ts: the caller's own bearer
// token is verified (`auth.getClaims`) and the role is decided by
// `public.is_admin()` called WITH THAT TOKEN, so the database stays
// authoritative; anything but `true` (an unknown role, no profile, an error)
// is forbidden. The returned client carries the caller's token, so every
// later read or write still goes through RLS. No service-role key is used.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type AdminRequestResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: 'unauthorized' | 'forbidden' }

function authenticatedClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Throws only when the Supabase variables are missing (the route's 500). */
export async function requireAdmin(
  request: Request,
): Promise<AdminRequestResult> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return { ok: false, error: 'unauthorized' }
  }
  const accessToken = authorization.slice(7)
  const supabase = authenticatedClient(accessToken)
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims(accessToken)
  if (authError || !claimsData?.claims.sub) {
    return { ok: false, error: 'unauthorized' }
  }
  const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin')
  if (roleError || isAdmin !== true) {
    return { ok: false, error: 'forbidden' }
  }
  return { ok: true, supabase }
}
