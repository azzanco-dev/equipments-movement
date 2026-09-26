import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  movementAdminErrorCode,
  movementAdminErrorStatus,
} from '@/lib/movementErrors'

export const runtime = 'nodejs'

function client(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Resolves the bearer token and the caller's role. The database functions all
 * re-check the role and fail closed, so this is only a cheap early 403 that
 * also keeps a non-admin from probing whether a movement exists.
 */
async function authenticateAdmin(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return { status: 401 as const }
  const token = header.slice(7)
  const supabase = client(token)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle()
  if (profile?.role !== 'admin') return { status: 403 as const }
  return { status: 200 as const, supabase }
}

/**
 * wave6-J4 — the ONE admin correction of a movement.
 *
 * Body (every key is read; ids are strings, missing ids are null):
 *   { equipment_id, supervisor_id, recorded_at, company_id, project_id,
 *     contractor_equipment_code, driver_id, notes }
 *
 * `admin_update_movement` (migration 0105) is authoritative: it re-checks the
 * admin role fail-closed, writes every field in one transaction, re-checks the
 * ENTRY/EXIT sequence and refuses an in-place driver change on an open site
 * visit (that change goes through `change_active_movement_driver`). `notes`
 * is always sent as the full note: '' clears it, a missing note keeps it.
 * Every argument is passed by name so PostgREST resolves the single
 * nine-argument signature. Errors are mapped to stable safe codes.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.status !== 200)
      return NextResponse.json(
        { error: auth.status === 401 ? 'unauthorized' : 'access_denied' },
        { status: auth.status },
      )
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'invalid_movement_payload' },
        { status: 400 },
      )
    const text = (key: string) =>
      typeof body[key] === 'string' && body[key] ? (body[key] as string) : null
    const notes = typeof body.notes === 'string' ? body.notes : null

    const { error } = await auth.supabase.rpc('admin_update_movement', {
      p_movement_id: id,
      p_equipment_id: text('equipment_id'),
      p_supervisor_id: text('supervisor_id'),
      p_recorded_at: text('recorded_at'),
      p_company_id: text('company_id'),
      p_project_id: text('project_id'),
      p_contractor_equipment_code: text('contractor_equipment_code'),
      p_driver_id: text('driver_id'),
      p_notes: notes,
    })
    if (error) {
      console.error('Movement update failed', error.code ?? 'unknown_error')
      const code = movementAdminErrorCode(error.message, 'update')
      return NextResponse.json(
        { error: code },
        { status: movementAdminErrorStatus(code) },
      )
    }
    return NextResponse.json({ id })
  } catch (error) {
    console.error('Movement update failed', error)
    return NextResponse.json(
      { error: 'movement_update_failed' },
      { status: 500 },
    )
  }
}

/**
 * wave6-J3 — admin delete of one movement.
 *
 * `admin_delete_movement` (migration 0104) is authoritative: it re-checks the
 * admin role, refuses any row that is not the last movement of its
 * (equipment, context) sequence, removes the driver-change and photo rows in
 * the same transaction, writes the audit rows, and returns the Storage paths.
 *
 * Storage is not transactional with PostgreSQL. Once the RPC has committed the
 * movement IS deleted, so a failed object cleanup is reported as
 * `storage_cleanup: 'pending'` on a 200 response — never as a failed delete.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.status !== 200)
      return NextResponse.json(
        { error: auth.status === 401 ? 'unauthorized' : 'access_denied' },
        { status: auth.status },
      )
    const { id } = await context.params

    const { data, error } = await auth.supabase.rpc('admin_delete_movement', {
      p_log_id: id,
    })
    if (error) {
      console.error('Movement delete failed', error)
      const code = movementAdminErrorCode(error.message, 'delete')
      return NextResponse.json(
        { error: code },
        { status: movementAdminErrorStatus(code) },
      )
    }

    const paths = Array.isArray(data)
      ? (data as unknown[]).filter(
          (path): path is string => typeof path === 'string' && path.length > 0,
        )
      : []
    // Cleaned up with the ADMIN'S OWN token, so Storage RLS stays
    // authoritative: migration 0104 lets an admin delete a `log-photos`
    // object whose rows this call has just removed.
    let cleaned = true
    if (paths.length) {
      const { error: removeError } = await auth.supabase.storage
        .from('log-photos')
        .remove(paths)
      if (removeError) {
        cleaned = false
        console.error('Movement photo objects were not removed', removeError)
      }
    }

    return NextResponse.json({
      deleted: true,
      photos: paths.length,
      storage_cleanup: cleaned ? 'done' : 'pending',
    })
  } catch (error) {
    // Reached only before the RPC ran (bad configuration, unreadable request),
    // so nothing has been deleted yet.
    console.error('Movement delete failed', error)
    return NextResponse.json(
      { error: 'movement_delete_failed' },
      { status: 500 },
    )
  }
}
