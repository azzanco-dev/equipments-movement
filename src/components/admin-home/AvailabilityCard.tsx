import { useCallback, useState } from 'react'
import { cn } from '@/components/ui'
import { deepTint } from '@/components/charts'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchAvailabilityByType } from '@/lib/adminHomeData'
import {
  DEFAULT_HOME_OWNERS,
  type AdminHomeOwner,
  type FleetStateCounts,
} from '@/lib/adminHomeStats'
import { sharePercent } from '@/lib/adminHomeV2'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { BarRowsSkeleton } from './HomeSkeletons'
import { HomeOwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Types the block draws; the rest are counted under them. */
const TYPE_ROWS = 6

const PARTS: {
  field: keyof FleetStateCounts
  label: TranslationKey
  shade: number
}[] = [
  { field: 'insideSites', label: 'homeV2OnProjects', shade: 1 },
  { field: 'inWorkshop', label: 'homeV2Workshop', shade: 2 },
  { field: 'available', label: 'equipmentStateAvailable', shade: 6 },
]

/**
 * «التوفر حسب النوع» (owner 2026-11-09, the v2 mockup): the six types with
 * the most units (`get_admin_availability_by_type`, largest first), each a
 * bar split into on projects, the workshop and available, with the available
 * count and its share. Its owner filter stays where it was (the home's three
 * owners, Al-Azani by default). «عرض الكل» opens the full table in place —
 * its search and paging (`AvailabilitySection`).
 */
export function AvailabilityCard({ onShowAll }: { onShowAll: () => void }) {
  const { t } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(DEFAULT_HOME_OWNERS)
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchAvailabilityByType(
        {
          owners: owners.length ? owners : null,
          search: null,
          page: 1,
          pageSize: TYPE_ROWS,
        },
        signal,
      ),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)
  const rows = data?.rows ?? []
  const max = Math.max(1, ...rows.map((row) => row.total))
  const others = Math.max(0, (data?.total ?? 0) - rows.length)

  return (
    <HomeBlock
      title="homeV2Availability"
      action={
        <>
          <HomeOwnerFilter
            size="sm"
            className="w-32"
            value={owners}
            onChange={setOwners}
          />
          <ViewAllAction onClick={onShowAll} />
        </>
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<BarRowsSkeleton rows={6} />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('adminHomeNoTypes')}</p>
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn(loading && 'opacity-60')}
        >
          <ul className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.type} className="flex items-center gap-2 text-sm">
                <span
                  className="truncate-safe w-28 shrink-0 text-start sm:w-32"
                  dir="ltr"
                  title={row.type}
                >
                  {row.type}
                </span>
                <span
                  role="img"
                  aria-label={PARTS.map(
                    (part) => `${t(part.label)} ${row[part.field]}`,
                  ).join('، ')}
                  className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
                >
                  <span
                    className="bar-grow flex h-full gap-px"
                    style={{ width: `${(row.total / max) * 100}%` }}
                  >
                    {PARTS.map((part) => (
                      <span
                        key={part.field}
                        className="block h-full first:rounded-s-full last:rounded-e-full"
                        style={{
                          width: `${row.total > 0 ? (row[part.field] / row.total) * 100 : 0}%`,
                          backgroundColor: deepTint(
                            `var(--chart-${part.shade})`,
                            `var(--chart-stroke-${part.shade})`,
                          ),
                        }}
                      />
                    ))}
                  </span>
                </span>
                <span className="w-9 shrink-0 text-end font-semibold tabular-nums">
                  {row.available}
                </span>
                <span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted">
                  {sharePercent(row.available, row.total)}%
                </span>
              </li>
            ))}
          </ul>
          <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted">
            {PARTS.map((part) => (
              <li key={part.field} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: `var(--chart-stroke-${part.shade})`,
                  }}
                />
                {t(part.label)}
              </li>
            ))}
            {others > 0 && (
              <li>
                {t('homeV2AvailabilityOthers').replace(
                  '{count}',
                  String(others),
                )}
              </li>
            )}
            <li className="ms-auto">{t('homeV2AvailabilityLegend')}</li>
          </ul>
        </div>
      )}
    </HomeBlock>
  )
}
