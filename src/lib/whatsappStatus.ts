// wave 12 — the WhatsApp gateway connection status shown to the admin.
//
// Shared by the server (`GET /api/notifications/whatsapp-status`, which asks
// the gateway and maps its answer) and the browser (which reads the route's
// small safe payload). No runtime imports, so the node tests can load it
// directly. Nothing here knows the gateway credentials.

export const WHATSAPP_STATUS_ENDPOINT = '/api/notifications/whatsapp-status'

/** Polling interval of the browser while the tab is visible. */
export const WHATSAPP_STATUS_POLL_MS = 5 * 60 * 1000

export const WHATSAPP_GATEWAY_STATES = [
  'connected',
  'disconnected',
  'qr',
  'loading',
  'not_configured',
  'unknown',
] as const

/**
 * `connected`       the instance is linked to WhatsApp and can send
 * `disconnected`    the phone / session is disconnected (or on standby)
 * `qr`              the instance waits for its QR code to be scanned
 * `loading`         the instance is starting or reconnecting
 * `not_configured`  the server has no gateway variables
 * `unknown`         the status could not be determined (request failed,
 *                   unexpected answer): never shown as connected
 */
export type WhatsAppGatewayState = (typeof WHATSAPP_GATEWAY_STATES)[number]

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function lowerText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

/**
 * Maps the gateway's instance status answer to a safe state.
 *
 * UltraMsg documents `GET /{instance_id}/instance/status` with the account
 * statuses initialize, qr, retrying, loading, authenticated, disconnected and
 * standby, nested as `{ status: { accountStatus: { status, substatus } } }`.
 * A top-level `accountStatus` is accepted as well. Anything else, including
 * an `{ error }` answer, is `unknown`: an answer that is not clearly
 * "authenticated and connected" is never reported as connected.
 */
export function mapUltraMsgInstanceStatus(
  payload: unknown,
): WhatsAppGatewayState {
  const root = asRecord(payload)
  if (!root || 'error' in root) return 'unknown'
  const account =
    asRecord(asRecord(root.status)?.accountStatus) ??
    asRecord(root.accountStatus)
  const status = lowerText(account?.status)
  if (!account || !status) return 'unknown'
  const substatus = lowerText(account.substatus)

  switch (status) {
    case 'authenticated':
      return substatus === null || substatus === '' || substatus === 'connected'
        ? 'connected'
        : 'unknown'
    case 'qr':
      return 'qr'
    case 'initialize':
    case 'retrying':
    case 'loading':
      return 'loading'
    case 'disconnected':
    case 'standby':
      return 'disconnected'
    default:
      return 'unknown'
  }
}

export function isWhatsAppGatewayState(
  value: unknown,
): value is WhatsAppGatewayState {
  return WHATSAPP_GATEWAY_STATES.some((state) => state === value)
}

/** The states that warn the admin: known to be not connected. */
export function isWhatsAppStatusWarning(state: string): boolean {
  return state === 'disconnected' || state === 'qr' || state === 'loading'
}

/**
 * Reads the route's answer. Only a 200 with a known state counts; any other
 * answer is `unknown`, so a failed check never reads as connected.
 */
export function parseWhatsAppStatusResponse(
  httpStatus: number,
  body: unknown,
): WhatsAppGatewayState {
  if (httpStatus !== 200) return 'unknown'
  const state = asRecord(body)?.state
  return isWhatsAppGatewayState(state) ? state : 'unknown'
}

type SessionClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token?: string } | null }
    }>
  }
}

type FetchLike = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
    cache: 'no-store'
    signal?: AbortSignal
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>

/**
 * Asks the route with the signed-in user's access token. Never throws: a
 * missing session or a failed request is `unknown`. Returns `null` only when
 * the request was aborted, so the caller can ignore it.
 */
export async function loadWhatsAppStatus(
  client: SessionClient,
  signal?: AbortSignal,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<WhatsAppGatewayState | null> {
  try {
    const { data } = await client.auth.getSession()
    const accessToken = data.session?.access_token
    if (signal?.aborted) return null
    if (!accessToken) return 'unknown'
    const response = await fetchImpl(WHATSAPP_STATUS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (signal?.aborted) return null
    return parseWhatsAppStatusResponse(response.status, body)
  } catch {
    return signal?.aborted ? null : 'unknown'
  }
}
