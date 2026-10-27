import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface PhotoDescriptor {
  fileName: string
  contentType: string
  size: number
}

function clientFor(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function authenticate(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  const supabase = clientFor(token)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile) return null
  // The assigned role decides (owner 2026-10-27, roles stage 2): the
  // legacy role blocked `monitor` here; `movements.photos.manage` is
  // the key the database re-checks (can_write_movement_photos), held by
  // every role but the monitor in the legacy mapping.
  const { data: allowed } = await supabase.rpc('has_permission', {
    p_key: 'movements.photos.manage',
  })
  return { supabase, user: data.user, canManagePhotos: allowed === true }
}

function validFiles(value: unknown): value is PhotoDescriptor[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_PHOTOS &&
    value.every(
      (file) =>
        typeof file === 'object' &&
        file !== null &&
        typeof file.fileName === 'string' &&
        file.fileName.length > 0 &&
        typeof file.contentType === 'string' &&
        ALLOWED_PHOTO_TYPES.has(file.contentType) &&
        typeof file.size === 'number' &&
        file.size > 0 &&
        file.size <= MAX_PHOTO_BYTES,
    )
  )
}

export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (!auth)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!auth.canManagePhotos)
    return NextResponse.json({ error: 'access_denied' }, { status: 403 })

  const { data: expiredBatches } = await auth.supabase
    .from('pending_movement_photo_batches')
    .select('id,file_paths')
    .eq('uploaded_by', auth.user.id)
    .lte('expires_at', new Date().toISOString())
  for (const expired of expiredBatches ?? []) {
    await auth.supabase.storage.from('log-photos').remove(expired.file_paths)
    await auth.supabase
      .from('pending_movement_photo_batches')
      .delete()
      .eq('id', expired.id)
  }

  const body = (await request.json().catch(() => null)) as {
    files?: unknown
  } | null
  if (!validFiles(body?.files))
    return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })

  const batchId = crypto.randomUUID()
  const files = body.files
  const paths = files.map((file, index) => {
    const safeName =
      file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) ||
      `photo-${index}.jpg`
    return `${auth.user.id}/${batchId}/${crypto.randomUUID()}-${safeName}`
  })
  const { error: batchError } = await auth.supabase
    .from('pending_movement_photo_batches')
    .insert({
      id: batchId,
      uploaded_by: auth.user.id,
      file_paths: paths,
      expected_files: files,
    })
  if (batchError) {
    console.error('Pending photo batch creation failed', batchError.message)
    return NextResponse.json(
      { error: 'photo_authorization_failed' },
      { status: 502 },
    )
  }

  const uploads = []
  for (const path of paths) {
    const { data, error } = await auth.supabase.storage
      .from('log-photos')
      .createSignedUploadUrl(path)
    if (error || !data?.token) {
      await auth.supabase
        .from('pending_movement_photo_batches')
        .delete()
        .eq('id', batchId)
      return NextResponse.json(
        { error: 'photo_authorization_failed' },
        { status: 502 },
      )
    }
    uploads.push({ path, token: data.token })
  }

  return NextResponse.json({ batchId, uploads }, { status: 201 })
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request)
  if (!auth)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    batchId?: string
  } | null
  if (!body?.batchId)
    return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })

  const { data: batch } = await auth.supabase
    .from('pending_movement_photo_batches')
    .select('file_paths')
    .eq('id', body.batchId)
    .eq('uploaded_by', auth.user.id)
    .maybeSingle()
  if (!batch) return NextResponse.json({ removed: 0 })

  await auth.supabase.storage.from('log-photos').remove(batch.file_paths)
  await auth.supabase
    .from('pending_movement_photo_batches')
    .delete()
    .eq('id', body.batchId)
  return NextResponse.json({ removed: batch.file_paths.length })
}
