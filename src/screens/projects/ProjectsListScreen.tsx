import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { projectsListConfig } from '@/lib/listConfigs'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/lib/types'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectImportDialog } from './ProjectImportDialog'
import { ProjectsTable } from './ProjectsTable'

const LIST_SELECT = 'id,name_ar,name_en,created_at,updated_at'

/** Orchestrator for the projects list; same shape as the companies screen. */
export function ProjectsListScreen() {
  const { t } = useI18n()
  const list = useDataListState(projectsListConfig)
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchProjects = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('projects')
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
      new Set(projectsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('projectsLoadError'))
    setProjects((data as Project[]) ?? [])
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
    fetchProjects()
  }, [fetchProjects])

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (project: Project) => {
    setEditing(project)
    setFormOpen(true)
  }

  const remove = async (project: Project) => {
    if (
      !(await confirm({
        title: t('confirmDeleteTitle'),
        description: `${t('confirmDeleteQuestion')} ${t('dialogDescProjectDelete')}`,
        tone: 'danger',
      }))
    )
      return
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', project.id)
    if (error) console.error(error)
    fetchProjects()
  }

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addProject')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('projects')}
        description={t('projectsDesc')}
        actions={
          <DataListActions
            menuActions={
              <Button
                variant="ghost"
                icon={<FileSpreadsheet size={16} aria-hidden="true" />}
                onClick={() => setImportOpen(true)}
              >
                {t('importExcel')}
              </Button>
            }
            primaryAction={addButton}
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
        filters={list.filters}
        onFilters={list.setFilters}
      />

      <ProjectsTable
        rows={projects}
        loading={loading}
        error={loadError}
        onRetry={fetchProjects}
        sort={list.sort}
        direction={list.direction}
        onSortChange={list.setSort}
        onEdit={openEdit}
        onDelete={remove}
        emptyAction={addButton}
      />
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        project={editing}
        onSaved={fetchProjects}
      />
      <ProjectImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingProjects={projects}
        onImported={fetchProjects}
      />
      {confirmDialog}
    </div>
  )
}
