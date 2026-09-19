import { useCallback, useEffect, useState } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { companiesListConfig } from '@/lib/listConfigs'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Company } from '@/lib/types'
import { CompaniesTable } from './CompaniesTable'
import { CompanyExportDialog } from './CompanyExportDialog'
import { CompanyFormDialog } from './CompanyFormDialog'
import { CompanyImportDialog } from './CompanyImportDialog'
import { CompanyProjectsDialog } from './CompanyProjectsDialog'

const LIST_SELECT = 'id,name_ar,name_en,created_at,updated_at'

/** Orchestrator for the companies list; same shape as the equipment and
 *  drivers screens. */
export function CompaniesListScreen() {
  const { t } = useI18n()
  const list = useDataListState(companiesListConfig)
  const [companies, setCompanies] = useState<Company[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Company | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [projectsCompany, setProjectsCompany] = useState<Company | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchCompanies = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('companies')
      .select(LIST_SELECT, { count: 'exact' })
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
    if (error) setLoadError(t('companiesLoadError'))
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
    t,
  ])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (company: Company) => {
    setEditing(company)
    setFormOpen(true)
  }

  const remove = async (company: Company) => {
    if (!(await confirm({ title: t('confirmDelete'), tone: 'danger' }))) return
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', company.id)
    if (error) console.error(error)
    fetchCompanies()
  }

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addCompany')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('companies')}
        description={t('companiesDesc')}
        actions={
          <DataListActions
            menuActions={
              <>
                <Button
                  variant="ghost"
                  icon={<Download size={16} aria-hidden="true" />}
                  onClick={() => setExportOpen(true)}
                >
                  {t('exportExcel')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Upload size={16} aria-hidden="true" />}
                  onClick={() => setImportOpen(true)}
                >
                  {t('importExcel')}
                </Button>
              </>
            }
            primaryAction={addButton}
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

      <CompaniesTable
        rows={companies}
        loading={loading}
        error={loadError}
        onRetry={fetchCompanies}
        sort={list.sort}
        direction={list.direction}
        onSortChange={list.setSort}
        onEdit={openEdit}
        onManageProjects={setProjectsCompany}
        onDelete={remove}
        emptyAction={addButton}
      />
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
        />
      )}

      <CompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        company={editing}
        onSaved={fetchCompanies}
      />
      <CompanyImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCompanies={companies}
        onImported={fetchCompanies}
      />
      <CompanyExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <CompanyProjectsDialog
        open={projectsCompany !== null}
        onOpenChange={(open) => {
          if (!open) setProjectsCompany(null)
        }}
        company={projectsCompany}
      />
      {confirmDialog}
    </div>
  )
}
