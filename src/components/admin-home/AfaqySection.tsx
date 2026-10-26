import { useCallback, useState, type ReactNode } from 'react'
import {
  Loader2,
  Radio,
  SatelliteDish,
  SignalZero,
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  MiniTable,
  MiniTableGrid,
  Notice,
  StatCard,
  type DataTableColumn,
} from '@/components/ui'
import type { StatCardAccent } from '@/components/ui/StatCard'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import { loadAfaqyStats, type AfaqyStatsAnswer } from '@/lib/afaqy'
import type { AfaqyStats, AfaqyStatsUnit } from '@/lib/afaqyStats'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { supabase } from '@/lib/supabase'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

const ICON_SIZE = 16

interface CardDef {
  label: TranslationKey
  hint?: TranslationKey
  value: (stats: AfaqyStats) => ReactNode
  accent: StatCardAccent
  icon: ReactNode
}

/** Coverage, then Afaqy's two states (owner 2026-10-26: «في افاقي فيه
 *  connection state و satellite»): connected or not (approximated from the
 *  last message), and no satellites (the last known count is 0). */
const SIGNAL_CARDS: CardDef[] = [
  {
    label: 'afaqyHomeLinked',
    value: (stats) => `${stats.linked} / ${stats.fleet}`,
    accent: 'primary',
    icon: <Radio size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeOnline',
    hint: 'afaqyHomeOnlineHint',
    value: (stats) => stats.connection.online,
    accent: 'success',
    icon: <Wifi size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeOffline',
    hint: 'afaqyHomeOfflineHint',
    value: (stats) => stats.connection.offline,
    accent: 'danger',
    icon: <WifiOff size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeNoFix',
    hint: 'afaqyHomeNoFixHint',
    value: (stats) => stats.noFix,
    accent: 'warning',
    icon: <SatelliteDish size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeNoSignal',
    hint: 'afaqyHomeNoSignalHint',
    value: (stats) => stats.connection.none,
    accent: 'neutral',
    icon: <SignalZero size={ICON_SIZE} />,
  },
]

/** The mini tables (owner 2026-10-26: «ابغى الجداول المصغرة»), like the
 *  fleet's: code and type, plus the last message in full words. */
const LISTS: {
  key: keyof AfaqyStats['lists']
  title: TranslationKey
  withSignal: boolean
}[] = [
  { key: 'offline', title: 'afaqyHomeOfflineList', withSignal: true },
  { key: 'noFix', title: 'afaqyHomeNoFixList', withSignal: true },
  // Owner 2026-10-26: «اظهر المعدات بدون اشارة».
  { key: 'noSignal', title: 'afaqyHomeNoSignalList', withSignal: false },
]

/** Rows a mini table shows until «عرض الكل», as on the fleet's. */
const MINI_ROWS = 7

export interface AfaqySectionProps {
  onSelectEquipment?: (id: string) => void
}

/**
 * «بيانات التتبع في افاقي» on the admin home (owner 2026-10-26): for the
 * program's active Al-Azani and F fleet, how many units are linked to a
 * tracker, how many are connected (a message in the last 30 minutes) or
 * not, whose last message had no GPS fix, and which never sent anything —
 * with the units of each in a mini table. Shown with
 * `equipment.location.view` (the «الموقع الحالي» key; the admin role while
 * the permissions load); the route checks it again.
 */
export function AfaqySection(props: AfaqySectionProps) {
  const { profile } = useAuth()
  const permissionState = usePermissions()
  if (!canViewEquipmentLocation(permissionState, profile?.role)) return null
  return <AfaqySectionContent {...props} />
}

function AfaqySectionContent({ onSelectEquipment }: AfaqySectionProps) {
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

  // «عرض الكل» opens a table to every row it holds (at most 30).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const codeColumn: DataTableColumn<AfaqyStatsUnit> = {
    key: 'code',
    header: t('equipmentCode'),
    cell: (row) => (
      <bdi dir="ltr" className="font-semibold">
        {row.code}
      </bdi>
    ),
  }
  const typeColumn: DataTableColumn<AfaqyStatsUnit> = {
    key: 'type',
    header: t('equipmentType'),
    cell: (row) => row.type ?? '—',
  }
  // Owner 2026-10-26: the last signal in full words («7 شهور», «سنتين»),
  // the exact time on hover.
  const signalColumn: DataTableColumn<AfaqyStatsUnit> = {
    key: 'signal',
    header: t('afaqyLastSignal'),
    cell: (row) =>
      row.lastSignal ? (
        <time
          dateTime={row.lastSignal}
          title={formatDateTime(row.lastSignal, false)}
        >
          {elapsedInWords(row.lastSignal, lang) ?? '—'}
        </time>
      ) : (
        '—'
      ),
  }

  // Owner 2026-10-26: «اضف حاجة تدل على انه البيانات يتم جلبها». The
  // first load says so in the body; a later one (a retry) beside the title,
  // over the figures it is replacing.
  const fetching = (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs text-muted"
    >
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      {t('afaqyHomeFetching')}
    </span>
  )

  return (
    <AdminHomeSection
      title={t('afaqyHomeTitle')}
      description={t('afaqyHomeDescription')}
      action={loading && data !== null ? fetching : undefined}
      failed={failed}
      onRetry={retry}
    >
      {loading && data === null ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          {fetching}
        </div>
      ) : data?.kind === 'not_configured' ? (
        <Notice tone="neutral">{t('afaqyStatusNotConfigured')}</Notice>
      ) : stats ? (
        <div className="space-y-4" aria-busy={loading || undefined}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SIGNAL_CARDS.map((card) => (
              <StatCard
                key={card.label}
                label={t(card.label)}
                value={<bdi dir="ltr">{card.value(stats)}</bdi>}
                hint={card.hint ? t(card.hint) : undefined}
                accent={card.accent}
                icon={card.icon}
              />
            ))}
          </div>
          <MiniTableGrid>
            {LISTS.map(({ key, title, withSignal }) => {
              const rows = stats.lists[key]
              const open = expanded.has(key)
              return (
                <MiniTable
                  key={key}
                  title={t(title)}
                  description={t('afaqyHomeListCount').replace(
                    '{count}',
                    String(stats.listTotals[key]),
                  )}
                  columns={
                    withSignal
                      ? [codeColumn, typeColumn, signalColumn]
                      : [codeColumn, typeColumn]
                  }
                  rows={rows}
                  rowKey={(row) => row.id}
                  maxRows={open ? rows.length : MINI_ROWS}
                  onViewAll={
                    !open && rows.length > MINI_ROWS
                      ? () =>
                          setExpanded((current) => new Set(current).add(key))
                      : undefined
                  }
                  onRowClick={
                    onSelectEquipment
                      ? (row) => onSelectEquipment(row.id)
                      : undefined
                  }
                  rowHref={(row) => `/equipment/${row.id}`}
                  empty={t('afaqyHomeNone')}
                />
              )
            })}
          </MiniTableGrid>
          <p className="text-xs text-muted">
            {t('afaqyHomeUpdated')}{' '}
            <bdi dir="ltr">{formatDateTime(stats.generatedAt, false)}</bdi>
          </p>
        </div>
      ) : null}
    </AdminHomeSection>
  )
}
