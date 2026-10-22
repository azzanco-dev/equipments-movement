/**
 * wave-15-export: the PDF path of the list export.
 *
 * The PDF is produced by the browser's own print engine (owner decision: it
 * renders Arabic correctly, unlike a PDF library). The export dialog turns
 * the collected rows into display text here, stores one payload in
 * `sessionStorage` under a random key and opens `/print/export?key=…` in a new
 * tab; the print page (`src/screens/PrintExport.tsx`) reads the payload once,
 * deletes it and prints. The payload holds only display strings, so the print
 * page never fetches or looks anything up.
 *
 * Pure apart from the storage helpers, which take the storage as an argument.
 */
import type { ExcelColumn } from '@/lib/excelSheet'

export const PRINT_EXPORT_PATH = '/print/export'
export const PRINT_EXPORT_KEY_PREFIX = 'em.print-export.'
const PAYLOAD_VERSION = 1

export interface PrintExportColumn {
  header: string
  /** The Excel width hint in characters; the page turns it into a share. */
  width: number
  type: 'text' | 'date'
}

export interface PrintExportPayload {
  version: typeof PAYLOAD_VERSION
  /** The report title: the movements or the visits. */
  title: string
  lang: 'ar' | 'en'
  /** When the export was made, as an ISO instant (shown in Saudi time). */
  generatedAt: string
  /** The scope / filter line shown under the title. */
  summary: string
  /** The size of the exported set as the database counted it. */
  total: number
  /** True when the row cap stopped the export before the end of the set. */
  capped: boolean
  columns: PrintExportColumn[]
  /** One string per column, already formatted for display. */
  rows: string[][]
}

/** Saudi Arabia is UTC+03:00 all year, as `@/lib/saudiTime` assumes. */
const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * `dd/mm/yyyy hh:mm AM` in Saudi time, whatever the device's timezone; the
 * same shape as `formatDateTime` on screen. Empty for a missing or
 * unparseable value.
 */
export function formatSaudiDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return ''
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(ms)) return ''
  const saudi = new Date(ms + SAUDI_OFFSET_MS)
  const hours = saudi.getUTCHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const period = hours < 12 ? 'AM' : 'PM'
  return `${pad(saudi.getUTCDate())}/${pad(saudi.getUTCMonth() + 1)}/${saudi.getUTCFullYear()} ${pad(hour12)}:${pad(saudi.getUTCMinutes())} ${period}`
}

/** One cell as display text: dates in Saudi time, `null` as empty. */
export function printCellText<T>(column: ExcelColumn<T>, row: T): string {
  const value = column.value(row)
  if (column.type === 'date')
    return typeof value === 'string' ? formatSaudiDateTime(value) : ''
  if (value === null || value === undefined) return ''
  return String(value)
}

export const DEFAULT_PRINT_COLUMN_WIDTH = 16

export function buildPrintPayload<T>(input: {
  title: string
  lang: 'ar' | 'en'
  summary: string
  columns: readonly ExcelColumn<T>[]
  rows: readonly T[]
  total: number
  capped: boolean
  now?: Date
}): PrintExportPayload {
  return {
    version: PAYLOAD_VERSION,
    title: input.title,
    lang: input.lang,
    generatedAt: (input.now ?? new Date()).toISOString(),
    summary: input.summary,
    total: Math.max(input.total, input.rows.length),
    capped: input.capped,
    columns: input.columns.map((column) => ({
      header: column.header,
      width: column.width ?? DEFAULT_PRINT_COLUMN_WIDTH,
      type: column.type === 'date' ? 'date' : 'text',
    })),
    rows: input.rows.map((row) =>
      input.columns.map((column) => printCellText(column, row)),
    ),
  }
}

export function encodePrintPayload(payload: PrintExportPayload): string {
  return JSON.stringify(payload)
}

const isString = (value: unknown): value is string => typeof value === 'string'

/**
 * The payload, or `null` when it is missing or does not have the expected
 * shape (an older or tampered value is treated as missing, never rendered).
 */
export function decodePrintPayload(
  raw: string | null | undefined,
): PrintExportPayload | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<PrintExportPayload>
  if (payload.version !== PAYLOAD_VERSION) return null
  if (
    !isString(payload.title) ||
    !isString(payload.summary) ||
    !isString(payload.generatedAt) ||
    (payload.lang !== 'ar' && payload.lang !== 'en') ||
    typeof payload.total !== 'number' ||
    typeof payload.capped !== 'boolean' ||
    !Array.isArray(payload.columns) ||
    !Array.isArray(payload.rows)
  )
    return null
  const columns = payload.columns
  if (
    columns.length === 0 ||
    !columns.every(
      (column) =>
        column &&
        isString(column.header) &&
        typeof column.width === 'number' &&
        (column.type === 'text' || column.type === 'date'),
    )
  )
    return null
  if (
    !payload.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length === columns.length &&
        row.every(isString),
    )
  )
    return null
  return payload as PrintExportPayload
}

/**
 * Each column's share of the page width, in percent, from the width hints;
 * a missing or nonsensical hint counts as the default width.
 */
export function printColumnShares(
  columns: readonly Pick<PrintExportColumn, 'width'>[],
): number[] {
  const widths = columns.map((column) =>
    Number.isFinite(column.width) && column.width > 0
      ? column.width
      : DEFAULT_PRINT_COLUMN_WIDTH,
  )
  const sum = widths.reduce((total, width) => total + width, 0)
  return widths.map((width) =>
    sum > 0 ? Math.round((width / sum) * 10000) / 100 : 0,
  )
}

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

/** A random payload id; only ever used as a storage key and query value. */
export function newPrintExportId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function isPrintExportId(value: string | null | undefined) {
  return !!value && ID_PATTERN.test(value)
}

export function printExportStorageKey(id: string): string {
  return `${PRINT_EXPORT_KEY_PREFIX}${id}`
}

export function printExportUrl(id: string): string {
  return `${PRINT_EXPORT_PATH}?key=${encodeURIComponent(id)}`
}

type StorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>

/**
 * Removes the payloads an earlier export left behind (a print tab closed
 * before it loaded), so they do not pile up in the session.
 */
export function prunePrintPayloads(
  storage: Pick<Storage, 'removeItem' | 'key' | 'length'>,
): void {
  const stale: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(PRINT_EXPORT_KEY_PREFIX)) stale.push(key)
  }
  for (const key of stale) storage.removeItem(key)
}

/**
 * Stores the payload in each storage that accepts it: the new print tab's own
 * session storage and the opener's (which the print tab can read through
 * `window.opener`), so the page finds it whichever way the browser shares
 * session storage with a new tab. Throws only when no storage accepted it.
 */
export function storePrintPayload(
  storages: readonly (StorageLike | null | undefined)[],
  id: string,
  payload: PrintExportPayload,
): void {
  const encoded = encodePrintPayload(payload)
  let stored = false
  for (const storage of storages) {
    if (!storage) continue
    try {
      prunePrintPayloads(storage)
      storage.setItem(printExportStorageKey(id), encoded)
      stored = true
    } catch {
      // Unavailable or full; another storage may still hold it.
    }
  }
  if (!stored) throw new Error('print_payload_not_stored')
}

/**
 * The last payload taken, so a second read of the same id in the same page
 * (React StrictMode runs effects twice in development) still finds it after
 * the stored copies were deleted.
 */
let lastTaken: { id: string; payload: PrintExportPayload } | null = null

/**
 * Reads the payload from the first storage that holds a valid one and
 * deletes every stored copy, so a reload or a shared link shows the
 * "missing" state instead of stale rows.
 */
export function takePrintPayload(
  storages: readonly (
    Pick<Storage, 'getItem' | 'removeItem'> | null | undefined
  )[],
  id: string | null | undefined,
): PrintExportPayload | null {
  if (!isPrintExportId(id)) return null
  const key = printExportStorageKey(id as string)
  if (lastTaken && lastTaken.id === id) return lastTaken.payload
  let payload: PrintExportPayload | null = null
  for (const storage of storages) {
    if (!storage) continue
    try {
      payload ??= decodePrintPayload(storage.getItem(key))
      storage.removeItem(key)
    } catch {
      // A storage that cannot be read simply holds nothing.
    }
  }
  if (payload) lastTaken = { id: id as string, payload }
  return payload
}
