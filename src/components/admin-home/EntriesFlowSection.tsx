import { useCallback, useMemo } from 'react'
import { Badge, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { EntriesLineChart } from '@/components/charts/lazy'
import type { EntriesLinePoint } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import {
  buildChartBuckets,
  chartBucketLabel,
  chartBucketRangeLabel,
  type ChartBucketUnit,
} from '@/lib/chartBuckets'
import { fetchEntriesSeries } from '@/lib/adminHomeData'
import {
  adminHomePeriodKeys,
  aggregateDailySeries,
  type AdminHomeOwner,
  type AdminHomePeriod,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface EntriesFlowSectionProps {
  owner: AdminHomeOwner | null
  period: AdminHomePeriod
  onPeriodChange: (period: AdminHomePeriod) => void
  showExits: boolean
  onShowExitsChange: (value: boolean) => void
}

function unitLabelKey(unit: ChartBucketUnit | undefined) {
  if (unit === 'month') return 'adminHomeUnitMonth' as const
  if (unit === 'week') return 'adminHomeUnitWeek' as const
  return 'adminHomeUnitDay' as const
}

/**
 * "حركة الدخول": entries (and optionally exits) over the selected period.
 *
 * The database always returns one row per Saudi calendar day; the granularity
 * of the chart is chosen here and the days are folded into buckets locally, so
 * switching between a monthly and a weekly view costs no request and both
 * views are guaranteed to sum to the same totals. Both presets are longer than
 * six months, so `buildChartBuckets` draws them monthly.
 */
export function EntriesFlowSection({
  owner,
  period,
  onPeriodChange,
  showExits,
  onShowExitsChange,
}: EntriesFlowSectionProps) {
  const { t, lang, dir } = useI18n()

  // The range is read from the clock once per period/owner change, so the
  // chart does not re-bucket itself on every render.
  const range = useMemo(() => adminHomePeriodKeys(period), [period])

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchEntriesSeries(range.from, range.to, owner, null, signal),
    [owner, range.from, range.to],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const buckets = useMemo(
    () => buildChartBuckets(range.from, range.to, 'month'),
    [range.from, range.to],
  )

  const points: EntriesLinePoint[] = useMemo(() => {
    const totals = aggregateDailySeries(buckets, data ?? [])
    return buckets.map((bucket, index) => ({
      key: bucket.key,
      label: chartBucketLabel(bucket, lang),
      title: chartBucketRangeLabel(bucket),
      entries: totals[index]?.entries ?? 0,
      exits: totals[index]?.exits ?? 0,
    }))
  }, [buckets, data, lang])

  return (
    <AdminHomeSection
      title={t('adminHomeFlowTitle')}
      description={t('adminHomeFlowDescription')}
      action={<Badge tone="info">{t(unitLabelKey(buckets[0]?.unit))}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={period}
          onValueChange={(value) => onPeriodChange(value as AdminHomePeriod)}
        >
          <TabsList variant="segmented" aria-label={t('adminHomeFlowPeriod')}>
            <TabsTrigger value="year">{t('adminHomeFlowThisYear')}</TabsTrigger>
            <TabsTrigger value="last12">{t('adminHomeFlowLast12')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Switch
          checked={showExits}
          onCheckedChange={onShowExitsChange}
          label={t('adminHomeShowExits')}
        />
      </div>
      <EntriesLineChart
        ariaLabel={t('adminHomeFlowAria')}
        dir={dir}
        lang={lang}
        points={points}
        entriesLabel={t('adminHomeEntries')}
        exitsLabel={t('adminHomeExits')}
        showExits={showExits}
      />
    </AdminHomeSection>
  )
}
