// SERVER ONLY. The ERPNext REST client shared by the extracting publish and
// lookup routes: configuration from the server environment, the authorised
// request helper, and the one Employee-by-residence-number lookup both routes
// rely on. Credentials never leave this module and are never logged.
import { configuredFieldName } from './publish'

/** A known ERPNext failure whose code the screen can explain. */
export class ErpError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export type ErpResponse = {
  ok: boolean
  status: number
  data?: Record<string, unknown>
}

export function erpConfiguration() {
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

export type ErpConfig = NonNullable<ReturnType<typeof erpConfiguration>>

export function createErpClient(config: ErpConfig) {
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

export type ErpRequest = ReturnType<typeof createErpClient>

export function resourceName(response: Record<string, unknown> | undefined) {
  const data = response?.data
  if (!data || typeof data !== 'object') return null
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

export function listRows(response: ErpResponse): Record<string, unknown>[] {
  const rows = response.data?.data
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === 'object',
      )
    : []
}

export function listQuery(fields: string[], filters: unknown[], limit: number) {
  return new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
  }).toString()
}

export interface ErpEmployeeMatch {
  name: string
  employeeName: string
  userId: string
  cellNumber: string
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/**
 * The Employee whose configured residence-number field equals `idNumber`
 * (`ERPNEXT_RESIDENCE_NUMBER_FIELD`, default `custom_residence_permit_number`).
 */
export async function findEmployeeByResidence(
  erp: ErpRequest,
  idNumber: string,
): Promise<ErpEmployeeMatch | null> {
  const residenceField = configuredFieldName(
    process.env.ERPNEXT_RESIDENCE_NUMBER_FIELD,
    'custom_residence_permit_number',
  )
  if (!residenceField) throw new ErpError('erp_invalid_field_mapping')
  const response = await erp(
    `/api/resource/Employee?${listQuery(
      ['name', 'employee_name', 'user_id', 'cell_number'],
      [[residenceField, '=', idNumber]],
      1,
    )}`,
  )
  if (!response.ok) throw new ErpError('erp_employee_lookup_failed')
  const row = listRows(response)[0]
  if (!row || typeof row.name !== 'string') return null
  return {
    name: row.name,
    employeeName: text(row.employee_name),
    userId: text(row.user_id),
    cellNumber: text(row.cell_number),
  }
}
