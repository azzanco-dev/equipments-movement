import { useCallback, useMemo, useState } from 'react'
import { Badge, DataTable, SearchInput } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchAvailabilityByType } from '@/lib/adminHomeData'
import type {
  AdminHomeOwner,
  AvailabilityRow,
  FleetStateCounts,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

/** One metric, with the owned / rented split underneath it. */
function SplitCell({
  all,
  owned,
  rented,
}: {
  all: number
  owned: number
  rented: number
}) {
  const { t } = useI18n()
  return (
    <span className="block py-1 leading-tight">
      <span className="block text-[13px] font-semibold tabular-nums text-fg">
        {all}
      </span>
      <span className="block text-[11px] tabular-nums text-muted">
        {t('owned')} {owned} · {t('rented')} {rented}
      </span>
    </span>
  )
}

export interface AvailabilitySectionProps {
  owner: AdminHomeOwner | null
}

/**
 * "التوفر حسب النوع": per equipment type, how many units are inside sites, in
 * the workshop and available, each split into owned and rented.
 *
 * The split is derived in one place: the database returns the owned half and
 * the total, and `parseAvailabilityRows` subtracts, so the two halves can
 * never disagree with the total shown above them.
 *
 * The type list is an admin-managed master list capped at 100 rows by the
 * database, so filtering it by name in the browser is filtering an already
 * bounded result, not a table scan.
 */
export function AvailabilitySection({ owner }: AvailabilitySectionProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')

  const load = useCallback(
    (signal: AbortSignal) => fetchAvailabilityByType(owner, signal),
    [owner],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = data ?? []
    if (!needle) return all
    return all.filter((row) => row.type.toLowerCase().includes(needle))
  }, [data, query])

  const metric = (
    key: string,
    header: string,
    field: keyof FleetStateCounts,
    hideBelow?: 'sm' | 'md' | 'lg',
  ): DataTableColumn<AvailabilityRow> => ({
    key,
    header,
    align: 'end',
    hideBelow,
    cell: (row) => (
      <SplitCell
        all={row.all[field]}
        owned={row.owned[field]}
        rented={row.rented[field]}
      />
    ),
  })

  const columns: DataTableColumn<AvailabilityRow>[] = [
    {
      key: 'type',
      header: t('adminHomeColType'),
      cell: (row) => <span className="font-medium">{row.type}</span>,
    },
    metric('total', t('adminHomeColTotal'), 'total'),
    metric('inside', t('adminHomeColInside'), 'insideSites'),
    metric('workshop', t('adminHomeColWorkshop'), 'inWorkshop', 'sm'),
    metric('available', t('adminHomeColAvailable'), 'available'),
  ]

  return (
    <AdminHomeSection
      title={t('adminHomeAvailabilityTitle')}
      description={t('adminHomeAvailabilityDescription')}
      action={<Badge tone="info">{t('adminHomeNow')}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('adminHomeSearchType')}
        aria-label={t('adminHomeSearchType')}
        className="max-w-xs"
      />
      <DataTable
        size="lg"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.type}
        loadingRows={6}
        empty={t('adminHomeNoTypeMatch')}
        caption={t('adminHomeAvailabilityTitle')}
      />
    </AdminHomeSection>
  )
}
