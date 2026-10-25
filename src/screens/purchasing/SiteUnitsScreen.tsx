import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { Plus } from 'lucide-react'
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
}

/** Stable across renders, so the bar's controls do not reload on each one. */
const ASYNC_FILTERS = {
  [SUPPLIER_FILTER_KEY]: lessorFilterOptions(supabase),
  entry_supervisor_id: foremanFilterOptions(supabase),
}

/** Soft amber without a PO, soft green with one, with a light border in a
 *  shade of the same tone (owner 2026-10-25); no badge — the end of the tile
 *  (the SPO or the add button) already says it. */
function tileColors(row: SiteUnitRow): CSSProperties {
  const tone = row.has_po ? 'success' : 'warning'
  return {
    backgroundColor: `var(--${tone}-soft)`,
    borderColor: `color-mix(in srgb, var(--${tone}) 25%, transparent)`,
  }
}

/** The «+» on a tile without a PO: the amber of the tile, on the page
 *  background so it stands out (owner 2026-10-25). Tokens only. */
const ADD_BUTTON_STYLE: CSSProperties = {
  color: 'var(--warning)',
  borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
  backgroundColor: 'var(--bg)',
}

/** The SPO on a tile with a PO: the green of the tile, on the page
 *  background, at the end of the code's row like the «+» (owner
 *  2026-10-25). Tokens only. */
const SPO_BUTTON_STYLE: CSSProperties = {
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 45%, transparent)',
  backgroundColor: 'var(--bg)',
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
export function SiteUnitsScreen({ onSelectPo }: SiteUnitsScreenProps) {
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
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-44 w-full rounded-xl" />
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
          <ul
            className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${
              loading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {/* At most three columns (owner 2026-10-24). */}
            {rows.map((row) => (
              <li
                key={row.entry_id}
                className="flex flex-col gap-3 rounded-xl border p-3 text-[13px]"
                style={tileColors(row)}
              >
                <div>
                  {/* Owner 2026-10-25: the code in bold; at the end of its
                      row the SPO (green) or the add, an icon-only «+»
                      (amber), or «بلا PO» for a reader. */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 leading-6">
                      <bdi dir="ltr" className="text-base font-bold">
                        {row.equipment_code ?? '—'}
                      </bdi>
                      {(row.equipment_plate_number ||
                        row.equipment_chassis_number) && (
                        <bdi dir="ltr" className="text-xs text-muted">
                          {row.equipment_plate_number ||
                            row.equipment_chassis_number}
                        </bdi>
                      )}
                    </div>
                    {row.supplier_po_id ? (
                      <button
                        type="button"
                        onClick={() => onSelectPo(row.supplier_po_id!)}
                        className="inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-xs font-semibold underline-offset-2 hover:underline"
                        style={SPO_BUTTON_STYLE}
                      >
                        <bdi dir="ltr">{row.po_number}</bdi>
                      </button>
                    ) : canManage ? (
                      <IconButton
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        label={t('siteUnitsAddToPo')}
                        // Owner 2026-10-25: the add carries the tile's amber (it shows only
                        // on units without a PO).
                        style={ADD_BUTTON_STYLE}
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => openAdd(row)}
                      />
                    ) : (
                      <span className="shrink-0 text-xs leading-6 text-muted">
                        {t('siteUnitsNoPo')}
                      </span>
                    )}
                  </div>
                  {/* The company's number, when set, under the code with
                      no label (owner 2026-10-24). */}
                  {row.contractor_equipment_code && (
                    <p className="text-xs font-medium leading-5">
                      <bdi dir="ltr">{row.contractor_equipment_code}</bdi>
                    </p>
                  )}
                </div>
                {/* leading-5: text-xs's 16 px line cut Arabic marks; long
                    text wraps instead of being cut (owner 2026-10-24). */}
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
