import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { movementErrorCode, movementErrorStatus } from '@/lib/movementErrors'

export const runtime = 'nodejs'

const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface PhotoDescriptor {
  fileName: string
  contentType: string
  size: number
}

function authenticatedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const accessToken = authorization.slice(7)
    const supabase = authenticatedClient(accessToken)
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims(accessToken)
    const userId = claimsData?.claims.sub
    if (authError || !userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') ?? ''
    let photos: File[] = []
    let values: Record<string, unknown> = {}
    if (contentType.includes('application/json')) {
      values = (await request.json()) as Record<string, unknown>
    } else {
      const form = await request.formData()
      photos = form
        .getAll('photos')
        .filter((value): value is File => value instanceof File)
      for (const key of [
        'equipment_id',
        'movement_type',
        'movement_context',
        'registration_method',
        'driver_id',
        'driver_name',
        'company_id',
        'project_id',
        'contractor_equipment_code',
        'notes',
        'recorded_at',
      ]) {
        values[key] = form.get(key)
      }
    }
    const value = (name: string) => {
      const item = values[name]
      return typeof item === 'string' && item.trim() ? item.trim() : null
    }
    const movementType = value('movement_type')
    const movementContext =
      value('movement_context') === 'workshop' ? 'workshop' : 'site'
    const equipmentId = value('equipment_id')
    if ((movementType !== 'entry' && movementType !== 'exit') || !equipmentId) {
      return NextResponse.json(
        { error: 'invalid_movement_payload' },
        { status: 400 },
      )
    }

    // Each staged photo is its own batch, so a movement can carry several.
    const uploadBatchIds: string[] = []
    for (const candidate of [
      ...(Array.isArray(values.upload_batch_ids)
        ? values.upload_batch_ids
        : []),
      values.upload_batch_id,
    ]) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      const batchId = candidate.trim()
      if (!uploadBatchIds.includes(batchId)) uploadBatchIds.push(batchId)
    }
    if (uploadBatchIds.length > MAX_PHOTOS) {
      return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
    }

    const { data: pendingBatchRows, error: pendingBatchError } =
      uploadBatchIds.length
        ? await supabase
            .from('pending_movement_photo_batches')
            .select('id,file_paths,expected_files,expires_at')
            .in('id', uploadBatchIds)
            .eq('uploaded_by', userId)
        : { data: [], error: null }
    const pendingBatches = uploadBatchIds.map((batchId) =>
      (pendingBatchRows ?? []).find(
        (row: { id: string }) => row.id === batchId,
      ),
    )
    if (
      pendingBatchError ||
      pendingBatches.some(
        (batch) => !batch || new Date(batch.expires_at).getTime() <= Date.now(),
      )
    ) {
      return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
    }
    const pendingPaths = pendingBatches.flatMap(
      (batch) => (batch?.file_paths ?? []) as string[],
    )
    if (pendingPaths.length > MAX_PHOTOS) {
      return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
    }

    const photoDescriptors = Array.isArray(values.photo_files)
      ? values.photo_files.filter(
          (item): item is PhotoDescriptor =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as PhotoDescriptor).fileName === 'string' &&
            typeof (item as PhotoDescriptor).contentType === 'string' &&
            typeof (item as PhotoDescriptor).size === 'number',
        )
      : []
    const intendedPhotoCount =
      photos.length ||
      photoDescriptors.length ||
      pendingPaths.length ||
      Number(values.photo_count ?? 0)
    // Workshop movements need real photos: multipart files or staged batches
    // (verified in Storage below). A client-reported count is not enough.
    const verifiablePhotoCount = photos.length || pendingPaths.length
    if (movementContext === 'workshop' && verifiablePhotoCount < 1) {
      return NextResponse.json({ error: 'photo_required' }, { status: 400 })
    }
    if (
      intendedPhotoCount > MAX_PHOTOS ||
      photos.length > MAX_PHOTOS ||
      photoDescriptors.length > MAX_PHOTOS ||
      photos.some(
        (file) =>
          file.size > MAX_PHOTO_BYTES || !ALLOWED_PHOTO_TYPES.has(file.type),
      ) ||
      photoDescriptors.some(
        (file) =>
          file.size > MAX_PHOTO_BYTES ||
          !ALLOWED_PHOTO_TYPES.has(file.contentType),
      )
    ) {
      return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
    }

    for (const batch of pendingBatches) {
      if (!batch) continue
      const expectedPrefix = `${userId}/${batch.id}/`
      if (
        (batch.file_paths as string[]).some(
          (path: string) =>
            !path.startsWith(expectedPrefix) ||
            path.slice(expectedPrefix.length).includes('/'),
        )
      ) {
        return NextResponse.json({ error: 'invalid_photos' }, { status: 400 })
      }
      const { data: storedObjects, error: listError } = await supabase.storage
        .from('log-photos')
        .list(`${userId}/${batch.id}`, { limit: MAX_PHOTOS + 1 })
      const storedNames = new Set(
        (storedObjects ?? []).map((item) => item.name),
      )
      const allFilesExist = (batch.file_paths as string[]).every(
        (path: string) => storedNames.has(path.slice(expectedPrefix.length)),
      )
      if (listError || !allFilesExist) {
        return NextResponse.json(
          { error: 'photos_not_uploaded' },
          { status: 409 },
        )
      }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
    if (
      !profile ||
      (movementContext === 'workshop'
        ? ![
            'admin',
            'workshop',
            'assistant_workshop_manager',
            'workshop_manager',
          ].includes(profile.role)
        : !['admin', 'supervisor'].includes(profile.role))
    ) {
      return NextResponse.json({ error: 'access_denied' }, { status: 403 })
    }

    const payload: Record<string, unknown> = {
      equipment_id: equipmentId,
      supervisor_id: userId,
      movement_type: movementType,
      movement_context: movementContext,
      registration_method:
        value('registration_method') === 'qr' ? 'qr' : 'manual',
      driver_name: value('driver_name'),
      notes: value('notes'),
    }
    if (movementType === 'entry') {
      payload.driver_id = value('driver_id')
      payload.company_id = value('company_id')
      payload.project_id = value('project_id')
      payload.contractor_equipment_code = value('contractor_equipment_code')
    }
    const recordedAt = value('recorded_at')
    if (recordedAt) payload.recorded_at = recordedAt

    const { data: insertedLog, error: insertError } = await supabase
      .from('entry_exit_logs')
      .insert(payload)
      .select('id')
      .single()
    if (insertError) {
      console.error('Movement insert failed', insertError)
      const errorCode = movementErrorCode(insertError.message)
      return NextResponse.json(
        { error: errorCode },
        { status: movementErrorStatus(errorCode) },
      )
    }

    if (pendingPaths.length) {
      const { error: photoError } = await supabase
        .from('entry_exit_photos')
        .insert(
          pendingPaths.map((filePath: string, index: number) => ({
            entry_exit_log_id: insertedLog.id,
            file_path: filePath,
            uploaded_by: userId,
            sort_order: index,
          })),
        )
      if (photoError) {
        console.error('Pending movement photos link failed', photoError.message)
        await supabase.storage.from('log-photos').remove(pendingPaths)
        await supabase
          .from('pending_movement_photo_batches')
          .delete()
          .in('id', uploadBatchIds)
        return NextResponse.json(
          { id: insertedLog.id, photoFailures: pendingPaths.length },
          { status: 201 },
        )
      }
      await supabase
        .from('pending_movement_photo_batches')
        .delete()
        .in('id', uploadBatchIds)
      return NextResponse.json(
        { id: insertedLog.id, photoFailures: 0 },
        { status: 201 },
      )
    }

    const photoUploads: Array<{ path: string; token: string }> = []
    for (const file of photoDescriptors) {
      const safeName =
        file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo'
      const path = `${userId}/${insertedLog.id}/${crypto.randomUUID()}-${safeName}`
      const { data: signed, error: signedError } = await supabase.storage
        .from('log-photos')
        .createSignedUploadUrl(path)
      if (signedError || !signed?.token) break
      photoUploads.push({ path, token: signed.token })
    }

    let photoFailures = 0
    for (const [index, file] of photos.entries()) {
      const safeName =
        file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) ||
        `photo-${index}`
      const filePath = `${userId}/${insertedLog.id}/${crypto.randomUUID()}-${index}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('log-photos')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        })
      if (uploadError) {
        photoFailures += 1
        continue
      }
      const { error: photoError } = await supabase
        .from('entry_exit_photos')
        .insert({
          entry_exit_log_id: insertedLog.id,
          file_path: filePath,
          uploaded_by: userId,
          sort_order: index,
        })
      if (photoError) {
        await supabase.storage.from('log-photos').remove([filePath])
        photoFailures += 1
      }
    }

    return NextResponse.json(
      { id: insertedLog.id, photoFailures, photoUploads },
      { status: 201 },
    )
  } catch (error) {
    console.error('Create movement failed', error)
    return NextResponse.json({ error: 'movement_save_failed' }, { status: 500 })
  }
}
