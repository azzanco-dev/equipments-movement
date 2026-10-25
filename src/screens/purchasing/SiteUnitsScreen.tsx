import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { ArrowUpRight, Plus } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { AddEquipmentDialog } from '@/components/purchasing/AddEquipmentDialog'
import {
  CreateSupplierPoDialog,
  type CreateSupplierPoPreset,
} from '@/components/purchasing/CreateSupplierPoDialog'
import {
  EmptyState,
  IconButton,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import {
  lessorFilterOptions,
  SUPPLIER_FILTER_KEY,
} from '@/lib/equipmentSupplier'
import { foremanFilterOptions } from '@/lib/foremanFilter'
import { siteUnitsListConfig } from '@/lib/listConfigs'
import { localizedName } from '@/lib/localizedName'
import {
  isSupplierPoOwnerClass,
  SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS,
} from '@/lib/purchasing'
import { SITE_UNITS_SELECT, type SiteUnitRow } from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export interface SiteUnitsScreenProps {
  onSelectPo: (poId: string) => void
  /** Opens the unit's open entry (/movements/:id); omitted when the shell
   *  cannot open the movement page, and the button is not shown. */
  onSelectMovement?: (movementId: string) => void
}

/** Stable across renders, so the bar's controls do not reload on each one. */
const ASYNC_FILTERS = {
  [SUPPLIER_FILTER_KEY]: lessorFilterOptions(supabase),
  entry_supervisor_id: foremanFilterOptions(supabase),
}

/** The tone of a ticket's stub: amber without a PO, green with one. */
const toneOf = (row: SiteUnitRow) => (row.has_po ? 'success' : 'warning')

/** The «+» on a ticket without a PO: solid amber, fully round, with the page
 *  colour for the sign (white in the light theme). Tokens only. */
const ADD_BUTTON_STYLE: CSSProperties = {
  color: 'var(--bg)',
  borderColor: 'var(--warning)',
  backgroundColor: 'var(--warning)',
}

/** The SPO on a ticket with a PO: a round green pill that opens the PO. */
const SPO_BUTTON_STYLE: CSSProperties = {
  color: 'var(--success)',
  backgroundColor: 'var(--success-soft)',
}

/** The add target: the party's open PO there, else a new PO for the unit. */
type AddTarget =
  | { kind: 'existing'; row: SiteUnitRow }
  | { kind: 'new'; preset: CreateSupplierPoPreset }

/**
 * «المعدات في المشاريع» (/purchasing/units, owner 2026-10-24, design
 * approved on /ui-kit «مربعات صغيرة»): every unit inside a project now
 * (`purchasing_site_units`, migration 0147) as a coloured tile — the code
 * with its plate or chassis, the company's number under it, the type, the
 * owner or supplier, «الشركة · المشروع», the foreman — ending in its open
 * SPO or «اضافة الى PO». Search, filters, sort and paging are server-side
 * through the unified list system. Adding goes to the party's open PO there
 * (`add_supplier_po_equipment`), else opens a new PO with the unit ticked;
 * the database re-checks every rule. The add needs `purchasing.manage`.
 */
export function SiteUnitsScreen({
  onSelectPo,
  onSelectMovement,
}: SiteUnitsScreenProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('purchasing.manage')
  const list = useDataListState(siteUnitsListConfig)
  const [rows, setRows] = useState<SiteUnitRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [target, setTarget] = useState<AddTarget | null>(null)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ ...ASYNC_FILTERS, ...companyProjectFilters }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('purchasing_site_units')
      .select(SITE_UNITS_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      // Newest entry next, then the entry id: deterministic paging.
      .order('entry_at', { ascending: false })
      .order('entry_id', { ascending: true })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      siteUnitsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(siteUnitsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(true)
    setRows((data as unknown as SiteUnitRow[] | null) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    startListRequest,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const ownerLine = (row: SiteUnitRow) =>
    row.equipment_ownership_status === 'external_supplier'
      ? row.equipment_lessor_name || t('adminHomeOwnerExternal')
      : isSupplierPoOwnerClass(row.equipment_ownership_status)
        ? t(SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS[row.equipment_ownership_status])
        : '—'

  const openAdd = (row: SiteUnitRow) => {
    if (row.party_po_id) {
      setTarget({ kind: 'existing', row })
      return
    }
    const ownerClass = isSupplierPoOwnerClass(row.equipment_ownership_status)
      ? row.equipment_ownership_status
      : null
    setTarget({
      kind: 'new',
      preset: {
        ownerClass,
        lessor:
          !ownerClass && row.equipment_lessor_id
            ? {
                value: row.equipment_lessor_id,
                label: row.equipment_lessor_name ?? '',
              }
            : null,
        companyId: row.company_id ?? '',
        projectId: row.project_id ?? '',
        equipmentId: row.equipment_id,
        startDate: saudiDateKey(row.entry_at),
      },
    })
  }

  const closeAdd = (open: boolean) => {
    if (!open) setTarget(null)
  }

  const existing = target?.kind === 'existing' ? target.row : null
  // Stable while the dialog is open, so its unit search does not reload.
  const existingPo = useMemo(
    () =>
      existing && {
        id: existing.party_po_id!,
        lessor_id:
          existing.equipment_ownership_status === 'external_supplier'
            ? existing.equipment_lessor_id
            : null,
        owner_class: isSupplierPoOwnerClass(existing.equipment_ownership_status)
          ? existing.equipment_ownership_status
          : null,
        company_id: existing.company_id ?? '',
        project_id: existing.project_id ?? '',
      },
    [existing],
  )
  const existingUnit = useMemo(
    () =>
      existing && {
        value: existing.equipment_id,
        label: existing.equipment_code ?? '',
      },
    [existing],
  )

  return (
    <div className="space-y-4">
      <PageHeader title={t('siteUnits')} description={t('siteUnitsDesc')} />
      <DataListToolbar
        config={siteUnitsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={siteUnitsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState description={t('siteUnitsLoadError')} onRetry={fetchRows} />
      ) : loading && rows.length === 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-56 w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('siteUnitsEmptyFiltered') : t('siteUnitsEmpty')}
        />
      ) : (
        <>
          <p className="text-xs text-muted">
            {total} {t('siteUnitsCount')}
          </p>
          {/* Owner 2026-10-25: the «تذكرة» design approved on /ui-kit — the
              unit on top, a dashed perforation, and a stub in the state's
              tone holding the state and the SPO or the «+». At most three
              columns, a 16 px gap and no side padding, so the tickets line
              up with the toolbar (owner 2026-10-25). */}
          <ul
            className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${
              loading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {rows.map((row) => (
              <li
                key={row.entry_id}
                className="flex flex-col rounded-xl border bg-bg text-[13px]"
              >
                <div className="space-y-2 p-3">
                  <div>
                    {/* RTL paragraphs, so the LTR numbers sit at the start. */}
                    {/* Owner 2026-10-25: at the end of the code's row, a
                        button to the unit's entry movement — round like the
                        «+», filled with the surface-hover grey. */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-bold leading-6">
                        <bdi dir="ltr">{row.equipment_code ?? '—'}</bdi>
                      </p>
                      {/* Owner 2026-10-25 (a trial): a round arrow that widens
                          on hover or keyboard focus to show «انتقل للحركة»;
                          the motion only runs when the device allows it. */}
                      {onSelectMovement && (
                        <button
                          type="button"
                          onClick={() => onSelectMovement(row.entry_id)}
                          className="group/move inline-flex h-7 shrink-0 items-center rounded-full bg-surface-hover px-1.5 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 group-hover/move:max-w-32 group-hover/move:px-1 group-hover/move:opacity-100 group-focus-visible/move:max-w-32 group-focus-visible/move:px-1 group-focus-visible/move:opacity-100 motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out">
                            {t('siteUnitsOpenMovement')}
                          </span>
                          <ArrowUpRight
                            size={16}
                            aria-hidden="true"
                            className="shrink-0 rtl:-scale-x-100"
                          />
                        </button>
                      )}
                    </div>
                    {(row.equipment_plate_number ||
                      row.equipment_chassis_number) && (
                      <p className="text-xs leading-5 text-muted">
                        <bdi dir="ltr">
                          {row.equipment_plate_number ||
                            row.equipment_chassis_number}
                        </bdi>
                      </p>
                    )}
                    {/* The company's number, with no label. */}
                    {/* A dash without a company number keeps every ticket's
                        lines level (owner 2026-10-25). */}
                    <p className="text-xs font-medium leading-5">
                      {row.contractor_equipment_code ? (
                        <bdi dir="ltr">{row.contractor_equipment_code}</bdi>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </p>
                  </div>
                  {/* leading-5: text-xs's 16 px line cut Arabic marks; long
                      text wraps instead of being cut. */}
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-xs leading-5">
                      {row.equipment_type ?? '—'}
                    </p>
                    <p className="break-words text-xs leading-5 text-muted">
                      {ownerLine(row)}
                    </p>
                    <p className="break-words text-xs leading-5 text-muted">
                      {localizedName(
                        lang,
                        row.company_name_ar,
                        row.company_name_en,
                      )}{' '}
                      ·{' '}
                      {localizedName(
                        lang,
                        row.project_name_ar,
                        row.project_name_en,
                      )}
                    </p>
                    <p className="break-words text-xs leading-5 text-muted">
                      {t('logsColForeman')}{' '}
                      <span className="font-medium text-fg">
                        {row.entry_supervisor_name ?? '—'}
                      </span>
                    </p>
                  </div>
                </div>
                {/* The perforation (no side notches). */}
                <div className="mx-3 mt-auto border-t border-dashed" />
                <div
                  className="flex items-center justify-between gap-2 rounded-b-xl px-3 py-2.5"
                  style={{ backgroundColor: `var(--${toneOf(row)}-soft)` }}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: `var(--${toneOf(row)})` }}
                  >
                    {/* Owner 2026-10-25: «رقم PO» beside the SPO pill. */}
                    {row.has_po ? t('siteUnitsPoNumber') : t('siteUnitsNoPo')}
                  </span>
                  {row.supplier_po_id ? (
                    <button
                      type="button"
                      onClick={() => onSelectPo(row.supplier_po_id!)}
                      className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold underline-offset-2 hover:underline"
                      style={SPO_BUTTON_STYLE}
                    >
                      <bdi dir="ltr">{row.po_number}</bdi>
                    </button>
                  ) : (
                    canManage && (
                      <IconButton
                        size="sm"
                        variant="outline"
                        className="shrink-0 !rounded-full transition-opacity hover:opacity-85"
                        label={t('siteUnitsAddToPo')}
                        style={ADD_BUTTON_STYLE}
                        icon={
                          <Plus
                            size={15}
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                        }
                        onClick={() => openAdd(row)}
                      />
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
      {existingPo && (
        <AddEquipmentDialog
          open
          onOpenChange={closeAdd}
          po={existingPo}
          initialUnit={existingUnit}
          onAdded={() => {
            setTarget(null)
            fetchRows()
          }}
        />
      )}
      <CreateSupplierPoDialog
        open={target?.kind === 'new'}
        onOpenChange={closeAdd}
        preset={target?.kind === 'new' ? target.preset : null}
        onCreated={() => {
          setTarget(null)
          fetchRows()
        }}
      />
    </div>
  )
}
