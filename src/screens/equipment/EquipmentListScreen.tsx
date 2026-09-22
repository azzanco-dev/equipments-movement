import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileSpreadsheet, Plus, Upload } from 'lucide-react'
import { Button, PageHeader } from '@/components/ui'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { EquipmentExcelUpdate } from '@/components/EquipmentExcelUpdate'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { equipmentListConfig } from '@/lib/listConfigs'
import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { EquipmentFormDialog } from './EquipmentFormDialog'
import { EquipmentImportDialog } from './EquipmentImportDialog'
import { EquipmentTable } from './EquipmentTable'

const LIST_SELECT =
  'id,code,type,plate_number,plate_digits,plate_letters_en,operational_status,ownership_status,project_id,lessor_id,brand,model,manufacture_year,chassis_number,registration_type,qr_value,last_maintenance_date,registration_expiry,insurance_expiry,is_active,status,master_data_complete,numbering_status,created_at,updated_at,project:projects(id,name_ar,name_en),lessor:lessors(id,name)'

export interface EquipmentListScreenProps {
  onSelectEquipment?: (id: string) => void
}

/** Orchestrator for the equipment list: URL state, the server query, and the
 *  toolbar/table/pagination plus the add-edit, QR and import dialogs. */
export function EquipmentListScreen({
  onSelectEquipment,
}: EquipmentListScreenProps = {}) {
  const { t } = useI18n()
  const editId = useSearchParams().get('edit')
  const list = useDataListState(equipmentListConfig)
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Equipment | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [updateExcelOpen, setUpdateExcelOpen] = useState(false)
  const listTopRef = useRef<HTMLDivElement>(null)

  const changePage = (nextPage: number) => {
    list.setPage(nextPage)
    window.requestAnimationFrame(() =>
      listTopRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    )
  }

  const startListRequest = useListRequest()
  const fetchEquipment = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('equipment')
      .select(LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = toLatinDigits(sanitizeSearchTerm(list.search))
    if (term) {
      const orParts = [
        `code.ilike.%${term}%`,
        `type.ilike.%${term}%`,
        `plate_number.ilike.%${term}%`,
        `chassis_number.ilike.%${term}%`,
      ]
      const plateDigits = plateDigitsSearchTerm(term)
      if (plateDigits) orParts.push(`plate_digits.ilike.%${plateDigits}%`)
      query = query.or(orParts.join(','))
    }
    query = applyListFilters(
      query,
      list.filters,
      new Set(equipmentListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('equipmentLoadError'))
    setEquipment((data as unknown as Equipment[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    startListRequest,
    t,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
  ])

  useEffect(() => {
    fetchEquipment()
  }, [fetchEquipment])

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = useCallback((row: Equipment) => {
    setEditing(row)
    setFormOpen(true)
  }, [])

  // `?edit=<id>` deep link (e.g. from the equipment detail screen).
  useEffect(() => {
    if (!editId) return
    const controller = new AbortController()
    void (async () => {
      const { data, error } = await supabase
        .from('equipment')
        .select(
          '*,project:projects(id,name_ar,name_en),lessor:lessors(id,name)',
        )
        .eq('id', editId)
        .abortSignal(controller.signal)
        .maybeSingle()
      if (controller.signal.aborted) return
      if (error || !data) setLoadError(t('equipmentLoadError'))
      else openEdit(data as Equipment)
      const url = new URL(window.location.href)
      url.searchParams.delete('edit')
      window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    })()
    return () => controller.abort()
  }, [editId, openEdit, t])

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addEquipment')}
    </Button>
  )

  return (
    <div ref={listTopRef} className="scroll-mt-20 space-y-4">
      <PageHeader
        title={t('equipmentList')}
        description={t('equipmentDesc')}
        actions={
          <DataListActions
            menuActions={
              <>
                <Button
                  variant="ghost"
                  icon={<FileSpreadsheet size={16} aria-hidden="true" />}
                  onClick={() => setUpdateExcelOpen(true)}
                >
                  {t('updateEquipmentExcel')}
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
        config={equipmentListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filters={list.filters}
        onFilters={list.setFilters}
      />

      <EquipmentTable
        rows={equipment}
        loading={loading}
        error={loadError}
        onRetry={fetchEquipment}
        sort={list.sort}
        direction={list.direction}
        onSortChange={list.setSort}
        onOpen={(id) => onSelectEquipment?.(id)}
        onEdit={openEdit}
        emptyAction={addButton}
      />
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={changePage}
          onPageSize={list.setPageSize}
        />
      )}

      <EquipmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        equipment={editing}
        onSaved={fetchEquipment}
      />
      <EquipmentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchEquipment}
      />
      <EquipmentExcelUpdate
        open={updateExcelOpen}
        onClose={() => setUpdateExcelOpen(false)}
        onUpdated={fetchEquipment}
      />
    </div>
  )
}
