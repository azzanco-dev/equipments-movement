import { useCallback, useMemo, useState } from 'react'
import { Badge, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { EntriesLineChart } from '@/components/charts/lazy'
import type { EntriesLinePoint } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import {
  buildChartBuckets,
  chartBucketLabel,
  chartBucketRangeLabel,
} from '@/lib/chartBuckets'
import { fetchEntriesSeries, fetchEntriesYearly } from '@/lib/adminHomeData'
import {
  ADMIN_HOME_GRANULARITIES,
  GRANULARITY_YEARS,
  adminHomeFlowRange,
  aggregateDailySeries,
  buildYearlySeries,
  type AdminHomeGranularity,
  type AdminHomeOwner,
  type DailyMovementCount,
  type YearlyMovementCount,
} from '@/lib/adminHomeStats'
import type { TranslationKey } from '@/i18n/translations'
import { AdminHomeSection } from './AdminHomeSection'
import { OwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface EntriesFlowSectionProps {
  granularity: AdminHomeGranularity
  onGranularityChange: (value: AdminHomeGranularity) => void
  showExits: boolean
  onShowExitsChange: (value: boolean) => void
}

const GRANULARITY_LABEL: Record<AdminHomeGranularity, TranslationKey> = {
  day: 'adminHomeFlowDay',
  month: 'adminHomeFlowMonth',
  year: 'adminHomeFlowYear',
}

/**
 * What the section loaded, tagged with the view it belongs to: the يوم and شهر
 * views share a daily payload while سنة has its own, and a response that
 * arrives after the granularity changed must be recognisable as the other
 * view's data rather than bucketed as if it were days.
 */
type FlowPayload =
  | { kind: 'year'; rows: YearlyMovementCount[] }
  | { kind: 'daily'; rows: DailyMovementCount[] }

/** The window each granularity covers, shown as the section's chip. */
const WINDOW_LABEL: Record<AdminHomeGranularity, TranslationKey> = {
  day: 'adminHomeFlowLastDays',
  month: 'adminHomeFlowLastMonths',
  year: 'adminHomeFlowLastYears',
}

/**
 * "حركة الدخول": entries (and optionally exits) at the selected granularity.
 *
 * Owner review (2026-09-22): the period switcher became a granularity switch —
 * يوم is the last 30 days day by day, شهر the last 12 months month by month,
 * and سنة the last 5 years year by year.
 *
 * The يوم and شهر views share one definition of a day: the database returns
 * daily rows and `chartBuckets` folds them here, so the two views always sum
 * to the same totals. سنة is the exception and comes from its own database
 * function (`get_admin_entries_yearly`, migration 0095), because five years of
 * days is far past the 400-day cap the daily series enforces and raising that
 * cap would hand every caller an unbounded payload.
 *
 * The owner filter sits next to the granularity switch and is the section's
 * own state (owner review, 2026-09-22, third pass): the page-level filter is
 * gone, so the two controls that decide what this chart draws are together.
 */
export function EntriesFlowSection({
  granularity,
  onGranularityChange,
  showExits,
  onShowExitsChange,
}: EntriesFlowSectionProps) {
  const { t, lang, dir } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>([])
  const yearly = granularity === 'year'

  // The range is read from the clock once per granularity/owner change, so the
  // chart does not re-bucket itself on every render.
  const range = useMemo(
    () => adminHomeFlowRange(yearly ? 'month' : granularity),
    [granularity, yearly],
  )

  // The result carries which shape it is, so a payload that arrives after the
  // granularity changed is recognised as the other view's data and ignored
  // instead of being bucketed as if it were days.
  const load = useCallback(
    (signal: AbortSignal): Promise<FlowPayload> =>
      yearly
        ? fetchEntriesYearly(GRANULARITY_YEARS, owners, null, signal).then(
            (rows) => ({ kind: 'year' as const, rows }),
          )
        : fetchEntriesSeries(range.from, range.to, owners, null, signal).then(
            (rows) => ({ kind: 'daily' as const, rows }),
          ),
    [owners, range.from, range.to, yearly],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const buckets = useMemo(
    () =>
      yearly
        ? []
        : buildChartBuckets(
            range.from,
            range.to,
            granularity === 'day' ? 'day' : 'month',
          ),
    [granularity, range.from, range.to, yearly],
  )

  const points: EntriesLinePoint[] = useMemo(() => {
    if (yearly) {
      const rows = data?.kind === 'year' ? data.rows : []
      return buildYearlySeries(rows, GRANULARITY_YEARS).map((point) => ({
        key: point.key,
        label: point.key,
        title: point.key,
        entries: point.entries,
        exits: point.exits,
      }))
    }
    const totals = aggregateDailySeries(
      buckets,
      data?.kind === 'daily' ? data.rows : [],
    )
    return buckets.map((bucket, index) => ({
      key: bucket.key,
      label: chartBucketLabel(bucket, lang),
      title: chartBucketRangeLabel(bucket),
      entries: totals[index]?.entries ?? 0,
      exits: totals[index]?.exits ?? 0,
    }))
  }, [buckets, data, lang, yearly])

  return (
    <AdminHomeSection
      title={t('adminHomeFlowTitle')}
      description={t('adminHomeFlowDescription')}
      action={<Badge tone="info">{t(WINDOW_LABEL[granularity])}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={granularity}
            onValueChange={(value) =>
              onGranularityChange(value as AdminHomeGranularity)
            }
          >
            <TabsList
              variant="segmented"
              aria-label={t('adminHomeFlowGranularity')}
            >
              {ADMIN_HOME_GRANULARITIES.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(GRANULARITY_LABEL[value])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <OwnerFilter
            size="sm"
            value={owners}
            onChange={setOwners}
            className="w-36 sm:w-44"
          />
        </div>
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
