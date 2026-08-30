import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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
  return error || !data.user ? null : { supabase, user: data.user }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request)
  if (!auth)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  const { data: movement } = await auth.supabase
    .from('entry_exit_logs')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!movement)
    return NextResponse.json({ error: 'movement_not_found' }, { status: 404 })

  const { count } = await auth.supabase
    .from('entry_exit_photos')
    .select('*', { count: 'exact', head: true })
    .eq('entry_exit_log_id', id)

  if (
    (request.headers.get('content-type') ?? '').includes('application/json')
  ) {
    const body = (await request.json().catch(() => null)) as {
      action?: string
      fileName?: string
      contentType?: string
      size?: number
      filePath?: string
      files?: Array<{
        fileName?: string
        contentType?: string
        size?: number
      }>
      filePaths?: string[]
    } | null
    if (body?.action === 'authorize_uploads') {
      const files = body.files ?? []
      const available = MAX_PHOTOS - (count ?? 0)
      if (
        !files.length ||
        files.length > available ||
        files.some(
          (file) =>
            !file.fileName ||
            !file.contentType ||
            !file.size ||
            file.size > MAX_PHOTO_BYTES ||
            !ALLOWED_PHOTO_TYPES.has(file.contentType),
        )
      ) {
        return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
      }

      const uploads = []
      for (const file of files) {
        const safeName =
          file.fileName!.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) ||
          'photo'
        const path = `${auth.user.id}/${id}/${crypto.randomUUID()}-${safeName}`
        const { data: signed, error: signedError } =
          await auth.supabase.storage
            .from('log-photos')
            .createSignedUploadUrl(path)
        if (signedError || !signed?.token) {
          return NextResponse.json(
            { error: 'photo_upload_failed' },
            { status: 502 },
          )
        }
        uploads.push({ path, token: signed.token })
      }
      return NextResponse.json({ uploads }, { status: 201 })
    }

    if (body?.action === 'complete_uploads') {
      const expectedPrefix = `${auth.user.id}/${id}/`
      const filePaths = [...new Set(body.filePaths ?? [])]
      const available = MAX_PHOTOS - (count ?? 0)
      if (
        !filePaths.length ||
        filePaths.length > available ||
        filePaths.some(
          (path) =>
            !path.startsWith(expectedPrefix) ||
            path.slice(expectedPrefix.length).includes('/'),
        )
      ) {
        return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
      }

      const { data: existing } = await auth.supabase
        .from('entry_exit_photos')
        .select('file_path')
        .eq('entry_exit_log_id', id)
        .in('file_path', filePaths)
      const existingPaths = new Set(
        (existing ?? []).map((photo) => photo.file_path),
      )
      const newPaths = filePaths.filter((path) => !existingPaths.has(path))
      if (newPaths.length) {
        const { error: insertError } = await auth.supabase
          .from('entry_exit_photos')
          .insert(
            newPaths.map((filePath, index) => ({
              entry_exit_log_id: id,
              file_path: filePath,
              uploaded_by: auth.user.id,
              sort_order: (count ?? 0) + index,
            })),
          )
        if (insertError) {
          await auth.supabase.storage.from('log-photos').remove(newPaths)
          return NextResponse.json(
            {
              error: insertError.message.includes('maximum 3')
                ? 'max_photos'
                : 'photo_upload_failed',
            },
            { status: 409 },
          )
        }
      }
      return NextResponse.json({ created: newPaths.length }, { status: 201 })
    }

    if (body?.action === 'authorize_upload') {
      if (
        (count ?? 0) >= MAX_PHOTOS ||
        !body.fileName ||
        !body.contentType ||
        !body.size ||
        body.size > MAX_PHOTO_BYTES ||
        !ALLOWED_PHOTO_TYPES.has(body.contentType)
      ) {
        return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
      }
      const safeName =
        body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo'
      const path = `${auth.user.id}/${id}/${crypto.randomUUID()}-${safeName}`
      const { data: signed, error: signedError } = await auth.supabase.storage
        .from('log-photos')
        .createSignedUploadUrl(path)
      if (signedError || !signed?.token) {
        return NextResponse.json(
          { error: 'photo_upload_failed' },
          { status: 502 },
        )
      }
      return NextResponse.json({ path, token: signed.token }, { status: 201 })
    }

    if (body?.action === 'complete_upload') {
      const expectedPrefix = `${auth.user.id}/${id}/`
      if (
        !body.filePath?.startsWith(expectedPrefix) ||
        body.filePath.slice(expectedPrefix.length).includes('/')
      ) {
        return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
      }
      const { data: existing } = await auth.supabase
        .from('entry_exit_photos')
        .select('id')
        .eq('entry_exit_log_id', id)
        .eq('file_path', body.filePath)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ created: 1 }, { status: 200 })
      }
      const { error: insertError } = await auth.supabase
        .from('entry_exit_photos')
        .insert({
          entry_exit_log_id: id,
          file_path: body.filePath,
          uploaded_by: auth.user.id,
          sort_order: count ?? 0,
        })
      if (insertError) {
        await auth.supabase.storage.from('log-photos').remove([body.filePath])
        return NextResponse.json(
          {
            error: insertError.message.includes('maximum 3')
              ? 'max_photos'
              : 'photo_upload_failed',
          },
          { status: 409 },
        )
      }
      return NextResponse.json({ created: 1 }, { status: 201 })
    }

    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
  }

  const form = await request.formData()
  const files = form
    .getAll('photos')
    .filter((item): item is File => item instanceof File)
  const available = MAX_PHOTOS - (count ?? 0)
  if (
    !files.length ||
    files.length > available ||
    files.some(
      (file) =>
        file.size > MAX_PHOTO_BYTES || !ALLOWED_PHOTO_TYPES.has(file.type),
    )
  ) {
    return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
  }

  const created: string[] = []
  for (const [index, file] of files.entries()) {
    const safeName =
      file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || `photo-${index}`
    const path = `${auth.user.id}/${id}/${crypto.randomUUID()}-${index}-${safeName}`
    const { error: uploadError } = await auth.supabase.storage
      .from('log-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError)
      return NextResponse.json(
        { error: 'photo_upload_failed' },
        { status: 502 },
      )
    const { error: insertError } = await auth.supabase
      .from('entry_exit_photos')
      .insert({
        entry_exit_log_id: id,
        file_path: path,
        uploaded_by: auth.user.id,
        sort_order: (count ?? 0) + index,
      })
    if (insertError) {
      await auth.supabase.storage.from('log-photos').remove([path])
      return NextResponse.json(
        {
          error: insertError.message.includes('maximum 3')
            ? 'max_photos'
            : 'photo_upload_failed',
        },
        { status: 409 },
      )
    }
    created.push(path)
  }
  return NextResponse.json({ created: created.length }, { status: 201 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request)
  if (!auth)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    photoId?: string
  } | null
  if (!body?.photoId)
    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
  const { data: photo } = await auth.supabase
    .from('entry_exit_photos')
    .select('id,file_path')
    .eq('id', body.photoId)
    .eq('entry_exit_log_id', id)
    .maybeSingle()
  if (!photo)
    return NextResponse.json({ error: 'photo_not_found' }, { status: 404 })
  const { data: deleted, error: deleteError } = await auth.supabase
    .from('entry_exit_photos')
    .delete()
    .eq('id', photo.id)
    .select('id')
    .maybeSingle()
  if (deleteError || !deleted)
    return NextResponse.json({ error: 'photo_delete_failed' }, { status: 403 })
  await auth.supabase.storage.from('log-photos').remove([photo.file_path])
  return NextResponse.json({ deleted: true })
}
