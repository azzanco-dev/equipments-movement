import { useCallback, useMemo } from 'react'
import { MiniTable, MiniTableGrid } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchForemanActivity } from '@/lib/adminHomeData'
import {
  adminHomePeriodKeys,
  type AdminHomePeriod,
  type ForemanActivityRow,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface ForemanActivitySectionProps {
  period: AdminHomePeriod
}

/**
 * "نشاط الفورمين": the secondary activity section, deliberately small.
 *
 * Entries and exits are period-scoped; open visits is a "right now" number
 * (the foreman still has that many site visits without an exit), which the
 * column label says, so the two are never read as the same kind of figure.
 */
export function ForemanActivitySection({
  period,
}: ForemanActivitySectionProps) {
  const { t } = useI18n()
  const range = useMemo(() => adminHomePeriodKeys(period), [period])

  const load = useCallback(
    (signal: AbortSignal) => fetchForemanActivity(range.from, range.to, signal),
    [range.from, range.to],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const columns: DataTableColumn<ForemanActivityRow>[] = [
    {
      key: 'name',
      header: t('adminHomeColForeman'),
      cell: (row) => (
        <span className="font-medium">{row.name || t('adminHomeUnknown')}</span>
      ),
    },
    {
      key: 'entries',
      header: t('adminHomeColEntries'),
      align: 'end',
      width: '4.5rem',
      cell: (row) => <span className="tabular-nums">{row.entries}</span>,
    },
    {
      key: 'exits',
      header: t('adminHomeColExits'),
      align: 'end',
      width: '4.5rem',
      cell: (row) => <span className="tabular-nums">{row.exits}</span>,
    },
    {
      key: 'open',
      header: t('adminHomeColOpenVisits'),
      align: 'end',
      width: '5rem',
      cell: (row) => (
        <span className="font-semibold tabular-nums">{row.openVisits}</span>
      ),
    },
  ]

  return (
    <AdminHomeSection
      title={t('adminHomeForemenTitle')}
      description={t('adminHomeForemenDescription')}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-48 w-full"
    >
      <MiniTableGrid>
        <MiniTable
          title={t('adminHomeForemenTitle')}
          description={t('adminHomeForemenTableHint')}
          columns={columns}
          rows={data ?? []}
          rowKey={(row) => row.supervisorId}
          maxRows={8}
          empty={t('adminHomeNoActivity')}
        />
      </MiniTableGrid>
    </AdminHomeSection>
  )
}
