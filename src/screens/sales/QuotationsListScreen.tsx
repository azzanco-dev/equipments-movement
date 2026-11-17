import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileSpreadsheet,
  Plus,
  ScrollText,
  SlidersHorizontal,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { RelativeTime } from '@/components/RelativeTime'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { QuotationFormDialog } from '@/components/sales/QuotationFormDialog'
import { QuotationValidityBadge } from '@/components/sales/QuotationValidityBadge'
import {
  AppLink,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  PageHeader,
  Tooltip,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDate } from '@/lib/dateFormat'
import { quotationsListConfig } from '@/lib/listConfigs'
import { localizedName } from '@/lib/localizedName'
import {
  quotationDateFilters,
  quotationTypeChips,
  type QuotationRow,
} from '@/lib/quotations'
import { QUOTATION_LIST_SELECT } from '@/lib/quotationsData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/** The dialogs the list opens. */
export type QuotationsListDialogKind = 'create'

/** Settings › «شروط عروض الاسعار», the page «خيارات» opens. */
export const QUOTATION_TERMS_HREF = '/settings/quotation-terms'

export interface QuotationsListScreenProps {
  onSelectQuotation: (id: string) => void
  /** The shell opens the terms template page for this user (its gate is
   *  `sales.quotations.approve`): «خيارات» then lists it. */
  canOpenTerms?: boolean
}

/**
 * «عروض الاسعار» (/sales/quotations, migration 0199, the Figma design the
 * owner approved on 2026-11-16): every quotation over `quotation_list`,
 * server-side searched by number and client, filtered by company and the
 * two dates, sorted (the latest change first) and paged through the unified
 * list system; a row opens the quotation page. A quotation is a plain
 * document (owner 2026-11-17, migration 0200): the list has no stage
 * column, filter or tabs, and every number is the official `QT-…`, shown
 * as plain bold text (not a pill) over the issue date; the types are chips
 * and «صالح لغاية» carries the display-only «ساري» / «منتهي» badge. «عرض سعر جديد» needs `sales.manage` (the database
 * checks it again in `save_quotation`). «خيارات» (owner 2026-11-17, «خلي
 * الوصول للشروط والاحكام من قائمة عروض السعر») is a menu beside it whose
 * item «الشروط والاحكام» is a real link to the terms template page; it is
 * shown only to a user that page opens for.
 */
export function QuotationsListScreen({
  onSelectQuotation,
  canOpenTerms = false,
}: QuotationsListScreenProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const list = useDataListState(quotationsListConfig)
  const [rows, setRows] = useState<QuotationRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // «عرض سعر جديد» opens the form dialog; after the save the app opens the
  // new quotation's page.
  const [dialog, setDialog] = useState<QuotationsListDialogKind | null>(null)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ company_id: companyProjectFilters.company_id }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('quotation_list')
      .select(QUOTATION_LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      quotationsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      quotationDateFilters(list.filters),
      new Set(quotationsListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('quotationListLoadError'))
    setRows((data as unknown as QuotationRow[] | null) ?? [])
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
    t,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const columns: DataTableColumn<QuotationRow>[] = [
    {
      key: 'quote_number',
      header: t('quotationNumber'),
      sortable: true,
      // Plain bold text, not a pill (owner 2026-11-17, «خلي الرقم مش
      // بادج»), with the issue date under it.
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <bdi dir="ltr" className="font-semibold tabular-nums">
            {row.quote_number}
          </bdi>
          <span className="text-xs tabular-nums text-muted">
            {formatDate(row.issue_date)}
          </span>
        </span>
      ),
    },
    {
      key: 'client',
      header: t('quotationClient'),
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="font-semibold">
            {localizedName(lang, row.company_name_ar, row.company_name_en) ||
              '—'}
          </span>
          <span className="text-xs text-muted">
            {row.project_id
              ? localizedName(lang, row.project_name_ar, row.project_name_en)
              : t('quotationNoProject')}
          </span>
        </span>
      ),
    },
    {
      key: 'types',
      header: t('quotationTypes'),
      hideBelow: 'md',
      // The first types as chips, then «+N» naming the rest (owner
      // 2026-11-17, «عمود انواع المعدات شكله مش كويس»: it was a count over
      // one cut line of names).
      cell: (row) => {
        const { shown, rest } = quotationTypeChips(row.type_names)
        if (shown.length === 0) return <span className="text-muted">—</span>
        return (
          <span className="flex max-w-80 flex-wrap items-center gap-1">
            {shown.map((name) => (
              <span
                key={name}
                dir="auto"
                className="max-w-full truncate rounded-md bg-surface-hover px-1.5 py-0.5 text-xs leading-4"
              >
                {name}
              </span>
            ))}
            {rest.length > 0 && (
              <Tooltip content={rest.join('، ')}>
                <span className="rounded-md border px-1.5 py-0.5 text-xs leading-4 text-muted">
                  +{rest.length}
                </span>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    {
      key: 'valid_until',
      header: t('quotationValidUntil'),
      sortable: true,
      hideBelow: 'sm',
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="tabular-nums">{formatDate(row.valid_until)}</span>
          <QuotationValidityBadge validUntil={row.valid_until} />
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.updated_at ?? row.created_at} />,
    },
  ]

  const addButton = canManage ? (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => setDialog('create')}
    >
      {t('quotationNew')}
    </Button>
  ) : undefined

  const optionsMenu = canOpenTerms ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          icon={<SlidersHorizontal size={16} aria-hidden="true" />}
          aria-label={t('quotationListOptions')}
        >
          {t('options')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <AppLink href={QUOTATION_TERMS_HREF}>
            <ScrollText size={15} aria-hidden="true" className="shrink-0" />
            {t('quotationTermsTitle')}
          </AppLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('quotations')}
        description={t('quotationsDesc')}
        actions={
          (optionsMenu || addButton) && (
            <div className="flex items-center gap-2">
              {optionsMenu}
              {addButton}
            </div>
          )
        }
      />
      <DataListToolbar
        config={quotationsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={quotationsListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState description={loadError} onRetry={fetchRows} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet size={28} aria-hidden="true" />}
          title={filtered ? t('quotationEmptyFiltered') : t('quotationEmpty')}
          action={filtered ? undefined : addButton}
        />
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          caption={t('quotations')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectQuotation(row.id)}
          rowHref={(row) => `/sales/quotations/${row.id}`}
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
        />
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
      {canManage && (
        <QuotationFormDialog
          open={dialog === 'create'}
          onOpenChange={(open) => setDialog(open ? 'create' : null)}
          onSaved={(id) => {
            setDialog(null)
            onSelectQuotation(id)
          }}
        />
      )}
    </div>
  )
}
