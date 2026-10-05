// SERVER ONLY. The UltraMsg WhatsApp gateway client.
//
// Import this module only from route handlers and other files under
// `src/lib/server`. It reads `ULTRAMSG_INSTANCE_ID` and `ULTRAMSG_TOKEN`, which
// are deliberately NOT `NEXT_PUBLIC_` variables, so Next.js never inlines them
// into a browser bundle.
//
// `sendWhatsAppText` never throws and never logs: the token, the request URL
// and the message body must not reach the logs. The caller logs the notice id
// and the short error code it gets back.
//
// wave 12: `getWhatsAppGatewayStatus` reads the instance connection status for
// the admin, with the same rules (never throws, never logs) and a short
// in-memory cache.

import {
  mapUltraMsgInstanceStatus,
  type WhatsAppGatewayState,
} from '@/lib/whatsappStatus'

export type WhatsAppSendErrorCode =
  | 'timeout'
  | 'http_error'
  | 'provider_error'
  | 'network_error'
  | 'invalid_number'

export type WhatsAppSendResult =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'failed'; errorCode: WhatsAppSendErrorCode }
  | { status: 'not_configured' }

const ULTRAMSG_API_ORIGIN = 'https://api.ultramsg.com'
const SEND_TIMEOUT_MS = 8000
// UltraMsg limit for a chat message body.
const MAX_BODY_LENGTH = 4096

function failed(errorCode: WhatsAppSendErrorCode): WhatsAppSendResult {
  return { status: 'failed', errorCode }
}

function gatewayConfig(): { instanceId: string; token: string } | null {
  const instanceId = process.env.ULTRAMSG_INSTANCE_ID?.trim()
  const token = process.env.ULTRAMSG_TOKEN?.trim()
  // The instance id becomes a URL path segment: accept a plain identifier only.
  if (!instanceId || !token || !/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) {
    return null
  }
  return { instanceId, token }
}

/** True when both gateway variables are present and usable. */
export function isWhatsAppGatewayConfigured(): boolean {
  return gatewayConfig() !== null
}

/**
 * Sends one WhatsApp text message.
 *
 * @param to   international number, `+` followed by 8 to 15 digits
 * @param body message text (cut at the gateway limit of 4096 characters)
 */
export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<WhatsAppSendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    const config = gatewayConfig()
    if (!config) return { status: 'not_configured' }
    if (typeof to !== 'string' || !/^\+[1-9]\d{7,14}$/.test(to)) {
      return failed('invalid_number')
    }

    timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    const response = await fetch(
      `${ULTRAMSG_API_ORIGIN}/${config.instanceId}/messages/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: config.token,
          to,
          body: String(body).slice(0, MAX_BODY_LENGTH),
        }).toString(),
        signal: controller.signal,
        cache: 'no-store',
      },
    )
    if (!response.ok) return failed('http_error')

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return failed(controller.signal.aborted ? 'timeout' : 'provider_error')
    }
    if (typeof payload !== 'object' || payload === null) {
      return failed('provider_error')
    }
    const data = payload as Record<string, unknown>
    // The gateway reports some failures with HTTP 200 and an `error` field.
    if ('error' in data || (data.sent !== true && data.sent !== 'true')) {
      return failed('provider_error')
    }

    const id =
      typeof data.id === 'string' || typeof data.id === 'number'
        ? String(data.id)
        : ''
    return /^[\w.@:-]{1,100}$/.test(id)
      ? { status: 'sent', providerMessageId: id }
      : { status: 'sent' }
  } catch {
    // Nothing of the error is kept: it may carry the request URL.
    return failed(controller.signal.aborted ? 'timeout' : 'network_error')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// --- wave 12: instance connection status -------------------------------------

const STATUS_TIMEOUT_MS = 5000
// One gateway request per server instance per minute at most. Serverless
// instances do not share this memory, so it only bounds each instance.
const STATUS_CACHE_MS = 60 * 1000

export interface WhatsAppGatewayStatus {
  state: WhatsAppGatewayState
  /** ISO time of the gateway check (or of the configuration check). */
  checkedAt: string
}

/**
 * Asks the gateway for the instance status, uncached. Never throws and never
 * logs: a failed or unexpected answer is `unknown`, never `connected`.
 */
export async function fetchWhatsAppInstanceState(): Promise<WhatsAppGatewayState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    const config = gatewayConfig()
    if (!config) return 'not_configured'

    timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)
    // The documented request is a GET with the token as a query parameter.
    // The URL is never logged or returned, and a failure keeps nothing of it.
    const query = new URLSearchParams({ token: config.token }).toString()
    const response = await fetch(
      `${ULTRAMSG_API_ORIGIN}/${config.instanceId}/instance/status?${query}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      },
    )
    if (!response.ok) return 'unknown'

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return 'unknown'
    }
    return mapUltraMsgInstanceStatus(payload)
  } catch {
    return 'unknown'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let cachedStatus: { value: WhatsAppGatewayStatus; at: number } | null = null
let pendingStatus: Promise<WhatsAppGatewayStatus> | null = null

/**
 * The instance status, cached in memory for a minute. Concurrent callers share
 * one gateway request. Never rejects.
 */
export function getWhatsAppGatewayStatus(): Promise<WhatsAppGatewayStatus> {
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_MS) {
    return Promise.resolve(cachedStatus.value)
  }
  if (pendingStatus) return pendingStatus
  const request = fetchWhatsAppInstanceState().then((state) => {
    const at = Date.now()
    const value: WhatsAppGatewayStatus = {
      state,
      checkedAt: new Date(at).toISOString(),
    }
    cachedStatus = { value, at }
    pendingStatus = null
    return value
  })
  pendingStatus = request
  return request
}
