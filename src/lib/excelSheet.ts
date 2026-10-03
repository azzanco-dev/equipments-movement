/**
 * The pure half of the formatted Excel exports: column descriptions, the
 * Saudi-time date serial, the cell matrix and the look of the sheet.
 *
 * Nothing here imports a spreadsheet library, so the column files
 * (`visitsList`, `movementExcel`, `adminHomeExport`) and the unit tests can use
 * it without downloading or loading one. The workbook itself is written by
 * `@/lib/excelExport`, the only place that imports `xlsx-js-style`; the import
 * parsers in `@/lib/excel` stay on plain `xlsx`.
 */

/** Excel's own date format code; `hh` is 24-hour in a workbook number format. */
export const EXCEL_DATETIME_FORMAT = 'dd/mm/yyyy hh:mm'

/** Days between Excel's epoch (1899-12-30) and the Unix epoch. */
const EXCEL_EPOCH_DAYS = 25569
const MINUTES_PER_DAY = 24 * 60
/** Saudi Arabia is UTC+03:00 all year, exactly as `@/lib/saudiTime` assumes. */
const SAUDI_OFFSET_MINUTES = 3 * 60

/**
 * An instant as an Excel date serial in Saudi time, or `null` when it is
 * missing or unparseable.
 *
 * A real date cell is written rather than pre-formatted text so the column
 * still sorts and filters as a date in Excel. The serial is computed from the
 * UTC instant plus a fixed +03:00, never from the machine's timezone, so the
 * file shows the same Saudi wall-clock time on every device — the same rule
 * the reports and the dashboard already follow. Whole minutes are used because
 * the display format stops at minutes, and a rounded serial avoids a value
 * like 23:59:59.9995 rendering as the next minute.
 */
export function saudiExcelSerial(
  value: string | null | undefined,
): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  const minutes = Math.round(ms / 60000) + SAUDI_OFFSET_MINUTES
  return EXCEL_EPOCH_DAYS + minutes / MINUTES_PER_DAY
}

export type ExcelCellValue = string | number | null

/**
 * One exported column.
 *
 * `type: 'date'` means `value` returns an ISO timestamp, which the writer
 * converts to a Saudi-time date cell; everything else is written as given.
 * Badges and enums are converted to plain text by `value` (دخول / خروج), never
 * exported as a code the reader would have to decode.
 */
export interface ExcelColumn<T> {
  header: string
  /** Column width in characters; a sensible default is used when omitted. */
  width?: number
  type?: 'text' | 'date'
  value: (row: T) => ExcelCellValue
}

export interface ExportRowsOptions {
  /** File name, with or without the `.xlsx` suffix. */
  fileName: string
  /** Right-to-left sheet layout; pass `lang === 'ar'`. */
  rtl?: boolean
}

export const DEFAULT_COLUMN_WIDTH = 16

/** `0 -> A`, `26 -> AA`; the autofilter needs the last column's letter. */
export function excelColumnLetter(index: number): string {
  let rest = Math.max(0, Math.trunc(index))
  let letter = ''
  for (;;) {
    letter = String.fromCharCode(65 + (rest % 26)) + letter
    if (rest < 26) return letter
    rest = Math.floor(rest / 26) - 1
  }
}

/**
 * The sheet's cells, headers first.
 *
 * Kept pure and separate from the workbook so the headers, the column order
 * and the Saudi-time conversion can be unit-tested without a spreadsheet
 * library. A `null` cell is written as an empty cell rather than the string
 * "null"; an em dash is never written, because in a spreadsheet a placeholder
 * character blocks filtering and aggregation.
 */
export function sheetAoa<T>(
  columns: ExcelColumn<T>[],
  rows: T[],
): ExcelCellValue[][] {
  return [
    columns.map((column) => column.header),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = column.value(row)
        if (column.type === 'date')
          return typeof value === 'string' ? saudiExcelSerial(value) : null
        return value ?? null
      }),
    ),
  ]
}

// ============ SHEET LOOK ============
//
// One look for every export: neutral grey header, thin light-grey borders,
// comfortable row height, text indented from the edge it is read from. No
// saturated colors; the file is a working document, not a report page.

/** Row heights in points. */
export const EXPORT_HEADER_HEIGHT_PT = 30
export const EXPORT_ROW_HEIGHT_PT = 24

/**
 * Extra characters added to every column width so indented text never clips.
 * A column's own `width` stays the width of its content.
 */
export const EXPORT_WIDTH_PADDING = 4

const BORDER_COLOR = 'D1D5DB'
const HEADER_FILL = 'F3F4F6'
const HEADER_TEXT = '111827'
const BODY_TEXT = '1F2937'

/** A cell style in `xlsx-js-style`'s shape, described without importing it. */
export interface ExportCellStyle {
  font: { name: string; sz: number; bold?: boolean; color: { rgb: string } }
  alignment: {
    horizontal: 'left' | 'center' | 'right'
    vertical: 'center'
    indent?: number
  }
  border: Record<
    'top' | 'bottom' | 'left' | 'right',
    { style: 'thin'; color: { rgb: string } }
  >
  fill?: { patternType: 'solid'; fgColor: { rgb: string } }
}

export type ExportCellKind = 'header' | 'text' | 'date'

function thinBorder(): ExportCellStyle['border'] {
  const side = { style: 'thin', color: { rgb: BORDER_COLOR } } as const
  return { top: side, bottom: side, left: side, right: side }
}

/**
 * The style of one cell.
 *
 * Text (and the header above it) sits against the edge a reader starts from —
 * right in a right-to-left sheet — with an indent of one so it never touches
 * the border. Date cells are centered because their width is fixed. Every cell
 * is vertically centered.
 */
export function exportCellStyle(
  kind: ExportCellKind,
  rtl: boolean,
  headerCentered = false,
): ExportCellStyle {
  const centered = kind === 'date' || (kind === 'header' && headerCentered)
  const style: ExportCellStyle = {
    font: {
      name: 'Calibri',
      sz: 11,
      color: { rgb: kind === 'header' ? HEADER_TEXT : BODY_TEXT },
      ...(kind === 'header' ? { bold: true } : {}),
    },
    alignment: centered
      ? { horizontal: 'center', vertical: 'center' }
      : { horizontal: rtl ? 'right' : 'left', vertical: 'center', indent: 1 },
    border: thinBorder(),
  }
  if (kind === 'header')
    style.fill = { patternType: 'solid', fgColor: { rgb: HEADER_FILL } }
  return style
}

/** A column's width in characters, with room for the indent. */
export function exportColumnWidth<T>(column: ExcelColumn<T>): number {
  return (column.width ?? DEFAULT_COLUMN_WIDTH) + EXPORT_WIDTH_PADDING
}
