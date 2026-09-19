import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Plus, Trash2 } from 'lucide-react'
import { Button, PageHeader, useConfirm } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useRowSelection } from '@/components/data-list/useRowSelection'
import { DriverExcelImport } from '@/components/DriverExcelImport'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { driversListConfig } from '@/lib/listConfigs'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Driver } from '@/lib/types'
import { DriverFormDialog } from './DriverFormDialog'
import { DriversTable } from './DriversTable'

const LIST_SELECT =
  'id,full_name,name_en,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at'

export interface DriversListScreenProps {
  onSelectDriver: (id: string) => void
}

/** Orchestrator for the drivers list; same shape as the equipment screen. */
export function DriversListScreen({ onSelectDriver }: DriversListScreenProps) {
  const { t } = useI18n()
  const list = useDataListState(driversListConfig)
  const selection = useRowSelection()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchDrivers = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('drivers')
      .select(LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = sanitizeSearchTerm(list.search)
    if (term)
      query = query.or(
        `full_name.ilike.%${term}%,name_en.ilike.%${term}%,id_number.ilike.%${term}%,mobile_number.ilike.%${term}%`,
      )
    query = applyListFilters(
      query,
      list.filters,
      new Set(driversListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('driversLoadError'))
    setDrivers((data as Driver[]) ?? [])
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
    fetchDrivers()
  }, [fetchDrivers])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (driver: Driver) => {
    setEditing(driver)
    setFormOpen(true)
  }

  const remove = async (driver: Driver) => {
    if (!(await confirm({ title: t('confirmDelete'), tone: 'danger' }))) return
    const { error } = await supabase
      .from('drivers')
      .delete()
      .eq('id', driver.id)
    if (error) setLoadError(t('driverDeleteBlocked'))
    else fetchDrivers()
  }

  const removeSelected = async () => {
    if (
      !selection.selected.size ||
      !(await confirm({ title: t('confirmDelete'), tone: 'danger' }))
    )
      return
    const { error } = await supabase
      .from('drivers')
      .delete()
      .in('id', [...selection.selected])
    if (error) setLoadError(t('driverDeleteBlocked'))
    else {
      selection.clear()
      fetchDrivers()
    }
  }

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openCreate}
    >
      {t('addDriver')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('drivers')}
        description={t('driversDesc')}
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
        compact
        config={driversListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        pageSize={list.pageSize}
        onPageSize={list.setPageSize}
        filters={list.filters}
        onFilters={list.setFilters}
        selectedCount={selection.selected.size}
        bulkActions={
          <Button
            variant="outline"
            size="sm"
            icon={<Trash2 size={15} aria-hidden="true" />}
            onClick={removeSelected}
          >
            {t('delete')}
          </Button>
        }
      />

      <DriversTable
        rows={drivers}
        loading={loading}
        error={loadError}
        onRetry={fetchDrivers}
        sort={list.sort}
        direction={list.direction}
        onSortChange={list.setSort}
        selected={selection.selected}
        onToggleRow={selection.toggle}
        onTogglePage={selection.togglePage}
        onOpen={onSelectDriver}
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
        />
      )}

      <DriverFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        driver={editing}
        onSaved={fetchDrivers}
      />
      <DriverExcelImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={fetchDrivers}
      />
      {confirmDialog}
    </div>
  )
}
