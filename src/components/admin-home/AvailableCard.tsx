import { useCallback, useState } from 'react'
import { DataTable, type DataTableColumn } from '@/components/ui'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { useI18n } from '@/i18n/I18nContext'
import { fetchFleetEquipment } from '@/lib/adminHomeData'
import { availableEquipmentHref } from '@/lib/adminHomeLinks'
import {
  FLEET_FILTER_OWNERS,
  type AdminHomeOwner,
  type FleetEquipmentRow,
} from '@/lib/adminHomeStats'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import { OwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Rows the block shows before «عرض الكل». */
const ROWS = 6

/**
 * «المتاحة الان» (owner 2026-11-10, «وبداله خليه جدول المتاحة»: it took the
 * place of the projects chart in the first row): the latest six available
 * units — outside every project and the workshop — of the owners of its own
 * filter (the fleet tables' four owners, Al-Azani by default, empty = the
 * four), from `get_admin_fleet_equipment` with state `available`, each with
 * how long it has been available (its last exit); a row opens the unit.
 * «عرض الكل» opens the equipment list filtered to the available units of
 * those owners.
 */
export function AvailableCard({
  canOpenEquipment,
  onSelectEquipment,
}: {
  canOpenEquipment: boolean
  onSelectEquipment?: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(['alazani'])
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchFleetEquipment(
        {
          state: 'available',
          owners,
          page: 1,
          pageSize: ROWS,
          sort: null,
        },
        signal,
      ),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

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

  return (
    <HomeBlock
      title="homeV2AvailableNow"
      action={
        <>
          <OwnerFilter
            size="sm"
            className="w-32"
            options={FLEET_FILTER_OWNERS}
            value={owners}
            onChange={setOwners}
          />
          <ViewAllAction
            href={canOpenEquipment ? availableEquipmentHref(owners) : null}
          />
        </>
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<ListRowsSkeleton rows={ROWS} />}
    >
      {data && (
        <div
          aria-busy={loading || undefined}
          className={loading ? 'opacity-60' : undefined}
        >
          <DataTable
            size="md"
            columns={columns}
            rows={data.rows}
            rowKey={(row) => row.id}
            caption={t('homeV2AvailableNow')}
            stickyHeader={false}
            cellTextClassName="text-sm"
            cellClassName="py-1.5"
            empty={t('adminHomeFleetAvailableEmpty')}
            onRowClick={
              onSelectEquipment
                ? (row: FleetEquipmentRow) => onSelectEquipment(row.id)
                : undefined
            }
            rowHref={(row) => `/equipment/${row.id}`}
          />
        </div>
      )}
    </HomeBlock>
  )
}
