import { useCallback, useState } from 'react'
import {
  AppLink,
  Badge,
  Button,
  DataTable,
  ErrorState,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
  type DataTableColumn,
} from '@/components/ui'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchFleetEquipment,
  fetchSupplierSiteCounts,
} from '@/lib/adminHomeData'
import { insideProjectsLogHref, movementHref } from '@/lib/adminHomeLinks'
import type { FleetEquipmentRow } from '@/lib/adminHomeStats'
import { sharePercent } from '@/lib/adminHomeV2'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { CountUp } from './CountUp'
import { BarRow, HomeBlock, ViewAllAction } from './HomeBlock'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Rows the block shows before «عرض الكل». */
const ROWS = 6

type Tab = 'workshop' | 'suppliers'

/**
 * «في الورشة الان» / «الموردون في المشاريع» (owner 2026-11-09, the v2
 * mockup): one block with two tabs. The workshop tab is the latest six units
 * in the workshop (`get_admin_fleet_equipment`, the fleet tables' owners:
 * the home's three plus Takween), each opening its open workshop entry
 * (owner 2026-10-29) and «عرض الكل» opening the full fleet tables in place
 * (inside projects, the workshop and available, with their sort, paging and
 * export). The suppliers tab is `get_admin_supplier_site_counts` (0161): the
 * «مالك اخر» units inside projects per supplier, each a link to the log's
 * open visits of that supplier, «عرض الكل» opening every supplier.
 */
export function WorkshopSuppliersCard({
  canOpenLogs,
  onSelectEquipment,
  onSelectMovement,
  onShowFleetTables,
}: {
  canOpenLogs: boolean
  onSelectEquipment?: (id: string) => void
  onSelectMovement?: (id: string) => void
  onShowFleetTables: () => void
}) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('workshop')
  const [allSuppliers, setAllSuppliers] = useState(false)

  const loadWorkshop = useCallback(
    (signal: AbortSignal) =>
      fetchFleetEquipment(
        {
          state: 'workshop',
          purpose: 'all',
          owners: [],
          page: 1,
          pageSize: ROWS,
          sort: null,
        },
        signal,
      ),
    [],
  )
  const workshop = useAdminHomeSection(loadWorkshop)
  const loadSuppliers = useCallback(
    (signal: AbortSignal) => fetchSupplierSiteCounts(signal),
    [],
  )
  const suppliers = useAdminHomeSection(loadSuppliers)
  const current = tab === 'workshop' ? workshop : suppliers

  const columns: DataTableColumn<FleetEquipmentRow>[] = [
    {
      key: 'code',
      header: t('homeV2ColUnit'),
      cell: (row) => (
        <span className="block">
          <span className="inline-flex flex-wrap items-center gap-1">
            <bdi dir="ltr" className="font-semibold">
              {row.code}
            </bdi>
            <EquipmentNewBadge isNew={row.isNew} />
          </span>
          <span className="block text-[11px] leading-4 text-muted" dir="ltr">
            {row.type}
          </span>
        </span>
      ),
    },
    {
      key: 'purpose',
      header: t('adminHomeColPurpose'),
      cell: (row) =>
        row.workshopPurpose ? (
          <WorkshopPurposeBadge purpose={row.workshopPurpose} />
        ) : (
          <Badge size="sm" tone="neutral">
            {t('equipmentStateUnclassified')}
          </Badge>
        ),
    },
    {
      key: 'since',
      header: t('adminHomeColSince'),
      align: 'end',
      cell: (row) =>
        row.since ? (
          <time
            dateTime={row.since}
            title={formatDateTime(row.since, false)}
            className="text-muted"
          >
            {elapsedInWords(row.since, lang) ?? '—'}
          </time>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]

  const openWorkshopRow =
    onSelectMovement || onSelectEquipment
      ? (row: FleetEquipmentRow) => {
          if (onSelectMovement && row.lastMovementId)
            onSelectMovement(row.lastMovementId)
          else onSelectEquipment?.(row.id)
        }
      : undefined

  const supplierRows = suppliers.data?.suppliers ?? []
  const supplierTotal = suppliers.data?.total ?? 0
  const supplierMax = Math.max(1, ...supplierRows.map((row) => row.count))
  const shownSuppliers = allSuppliers
    ? supplierRows
    : supplierRows.slice(0, ROWS)

  return (
    <HomeBlock
      title={
        tab === 'workshop' ? 'homeV2WorkshopNow' : 'homeV2SuppliersOnProjects'
      }
      action={
        tab === 'workshop' ? (
          <ViewAllAction onClick={onShowFleetTables} />
        ) : supplierRows.length > ROWS ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAllSuppliers((value) => !value)}
          >
            {allSuppliers
              ? t('adminHomeSupplierSitesLess')
              : t('adminHomeSupplierSitesAll').replace(
                  '{count}',
                  String(supplierRows.length),
                )}
          </Button>
        ) : undefined
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList
          variant="segmented"
          aria-label={t('homeV2TabsLabel')}
          className="mb-2"
        >
          <TabsTrigger value="workshop" className="!h-7 !px-2.5 text-xs">
            {t('homeV2TabWorkshop')}
            {workshop.data && (
              <span className="ms-1 tabular-nums text-muted">
                {workshop.data.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="!h-7 !px-2.5 text-xs">
            {t('homeV2TabSuppliers')}
            {suppliers.data && (
              <span className="ms-1 tabular-nums text-muted">
                {suppliers.data.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {current.failed ? (
        <HomeBlockFailure onRetry={current.retry} />
      ) : tab === 'workshop' ? (
        <DataTable
          size="md"
          columns={columns}
          rows={workshop.data?.rows ?? []}
          rowKey={(row) => row.id}
          loading={workshop.loading && !workshop.data}
          loadingRows={ROWS}
          caption={t('homeV2WorkshopNow')}
          stickyHeader={false}
          cellTextClassName="text-sm"
          cellClassName="py-2"
          empty={t('adminHomeFleetWorkshopEmpty')}
          onRowClick={openWorkshopRow}
          rowHref={(row) =>
            row.lastMovementId
              ? movementHref(row.lastMovementId)
              : `/equipment/${row.id}`
          }
        />
      ) : !suppliers.data ? (
        <SkeletonRows />
      ) : supplierRows.length === 0 ? (
        <p className="text-sm text-muted">{t('adminHomeSupplierSitesEmpty')}</p>
      ) : (
        <ul
          className={`space-y-1 ${allSuppliers ? 'max-h-80 overflow-y-auto' : ''}`}
        >
          {shownSuppliers.map((row) => {
            const bar = (
              <BarRow
                label={row.name ?? t('adminHomeSupplierSitesNone')}
                muted={!row.name}
                value={<CountUp value={row.count} />}
                share={sharePercent(row.count, supplierTotal)}
                width={(row.count / supplierMax) * 100}
                shade={4}
              />
            )
            return (
              <li key={row.id ?? 'none'}>
                {canOpenLogs ? (
                  <AppLink
                    href={insideProjectsLogHref('external_supplier', row.id)}
                    className="block rounded py-1 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {bar}
                  </AppLink>
                ) : (
                  <span className="block py-1">{bar}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </HomeBlock>
  )
}

function HomeBlockFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <ErrorState
      title={t('adminHomeSectionError')}
      description={t('adminHomeSectionErrorHint')}
      onRetry={onRetry}
    />
  )
}

function SkeletonRows() {
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }, (_, index) => (
        <span
          key={index}
          className="block h-5 w-full animate-pulse rounded bg-surface-hover"
        />
      ))}
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
