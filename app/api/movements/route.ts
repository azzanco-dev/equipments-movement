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

function movementErrorCode(message: string): string {
  if (message.includes('movement time cannot be in the future'))
    return 'future_time'
  if (message.includes('company_id is required')) return 'company_required'
  if (message.includes('project_id is required')) return 'project_required'
  if (
    message.includes('driver_id is required') ||
    message.includes('invalid driver_id')
  )
    return 'driver_required'
  if (
    message.includes('no prior entry') ||
    message.includes('not inside the gate')
  )
    return 'no_prior_entry'
  if (message.includes('workshop exit must be registered by entry user'))
    return 'workshop_exit_owner'
  if (message.includes('sequence would be invalid')) return 'invalid_sequence'
  return 'movement_save_failed'
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
    const { data: authData, error: authError } =
      await supabase.auth.getUser(accessToken)
    if (authError || !authData.user) {
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
      Number(values.photo_count ?? 0)
    if (
      movementContext === 'workshop' &&
      (!Number.isInteger(intendedPhotoCount) || intendedPhotoCount < 1)
    ) {
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
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
      supervisor_id: authData.user.id,
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
      return NextResponse.json(
        { error: movementErrorCode(insertError.message) },
        { status: 409 },
      )
    }

    const photoUploads: Array<{ path: string; token: string }> = []
    for (const file of photoDescriptors) {
      const safeName =
        file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo'
      const path = `${authData.user.id}/${insertedLog.id}/${crypto.randomUUID()}-${safeName}`
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
      const filePath = `${authData.user.id}/${insertedLog.id}/${crypto.randomUUID()}-${index}-${safeName}`
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
          uploaded_by: authData.user.id,
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
