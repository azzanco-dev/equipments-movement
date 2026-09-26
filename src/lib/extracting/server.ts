import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export function apiError(code: string, status: number, extra?: object) {
  return NextResponse.json({ error: code, ...extra }, { status })
}

/**
 * Resolves the signed-in admin behind the request's bearer token. The
 * returned client forwards that token, so Supabase RLS stays authoritative.
 */
export async function requireAdmin(
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || profile?.role !== 'admin')
    return { response: apiError('forbidden', 403) }
  return { supabase }
}
