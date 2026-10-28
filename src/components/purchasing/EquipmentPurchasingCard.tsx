import { useCallback, useEffect, useState } from 'react'
import { usePermissions } from '@/auth/PermissionsContext'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { useListRequest } from '@/components/data-list/useListRequest'
import { Price } from '@/components/purchasing/Price'
import {
  SupplierPoApprovalBadge,
  SupplierPoStatusBadge,
} from '@/components/purchasing/SupplierPoStatusBadge'
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  SectionHeader,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { supplierPoRateUnitOf, supplierPoSupplierLabel } from '@/lib/purchasing'
import {
  EQUIPMENT_PURCHASING_LIMIT,
  EQUIPMENT_PURCHASING_SELECT,
  supplierPoCompanyProject,
  type EquipmentPurchasingRow,
} from '@/lib/purchasingData'
import { supabase } from '@/lib/supabase'

/**
 * The «المشتريات» card of the equipment page (owner approval 2026-10-19):
 * the unit's supplier PO lines through its equipment cards, open card first,
 * read-only. Renders nothing at all without `purchasing.view` (and then
 * requests nothing); RLS stays authoritative either way. The shared unit and
 * standard-hours fields of the card are not shown in this wave.
 */
export function EquipmentPurchasingCard({
  equipmentId,
  onOpenPo,
  className,
}: {
  equipmentId: string
  onOpenPo?: (poId: string) => void
  className?: string
}) {
  const { t } = useI18n()
  const { can } = usePermissions()
  const allowed = can('purchasing.view')
  const [rows, setRows] = useState<EquipmentPurchasingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const startRequest = useListRequest()

  const fetchRows = useCallback(async () => {
    if (!allowed) return
    const signal = startRequest()
    setLoading(true)
    setError(false)
    const { data, error: loadError } = await supabase
      .from('supplier_po_equipment')
      .select(EQUIPMENT_PURCHASING_SELECT)
      .eq('card.equipment_id', equipmentId)
      .order('created_at', { ascending: false })
      .limit(EQUIPMENT_PURCHASING_LIMIT)
      .abortSignal(signal)
    if (signal.aborted) return
    setError(Boolean(loadError))
    const list = ((data as unknown as EquipmentPurchasingRow[] | null) ?? [])
      .slice()
      // Open card first, then the latest period first.
      .sort((a, b) => {
        const openA = a.card?.period_to ? 1 : 0
        const openB = b.card?.period_to ? 1 : 0
        if (openA !== openB) return openA - openB
        return (b.card?.period_from ?? '').localeCompare(
          a.card?.period_from ?? '',
        )
      })
    setRows(list)
    setLoading(false)
  }, [allowed, equipmentId, startRequest])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  if (!allowed) return null

  const columns: DataTableColumn<EquipmentPurchasingRow>[] = [
    {
      key: 'po',
      header: t('supplierPoNumber'),
      cell: (row) =>
        row.po ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {onOpenPo ? (
              <button
                type="button"
                className="font-semibold underline-offset-2 hover:underline"
                onClick={() => onOpenPo(row.po!.id)}
              >
                <bdi dir="ltr">{row.po.po_number}</bdi>
              </button>
            ) : (
              <bdi dir="ltr" className="font-semibold">
                {row.po.po_number}
              </bdi>
            )}
            <SupplierPoStatusBadge status={row.po.status} size="sm" />
            {/* 0160: draft or approved, as on the PO list. */}
            <SupplierPoApprovalBadge po={row.po} list size="sm" />
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'supplier',
      header: t('supplierPoSupplier'),
      className: 'font-medium',
      cell: (row) => (row.po ? supplierPoSupplierLabel(row.po, t) : '—'),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      hideBelow: 'sm',
      cell: (row) =>
        row.po ? (
          <CompanyProjectCell row={supplierPoCompanyProject(row.po)} />
        ) : (
          '—'
        ),
    },
    {
      key: 'period',
      header: t('equipmentPurchasingPeriod'),
      hideBelow: 'md',
      className: 'tabular-nums',
      cell: (row) =>
        row.card ? (
          <bdi dir="ltr" className="whitespace-nowrap">
            {formatDate(row.card.period_from)}
            {' – '}
            {row.card.period_to
              ? formatDate(row.card.period_to)
              : t('equipmentPurchasingOpenEnd')}
          </bdi>
        ) : (
          '—'
        ),
    },
    {
      key: 'price',
      header: t('supplierPoPrice'),
      align: 'end',
      cell: (row) =>
        row.price === null ? (
          <Badge tone="warning" size="sm">
            {t('supplierPoNoPrice')}
          </Badge>
        ) : (
          <Price value={row.price} unit={supplierPoRateUnitOf(row.rate_unit)} />
        ),
    },
  ]

  return (
    <Card padded={false} className={`flex min-w-0 flex-col ${className ?? ''}`}>
      <div className="p-4 pb-0">
        <SectionHeader
          title={t('equipmentPurchasingCard')}
          description={t('equipmentPurchasingCardDesc')}
        />
      </div>
      <div className="p-4">
        {error ? (
          <ErrorState
            description={t('equipmentPurchasingLoadError')}
            onRetry={fetchRows}
            className="p-6"
          />
        ) : !loading && rows.length === 0 ? (
          <EmptyState title={t('equipmentPurchasingNone')} className="p-6" />
        ) : (
          <DataTable
            size="md"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            loadingRows={2}
            caption={t('equipmentPurchasingCard')}
            stickyHeader={false}
          />
        )}
      </div>
    </Card>
  )
}
