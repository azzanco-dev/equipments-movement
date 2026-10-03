/**
 * Builds and downloads one formatted export sheet.
 *
 * This is the only module that imports `xlsx-js-style` (a drop-in fork of
 * SheetJS that can write cell styles); the parsers in `@/lib/excel` stay on
 * plain `xlsx`. Reach it through a dynamic import so the library is only
 * downloaded when someone presses an export button.
 *
 * Every exported file opens the same way: Arabic headers from the translation
 * system, a grey bold header row, thin borders, comfortable row height and
 * padding, readable column widths, an autofilter on the header, a right-to-left
 * sheet for the Arabic interface, and timestamps that read as Saudi time
 * wherever the file is opened (see `@/lib/excelSheet`).
 *
 * Neither SheetJS build writes frozen panes, so the header row is not frozen.
 */
import * as XLSX from 'xlsx-js-style'
import {
  EXCEL_DATETIME_FORMAT,
  EXPORT_HEADER_HEIGHT_PT,
  EXPORT_ROW_HEIGHT_PT,
  exportCellStyle,
  exportColumnWidth,
  excelColumnLetter,
  sheetAoa,
  type ExcelColumn,
  type ExportRowsOptions,
} from '@/lib/excelSheet'

/** Excel rejects a sheet name longer than 31 characters or containing []:*?/\ */
function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1'
}

/** The styled workbook, before it is written; exposed so tests can inspect it. */
export function buildExportWorkbook<T>(
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[],
  options: Pick<ExportRowsOptions, 'rtl'> = {},
): XLSX.WorkBook {
  const rtl = Boolean(options.rtl)
  const aoa = sheetAoa(columns, rows)
  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  sheet['!cols'] = columns.map((column) => ({
    wch: exportColumnWidth(column),
  }))
  sheet['!rows'] = aoa.map((_, rowIndex) => ({
    hpt: rowIndex === 0 ? EXPORT_HEADER_HEIGHT_PT : EXPORT_ROW_HEIGHT_PT,
  }))
  const lastColumn = excelColumnLetter(Math.max(0, columns.length - 1))
  sheet['!autofilter'] = { ref: `A1:${lastColumn}${aoa.length}` }

  // The same few style objects are shared by every cell of a kind, so the
  // workbook's style table stays a handful of entries however long the export.
  const headerText = exportCellStyle('header', rtl)
  const headerDate = exportCellStyle('header', rtl, true)
  const bodyText = exportCellStyle('text', rtl)
  const bodyDate = exportCellStyle('date', rtl)

  columns.forEach((column, columnIndex) => {
    const isDate = column.type === 'date'
    for (let rowIndex = 0; rowIndex < aoa.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })
      // An empty value writes no cell; it still needs the border and height.
      const cell = (sheet[address] ??= { t: 's', v: '' }) as XLSX.CellObject
      if (rowIndex === 0) {
        cell.s = isDate ? headerDate : headerText
        continue
      }
      cell.s = isDate ? bodyDate : bodyText
      // Date cells carry the display format; `aoa_to_sheet` wrote them as
      // plain numbers, which would otherwise show as a five-digit serial.
      if (isDate && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = EXCEL_DATETIME_FORMAT
      }
    }
  })
  // The cells added above may extend nothing, but keep the used range exact.
  sheet['!ref'] = `A1:${lastColumn}${aoa.length}`

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(sheetName))
  // `!rtl` on the sheet is ignored by SheetJS; the view lives on the workbook.
  workbook.Workbook = { Views: [{ RTL: rtl }] }
  return workbook
}

export function exportRowsToExcel<T>(
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[],
  options: ExportRowsOptions,
) {
  const workbook = buildExportWorkbook(sheetName, columns, rows, options)
  XLSX.writeFile(
    workbook,
    options.fileName.endsWith('.xlsx')
      ? options.fileName
      : `${options.fileName}.xlsx`,
  )
}
