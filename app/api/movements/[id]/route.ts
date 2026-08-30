import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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

function errorCode(message: string) {
  if (message.includes('admin_required')) return ['access_denied', 403] as const
  if (message.includes('movement_not_found'))
    return ['movement_not_found', 404] as const
  if (message.includes('driver_already_assigned'))
    return ['driver_already_assigned', 409] as const
  if (message.includes('invalid_sequence'))
    return ['invalid_sequence', 409] as const
  if (message.includes('future_time')) return ['future_time', 409] as const
  return ['movement_update_failed', 409] as const
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer '))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const token = authorization.slice(7)
    const supabase = client(token)
    const { id } = await context.params
    const body = (await request.json()) as Record<string, unknown>
    const text = (key: string) =>
      typeof body[key] === 'string' && body[key] ? body[key] : null

    const { error } = await supabase.rpc('admin_update_movement', {
      p_movement_id: id,
      p_equipment_id: text('equipment_id'),
      p_supervisor_id: text('supervisor_id'),
      p_recorded_at: text('recorded_at'),
      p_company_id: text('company_id'),
      p_project_id: text('project_id'),
      p_contractor_equipment_code: text('contractor_equipment_code'),
      p_driver_id: text('driver_id'),
    })
    if (error) {
      console.error('Movement update failed', error)
      const [code, status] = errorCode(error.message)
      return NextResponse.json({ error: code }, { status })
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
