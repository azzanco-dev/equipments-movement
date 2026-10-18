import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  createErpClient,
  ErpError,
  erpConfiguration,
  findEmployeeByResidence,
  listQuery,
  listRows,
  resourceName,
  type ErpEmployeeMatch,
  type ErpRequest,
} from '@/lib/extracting/erpnext'
import {
  currentSystemDriverPayload,
  currentSystemDriverUpdatePayload,
  erpErrorDetails,
  erpEmployeePayload,
  erpEmployeeUpdatePayload,
  erpUserPayload,
  missingErpFields,
  parsePublishRequest,
  type ExtractionPublishData,
  type PublishMode,
  type PublishStatus,
  type TargetPublishResult,
} from '@/lib/extracting/publish'
import {
  apiError,
  callerIsAdmin,
  requireExtractingAccess,
} from '@/lib/extracting/server'

export const runtime = 'nodejs'

const SKIPPED: TargetPublishResult = { status: 'skipped' }

/**
 * Current system: `create` leaves a driver matched by `id_number` untouched
 * (`existing`); `update` rewrites its non-empty reviewed columns
 * (`currentSystemDriverUpdatePayload`) and reports `updated`. Either mode
 * inserts when no driver matches. RLS decides through the caller's token.
 */
async function publishCurrentSystem(
  supabase: SupabaseClient,
  data: ExtractionPublishData,
  mode: PublishMode,
): Promise<TargetPublishResult> {
  const findDriver = () =>
    supabase
      .from('drivers')
      .select('id')
      .eq('id_number', data.id_number)
      .maybeSingle()

  const { data: existing, error: lookupError } = await findDriver()
  if (lookupError) return { status: 'failed', error: 'local_lookup_failed' }
  if (existing?.id) {
    if (mode !== 'update') return { status: 'existing', id: existing.id }
    const { error: updateError } = await supabase
      .from('drivers')
      .update(currentSystemDriverUpdatePayload(data))
      .eq('id', existing.id)
    if (updateError)
      return { status: 'failed', id: existing.id, error: 'local_update_failed' }
    return { status: 'updated', id: existing.id }
  }

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

/**
 * Ensures the ERPNext user exists; returns its id and whether it was new. An
 * existing User is never modified in any mode: its email and password stay
 * as they are. In `create` mode an existing User is not reused either: the
 * caller would otherwise bind someone else's ERPNext login to the new
 * Employee (security audit run-1, owner decision 2026-10-18); only the admin's
 * `update` mode may link an existing User.
 */
async function ensureErpUser(
  erp: ErpRequest,
  data: ExtractionPublishData,
  mode: PublishMode,
) {
  const lookup = await erp(
    `/api/resource/User/${encodeURIComponent(data.email)}`,
  )
  if (lookup.ok) {
    if (mode !== 'update') return { exists: true as const }
    return {
      userId: resourceName(lookup.data) ?? data.email,
      status: 'existing' as const,
    }
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

/**
 * The PUT body for an Employee that already exists; reached in `update` mode
 * only (`create` refuses an existing Employee before any write). It writes
 * every non-empty reviewed Employee field (`erpEmployeeUpdatePayload`), sets
 * `user_id` only when the Employee has none and never touches `status`.
 */
async function existingEmployeeUpdate(
  erp: ErpRequest,
  data: ExtractionPublishData,
  employee: ErpEmployeeMatch,
  userId: string,
): Promise<{ update: Record<string, string> } | { error: string }> {
  const [availableFields, invalidReference] = await Promise.all([
    employeeFieldNames(erp),
    invalidErpReference(erp, data),
  ])
  if (invalidReference) return { error: invalidReference }
  const update = erpEmployeeUpdatePayload(data, availableFields)
  if (!employee.userId) update.user_id = userId
  return { update }
}

async function publishErpNext(
  data: ExtractionPublishData,
  mode: PublishMode,
): Promise<TargetPublishResult> {
  if (missingErpFields(data).length)
    return { status: 'failed', error: 'erp_required_fields_missing' }
  const config = erpConfiguration()
  if (!config) return { status: 'failed', error: 'erp_not_configured' }
  const erp = createErpClient(config)

  try {
    const existingEmployee = await findEmployeeByResidence(erp, data.id_number)
    // `create` never touches an existing Employee (form contract): it must not
    // attach a login or a mobile to someone else's record. The admin uses
    // `update` for that (security audit run-1, owner decision 2026-10-18).
    if (existingEmployee && mode !== 'update')
      return {
        status: 'failed',
        employeeId: existingEmployee.name,
        steps: { user: 'skipped', employee: 'failed' },
        error: 'erp_employee_exists',
      }
    if (existingEmployee?.userId && existingEmployee.userId !== data.email)
      return {
        status: 'failed',
        employeeId: existingEmployee.name,
        steps: { user: 'skipped', employee: 'failed' },
        error: 'erp_employee_user_conflict',
      }

    const user = await ensureErpUser(erp, data, mode)
    if ('exists' in user)
      return {
        status: 'failed',
        steps: { user: 'failed', employee: 'skipped' },
        error: 'erp_user_exists',
      }
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
      const prepared = await existingEmployeeUpdate(
        erp,
        data,
        existingEmployee,
        userId,
      )
      if ('error' in prepared)
        return employeeFailed(prepared.error, { employeeId })
      if (Object.keys(prepared.update).length) {
        const updated = await erp(
          `/api/resource/Employee/${encodeURIComponent(existingEmployee.name)}`,
          { method: 'PUT', body: JSON.stringify(prepared.update) },
        )
        if (!updated.ok)
          return employeeFailed('erp_employee_update_failed', {
            employeeId,
            details: erpErrorDetails(updated.data, updated.status),
          })
      }
      if (mode === 'update') employeeStatus = 'updated'
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

    const status: PublishStatus =
      user.status === 'created' || employeeStatus === 'created'
        ? 'created'
        : employeeStatus === 'updated'
          ? 'updated'
          : 'existing'
    return {
      status,
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
  const auth = await requireExtractingAccess(request)
  if ('response' in auth) return auth.response

  const parsed = parsePublishRequest(await request.json().catch(() => null))
  if (!parsed) return apiError('invalid_payload', 400)
  const { data, targets, mode } = parsed

  // Update mode is the admin's alone (`public.is_admin()` with the caller's
  // token), whatever permission opened the page; decided before any write.
  if (mode === 'update' && !(await callerIsAdmin(auth.supabase)))
    return apiError('forbidden', 403)

  try {
    const [currentSystem, erpnext] = await Promise.all([
      targets.currentSystem
        ? publishCurrentSystem(auth.supabase, data, mode)
        : SKIPPED,
      targets.erpnext ? publishErpNext(data, mode) : SKIPPED,
    ])
    return NextResponse.json({ results: { currentSystem, erpnext } })
  } catch {
    return apiError('publish_failed', 500)
  }
}
