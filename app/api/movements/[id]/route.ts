import { NextResponse } from 'next/server'
import {
  movementAdminErrorCode,
  movementAdminErrorStatus,
} from '@/lib/movementErrors'
import { requirePermission } from '@/lib/server/adminRequest'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

// Audit run-1 hardening (2026-10-18): both handlers gate on
// `movements.edit_delete` through the shared `requirePermission` (the
// caller's token, has_permission() with it, exactly `true`), the same key
// `admin_update_movement` / `admin_delete_movement` decide by. Before, the
// route read the legacy admin role from profiles. The database functions re-check the key
// fail-closed; this is only the cheap early 401/403 that also keeps a caller
// without the key from probing whether a movement exists. The client that
// comes back carries the caller's token, so RLS stays authoritative.

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
    const access = await requirePermission(request, 'movements.edit_delete')
    if (!access.ok) {
      return NextResponse.json(
        {
          error:
            access.error === 'unauthorized' ? 'unauthorized' : 'access_denied',
        },
        { status: access.error === 'unauthorized' ? 401 : 403 },
      )
    }
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

    const { error } = await access.supabase.rpc('admin_update_movement', {
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
    const access = await requirePermission(request, 'movements.edit_delete')
    if (!access.ok) {
      return NextResponse.json(
        {
          error:
            access.error === 'unauthorized' ? 'unauthorized' : 'access_denied',
        },
        { status: access.error === 'unauthorized' ? 401 : 403 },
      )
    }
    const { id } = await context.params

    const { data, error } = await access.supabase.rpc('admin_delete_movement', {
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
      const { error: removeError } = await access.supabase.storage
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
