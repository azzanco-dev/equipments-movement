// SERVER ONLY. The Afaqy AVL API client (wave 17).
//
// Import this module only from route handlers and other files under
// `src/lib/server`. It reads `AFAQY_USERNAME`, `AFAQY_PASSWORD` and the
// optional `AFAQY_API_URL` (default https://api.afaqy.pro), which are
// deliberately NOT `NEXT_PUBLIC_` variables, so Next.js never inlines them
// into a browser bundle.
//
// Same rules as ./ultramsg.ts: nothing here throws to a caller and nothing is
// logged (the password, the token and the provider's text must never reach
// the logs); every failure is a short error code. Requests are read-only
// (`auth/login` and `units/lists`) and time out quickly.
//
// API facts confirmed by a read-only probe (2026-10-08):
//   * `POST /auth/login {data:{username,password}}` -> `data.token` (a JWT
//     whose `exp` is 30 days ahead) and `data.expire` (`YYYY-MM-DD HH:MM:SS`
//     in Saudi time); sent back as `Authorization: Bearer <token>`.
//   * `POST /units/lists {data:{offset,limit,simplify,projection,filters}}`
//     -> `data` = array of units. `limit` up to 1000 works.
//   * The id filter is `filters: { id: { value: [...], op: 'in' } }`; a filter
//     on `_id` is silently IGNORED (it returns every unit), so the answer is
//     always re-checked by `_id` here as well.
//
// The caches live in this server instance's memory only; serverless
// instances do not share them, so they bound each instance, not the fleet.

import {
  AFAQY_UNIT_ID_PATTERN,
  mapAfaqyUnit,
  tokenRefreshAt,
  type AfaqyUnit,
} from '@/lib/afaqy'

export type AfaqyErrorCode =
  | 'not_configured'
  | 'auth_failed'
  | 'timeout'
  | 'http_error'
  | 'provider_error'
  | 'network_error'

export type AfaqyResult<T> =
  { ok: true; value: T } | { ok: false; error: AfaqyErrorCode }

const DEFAULT_API_URL = 'https://api.afaqy.pro'
const LOGIN_TIMEOUT_MS = 8000
const REQUEST_TIMEOUT_MS = 10000
const PAGE_SIZE = 500
/** 10 pages of 500: far above the 268 units of the account. */
const MAX_PAGES = 10
/** Ids per `id in (...)` request. */
const POSITION_BATCH = 50
const UNITS_CACHE_MS = 5 * 60 * 1000
const POSITION_CACHE_MS = 60 * 1000
const MAX_TOKEN_LENGTH = 4096

const PROJECTION = ['basic', 'last_update']

function failure<T>(error: AfaqyErrorCode): AfaqyResult<T> {
  return { ok: false, error }
}

interface AfaqyConfig {
  baseUrl: string
  username: string
  password: string
}

function afaqyConfig(): AfaqyConfig | null {
  const username = process.env.AFAQY_USERNAME?.trim()
  const password = process.env.AFAQY_PASSWORD
  const rawUrl = process.env.AFAQY_API_URL?.trim() || DEFAULT_API_URL
  if (!username || !password) return null
  let baseUrl: string
  try {
    const url = new URL(rawUrl)
    // HTTPS only, and no credentials, query or fragment in the base URL.
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null
    baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
  return { baseUrl, username, password }
}

/** True when the credentials are present and the base URL is usable. */
export function isAfaqyConfigured(): boolean {
  return afaqyConfig() !== null
}

type PostAnswer =
  | { ok: true; status: number; payload: unknown }
  | { ok: false; error: AfaqyErrorCode }

/** One JSON POST. Never throws; keeps nothing of a failure. */
async function postJson(
  url: string,
  data: unknown,
  token: string | null,
  timeoutMs: number,
): Promise<PostAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
      signal: controller.signal,
      cache: 'no-store',
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      if (controller.signal.aborted) return { ok: false, error: 'timeout' }
      payload = null
    }
    return { ok: true, status: response.status, payload }
  } catch {
    return {
      ok: false,
      error: controller.signal.aborted ? 'timeout' : 'network_error',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function dataOf(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>).data
    : undefined
}

// --- login and the token cache -------------------------------------------------

let cachedToken: { value: string; refreshAt: number } | null = null
let pendingLogin: Promise<AfaqyResult<string>> | null = null

async function login(config: AfaqyConfig): Promise<AfaqyResult<string>> {
  const answer = await postJson(
    `${config.baseUrl}/auth/login`,
    { username: config.username, password: config.password },
    null,
    LOGIN_TIMEOUT_MS,
  )
  if (!answer.ok) return failure(answer.error)
  if (answer.status === 401 || answer.status === 403 || answer.status === 422)
    return failure('auth_failed')
  if (answer.status < 200 || answer.status >= 300) return failure('http_error')
  const data = dataOf(answer.payload)
  const record =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : null
  const token = record?.token
  if (
    typeof token !== 'string' ||
    token.length < 20 ||
    token.length > MAX_TOKEN_LENGTH ||
    /\s/.test(token)
  )
    return failure('provider_error')
  cachedToken = {
    value: token,
    refreshAt: tokenRefreshAt(token, record?.expire, Date.now()),
  }
  return { ok: true, value: token }
}

/** A valid token: the cached one until shortly before it expires. Concurrent
 *  callers share one login. */
function getToken(
  config: AfaqyConfig,
  renew = false,
): Promise<AfaqyResult<string>> {
  if (renew) cachedToken = null
  if (cachedToken && Date.now() < cachedToken.refreshAt)
    return Promise.resolve({ ok: true, value: cachedToken.value })
  if (pendingLogin) return pendingLogin
  const request = login(config).then((result) => {
    pendingLogin = null
    return result
  })
  pendingLogin = request
  return request
}

/** POST with the token; a 401 renews the token once and retries. */
async function authorizedData(
  config: AfaqyConfig,
  path: string,
  data: unknown,
): Promise<AfaqyResult<unknown>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getToken(config, attempt > 0)
    if (!token.ok) return token
    const answer = await postJson(
      `${config.baseUrl}${path}`,
      data,
      token.value,
      REQUEST_TIMEOUT_MS,
    )
    if (!answer.ok) return failure(answer.error)
    if (answer.status === 401 && attempt === 0) continue
    if (answer.status === 401 || answer.status === 403)
      return failure('auth_failed')
    if (answer.status < 200 || answer.status >= 300)
      return failure('http_error')
    return { ok: true, value: dataOf(answer.payload) }
  }
  return failure('auth_failed')
}

// --- units ---------------------------------------------------------------------

function mapUnits(rows: unknown[]): AfaqyUnit[] {
  return rows
    .map(mapAfaqyUnit)
    .filter((unit): unit is AfaqyUnit => unit !== null)
}

/** Every unit of the account with its last position, uncached. */
export async function fetchAllUnits(): Promise<AfaqyResult<AfaqyUnit[]>> {
  try {
    const config = afaqyConfig()
    if (!config) return failure('not_configured')
    const units: AfaqyUnit[] = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await authorizedData(config, '/units/lists', {
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        simplify: 0,
        projection: PROJECTION,
      })
      if (!result.ok) return failure(result.error)
      if (!Array.isArray(result.value)) return failure('provider_error')
      units.push(...mapUnits(result.value))
      if (result.value.length < PAGE_SIZE) {
        const unique = new Map(units.map((unit) => [unit.unitId, unit]))
        return { ok: true, value: [...unique.values()] }
      }
    }
    // More pages than any real account has: refuse rather than truncate.
    return failure('provider_error')
  } catch {
    return failure('provider_error')
  }
}

const cachedPositions = new Map<string, { value: AfaqyUnit; at: number }>()

let cachedUnits: { value: AfaqyUnit[]; at: number } | null = null
let pendingUnits: Promise<AfaqyResult<AfaqyUnit[]>> | null = null

/**
 * The unit list, cached in memory for five minutes; `fresh` skips the cache
 * (the sync). Concurrent callers share one request. Never rejects.
 */
export function listUnits(
  options: { fresh?: boolean } = {},
): Promise<AfaqyResult<AfaqyUnit[]>> {
  if (
    !options.fresh &&
    cachedUnits &&
    Date.now() - cachedUnits.at < UNITS_CACHE_MS
  )
    return Promise.resolve({ ok: true, value: cachedUnits.value })
  if (pendingUnits) return pendingUnits
  const request = fetchAllUnits().then((result) => {
    pendingUnits = null
    if (result.ok) {
      const at = Date.now()
      cachedUnits = { value: result.value, at }
      for (const unit of result.value)
        cachedPositions.set(unit.unitId, { value: unit, at })
    }
    return result
  })
  pendingUnits = request
  return request
}

function pruneCachedPositions(now: number) {
  for (const [id, entry] of cachedPositions)
    if (now - entry.at >= POSITION_CACHE_MS) cachedPositions.delete(id)
}

/**
 * The listed units with their last position, each cached for a minute. A
 * unit Afaqy does not return is simply absent from the answer.
 *
 * Probed: an id Afaqy does not know (a deleted unit) makes the WHOLE
 * filtered request answer HTTP 200 with `message: 'validation_error'` and no
 * `data`. Then the full list is read once instead (one request for the whole
 * account, which also refreshes every cached position), and the ids missing
 * from it are the unknown ones.
 */
export async function getUnitsPositions(
  ids: readonly string[],
): Promise<AfaqyResult<AfaqyUnit[]>> {
  try {
    const config = afaqyConfig()
    if (!config) return failure('not_configured')
    const wanted = [
      ...new Set(ids.filter((id) => AFAQY_UNIT_ID_PATTERN.test(id))),
    ]
    const now = Date.now()
    pruneCachedPositions(now)
    const found = new Map<string, AfaqyUnit>()
    const missing: string[] = []
    for (const id of wanted) {
      const cached = cachedPositions.get(id)
      if (cached) found.set(id, cached.value)
      else missing.push(id)
    }
    for (let start = 0; start < missing.length; start += POSITION_BATCH) {
      const batch = missing.slice(start, start + POSITION_BATCH)
      const result = await authorizedData(config, '/units/lists', {
        offset: 0,
        limit: batch.length,
        simplify: 0,
        projection: PROJECTION,
        filters: { id: { value: batch, op: 'in' } },
      })
      if (!result.ok) return failure(result.error)
      if (!Array.isArray(result.value)) {
        const all = await listUnits({ fresh: true })
        if (!all.ok) return failure(all.error)
        const byId = new Map(all.value.map((unit) => [unit.unitId, unit]))
        for (const id of missing) {
          const unit = byId.get(id)
          if (unit) found.set(id, unit)
        }
        break
      }
      const requested = new Set(batch)
      const at = Date.now()
      for (const unit of mapUnits(result.value)) {
        // Re-checked: an ignored filter must not hand back other units.
        if (!requested.has(unit.unitId)) continue
        found.set(unit.unitId, unit)
        cachedPositions.set(unit.unitId, { value: unit, at })
      }
    }
    return {
      ok: true,
      value: wanted
        .map((id) => found.get(id))
        .filter((unit): unit is AfaqyUnit => unit !== undefined),
    }
  } catch {
    return failure('provider_error')
  }
}

/** One unit with its last position (null when Afaqy does not know it). */
export async function getUnitPosition(
  unitId: string,
): Promise<AfaqyResult<AfaqyUnit | null>> {
  const result = await getUnitsPositions([unitId])
  if (!result.ok) return result
  return { ok: true, value: result.value[0] ?? null }
}
