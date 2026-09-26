import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  configuredFieldName,
  currentSystemDriverPayload,
  erpErrorDetails,
  erpEmployeePayload,
  erpUserPayload,
  missingErpFields,
  parsePublishRequest,
  type ExtractionPublishData,
  type PublishStatus,
  type TargetPublishResult,
} from '@/lib/extracting/publish'
import { apiError, requireAdmin } from '@/lib/extracting/server'

export const runtime = 'nodejs'

const SKIPPED: TargetPublishResult = { status: 'skipped' }

async function publishCurrentSystem(
  supabase: SupabaseClient,
  data: ExtractionPublishData,
): Promise<TargetPublishResult> {
  const findDriver = () =>
    supabase
      .from('drivers')
      .select('id')
      .eq('id_number', data.id_number)
      .maybeSingle()

  const { data: existing, error: lookupError } = await findDriver()
  if (lookupError) return { status: 'failed', error: 'local_lookup_failed' }
  if (existing?.id) return { status: 'existing', id: existing.id }

  const { data: created, error: insertError } = await supabase
    .from('drivers')
    .insert(currentSystemDriverPayload(data))
    .select('id')
    .single()
  if (insertError || !created?.id) {
    // A concurrent publish may have inserted the same identity first.
    const { data: concurrent } = await findDriver()
    if (concurrent?.id) return { status: 'existing', id: concurrent.id }
    return { status: 'failed', error: 'local_create_failed' }
  }
  return { status: 'created', id: created.id }
}

/** A known ERPNext failure whose code the screen can explain. */
class ErpError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

type ErpResponse = {
  ok: boolean
  status: number
  data?: Record<string, unknown>
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

type ErpConfig = NonNullable<ReturnType<typeof erpConfiguration>>

function createErpClient(config: ErpConfig) {
  return async function erpRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<ErpResponse> {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...config.headers, ...init.headers },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })
    const data = (await response.json().catch(() => undefined)) as
      Record<string, unknown> | undefined
    return { ok: response.ok, status: response.status, data }
  }
}

type ErpRequest = ReturnType<typeof createErpClient>

function resourceName(response: Record<string, unknown> | undefined) {
  const data = response?.data
  if (!data || typeof data !== 'object') return null
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

function listRows(response: ErpResponse): Record<string, unknown>[] {
  const rows = response.data?.data
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === 'object',
      )
    : []
}

function listQuery(fields: string[], filters: unknown[], limit: number) {
  return new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
  }).toString()
}

async function findEmployeeByResidence(erp: ErpRequest, idNumber: string) {
  const residenceField = configuredFieldName(
    process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
    'custom_residence_permit_number',
  )
  if (!residenceField) throw new ErpError('erp_invalid_field_mapping')
  const response = await erp(
    `/api/resource/Employee?${listQuery(
      ['name', 'user_id', 'cell_number'],
      [[residenceField, '=', idNumber]],
      1,
    )}`,
  )
  if (!response.ok) throw new ErpError('erp_employee_lookup_failed')
  const row = listRows(response)[0]
  if (!row || typeof row.name !== 'string') return null
  return {
    name: row.name,
    userId: typeof row.user_id === 'string' ? row.user_id : '',
    cellNumber: typeof row.cell_number === 'string' ? row.cell_number : '',
  }
}

const STANDARD_EMPLOYEE_FIELDS = [
  'first_name',
  'user_id',
  'status',
  'gender',
  'date_of_birth',
  'date_of_joining',
  'company',
  'employment_type',
  'department',
  'designation',
  'cell_number',
  'ctc',
  'employee_number',
]

async function employeeFieldNames(erp: ErpRequest) {
  const response = await erp(
    `/api/resource/Custom%20Field?${listQuery(
      ['fieldname'],
      [['dt', '=', 'Employee']],
      500,
    )}`,
  )
  if (!response.ok) throw new ErpError('erp_employee_metadata_failed')
  const names = new Set(STANDARD_EMPLOYEE_FIELDS)
  for (const row of listRows(response))
    if (typeof row.fieldname === 'string') names.add(row.fieldname)
  return names
}

async function erpLinkExists(erp: ErpRequest, doctype: string, name: string) {
  if (!name) return true
  const response = await erp(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  )
  if (response.status === 404) return false
  if (!response.ok) throw new ErpError('erp_reference_lookup_failed')
  return true
}

/** Returns the error code of the first link value missing in ERPNext. */
async function invalidErpReference(
  erp: ErpRequest,
  data: ExtractionPublishData,
) {
  const checks: Array<[string, string, string]> = [
    ['Gender', data.gender, 'erp_gender_not_found'],
    ['Company', data.company, 'erp_company_not_found'],
    ['Employment Type', data.employment_type, 'erp_employment_type_not_found'],
    ['Department', data.department, 'erp_department_not_found'],
    ['Designation', data.occupation, 'erp_designation_not_found'],
  ]
  const exists = await Promise.all(
    checks.map(([doctype, name]) => erpLinkExists(erp, doctype, name)),
  )
  const index = exists.indexOf(false)
  return index === -1 ? null : checks[index][2]
}

/** Ensures the ERPNext user exists; returns its id and whether it was new. */
async function ensureErpUser(erp: ErpRequest, data: ExtractionPublishData) {
  const lookup = await erp(
    `/api/resource/User/${encodeURIComponent(data.email)}`,
  )
  if (lookup.ok)
    return {
      userId: resourceName(lookup.data) ?? data.email,
      status: 'existing' as const,
    }
  if (lookup.status !== 404) throw new ErpError('erp_user_lookup_failed')

  const created = await erp('/api/resource/User', {
    method: 'POST',
    body: JSON.stringify(erpUserPayload(data)),
  })
  if (!created.ok)
    return {
      failure: erpErrorDetails(created.data, created.status),
    }
  return {
    userId: resourceName(created.data) ?? data.email,
    status: 'created' as const,
  }
}

async function publishErpNext(
  data: ExtractionPublishData,
): Promise<TargetPublishResult> {
  if (missingErpFields(data).length)
    return { status: 'failed', error: 'erp_required_fields_missing' }
  const config = erpConfiguration()
  if (!config) return { status: 'failed', error: 'erp_not_configured' }
  const erp = createErpClient(config)

  try {
    const existingEmployee = await findEmployeeByResidence(erp, data.id_number)
    if (existingEmployee?.userId && existingEmployee.userId !== data.email)
      return {
        status: 'failed',
        employeeId: existingEmployee.name,
        steps: { user: 'skipped', employee: 'failed' },
        error: 'erp_employee_user_conflict',
      }

    const user = await ensureErpUser(erp, data)
    if ('failure' in user)
      return {
        status: 'failed',
        steps: { user: 'failed', employee: 'skipped' },
        error: 'erp_user_create_failed',
        details: user.failure,
      }
    const { userId } = user

    // Only a newly created user makes a later employee failure "partial".
    const employeeFailed = (
      error: string,
      extra?: Partial<TargetPublishResult>,
    ): TargetPublishResult => ({
      status: user.status === 'created' ? 'partial' : 'failed',
      userId,
      steps: { user: user.status, employee: 'failed' },
      error,
      ...extra,
    })

    let employeeId: string | undefined
    let employeeStatus: PublishStatus = 'existing'
    if (existingEmployee) {
      employeeId = existingEmployee.name
      const update: Record<string, string> = {}
      if (!existingEmployee.userId) update.user_id = userId
      if (data.mobile_number && !existingEmployee.cellNumber)
        update.cell_number = data.mobile_number
      if (Object.keys(update).length) {
        const updated = await erp(
          `/api/resource/Employee/${encodeURIComponent(existingEmployee.name)}`,
          { method: 'PUT', body: JSON.stringify(update) },
        )
        if (!updated.ok)
          return employeeFailed('erp_employee_update_failed', {
            employeeId,
            details: erpErrorDetails(updated.data, updated.status),
          })
      }
    } else {
      const [availableFields, invalidReference] = await Promise.all([
        employeeFieldNames(erp),
        invalidErpReference(erp, data),
      ])
      if (invalidReference) return employeeFailed(invalidReference)
      const created = await erp('/api/resource/Employee', {
        method: 'POST',
        body: JSON.stringify(erpEmployeePayload(data, availableFields)),
      })
      if (!created.ok)
        return employeeFailed('erp_employee_create_failed', {
          details: erpErrorDetails(created.data, created.status),
        })
      employeeId = resourceName(created.data) ?? undefined
      employeeStatus = 'created'
    }

    return {
      status:
        user.status === 'created' || employeeStatus === 'created'
          ? 'created'
          : 'existing',
      userId,
      employeeId,
      steps: { user: user.status, employee: employeeStatus },
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof ErpError ? error.code : 'erp_connection_failed',
    }
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('response' in auth) return auth.response

  const parsed = parsePublishRequest(await request.json().catch(() => null))
  if (!parsed) return apiError('invalid_payload', 400)

  try {
    const { data, targets } = parsed
    const [currentSystem, erpnext] = await Promise.all([
      targets.currentSystem
        ? publishCurrentSystem(auth.supabase, data)
        : SKIPPED,
      targets.erpnext ? publishErpNext(data) : SKIPPED,
    ])
    return NextResponse.json({ results: { currentSystem, erpnext } })
  } catch {
    return apiError('publish_failed', 500)
  }
}
