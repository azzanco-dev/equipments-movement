import type { SupabaseClient } from '@supabase/supabase-js'

// Client side of "notify the foreman" (wave 9, migration 0110): a workshop
// role reports that a unit still recorded inside a site has arrived at the
// workshop. The server (`POST /api/notifications/workshop-arrival`) resolves
// the recipient, builds the text and sends it; this file only calls it and
// reads back whether the open site entry was already reported.
//
// No runtime imports, so the node tests can load it directly. The Supabase
// client and `fetch` are passed in by the caller.

export const WORKSHOP_ARRIVAL_ENDPOINT = '/api/notifications/workshop-arrival'

export type ArrivalNoticeStatus =
  'sent' | 'failed' | 'not_configured' | 'no_mobile'

/** Safe codes only: the server's `{ error }` values plus the two client ones. */
export type ArrivalNoticeErrorCode =
  | 'not_on_site'
  | 'recently_sent'
  | 'forbidden'
  | 'invalid'
  | 'unauthorized'
  | 'network'
  | 'failed'

export type ArrivalNoticeOutcome =
  | {
      ok: true
      status: ArrivalNoticeStatus
      /** Empty when the server could not name the foreman. */
      recipientName: string
      /** A `https://wa.me/` link with the same text, or `null`. */
      fallbackUrl: string | null
    }
  | { ok: false; error: ArrivalNoticeErrorCode }

const STATUSES: readonly ArrivalNoticeStatus[] = [
  'sent',
  'failed',
  'not_configured',
  'no_mobile',
]

const SERVER_ERRORS: readonly ArrivalNoticeErrorCode[] = [
  'not_on_site',
  'recently_sent',
  'forbidden',
  'invalid',
  'unauthorized',
]

/**
 * Only a `wa.me` link is ever rendered as a link, so a response can never
 * make the panel open another origin or a `javascript:` URL.
 */
export function safeWhatsAppUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://wa.me/')
    ? value
    : null
}

/**
 * Maps the HTTP status and JSON body of the endpoint to a safe outcome. The
 * HTTP status decides the error when the body carries no known code, so raw
 * server text never reaches the UI.
 */
export function parseArrivalNoticeResponse(
  httpStatus: number,
  body: unknown,
): ArrivalNoticeOutcome {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}

  if (httpStatus === 200) {
    const status = STATUSES.find((item) => item === record.status)
    if (!status) return { ok: false, error: 'failed' }
    return {
      ok: true,
      status,
      recipientName:
        typeof record.recipientName === 'string'
          ? record.recipientName.trim()
          : '',
      fallbackUrl:
        status === 'sent' ? null : safeWhatsAppUrl(record.fallbackUrl),
    }
  }

  const code = SERVER_ERRORS.find((item) => item === record.error)
  if (code) return { ok: false, error: code }
  if (httpStatus === 401) return { ok: false, error: 'unauthorized' }
  if (httpStatus === 403) return { ok: false, error: 'forbidden' }
  if (httpStatus === 409) return { ok: false, error: 'not_on_site' }
  if (httpStatus === 429) return { ok: false, error: 'recently_sent' }
  if (httpStatus === 400) return { ok: false, error: 'invalid' }
  return { ok: false, error: 'failed' }
}

type FetchLike = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>

/**
 * Sends the notice request with the signed-in user's access token, taken the
 * same way the movement form takes it for `/api/movements`: the current
 * session first, one refresh and one retry after a 401. Never throws.
 */
export async function requestWorkshopArrivalNotice(
  client: SupabaseClient,
  equipmentId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<ArrivalNoticeOutcome> {
  let accessToken: string | undefined
  try {
    const { data } = await client.auth.getSession()
    accessToken = data.session?.access_token
  } catch {
    return { ok: false, error: 'unauthorized' }
  }
  if (!accessToken) return { ok: false, error: 'unauthorized' }

  const send = (token: string) =>
    fetchImpl(WORKSHOP_ARRIVAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ equipmentId }),
    })

  try {
    let response = await send(accessToken)
    if (response.status === 401) {
      const { data: refreshed, error: refreshError } =
        await client.auth.refreshSession()
      const refreshedToken = refreshed.session?.access_token
      if (refreshError || !refreshedToken)
        return { ok: false, error: 'unauthorized' }
      response = await send(refreshedToken)
    }
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return parseArrivalNoticeResponse(response.status, body)
  } catch {
    return { ok: false, error: 'network' }
  }
}

export interface ArrivalNoticeRecord {
  id: string
  status: string
  createdAt: string
  senderId: string | null
  /** From the name-only `profile_names` view; `null` when it is unknown. */
  senderName: string | null
}

export interface LatestArrivalNotice {
  /** The lookup itself failed: the caller shows an error, not "no notice". */
  failed: boolean
  notice: ArrivalNoticeRecord | null
}

/**
 * The latest `workshop_arrival` notice of the unit's OPEN site entry, so any
 * officer sees that the foreman was already told. The open site entry is the
 * unit's latest movement by `(recorded_at, id)` and must be entry + site;
 * anything else means there is nothing to report. Never throws.
 */
export async function loadLatestArrivalNotice(
  client: SupabaseClient,
  equipmentId: string,
): Promise<LatestArrivalNotice> {
  try {
    const { data: lastRows, error: lastError } = await client
      .from('entry_exit_logs')
      .select('id,movement_type,movement_context')
      .eq('equipment_id', equipmentId)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
    if (lastError) return { failed: true, notice: null }
    const last = (lastRows ?? [])[0] as
      | { id: string; movement_type: string; movement_context: string }
      | undefined
    if (
      !last ||
      last.movement_type !== 'entry' ||
      last.movement_context !== 'site'
    )
      return { failed: false, notice: null }

    const { data: noticeRows, error: noticeError } = await client
      .from('movement_notices')
      .select('id,status,created_at,sender_id')
      .eq('kind', 'workshop_arrival')
      .eq('entry_log_id', last.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
    if (noticeError) return { failed: true, notice: null }
    const row = (noticeRows ?? [])[0] as
      | {
          id: string
          status: string
          created_at: string
          sender_id: string | null
        }
      | undefined
    if (!row) return { failed: false, notice: null }

    // The sender's name is a nicety: when it cannot be read the line is shown
    // without it rather than hiding that the unit was already reported.
    let senderName: string | null = null
    if (row.sender_id) {
      const { data: nameRows, error: nameError } = await client
        .from('profile_names')
        .select('id,full_name')
        .eq('id', row.sender_id)
        .limit(1)
      const name = nameError
        ? null
        : ((nameRows ?? [])[0] as { full_name?: string | null } | undefined)
      senderName = name?.full_name?.trim() || null
    }

    return {
      failed: false,
      notice: {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        senderId: row.sender_id,
        senderName,
      },
    }
  } catch {
    return { failed: true, notice: null }
  }
}

/** A `sent` notice reached the gateway; `pending` is still being sent. */
export function arrivalNoticeDelivered(status: string): boolean {
  return status === 'sent' || status === 'pending'
}

export type NoticeAge =
  { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number }

const MINUTE_MS = 60 * 1000

/**
 * How long ago a notice was created, in the largest whole unit. An unreadable
 * or future timestamp (clock skew) reads as "just now", never as a negative.
 */
export function noticeAge(
  createdAt: string,
  now: Date | number = Date.now(),
): NoticeAge {
  const created = new Date(createdAt).getTime()
  const current = typeof now === 'number' ? now : now.getTime()
  if (Number.isNaN(created) || Number.isNaN(current)) return { unit: 'now' }
  const minutes = Math.floor((current - created) / MINUTE_MS)
  if (minutes < 1) return { unit: 'now' }
  if (minutes < 60) return { unit: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', count: hours }
  return { unit: 'days', count: Math.floor(hours / 24) }
}

/**
 * Splits a sentence template around its `{name}` placeholder so the caller
 * can wrap the name in `<bdi>` (a Latin name inside an Arabic sentence).
 */
export function splitAroundName(template: string): {
  before: string
  after: string
  hasName: boolean
} {
  const index = template.indexOf('{name}')
  if (index < 0) return { before: template, after: '', hasName: false }
  return {
    before: template.slice(0, index),
    after: template.slice(index + '{name}'.length),
    hasName: true,
  }
}
