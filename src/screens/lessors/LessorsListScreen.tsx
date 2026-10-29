import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import { applyListFilters } from '@/lib/applyListFilters'
import { databaseErrorKind } from '@/lib/formValidation'
import { lessorsListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Lessor } from '@/lib/types'
import { LessorFormDialog } from './LessorFormDialog'
import { LessorsTable } from './LessorsTable'

const LIST_SELECT =
  'id,name,contact_person,contact_number,created_at,updated_at'

/** Orchestrator for the lessors list; same shape as the companies screen,
 *  minus the import/export/link dialogs lessors does not have. */
export function LessorsListScreen() {
  const { t } = useI18n()
  // Add, edit and delete follow `lessors.edit` (the row policies re-check
  // it); the purchasing role, for one, reads suppliers without it.
  const canEdit = lessorsActions(usePermissions()).edit
  const list = useDataListState(lessorsListConfig)
  const [lessors, setLessors] = useState<Lessor[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Lessor | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchLessors = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('lessors')
      .select(LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      lessorsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(lessorsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('lessorsLoadError'))
    setLessors((data as Lessor[]) ?? [])
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
    fetchLessors()
  }, [fetchLessors])

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (lessor: Lessor) => {
    setEditing(lessor)
    setFormOpen(true)
  }

  const remove = async (lessor: Lessor) => {
    if (
      !(await confirm({
        title: t('confirmDeleteTitle'),
        description: `${t('confirmDeleteQuestion')} ${t('dialogDescLessorDelete')}`,
        tone: 'danger',
      }))
    )
      return
    // Without the key the delete matches no row and PostgREST answers with
    // no error, so the deleted rows are read back.
    const { data, error } = await supabase
      .from('lessors')
      .delete()
      .eq('id', lessor.id)
      .select('id')
    if (refusedByPolicy(error, data)) {
      setLoadError(t('lessorDeleteNotAllowed'))
      return
    }
    if (error) {
      // 0134: a supplier referenced by equipment is refused by the database
      // (foreign key, ON DELETE RESTRICT); never show the raw error text.
      setLoadError(
        t(
          databaseErrorKind(error) === 'foreignKey'
            ? 'lessorDeleteBlocked'
            : 'deleteFailed',
        ),
      )
      return
    }
    fetchLessors()
  }

  const addButton = canEdit ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addLessor')}
    </Button>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('lessors')}
        description={t('lessorsDesc')}
        actions={<DataListActions primaryAction={addButton} />}
      />
      <DataListToolbar
        config={lessorsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={lessorsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
      />

      <LessorsTable
        rows={lessors}
        loading={loading}
        error={loadError}
        onRetry={fetchLessors}
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

      <LessorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lessor={editing}
        onSaved={fetchLessors}
      />
      {confirmDialog}
    </div>
  )
}
