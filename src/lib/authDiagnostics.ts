/**
 * Automatic sign-out diagnostics (EM-174, owner 2026-11-01 «حل EM-174»).
 *
 * The Supabase auth client removes the stored session — and the app shows
 * the login screen — whenever a token refresh fails with an error that is
 * not a network failure (an invalid or already-used refresh token, a revoked
 * session, a 4xx / 500 from the auth server). It logs that error to the
 * console only, so the user sees a silent sign-out and nothing to report.
 *
 * This module keeps the LAST auth error the client's debug hook hands over
 * (`recordAuthDebug`, wired as the client's `auth.debug` logger) and, when
 * the provider sees a SIGNED_OUT that the user did not ask for, remembers
 * the moment with that error in localStorage (`rememberAutoSignOut`), so
 * the login screen can say «تم تسجيل خروجك تلقائيا» with a detail line the
 * owner can report. A per-browser convenience: every storage access is
 * guarded, and nothing here changes how sessions are refreshed.
 */

export interface AuthErrorSummary {
  /** The error class, e.g. `AuthApiError`. */
  name: string
  message: string
  status?: number
  code?: string
}

export interface AutoSignOutInfo {
  /** Epoch milliseconds of the automatic sign-out. */
  at: number
  /** The last refresh error the auth client reported, when it reported one. */
  error: AuthErrorSummary | null
  /** `navigator.onLine` at that moment, when known. */
  online: boolean | null
  /** `document.visibilityState` at that moment, when known. */
  visible: boolean | null
}

export const AUTO_SIGN_OUT_STORAGE_KEY = 'auth:lastAutoSignOut'

let lastAuthError: AuthErrorSummary | null = null

function isAuthErrorLike(value: unknown): value is {
  name?: unknown
  message: string
  status?: unknown
  code?: unknown
} {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { message?: unknown; name?: unknown }
  if (typeof candidate.message !== 'string') return false
  return (
    (typeof candidate.name === 'string' && candidate.name.startsWith('Auth')) ||
    'status' in candidate ||
    'code' in candidate
  )
}

/**
 * The auth client's debug logger: every debug line of the client passes
 * through it. It keeps only the last error object it sees (the refresh
 * failures of `_callRefreshToken` / `_recoverAndRefresh` hand the error as an
 * argument) and prints nothing.
 */
export function recordAuthDebug(_message: string, ...args: unknown[]): void {
  for (const arg of args) {
    if (!isAuthErrorLike(arg)) continue
    lastAuthError = {
      name: typeof arg.name === 'string' ? arg.name : 'Error',
      message: arg.message,
      status: typeof arg.status === 'number' ? arg.status : undefined,
      code: typeof arg.code === 'string' ? arg.code : undefined,
    }
  }
}

/** The last auth error the debug hook saw, for tests and the provider. */
export function lastRecordedAuthError(): AuthErrorSummary | null {
  return lastAuthError
}

/** Forgets the recorded error (a successful sign-in, or a test). */
export function resetRecordedAuthError(): void {
  lastAuthError = null
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Remembers an automatic sign-out happening now and returns its record. */
export function rememberAutoSignOut(now: number = Date.now()): AutoSignOutInfo {
  const info: AutoSignOutInfo = {
    at: now,
    error: lastAuthError,
    online:
      typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean'
        ? null
        : navigator.onLine,
    visible:
      typeof document === 'undefined' || !document.visibilityState
        ? null
        : document.visibilityState === 'visible',
  }
  try {
    storage()?.setItem(AUTO_SIGN_OUT_STORAGE_KEY, JSON.stringify(info))
  } catch {
    // A private window or blocked storage: the login screen just shows nothing.
  }
  return info
}

/** The remembered automatic sign-out, or null. */
export function readAutoSignOut(): AutoSignOutInfo | null {
  try {
    const raw = storage()?.getItem(AUTO_SIGN_OUT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AutoSignOutInfo>
    if (typeof parsed.at !== 'number') return null
    return {
      at: parsed.at,
      error: isAuthErrorLike(parsed.error)
        ? {
            name:
              typeof parsed.error.name === 'string'
                ? parsed.error.name
                : 'Error',
            message: parsed.error.message,
            status:
              typeof parsed.error.status === 'number'
                ? parsed.error.status
                : undefined,
            code:
              typeof parsed.error.code === 'string'
                ? parsed.error.code
                : undefined,
          }
        : null,
      online: typeof parsed.online === 'boolean' ? parsed.online : null,
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : null,
    }
  } catch {
    return null
  }
}

/** Forgets the remembered automatic sign-out (after a successful sign-in). */
export function clearAutoSignOut(): void {
  try {
    storage()?.removeItem(AUTO_SIGN_OUT_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * One Latin line the owner can report: the Saudi time, then the error's
 * code or status and message, else «no error captured», then the network
 * and visibility state when known. Pure.
 */
export function describeAutoSignOut(info: AutoSignOutInfo): string {
  const saudi = new Date(info.at + 3 * 3600_000)
  const stamp = saudi.toISOString().slice(0, 16).replace('T', ' ')
  const parts = [stamp]
  if (info.error) {
    const id =
      info.error.code ?? (info.error.status ? String(info.error.status) : null)
    parts.push(id ? `${id}: ${info.error.message}` : info.error.message)
  } else parts.push('no error captured')
  if (info.online !== null) parts.push(info.online ? 'online' : 'offline')
  if (info.visible !== null) parts.push(info.visible ? 'visible' : 'hidden')
  return parts.join(' · ')
}
