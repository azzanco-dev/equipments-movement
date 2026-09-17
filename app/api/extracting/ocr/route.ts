import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { OCR_FIELDS, parseOcrFields } from '@/lib/extracting/ocr'

export const runtime = 'nodejs'
const MAX_BYTES = 10 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status })
}

export async function POST(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ') || !header.slice(7).trim())
    return error('unauthorized', 401)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return error('service_unavailable', 503)
  try {
    const token = header.slice(7).trim()
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: claims, error: authError } =
      await supabase.auth.getClaims(token)
    const userId = claims?.claims?.sub
    if (authError || !userId) return error('unauthorized', 401)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.role !== 'admin') return error('forbidden', 403)
    const mistralKey = process.env.MISTRAL_API_KEY
    if (!mistralKey) return error('service_unavailable', 503)
    const file = (await request.formData()).get('image')
    if (!(file instanceof File) || file.size === 0)
      return error('image_required', 400)
    if (!TYPES.has(file.type)) return error('unsupported_image_type', 415)
    if (file.size > MAX_BYTES) return error('image_too_large', 413)
    const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        OCR_FIELDS.map((field) => [field, { type: 'string' }]),
      ),
      required: [...OCR_FIELDS],
    }
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mistralKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: dataUrl },
        document_annotation_format: {
          type: 'json_schema',
          json_schema: { name: 'identity_fields', strict: true, schema },
        },
        document_annotation_prompt:
          'Extract only the values visibly printed on this Saudi resident identity card. Preserve the printed Arabic and English names independently. Return empty strings for missing values. Normalize visible dates to YYYY-MM-DD without inventing or converting between calendars.',
      }),
    })
    if (!response.ok) return error('ocr_failed', 502)
    const payload = (await response.json()) as {
      document_annotation?: unknown
      pages?: Array<{ markdown?: string }>
    }
    let annotation = payload.document_annotation
    if (typeof annotation === 'string') {
      try {
        annotation = JSON.parse(annotation)
      } catch {
        annotation = {}
      }
    }
    return NextResponse.json({ data: parseOcrFields(annotation) })
  } catch {
    return error('ocr_failed', 502)
  }
}
