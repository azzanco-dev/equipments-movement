import { useCallback, useState } from 'react'
import { Badge, DataTable, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { fetchNoMovementEquipment } from '@/lib/adminHomeData'
import type { AdminHomeOwner, NoMovementRow } from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useOwnerLabel } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Thresholds the owner asked for; they match the database breakdown. */
const THRESHOLDS = [30, 60, 90] as const
type Threshold = (typeof THRESHOLDS)[number]

/** The section is a decision list, not a report, so it stays short. */
const ROW_LIMIT = 20

export interface NoMovementSectionProps {
  /** An empty array means every owner. */
  owners: AdminHomeOwner[]
  onSelectEquipment?: (id: string) => void
}

/**
 * "معدات بلا حركة": the key section of the admin home.
 *
 * Equipment that has not moved for at least the selected number of Saudi days,
 * longest idle first, with equipment that has never moved at all pulled to the
 * top and marked in danger tones — that is the case worth a decision, and it
 * would be invisible if it were sorted by a date it does not have.
 *
 * Sorting and the limit are the database's (migration 0094), so this never
 * pulls the equipment table into the browser to sort it.
 */
export function NoMovementSection({
  owners,
  onSelectEquipment,
}: NoMovementSectionProps) {
  const { t } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [days, setDays] = useState<Threshold>(30)

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchNoMovementEquipment(owners, days, ROW_LIMIT, signal),
    [days, owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const columns: DataTableColumn<NoMovementRow>[] = [
    {
      key: 'code',
      header: t('adminHomeColEquipment'),
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'type',
      header: t('adminHomeColType'),
      hideBelow: 'sm',
      cell: (row) => row.type,
    },
    {
      key: 'owner',
      header: t('adminHomeColOwner'),
      hideBelow: 'md',
      cell: (row) => ownerLabel(row.owner),
    },
    {
      key: 'last',
      header: t('adminHomeColLastMovement'),
      cell: (row) =>
        row.lastMovementAt ? (
          <span className="text-muted">
            {row.lastMovementType === 'exit'
              ? t('adminHomeExitedOn')
              : t('adminHomeEnteredOn')}{' '}
            {formatDate(row.lastMovementAt)}
          </span>
        ) : (
          <Badge tone="danger">{t('adminHomeNoMovementEver')}</Badge>
        ),
    },
    {
      key: 'days',
      header: t('adminHomeColDays'),
      align: 'end',
      width: '7rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {row.daysSince === null
            ? '—'
            : `${row.daysSince} ${t('adminHomeDayUnit')}`}
        </span>
      ),
    },
  ]

  return (
    <AdminHomeSection
      highlight
      title={t('adminHomeNoMovementTitle')}
      description={t('adminHomeNoMovementDescription')}
      action={
        <Tabs
          value={String(days)}
          onValueChange={(value) => setDays(Number(value) as Threshold)}
        >
          <TabsList
            variant="segmented"
            aria-label={t('adminHomeNoMovementThreshold')}
          >
            {THRESHOLDS.map((threshold) => (
              <TabsTrigger key={threshold} value={String(threshold)}>
                <span className="tabular-nums">
                  {threshold}+ {t('adminHomeDayUnit')}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <DataTable
        size="lg"
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loadingRows={6}
        empty={t('adminHomeNoMovementEmpty')}
        caption={t('adminHomeNoMovementTitle')}
        onRowClick={
          onSelectEquipment ? (row) => onSelectEquipment(row.id) : undefined
        }
        rowClassName={(row) =>
          row.lastMovementAt ? undefined : 'bg-danger-soft'
        }
      />
      <p className="text-xs text-muted">{t('adminHomeNoMovementLimit')}</p>
    </AdminHomeSection>
  )
}
