import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

// storage-cleanup — the orphan cleanup of the movement-photo bucket.
//
// Audit run-1 (2026-10-18), lead B-9: an object of the `log-photos` bucket
// that no `entry_exit_photos.file_path`, no legacy `entry_exit_logs.photo_url`
// and no unexpired `pending_movement_photo_batches` row references is
// invisible to every application path and was never removed; the expired
// staging batches were removed only inside their own uploader's next upload.
//
// The caller is identified with the anon-key client carrying the caller's
// Authorization header and must hold `movements.photos.delete_any`, decided
// by public.has_permission() (migration 0126) evaluated AS THE CALLER. The
// service-role client is used only afterwards, to read the whole bucket and
// the reference tables and to remove the orphans. The Next server has no
// service-role key, which is why this lives in an Edge Function.
//
// Body: { dry_run: boolean, older_than_hours?: number } (default 2 hours,
// minimum 1; an object younger than that is never an orphan, so a photo being
// linked to its movement right now is safe). Only the `log-photos` bucket is
// ever read or written; nothing referenced is ever removed; nothing but
// counts is logged.

const BUCKET = 'log-photos'
const PAGE_SIZE = 1000
const REMOVE_BATCH_SIZE = 100
const DEFAULT_OLDER_THAN_HOURS = 2
const MIN_OLDER_THAN_HOURS = 1
const MAX_OLDER_THAN_HOURS = 24 * 365

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type StoredObject = { name: string; createdAt: number; bytes: number }

type ListEntry = {
  name: string
  id: string | null
  created_at?: string | null
  metadata?: { size?: unknown } | null
}

type Client = ReturnType<typeof createClient>

/**
 * Every object of the bucket, walking the <uploader>/<folder>/<file> tree
 * (Storage lists one level at a time: an entry without an id is a folder).
 */
async function listBucket(client: Client): Promise<StoredObject[]> {
  const objects: StoredObject[] = []
  const folders: string[] = ['']
  while (folders.length) {
    const prefix = folders.pop() as string
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.storage
        .from(BUCKET)
        .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name' } })
      if (error) throw new Error('bucket_list_failed')
      const entries = (data ?? []) as ListEntry[]
      for (const entry of entries) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.id === null) {
          folders.push(name)
          continue
        }
        const createdAt = entry.created_at
          ? Date.parse(entry.created_at)
          : Number.NaN
        const size = Number(entry.metadata?.size ?? 0)
        objects.push({
          name,
          // An object whose age is unknown is treated as new (never deleted).
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          bytes: Number.isFinite(size) && size > 0 ? size : 0,
        })
      }
      if (entries.length < PAGE_SIZE) break
    }
  }
  return objects
}

/** Every value of one text column, read in pages (NULLs skipped). */
async function columnValues(
  client: Client,
  table: string,
  column: string,
): Promise<string[]> {
  const values: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(column)
      .not(column, 'is', null)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}_read_failed`)
    const rows = (data ?? []) as Record<string, unknown>[]
    for (const row of rows) {
      const value = row[column]
      if (typeof value === 'string' && value) values.push(value)
    }
    if (rows.length < PAGE_SIZE) break
  }
  return values
}

/** The names every application path still reaches. */
async function referencedNames(client: Client, nowIso: string) {
  const referenced = new Set<string>()
  for (const name of await columnValues(
    client,
    'entry_exit_photos',
    'file_path',
  ))
    referenced.add(name)
  for (const name of await columnValues(client, 'entry_exit_logs', 'photo_url'))
    referenced.add(name)
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('pending_movement_photo_batches')
      .select('file_paths')
      .gt('expires_at', nowIso)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error('pending_batches_read_failed')
    const rows = (data ?? []) as { file_paths: unknown }[]
    for (const row of rows)
      if (Array.isArray(row.file_paths))
        for (const name of row.file_paths)
          if (typeof name === 'string' && name) referenced.add(name)
    if (rows.length < PAGE_SIZE) break
  }
  return referenced
}

function olderThanHours(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_OLDER_THAN_HOURS
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < MIN_OLDER_THAN_HOURS || value > MAX_OLDER_THAN_HOURS) return null
  return value
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // The caller's own client (anon key + the caller's Authorization header):
    // it identifies the caller and decides what he may do.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    // The decision, as the caller, exactly `true`: anything else (an error
    // included) is forbidden. The service-role client is created only after
    // it, for the bucket-wide reads and the removals below.
    const { data: canDeleteAny, error: permissionError } = await userClient.rpc(
      'has_permission',
      {
        p_key: 'movements.photos.delete_any',
      },
    )
    if (permissionError || canDeleteAny !== true)
      return json({ error: 'Forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Invalid body', code: 'invalid_body' }, 400)
    // Anything but an explicit `false` is a dry run.
    const dryRun = body.dry_run !== false
    const hours = olderThanHours(body.older_than_hours)
    if (hours === null)
      return json(
        { error: 'Invalid older_than_hours', code: 'invalid_hours' },
        400,
      )

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const cutoff = now - hours * 60 * 60 * 1000

    const [objects, referenced] = await Promise.all([
      listBucket(adminClient),
      referencedNames(adminClient, nowIso),
    ])
    const orphans = objects.filter(
      (object) => !referenced.has(object.name) && object.createdAt <= cutoff,
    )
    const { count: expiredBatches, error: countError } = await adminClient
      .from('pending_movement_photo_batches')
      .select('id', { count: 'exact', head: true })
      .lte('expires_at', nowIso)
    if (countError) return json({ error: 'Could not read batches' }, 500)

    if (dryRun) {
      // Counts and bytes per uploader folder (the first path segment); no
      // object names leave the function.
      const folders = new Map<string, { objects: number; bytes: number }>()
      let bytes = 0
      for (const orphan of orphans) {
        const folder = orphan.name.split('/')[0] ?? ''
        const entry = folders.get(folder) ?? { objects: 0, bytes: 0 }
        entry.objects += 1
        entry.bytes += orphan.bytes
        folders.set(folder, entry)
        bytes += orphan.bytes
      }
      return json({
        dry_run: true,
        older_than_hours: hours,
        total_objects: objects.length,
        orphan_objects: orphans.length,
        orphan_bytes: bytes,
        expired_batches: expiredBatches ?? 0,
        folders: [...folders.entries()].map(([folder, entry]) => ({
          folder,
          objects: entry.objects,
          bytes: entry.bytes,
        })),
      })
    }

    let deletedObjects = 0
    let freedBytes = 0
    for (let at = 0; at < orphans.length; at += REMOVE_BATCH_SIZE) {
      const batch = orphans.slice(at, at + REMOVE_BATCH_SIZE)
      const { data, error: removeError } = await adminClient.storage
        .from(BUCKET)
        .remove(batch.map((object) => object.name))
      if (removeError) {
        console.error('storage-cleanup: a removal batch failed', {
          deleted_objects: deletedObjects,
        })
        return json(
          {
            error: 'Removal failed',
            code: 'remove_failed',
            deleted_objects: deletedObjects,
            freed_bytes: freedBytes,
          },
          500,
        )
      }
      const removed = new Set(
        ((data ?? []) as { name?: string }[]).map((item) => item.name),
      )
      for (const object of batch) {
        if (removed.size && !removed.has(object.name)) continue
        deletedObjects += 1
        freedBytes += object.bytes
      }
    }

    const { data: deletedRows, error: batchError } = await adminClient
      .from('pending_movement_photo_batches')
      .delete()
      .lte('expires_at', nowIso)
      .select('id')
    if (batchError)
      return json(
        {
          error: 'Could not delete expired batches',
          code: 'batches_failed',
          deleted_objects: deletedObjects,
          freed_bytes: freedBytes,
        },
        500,
      )
    const deletedBatches = (deletedRows ?? []).length
    console.log('storage-cleanup: done', {
      deleted_objects: deletedObjects,
      freed_bytes: freedBytes,
      deleted_batches: deletedBatches,
    })
    return json({
      dry_run: false,
      older_than_hours: hours,
      deleted_objects: deletedObjects,
      freed_bytes: freedBytes,
      deleted_batches: deletedBatches,
    })
  } catch (error) {
    console.error(
      'storage-cleanup failed',
      error instanceof Error ? error.message : 'unknown',
    )
    return json({ error: 'Unexpected error' }, 500)
  }
})
