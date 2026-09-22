import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, DataTable, SearchInput } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchAvailabilityByType } from '@/lib/adminHomeData'
import {
  AVAILABILITY_TOP_TYPES,
  visibleAvailabilityRows,
  type AdminHomeOwner,
  type AvailabilityRow,
  type FleetStateCounts,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface AvailabilitySectionProps {
  owners: AdminHomeOwner[]
}

/**
 * "التوفر حسب النوع": per equipment type, how many units are inside sites, in
 * the workshop, available, and the total.
 *
 * Owner review (2026-09-22): the owned / rented sub-lines are gone — the
 * multi-select owner filter at the top of the page answers that question
 * directly — and the totals column moved to the end, so the columns read in
 * the order the operations team thinks in: where the units are first, how many
 * there are last.
 *
 * Only the top ten types are listed. The database already returns them ordered
 * by total (capped at 100), so "top ten" is a slice of an already bounded
 * result: "عرض الكل" reveals the rest without a request, and the search box
 * always looks at every returned type, so a type outside the top ten is still
 * findable by name.
 */
export function AvailabilitySection({ owners }: AvailabilitySectionProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(
    (signal: AbortSignal) => fetchAvailabilityByType(owners, signal),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const all = useMemo(() => data ?? [], [data])
  const rows = useMemo(
    () => visibleAvailabilityRows(all, query, expanded),
    [all, expanded, query],
  )
  // The toggle is meaningless while a search is narrowing the list (the search
  // already looks at every type) or when there is nothing more to reveal.
  const canExpand = query.trim() === '' && all.length > AVAILABILITY_TOP_TYPES

  const metric = (
    key: string,
    header: string,
    field: keyof FleetStateCounts,
    options: { hideBelow?: 'sm' | 'md' | 'lg'; strong?: boolean } = {},
  ): DataTableColumn<AvailabilityRow> => ({
    key,
    header,
    align: 'end',
    width: '6rem',
    hideBelow: options.hideBelow,
    cell: (row) => (
      <span
        className={
          options.strong
            ? 'font-semibold tabular-nums text-fg'
            : 'tabular-nums text-fg'
        }
      >
        {row[field]}
      </span>
    ),
  })

  const columns: DataTableColumn<AvailabilityRow>[] = [
    {
      key: 'type',
      header: t('adminHomeColType'),
      cell: (row) => <span className="font-medium">{row.type}</span>,
    },
    metric('inside', t('adminHomeColInside'), 'insideSites'),
    metric('workshop', t('adminHomeColWorkshop'), 'inWorkshop', {
      hideBelow: 'sm',
    }),
    metric('available', t('adminHomeColAvailable'), 'available'),
    metric('total', t('adminHomeColTotal'), 'total', { strong: true }),
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('adminHomeSearchType')}
          aria-label={t('adminHomeSearchType')}
          className="max-w-xs"
        />
        {canExpand && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('adminHomeShowTopTypes') : t('viewAll')}
          </Button>
        )}
      </div>
      <DataTable
        size="lg"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.type}
        loadingRows={6}
        empty={t('adminHomeNoTypeMatch')}
        caption={t('adminHomeAvailabilityTitle')}
      />
      {canExpand && !expanded && (
        <p className="text-xs text-muted">{t('adminHomeTopTypes')}</p>
      )}
    </AdminHomeSection>
  )
}
