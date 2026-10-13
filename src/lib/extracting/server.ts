import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export function apiError(code: string, status: number, extra?: object) {
  return NextResponse.json({ error: code, ...extra }, { status })
}

/** The permission that opens the extraction page and its routes (0128). */
export const EXTRACTING_PERMISSION = 'extracting.view'

/**
 * Resolves the signed-in user behind the request's bearer token and requires
 * the `extracting.view` permission, decided by `public.has_permission()`
 * called WITH THAT TOKEN (wave 23; while the roles system is inactive the
 * frozen legacy mapping grants it to the admin only). Anything but `true` is
 * forbidden. The returned client forwards the token, so Supabase RLS stays
 * authoritative.
 */
export async function requireExtractingAccess(
  request: Request,
): Promise<{ supabase: SupabaseClient } | { response: NextResponse }> {
  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return { response: apiError('unauthorized', 401) }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { response: apiError('service_unavailable', 503) }

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims(token)
  const userId = claims?.claims?.sub
  if (claimsError || !userId) return { response: apiError('unauthorized', 401) }

  const { data: allowed, error: permissionError } = await supabase.rpc(
    'has_permission',
    { p_key: EXTRACTING_PERMISSION },
  )
  if (permissionError || allowed !== true)
    return { response: apiError('forbidden', 403) }
  return { supabase }
}

/**
 * Whether the caller behind `supabase` (the client returned by
 * `requireExtractingAccess`, carrying the caller's token) passes
 * `public.is_admin()`. Anything but `true` (an error, null, another role) is
 * false. Decides the update ability of the lookup and publish routes,
 * independently of the `extracting.view` permission.
 */
export async function callerIsAdmin(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  return !error && data === true
}
