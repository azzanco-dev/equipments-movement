/**
 * The Excel export of the admin home's "outside right now" table.
 *
 * The export follows the filter the table is showing, not the page: the owner
 * asked for "the whole current filter", so the section walks the same database
 * function page by page and writes one sheet. Two caps keep that bounded — at
 * most `OUTSIDE_EXPORT_MAX_ROWS` rows, fetched `OUTSIDE_EXPORT_PAGE_SIZE` at a
 * time — and the caller is told when the cap actually truncated the file
 * rather than being handed a silently short export.
 *
 * Nothing here imports Supabase or `xlsx` at module level: the page walker
 * takes the fetcher as an argument, and the workbook is built behind a dynamic
 * import, so the ~400 KB spreadsheet library is only downloaded when someone
 * actually presses the export button on the landing page.
 */
import { formatDate } from '@/lib/dateFormat'
import type { OutsideEquipmentRow } from '@/lib/adminHomeStats'
import type { TranslationKey } from '@/i18n/translations'

/** Hard ceiling on an export, so one press can never pull an unbounded list
 *  into the browser. */
export const OUTSIDE_EXPORT_MAX_ROWS = 5000
/** Page size the export walks with: the largest the database function allows
 *  and the largest the shared list system offers. */
export const OUTSIDE_EXPORT_PAGE_SIZE = 500

export interface ExportPage<T> {
  rows: T[]
  total: number
}

export interface CollectedPages<T> {
  rows: T[]
  /** The size of the whole filtered set, as the database counted it. */
  total: number
  /** True when the cap stopped the walk before the end of the set. */
  capped: boolean
}

/**
 * Walks a paginated loader to the end of its result set.
 *
 * The loader is passed in rather than imported, which keeps this file free of
 * Supabase (and unit-testable) and lets the caller decide which filter the
 * export follows. The walk stops on three conditions, all of them necessary:
 * the reported total is reached, the cap is reached, or a page comes back
 * empty — the last one is what guarantees termination if the total and the
 * rows ever disagree.
 */
export async function collectAllPages<T>(
  loadPage: (page: number, pageSize: number) => Promise<ExportPage<T>>,
  options: { maxRows?: number; pageSize?: number } = {},
): Promise<CollectedPages<T>> {
  const pageSize = Math.max(
    1,
    Math.trunc(options.pageSize ?? OUTSIDE_EXPORT_PAGE_SIZE),
  )
  const maxRows = Math.max(
    1,
    Math.trunc(options.maxRows ?? OUTSIDE_EXPORT_MAX_ROWS),
  )
  const rows: T[] = []
  let total = 0
  let page = 1
  for (;;) {
    const result = await loadPage(page, pageSize)
    total = result.total
    if (result.rows.length === 0) break
    rows.push(...result.rows)
    if (rows.length >= maxRows) {
      rows.length = maxRows
      break
    }
    if (rows.length >= total) break
    page += 1
  }
  return { rows, total, capped: rows.length < total }
}

type Translate = (key: TranslationKey) => string

export interface OutsideExportOptions {
  t: Translate
  /** Labels an `ownership_status`; the section already has this hook. */
  ownerLabel: (owner: string) => string
  /** Right-to-left sheet layout for the Arabic interface. */
  lang: 'ar' | 'en'
}

export interface OutsideSheetData {
  headers: string[]
  body: string[][]
}

/**
 * The sheet's cells, in the table's own column order.
 *
 * Kept separate from the workbook so the wording and the fallbacks can be
 * tested without a spreadsheet library. Every row here is a unit that is
 * outside right now, so "last movement" is either the exit that took it out or
 * the explicit "no movements" of a unit that has never moved — never a blank
 * cell, which in a spreadsheet reads as missing data rather than as a fact.
 */
export function outsideEquipmentSheetData(
  rows: OutsideEquipmentRow[],
  { t, ownerLabel }: Omit<OutsideExportOptions, 'lang'>,
): OutsideSheetData {
  return {
    headers: [
      t('adminHomeColEquipment'),
      t('adminHomeColType'),
      t('adminHomeColOwner'),
      t('adminHomeColLastMovement'),
    ],
    body: rows.map((row) => [
      row.code,
      row.type,
      ownerLabel(row.owner),
      row.lastMovementAt
        ? formatDate(row.lastMovementAt)
        : t('adminHomeNeverMoved'),
    ]),
  }
}

/**
 * Builds and downloads the workbook.
 *
 * `xlsx` is imported dynamically: this is the admin landing page, and the
 * library is only needed once someone presses the button.
 */
export async function exportOutsideEquipmentToExcel(
  rows: OutsideEquipmentRow[],
  options: OutsideExportOptions,
): Promise<void> {
  const { t, lang } = options
  const { headers, body } = outsideEquipmentSheetData(rows, options)
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 16 }]
  sheet['!freeze'] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: 'A2',
    activePane: 'bottomLeft',
    state: 'frozen',
  }
  sheet['!autofilter'] = { ref: `A1:D${body.length + 1}` }
  // The Arabic sheet opens right to left, like every other export here.
  sheet['!rtl'] = lang === 'ar'
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    // Excel rejects a sheet name over 31 characters.
    t('adminHomeNoMovementTitle').slice(0, 31),
  )
  XLSX.writeFile(workbook, 'outside-equipment.xlsx')
}
