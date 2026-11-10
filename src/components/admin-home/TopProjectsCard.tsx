import { useCallback, useMemo } from 'react'
import { SoftBarChart } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import { fetchOpenProjectVisits } from '@/lib/adminHomeData'
import { openProjectVisitsHref } from '@/lib/adminHomeLinks'
import { topProjects } from '@/lib/adminHomeV2'
import { localizedName } from '@/lib/localizedName'
import { CountUp } from './CountUp'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { VerticalBarsSkeleton } from './HomeSkeletons'
import { useAdminHomeSection } from './useAdminHomeSection'

/**
 * «توزيع المعدات على المشاريع» (owner 2026-11-09, the v2 mockup, as «المشاريع
 * الاكثر معدات»; renamed, moved to the foot of the page across its full width
 * and widened to twelve bars on 2026-11-10, «المسمى مو كويس غيره وخلي الجدول
 * تحت اخر شي»): the units inside each project now — the open project visits
 * of `movement_visits`, read once (bounded) and grouped by `topProjects` —
 * the largest as bars, the rest summed under them. «عرض الكل» opens the
 * log's open project visits.
 */
export function TopProjectsCard({ canOpenLogs }: { canOpenLogs: boolean }) {
  const { t, lang, dir } = useI18n()
  const load = useCallback(
    (signal: AbortSignal) => fetchOpenProjectVisits(signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)
  const grouped = useMemo(() => (data ? topProjects(data.rows) : null), [data])
  // One array per load, so the bars draw in when the data arrives and not
  // on every render of the block.
  const items = useMemo(
    () =>
      grouped
        ? grouped.top.map((row) => ({
            id: row.id,
            label: localizedName(lang, row.nameAr, row.nameEn) || '—',
            value: row.count,
          }))
        : [],
    [grouped, lang],
  )

  return (
    <HomeBlock
      title="homeV2TopProjects"
      action={
        <ViewAllAction href={canOpenLogs ? openProjectVisitsHref() : null} />
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<VerticalBarsSkeleton height={210} />}
    >
      {grouped && grouped.top.length === 0 ? (
        <p className="text-sm text-muted">{t('homeV2NoProjects')}</p>
      ) : grouped ? (
        <>
          <SoftBarChart
            ariaLabel={t('homeV2TopProjectsAria')}
            dir={dir}
            lang={lang}
            height={210}
            singleColor="var(--chart-1)"
            singleStroke="var(--chart-stroke-1)"
            items={items}
          />
          {grouped.otherProjects > 0 && (
            <p className="mt-1 text-sm text-muted">
              {t('homeV2OtherProjects')
                .replace('{projects}', String(grouped.otherProjects))
                .split('{count}')
                .flatMap((part, index) =>
                  index === 0
                    ? [part]
                    : [
                        <span
                          key={index}
                          className="font-semibold tabular-nums text-fg"
                        >
                          <CountUp value={grouped.others} />
                        </span>,
                        part,
                      ],
                )}
            </p>
          )}
          {data?.capped && (
            <p className="mt-1 text-xs text-muted">{t('homeV2Capped')}</p>
          )}
        </>
      ) : null}
    </HomeBlock>
  )
}
