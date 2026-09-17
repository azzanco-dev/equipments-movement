import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  configuredFieldName,
  currentSystemDriverPayload,
  erpEmployeePayload,
  erpUserPayload,
  parsePublishRequest,
  type ExtractionPublishData,
  type TargetPublishResult,
} from '@/lib/extracting/publish'

export const runtime = 'nodejs'

function authenticatedClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('supabase_not_configured')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function requireAdmin(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice(7)
  const supabase = authenticatedClient(token)
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims(token)
  const userId = claimsData?.claims.sub
  if (claimsError || !userId) return null
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || profile?.role !== 'admin') return null
  return supabase
}

async function publishCurrentSystem(
  supabase: SupabaseClient,
  data: ExtractionPublishData,
): Promise<TargetPublishResult> {
  const { data: existing, error: lookupError } = await supabase
    .from('drivers')
    .select('id')
    .eq('id_number', data.id_number)
    .maybeSingle()
  if (lookupError) return { status: 'failed', error: 'local_lookup_failed' }
  if (existing?.id) return { status: 'existing', id: existing.id }

  const { data: created, error: insertError } = await supabase
    .from('drivers')
    .insert(currentSystemDriverPayload(data))
    .select('id')
    .single()
  if (insertError || !created?.id) {
    const { data: concurrent } = await supabase
      .from('drivers')
      .select('id')
      .eq('id_number', data.id_number)
      .maybeSingle()
    if (concurrent?.id) return { status: 'existing', id: concurrent.id }
    return { status: 'failed', error: 'local_create_failed' }
  }
  return { status: 'created', id: created.id }
}

function erpConfiguration() {
  const baseUrl = process.env.ERPNEXT_BASE_URL?.trim().replace(/\/+$/, '')
  const apiKey = process.env.ERPNEXT_API_KEY?.trim()
  const apiSecret = process.env.ERPNEXT_API_SECRET?.trim()
  if (!baseUrl || !apiKey || !apiSecret) return null
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
      return null
  } catch {
    return null
  }
  return {
    baseUrl,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `token ${apiKey}:${apiSecret}`,
    },
  }
}

async function erpRequest(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data?: Record<string, unknown> }> {
  const config = erpConfiguration()
  if (!config) throw new Error('erp_not_configured')
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...config.headers, ...init.headers },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  })
  let body: Record<string, unknown> | undefined
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, data: body }
}

function resourceName(response: Record<string, unknown> | undefined) {
  const data = response?.data
  if (!data || typeof data !== 'object') return null
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

async function findEmployeeByResidence(idNumber: string) {
  const residenceField = configuredFieldName(
    process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
    'custom_residence_permit_number',
  )
  if (!residenceField) throw new Error('erp_invalid_field_mapping')
  const params = new URLSearchParams({
    fields: JSON.stringify(['name', 'user_id']),
    filters: JSON.stringify([[residenceField, '=', idNumber]]),
    limit_page_length: '1',
  })
  const response = await erpRequest(
    `/api/resource/Employee?${params.toString()}`,
  )
  if (!response.ok) throw new Error('erp_employee_lookup_failed')
  const rows = response.data?.data
  if (!Array.isArray(rows) || !rows.length) return null
  const first = rows[0]
  if (!first || typeof first !== 'object') return null
  const row = first as Record<string, unknown>
  const name = row.name
  if (typeof name !== 'string') return null
  return {
    name,
    userId: typeof row.user_id === 'string' ? row.user_id : '',
  }
}

async function publishErpNext(
  data: ExtractionPublishData,
): Promise<TargetPublishResult> {
  if (!data.email || !data.gender || !data.company || !data.date_of_joining)
    return { status: 'failed', error: 'erp_required_fields_missing' }
  if (!erpConfiguration())
    return { status: 'failed', error: 'erp_not_configured' }

  try {
    let userStatus: TargetPublishResult['status'] = 'existing'
    let employeeStatus: TargetPublishResult['status'] = 'existing'
    let userId = data.email
    const existingEmployee = await findEmployeeByResidence(data.id_number)
    let employeeId = existingEmployee?.name ?? null

    if (existingEmployee?.userId && existingEmployee.userId !== data.email)
      return {
        status: 'failed',
        employeeId: existingEmployee.name,
        steps: { user: 'skipped', employee: 'failed' },
        error: 'erp_employee_user_conflict',
      }

    const userLookup = await erpRequest(
      `/api/resource/User/${encodeURIComponent(data.email)}`,
    )
    if (!userLookup.ok && userLookup.status !== 404)
      throw new Error('erp_user_lookup_failed')
    if (userLookup.status === 404) {
      const createdUser = await erpRequest('/api/resource/User', {
        method: 'POST',
        body: JSON.stringify(erpUserPayload(data)),
      })
      if (!createdUser.ok) throw new Error('erp_user_create_failed')
      userId = resourceName(createdUser.data) ?? data.email
      userStatus = 'created'
    }

    if (existingEmployee && !existingEmployee.userId) {
      const linkedEmployee = await erpRequest(
        `/api/resource/Employee/${encodeURIComponent(existingEmployee.name)}`,
        { method: 'PUT', body: JSON.stringify({ user_id: userId }) },
      )
      if (!linkedEmployee.ok)
        return {
          status: 'partial',
          userId,
          employeeId: existingEmployee.name,
          steps: { user: userStatus, employee: 'failed' },
          error: 'erp_employee_link_failed',
        }
    } else if (!employeeId) {
      const createdEmployee = await erpRequest('/api/resource/Employee', {
        method: 'POST',
        body: JSON.stringify(erpEmployeePayload(data)),
      })
      if (!createdEmployee.ok)
        return {
          status: 'partial',
          userId,
          steps: { user: userStatus, employee: 'failed' },
          error: 'erp_employee_create_failed',
        }
      employeeId = resourceName(createdEmployee.data)
      employeeStatus = 'created'
    }

    return {
      status:
        userStatus === 'created' || employeeStatus === 'created'
          ? 'created'
          : 'existing',
      userId,
      employeeId: employeeId ?? undefined,
      steps: { user: userStatus, employee: employeeStatus },
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const safeCodes = new Set([
      'erp_not_configured',
      'erp_invalid_field_mapping',
      'erp_employee_lookup_failed',
      'erp_user_lookup_failed',
      'erp_user_create_failed',
      'erp_employee_user_conflict',
      'erp_employee_link_failed',
    ])
    return {
      status: 'failed',
      error: safeCodes.has(code) ? code : 'erp_connection_failed',
    }
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await requireAdmin(request)
    if (!supabase)
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const parsed = parsePublishRequest(await request.json())
    if (!parsed)
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })

    const { data, targets } = parsed
    const [currentSystem, erpnext] = await Promise.all([
      targets.currentSystem
        ? publishCurrentSystem(supabase, data)
        : Promise.resolve<TargetPublishResult>({ status: 'skipped' }),
      targets.erpnext
        ? publishErpNext(data)
        : Promise.resolve<TargetPublishResult>({ status: 'skipped' }),
    ])
    return NextResponse.json({ results: { currentSystem, erpnext } })
  } catch {
    return NextResponse.json({ error: 'publish_failed' }, { status: 500 })
  }
}
