// wave 17 — the Afaqy AVL tracker: pure helpers shared by the server module
// (src/lib/server/afaqy.ts), the admin routes (app/api/afaqy/*) and the admin
// UI. Nothing here knows a credential or calls Afaqy; the browser only ever
// talks to our own routes, with the signed-in admin's bearer token.
//
// The raw Afaqy unit shape was confirmed by a read-only probe (2026-10-08):
//   { _id: 24-hex, name: '(A055) 8631 URA', imei, last_update?: {
//       dtt: device time ms, dts: server time ms, spd: km/h, ang: heading,
//       acc: 0 | 1 (ignition), lastloc?: { lat, lng }, lat, lng,
//       prms: { odometer, sat, ... },
//       sensors_chDate: { acc: [{ sensorValue: { value: 0 | 1 } }] } } }
// Some units have no `last_update`, one had no `lastloc`: both mean "no
// position yet", never an error.

export const AFAQY_UNITS_ENDPOINT = '/api/afaqy/units'
export const AFAQY_SYNC_ENDPOINT = '/api/afaqy/sync'
export const AFAQY_POSITION_ENDPOINT = '/api/afaqy/position'

/** The Afaqy unit id: a 24-hex (MongoDB ObjectId) string. Mirrors the
 *  `equipment_tracker_unit_id_format` check of migration 0122. */
export const AFAQY_UNIT_ID_PATTERN = /^[0-9a-fA-F]{24}$/
/** Mirrors the 200-character name limit of migration 0122. */
export const AFAQY_UNIT_NAME_MAX = 200
/** A last signal older than this shows the stale warning. */
export const AFAQY_STALE_AFTER_MS = 60 * 60 * 1000

const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
const TOKEN_MIN_LIFETIME_MS = 60 * 1000
const TOKEN_DEFAULT_LIFETIME_MS = 60 * 60 * 1000
const TOKEN_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000

export interface AfaqyPosition {
  lat: number
  lng: number
  speedKmh: number | null
  heading: number | null
  ignitionOn: boolean | null
  /** ISO time the device took the reading, or null when invalid. */
  deviceTime: string | null
  /** ISO time Afaqy received it, or null when invalid. */
  serverTime: string | null
  satellites?: number
  odometer?: number
}

/** The small, safe DTO every route returns for a unit. */
export interface AfaqyUnit {
  unitId: string
  name: string
  imei?: string
  position: AfaqyPosition | null
}

/** One row of the linking list (`GET /api/afaqy/units`). */
export interface AfaqyUnitListItem {
  unitId: string
  name: string
  code: string | null
  plate: string | null
  imei: string | null
  hasPosition: boolean
  lastSeen: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** `upper(btrim(code))`, the normalisation every code comparison uses (0114).
 *  Empty is null. */
export function normalizeTrackerCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized === '' ? null : normalized
}

/**
 * Splits an Afaqy unit name such as `(A055) 8631 URA` into the equipment code
 * (the text of the FIRST parentheses, trimmed and upper-cased) and the plate
 * (the rest, without any other parenthesised part). A name without
 * parentheses has no code: nothing is guessed, so it can never auto-link to
 * the wrong equipment.
 */
export function parseUnitName(name: unknown): {
  code: string | null
  plate: string | null
} {
  const text = typeof name === 'string' ? name.trim() : ''
  const match = /\(([^()]*)\)/.exec(text)
  const code = match ? normalizeTrackerCode(match[1]) : null
  const plate = text
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { code, plate: plate === '' ? null : plate }
}

/** Epoch milliseconds to ISO, or null for a missing or impossible time. */
function epochToIso(value: unknown): string | null {
  const ms = finiteNumber(value)
  // Before 2000 or after 2100 is a device without a clock fix.
  if (ms === null || ms < 946684800000 || ms > 4102444800000) return null
  return new Date(ms).toISOString()
}

function ignitionFrom(lastUpdate: Record<string, unknown>): boolean | null {
  const read = (value: unknown): boolean | null => {
    if (value === true || value === false) return value
    const number = finiteNumber(value)
    return number === 1 ? true : number === 0 ? false : null
  }
  const direct = read(lastUpdate.acc)
  if (direct !== null) return direct
  const sensors = asRecord(lastUpdate.sensors_chDate)
  const acc = Array.isArray(sensors?.acc) ? sensors.acc[0] : null
  return read(asRecord(asRecord(acc)?.sensorValue)?.value)
}

/** The position of a raw `last_update`, or null when it has no usable fix. */
export function mapAfaqyPosition(lastUpdate: unknown): AfaqyPosition | null {
  const update = asRecord(lastUpdate)
  if (!update) return null
  const location = asRecord(update.lastloc)
  const lat = finiteNumber(location ? location.lat : update.lat)
  const lng = finiteNumber(location ? location.lng : update.lng)
  if (
    lat === null ||
    lng === null ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  )
    return null

  const speed = finiteNumber(update.spd)
  const heading = finiteNumber(update.ang)
  const params = asRecord(update.prms)
  const satellites = finiteNumber(params?.sat)
  const odometer = finiteNumber(params?.odometer)
  const position: AfaqyPosition = {
    lat,
    lng,
    speedKmh: speed !== null && speed >= 0 && speed < 1000 ? speed : null,
    heading:
      heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    ignitionOn: ignitionFrom(update),
    deviceTime: epochToIso(update.dtt),
    serverTime: epochToIso(update.dts),
  }
  if (satellites !== null && satellites >= 0 && Number.isInteger(satellites))
    position.satellites = satellites
  if (odometer !== null && odometer >= 0) position.odometer = odometer
  return position
}

/**
 * Raw Afaqy unit to the safe DTO. Only the listed fields leave the server;
 * a unit without a valid `_id` is dropped (null).
 */
export function mapAfaqyUnit(raw: unknown): AfaqyUnit | null {
  const unit = asRecord(raw)
  if (!unit) return null
  const unitId = unit._id
  if (typeof unitId !== 'string' || !AFAQY_UNIT_ID_PATTERN.test(unitId))
    return null
  const name =
    typeof unit.name === 'string'
      ? unit.name.trim().slice(0, AFAQY_UNIT_NAME_MAX)
      : ''
  const imeiValue =
    typeof unit.imei === 'string' || typeof unit.imei === 'number'
      ? String(unit.imei).trim()
      : ''
  const dto: AfaqyUnit = {
    unitId,
    name,
    position: mapAfaqyPosition(unit.last_update),
  }
  if (/^[0-9A-Za-z]{1,32}$/.test(imeiValue)) dto.imei = imeiValue
  return dto
}

/** The time of the last signal: when Afaqy received it, else the device
 *  time. */
export function lastSignalTime(position: AfaqyPosition | null): string | null {
  return position ? (position.serverTime ?? position.deviceTime) : null
}

export function toUnitListItem(unit: AfaqyUnit): AfaqyUnitListItem {
  const { code, plate } = parseUnitName(unit.name)
  return {
    unitId: unit.unitId,
    name: unit.name,
    code,
    plate,
    imei: unit.imei ?? null,
    hasPosition: unit.position !== null,
    lastSeen: lastSignalTime(unit.position),
  }
}

/** True when the last signal is older than an hour (or has no time). */
export function isPositionStale(
  position: AfaqyPosition,
  nowMs: number = Date.now(),
): boolean {
  const time = lastSignalTime(position)
  if (!time) return true
  return nowMs - new Date(time).getTime() > AFAQY_STALE_AFTER_MS
}

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`
}

/** `DD/MM/YYYY hh:mm AM` in Saudi time (UTC+03:00), whatever the browser's
 *  timezone. Empty for an invalid time. */
export function formatSaudiDateTime(iso: string): string {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const local = new Date(ms + SAUDI_OFFSET_MS)
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = local.getUTCHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(hour12)}:${pad(local.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`
}

// --- the login token's lifetime ----------------------------------------------

/**
 * Afaqy's `expire` (`YYYY-MM-DD HH:MM:SS`) is Saudi local time: the probe
 * found it exactly three hours ahead of the token's own `exp` claim read as
 * UTC. Returns epoch ms, or null when the text is not in that format.
 */
export function parseAfaqyExpire(expire: unknown): number | null {
  if (typeof expire !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    expire.trim(),
  )
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  if (!Number.isFinite(ms)) return null
  return ms - SAUDI_OFFSET_MS
}

/** The `exp` claim of a JWT in epoch ms, or null when it cannot be read. */
export function jwtExpiryMs(token: unknown): number | null {
  if (typeof token !== 'string') return null
  const part = token.split('.')[1]
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = asRecord(JSON.parse(atob(padded)))
    const exp = finiteNumber(claims?.exp)
    return exp === null ? null : exp * 1000
  } catch {
    return null
  }
}

/**
 * When a cached token should be replaced: five minutes before the earliest
 * known expiry (the JWT claim and Afaqy's `expire`), kept between one minute
 * and twelve hours from now. Without any readable expiry it is reused for an
 * hour; a 401 replaces it sooner anyway.
 */
export function tokenRefreshAt(
  token: unknown,
  expire: unknown,
  nowMs: number,
): number {
  const known = [jwtExpiryMs(token), parseAfaqyExpire(expire)].filter(
    (value): value is number => value !== null,
  )
  const expiry = known.length
    ? Math.min(...known)
    : nowMs + TOKEN_DEFAULT_LIFETIME_MS
  return Math.min(
    nowMs + TOKEN_MAX_LIFETIME_MS,
    Math.max(nowMs + TOKEN_MIN_LIFETIME_MS, expiry - TOKEN_REFRESH_MARGIN_MS),
  )
}

// --- the admin client: route answers -------------------------------------------

export type AfaqyUnitsAnswer =
  | { kind: 'ok'; units: AfaqyUnitListItem[] }
  | { kind: 'not_configured' }
  | { kind: 'error' }

export type AfaqyPositionAnswer =
  | { kind: 'ok'; unit: AfaqyUnit }
  | { kind: 'not_linked' }
  | { kind: 'unit_not_found' }
  | { kind: 'not_configured' }
  | { kind: 'error' }

export interface TrackerSyncEquipmentRef {
  id: string
  code: string
}

export type TrackerSyncConflictReason =
  | 'ambiguous_code'
  | 'several_units'
  | 'equipment_linked_to_other_unit'
  | 'unit_linked_elsewhere'
  | 'update_failed'

export interface TrackerSyncConflict {
  reason: TrackerSyncConflictReason
  unitId: string | null
  unitName: string | null
  code: string | null
  equipment: TrackerSyncEquipmentRef[]
}

export interface TrackerSyncReport {
  unitsTotal: number
  linked: number
  relinked: number
  alreadyLinked: number
  failed: number
  unmatchedUnits: { unitId: string; name: string; code: string | null }[]
  equipmentWithoutUnit: TrackerSyncEquipmentRef[]
  equipmentWithoutUnitTotal: number
  conflicts: TrackerSyncConflict[]
}

export type AfaqySyncAnswer =
  | { kind: 'ok'; report: TrackerSyncReport }
  | { kind: 'not_configured' }
  | { kind: 'error' }

function errorCode(body: unknown): string | null {
  const error = asRecord(body)?.error
  return typeof error === 'string' ? error : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function readListItem(value: unknown): AfaqyUnitListItem | null {
  const row = asRecord(value)
  if (
    !row ||
    !isString(row.unitId) ||
    !AFAQY_UNIT_ID_PATTERN.test(row.unitId) ||
    !isString(row.name) ||
    !nullableString(row.code) ||
    !nullableString(row.plate) ||
    !nullableString(row.imei) ||
    typeof row.hasPosition !== 'boolean' ||
    !nullableString(row.lastSeen)
  )
    return null
  return {
    unitId: row.unitId,
    name: row.name,
    code: row.code,
    plate: row.plate,
    imei: row.imei,
    hasPosition: row.hasPosition,
    lastSeen: row.lastSeen,
  }
}

export function parseUnitsResponse(
  httpStatus: number,
  body: unknown,
): AfaqyUnitsAnswer {
  if (httpStatus === 503 && errorCode(body) === 'not_configured')
    return { kind: 'not_configured' }
  const units = asRecord(body)?.units
  if (httpStatus !== 200 || !Array.isArray(units)) return { kind: 'error' }
  return {
    kind: 'ok',
    units: units
      .map(readListItem)
      .filter((item): item is AfaqyUnitListItem => item !== null),
  }
}

function readPosition(value: unknown): AfaqyPosition | null | undefined {
  if (value === null) return null
  const row = asRecord(value)
  if (
    !row ||
    typeof row.lat !== 'number' ||
    typeof row.lng !== 'number' ||
    !Number.isFinite(row.lat) ||
    !Number.isFinite(row.lng)
  )
    return undefined
  const optionalNumber = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : null
  const position: AfaqyPosition = {
    lat: row.lat,
    lng: row.lng,
    speedKmh: optionalNumber(row.speedKmh),
    heading: optionalNumber(row.heading),
    ignitionOn: typeof row.ignitionOn === 'boolean' ? row.ignitionOn : null,
    deviceTime: isString(row.deviceTime) ? row.deviceTime : null,
    serverTime: isString(row.serverTime) ? row.serverTime : null,
  }
  const satellites = optionalNumber(row.satellites)
  const odometer = optionalNumber(row.odometer)
  if (satellites !== null) position.satellites = satellites
  if (odometer !== null) position.odometer = odometer
  return position
}

export function parsePositionResponse(
  httpStatus: number,
  body: unknown,
): AfaqyPositionAnswer {
  const code = errorCode(body)
  if (httpStatus === 404 && code === 'not_linked') return { kind: 'not_linked' }
  if (httpStatus === 404 && code === 'unit_not_found')
    return { kind: 'unit_not_found' }
  if (httpStatus === 503 && code === 'not_configured')
    return { kind: 'not_configured' }
  const unit = asRecord(asRecord(body)?.unit)
  if (
    httpStatus !== 200 ||
    !unit ||
    !isString(unit.unitId) ||
    !isString(unit.name)
  )
    return { kind: 'error' }
  const position = readPosition(unit.position)
  if (position === undefined) return { kind: 'error' }
  return {
    kind: 'ok',
    unit: { unitId: unit.unitId, name: unit.name, position },
  }
}

function readRefs(value: unknown): TrackerSyncEquipmentRef[] | null {
  if (!Array.isArray(value)) return null
  const refs: TrackerSyncEquipmentRef[] = []
  for (const item of value) {
    const row = asRecord(item)
    if (!row || !isString(row.id) || !isString(row.code)) return null
    refs.push({ id: row.id, code: row.code })
  }
  return refs
}

export function parseSyncResponse(
  httpStatus: number,
  body: unknown,
): AfaqySyncAnswer {
  if (httpStatus === 503 && errorCode(body) === 'not_configured')
    return { kind: 'not_configured' }
  const report = asRecord(asRecord(body)?.report)
  if (httpStatus !== 200 || !report) return { kind: 'error' }
  const counts = [
    'unitsTotal',
    'linked',
    'relinked',
    'alreadyLinked',
    'failed',
    'equipmentWithoutUnitTotal',
  ] as const
  if (counts.some((key) => typeof report[key] !== 'number'))
    return { kind: 'error' }
  const without = readRefs(report.equipmentWithoutUnit)
  if (
    !without ||
    !Array.isArray(report.unmatchedUnits) ||
    !Array.isArray(report.conflicts)
  )
    return { kind: 'error' }
  const unmatched: TrackerSyncReport['unmatchedUnits'] = []
  for (const item of report.unmatchedUnits) {
    const row = asRecord(item)
    if (!row || !isString(row.unitId) || !isString(row.name)) continue
    unmatched.push({
      unitId: row.unitId,
      name: row.name,
      code: isString(row.code) ? row.code : null,
    })
  }
  const conflicts: TrackerSyncConflict[] = []
  for (const item of report.conflicts) {
    const row = asRecord(item)
    const equipment = readRefs(row?.equipment)
    if (!row || !isString(row.reason) || !equipment) continue
    conflicts.push({
      reason: row.reason as TrackerSyncConflictReason,
      unitId: isString(row.unitId) ? row.unitId : null,
      unitName: isString(row.unitName) ? row.unitName : null,
      code: isString(row.code) ? row.code : null,
      equipment,
    })
  }
  return {
    kind: 'ok',
    report: {
      unitsTotal: report.unitsTotal as number,
      linked: report.linked as number,
      relinked: report.relinked as number,
      alreadyLinked: report.alreadyLinked as number,
      failed: report.failed as number,
      equipmentWithoutUnitTotal: report.equipmentWithoutUnitTotal as number,
      unmatchedUnits: unmatched,
      equipmentWithoutUnit: without,
      conflicts,
    },
  }
}

// --- the admin client: requests ----------------------------------------------

type SessionClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token?: string } | null }
    }>
  }
}

export type AfaqyFetch = (
  input: string,
  init: {
    method: 'GET' | 'POST'
    headers: Record<string, string>
    body?: string
    cache: 'no-store'
    signal?: AbortSignal
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>

const defaultFetch: AfaqyFetch = (input, init) => fetch(input, init)

/**
 * One request to our own Afaqy routes with the signed-in user's token.
 * Never throws: returns null when aborted, and status 0 when there is no
 * session or the request failed.
 */
async function requestRoute(
  client: SessionClient,
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  signal: AbortSignal | undefined,
  fetchImpl: AfaqyFetch,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const { data } = await client.auth.getSession()
    const accessToken = data.session?.access_token
    if (signal?.aborted) return null
    if (!accessToken) return { status: 0, body: null }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    }
    if (method === 'POST') headers['Content-Type'] = 'application/json'
    const response = await fetchImpl(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      signal,
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (signal?.aborted) return null
    return { status: response.status, body: payload }
  } catch {
    return signal?.aborted ? null : { status: 0, body: null }
  }
}

export async function loadAfaqyUnits(
  client: SessionClient,
  signal?: AbortSignal,
  fetchImpl: AfaqyFetch = defaultFetch,
): Promise<AfaqyUnitsAnswer | null> {
  const answer = await requestRoute(
    client,
    AFAQY_UNITS_ENDPOINT,
    'GET',
    undefined,
    signal,
    fetchImpl,
  )
  return answer && parseUnitsResponse(answer.status, answer.body)
}

export async function runAfaqySync(
  client: SessionClient,
  force = false,
  fetchImpl: AfaqyFetch = defaultFetch,
): Promise<AfaqySyncAnswer> {
  const answer = await requestRoute(
    client,
    AFAQY_SYNC_ENDPOINT,
    'POST',
    { force },
    undefined,
    fetchImpl,
  )
  return answer
    ? parseSyncResponse(answer.status, answer.body)
    : { kind: 'error' }
}

export async function loadEquipmentPosition(
  client: SessionClient,
  equipmentId: string,
  signal?: AbortSignal,
  fetchImpl: AfaqyFetch = defaultFetch,
): Promise<AfaqyPositionAnswer | null> {
  const query = new URLSearchParams({ equipmentId }).toString()
  const answer = await requestRoute(
    client,
    `${AFAQY_POSITION_ENDPOINT}?${query}`,
    'GET',
    undefined,
    signal,
    fetchImpl,
  )
  return answer && parsePositionResponse(answer.status, answer.body)
}

/** Client-side search of the cached unit list for the equipment form: code,
 *  plate, name or IMEI; at most `limit` rows (one admin call of a few hundred
 *  units, so no server round trip per keystroke). */
export function searchUnitList(
  units: readonly AfaqyUnitListItem[],
  query: string,
  limit = 20,
): AfaqyUnitListItem[] {
  const term = query.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!term) return units.slice(0, limit)
  const compact = term.replace(/ /g, '')
  const scored: { unit: AfaqyUnitListItem; score: number }[] = []
  for (const unit of units) {
    const name = unit.name.toUpperCase()
    const code = unit.code ?? ''
    let score = -1
    if (code === term) score = 0
    else if (code.startsWith(term)) score = 1
    else if (name.includes(term) || name.replace(/\s+/g, '').includes(compact))
      score = 2
    else if (unit.imei?.includes(compact)) score = 3
    if (score >= 0) scored.push({ unit, score })
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score || a.unit.name.localeCompare(b.unit.name, 'en'),
    )
    .slice(0, limit)
    .map((entry) => entry.unit)
}
