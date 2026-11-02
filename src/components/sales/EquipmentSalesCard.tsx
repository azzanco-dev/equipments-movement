import { useCallback, useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { CompanyProjectCell } from '@/components/data-list/CompanyProjectCell'
import { useListRequest } from '@/components/data-list/useListRequest'
import { ClientPoStatusBadge } from '@/components/sales/ClientPoStatusBadge'
import { PoPill } from '@/components/sales/PoPill'
import { QuantityCell } from '@/components/sales/QuantityCell'
import { SalePrice } from '@/components/sales/SalePrice'
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
import { saleRateUnitOf } from '@/lib/sales'
import {
  EQUIPMENT_SALES_LIMIT,
  EQUIPMENT_SALES_SELECT,
  clientPoCompanyProject,
  type EquipmentSalesRow,
} from '@/lib/salesData'
import { supabase } from '@/lib/supabase'

/**
 * The «المبيعات» card of the equipment page (owner approval 2026-11-02,
 * the /ui-kit mockup): the unit's client PO lines through its equipment
 * cards, open card first, read-only — the client PO pill, the company and
 * project, since when, the sale price with its unit and the contract
 * quantity; «بدون PO عميل» when there is none. Renders nothing at all
 * without `sales.view` (and then requests nothing); RLS stays
 * authoritative either way.
 */
export function EquipmentSalesCard({
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
  const allowed = can('sales.view')
  const [rows, setRows] = useState<EquipmentSalesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const startRequest = useListRequest()

  const fetchRows = useCallback(async () => {
    if (!allowed) return
    const signal = startRequest()
    setLoading(true)
    setError(false)
    const { data, error: loadError } = await supabase
      .from('client_po_equipment')
      .select(EQUIPMENT_SALES_SELECT)
      .eq('card.equipment_id', equipmentId)
      .order('created_at', { ascending: false })
      .limit(EQUIPMENT_SALES_LIMIT)
      .abortSignal(signal)
    if (signal.aborted) return
    setError(Boolean(loadError))
    const list = ((data as unknown as EquipmentSalesRow[] | null) ?? [])
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

  const columns: DataTableColumn<EquipmentSalesRow>[] = [
    {
      key: 'po',
      header: t('clientPo'),
      cell: (row) =>
        row.po ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <PoPill
              number={row.po.po_number}
              href={onOpenPo ? `/sales/${row.po.id}` : undefined}
              onNavigate={onOpenPo ? () => onOpenPo(row.po!.id) : undefined}
            />
            <ClientPoStatusBadge status={row.po.status} size="sm" />
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'company_project',
      header: t('supplierPoCompanyProject'),
      cell: (row) =>
        row.po ? (
          <CompanyProjectCell row={clientPoCompanyProject(row.po)} />
        ) : (
          '—'
        ),
    },
    {
      key: 'since',
      header: t('clientPoSince'),
      hideBelow: 'sm',
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
      header: t('salePrice'),
      align: 'end',
      cell: (row) =>
        row.price === null ? (
          <Badge tone="warning" size="sm">
            {t('supplierPoNoPrice')}
          </Badge>
        ) : (
          <SalePrice value={row.price} unit={saleRateUnitOf(row.rate_unit)} />
        ),
    },
    {
      key: 'quantity',
      header: t('clientPoQuantity'),
      hideBelow: 'md',
      cell: (row) => (
        <QuantityCell quantity={row.quantity} unit={row.rate_unit} compact />
      ),
    },
  ]

  return (
    <Card padded={false} className={`flex min-w-0 flex-col ${className ?? ''}`}>
      <div className="p-4 pb-0">
        <SectionHeader
          title={t('sales')}
          description={t('equipmentSalesCardDesc')}
        />
      </div>
      <div className="p-4">
        {error ? (
          <ErrorState
            description={t('equipmentSalesLoadError')}
            onRetry={fetchRows}
            className="p-6"
          />
        ) : !loading && rows.length === 0 ? (
          <EmptyState
            icon={<FileText size={24} aria-hidden="true" />}
            title={t('equipmentSalesNone')}
            description={t('equipmentSalesNoneDesc')}
            className="p-6"
          />
        ) : (
          <DataTable
            size="md"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            loadingRows={2}
            caption={t('sales')}
            stickyHeader={false}
          />
        )}
      </div>
    </Card>
  )
}
