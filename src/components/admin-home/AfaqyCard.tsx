import { useCallback, useState, type ReactNode } from 'react'
import { Ban, CheckCircle2, Radio, WifiOff } from 'lucide-react'
import {
  DataTable,
  Notice,
  Tabs,
  TabsList,
  TabsTrigger,
  type BadgeTone,
  type DataTableColumn,
} from '@/components/ui'
import { deepTint } from '@/components/charts'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import { loadAfaqyStats, type AfaqyStatsAnswer } from '@/lib/afaqy'
import type { AfaqyStats, AfaqyStatsUnit } from '@/lib/afaqyStats'
import { sharePercent } from '@/lib/adminHomeV2'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { supabase } from '@/lib/supabase'
import { CountUp } from './CountUp'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { AfaqySkeleton } from './HomeSkeletons'
import { useAdminHomeSection } from './useAdminHomeSection'

type ListKey = keyof AfaqyStats['lists']

/** The two tables of the 2026-10-26 section, as tabs (owner 2026-11-10,
 *  «بالنسبة للتتبع اضف البيانات الي كان في الجداول القديمة»): the units
 *  not connected with their last signal, and the units without a signal,
 *  each with its count and its one-line description. */
const LIST_TABS: {
  key: ListKey
  title: TranslationKey
  description: TranslationKey
  withSignal: boolean
}[] = [
  {
    key: 'offline',
    title: 'afaqyHomeOfflineList',
    description: 'afaqyHomeOfflineListDesc',
    withSignal: true,
  },
  {
    key: 'noSignal',
    title: 'afaqyHomeNoSignalList',
    description: 'afaqyHomeNoSignalListDesc',
    withSignal: false,
  },
]

/** The tables' fixed height (`DataTable`'s own `maxHeight`): every row the
 *  stats hold (at most `AFAQY_STATS_LIST_MAX`) scrolls under the sticky
 *  header. */
const TABLE_MAX_HEIGHT = '220px'

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
 * (owner 2026-11-10, «اضف البيانات الي كان في الجداول القديمة») the two
 * tables of that section as tabs — «غير متصلة» with the last signal in words
 * and «بدون اشارة», each row opening its unit, every row the stats hold in a
 * fixed-height scroll box. «عرض الكل» still opens the full section in place
 * (`AfaqySection`). Shown with `equipment.location.view` only; the route
 * checks it again.
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
  const [tab, setTab] = useState<ListKey>('offline')
  const list = LIST_TABS.find((item) => item.key === tab) ?? LIST_TABS[0]

  const codeColumn: DataTableColumn<AfaqyStatsUnit> = {
    key: 'code',
    header: t('homeV2ColUnit'),
    cell: (row) => (
      <span className="block">
        <bdi dir="ltr" className="block text-[13px] font-semibold">
          {row.code}
        </bdi>
        <span className="block text-[11px] leading-4 text-muted">
          {row.type ?? '—'}
        </span>
      </span>
    ),
  }
  // The last signal in full words («7 شهور», «سنتين»), the exact time on
  // hover (owner 2026-10-26).
  const signalColumn: DataTableColumn<AfaqyStatsUnit> = {
    key: 'signal',
    header: t('afaqyLastSignal'),
    align: 'end',
    cell: (row) =>
      row.lastSignal ? (
        <time
          dateTime={row.lastSignal}
          title={formatDateTime(row.lastSignal, false)}
          className="whitespace-nowrap text-muted"
        >
          {elapsedInWords(row.lastSignal, lang) ?? '—'}
        </time>
      ) : (
        <span className="text-muted">—</span>
      ),
  }

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
          <Tabs value={tab} onValueChange={(value) => setTab(value as ListKey)}>
            <TabsList
              variant="segmented"
              aria-label={t('homeV2Afaqy')}
              className="mb-1.5 mt-2.5"
            >
              {LIST_TABS.map((item) => (
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  className="!h-7 !px-2.5 text-xs"
                >
                  {t(item.title)}
                  <span className="ms-1 tabular-nums text-muted">
                    {stats.listTotals[item.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="mb-1.5 text-[11px] leading-4 text-muted">
            {t(list.description)}
          </p>
          <DataTable
            size="md"
            columns={
              list.withSignal ? [codeColumn, signalColumn] : [codeColumn]
            }
            rows={stats.lists[list.key]}
            rowKey={(row) => row.id}
            caption={`${t('homeV2Afaqy')} · ${t(list.title)}`}
            maxHeight={TABLE_MAX_HEIGHT}
            stickyHeader
            cellTextClassName="text-xs"
            cellClassName="py-1.5"
            empty={t('afaqyHomeNone')}
            rowHref={
              canOpenEquipment ? (row) => `/equipment/${row.id}` : undefined
            }
          />
        </div>
      ) : null}
    </HomeBlock>
  )
}
