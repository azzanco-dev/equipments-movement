import type {
  ExtractionForm,
  PublishMode,
  PublishResults,
  PublishTargets,
} from './form'
import type { LookupResult } from './lookup'
import type { OcrFields } from './ocr'

/** An API failure carrying a code the screen maps to a translated message. */
export class ExtractingApiError extends Error {
  constructor(
    readonly code: string,
    /** Upstream OCR provider HTTP status, when the provider rejected it. */
    readonly providerStatus?: number,
  ) {
    super(code)
  }
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit,
  fallbackCode: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    })
  } catch {
    throw new ExtractingApiError('network_error')
  }
  // A proxy timeout or crash can answer with HTML; never surface parse errors.
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: unknown; providerStatus?: unknown }) | null
  if (response.ok && payload) return payload
  const code =
    typeof payload?.error === 'string'
      ? payload.error
      : response.ok
        ? 'invalid_response'
        : fallbackCode
  const providerStatus =
    typeof payload?.providerStatus === 'number'
      ? payload.providerStatus
      : undefined
  throw new ExtractingApiError(code, providerStatus)
}

export async function extractIdentity(
  token: string,
  image: File,
): Promise<OcrFields> {
  const body = new FormData()
  body.append('image', image)
  const payload = await request<{ data: OcrFields }>(
    '/api/extracting/ocr',
    token,
    { method: 'POST', body },
    'ocr_failed',
  )
  return payload.data
}

/** What already exists for a residence number; read-only. */
export async function lookupExtraction(
  token: string,
  idNumber: string,
): Promise<LookupResult> {
  return request<LookupResult>(
    '/api/extracting/lookup',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_number: idNumber }),
    },
    'lookup_failed',
  )
}

export async function publishExtraction(
  token: string,
  data: ExtractionForm,
  targets: PublishTargets,
  mode: PublishMode = 'create',
): Promise<PublishResults> {
  const payload = await request<{ results: PublishResults }>(
    '/api/extracting/publish',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, targets, mode }),
    },
    'publish_failed',
  )
  return payload.results
}
