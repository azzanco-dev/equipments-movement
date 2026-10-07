import { useEffect, useId, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Spinner,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { ExcelColumn } from '@/lib/excelSheet'
import {
  allColumnKeys,
  exportedRowCount,
  exportRowCap,
  isMandatoryColumn,
  mandatoryColumnKeys,
  normalizeColumnSelection,
  readColumnSelection,
  selectExportColumns,
  toggleColumnKey,
  writeColumnSelection,
  type ExportFileType,
  type ExportScope,
} from '@/lib/exportOptions'
import {
  buildPrintPayload,
  newPrintExportId,
  printExportUrl,
  storePrintPayload,
} from '@/lib/printExport'

/** The rows an export walked, with the columns that describe them. */
export interface ExportCollected<T> {
  rows: T[]
  /**
   * The columns to write. A view whose cells need lookups made at export
   * time (the visits supplier and driver mobile) builds them with the
   * looked-up values; the keys must match the dialog's `columns`.
   */
  columns: ExcelColumn<T>[]
  /** The size of the whole set, as the database counted it. */
  total: number
  /** True when the cap stopped the walk before the end of the set. */
  capped: boolean
}

export interface ExportResult {
  fileType: ExportFileType
  /** Rows written. */
  count: number
  total: number
  capped: boolean
}

export interface ExportDialogProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The list id the column choice is remembered under (per file type). */
  listId: string
  /** The sheet name and the print page title. */
  title: string
  /** The Excel file name. */
  fileName: string
  /** Describes the export columns for the checklist (key, header, mandatory). */
  columns: ExcelColumn<T>[]
  /** What the view lists whatever the scope, e.g. «المشاريع · الزيارات». */
  contextLabel: string
  /** The applied search term (not the unsent input). */
  search: string
  /** Filters that actually narrow the list (`countActiveFilters`). */
  activeFilters: number
  /** `head: true, count: 'exact'` over the same query builder as the list. */
  countRows: (scope: ExportScope, signal: AbortSignal) => Promise<number>
  /** Walks the set server-side up to `maxRows`, like the list's own query. */
  collectRows: (
    scope: ExportScope,
    maxRows: number,
  ) => Promise<ExportCollected<T>>
  /** Called after a successful export, so the screen can note a cap. */
  onExported?: (result: ExportResult) => void
}

/** A session storage (this tab's by default), or `null` where it throws. */
function sessionStore(
  read: () => Storage = () => window.sessionStorage,
): Storage | null {
  try {
    return read()
  } catch {
    return null
  }
}

type CountState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: number }

/** `localStorage`, or `null` where the accessor throws (blocked site data). */
function localStore(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * wave-15-export: the export dialog of the `/logs` views.
 *
 * File type (Excel or the PDF print page), scope (the current search +
 * filters, or every record of the view's context), the record count of that
 * scope and the columns to write. The count runs the list's own builder with
 * `head: true`, so the number is the one the export will walk; a count above
 * the type's cap is announced before exporting. Mandatory columns are always
 * written; the rest of the choice is remembered per list and file type.
 *
 * Excel is written in place; PDF stores display strings for the print page
 * (`@/lib/printExport`) and opens it in a new tab. That tab is opened at the
 * press itself, before the rows are fetched, so a popup blocker does not
 * swallow it; once the rows are ready the payload is written into the new
 * tab's session storage and this tab's (the print page reads either through
 * `window.opener`), and the tab is pointed at the print page.
 */
export function ExportDialog<T>({
  open,
  onOpenChange,
  listId,
  title,
  fileName,
  columns,
  contextLabel,
  search,
  activeFilters,
  countRows,
  collectRows,
  onExported,
}: ExportDialogProps<T>) {
  const { t, lang } = useI18n()
  const [fileType, setFileType] = useState<ExportFileType>('xlsx')
  const [scope, setScope] = useState<ExportScope>('current')
  const [selection, setSelection] = useState<string[]>(() =>
    allColumnKeys(columns),
  )
  const [count, setCount] = useState<CountState>({ status: 'loading' })
  const [countAttempt, setCountAttempt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const columnKeys = allColumnKeys(columns).join('|')

  // Each opening starts from the screen's current filter and a clean slate.
  useEffect(() => {
    if (!open) return
    setScope('current')
    setError(null)
  }, [open])

  // The remembered column choice of this list and file type.
  useEffect(() => {
    if (!open) return
    setSelection(readColumnSelection(localStore(), listId, fileType, columns))
    // `columns` is rebuilt on each render of the screen; its keys are what
    // the selection depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listId, fileType, columnKeys])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setCount({ status: 'loading' })
    countRows(scope, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setCount({ status: 'ready', value })
      },
      (countError: unknown) => {
        if (controller.signal.aborted) return
        // The raw PostgREST message never reaches the user.
        console.error('export count failed', countError)
        setCount({ status: 'error' })
      },
    )
    return () => controller.abort()
  }, [open, scope, countRows, countAttempt])

  const updateSelection = (next: string[]) => {
    const normalized = normalizeColumnSelection(columns, next)
    setSelection(normalized)
    writeColumnSelection(localStore(), listId, fileType, normalized)
  }

  const cap = exportRowCap(fileType)
  const total = count.status === 'ready' ? count.value : 0
  const exportCount = exportedRowCount(total, cap)
  const canExport = count.status === 'ready' && exportCount > 0 && !exporting

  const summary = useMemo(() => {
    if (scope === 'all') return `${contextLabel} · ${t('exportScopeAll')}`
    const parts = [contextLabel]
    const term = search.trim()
    if (term) parts.push(t('exportSummarySearch').replace('{term}', term))
    if (activeFilters > 0)
      parts.push(
        t('exportSummaryFilters').replace('{count}', String(activeFilters)),
      )
    if (!term && activeFilters === 0) parts.push(t('exportSummaryNone'))
    return parts.join(' · ')
  }, [activeFilters, contextLabel, scope, search, t])

  const runExport = async () => {
    setError(null)
    // The print tab is opened now, inside the press, so it is not blocked as
    // a popup; it is pointed at the print page once the rows are ready.
    let printWindow: Window | null = null
    if (fileType === 'pdf') {
      printWindow = window.open('', '_blank')
      if (!printWindow) {
        setError(t('exportPopupBlocked'))
        return
      }
      try {
        printWindow.document.title = t('printPreparing')
        printWindow.document.body.textContent = t('printPreparing')
      } catch {
        // Only a courtesy message; the page itself replaces it.
      }
    }
    setExporting(true)
    try {
      const collected = await collectRows(scope, cap)
      const chosen = selectExportColumns(collected.columns, selection)
      // The user closed the print tab while the rows were loading: nothing
      // to show, and nothing failed.
      if (printWindow?.closed) return
      if (fileType === 'xlsx') {
        const { exportRowsToExcel } = await import('@/lib/excelExport')
        exportRowsToExcel(title, chosen, collected.rows, {
          fileName,
          rtl: lang === 'ar',
        })
      } else if (printWindow) {
        const payload = buildPrintPayload({
          title,
          lang,
          summary,
          columns: chosen,
          rows: collected.rows,
          total: collected.total,
          capped: collected.capped,
        })
        const id = newPrintExportId()
        const popup = printWindow
        storePrintPayload(
          [sessionStore(() => popup.sessionStorage), sessionStore()],
          id,
          payload,
        )
        printWindow.location.replace(
          new URL(printExportUrl(id), window.location.origin).toString(),
        )
      }
      onExported?.({
        fileType,
        count: collected.rows.length,
        total: collected.total,
        capped: collected.capped,
      })
      onOpenChange(false)
    } catch (exportError) {
      // The raw PostgREST message never reaches the user.
      console.error('export failed', exportError)
      try {
        printWindow?.close()
      } catch {
        // Already closed by the user.
      }
      setError(t('logsExportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const columnsLabelId = useId()
  const chosen = new Set(selection)
  const basicKeys = mandatoryColumnKeys(columns)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!exporting) onOpenChange(next)
      }}
      title={t('exportDialogTitle')}
      description={t('exportDialogDesc')}
      footer={
        <>
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={exporting}
            disabled={!canExport}
            onClick={() => void runExport()}
          >
            {t('exportSubmit').replace(
              '{count}',
              String(count.status === 'ready' ? exportCount : 0),
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">
            {t('exportFileType')}
          </legend>
          <RadioGroup
            value={fileType}
            onValueChange={(value) => setFileType(value as ExportFileType)}
            disabled={exporting}
          >
            <RadioGroupItem value="xlsx" label={t('exportFileExcel')} />
            <RadioGroupItem value="pdf" label={t('exportFilePdf')} />
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">
            {t('exportScope')}
          </legend>
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as ExportScope)}
            disabled={exporting}
          >
            <RadioGroupItem value="current" label={t('exportScopeCurrent')} />
            <RadioGroupItem value="all" label={t('exportScopeAll')} />
          </RadioGroup>
          <p className="text-xs text-muted">{summary}</p>
          <div className="pt-1" aria-live="polite">
            {count.status === 'loading' ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" label={t('exportCountLoading')} />
                {t('exportCountLoading')}
              </span>
            ) : count.status === 'error' ? (
              <Notice
                tone="danger"
                size="compact"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCountAttempt((value) => value + 1)}
                  >
                    {t('retry')}
                  </Button>
                }
              >
                {t('exportCountError')}
              </Notice>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t('exportCountValue').replace(
                    '{count}',
                    String(count.value),
                  )}
                </p>
                {count.value > cap && (
                  <Notice tone="warning" size="compact">
                    {t('exportCappedBefore')
                      .replace('{count}', String(exportCount))
                      .replace('{total}', String(count.value))}
                  </Notice>
                )}
              </div>
            )}
          </div>
        </fieldset>

        <div
          role="group"
          aria-labelledby={columnsLabelId}
          className="space-y-2"
        >
          <div className="flex flex-wrap items-center gap-1">
            <span id={columnsLabelId} className="me-auto text-sm font-medium">
              {t('exportColumns')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => updateSelection(allColumnKeys(columns))}
            >
              {t('exportSelectAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => updateSelection(basicKeys)}
            >
              {t('exportBasicOnly')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => updateSelection([])}
            >
              {t('exportClearAll')}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {columns.map((column) =>
              column.key ? (
                <Checkbox
                  key={column.key}
                  label={column.header}
                  checked={chosen.has(column.key)}
                  disabled={exporting || isMandatoryColumn(column)}
                  onCheckedChange={(checked) =>
                    updateSelection(
                      toggleColumnKey(
                        columns,
                        selection,
                        column.key as string,
                        checked === true,
                      ),
                    )
                  }
                />
              ) : null,
            )}
          </div>
          <p className="text-xs text-muted">{t('exportMandatoryHint')}</p>
        </div>

        {error && (
          <Notice tone="danger" size="compact" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
