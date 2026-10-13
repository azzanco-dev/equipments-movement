import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  createErpClient,
  ErpError,
  erpConfiguration,
  findEmployeeByResidence,
} from '@/lib/extracting/erpnext'
import {
  parseLookupRequest,
  type LookupDriver,
  type LookupErpnext,
  type LookupResult,
} from '@/lib/extracting/lookup'
import {
  apiError,
  callerIsAdmin,
  requireExtractingAccess,
} from '@/lib/extracting/server'

export const runtime = 'nodejs'

/** The driver matched by the residence number, through the caller's RLS. */
async function lookupDriver(
  supabase: SupabaseClient,
  idNumber: string,
): Promise<LookupDriver | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id,full_name,mobile_number')
    .eq('id_number', idNumber)
    .maybeSingle()
  if (error) throw new Error('local_lookup_failed')
  return data
    ? {
        id: data.id,
        full_name: data.full_name ?? '',
        mobile_number: data.mobile_number ?? null,
      }
    : null
}

/** Never throws: an ERPNext failure is reported inside the target. */
async function lookupErpnext(idNumber: string): Promise<LookupErpnext> {
  const config = erpConfiguration()
  if (!config) return { configured: false }
  try {
    const employee = await findEmployeeByResidence(
      createErpClient(config),
      idNumber,
    )
    return {
      configured: true,
      employee: employee
        ? {
            name: employee.name,
            employee_name: employee.employeeName,
            user_id: employee.userId,
            cell_number: employee.cellNumber,
          }
        : null,
    }
  } catch (error) {
    return {
      configured: true,
      error: error instanceof ErpError ? error.code : 'erp_connection_failed',
    }
  }
}

/**
 * What already exists for a residence number in each publish target, plus
 * whether the caller may update it (`public.is_admin()` with the caller's
 * token). Read-only: nothing is written in the current system or ERPNext.
 */
export async function POST(request: Request) {
  const auth = await requireExtractingAccess(request)
  if ('response' in auth) return auth.response

  const parsed = parseLookupRequest(await request.json().catch(() => null))
  if (!parsed) return apiError('invalid_id_number', 400)
  const { idNumber } = parsed

  try {
    const [currentSystem, erpnext, canUpdate] = await Promise.all([
      lookupDriver(auth.supabase, idNumber),
      lookupErpnext(idNumber),
      callerIsAdmin(auth.supabase),
    ])
    const result: LookupResult = { idNumber, canUpdate, currentSystem, erpnext }
    return NextResponse.json(result)
  } catch {
    return apiError('local_lookup_failed', 500)
  }
}
