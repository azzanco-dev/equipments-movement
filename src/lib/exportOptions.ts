/**
 * wave-15-export: the pure half of the list export dialog
 * (`src/components/data-list/ExportDialog.tsx`): file types, scopes, the row
 * caps and the column selection that is remembered per list and file type.
 *
 * Nothing here imports React, Supabase or a spreadsheet library, so the rules
 * are unit-tested in `tests/wave15Export.test.cjs`.
 */
import { OUTSIDE_EXPORT_MAX_ROWS } from '@/lib/adminHomeExport'
import type { ExcelColumn } from '@/lib/excelSheet'

/** `xlsx` is the formatted Excel file; `pdf` is the browser's print page. */
export type ExportFileType = 'xlsx' | 'pdf'

export const EXPORT_FILE_TYPES: readonly ExportFileType[] = ['xlsx', 'pdf']

/**
 * `current` is the search, filters and context the screen is showing;
 * `all` drops the search and filters but keeps the view's own context.
 */
export type ExportScope = 'current' | 'all'

export const EXPORT_SCOPES: readonly ExportScope[] = ['current', 'all']

/**
 * Rows on one print page export. The print page renders every row as HTML in
 * one document, so it is kept well below the Excel cap.
 */
export const PDF_EXPORT_MAX_ROWS = 500

/** The most rows one export of this type writes. */
export function exportRowCap(fileType: ExportFileType): number {
  return fileType === 'pdf' ? PDF_EXPORT_MAX_ROWS : OUTSIDE_EXPORT_MAX_ROWS
}

/** How many rows the export will actually write for a counted set. */
export function exportedRowCount(total: number, cap: number): number {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0
  return Math.min(safeTotal, Math.max(0, Math.trunc(cap)))
}

type KeyedColumn = Pick<ExcelColumn<unknown>, 'key' | 'mandatory'>

/**
 * A column the user cannot leave out: one marked `mandatory`, or one without
 * a key (it cannot be named in a saved selection).
 */
export function isMandatoryColumn(column: KeyedColumn): boolean {
  return Boolean(column.mandatory) || !column.key
}

/** Every key of the column list, in column order. */
export function allColumnKeys(columns: readonly KeyedColumn[]): string[] {
  return columns
    .map((column) => column.key)
    .filter((key): key is string => !!key)
}

/** «الاساسية فقط»: the keys of the mandatory columns. */
export function mandatoryColumnKeys(columns: readonly KeyedColumn[]): string[] {
  return columns
    .filter((column) => column.key && isMandatoryColumn(column))
    .map((column) => column.key as string)
}

/**
 * A selection made valid for the column list: unknown keys dropped, the
 * mandatory columns always present, column order kept. Anything that is not
 * an array of strings (a missing or corrupt saved value) means every column.
 */
export function normalizeColumnSelection(
  columns: readonly KeyedColumn[],
  selection: unknown,
): string[] {
  const keys = allColumnKeys(columns)
  if (
    !Array.isArray(selection) ||
    selection.some((entry) => typeof entry !== 'string')
  )
    return keys
  const chosen = new Set(selection as string[])
  for (const key of mandatoryColumnKeys(columns)) chosen.add(key)
  return keys.filter((key) => chosen.has(key))
}

/** Toggles one optional column; a mandatory column never changes. */
export function toggleColumnKey(
  columns: readonly KeyedColumn[],
  selection: readonly string[],
  key: string,
  checked: boolean,
): string[] {
  const column = columns.find((entry) => entry.key === key)
  if (!column || isMandatoryColumn(column))
    return normalizeColumnSelection(columns, selection)
  const next = new Set(selection)
  if (checked) next.add(key)
  else next.delete(key)
  return normalizeColumnSelection(columns, Array.from(next))
}

/** The columns to write, in their own order; mandatory ones always kept. */
export function selectExportColumns<T>(
  columns: readonly ExcelColumn<T>[],
  selection: readonly string[],
): ExcelColumn<T>[] {
  const chosen = new Set(normalizeColumnSelection(columns, selection))
  return columns.filter(
    (column) =>
      isMandatoryColumn(column) || (column.key && chosen.has(column.key)),
  )
}

/** One remembered selection per list and file type. */
export function columnSelectionStorageKey(
  listId: string,
  fileType: ExportFileType,
): string {
  return `em.export-columns.${listId}.${fileType}`
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

/**
 * The remembered selection, normalized for the current columns; every column
 * when nothing usable is stored or storage is unavailable.
 */
export function readColumnSelection(
  storage: ReadableStorage | null | undefined,
  listId: string,
  fileType: ExportFileType,
  columns: readonly KeyedColumn[],
): string[] {
  let stored: unknown = undefined
  try {
    const raw = storage?.getItem(columnSelectionStorageKey(listId, fileType))
    if (raw) stored = JSON.parse(raw)
  } catch {
    stored = undefined
  }
  return normalizeColumnSelection(columns, stored)
}

/** Remembers a selection; a storage failure only loses the convenience. */
export function writeColumnSelection(
  storage: WritableStorage | null | undefined,
  listId: string,
  fileType: ExportFileType,
  selection: readonly string[],
): void {
  try {
    storage?.setItem(
      columnSelectionStorageKey(listId, fileType),
      JSON.stringify(selection),
    )
  } catch {
    // Private mode or a full quota: the next export starts from all columns.
  }
}
