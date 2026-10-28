import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import {
  companiesProjectsActions,
  refusedByPolicy,
} from '@/lib/actionPermissions'
import { applyListFilters } from '@/lib/applyListFilters'
import { databaseErrorKind } from '@/lib/formValidation'
import { projectsListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/lib/types'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectImportDialog } from './ProjectImportDialog'
import { ProjectsTable } from './ProjectsTable'

const LIST_SELECT = 'id,name_ar,name_en,created_at,updated_at'

/** Orchestrator for the projects list; same shape as the companies screen. */
export function ProjectsListScreen() {
  const { t } = useI18n()
  // Add, edit, delete and the Excel import follow `companies_projects.edit`
  // (the row policies re-check it).
  const canEdit = companiesProjectsActions(usePermissions()).edit
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
    const searchFilter = buildSearchFilter(
      projectsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
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
    // Without the key the delete matches no row and PostgREST answers with
    // no error, so the deleted rows are read back.
    const { data, error } = await supabase
      .from('projects')
      .delete()
      .eq('id', project.id)
      .select('id')
    if (refusedByPolicy(error, data)) {
      setLoadError(t('companiesProjectsDeleteNotAllowed'))
      return
    }
    if (error) {
      // 0134: a project referenced by a movement or a unit is refused by the
      // database (foreign key, ON DELETE RESTRICT); never show the raw text.
      setLoadError(
        t(
          databaseErrorKind(error) === 'foreignKey'
            ? 'projectDeleteBlocked'
            : 'deleteFailed',
        ),
      )
      return
    }
    fetchProjects()
  }

  const addButton = canEdit ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addProject')}
    </Button>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('projects')}
        description={t('projectsDesc')}
        actions={
          <DataListActions
            menuActions={
              canEdit ? (
                <Button
                  variant="ghost"
                  icon={<FileSpreadsheet size={16} aria-hidden="true" />}
                  onClick={() => setImportOpen(true)}
                >
                  {t('importExcel')}
                </Button>
              ) : undefined
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
        filterFields={projectsListConfig.filterFields}
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
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canEdit ? remove : undefined}
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
        open={importOpen && canEdit}
        onOpenChange={setImportOpen}
        existingProjects={projects}
        onImported={fetchProjects}
      />
      {confirmDialog}
    </div>
  )
}
