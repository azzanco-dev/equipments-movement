import { useCallback, useMemo, type ReactNode } from 'react'
import { Ban, CheckCircle2, Radio, WifiOff } from 'lucide-react'
import { AppLink, Notice, type BadgeTone } from '@/components/ui'
import { deepTint } from '@/components/charts'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import { loadAfaqyStats, type AfaqyStatsAnswer } from '@/lib/afaqy'
import { sharePercent } from '@/lib/adminHomeV2'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { supabase } from '@/lib/supabase'
import { CountUp } from './CountUp'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { AfaqySkeleton } from './HomeSkeletons'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Units «غير متصلة» listed with their last signal, the oldest first. */
const LONGEST_ROWS = 3

export interface AfaqyCardProps {
  /** The «يحتاج انتباهك» no-signal item scrolls here. */
  id: string
  onShowAll: () => void
  /** The shell opens the equipment page: the silent units link to it. */
  canOpenEquipment: boolean
}

/**
 * «التتبع في افاقي» (owner 2026-11-09, the v2 mockup): the figures of the
 * Afaqy section of 2026-10-26 in one block — linked, connected, not
 * connected, no signal — a bar of the three states of the linked units, and
 * the three units silent the longest, each opening its unit. «عرض الكل»
 * opens the full section in place (its two tables, `AfaqySection`). Shown
 * with `equipment.location.view` only; the route checks it again.
 */
export function AfaqyCard(props: AfaqyCardProps) {
  const permissionState = usePermissions()
  if (!canViewEquipmentLocation(permissionState)) return null
  return <AfaqyCardContent {...props} />
}

function AfaqyCardContent({ id, onShowAll, canOpenEquipment }: AfaqyCardProps) {
  const { t, lang } = useI18n()
  const load = useCallback(async (signal: AbortSignal) => {
    const answer: AfaqyStatsAnswer | null = await loadAfaqyStats(
      supabase,
      signal,
    )
    if (!answer || answer.kind === 'error') throw new Error('afaqy_stats')
    return answer
  }, [])
  const { data, loading, failed, retry } = useAdminHomeSection(load)
  const stats = data?.kind === 'ok' ? data.stats : null

  const longest = useMemo(
    () =>
      stats
        ? [...stats.lists.offline]
            .filter((row) => row.lastSignal)
            .sort((a, b) =>
              (a.lastSignal ?? '').localeCompare(b.lastSignal ?? ''),
            )
            .slice(0, LONGEST_ROWS)
        : [],
    [stats],
  )

  const cells: {
    label: TranslationKey
    value: number
    tone: BadgeTone
    icon: ReactNode
  }[] = stats
    ? [
        {
          label: 'homeV2AfaqyLinked',
          value: stats.linked,
          tone: 'neutral',
          icon: <Radio size={14} />,
        },
        {
          label: 'afaqyHomeOnline',
          value: stats.connection.online,
          tone: 'success',
          icon: <CheckCircle2 size={14} />,
        },
        {
          label: 'afaqyHomeOffline',
          value: stats.connection.offline,
          tone: 'warning',
          icon: <WifiOff size={14} />,
        },
        {
          label: 'afaqyHomeNoSignal',
          value: stats.connection.none,
          tone: 'danger',
          icon: <Ban size={14} />,
        },
      ]
    : []
  const segments = stats
    ? [
        { id: 'online', value: stats.connection.online, tone: 'success' },
        { id: 'offline', value: stats.connection.offline, tone: 'warning' },
        { id: 'none', value: stats.connection.none, tone: 'danger' },
      ]
    : []

  return (
    <HomeBlock
      id={id}
      title="homeV2Afaqy"
      action={stats ? <ViewAllAction onClick={onShowAll} /> : undefined}
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<AfaqySkeleton />}
    >
      {data?.kind === 'not_configured' ? (
        <Notice tone="neutral">{t('afaqyStatusNotConfigured')}</Notice>
      ) : stats ? (
        <div aria-busy={loading || undefined}>
          <ul className="grid grid-cols-2 gap-1.5">
            {cells.map((cell) => (
              <li
                key={cell.label}
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={
                    cell.tone === 'neutral'
                      ? {
                          color: 'var(--muted)',
                          backgroundColor: 'var(--surface-hover)',
                        }
                      : {
                          color: `var(--${cell.tone})`,
                          backgroundColor: `var(--${cell.tone}-soft)`,
                        }
                  }
                >
                  {cell.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold leading-tight tabular-nums">
                    <CountUp value={cell.value} />
                  </span>
                  <span className="block text-[11px] leading-3 text-muted">
                    {t(cell.label)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div
            aria-hidden="true"
            className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-hover"
          >
            {stats.linked > 0 && (
              <div className="bar-grow flex h-full w-full gap-px">
                {segments.map((segment) => (
                  <span
                    key={segment.id}
                    style={{
                      width: `${(segment.value / stats.linked) * 100}%`,
                      // Light fills, never the saturated tone itself.
                      backgroundColor: deepTint(
                        `var(--${segment.tone}-soft)`,
                        `var(--${segment.tone})`,
                      ),
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {t('homeV2AfaqyShare').replace(
              '{share}',
              String(sharePercent(stats.connection.online, stats.linked)),
            )}
          </p>
          {longest.length > 0 && (
            <ul className="mt-2 divide-y border-t text-sm">
              {longest.map((row) => {
                const body = (
                  <>
                    <bdi dir="ltr" className="font-semibold">
                      {row.code}
                    </bdi>
                    <time
                      dateTime={row.lastSignal ?? undefined}
                      title={
                        row.lastSignal
                          ? formatDateTime(row.lastSignal, false)
                          : undefined
                      }
                      className="text-muted"
                    >
                      {t('homeV2AfaqyLast').replace(
                        '{time}',
                        (row.lastSignal &&
                          elapsedInWords(row.lastSignal, lang)) ||
                          '—',
                      )}
                    </time>
                  </>
                )
                const rowClass =
                  'flex items-center justify-between gap-2 rounded py-1.5'
                return (
                  <li key={row.id}>
                    {canOpenEquipment ? (
                      <AppLink
                        href={`/equipment/${row.id}`}
                        className={`${rowClass} transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
                      >
                        {body}
                      </AppLink>
                    ) : (
                      <span className={rowClass}>{body}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </HomeBlock>
  )
}
