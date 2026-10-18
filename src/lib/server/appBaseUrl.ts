// SERVER ONLY. The site origin a WhatsApp notice links to (the «ابلاغ الفورمان»
// link to the EXIT form, owner request 2026-10-15).
//
// The origin comes from the server variable APP_BASE_URL ONLY (security audit
// 2026-10-18, lead D-16, fingerprint em:notices:workshop_arrival_link_request_origin).
// It used to fall back to the origin of the incoming request, but that origin
// is derived from the Host header, which the caller controls: a request with a
// forged Host would have put a link to a foreign site into a message the
// company number sends. Now, when the variable is absent or invalid, the
// notice goes out WITHOUT its link line and the route logs a warning.
//
// It is read on the server only and is never a NEXT_PUBLIC_ variable. A value
// that is not a plain `https://` origin is ignored, except `http://localhost`
// (or 127.0.0.1) for local development, the same allowance the message
// builder has (`linkableOrigin`).

/**
 * The configured origin, when APP_BASE_URL is a plain `https://` origin (or a
 * plain `http://` origin on the local machine, for development); else `null`.
 */
export function configuredAppBaseUrl(
  configured: string | null | undefined,
): string | null {
  if (typeof configured !== 'string') return null
  const value = configured.trim().replace(/\/+$/, '')
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    return null
  if (url.username || url.password) return null
  // An origin only: no path, query or fragment.
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

/**
 * The origin a notice may link to: APP_BASE_URL when it is valid, else `null`.
 * Nothing about the incoming request is consulted. With `null` the message
 * builder leaves the link lines out of the notice.
 */
export function resolveAppBaseUrl(
  configured: string | null | undefined = process.env.APP_BASE_URL,
): string | null {
  return configuredAppBaseUrl(configured)
}
