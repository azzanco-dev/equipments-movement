// SERVER ONLY. The access checks shared by the API routes.
//
// wave 17: `requireAdmin` — the caller's own bearer token is verified
// (`auth.getClaims`) and the role is decided by `public.is_admin()` called
// WITH THAT TOKEN, so the database stays authoritative; anything but `true`
// (an unknown role, no profile, an error) is forbidden.
//
// wave 24: `requirePermission(request, key)` — the same token flow, but the
// decision is `public.has_permission(key)` (migration 0126) called with the
// caller's token: while the roles system is inactive the frozen legacy
// mapping answers, so the routes behave exactly as before; once it is active
// the assigned role decides. Anything but exactly `true` is forbidden.
//
// Both return a client that carries the caller's token, so every later read
// or write still goes through RLS. No service-role key is used.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type AdminRequestResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: 'unauthorized' | 'forbidden' }

/**
 * The permission keys the API routes decide by (the catalogue of 0126).
 *   settings.integrations    Afaqy units and sync, the WhatsApp gateway state
 *   equipment.location.view  the «الموقع الحالي» card (Afaqy position)
 *   movements.notify_foreman «ابلاغ الفورمان» (the workshop arrival notice)
 *   movements.edit_delete    the admin correction and delete of a movement
 */
export type ServerPermissionKey =
  | 'settings.integrations'
  | 'equipment.location.view'
  | 'movements.notify_foreman'
  | 'movements.edit_delete'

function authenticatedClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** The signed-in caller behind the bearer token, or `unauthorized`. */
async function resolveCaller(
  request: Request,
): Promise<
  { ok: true; supabase: SupabaseClient } | { ok: false; error: 'unauthorized' }
> {
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
  return { ok: true, supabase }
}

/** Throws only when the Supabase variables are missing (the route's 500). */
export async function requireAdmin(
  request: Request,
): Promise<AdminRequestResult> {
  const caller = await resolveCaller(request)
  if (!caller.ok) return caller
  const { supabase } = caller
  const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin')
  if (roleError || isAdmin !== true) {
    return { ok: false, error: 'forbidden' }
  }
  return { ok: true, supabase }
}

/**
 * Requires `has_permission(key)` to answer exactly `true` for the caller.
 * Throws only when the Supabase variables are missing (the route's 500).
 */
export async function requirePermission(
  request: Request,
  key: ServerPermissionKey,
): Promise<AdminRequestResult> {
  const caller = await resolveCaller(request)
  if (!caller.ok) return caller
  const { supabase } = caller
  const { data: allowed, error: permissionError } = await supabase.rpc(
    'has_permission',
    { p_key: key },
  )
  if (permissionError || allowed !== true) {
    return { ok: false, error: 'forbidden' }
  }
  return { ok: true, supabase }
}
