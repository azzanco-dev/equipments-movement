import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Button, Dialog, useConfirm } from '@/components/ui'
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
  FolderTree,
  X,
  Plus as PlusIcon,
} from 'lucide-react'
import type { Company, CompanyProject } from '@/lib/types'
import {
  parseCompaniesExcel,
  downloadCompanyTemplate,
  type CompanyImportRow,
} from '@/lib/excel'
import {
  COMPANY_EXPORT_COLUMNS,
  companyExportColumnLabels,
  exportCompaniesToExcel,
  type CompanyExportColumn,
  type CompanyExportRow,
} from '@/lib/companyExport'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { companiesListConfig } from '@/lib/listConfigs'
import { applyListFilters } from '@/lib/applyListFilters'
import { sanitizeSearchTerm } from '@/lib/search'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { localizedName } from '@/lib/localizedName'
import { RelativeTime } from '@/components/RelativeTime'

type CompanyProjectWithProject = CompanyProject & {
  project?: { id: string; name_ar: string; name_en: string } | null
}

export function AdminCompanies() {
  const { t, lang } = useI18n()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Company | null>(null)
  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const list = useDataListState(companiesListConfig)

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importData, setImportData] = useState<CompanyImportRow[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [importResult, setImportResult] = useState<{
    success: number
    fail: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportColumns, setExportColumns] = useState<Set<CompanyExportColumn>>(
    () => new Set(['name_ar', 'name_en', 'linked_projects']),
  )

  // Manage projects state
  const [projectsModalOpen, setProjectsModalOpen] = useState(false)
  const [projectsModalCompany, setProjectsModalCompany] =
    useState<Company | null>(null)
  const [companyLinks, setCompanyLinks] = useState<CompanyProjectWithProject[]>(
    [],
  )
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [addProjectId, setAddProjectId] = useState('')
  const [addProjectOption, setAddProjectOption] = useState<SelectOption | null>(
    null,
  )
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchCompanies = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    let query = supabase
      .from('companies')
      .select('id,name_ar,name_en,created_at,updated_at', { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = sanitizeSearchTerm(list.search)
    if (term)
      query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
    query = applyListFilters(
      query,
      list.filters,
      new Set(companiesListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) console.error(error)
    setCompanies((data as Company[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    startListRequest,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
  ])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  function openAdd() {
    setEditing(null)
    setNameAr('')
    setNameEn('')
    setFormError(null)
    setModalOpen(true)
  }
  function openEdit(c: Company) {
    setEditing(c)
    setNameAr(c.name_ar)
    setNameEn(c.name_en)
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
          .from('companies')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('companies').insert(payload)
        if (error) throw error
      }
      setModalOpen(false)
      fetchCompanies()
    } catch (err) {
      console.error(err)
      setFormError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Company) {
    if (!(await confirm({ title: t('confirmDelete'), tone: 'danger' }))) return
    const { error } = await supabase.from('companies').delete().eq('id', c.id)
    if (error) console.error(error)
    fetchCompanies()
  }

  async function openManageProjects(c: Company) {
    setProjectsModalCompany(c)
    setProjectsModalOpen(true)
    setLinkError(null)
    setAddProjectId('')
    setAddProjectOption(null)
    setLinkLoading(true)
    const { data } = await supabase
      .from('company_projects')
      .select(
        'id,company_id,project_id,created_at,project:projects(id,name_ar,name_en)',
      )
      .eq('company_id', c.id)
    setCompanyLinks((data as unknown as CompanyProjectWithProject[]) ?? [])
    setLinkLoading(false)
  }

  const loadAvailableProjects = useCallback(
    async (query: string) => {
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const linkedIds = companyLinks.map((link) => link.project_id)
      if (linkedIds.length)
        request = request.not('id', 'in', `(${linkedIds.join(',')})`)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((project) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      }))
    },
    [companyLinks, lang],
  )

  async function addProjectLink() {
    if (!projectsModalCompany || !addProjectId) return
    setLinkError(null)
    const { error } = await supabase
      .from('company_projects')
      .insert({ company_id: projectsModalCompany.id, project_id: addProjectId })
    if (error) {
      console.error(error)
      setLinkError(t('saveFailed'))
      return
    }
    setAddProjectId('')
    setAddProjectOption(null)
    const { data } = await supabase
      .from('company_projects')
      .select(
        'id,company_id,project_id,created_at,project:projects(id,name_ar,name_en)',
      )
      .eq('company_id', projectsModalCompany.id)
    setCompanyLinks((data as unknown as CompanyProjectWithProject[]) ?? [])
  }

  async function removeProjectLink(linkId: string) {
    if (!projectsModalCompany) return
    setLinkError(null)
    const { error } = await supabase
      .from('company_projects')
      .delete()
      .eq('id', linkId)
    if (error) {
      console.error(error)
      setLinkError(t('saveFailed'))
      return
    }
    const { data } = await supabase
      .from('company_projects')
      .select(
        'id,company_id,project_id,created_at,project:projects(id,name_ar,name_en)',
      )
      .eq('company_id', projectsModalCompany.id)
    setCompanyLinks((data as unknown as CompanyProjectWithProject[]) ?? [])
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
      const rows = parseCompaniesExcel(buf, t)

      const existingAr = new Set(companies.map((c) => c.name_ar.toLowerCase()))
      const existingEn = new Set(companies.map((c) => c.name_en.toLowerCase()))
      const seenAr = new Set<string>()
      const seenEn = new Set<string>()
      for (const row of rows) {
        if (
          row.name_ar &&
          (existingAr.has(row.name_ar.toLowerCase()) ||
            seenAr.has(row.name_ar.toLowerCase()))
        ) {
          row._errors.push(t('duplicateCompany'))
        }
        if (
          row.name_en &&
          (existingEn.has(row.name_en.toLowerCase()) ||
            seenEn.has(row.name_en.toLowerCase()))
        ) {
          row._errors.push(t('duplicateCompany'))
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
        const { error } = await supabase.from('companies').insert(batch)
        if (error) {
          failCount += batch.length
        } else {
          successCount += batch.length
        }
      }
      setImportResult({ success: successCount, fail: failCount })
      if (successCount > 0) fetchCompanies()
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

  function toggleExportColumn(column: CompanyExportColumn) {
    setExportColumns((current) => {
      const next = new Set(current)
      if (next.has(column)) next.delete(column)
      else next.add(column)
      return next
    })
  }

  async function handleExport() {
    const selectedColumns = COMPANY_EXPORT_COLUMNS.filter((column) =>
      exportColumns.has(column),
    )
    if (!selectedColumns.length) return
    setExporting(true)
    setExportError(null)
    try {
      const allCompanies: Company[] = []
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from('companies')
          .select('id,name_ar,name_en,created_at,updated_at')
          .order('name_ar')
          .order('id')
          .range(from, from + 499)
        if (error) throw error
        const batch = (data as Company[]) ?? []
        allCompanies.push(...batch)
        if (batch.length < 500) break
      }

      const projectsByCompany = new Map<
        string,
        Array<{ name_ar: string; name_en: string }>
      >()
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from('company_projects')
          .select('company_id,project:projects(name_ar,name_en)')
          .order('company_id')
          .range(from, from + 499)
        if (error) throw error
        const batch = (data ?? []) as unknown as Array<{
          company_id: string
          project: { name_ar: string; name_en: string } | null
        }>
        for (const link of batch) {
          if (!link.project) continue
          const projects = projectsByCompany.get(link.company_id) ?? []
          projects.push(link.project)
          projectsByCompany.set(link.company_id, projects)
        }
        if (batch.length < 500) break
      }

      const rows: CompanyExportRow[] = allCompanies.map((company) => ({
        ...company,
        projects: projectsByCompany.get(company.id) ?? [],
      }))
      exportCompaniesToExcel(rows, selectedColumns, t, lang)
      setExportModalOpen(false)
    } catch (error) {
      console.error(error)
      setExportError(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('companies')}
        description={t('companiesDesc')}
        actions={
          <DataListActions
            menuActions={
              <>
                <button
                  onClick={() => {
                    setExportError(null)
                    setExportModalOpen(true)
                  }}
                  className="btn-ghost"
                >
                  <Download size={16} /> {t('exportExcel')}
                </button>
                <button
                  onClick={() => {
                    resetImport()
                    setImportModalOpen(true)
                  }}
                  className="btn-ghost"
                >
                  <Upload size={16} /> {t('importExcel')}
                </button>
              </>
            }
            primaryAction={
              <button onClick={openAdd} className="btn-primary">
                <Plus size={18} /> {t('addCompany')}
              </button>
            }
          />
        }
      />
      <DataListToolbar
        config={companiesListConfig}
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
      ) : companies.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">{t('noCompanies')}</p>
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
                    {t('company')}
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
                {companies.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {localizedName(lang, c.name_ar, c.name_en)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          className="btn-ghost p-1.5"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => openManageProjects(c)}
                          className="btn-ghost p-1.5"
                          title={t('manageProjects')}
                        >
                          <FolderTree size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="btn-ghost p-1.5"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime value={c.updated_at} />
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

      <Dialog
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        title={t('exportCompanies')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setExportModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              icon={<Download size={16} />}
              loading={exporting}
              disabled={exportColumns.size === 0}
              onClick={handleExport}
            >
              {t('exportExcel')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {exportError && <Alert type="error">{exportError}</Alert>}
          <p className="text-sm text-muted">{t('companyExportHelp')}</p>
          <div className="space-y-2">
            {COMPANY_EXPORT_COLUMNS.map((column) => (
              <label
                key={column}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                <input
                  type="checkbox"
                  checked={exportColumns.has(column)}
                  onChange={() => toggleExportColumn(column)}
                  className="rounded"
                />
                {t(companyExportColumnLabels[column])}
              </label>
            ))}
          </div>
        </div>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? t('editCompany') : t('addCompany')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              {t('save')}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="mb-4">
            <Alert type="error">{formError}</Alert>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="label">{t('companyNameAr')} *</label>
            <input
              className="input"
              dir="rtl"
              placeholder={t('companyNameArPlaceholder')}
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('companyNameEn')} *</label>
            <input
              className="input"
              dir="ltr"
              placeholder={t('companyNameEnPlaceholder')}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
        </div>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        title={t('importCompanies')}
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
                onClick={() => downloadCompanyTemplate(t)}
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
                  onClick={() => downloadCompanyTemplate(t)}
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
                      {t('companyNameAr')}
                    </th>
                    <th className="table-header text-start px-3 py-2">
                      {t('companyNameEn')}
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
      </Dialog>

      {/* Manage Projects Dialog */}
      <Dialog
        open={projectsModalOpen}
        onOpenChange={setProjectsModalOpen}
        title={`${t('manageProjects')} — ${projectsModalCompany ? localizedName(lang, projectsModalCompany.name_ar, projectsModalCompany.name_en) : ''}`}
        size="md"
      >
        {linkError && (
          <div className="mb-4">
            <Alert type="error">{linkError}</Alert>
          </div>
        )}

        {linkLoading ? (
          <InlineSpinner label={t('loading')} />
        ) : (
          <div className="space-y-4">
            {/* Linked projects list */}
            <div>
              <p className="label mb-2">{t('linkedProjects')}</p>
              {companyLinks.length === 0 ? (
                <p className="text-sm text-muted py-2">
                  {t('noLinkedProjects')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {companyLinks.map((link) => {
                    return (
                      <div
                        key={link.id}
                        className="flex items-center justify-between rounded-lg border px-3 py-2"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <span className="text-sm font-medium">
                          {link.project
                            ? localizedName(
                                lang,
                                link.project.name_ar,
                                link.project.name_en,
                              )
                            : link.project_id}
                        </span>
                        <button
                          onClick={() => removeProjectLink(link.id)}
                          className="btn-ghost p-1 text-red-600 dark:text-red-400"
                          title={t('removeProjectLink')}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Add project link */}
            <div
              className="pt-2 border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <p className="label mb-2">{t('addProjectLink')}</p>
              <div className="flex gap-2">
                <AsyncSearchSelect
                  className="flex-1"
                  value={addProjectId}
                  selectedOption={addProjectOption}
                  onChange={(value, option) => {
                    setAddProjectId(value)
                    setAddProjectOption(option)
                  }}
                  loadOptions={loadAvailableProjects}
                  placeholder="—"
                />
                <button
                  onClick={addProjectLink}
                  disabled={!addProjectId}
                  className="btn-primary px-3"
                >
                  <PlusIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
      {confirmDialog}
    </div>
  )
}
