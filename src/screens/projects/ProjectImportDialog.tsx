import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  XCircle,
} from 'lucide-react'
import { Dialog } from '@/components/ui'
import { Alert } from '@/components/Alert'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  parseProjectsExcel,
  downloadProjectTemplate,
  type ProjectImportRow,
} from '@/lib/excel'
import type { Project } from '@/lib/types'

export interface ProjectImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The currently loaded page of projects, used for the local duplicate
   *  check ahead of insert — same lookup the legacy screen used. */
  existingProjects: Project[]
  /** Called after at least one row was inserted, so the list refetches. */
  onImported: () => void
}

/** Moved as-is from the legacy `AdminProjects` screen. */
export function ProjectImportDialog({
  open,
  onOpenChange,
  existingProjects,
  onImported,
}: ProjectImportDialogProps) {
  const { t } = useI18n()
  const [importData, setImportData] = useState<ProjectImportRow[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [importResult, setImportResult] = useState<{
    success: number
    fail: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const resetImport = () => {
    setImportData([])
    setSelectedRows(new Set())
    setImportError(null)
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = async (file: File) => {
    setImportError(null)
    setImportResult(null)
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setImportError(t('invalidFile'))
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const rows = parseProjectsExcel(buf, t)

      const existingAr = new Set(
        existingProjects.map((p) => p.name_ar.toLowerCase()),
      )
      const existingEn = new Set(
        existingProjects.map((p) => p.name_en.toLowerCase()),
      )
      const seenAr = new Set<string>()
      const seenEn = new Set<string>()
      for (const row of rows) {
        if (
          row.name_ar &&
          (existingAr.has(row.name_ar.toLowerCase()) ||
            seenAr.has(row.name_ar.toLowerCase()))
        ) {
          row._errors.push(t('duplicateProject'))
        }
        if (
          row.name_en &&
          (existingEn.has(row.name_en.toLowerCase()) ||
            seenEn.has(row.name_en.toLowerCase()))
        ) {
          row._errors.push(t('duplicateProject'))
        }
        if (row.name_ar) seenAr.add(row.name_ar.toLowerCase())
        if (row.name_en) seenEn.add(row.name_en.toLowerCase())
      }

      setImportData(rows)
      const validIndices = new Set(
        rows.filter((r) => r._errors.length === 0).map((r) => r._rowNumber),
      )
      setSelectedRows(validIndices)
    } catch {
      setImportError(t('invalidFile'))
    }
  }

  const toggleRow = (rowNum: number) => {
    const next = new Set(selectedRows)
    if (next.has(rowNum)) next.delete(rowNum)
    else next.add(rowNum)
    setSelectedRows(next)
  }

  const toggleAllValid = () => {
    const validRows = importData.filter((r) => r._errors.length === 0)
    const allSelected = validRows.every((r) => selectedRows.has(r._rowNumber))
    setSelectedRows(
      allSelected ? new Set() : new Set(validRows.map((r) => r._rowNumber)),
    )
  }

  const handleImport = async () => {
    setImporting(true)
    setImportError(null)

    const rowsToImport = importData.filter(
      (r) => selectedRows.has(r._rowNumber) && r._errors.length === 0,
    )
    const payload = rowsToImport.map((r) => ({
      name_ar: r.name_ar,
      name_en: r.name_en,
    }))

    try {
      let successCount = 0
      let failCount = 0
      const batchSize = 50
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize)
        const { error } = await supabase.from('projects').insert(batch)
        if (error) failCount += batch.length
        else successCount += batch.length
      }
      setImportResult({ success: successCount, fail: failCount })
      if (successCount > 0) onImported()
    } catch {
      setImportError(t('importError'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetImport()
        onOpenChange(next)
      }}
      title={t('importProjects')}
      size="lg"
    >
      {importError && (
        <div className="mb-4">
          <Alert type="error">{importError}</Alert>
        </div>
      )}
      {importResult && (
        <div className="mb-4">
          <Alert type={importResult.fail > 0 ? 'warning' : 'success'}>
            {importResult.fail > 0
              ? t('importPartialSuccess')
                  .replace('{success}', String(importResult.success))
                  .replace('{fail}', String(importResult.fail))
              : t('importSuccess').replace(
                  '{count}',
                  String(importResult.success),
                )}
          </Alert>
        </div>
      )}

      {importData.length === 0 && !importResult ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => downloadProjectTemplate(t)}
              className="btn-ghost text-sm"
            >
              <Download size={16} /> {t('downloadTemplate')}
            </button>
          </div>
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFileSelect(f)
            }}
          >
            <FileSpreadsheet size={48} className="mx-auto text-muted mb-4" />
            <p className="text-muted">{t('dragDropFile')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
              }}
            />
          </div>
        </div>
      ) : importData.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <CheckCircle2 size={16} /> {t('validRows')}:{' '}
                {importData.filter((r) => r._errors.length === 0).length}
              </span>
              <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <AlertTriangle size={16} /> {t('errorRows')}:{' '}
                {importData.filter((r) => r._errors.length > 0).length}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={toggleAllValid} className="btn-ghost text-sm">
                {selectedRows.size ===
                importData.filter((r) => r._errors.length === 0).length
                  ? t('deselectAll')
                  : t('selectAll')}
              </button>
              <button
                onClick={() => downloadProjectTemplate(t)}
                className="btn-ghost text-sm"
              >
                <Download size={16} /> {t('downloadTemplate')}
              </button>
            </div>
          </div>

          <div
            className="max-h-[400px] overflow-auto rounded-lg border"
            style={{ borderColor: 'var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <th className="px-3 py-2 w-8"></th>
                  <th className="table-header text-start px-3 py-2">
                    {t('row')}
                  </th>
                  <th className="table-header text-start px-3 py-2">
                    {t('projectNameAr')}
                  </th>
                  <th className="table-header text-start px-3 py-2">
                    {t('projectNameEn')}
                  </th>
                  <th className="table-header text-start px-3 py-2">
                    {t('rowErrors')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {importData.map((row) => {
                  const hasErrors = row._errors.length > 0
                  const isSelected = selectedRows.has(row._rowNumber)
                  return (
                    <tr
                      key={row._rowNumber}
                      className={`border-b last:border-0 ${hasErrors ? 'bg-red-50 dark:bg-red-950/20' : ''}`}
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={hasErrors}
                          checked={isSelected}
                          onChange={() => toggleRow(row._rowNumber)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 text-muted">{row._rowNumber}</td>
                      <td className="px-3 py-2 font-semibold">
                        {row.name_ar || '—'}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {row.name_en || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {hasErrors ? (
                          <div className="flex flex-wrap gap-1">
                            {row._errors.map((err, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
                              >
                                <XCircle size={12} /> {err}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <CheckCircle2
                            size={16}
                            className="text-green-600 dark:text-green-400"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={resetImport} className="btn-outline flex-1">
              {t('cancel')}
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selectedRows.size === 0}
              className="btn-primary flex-1"
            >
              {importing
                ? t('importing')
                : `${t('importSelected')} (${selectedRows.size})`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-8">
          <button
            onClick={() => {
              resetImport()
              onOpenChange(false)
            }}
            className="btn-primary"
          >
            {t('close')}
          </button>
        </div>
      )}
    </Dialog>
  )
}
