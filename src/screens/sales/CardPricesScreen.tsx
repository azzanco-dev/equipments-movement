import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Lock, Receipt, RotateCcw, Save } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  CardMarginCell,
  CardPricingStatusBadge,
  CardSupplierPriceCell,
} from '@/components/sales/CardPricingCells'
import {
  ApproveCardPricingDialog,
  ReturnCardPricingDialog,
  type CardPricingTarget,
} from '@/components/sales/CardPricingDialogs'
import { PoPill } from '@/components/sales/PoPill'
import { SalePrice } from '@/components/sales/SalePrice'
import { UnitIdentityCell } from '@/components/sales/UnitIdentityCell'
import {
  AppLink,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  ToastProvider,
  Tooltip,
  useToast,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { applyListFilters } from '@/lib/applyListFilters'
import { withSupplierLineOnly } from '@/lib/cardPricesList'
import { ownershipBadge } from '@/lib/equipmentForm'
import {
  SUPPLIER_FILTER_KEY,
  lessorFilterOptions,
} from '@/lib/equipmentSupplier'
import { cardPricesListConfig } from '@/lib/listConfigs'
import {
  cardMargin,
  cardMarginPct,
  cardPricingApprovalBlocker,
  cardPricingFormMessage,
  cardPricingStatusOf,
  isValidCardPrice,
  parseCardPrice,
  pricesCountLabel,
  type CardPriceBatchItem,
} from '@/lib/sales'
import {
  CARD_PRICES_SELECT,
  setEquipmentCardClientPrices,
  type CardPriceRow,
} from '@/lib/salesData'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

export interface CardPricesScreenProps {
  onOpenCard: (cardId: string) => void
  onOpenSupplierPo?: (poId: string) => void
}

/** The supplier filter's search (the admin log's), under the view column. */
const SUPPLIER_ASYNC_FIELDS = {
  [SUPPLIER_FILTER_KEY]: lessorFilterOptions(supabase),
}

/** An Al-Azani unit never has a supplier: «مملوكة». */
const isOwned = (row: CardPriceRow) =>
  row.equipment_ownership_status === 'alazani'

/**
 * «اسعار المعدات» (/sales/prices, migration 0174, owner decisions
 * 2026-11-04): the ONE listed sales page for now. Every card that sits on a
 * supplier PO line (`sales_equipment_cards` WHERE supplier_line_id IS NOT
 * NULL, always) in the approved batch layout: the unit, «الشركة ·
 * المشروع», the supplier with its PO pill, the supplier price from the PO
 * line, the client's MONTHLY price typed inline, the margin and its
 * percentage live from the typed price, and the pricing state with
 * «اعتماد» / «رجوع للتعديل» for `sales.approve`. Search, filters (the open
 * cards by default), sort and paging are server-side; the sticky bar saves
 * only the changed rows in ONE `set_equipment_card_client_prices` call
 * (`sales.manage`; the database re-checks). An approved card's price is
 * read-only with a lock until it is returned for editing.
 */
export function CardPricesScreen(props: CardPricesScreenProps) {
  return (
    <ToastProvider>
      <PricesScreen {...props} />
    </ToastProvider>
  )
}

function PricesScreen({ onOpenCard, onOpenSupplierPo }: CardPricesScreenProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const canApprove = can('sales.approve')
  const toast = useToast()
  const list = useDataListState(cardPricesListConfig)
  const [rows, setRows] = useState<CardPriceRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<TranslationKey | null>(null)
  const [approving, setApproving] = useState<CardPricingTarget | null>(null)
  const [returning, setReturning] = useState<CardPricingTarget | null>(null)

  const companyProjectFilters = useCompanyProjectFilters()
  const asyncFields = useMemo(
    () => ({ ...companyProjectFilters, ...SUPPLIER_ASYNC_FIELDS }),
    [companyProjectFilters],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    const ascending = list.direction === 'asc'
    let query = withSupplierLineOnly(
      supabase
        .from('sales_equipment_cards')
        .select(CARD_PRICES_SELECT, { count: 'exact' }),
    )
      .order(list.sort, { ascending, nullsFirst: false })
      // Within the sort key the code, then the card id: deterministic paging.
      .order('equipment_code', { ascending: true })
      .order('card_id', { ascending: true })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      cardPricesListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(cardPricesListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setRows([])
      setTotal(0)
    } else {
      setRows((data as unknown as CardPriceRow[] | null) ?? [])
      setTotal(count ?? 0)
      setDrafts({})
    }
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

  // --- The typed prices: a draft per card, the saved price as the start.
  const savedText = (row: CardPriceRow) =>
    row.card_client_price === null ? '' : String(row.card_client_price)
  const draftOf = (row: CardPriceRow): string =>
    drafts[row.card_id] ?? savedText(row)
  const setDraft = (row: CardPriceRow, value: string) => {
    setSaveError(null)
    setDrafts((current) => ({ ...current, [row.card_id]: value }))
  }
  const isChanged = (row: CardPriceRow) => {
    const draft = draftOf(row).trim()
    if (draft === '') return row.card_client_price !== null
    return !isValidCardPrice(draft) || Number(draft) !== row.card_client_price
  }
  const invalid = rows.filter((row) => {
    const draft = draftOf(row).trim()
    return draft !== '' && !isValidCardPrice(draft)
  })
  const changed = rows.filter(
    (row) => row.pricing_status !== 'approved' && isChanged(row),
  )
  /** The live client price of a row: the typed one while valid, else none. */
  const livePrice = (row: CardPriceRow): number | null =>
    row.pricing_status === 'approved'
      ? row.card_client_price
      : parseCardPrice(draftOf(row))

  const save = async () => {
    if (!changed.length || invalid.length) return
    setSaving(true)
    setSaveError(null)
    const items: CardPriceBatchItem[] = changed.map((row) => ({
      card_id: row.card_id,
      price: parseCardPrice(draftOf(row)),
    }))
    const result = await setEquipmentCardClientPrices(items)
    setSaving(false)
    if (result.error) {
      setSaveError(cardPricingFormMessage(result.error))
      return
    }
    toast({
      title: t('cardPricesSaved').replace(
        '{prices}',
        pricesCountLabel(result.data, lang),
      ),
      tone: 'success',
    })
    fetchRows()
  }
  const clear = () => {
    setSaveError(null)
    setDrafts({})
  }

  // The dialog shows the SAVED prices (never a typed draft) and the PO.
  const target = (row: CardPriceRow): CardPricingTarget => ({
    card_id: row.card_id,
    equipment_code: row.equipment_code,
    client_price: row.card_client_price,
    supplier_price: row.supplier_price,
    supplier_rate_unit: row.supplier_rate_unit,
    supplier_po_number: row.supplier_po_number,
  })
  const notify = (
    key: 'cardPricingApprovedToast' | 'cardPricingReturnedToast',
    card: CardPricingTarget,
  ) =>
    void toast({
      title: t(key).replace('{unit}', card.equipment_code ?? '—'),
      tone: 'success',
    })

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0
  const approvedCount = rows.filter(
    (row) => row.pricing_status === 'approved',
  ).length

  const columns: DataTableColumn<CardPriceRow>[] = [
    {
      key: 'equipment_code',
      header: t('supplierPoEquipmentField'),
      sortable: true,
      cell: (row) => (
        <AppLink
          href={`/sales/cards/${row.card_id}`}
          onNavigate={() => onOpenCard(row.card_id)}
          className="block underline-offset-2 hover:underline"
        >
          <UnitIdentityCell
            code={row.equipment_code}
            type={row.equipment_type}
            plate={row.equipment_plate_number}
            chassis={row.equipment_chassis_number}
          />
        </AppLink>
      ),
    },
    {
      key: 'company_name_ar',
      header: t('supplierPoCompanyProject'),
      sortable: true,
      hideBelow: 'md',
      cell: (row) => <CompanyProjectCell row={row} />,
    },
    {
      key: 'supplier',
      header: t('supplierPoSupplier'),
      hideBelow: 'lg',
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted">
            {isOwned(row)
              ? t('equipmentCardOwned')
              : row.equipment_ownership_status === 'external_supplier'
                ? (row.equipment_lessor_name ?? '—')
                : row.equipment_ownership_status
                  ? t(ownershipBadge(row.equipment_ownership_status).key)
                  : '—'}
          </span>
          {row.supplier_po_number && (
            <span className="inline-flex items-center gap-1.5">
              <PoPill
                number={row.supplier_po_number}
                href={
                  onOpenSupplierPo && row.supplier_po_id
                    ? `/purchasing/${row.supplier_po_id}`
                    : undefined
                }
                onNavigate={
                  onOpenSupplierPo && row.supplier_po_id
                    ? () => onOpenSupplierPo(row.supplier_po_id!)
                    : undefined
                }
                muted={row.supplier_po_status !== 'open'}
              />
              {row.supplier_po_approval_status === 'approved' && (
                <Badge tone="success" size="sm">
                  {t('supplierPoApprovedShort')}
                </Badge>
              )}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'supplier_price',
      header: t('cardPriceSupplier'),
      sortable: true,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardSupplierPriceCell
          price={row.supplier_price}
          rateUnit={row.supplier_rate_unit}
        />
      ),
    },
    {
      key: 'card_client_price',
      header: t('cardPriceClientMonthly'),
      sortable: true,
      cell: (row) => {
        const approved = row.pricing_status === 'approved'
        if (approved || !canManage)
          return (
            <span className="inline-flex items-center gap-1.5">
              {approved && (
                <Lock
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 text-muted"
                />
              )}
              {row.card_client_price === null ? (
                <Badge tone="warning" size="sm">
                  {t('cardMonthNeedsPrice')}
                </Badge>
              ) : (
                <SalePrice value={row.card_client_price} />
              )}
            </span>
          )
        const draft = draftOf(row)
        return (
          <span className="inline-flex items-center gap-1.5">
            <Input
              type="text"
              inputMode="decimal"
              dir="ltr"
              aria-label={`${t('cardPriceClientMonthly')} ${row.equipment_code ?? ''}`}
              value={draft}
              onChange={(event) => setDraft(row, event.target.value)}
              placeholder="0.00"
              invalid={draft.trim() !== '' && !isValidCardPrice(draft)}
              className={`w-28 tabular-nums ${isChanged(row) ? 'font-semibold' : ''}`}
            />
          </span>
        )
      },
    },
    {
      key: 'card_margin_pct',
      header: t('equipmentCardMargin'),
      sortable: true,
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => {
        const client = livePrice(row)
        const margin = cardMargin(
          client,
          row.supplier_price,
          row.supplier_rate_unit,
        )
        return (
          <CardMarginCell
            margin={margin}
            pct={cardMarginPct(margin, client)}
            clientPrice={client}
            supplierPrice={row.supplier_price}
            supplierRateUnit={row.supplier_rate_unit}
          />
        )
      },
    },
    {
      key: 'pricing_status',
      header: t('status'),
      sortable: true,
      cell: (row) => (
        <CardPricingStatusBadge
          status={cardPricingStatusOf(row.pricing_status)}
          approvedBy={row.pricing_approved_by_name}
          approvedAt={row.pricing_approved_at}
        />
      ),
    },
    ...(canApprove
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('cardMonthActions')}</span>,
            align: 'end' as const,
            cell: (row: CardPriceRow) => {
              if (row.pricing_status === 'approved')
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<RotateCcw size={14} aria-hidden="true" />}
                    onClick={() => setReturning(target(row))}
                  >
                    {t('cardPricingReturn')}
                  </Button>
                )
              const blocker = cardPricingApprovalBlocker({
                ...row,
                unsaved: isChanged(row),
              })
              return (
                <Tooltip
                  content={blocker ? t(blocker) : ''}
                  disabled={!blocker}
                >
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Check size={14} aria-hidden="true" />}
                      disabled={blocker !== null}
                      onClick={() => setApproving(target(row))}
                    >
                      {t('cardPricingApprove')}
                    </Button>
                  </span>
                </Tooltip>
              )
            },
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={t('cardPrices')} description={t('cardPricesDesc')} />
      <DataListToolbar
        config={cardPricesListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={cardPricesListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState
          description={t('cardPricesLoadError')}
          onRetry={fetchRows}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} aria-hidden="true" />}
          title={filtered ? t('cardPricesEmpty') : t('equipmentCardsEmpty')}
        />
      ) : (
        <>
          {!loading && (
            <p className="text-xs text-muted">
              {t('cardPricesCounts')
                .replace('{units}', String(total))
                .replace('{approved}', String(approvedCount))
                .replace('{draft}', String(rows.length - approvedCount))}
            </p>
          )}
          {saveError && (
            <Notice tone="danger" size="compact">
              {t(saveError)}
            </Notice>
          )}
          {invalid.length > 0 && (
            <Notice tone="warning" size="compact">
              {t('cardPriceInvalidRows').replace(
                '{units}',
                invalid.map((row) => row.equipment_code ?? '—').join('، '),
              )}
            </Notice>
          )}
          <DataTable
            size="md"
            cellTextClassName="text-[13px]"
            cellClassName="py-2"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.card_id}
            loading={loading}
            loadingRows={6}
            caption={t('cardPrices')}
            sort={{ key: list.sort, direction: list.direction }}
            onSortChange={list.setSort}
          />
          <p className="text-xs text-muted">{t('cardPricesBatchNote')}</p>
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

      {/* The sticky bottom bar: the save with its count and «تفريغ»;
          sales.manage only (the approved rows never count). */}
      {canManage && !loadError && rows.length > 0 && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-bg px-4 pt-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <Button
            variant="primary"
            className="h-11"
            icon={<Save size={16} aria-hidden="true" />}
            disabled={changed.length === 0 || invalid.length > 0}
            loading={saving}
            onClick={save}
          >
            {changed.length === 0
              ? t('save')
              : t('cardPriceSaveCount').replace(
                  '{prices}',
                  pricesCountLabel(changed.length, lang),
                )}
          </Button>
          <Button
            variant="ghost"
            className="h-11"
            onClick={clear}
            disabled={saving || Object.keys(drafts).length === 0}
          >
            {t('cardMonthClear')}
          </Button>
          {changed.length > 0 && (
            <span className="ms-auto text-xs text-muted">
              {t('cardPricesChangedCount').replace(
                '{count}',
                String(changed.length),
              )}
            </span>
          )}
        </div>
      )}

      {canApprove && (
        <>
          <ApproveCardPricingDialog
            card={approving}
            open={approving !== null}
            onOpenChange={(next) => {
              if (!next) setApproving(null)
            }}
            onApproved={(card) => {
              setApproving(null)
              notify('cardPricingApprovedToast', card)
              fetchRows()
            }}
          />
          <ReturnCardPricingDialog
            card={returning}
            open={returning !== null}
            onOpenChange={(next) => {
              if (!next) setReturning(null)
            }}
            onReturned={(card) => {
              setReturning(null)
              notify('cardPricingReturnedToast', card)
              fetchRows()
            }}
          />
        </>
      )}
    </div>
  )
}
