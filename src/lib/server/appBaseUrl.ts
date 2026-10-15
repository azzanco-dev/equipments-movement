// SERVER ONLY. The site origin a WhatsApp notice links to (the «ابلاغ الفورمان»
// link to the EXIT form, owner request 2026-10-15).
//
// No site URL is configured by default, so the origin of the incoming request
// is used: the user pressed the button on this very site. The optional server
// variable APP_BASE_URL overrides it (for example a custom domain in front of
// a preview host). It is read on the server only and is never a NEXT_PUBLIC_
// variable. A value that is not a plain `https://` origin is ignored.

/** The configured origin, when APP_BASE_URL is a plain `https://` origin. */
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
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  // An origin only: no path, query or fragment.
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

/**
 * APP_BASE_URL when it is valid, else the origin of `requestUrl`; `null` when
 * neither is usable. The message builder validates the result once more and
 * leaves the link out when it is not `https:` (or local `http:` in development).
 */
export function resolveAppBaseUrl(
  requestUrl: string,
  configured: string | null | undefined = process.env.APP_BASE_URL,
): string | null {
  const override = configuredAppBaseUrl(configured)
  if (override) return override
  try {
    const origin = new URL(requestUrl).origin
    return origin && origin !== 'null' ? origin : null
  } catch {
    return null
  }
}
