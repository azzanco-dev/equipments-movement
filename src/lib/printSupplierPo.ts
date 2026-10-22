/**
 * The PDF of one supplier PO (owner 2026-10-22, task 11): the same path as
 * the list export (`src/lib/printExport.ts`) — the PO page builds a payload
 * of display values, stores it in `sessionStorage` under a random key and
 * opens `/print/po?key=…` in a new tab; the print page
 * (`src/screens/purchasing/SupplierPoPrint.tsx`) reads it once, deletes it
 * and opens the browser's print dialog, whose «Save as PDF» renders Arabic
 * with the app's own font. The payload holds the PO's facts and lines as
 * data; the print page never fetches anything.
 *
 * Pure; the storage helpers are the generic ones of `printExport`.
 */

export const PRINT_SUPPLIER_PO_PATH = '/print/po'
const PAYLOAD_VERSION = 1

export interface SupplierPoPrintLine {
  code: string
  type: string | null
  plate: string | null
  /** Date keys (`YYYY-MM-DD`); an open card has no end. */
  periodFrom: string | null
  periodTo: string | null
  note: string | null
  /** Excluding VAT; null = «تحتاج تسعير». */
  price: number | null
}

export interface SupplierPoPrintPayload {
  version: typeof PAYLOAD_VERSION
  kind: 'supplier_po'
  lang: 'ar' | 'en'
  /** When the PDF was made, as an ISO instant (shown in Saudi time). */
  generatedAt: string
  poNumber: string
  status: 'open' | 'closed'
  /** The party as the page shows it (an owner class or the lessor). */
  supplier: string
  company: string
  project: string
  startDate: string
  createdBy: string
  createdAt: string
  closedAt: string | null
  notes: string | null
  lines: SupplierPoPrintLine[]
}

export function printSupplierPoUrl(id: string): string {
  return `${PRINT_SUPPLIER_PO_PATH}?key=${encodeURIComponent(id)}`
}

export function buildSupplierPoPrintPayload(
  input: Omit<SupplierPoPrintPayload, 'version' | 'kind' | 'generatedAt'> & {
    now?: Date
  },
): SupplierPoPrintPayload {
  const { now, ...rest } = input
  return {
    version: PAYLOAD_VERSION,
    kind: 'supplier_po',
    generatedAt: (now ?? new Date()).toISOString(),
    ...rest,
  }
}

export function encodeSupplierPoPrintPayload(
  payload: SupplierPoPrintPayload,
): string {
  return JSON.stringify(payload)
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

/**
 * The payload, or `null` when it is missing or does not have the expected
 * shape (an older or tampered value is treated as missing, never rendered).
 */
export function decodeSupplierPoPrintPayload(
  raw: string | null | undefined,
): SupplierPoPrintPayload | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<SupplierPoPrintPayload>
  if (payload.version !== PAYLOAD_VERSION || payload.kind !== 'supplier_po')
    return null
  if (
    (payload.lang !== 'ar' && payload.lang !== 'en') ||
    (payload.status !== 'open' && payload.status !== 'closed') ||
    !isString(payload.generatedAt) ||
    !isString(payload.poNumber) ||
    !isString(payload.supplier) ||
    !isString(payload.company) ||
    !isString(payload.project) ||
    !isString(payload.startDate) ||
    !isString(payload.createdBy) ||
    !isString(payload.createdAt) ||
    !isStringOrNull(payload.closedAt) ||
    !isStringOrNull(payload.notes) ||
    !Array.isArray(payload.lines)
  )
    return null
  if (
    !payload.lines.every(
      (line) =>
        line &&
        typeof line === 'object' &&
        isString(line.code) &&
        isStringOrNull(line.type) &&
        isStringOrNull(line.plate) &&
        isStringOrNull(line.periodFrom) &&
        isStringOrNull(line.periodTo) &&
        isStringOrNull(line.note) &&
        (line.price === null ||
          (typeof line.price === 'number' && Number.isFinite(line.price))),
    )
  )
    return null
  return payload as SupplierPoPrintPayload
}

/** The totals of the printed lines: priced sum (excl. VAT) and the unpriced count. */
export function supplierPoPrintTotals(
  lines: readonly Pick<SupplierPoPrintLine, 'price'>[],
): { total: number; unpriced: number } {
  let total = 0
  let unpriced = 0
  for (const line of lines) {
    if (line.price === null) unpriced += 1
    else total += line.price
  }
  return { total: Math.round(total * 100) / 100, unpriced }
}
