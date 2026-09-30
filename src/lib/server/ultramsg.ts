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
