import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function movementErrorCode(message: string): string {
  if (message.includes('movement time cannot be in the future')) return 'future_time';
  if (message.includes('company_id is required')) return 'company_required';
  if (message.includes('project_id is required')) return 'project_required';
  if (message.includes('driver_id is required') || message.includes('invalid driver_id')) return 'driver_required';
  if (message.includes('no prior entry') || message.includes('not inside the gate')) return 'no_prior_entry';
  if (message.includes('sequence would be invalid')) return 'invalid_sequence';
  return 'movement_save_failed';
}

function authenticatedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const accessToken = authorization.slice(7);
    const supabase = authenticatedClient(accessToken);
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const form = await request.formData();
    const movementType = form.get('movement_type');
    const equipmentId = form.get('equipment_id');
    if ((movementType !== 'entry' && movementType !== 'exit') || typeof equipmentId !== 'string' || !equipmentId) {
      return NextResponse.json({ error: 'invalid_movement_payload' }, { status: 400 });
    }

    const photos = form.getAll('photos').filter((value): value is File => value instanceof File);
    if (photos.length > MAX_PHOTOS || photos.some((file) => file.size > MAX_PHOTO_BYTES || !ALLOWED_PHOTO_TYPES.has(file.type))) {
      return NextResponse.json({ error: 'invalid_photos' }, { status: 400 });
    }

    const value = (name: string) => {
      const item = form.get(name);
      return typeof item === 'string' && item.trim() ? item.trim() : null;
    };
    const payload: Record<string, unknown> = {
      equipment_id: equipmentId,
      supervisor_id: authData.user.id,
      movement_type: movementType,
      registration_method: value('registration_method') === 'qr' ? 'qr' : 'manual',
      driver_name: value('driver_name'),
      notes: value('notes'),
    };
    if (movementType === 'entry') {
      payload.driver_id = value('driver_id');
      payload.company_id = value('company_id');
      payload.project_id = value('project_id');
      payload.contractor_equipment_code = value('contractor_equipment_code');
    }
    const recordedAt = value('recorded_at');
    if (recordedAt) payload.recorded_at = recordedAt;

    const { data: insertedLog, error: insertError } = await supabase
      .from('entry_exit_logs').insert(payload).select('id').single();
    if (insertError) {
      console.error('Movement insert failed', insertError);
      return NextResponse.json({ error: movementErrorCode(insertError.message) }, { status: 409 });
    }

    let photoFailures = 0;
    for (const [index, file] of photos.entries()) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || `photo-${index}`;
      const filePath = `${authData.user.id}/${insertedLog.id}/${crypto.randomUUID()}-${index}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('log-photos').upload(filePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) {
        photoFailures += 1;
        continue;
      }
      const { error: photoError } = await supabase.from('entry_exit_photos').insert({
        entry_exit_log_id: insertedLog.id,
        file_path: filePath,
        uploaded_by: authData.user.id,
        sort_order: index,
      });
      if (photoError) {
        await supabase.storage.from('log-photos').remove([filePath]);
        photoFailures += 1;
      }
    }

    return NextResponse.json({ id: insertedLog.id, photoFailures }, { status: 201 });
  } catch (error) {
    console.error('Create movement failed', error);
    return NextResponse.json({ error: 'movement_save_failed' }, { status: 500 });
  }
}
