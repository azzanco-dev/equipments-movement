import { useCallback } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import { Badge, DataTable, type DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchLatestMovements,
  type LatestMovementRow,
} from '@/lib/adminHomeData'
import { movementHref, movementLogHref } from '@/lib/adminHomeLinks'
import { movementTimeLabel } from '@/lib/adminHomeV2'
import { displayDriverName } from '@/lib/driverDisplayName'
import { formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import { useAdminHomeSection } from './useAdminHomeSection'

/**
 * «اخر الحركات» (owner 2026-11-09, the v2 mockup): the latest seven
 * movements of `movement_log_search` (RLS decides the rows), newest first by
 * `(recorded_at, id)`: the type with its time (the Saudi clock today, the
 * day before), the unit and its type, the project with the driver (or
 * «الورشة»). Each row opens its movement; «عرض الكل» the movement log.
 */
export function LatestMovementsCard({
  canOpenLogs,
  onSelectMovement,
}: {
  canOpenLogs: boolean
  onSelectMovement?: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const load = useCallback(
    (signal: AbortSignal) => fetchLatestMovements(signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const columns: DataTableColumn<LatestMovementRow>[] = [
    {
      key: 'type',
      header: t('homeV2ColMovement'),
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <Badge
            size="sm"
            tone={row.type}
            icon={
              row.type === 'entry' ? (
                <LogIn size={11} aria-hidden="true" />
              ) : (
                <LogOut size={11} aria-hidden="true" />
              )
            }
          >
            {t(row.type)}
          </Badge>
          <time
            dateTime={row.recordedAt}
            title={formatDateTime(row.recordedAt, false)}
            className="text-[11px] leading-4 tabular-nums text-muted"
            dir="ltr"
          >
            {movementTimeLabel(row.recordedAt)}
          </time>
        </span>
      ),
    },
    {
      key: 'unit',
      header: t('homeV2ColUnit'),
      cell: (row) => (
        <span className="block">
          <bdi dir="ltr" className="font-semibold">
            {row.code}
          </bdi>
          {row.equipmentType && (
            <span className="block text-[11px] leading-4 text-muted">
              {row.equipmentType}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'place',
      header: t('homeV2ColProject'),
      cell: (row) => {
        if (row.context === 'workshop')
          return (
            <Badge size="sm" tone="neutral">
              {t('homeV2Workshop')}
            </Badge>
          )
        const driver = displayDriverName({
          driver_full_name: row.driverFullName,
          driver_name: row.driverName,
        })
        return (
          <span className="block">
            <span className="block">
              {localizedName(lang, row.projectNameAr, row.projectNameEn) || '—'}
            </span>
            <span className="block text-[11px] leading-4 text-muted">
              {driver || '—'}
            </span>
          </span>
        )
      },
    },
  ]

  return (
    <HomeBlock
      title="homeV2LatestMovements"
      action={<ViewAllAction href={canOpenLogs ? movementLogHref() : null} />}
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<ListRowsSkeleton rows={7} />}
    >
      <DataTable
        size="md"
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        caption={t('homeV2LatestMovements')}
        stickyHeader={false}
        cellTextClassName="text-sm"
        cellClassName="py-1.5"
        empty={t('homeV2NoMovements')}
        onRowClick={
          onSelectMovement ? (row) => onSelectMovement(row.id) : undefined
        }
        rowHref={(row) => movementHref(row.id)}
      />
    </HomeBlock>
  )
}
