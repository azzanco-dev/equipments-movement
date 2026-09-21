import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { lessorsListConfig } from '@/lib/listConfigs'
import { sanitizeSearchTerm } from '@/lib/search'
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
    const term = sanitizeSearchTerm(list.search)
    if (term)
      query = query.or(
        `name.ilike.%${term}%,contact_person.ilike.%${term}%,contact_number.ilike.%${term}%`,
      )
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
    const { error } = await supabase
      .from('lessors')
      .delete()
      .eq('id', lessor.id)
    if (error) console.error(error)
    fetchLessors()
  }

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addLessor')}
    </Button>
  )

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
