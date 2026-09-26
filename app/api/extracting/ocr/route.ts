import { NextResponse } from 'next/server'
import {
  OCR_FIELDS,
  OCR_IMAGE_TYPES,
  OCR_MAX_BYTES,
  hasOcrData,
  ocrErrorForStatus,
  parseOcrFields,
  readOcrAnnotation,
} from '@/lib/extracting/ocr'
import { apiError, requireAdmin } from '@/lib/extracting/server'

export const runtime = 'nodejs'

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr'
const OCR_TIMEOUT_MS = 30_000

const ANNOTATION_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'identity_fields',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        OCR_FIELDS.map((field) => [field, { type: 'string' }]),
      ),
      required: [...OCR_FIELDS],
    },
  },
}

const ANNOTATION_PROMPT =
  'Extract only the values visibly printed on this Saudi resident identity card. Preserve the printed Arabic and English names independently. Return empty strings for missing values. Normalize visible dates to DD-MM-YYYY without inventing or converting between calendars.'

async function readImage(request: Request) {
  try {
    const file = (await request.formData()).get('image')
    return file instanceof File ? file : null
  } catch {
    return null
  }
}

/** Server-side log only: the provider message helps diagnose, never the UI. */
async function logProviderFailure(response: Response) {
  const body = await response.text().catch(() => '')
  console.warn('[extracting/ocr] Mistral request failed', {
    status: response.status,
    body: body.slice(0, 300),
  })
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('response' in auth) return auth.response

  const mistralKey = process.env.MISTRAL_API_KEY
  if (!mistralKey) return apiError('ocr_not_configured', 503)

  const file = await readImage(request)
  if (!file || file.size === 0) return apiError('image_required', 400)
  if (!OCR_IMAGE_TYPES.includes(file.type))
    return apiError('unsupported_image_type', 415)
  if (file.size > OCR_MAX_BYTES) return apiError('image_too_large', 413)

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
  let response: Response
  try {
    response = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mistralKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      body: JSON.stringify({
        model: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: `data:${file.type};base64,${base64}`,
        },
        document_annotation_format: ANNOTATION_FORMAT,
        document_annotation_prompt: ANNOTATION_PROMPT,
      }),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return apiError(timedOut ? 'ocr_timeout' : 'ocr_connection_failed', 502)
  }

  if (!response.ok) {
    await logProviderFailure(response)
    return apiError(ocrErrorForStatus(response.status), 502, {
      providerStatus: response.status,
    })
  }

  let payload: { document_annotation?: unknown }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return apiError('ocr_invalid_response', 502)
  }
  const data = parseOcrFields(readOcrAnnotation(payload.document_annotation))
  if (!hasOcrData(data)) return apiError('ocr_no_data', 422)
  return NextResponse.json({ data })
}
