import { useCallback, useMemo, useState } from 'react'
import { Select, cn } from '@/components/ui'
import { SoftAreaChart } from '@/components/charts/lazy'
import type { EntriesLinePoint } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  buildChartBuckets,
  chartBucketLabel,
  chartBucketRangeLabel,
} from '@/lib/chartBuckets'
import { fetchEntriesSeries, fetchEntriesYearly } from '@/lib/adminHomeData'
import {
  ADMIN_HOME_GRANULARITIES,
  DEFAULT_HOME_OWNERS,
  GRANULARITY_DAYS,
  GRANULARITY_YEARS,
  adminHomeFlowRange,
  aggregateDailySeries,
  buildYearlySeries,
  type AdminHomeGranularity,
  type AdminHomeOwner,
  type DailyMovementCount,
  type YearlyMovementCount,
} from '@/lib/adminHomeStats'
import { CountUp } from './CountUp'
import { HomeBlock } from './HomeBlock'
import { HomeOwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** The window each granularity covers, as the period select reads it. */
const WINDOW_LABEL: Record<AdminHomeGranularity, TranslationKey> = {
  day: 'adminHomeFlowLastDays',
  month: 'adminHomeFlowLastMonths',
  year: 'adminHomeFlowLastYears',
}

/** What was loaded, tagged with the view it was loaded for (see the old
 *  `EntriesFlowSection`): a refetch keeps the previous chart as itself. */
type FlowPayload =
  | { kind: 'year'; rows: YearlyMovementCount[] }
  | {
      kind: 'daily'
      bucket: 'day' | 'month'
      from: string
      to: string
      rows: DailyMovementCount[]
    }

/**
 * «الدخول والخروج اليومي» (owner 2026-11-09, the v2 mockup): the entries and
 * the exits as a soft area chart with their totals. The period is the
 * granularity the chart always had (owner 2026-09-22: the last 30 days by
 * day, 12 months by month, 5 years by year), kept in the URL (`?flow=`) and
 * chosen from a select in the block's header; the home's owner filter stays
 * beside it (the three owners, Al-Azani by default). The daily view says its
 * daily average.
 */
export function EntriesCard({
  granularity,
  onGranularityChange,
}: {
  granularity: AdminHomeGranularity
  onGranularityChange: (value: AdminHomeGranularity) => void
}) {
  const { t, lang, dir } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(DEFAULT_HOME_OWNERS)
  const yearly = granularity === 'year'
  const range = useMemo(
    () => adminHomeFlowRange(yearly ? 'month' : granularity),
    [granularity, yearly],
  )
  const load = useCallback(
    (signal: AbortSignal): Promise<FlowPayload> =>
      yearly
        ? fetchEntriesYearly(GRANULARITY_YEARS, owners, null, signal).then(
            (rows) => ({ kind: 'year' as const, rows }),
          )
        : fetchEntriesSeries(range.from, range.to, owners, null, signal).then(
            (rows) => ({
              kind: 'daily' as const,
              bucket:
                granularity === 'day' ? ('day' as const) : ('month' as const),
              from: range.from,
              to: range.to,
              rows,
            }),
          ),
    [granularity, owners, range.from, range.to, yearly],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const points: EntriesLinePoint[] = useMemo(() => {
    if (!data) return []
    if (data.kind === 'year')
      return buildYearlySeries(data.rows, GRANULARITY_YEARS).map((point) => ({
        key: point.key,
        label: point.key,
        title: point.key,
        entries: point.entries,
        exits: point.exits,
      }))
    const buckets = buildChartBuckets(data.from, data.to, data.bucket)
    const totals = aggregateDailySeries(buckets, data.rows)
    return buckets.map((bucket, index) => ({
      key: bucket.key,
      label: chartBucketLabel(bucket, lang),
      title: chartBucketRangeLabel(bucket),
      entries: totals[index]?.entries ?? 0,
      exits: totals[index]?.exits ?? 0,
    }))
  }, [data, lang])

  const entries = points.reduce((sum, point) => sum + point.entries, 0)
  const exits = points.reduce((sum, point) => sum + (point.exits ?? 0), 0)
  const daily = data?.kind === 'daily' && data.bucket === 'day'
  const refreshing = loading && data !== null

  return (
    <HomeBlock
      title="homeV2DailyFlow"
      action={
        <>
          <HomeOwnerFilter
            size="sm"
            className="w-32"
            value={owners}
            onChange={setOwners}
          />
          <Select
            size="sm"
            value={granularity}
            onValueChange={(value) =>
              onGranularityChange(value as AdminHomeGranularity)
            }
            options={ADMIN_HOME_GRANULARITIES.map((value) => ({
              value,
              label: t(WINDOW_LABEL[value]),
            }))}
            aria-label={t('homeV2FlowPeriod')}
          />
        </>
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
    >
      <div
        aria-busy={refreshing || undefined}
        className={cn('transition-opacity', refreshing && 'opacity-60')}
      >
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="text-muted">{t('adminHomeEntries')} </span>
            <span className="font-bold tabular-nums">
              <CountUp value={entries} />
            </span>
          </span>
          <span>
            <span className="text-muted">{t('adminHomeExits')} </span>
            <span className="font-bold tabular-nums">
              <CountUp value={exits} />
            </span>
          </span>
          {daily && (
            <span className="text-muted">
              {t('homeV2FlowAverage').replace(
                '{count}',
                String(Math.round(entries / GRANULARITY_DAYS)),
              )}
            </span>
          )}
        </div>
        <SoftAreaChart
          ariaLabel={t('adminHomeFlowAria')}
          dir={dir}
          lang={lang}
          points={points}
          entriesLabel={t('adminHomeEntries')}
          exitsLabel={t('adminHomeExits')}
          showExits
          height={220}
        />
        {refreshing && <span className="sr-only">{t('loading')}</span>}
      </div>
    </HomeBlock>
  )
}
