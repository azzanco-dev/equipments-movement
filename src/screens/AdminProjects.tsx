import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Modal } from '@/components/Modal'
import { Alert } from '@/components/Alert'
import { InlineSpinner } from '@/components/Spinner'
import { PageHeader } from '@/components/PageHeader'
import {
  Plus,
  Edit2,
  Trash2,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import type { Project } from '@/lib/types'
import {
  parseProjectsExcel,
  downloadProjectTemplate,
  type ProjectImportRow,
} from '@/lib/excel'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useDataListState } from '@/components/data-list/useDataListState'
import { projectsListConfig } from '@/lib/listConfigs'
import { applyListFilters } from '@/lib/applyListFilters'
import { sanitizeSearchTerm } from '@/lib/search'
import { localizedName } from '@/lib/localizedName'
import { RelativeTime } from '@/components/RelativeTime'

export function AdminProjects() {
  const { t, lang } = useI18n()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const list = useDataListState(projectsListConfig)

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)
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

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('projects')
      .select('id,name_ar,name_en,created_at', { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = sanitizeSearchTerm(list.search)
    if (term)
      query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
    query = applyListFilters(
      query,
      list.filters,
      new Set(projectsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query
    if (error) console.error(error)
    setProjects((data as Project[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
  ])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  function openAdd() {
    setEditing(null)
    setNameAr('')
    setNameEn('')
    setFormError(null)
    setModalOpen(true)
  }
  function openEdit(p: Project) {
    setEditing(p)
    setNameAr(p.name_ar)
    setNameEn(p.name_en)
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setFormError(null)
    try {
      const payload = { name_ar: nameAr, name_en: nameEn }
      if (editing) {
        const { error } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('projects').insert(payload)
        if (error) throw error
      }
      setModalOpen(false)
      fetchProjects()
    } catch (err) {
      console.error(err)
      setFormError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(p: Project) {
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('projects').delete().eq('id', p.id)
    if (error) console.error(error)
    fetchProjects()
  }

  async function handleFileSelect(file: File) {
    setImportError(null)
    setImportResult(null)
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setImportError(t('invalidFile'))
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const rows = parseProjectsExcel(buf, t)

      const existingAr = new Set(projects.map((p) => p.name_ar.toLowerCase()))
      const existingEn = new Set(projects.map((p) => p.name_en.toLowerCase()))
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

  function toggleRow(rowNum: number) {
    const next = new Set(selectedRows)
    if (next.has(rowNum)) next.delete(rowNum)
    else next.add(rowNum)
    setSelectedRows(next)
  }

  function toggleAllValid() {
    const validRows = importData.filter((r) => r._errors.length === 0)
    const allSelected = validRows.every((r) => selectedRows.has(r._rowNumber))
    if (allSelected) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(validRows.map((r) => r._rowNumber)))
    }
  }

  async function handleImport() {
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
        if (error) {
          failCount += batch.length
        } else {
          successCount += batch.length
        }
      }
      setImportResult({ success: successCount, fail: failCount })
      if (successCount > 0) fetchProjects()
    } catch {
      setImportError(t('importError'))
    } finally {
      setImporting(false)
    }
  }

  function resetImport() {
    setImportData([])
    setSelectedRows(new Set())
    setImportError(null)
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('projects')}
        description={t('projectsDesc')}
        actions={
          <DataListActions
            menuActions={
              <button
                onClick={() => {
                  resetImport()
                  setImportModalOpen(true)
                }}
                className="btn-ghost"
              >
                <Upload size={16} /> {t('importExcel')}
              </button>
            }
            primaryAction={
              <button onClick={openAdd} className="btn-primary">
                <Plus size={18} /> {t('addProject')}
              </button>
            }
          />
        }
      />
      <DataListToolbar
        config={projectsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        pageSize={list.pageSize}
        onPageSize={list.setPageSize}
        filters={list.filters}
        onFilters={list.setFilters}
      />

      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : projects.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">{t('noProjects')}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <th className="table-header text-start px-4 py-3">
                    {t('project')}
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    {t('actions')}
                  </th>
                  <th
                    className="table-header px-4 py-3"
                    aria-label={t('createdAt')}
                  />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {localizedName(lang, p.name_ar, p.name_en)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="btn-ghost p-1.5"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          className="btn-ghost p-1.5"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime value={p.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DataListPagination
        page={list.page}
        pageSize={list.pageSize}
        total={total}
        onPage={list.setPage}
      />

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('editProject') : t('addProject')}
        size="sm"
      >
        {formError && (
          <div className="mb-4">
            <Alert type="error">{formError}</Alert>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="label">{t('projectNameAr')} *</label>
            <input
              className="input"
              placeholder={t('projectNameArPlaceholder')}
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              dir="rtl"
            />
          </div>
          <div>
            <label className="label">{t('projectNameEn')} *</label>
            <input
              className="input"
              placeholder={t('projectNameEnPlaceholder')}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              dir="ltr"
            />
          </div>
        </div>
        <div className="flex gap-3 pt-4">
          <button
            onClick={() => setModalOpen(false)}
            className="btn-outline flex-1"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title={t('importProjects')}
        size="xl"
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
                        <td className="px-3 py-2 text-muted">
                          {row._rowNumber}
                        </td>
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
                setImportModalOpen(false)
              }}
              className="btn-primary"
            >
              {t('close')}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
