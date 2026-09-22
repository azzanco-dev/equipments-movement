import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MiniTable, MiniTableGrid, MovementBadge } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { fetchForemanRecentMovements } from '@/lib/adminHomeData'
import type { ForemanMovement } from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Movements shown per foreman. The database clamps this to 20. */
const MOVEMENTS_PER_FOREMAN = 7

/**
 * The movement log filtered to one foreman.
 *
 * `/logs` keeps its whole state in the URL and its filters in one serialized
 * `filters` parameter (`useDataListState`), so the link is built in exactly
 * that shape rather than inventing a second parameter the log would ignore.
 * The field and the operator are the ones `logsListConfig` allowlists for the
 * foreman filter, so the log re-validates this link and drops it if it ever
 * stops matching. `context=all` is included because a foreman records both
 * site and workshop movements and the log opens on site movements only.
 */
export function foremanLogsHref(supervisorId: string): string {
  const filters = [
    {
      id: `foreman-${supervisorId}`,
      field: 'supervisor_id',
      operator: 'eq',
      value: supervisorId,
    },
  ]
  const params = new URLSearchParams({
    context: 'all',
    filters: JSON.stringify(filters),
  })
  return `/logs?${params.toString()}`
}

/**
 * "نشاط الفورمين": one mini table per foreman, three across on desktop and
 * stacked on mobile (owner request, 2026-09-22 — it replaces the single
 * "busiest foremen" table).
 *
 * Each card lists that foreman's last movements newest first, with the total
 * they have ever recorded in the header line so the card says how much of the
 * picture it is showing. Both caps are the database's (20 foremen, at most 20
 * movements each), so the payload is bounded before it reaches the browser.
 */
export function ForemanActivitySection() {
  const { t } = useI18n()
  const router = useRouter()

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchForemanRecentMovements(MOVEMENTS_PER_FOREMAN, signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const columns: DataTableColumn<ForemanMovement>[] = [
    {
      key: 'equipment',
      header: t('adminHomeColEquipment'),
      cell: (row) => (
        <span className="font-semibold">{row.equipmentCode || '—'}</span>
      ),
    },
    {
      key: 'type',
      header: t('movementType'),
      width: '5.5rem',
      cell: (row) =>
        row.type ? <MovementBadge type={row.type} /> : <span>—</span>,
    },
    {
      key: 'date',
      header: t('adminHomeColMovementDate'),
      align: 'end',
      width: '6.5rem',
      cell: (row) => (
        <span className="text-muted">
          {row.recordedAt ? formatDate(row.recordedAt) : '—'}
        </span>
      ),
    },
  ]

  const groups = data ?? []

  return (
    <AdminHomeSection
      title={t('adminHomeForemenTitle')}
      description={t('adminHomeForemenRecentDescription')}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-48 w-full"
    >
      {groups.length === 0 ? (
        <p className="rounded-lg border px-3 py-8 text-center text-sm text-muted">
          {t('adminHomeNoForemen')}
        </p>
      ) : (
        <MiniTableGrid>
          {groups.map((group) => (
            <MiniTable
              key={group.supervisorId}
              title={group.name || t('adminHomeUnknown')}
              description={t('adminHomeForemanMovementCount').replace(
                '{count}',
                String(group.totalMovements),
              )}
              columns={columns}
              rows={group.movements}
              rowKey={(row) => row.id}
              maxRows={MOVEMENTS_PER_FOREMAN}
              empty={t('adminHomeNoActivity')}
              onViewAll={() => router.push(foremanLogsHref(group.supervisorId))}
            />
          ))}
        </MiniTableGrid>
      )}
    </AdminHomeSection>
  )
}
